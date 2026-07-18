/**
 * Gen Apps 线协议（传输契约层）。
 * 只承载 DTO / schema 校验 / 错误码 / 版本常量；
 * 不导出任何数据库 Row —— Storage Row 属于服务端 Repository Adapter。
 * 见 docs/gen-apps-design.md §6。
 */

// ===== 版本常量（集中定义，禁止散落 magic number）=====
export const GEN_APP_LEGACY_FORMAT = "html-single-file";
export const GEN_APP_FORMAT = "openos-markup";
export const GEN_APP_FORMATS = [GEN_APP_LEGACY_FORMAT, GEN_APP_FORMAT] as const;
export type GenAppArtifactFormat = (typeof GEN_APP_FORMATS)[number];
export const GEN_APP_FORMAT_VERSION = 2;
export const GEN_APP_RUNTIME_VERSION = 2;
export const GEN_APP_POLICY_VERSION = 2;
export const GEN_APP_PROMPT_VERSION = 2;
export const GEN_APP_UI_KIT_VERSION = 1;

export const GEN_APP_LIMITS = {
  /** HTML 制品最大字节数 */
  htmlMaxBytes: 512 * 1024,
  /** 单个声明式制品/片段允许挂载的最大元素节点数 */
  markupNodeMaxCount: 2_000,
  /** 单次生成超时（ms） */
  generateTimeoutMs: 60_000,
  /** 同时生成任务数（多标签页/桌面+浏览器共用一个 Bridge，1 会互相饿死） */
  maxConcurrentGenerations: 2,
  /** 已安装应用上限 */
  maxInstalledApps: 100,
  /** 单应用用户数据上限（bytes） */
  maxAppDataBytes: 1024 * 1024,
  /** 草稿 TTL（ms） */
  draftTtlMs: 24 * 60 * 60 * 1000,
  /** 建议数量 clamp */
  suggestionCountMin: 2,
  suggestionCountMax: 12,
  suggestionCountDefault: 6,
  /** 搜索词长度 */
  queryMinLength: 1,
  queryMaxLength: 120,
  /** 运行时续生成：频控（次/分钟/应用） */
  continueMaxPerMinute: 6,
  /** 运行时续生成：单次 fragment 字节上限 */
  continueMaxBytes: 256 * 1024,
  /** 运行时续生成：单次超时（ms） */
  continueTimeoutMs: 90_000,
  /** 运行时续生成：prompt / context 长度上限 */
  continuePromptMaxLength: 2_000,
  continueContextMaxLength: 4_000,
  /** 运行时续生成：会话 id / 目标元素当前 HTML 长度上限（update intent） */
  continueSessionIdMaxLength: 80,
  continueCurrentHtmlMaxLength: 8_000,
  /** 会话记忆：每会话最多保留的 user/assistant 轮次对 */
  continueSessionMaxTurns: 6,
  /** 会话记忆：单轮存入历史的字符上限（超出截断，仅影响后续上下文，不影响当次返回） */
  continueSessionHistoryCharsPerTurn: 4_000,
  /** 会话记忆：进程内最多同时保留的会话数（超出淘汰最旧） */
  continueSessionMaxCount: 300,
  /** 会话记忆：闲置多久回收（ms） */
  continueSessionTtlMs: 30 * 60 * 1000,
  /** V2 局部补丁 */
  runtimePatchMaxBytes: 32 * 1024,
  runtimeEventValueMaxLength: 2_000,
  runtimeInteractMaxPerMinute: 30,
  runtimeSessionMaxCount: 300,
  runtimeSessionTtlMs: 30 * 60 * 1000,
  runtimeSessionMaxTurns: 6,
  runtimeSessionHistoryCharsPerTurn: 4_000,
} as const;

export const GEN_APP_LOCAL_ACTIONS = [
  "tabs.select",
  "toggle",
  "modal.open",
  "modal.close",
  "list.select",
  "list.add",
  "list.remove",
  "list.toggle",
  "filter",
  "sort",
  "counter.increment",
  "counter.decrement",
  "calc.input",
  "calc.evaluate",
  "calc.clear",
  "calc.backspace",
  "state.set",
  "toast",
  "ai.generate",
  "ai.patch",
] as const;

export type GenAppLocalAction = (typeof GEN_APP_LOCAL_ACTIONS)[number];

export function isGenAppLocalAction(value: unknown): value is GenAppLocalAction {
  return (
    typeof value === "string" &&
    (GEN_APP_LOCAL_ACTIONS as readonly string[]).includes(value)
  );
}

export type GenAppInteractionMode = "hybrid" | "improv";

export type GenAppDeclaredAction = {
  elementId: string;
  action: GenAppLocalAction;
  targetId?: string;
};

/** 运行时续生成 intent（服务端据此选提示词模板） */
export const GEN_APP_CONTINUE_INTENTS = [
  "browse",
  "panel",
  "search",
  "content",
  "update",
] as const;

export type GenAppContinueIntent = (typeof GEN_APP_CONTINUE_INTENTS)[number];

export function isGenAppContinueIntent(v: unknown): v is GenAppContinueIntent {
  return (
    typeof v === "string" &&
    (GEN_APP_CONTINUE_INTENTS as readonly string[]).includes(v)
  );
}

/** 图标主题 token（受限集合，不接受任意 CSS） */
export const GEN_APP_ICON_THEMES = [
  "blue",
  "purple",
  "pink",
  "orange",
  "green",
  "teal",
  "graphite",
  "red",
] as const;

export type GenAppIconTheme = (typeof GEN_APP_ICON_THEMES)[number];

export function isGenAppIconTheme(value: unknown): value is GenAppIconTheme {
  return (
    typeof value === "string" &&
    (GEN_APP_ICON_THEMES as readonly string[]).includes(value)
  );
}

// ===== 错误码 =====
export const GEN_APP_ERROR_CODES = [
  "validation_failed",
  "llm_not_configured",
  "generation_timeout",
  "invalid_model_output",
  "artifact_rejected",
  "draft_not_found",
  "invalid_transition",
  "app_not_found",
  "storage_quota_exceeded",
  "internal_error",
] as const;

export type GenAppErrorCode = (typeof GEN_APP_ERROR_CODES)[number];

export type GenAppApiError = {
  error: {
    code: GenAppErrorCode;
    message: string;
    requestId: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};

// ===== 传输 DTO =====

/** 短生命周期候选（opaque id；iconTheme 为受限 token） */
export type GenAppSuggestion = {
  id: string;
  name: string;
  description: string;
  iconEmoji: string;
  iconTheme: GenAppIconTheme;
};

/** 启动台所需元数据（不含 HTML） */
export type GenAppSummary = {
  id: string;
  name: string;
  description: string;
  iconEmoji: string;
  iconTheme: GenAppIconTheme;
  category: string;
  createdAt: number;
  installedAt: number | null;
  openedAt: number | null;
};

/** 版本化制品（draft / launch 时返回） */
export type GenAppArtifact = {
  appId: string;
  revision: number;
  format: GenAppArtifactFormat;
  formatVersion: number;
  runtimeVersion: number;
  policyVersion: number;
  /** V1 完整文档；V2 为带 UI Kit 的兼容回退文档 */
  html: string;
  /** V2 声明式正文。V1 不存在。 */
  markup?: string;
  actions?: GenAppDeclaredAction[];
  kitVersion?: number;
  interactionMode?: GenAppInteractionMode;
  contentSha256: string;
  sizeBytes: number;
};

export type GenAppDraft = {
  summary: GenAppSummary;
  artifact: GenAppArtifact;
  draftExpiresAt: number;
  runtimeSessionId: string;
};

export type GenAppLaunchBundle = {
  summary: GenAppSummary;
  artifact: GenAppArtifact;
  runtimeSessionId: string;
};

export type GenAppRuntimeEvent = {
  type: "click" | "input" | "change";
  targetId: string;
  action: string;
  value?: string;
  checked?: boolean;
  currentHtml?: string;
};

export type GenAppPatchOperation = {
  op: "replace";
  targetId: string;
  html: string;
};

export type GenAppPatchBatch = {
  baseRevision: number;
  revision: number;
  ops: [GenAppPatchOperation];
};

export type GenAppInteractRequest = {
  runtimeSessionId: string;
  baseRevision: number;
  event: GenAppRuntimeEvent;
};

export type GenAppInteractResponse = {
  patch: GenAppPatchBatch;
  requestId: string;
};

export type GenAppRuntimeResumeRequest = {
  runtimeSessionId: string;
  revision: number;
  markup: string;
  interactionMode: GenAppInteractionMode;
};

export type GenAppRuntimeResumeResponse = GenAppRuntimeResumeRequest & {
  requestId: string;
};

// ===== 请求 =====

export type GenAppSuggestRequest = {
  query: string;
  count?: number;
};

export type GenAppSuggestResponse = {
  suggestions: GenAppSuggestion[];
  requestId: string;
};

export type GenAppGenerateDraftRequest = {
  suggestion: GenAppSuggestion;
  query: string;
  idempotencyKey: string;
};

export type GenAppGenerateDraftResponse = {
  draft: GenAppDraft;
  requestId: string;
};

export type GenAppInstallResponse = {
  summary: GenAppSummary;
  requestId: string;
};

export type GenAppListResponse = {
  apps: GenAppSummary[];
  requestId: string;
};

export type GenAppLaunchResponse = {
  bundle: GenAppLaunchBundle;
  requestId: string;
};

export type GenAppLanguage = "auto" | "zh" | "en";
export type GenAppGenerationMode = "fast" | "agentic";

export type GenAppsSettings = {
  suggestionCount: number;
  creativity: number;
  appLanguage: GenAppLanguage;
  generationMode: GenAppGenerationMode;
  agentMaxRounds: number;
};

export const GEN_APP_DEFAULT_SETTINGS: GenAppsSettings = {
  suggestionCount: GEN_APP_LIMITS.suggestionCountDefault,
  creativity: 25,
  appLanguage: "auto",
  generationMode: "agentic",
  agentMaxRounds: 3,
};

export type GenAppsSettingsResponse = {
  settings: GenAppsSettings;
};

// ===== 运行时 schema 校验（不能只靠 TS 强转）=====

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown, max = 500): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

export function clampSuggestionCount(value: unknown): number {
  const n = typeof value === "number" ? Math.floor(value) : Number.NaN;
  if (!Number.isFinite(n)) return GEN_APP_LIMITS.suggestionCountDefault;
  return Math.min(
    GEN_APP_LIMITS.suggestionCountMax,
    Math.max(GEN_APP_LIMITS.suggestionCountMin, n),
  );
}

export function parseGenAppsSettings(value: unknown): GenAppsSettings | null {
  if (!isRecord(value)) return null;
  const creativity =
    typeof value.creativity === "number" && Number.isFinite(value.creativity)
      ? Math.min(100, Math.max(0, Math.round(value.creativity)))
      : GEN_APP_DEFAULT_SETTINGS.creativity;
  const agentMaxRounds =
    typeof value.agentMaxRounds === "number" && Number.isFinite(value.agentMaxRounds)
      ? Math.min(10, Math.max(0, Math.round(value.agentMaxRounds)))
      : GEN_APP_DEFAULT_SETTINGS.agentMaxRounds;
  return {
    suggestionCount: clampSuggestionCount(value.suggestionCount),
    creativity,
    appLanguage:
      value.appLanguage === "zh" || value.appLanguage === "en"
        ? value.appLanguage
        : "auto",
    generationMode: value.generationMode === "fast" ? "fast" : "agentic",
    agentMaxRounds,
  };
}

export function parseGenAppSuggestion(v: unknown): GenAppSuggestion | null {
  if (!isRecord(v)) return null;
  if (!isNonEmptyString(v.id, 80)) return null;
  if (!isNonEmptyString(v.name, 60)) return null;
  if (typeof v.description !== "string" || v.description.length > 300) return null;
  if (!isNonEmptyString(v.iconEmoji, 16)) return null;
  if (!isGenAppIconTheme(v.iconTheme)) return null;
  return {
    id: v.id,
    name: v.name.trim(),
    description: v.description,
    iconEmoji: v.iconEmoji,
    iconTheme: v.iconTheme,
  };
}

export function parseGenAppSummary(v: unknown): GenAppSummary | null {
  if (!isRecord(v)) return null;
  if (!isNonEmptyString(v.id, 80)) return null;
  if (!isNonEmptyString(v.name, 60)) return null;
  if (typeof v.description !== "string") return null;
  if (!isNonEmptyString(v.iconEmoji, 16)) return null;
  if (!isGenAppIconTheme(v.iconTheme)) return null;
  if (typeof v.category !== "string") return null;
  if (typeof v.createdAt !== "number") return null;
  const installedAt = v.installedAt === null || typeof v.installedAt === "number" ? (v.installedAt as number | null) : null;
  const openedAt = v.openedAt === null || typeof v.openedAt === "number" ? (v.openedAt as number | null) : null;
  return {
    id: v.id,
    name: v.name,
    description: v.description,
    iconEmoji: v.iconEmoji,
    iconTheme: v.iconTheme,
    category: v.category,
    createdAt: v.createdAt,
    installedAt,
    openedAt,
  };
}

export function parseGenAppArtifact(v: unknown): GenAppArtifact | null {
  if (!isRecord(v)) return null;
  if (!isNonEmptyString(v.appId, 80)) return null;
  if (typeof v.revision !== "number") return null;
  if (!(GEN_APP_FORMATS as readonly unknown[]).includes(v.format)) return null;
  if (typeof v.formatVersion !== "number") return null;
  if (typeof v.runtimeVersion !== "number") return null;
  if (typeof v.policyVersion !== "number") return null;
  if (typeof v.html !== "string") return null;
  if (!isNonEmptyString(v.contentSha256, 80)) return null;
  if (typeof v.sizeBytes !== "number") return null;
  const format = v.format as GenAppArtifactFormat;
  const markup = typeof v.markup === "string" ? v.markup : undefined;
  if (format === GEN_APP_LEGACY_FORMAT && v.html.length === 0) return null;
  if (format === GEN_APP_FORMAT && (!markup || markup.length > GEN_APP_LIMITS.htmlMaxBytes)) {
    return null;
  }
  const interactionMode: GenAppInteractionMode | undefined =
    v.interactionMode === "hybrid" || v.interactionMode === "improv"
      ? v.interactionMode
      : undefined;
  const actions = Array.isArray(v.actions)
    ? v.actions
        .map((entry): GenAppDeclaredAction | null => {
          if (!isRecord(entry)) return null;
          if (!isNonEmptyString(entry.elementId, 120)) return null;
          if (!isGenAppLocalAction(entry.action)) return null;
          return {
            elementId: entry.elementId,
            action: entry.action,
            targetId:
              typeof entry.targetId === "string" ? entry.targetId : undefined,
          };
        })
        .filter((entry): entry is GenAppDeclaredAction => entry !== null)
    : undefined;
  return {
    appId: v.appId,
    revision: v.revision,
    format,
    formatVersion: v.formatVersion,
    runtimeVersion: v.runtimeVersion,
    policyVersion: v.policyVersion,
    html: v.html,
    markup,
    actions,
    kitVersion: typeof v.kitVersion === "number" ? v.kitVersion : undefined,
    interactionMode,
    contentSha256: v.contentSha256,
    sizeBytes: v.sizeBytes,
  };
}

export function parseGenAppRuntimeEvent(value: unknown): GenAppRuntimeEvent | null {
  if (!isRecord(value)) return null;
  if (value.type !== "click" && value.type !== "input" && value.type !== "change") {
    return null;
  }
  if (!isNonEmptyString(value.targetId, 120)) return null;
  if (!isNonEmptyString(value.action, 120)) return null;
  const stringValue =
    typeof value.value === "string"
      ? value.value.slice(0, GEN_APP_LIMITS.runtimeEventValueMaxLength)
      : undefined;
  const currentHtml =
    typeof value.currentHtml === "string"
      ? value.currentHtml.slice(0, GEN_APP_LIMITS.continueCurrentHtmlMaxLength)
      : undefined;
  return {
    type: value.type,
    targetId: value.targetId,
    action: value.action,
    value: stringValue,
    checked: typeof value.checked === "boolean" ? value.checked : undefined,
    currentHtml,
  };
}

export function parseGenAppPatchBatch(value: unknown): GenAppPatchBatch | null {
  if (!isRecord(value)) return null;
  if (
    !Number.isInteger(value.baseRevision) ||
    !Number.isInteger(value.revision) ||
    (value.baseRevision as number) < 0 ||
    value.revision !== (value.baseRevision as number) + 1
  ) {
    return null;
  }
  if (!Array.isArray(value.ops) || value.ops.length !== 1) return null;
  const operation = value.ops[0];
  if (!isRecord(operation) || operation.op !== "replace") return null;
  if (!isNonEmptyString(operation.targetId, 120)) return null;
  if (!isNonEmptyString(operation.html, GEN_APP_LIMITS.runtimePatchMaxBytes)) {
    return null;
  }
  return {
    baseRevision: value.baseRevision as number,
    revision: value.revision as number,
    ops: [
      {
        op: "replace",
        targetId: operation.targetId,
        html: operation.html,
      },
    ],
  };
}

export function parseGenAppInteractRequest(value: unknown): GenAppInteractRequest | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.runtimeSessionId, 120)) return null;
  if (!Number.isInteger(value.baseRevision) || (value.baseRevision as number) < 0) {
    return null;
  }
  const event = parseGenAppRuntimeEvent(value.event);
  if (!event) return null;
  return {
    runtimeSessionId: value.runtimeSessionId,
    baseRevision: value.baseRevision as number,
    event,
  };
}

export function parseGenAppRuntimeResumeRequest(
  value: unknown,
): GenAppRuntimeResumeRequest | null {
  if (!isRecord(value)) return null;
  if (!isNonEmptyString(value.runtimeSessionId, 120)) return null;
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) return null;
  if (!isNonEmptyString(value.markup, GEN_APP_LIMITS.htmlMaxBytes)) return null;
  if (value.interactionMode !== "hybrid" && value.interactionMode !== "improv") {
    return null;
  }
  return {
    runtimeSessionId: value.runtimeSessionId,
    revision: value.revision as number,
    markup: value.markup,
    interactionMode: value.interactionMode,
  };
}

export function parseGenAppError(v: unknown): GenAppApiError["error"] | null {
  if (!isRecord(v) || !isRecord(v.error)) return null;
  const e = v.error;
  const code = (GEN_APP_ERROR_CODES as readonly string[]).includes(
    e.code as string,
  )
    ? (e.code as GenAppErrorCode)
    : "internal_error";
  return {
    code,
    message: typeof e.message === "string" ? e.message : "Unknown error",
    requestId: typeof e.requestId === "string" ? e.requestId : "",
    retryable: Boolean(e.retryable),
    details: isRecord(e.details) ? e.details : undefined,
  };
}
