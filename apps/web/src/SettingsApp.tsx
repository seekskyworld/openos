import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  LlmAuthStyle,
  LlmCompatibleProfile,
  LlmProtocolId,
  LlmProtocolMeta,
  LlmProviderId,
  LlmProviderMeta,
  LlmReasoningEffort,
  LlmSettingsPublic,
} from "@openos/shared";
import {
  fetchGenAppsSettings,
  fetchLlmSettings,
  saveGenAppsSettings,
  saveLlmSettings,
  testLlmSettings,
  type GenAppsSettingsPayload,
} from "./api";
import { LOCALE_OPTIONS, useI18n } from "./i18n";
import {
  getGenAppsSettingsSnapshot,
  hydrateGenAppsSettings,
  stageGenAppsSettings,
  subscribeGenAppsSettings,
} from "./gen-apps/settings-sync";
import { ProvidersAuthApp } from "./ProvidersAuthApp";
import { useTheme, type ThemeMode } from "./theme";

type Props = {
  onClose?: () => void;
  onSaved?: (settings: LlmSettingsPublic) => void;
};

type SettingsTab = "providers" | "model" | "genapps" | "general";

/** 接入方式：官方服务只填厂商/模型/Key；自定义才填协议/预设/地址 */
type AccessMode = "official" | "custom";

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "ok"; text: string }
  | { kind: "error"; text: string };

const AUTH_OPTION_IDS: LlmAuthStyle[] = ["bearer", "x-api-key", "query", "none"];
const AUTH_LABEL_KEYS: Record<LlmAuthStyle, string> = {
  bearer: "custom.auth.bearer",
  "x-api-key": "custom.auth.xApiKey",
  query: "custom.auth.query",
  none: "custom.auth.none",
};

const REASONING_IDS: LlmReasoningEffort[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
];

function isCustomProvider(id: string) {
  return id === "openai-compatible";
}

function pickDefaultOfficial(providers: LlmProviderMeta[]): LlmProviderId {
  const preferred = [
    "openai",
    "anthropic",
    "google",
    "deepseek",
    "moonshot",
    "openrouter",
  ];
  for (const id of preferred) {
    if (providers.some((p) => p.id === id)) return id as LlmProviderId;
  }
  const first = providers.find((p) => !isCustomProvider(p.id));
  return (first?.id ?? "openai") as LlmProviderId;
}

const OFFICIAL_CATEGORY_ORDER = [
  "official",
  "china",
  "gateway",
  "compatible",
] as const;

// OFFICIAL_CATEGORY_* 保留给未来官方筛选；目前 Custom 页签不再展示官方分组

export function SettingsApp({ onClose, onSaved }: Props) {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<SettingsTab>("providers");
  const [navQuery, setNavQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(() => "…");
  const [providers, setProviders] = useState<LlmProviderMeta[]>([]);
  const [protocols, setProtocols] = useState<LlmProtocolMeta[]>([]);
  const [profiles, setProfiles] = useState<LlmCompatibleProfile[]>([]);

  const [mode, setMode] = useState<AccessMode>("official");
  const [provider, setProvider] = useState<LlmProviderId>("openai");
  const [profile, setProfile] = useState("custom");
  const [protocol, setProtocol] = useState<LlmProtocolId>("openai-compatible");
  const [authStyle, setAuthStyle] = useState<LlmAuthStyle>("bearer");
  const [reasoningEffort, setReasoningEffort] =
    useState<LlmReasoningEffort>("off");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyPreview, setApiKeyPreview] = useState("");
  const [testState, setTestState] = useState<TestState>({ kind: "idle" });
  const initialGenSettings = useMemo(getGenAppsSettingsSnapshot, []);
  const [genSettings, setGenSettings] = useState<GenAppsSettingsPayload>(
    initialGenSettings.settings,
  );
  const [genSettingsSaveError, setGenSettingsSaveError] = useState<string | null>(
    initialGenSettings.error,
  );
  const genSettingsRef = useRef(genSettings);

  // 加载 Gen Apps 设置
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeGenAppsSettings((snapshot) => {
      if (!cancelled) {
        genSettingsRef.current = snapshot.settings;
        setGenSettings(snapshot.settings);
        setGenSettingsSaveError(snapshot.error);
      }
    });
    void hydrateGenAppsSettings(async () => (await fetchGenAppsSettings()).settings)
      .catch((error: unknown) => {
        if (!cancelled) {
          setGenSettingsSaveError(
            error instanceof Error ? error.message : String(error),
          );
        }
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  /** 本地即时更新 + 300ms 防抖持久化 */
  function updateGenSettings(patch: Partial<GenAppsSettingsPayload>) {
    const next = { ...genSettingsRef.current, ...patch };
    genSettingsRef.current = next;
    stageGenAppsSettings(
      patch,
      async (settings) => (await saveGenAppsSettings(settings)).settings,
    );
  }

  function creativityTierKey(v: number): string {
    if (v <= 25) return "genapps.tier.system";
    if (v <= 50) return "genapps.tier.appstore";
    if (v <= 75) return "genapps.tier.indie";
    return "genapps.tier.fantasy";
  }

  const officialProviders = useMemo(
    () => providers.filter((p) => !isCustomProvider(p.id)),
    [providers],
  );

  const currentOfficialMeta = useMemo(
    () =>
      providers.find((p) => p.id === provider) ??
      officialProviders[0] ??
      providers[0],
    [providers, provider, officialProviders],
  );

  const currentProtocolMeta = useMemo(
    () => protocols.find((p) => p.id === protocol) ?? protocols[0],
    [protocols, protocol],
  );

  const currentProfile = useMemo(
    () => profiles.find((p) => p.id === profile) ?? profiles[0],
    [profiles, profile],
  );

  const modelOptions = useMemo(() => {
    if (mode === "official") return currentOfficialMeta?.suggestedModels ?? [];
    if (currentProfile?.suggestedModels?.length) {
      return currentProfile.suggestedModels;
    }
    return [];
  }, [mode, currentOfficialMeta, currentProfile]);

  const needsApiKey = mode === "official" || authStyle !== "none";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await fetchLlmSettings();
        if (cancelled) return;
        applyLoaded(settings);
        setStatus(
          settings.hasApiKey
            ? t("custom.status.loaded.configured", { provider: settings.provider, model: settings.model })
            : t("custom.status.loaded.mock"),
        );
      } catch (error) {
        if (cancelled) return;
        setStatus(error instanceof Error ? error.message : t("custom.status.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function applyLoaded(settings: LlmSettingsPublic) {
    setProviders(settings.providers);
    setProtocols(settings.protocols ?? []);
    setProfiles(settings.profiles ?? []);
    const custom = isCustomProvider(settings.provider);
    setMode(custom ? "custom" : "official");
    setProvider(
      custom ? pickDefaultOfficial(settings.providers) : settings.provider,
    );
    setProfile(settings.profile || "custom");
    setProtocol(settings.protocol || "openai-compatible");
    setAuthStyle(settings.authStyle || "bearer");
    setReasoningEffort(settings.reasoningEffort || "off");
    setModel(settings.model);
    setBaseUrl(settings.baseUrl);
    setHasApiKey(settings.hasApiKey);
    setApiKeyPreview(settings.apiKeyPreview);
    setApiKey("");
    setApiKeyDirty(false);
    setTestState({ kind: "idle" });
  }

  function switchMode(next: AccessMode) {
    if (next === mode) return;
    setMode(next);
    setTestState({ kind: "idle" });
    if (next === "custom") {
      setProvider("openai-compatible");
      const first =
        profiles.find((p) => p.id === "deepseek") ||
        profiles.find((p) => p.id === "custom") ||
        profiles[0];
      if (first) applyProfile(first);
    } else {
      const nextProvider = pickDefaultOfficial(providers);
      const meta = providers.find((p) => p.id === nextProvider);
      setProvider(nextProvider);
      setProfile("");
      if (meta) {
        setModel(meta.defaultModel);
        setBaseUrl(meta.defaultBaseUrl);
      }
    }
  }

  function applyProfile(item: LlmCompatibleProfile) {
    setProfile(item.id);
    setProtocol(item.protocol);
    setAuthStyle(item.authStyle);
    if (item.baseUrl) setBaseUrl(item.baseUrl);
    if (item.defaultModel) setModel(item.defaultModel);
    setTestState({ kind: "idle" });
  }

  function onOfficialProviderChange(next: LlmProviderId) {
    setProvider(next);
    setTestState({ kind: "idle" });
    const meta = providers.find((p) => p.id === next);
    if (!meta) return;
    setModel(meta.defaultModel);
    setBaseUrl(meta.defaultBaseUrl);
  }

  function onProtocolChange(next: LlmProtocolId) {
    setProtocol(next);
    setTestState({ kind: "idle" });
    // 切协议时若当前仍是某预设，退回 custom，避免协议/预设不一致
    if (profile !== "custom") setProfile("custom");
    const meta = protocols.find((p) => p.id === next);
    if (meta) {
      setAuthStyle(meta.defaultAuthStyle);
      if (!baseUrl || profiles.some((p) => p.baseUrl === baseUrl)) {
        setBaseUrl(meta.defaultBaseUrl);
      }
    }
  }

  function buildPayload() {
    if (mode === "custom") {
      return {
        provider: "openai-compatible" as LlmProviderId,
        model: model.trim(),
        baseUrl: baseUrl.trim(),
        protocol,
        authStyle,
        profile: profile || "custom",
        reasoningEffort,
        ...(apiKeyDirty ? { apiKey: apiKey.trim() } : {}),
      };
    }
    const meta = providers.find((p) => p.id === provider);
    return {
      provider,
      model: model.trim() || meta?.defaultModel || "",
      baseUrl: meta?.defaultBaseUrl || baseUrl.trim(),
      reasoningEffort,
      ...(apiKeyDirty ? { apiKey: apiKey.trim() } : {}),
    };
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const payload = buildPayload();
    if (!payload.model) {
      setStatus(t("custom.error.modelRequired"));
      return;
    }
    if (mode === "custom" && !payload.baseUrl) {
      setStatus(t("custom.error.baseUrlRequired"));
      return;
    }

    setSaving(true);
    try {
      const next = await saveLlmSettings(payload);
      applyLoaded(next);
      setStatus(t("custom.status.saved"));
      onSaved?.(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("custom.status.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    if (testState.kind === "running") return;
    const payload = buildPayload();
    if (!payload.model) {
      setTestState({ kind: "error", text: t("custom.test.modelFirst") });
      return;
    }
    if (mode === "custom" && !payload.baseUrl) {
      setTestState({ kind: "error", text: t("custom.test.baseUrlFirst") });
      return;
    }
    if (needsApiKey && !hasApiKey && !apiKey.trim()) {
      setTestState({ kind: "error", text: t("custom.test.keyFirst") });
      return;
    }

    setTestState({ kind: "running" });
    try {
      const result = await testLlmSettings({
        provider: payload.provider,
        model: payload.model,
        baseUrl: payload.baseUrl,
        protocol: "protocol" in payload ? payload.protocol : undefined,
        authStyle: "authStyle" in payload ? payload.authStyle : undefined,
        profile: "profile" in payload ? payload.profile : undefined,
        reasoningEffort,
        ...(apiKeyDirty && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      if (result.ok) {
        setTestState({
          kind: "ok",
          text: `${t("custom.test.ok", { provider: result.provider, model: result.model, latency: result.latencyMs })}\n${(result.content ?? "").slice(0, 160)}`,
        });
      } else {
        setTestState({
          kind: "error",
          text: t("custom.test.fail", { code: result.error?.code ?? "error", message: result.error?.message ?? t("custom.test.failFallback") }),
        });
      }
    } catch (error) {
      setTestState({
        kind: "error",
        text: error instanceof Error ? error.message : t("custom.test.failed"),
      });
    }
  }

  const busy = saving || testState.kind === "running";

  // 预设分组：本地 / 国内 / 海外 / 协议代理
  const profileGroups = useMemo(() => {
    const localIds = new Set(["ollama", "lmstudio", "vllm", "oneapi"]);
    const cnIds = new Set([
      "deepseek",
      "siliconflow",
      "moonshot",
      "zhipu",
      "dashscope",
      "volcengine",
    ]);
    const proxyIds = new Set([
      "openai-proxy",
      "openai-responses",
      "anthropic-proxy",
      "gemini-proxy",
    ]);
    const groups: Array<{ label: string; items: LlmCompatibleProfile[] }> = [
      { label: t("profiles.group.preset"), items: [] },
      { label: t("profiles.group.local"), items: [] },
      { label: t("profiles.group.cn"), items: [] },
      { label: t("profiles.group.overseas"), items: [] },
      { label: t("profiles.group.proxy"), items: [] },
    ];
    for (const item of profiles) {
      if (item.id === "custom") groups[0].items.push(item);
      else if (localIds.has(item.id)) groups[1].items.push(item);
      else if (cnIds.has(item.id)) groups[2].items.push(item);
      else if (proxyIds.has(item.id)) groups[4].items.push(item);
      else groups[3].items.push(item);
    }
    return groups.filter((g) => g.items.length > 0);
  }, [profiles]);

  const NAV_ITEMS: Array<{
    id: SettingsTab;
    label: string;
    icon: string;
    tint: string;
  }> = [
    { id: "providers", label: t("settings.tab.providers"), icon: "\u{1F310}", tint: "#0a84ff" },
    { id: "genapps", label: t("settings.tab.genapps"), icon: "\u2728", tint: "#bf5af2" },
    { id: "general", label: t("settings.tab.general"), icon: "\u25D2", tint: "#5e5ce6" },
  ];

  /**
   * \u53EF\u641C\u7D22\u8BBE\u7F6E\u7D22\u5F15\uFF1A\u5927\u680F\u4F4D\uFF08\u9875\u7B7E\uFF09+ \u5C0F\u680F\u4F4D\uFF08\u8BBE\u7F6E\u9879\uFF09+ \u63CF\u8FF0\u3002
   * \u547D\u4E2D\u5373\u8DF3\u8F6C\u5BF9\u5E94\u9875\u7B7E\uFF1B\u6761\u76EE\u6587\u6848\u968F\u8BED\u8A00\u5B9E\u65F6\u751F\u6210\u3002
   */
  const searchIndex = useMemo<
    Array<{ tab: SettingsTab; section: string; label: string; description: string }>
  >(() => {
    const providersLabel = t("settings.tab.providers");
    const customLabel = t("settings.tab.custom");
    const generalLabel = t("settings.tab.general");
    const entries: Array<{
      tab: SettingsTab;
      section: string;
      label: string;
      description: string;
    }> = [
      // \u5927\u680F\u4F4D\u672C\u8EAB
      { tab: "providers", section: providersLabel, label: providersLabel, description: t("providers.flowHint") },
      { tab: "model", section: customLabel, label: t("custom.title"), description: t("custom.subtitle") },
      { tab: "general", section: generalLabel, label: generalLabel, description: t("general.language.hint") },
      // Providers \u5C0F\u680F\u4F4D
      { tab: "providers", section: providersLabel, label: t("providers.connected"), description: t("providers.empty") },
      { tab: "providers", section: providersLabel, label: t("providers.popular"), description: "" },
      { tab: "providers", section: providersLabel, label: t("providers.all"), description: t("providers.search.placeholder") },
      { tab: "providers", section: providersLabel, label: t("providers.selectModel"), description: t("connect.model.help") },
      { tab: "providers", section: providersLabel, label: "OAuth / API Key", description: t("connect.methods.help", { label: "" }) },
      // Custom \u5C0F\u680F\u4F4D
      { tab: "model", section: customLabel, label: t("custom.preset"), description: t("profiles.group.local") + " / " + t("profiles.group.cn") + " / " + t("profiles.group.overseas") },
      { tab: "model", section: customLabel, label: t("custom.protocol"), description: t("custom.protocol.hint") },
      { tab: "model", section: customLabel, label: t("custom.model"), description: t("custom.model.placeholder") },
      { tab: "model", section: customLabel, label: t("custom.baseUrl"), description: t("custom.baseUrl.hint") },
      { tab: "model", section: customLabel, label: t("custom.authStyle"), description: t("custom.auth.bearer") + " / " + t("custom.auth.xApiKey") + " / " + t("custom.auth.none") },
      { tab: "model", section: customLabel, label: t("custom.apiKey"), description: t("custom.apiKey.placeholder") },
      { tab: "model", section: customLabel, label: t("custom.reasoning"), description: t("custom.reasoning.hint") },
      { tab: "model", section: customLabel, label: t("common.testConnection"), description: t("custom.test.running") },
      // General \u5C0F\u680F\u4F4D
      { tab: "general", section: generalLabel, label: t("general.language"), description: t("general.language.hint") },
      { tab: "general", section: generalLabel, label: t("general.appearance"), description: t("general.appearance.hint") },
    ];
    // \u63D0\u4F9B\u5546\u540D\u4E5F\u53EF\u641C\uFF08\u8DF3 Providers\uFF09
    for (const p of providers) {
      entries.push({
        tab: "providers",
        section: providersLabel,
        label: p.label,
        description: p.description ?? p.id,
      });
    }
    return entries;
  }, [t, providers]);

  const searchResults = useMemo(() => {
    const q = navQuery.trim().toLowerCase();
    if (!q) return [];
    return searchIndex
      .filter(
        (e) =>
          e.label.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.section.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [navQuery, searchIndex]);

  return (
    <div className="settings-panel settings-macos">
      {/* 左侧栏：仿 macOS System Settings（搜索 + 彩色图标条目） */}
      <aside className="settings-nav">
        <div className="settings-nav-search">
          <svg
            aria-hidden
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <circle cx="7" cy="7" r="4.4" />
            <line x1="10.4" y1="10.4" x2="14" y2="14" />
          </svg>
          <input
            value={navQuery}
            onChange={(e) => setNavQuery(e.target.value)}
            placeholder={t("settings.search")}
            aria-label={t("settings.search")}
          />
          {navQuery ? (
            <button
              type="button"
              className="settings-nav-search-clear"
              aria-label={t("common.clear")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setNavQuery("")}
            >
              <svg
                aria-hidden
                width="8"
                height="8"
                viewBox="0 0 8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              >
                <line x1="1" y1="1" x2="7" y2="7" />
                <line x1="7" y1="1" x2="1" y2="7" />
              </svg>
            </button>
          ) : null}
        </div>
        {navQuery.trim() ? (
          <div className="settings-search-results" role="listbox">
            {searchResults.length === 0 ? (
              <div className="settings-search-empty">
                <svg
                  aria-hidden
                  width="26"
                  height="26"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                >
                  <circle cx="7" cy="7" r="4.4" />
                  <line x1="10.4" y1="10.4" x2="14" y2="14" />
                </svg>
                <span className="settings-search-empty-title">
                  {t("settings.search.emptyTitle", { query: navQuery.trim() })}
                </span>
                <span className="settings-search-empty-hint">
                  {t("settings.search.emptyHint")}
                </span>
              </div>
            ) : (
              searchResults.map((r, i) => (
                <button
                  key={`${r.tab}-${r.label}-${i}`}
                  type="button"
                  className="settings-search-result"
                  onClick={() => {
                    setTab(r.tab === "model" ? "providers" : r.tab);
                    if (r.tab === "model" && mode !== "custom") switchMode("custom");
                    setNavQuery("");
                  }}
                >
                  <span className="ssr-label">{r.label}</span>
                  <span className="ssr-desc">
                    {r.section}
                    {r.description ? ` · ${r.description}` : ""}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : (
          <nav>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings-nav-item ${tab === item.id ? "active" : ""}`}
                onClick={() => {
                  setTab(item.id);
                  if (item.id === "model" && mode !== "custom") switchMode("custom");
                }}
              >
                <span
                  className="settings-nav-icon"
                  style={{ background: item.tint }}
                  aria-hidden
                >
                  {item.icon}
                </span>
                <span className="settings-nav-label">{item.label}</span>
              </button>
            ))}
          </nav>
        )}
      </aside>

      <div className="settings-content">

      {tab === "genapps" ? (
        <div className="settings-form">
          <header className="settings-header">
            <div>
              <h2>{t("genapps.title")}</h2>
              <p className="settings-subtitle">{t("genapps.subtitle")}</p>
            </div>
          </header>

          {genSettingsSaveError ? (
            <div className="settings-test-banner error" role="alert">
              {t("genapps.settings.saveError")} {genSettingsSaveError}
            </div>
          ) : null}

          <section className="settings-section settings-card">
            {/* 生成偏好滑杆：系统工具 → 商店应用 → 独立开发 → 天马行空 */}
            <label className="field">
              <span>
                {t("genapps.creativity")} ·{" "}
                <strong>{t(creativityTierKey(genSettings.creativity))}</strong>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={genSettings.creativity}
                onChange={(e) =>
                  updateGenSettings({ creativity: Number(e.target.value) })
                }
                className="genapps-slider"
              />
              <div className="genapps-slider-marks">
                <span>{t("genapps.tier.system")}</span>
                <span>{t("genapps.tier.appstore")}</span>
                <span>{t("genapps.tier.indie")}</span>
                <span>{t("genapps.tier.fantasy")}</span>
              </div>
              <span className="field-hint">{t("genapps.creativity.hint")}</span>
            </label>

            {/* 候选数量 */}
            <label className="field">
              <span>
                {t("genapps.count")} · <strong>{genSettings.suggestionCount}</strong>
              </span>
              <input
                type="range"
                min={2}
                max={12}
                step={1}
                value={genSettings.suggestionCount}
                onChange={(e) =>
                  updateGenSettings({ suggestionCount: Number(e.target.value) })
                }
                className="genapps-slider"
              />
              <span className="field-hint">{t("genapps.count.hint")}</span>
            </label>

            {/* 生成应用界面语言 */}
            <label className="field">
              <span>{t("genapps.language")}</span>
              <select
                value={genSettings.appLanguage}
                onChange={(e) =>
                  updateGenSettings({
                    appLanguage: e.target.value as GenAppsSettingsPayload["appLanguage"],
                  })
                }
              >
                <option value="auto">{t("genapps.language.auto")}</option>
                <option value="zh">{t("genapps.language.zh")}</option>
                <option value="en">{t("genapps.language.en")}</option>
              </select>
              <span className="field-hint">{t("genapps.language.hint")}</span>
            </label>

            {/* 生成模式：快速单发 / 精修循环 */}
            <label className="field">
              <span>{t("genapps.mode")}</span>
              <div className="mode-switch" role="group" aria-label={t("genapps.mode")}>
                <button
                  type="button"
                  className={`mode-chip ${genSettings.generationMode === "fast" ? "active" : ""}`}
                  onClick={() => updateGenSettings({ generationMode: "fast" })}
                >
                  {t("genapps.mode.fast")}
                </button>
                <button
                  type="button"
                  className={`mode-chip ${genSettings.generationMode === "agentic" ? "active" : ""}`}
                  onClick={() => updateGenSettings({ generationMode: "agentic" })}
                >
                  {t("genapps.mode.agentic")}
                </button>
              </div>
              <span className="field-hint">{t("genapps.mode.hint")}</span>
            </label>

            {genSettings.generationMode === "agentic" ? (
              <label className="field">
                <span>
                  {t("genapps.rounds")} ·{" "}
                  <strong>{genSettings.agentMaxRounds}</strong>
                </span>
                <input
                  type="range"
                  min={2}
                  max={3}
                  step={1}
                  value={genSettings.agentMaxRounds}
                  onChange={(e) =>
                    updateGenSettings({ agentMaxRounds: Number(e.target.value) })
                  }
                  className="genapps-slider"
                />
                <span className="field-hint">{t("genapps.rounds.hint")}</span>
              </label>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === "general" ? (
        <div className="settings-form">
          <header className="settings-header">
            <div>
              <h2>{t("general.title")}</h2>
              <p className="settings-subtitle">{t("general.language.hint")}</p>
            </div>
          </header>
          <section className="settings-section settings-card">
            <label className="field">
              <span>{t("general.language")}</span>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as typeof locale)}
              >
                {LOCALE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>{t("general.appearance")}</span>
              <div className="appearance-switch" role="radiogroup">
                {(["light", "dark"] as ThemeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={theme === mode}
                    className={`appearance-option ${theme === mode ? "active" : ""}`}
                    onClick={() => setTheme(mode)}
                  >
                    <span className={`appearance-preview ${mode}`} aria-hidden>
                      <i className="ap-bar" />
                      <i className="ap-card" />
                    </span>
                    <span>
                      {mode === "light"
                        ? t("general.appearance.light")
                        : t("general.appearance.dark")}
                    </span>
                  </button>
                ))}
              </div>
              <span className="field-hint">{t("general.appearance.hint")}</span>
            </label>
          </section>
        </div>
      ) : null}

      {tab === "providers" ? (
        <div className="settings-subtabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "official"}
            className={`settings-subtab ${mode === "official" ? "active" : ""}`}
            onClick={() => {
              if (mode !== "official") switchMode("official");
            }}
          >
            {t("settings.tab.providers")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "custom"}
            className={`settings-subtab ${mode === "custom" ? "active" : ""}`}
            onClick={() => {
              if (mode !== "custom") switchMode("custom");
            }}
          >
            {t("settings.tab.custom")}
          </button>
        </div>
      ) : null}

      {tab === "providers" && mode === "official" ? (
        <ProvidersAuthApp
          onChanged={() => {
            void (async () => {
              try {
                const settings = await fetchLlmSettings();
                applyLoaded(settings);
                onSaved?.(settings);
              } catch {
                // ignore
              }
            })();
          }}
        />
      ) : null}

      {tab === "providers" && mode === "custom" && loading ? (
        <div className="settings-loading">{t("settings.loading")}</div>
      ) : null}

      {tab === "providers" && mode === "custom" && !loading ? (
        <form className="settings-form" onSubmit={onSubmit}>
          <header className="settings-header">
            <div>
              <h2>{t("custom.title")}</h2>
              <p className="settings-subtitle">
                {t("custom.subtitle")}
                {status ? ` · ${status}` : ""}
              </p>
            </div>
          </header>

          <section className="settings-section settings-card">
            {(
              <>
                <label className="field">
                  <span>{t("custom.preset")}</span>
                  <select
                    value={profile}
                    onChange={(e) => {
                      const item = profiles.find((p) => p.id === e.target.value);
                      if (item) applyProfile(item);
                      else setProfile(e.target.value);
                    }}
                    disabled={busy}
                  >
                    {profileGroups.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.items.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {currentProfile?.description ? (
                    <span className="field-hint">{currentProfile.description}</span>
                  ) : null}
                </label>

                <label className="field">
                  <span>{t("custom.protocol")}</span>
                  <select
                    value={protocol}
                    onChange={(e) =>
                      onProtocolChange(e.target.value as LlmProtocolId)
                    }
                    disabled={busy}
                  >
                    {protocols.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">
                    {currentProtocolMeta?.description ||
                      t("custom.protocol.hint")}
                  </span>
                </label>

                <label className="field">
                  <span>{t("custom.model")}</span>
                  <select
                    value={modelOptions.includes(model) ? model : "__custom__"}
                    onChange={(e) => {
                      const v = e.target.value;
                      setTestState({ kind: "idle" });
                      if (v === "__custom__") {
                        if (modelOptions.includes(model)) setModel("");
                        return;
                      }
                      setModel(v);
                    }}
                    disabled={busy}
                  >
                    {modelOptions.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    <option value="__custom__">{t("custom.model.custom")}</option>
                  </select>
                  {!modelOptions.includes(model) ? (
                    <input
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value);
                        setTestState({ kind: "idle" });
                      }}
                      placeholder={t("custom.model.placeholder")}
                      required
                      disabled={busy}
                    />
                  ) : null}
                </label>

                <label className="field">
                  <span>{t("custom.baseUrl")}</span>
                  <input
                    className="mono"
                    value={baseUrl}
                    onChange={(e) => {
                      setBaseUrl(e.target.value);
                      if (profile !== "custom") setProfile("custom");
                      setTestState({ kind: "idle" });
                    }}
                    placeholder="https://api.example.com/v1"
                    required
                    disabled={busy}
                  />
                  <span className="field-hint">
                    {t("custom.baseUrl.hint")}
                  </span>
                </label>

                <label className="field">
                  <span>{t("custom.authStyle")}</span>
                  <select
                    value={authStyle}
                    onChange={(e) => {
                      setAuthStyle(e.target.value as LlmAuthStyle);
                      if (profile !== "custom") setProfile("custom");
                      setTestState({ kind: "idle" });
                    }}
                    disabled={busy}
                  >
                    {AUTH_OPTION_IDS.map((id) => (
                      <option key={id} value={id}>
                        {t(AUTH_LABEL_KEYS[id])}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}

            {needsApiKey ? (
              <label className="field">
                <span>
                  API Key
                  {hasApiKey && !apiKeyDirty
                    ? t("custom.apiKey.saved", { preview: apiKeyPreview || "••••" })
                    : apiKeyDirty && !apiKey
                      ? t("custom.apiKey.willClear")
                      : ""}
                </span>
                <div className="field-row">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setApiKeyDirty(true);
                      setTestState({ kind: "idle" });
                    }}
                    placeholder={
                      hasApiKey && !apiKeyDirty
                        ? t("custom.apiKey.placeholder.override")
                        : mode === "custom"
                          ? currentProfile?.apiKeyHint ||
                            currentProtocolMeta?.apiKeyHint ||
                            t("custom.apiKey.placeholder")
                          : currentOfficialMeta?.apiKeyHint || t("custom.apiKey.placeholder")
                    }
                    autoComplete="off"
                    disabled={busy}
                  />
                  {hasApiKey || apiKeyDirty ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setApiKey("");
                        setApiKeyDirty(true);
                        setTestState({ kind: "idle" });
                      }}
                      disabled={busy}
                    >
                      {t("common.clear")}
                    </button>
                  ) : null}
                </div>

                {mode === "custom" && currentProfile?.docsUrl ? (
                  <a
                    className="field-link"
                    href={currentProfile.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("custom.apiKey.getKey", { label: currentProfile.label })}
                  </a>
                ) : null}
              </label>
            ) : (
              <p className="settings-help">
                {t("custom.noKeyHint")}
              </p>
            )}

            <label className="field">
              <span>{t("custom.reasoning")}</span>
              <select
                value={reasoningEffort}
                onChange={(e) => {
                  setReasoningEffort(e.target.value as LlmReasoningEffort);
                  setTestState({ kind: "idle" });
                }}
                disabled={busy}
              >
                {REASONING_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`reasoning.${id}`)}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                {t("custom.reasoning.hint")}
              </span>
            </label>
          </section>

          {testState.kind !== "idle" ? (
            <div
              className={`settings-test-banner ${
                testState.kind === "ok"
                  ? "ok"
                  : testState.kind === "error"
                    ? "error"
                    : "running"
              }`}
            >
              {testState.kind === "running" ? t("custom.test.running") : testState.text}
            </div>
          ) : null}

          <div className="settings-actions">
            <div className="settings-actions-left">
              {onClose ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onClose}
                  disabled={busy}
                >
                  {t("common.close")}
                </button>
              ) : null}
            </div>
            <div className="settings-actions-right">
              <button
                type="button"
                className="btn-test"
                onClick={() => void onTest()}
                disabled={busy}
              >
                {testState.kind === "running" ? t("common.testing") : t("common.testConnection")}
              </button>
              <button type="submit" disabled={busy || !model.trim()}>
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </form>
      ) : null}
      </div>
    </div>
  );
}
