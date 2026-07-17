/**
 * Gen Apps 线协议（传输契约层）。
 * 只承载 DTO / schema 校验 / 错误码 / 版本常量；
 * 不导出任何数据库 Row —— Storage Row 属于服务端 Repository Adapter。
 * 见 docs/gen-apps-design.md §6。
 */

// ===== 版本常量（集中定义，禁止散落 magic number）=====
export const GEN_APP_FORMAT = "html-single-file";
export const GEN_APP_FORMAT_VERSION = 1;
export const GEN_APP_RUNTIME_VERSION = 1;
export const GEN_APP_POLICY_VERSION = 1;
export const GEN_APP_PROMPT_VERSION = 1;

export const GEN_APP_LIMITS = {
  /** HTML 制品最大字节数 */
  htmlMaxBytes: 512 * 1024,
  /** 单次生成超时（ms） */
  generateTimeoutMs: 60_000,
  /** 同时生成任务数 */
  maxConcurrentGenerations: 1,
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
} as const;

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
  format: typeof GEN_APP_FORMAT;
  formatVersion: number;
  runtimeVersion: number;
  policyVersion: number;
  html: string;
  contentSha256: string;
  sizeBytes: number;
};

export type GenAppDraft = {
  summary: GenAppSummary;
  artifact: GenAppArtifact;
  draftExpiresAt: number;
};

export type GenAppLaunchBundle = {
  summary: GenAppSummary;
  artifact: GenAppArtifact;
  runtimeSessionId: string;
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

export type GenAppsSettings = {
  suggestionCount: number;
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
  if (v.format !== GEN_APP_FORMAT) return null;
  if (typeof v.formatVersion !== "number") return null;
  if (typeof v.runtimeVersion !== "number") return null;
  if (typeof v.policyVersion !== "number") return null;
  if (typeof v.html !== "string" || v.html.length === 0) return null;
  if (!isNonEmptyString(v.contentSha256, 80)) return null;
  if (typeof v.sizeBytes !== "number") return null;
  return {
    appId: v.appId,
    revision: v.revision,
    format: GEN_APP_FORMAT,
    formatVersion: v.formatVersion,
    runtimeVersion: v.runtimeVersion,
    policyVersion: v.policyVersion,
    html: v.html,
    contentSha256: v.contentSha256,
    sizeBytes: v.sizeBytes,
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
