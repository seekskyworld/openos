import {
  GEN_APP_DEFAULT_SETTINGS,
  parseGenAppsSettings,
  type GenAppsSettings,
} from "@openos/shared";

export type GenAppsSettingsSyncSnapshot = {
  settings: GenAppsSettings;
  saving: boolean;
  error: string | null;
};

type PersistSettings = (
  patch: Partial<GenAppsSettings>,
) => Promise<GenAppsSettings>;
type SnapshotListener = (snapshot: GenAppsSettingsSyncSnapshot) => void;

const SETTINGS_CHANNEL = "openos-gen-apps-settings-v1";
let currentSettings: GenAppsSettings = { ...GEN_APP_DEFAULT_SETTINGS };
let confirmedSettings: GenAppsSettings = { ...GEN_APP_DEFAULT_SETTINGS };
let pendingPatch: Partial<GenAppsSettings> | null = null;
let persistSettings: PersistSettings | null = null;
let saveTimer: number | null = null;
let drainPromise: Promise<GenAppsSettings> | null = null;
let hydrationPromise: Promise<GenAppsSettings> | null = null;
let loadSettings: (() => Promise<GenAppsSettings>) | null = null;
let reconcileNeeded = false;
let reconciliationPromise: Promise<void> | null = null;
let revision = 0;
let lastError: string | null = null;
const listeners = new Set<SnapshotListener>();

const settingsChannel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(SETTINGS_CHANNEL);

function snapshot(): GenAppsSettingsSyncSnapshot {
  return {
    settings: { ...currentSettings },
    saving: pendingPatch !== null || drainPromise !== null,
    error: lastError,
  };
}

function emit(): void {
  for (const listener of listeners) listener(snapshot());
}

function confirmSettings(settings: GenAppsSettings, broadcast: boolean): void {
  confirmedSettings = { ...settings };
  if (pendingPatch === null) currentSettings = { ...settings };
  revision += 1;
  lastError = null;
  if (broadcast) settingsChannel?.postMessage(settings);
  emit();
}

settingsChannel?.addEventListener("message", (event: MessageEvent<unknown>) => {
  const settings = parseGenAppsSettings(event.data);
  if (!settings) return;
  // 广播只作为失效通知；跨标签响应可能乱序，不能直接信任其中的全量快照。
  requestSettingsReconcile();
});

function requestSettingsReconcile(): void {
  reconcileNeeded = true;
  const load = loadSettings;
  if (
    !load ||
    pendingPatch !== null ||
    drainPromise !== null ||
    reconciliationPromise !== null
  ) {
    return;
  }
  reconcileNeeded = false;
  const loadRevision = revision;
  reconciliationPromise = (async () => {
    try {
      const settings = await load();
      if (
        pendingPatch !== null ||
        drainPromise !== null ||
        revision !== loadRevision
      ) {
        reconcileNeeded = true;
        return;
      }
      confirmSettings(settings, false);
    } catch {
      // 聚焦/可见性恢复时仍会再次校准；同步失败不回滚已成功保存的设置。
    }
  })().finally(() => {
    reconciliationPromise = null;
    if (reconcileNeeded) requestSettingsReconcile();
  });
}

export function getGenAppsSettingsSnapshot(): GenAppsSettingsSyncSnapshot {
  return snapshot();
}

export function subscribeGenAppsSettings(listener: SnapshotListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function hydrateGenAppsSettings(
  load: () => Promise<GenAppsSettings>,
): Promise<GenAppsSettings> {
  loadSettings = load;
  if (hydrationPromise) return hydrationPromise;
  const loadRevision = revision;
  hydrationPromise = (async () => {
    const settings = await load();
    if (drainPromise === null) {
      if (pendingPatch) {
        confirmedSettings = { ...settings };
        currentSettings = { ...settings, ...pendingPatch };
        revision += 1;
        lastError = null;
        emit();
      } else if (revision === loadRevision) {
        confirmSettings(settings, false);
      }
    }
    return { ...currentSettings };
  })().finally(() => {
    hydrationPromise = null;
    if (reconcileNeeded) requestSettingsReconcile();
  });
  return hydrationPromise;
}

export function stageGenAppsSettings(
  patch: Partial<GenAppsSettings>,
  persist: PersistSettings,
): void {
  currentSettings = { ...currentSettings, ...patch };
  pendingPatch = { ...pendingPatch, ...patch };
  persistSettings = persist;
  revision += 1;
  lastError = null;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void flushPendingGenAppsSettings().catch(() => {
      // flush 已回滚快照并通过 error 状态通知 Settings UI。
    });
  }, 300);
  emit();
}

export async function flushPendingGenAppsSettings(): Promise<GenAppsSettings> {
  // 服务端按字段 merge patch；无待保存变更时不能让后台 hydration 阻塞应用启动。
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (drainPromise) {
    await drainPromise;
    return pendingPatch
      ? flushPendingGenAppsSettings()
      : { ...confirmedSettings };
  }
  if (!pendingPatch) return { ...confirmedSettings };

  drainPromise = (async () => {
    while (pendingPatch) {
      const target = pendingPatch;
      pendingPatch = null;
      const persist = persistSettings;
      try {
        if (!persist) {
          throw new Error("Gen Apps settings persistence is unavailable.");
        }
        const saved = await persist(target);
        confirmSettings(saved, true);
      } catch (error) {
        pendingPatch = null;
        currentSettings = { ...confirmedSettings };
        revision += 1;
        lastError = error instanceof Error ? error.message : String(error);
        emit();
        throw error;
      }
    }
    return { ...confirmedSettings };
  })().finally(() => {
    drainPromise = null;
    emit();
    if (reconcileNeeded) requestSettingsReconcile();
  });

  return drainPromise;
}
