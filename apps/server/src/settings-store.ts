import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  getLlmCompatibleProfile,
  getLlmProtocolMeta,
  getLlmProviderMeta,
  isLlmAuthStyle,
  isLlmProtocolId,
  isLlmProviderId,
  isLlmReasoningEffort,
  type LlmAuthStyle,
  type LlmProtocolId,
  type LlmProviderId,
  type LlmReasoningEffort,
  type LlmSettingsPublic,
  type LlmSettingsUpdate,
  LLM_COMPATIBLE_PROFILES,
  LLM_PROTOCOLS,
  LLM_PROVIDERS,
  LLM_REASONING_EFFORTS,
} from "@openos/shared";
import type { ServerEnv } from "./env.js";
import { resolveProviderCredential } from "./auth-store.js";

export type PersistedLlmSettings = {
  provider: LlmProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
  protocol?: LlmProtocolId;
  authStyle?: LlmAuthStyle;
  profile?: string;
  reasoningEffort?: LlmReasoningEffort;
};

export type EffectiveLlmConfig = {
  provider: LlmProviderId;
  model: string;
  baseUrl: string;
  apiKey: string;
  protocol: LlmProtocolId;
  authStyle: LlmAuthStyle;
  profile: string;
  reasoningEffort: LlmReasoningEffort;
  source: LlmSettingsPublic["source"];
};

type SettingsFile = {
  version: 1;
  llm?: Partial<PersistedLlmSettings>;
};

function resolveSettingsPath(env: ServerEnv): string {
  if (env.dataDir) {
    return join(env.dataDir, "settings.json");
  }
  return join(process.cwd(), ".openos", "settings.json");
}

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  const raw = (value ?? "").trim() || fallback;
  return raw.replace(/\/$/, "");
}

function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function readSettingsFile(path: string): SettingsFile {
  if (!existsSync(path)) return { version: 1 };
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as SettingsFile;
    if (!parsed || typeof parsed !== "object") return { version: 1 };
    return { version: 1, llm: parsed.llm };
  } catch {
    return { version: 1 };
  }
}

function writeSettingsFile(path: string, data: SettingsFile) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/**
 * 参考 OpenCode：auth.json > provider.envKeys > OPENOS_LLM_*。
 */
function resolveEnvApiKey(provider: LlmProviderId, env: ServerEnv): string {
  const cred = resolveProviderCredential(env, provider);
  if (cred.key) return cred.key;
  const meta = getLlmProviderMeta(provider);
  for (const key of meta.envKeys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return env.llm.apiKey?.trim() || "";
}

/** 官方厂商的隐含协议（供展示 / 自定义回落） */
export function protocolForProvider(provider: LlmProviderId): LlmProtocolId {
  switch (provider) {
    case "anthropic":
      return "anthropic-messages";
    case "google":
      return "google-gemini";
    case "openai":
    case "azure":
      return "openai-responses";
    case "openai-compatible":
      return "openai-compatible";
    default:
      // 多数官方/国内/网关走各自 npm 或 openai-compatible 工厂
      return "openai-compatible";
  }
}

export function authStyleForProtocol(protocol: LlmProtocolId): LlmAuthStyle {
  return getLlmProtocolMeta(protocol).defaultAuthStyle;
}

function envAsPersisted(env: ServerEnv): Partial<PersistedLlmSettings> {
  const provider = isLlmProviderId(env.llm.provider)
    ? env.llm.provider
    : ("openai" as LlmProviderId);
  return {
    provider,
    model: env.llm.model,
    baseUrl: env.llm.baseUrl,
    apiKey: resolveEnvApiKey(provider, env),
    protocol: protocolForProvider(provider),
    authStyle: authStyleForProtocol(protocolForProvider(provider)),
    profile: provider === "openai-compatible" ? "custom" : "",
  };
}

/**
 * 合并优先级：请求临时覆盖 > 持久化设置 > 环境变量 > 提供商默认。
 */
export function resolveEffectiveLlm(
  env: ServerEnv,
  override?: Partial<PersistedLlmSettings>,
): EffectiveLlmConfig {
  const path = resolveSettingsPath(env);
  const file = readSettingsFile(path);
  const persisted = file.llm ?? {};
  const fromEnv = envAsPersisted(env);

  const provider: LlmProviderId = isLlmProviderId(override?.provider)
    ? override!.provider!
    : isLlmProviderId(persisted.provider)
      ? persisted.provider
      : isLlmProviderId(fromEnv.provider)
        ? fromEnv.provider!
        : "openai";

  const meta = getLlmProviderMeta(provider);
  const isCustom = provider === "openai-compatible";

  const profile =
    (override?.profile ?? persisted.profile ?? fromEnv.profile ?? "").trim() ||
    (isCustom ? "custom" : "");

  const profileMeta = profile ? getLlmCompatibleProfile(profile) : undefined;

  const protocol: LlmProtocolId = isLlmProtocolId(override?.protocol)
    ? override!.protocol!
    : isLlmProtocolId(persisted.protocol)
      ? persisted.protocol
      : isCustom
        ? profileMeta?.protocol || "openai-compatible"
        : protocolForProvider(provider);

  const protocolMeta = getLlmProtocolMeta(protocol);

  const authStyle: LlmAuthStyle = isLlmAuthStyle(override?.authStyle)
    ? override!.authStyle!
    : isLlmAuthStyle(persisted.authStyle)
      ? persisted.authStyle
      : isCustom
        ? profileMeta?.authStyle || protocolMeta.defaultAuthStyle
        : protocolMeta.defaultAuthStyle;

  const model =
    override?.model?.trim() ||
    persisted.model?.trim() ||
    fromEnv.model?.trim() ||
    profileMeta?.defaultModel ||
    meta.defaultModel;

  const baseFallback =
    (isCustom ? profileMeta?.baseUrl : "") ||
    protocolMeta.defaultBaseUrl ||
    meta.defaultBaseUrl;

  const baseUrl = normalizeBaseUrl(
    override?.baseUrl !== undefined
      ? override.baseUrl
      : persisted.baseUrl !== undefined
        ? persisted.baseUrl
        : fromEnv.baseUrl,
    baseFallback,
  );

  let apiKey =
    override?.apiKey !== undefined
      ? override.apiKey.trim()
      : persisted.apiKey?.trim() || resolveEnvApiKey(provider, env);

  // authStyle=none（本地 Ollama 等）允许空 key；为 SDK 填占位
  if (!apiKey && authStyle === "none") {
    apiKey = "no-key";
  }

  const reasoningEffort: LlmReasoningEffort = isLlmReasoningEffort(
    override?.reasoningEffort,
  )
    ? override!.reasoningEffort!
    : isLlmReasoningEffort(persisted.reasoningEffort)
      ? persisted.reasoningEffort
      : "off";

  let source: EffectiveLlmConfig["source"] = "default";
  if (
    override &&
    (override.provider ||
      override.model ||
      override.baseUrl ||
      override.protocol ||
      override.authStyle ||
      override.profile ||
      override.apiKey !== undefined)
  ) {
    source = "persisted";
  } else if (
    persisted.provider ||
    persisted.model ||
    persisted.baseUrl ||
    persisted.protocol ||
    persisted.authStyle ||
    persisted.profile ||
    persisted.apiKey
  ) {
    source = "persisted";
  } else if (apiKey || fromEnv.model || fromEnv.provider) {
    source = "env";
  }

  if (source === "default" && apiKey && apiKey !== "no-key") source = "env";

  return {
    provider,
    model,
    baseUrl,
    apiKey,
    protocol,
    authStyle,
    profile,
    reasoningEffort,
    source,
  };
}

export function getPublicLlmSettings(env: ServerEnv): LlmSettingsPublic {
  const effective = resolveEffectiveLlm(env);
  const realKey =
    effective.apiKey && effective.apiKey !== "no-key" ? effective.apiKey : "";
  return {
    provider: effective.provider,
    model: effective.model,
    baseUrl: effective.baseUrl,
    protocol: effective.protocol,
    authStyle: effective.authStyle,
    profile: effective.profile || "custom",
    reasoningEffort: effective.reasoningEffort,
    hasApiKey: Boolean(realKey) || effective.authStyle === "none",
    apiKeyPreview:
      effective.authStyle === "none" && !realKey
        ? "(none)"
        : maskApiKey(realKey),
    source: effective.source,
    providers: LLM_PROVIDERS,
    protocols: LLM_PROTOCOLS,
    profiles: LLM_COMPATIBLE_PROFILES,
    reasoningEfforts: LLM_REASONING_EFFORTS,
  };
}

export function updateLlmSettings(
  env: ServerEnv,
  update: LlmSettingsUpdate,
): LlmSettingsPublic {
  if (!isLlmProviderId(update.provider)) {
    const err = new Error(`Unsupported provider: ${String(update.provider)}`);
    (err as Error & { code?: string }).code = "invalid_provider";
    throw err;
  }

  const path = resolveSettingsPath(env);
  const file = readSettingsFile(path);
  const prev = file.llm ?? {};
  const meta = getLlmProviderMeta(update.provider);
  const isCustom = update.provider === "openai-compatible";

  const profile =
    (update.profile ?? prev.profile ?? (isCustom ? "custom" : "")).trim() ||
    (isCustom ? "custom" : "");
  const profileMeta = profile ? getLlmCompatibleProfile(profile) : undefined;

  const protocol: LlmProtocolId = isLlmProtocolId(update.protocol)
    ? update.protocol
    : isCustom
      ? profileMeta?.protocol || "openai-compatible"
      : protocolForProvider(update.provider);

  const protocolMeta = getLlmProtocolMeta(protocol);
  const authStyle: LlmAuthStyle = isLlmAuthStyle(update.authStyle)
    ? update.authStyle
    : isCustom
      ? profileMeta?.authStyle || protocolMeta.defaultAuthStyle
      : protocolMeta.defaultAuthStyle;

  const reasoningEffort: LlmReasoningEffort = isLlmReasoningEffort(
    update.reasoningEffort,
  )
    ? update.reasoningEffort
    : isLlmReasoningEffort(prev.reasoningEffort)
      ? prev.reasoningEffort
      : "off";

  const next: PersistedLlmSettings = {
    provider: update.provider,
    model:
      update.model?.trim() ||
      profileMeta?.defaultModel ||
      meta.defaultModel,
    baseUrl: normalizeBaseUrl(
      update.baseUrl,
      profileMeta?.baseUrl || protocolMeta.defaultBaseUrl || meta.defaultBaseUrl,
    ),
    apiKey:
      update.apiKey === undefined
        ? prev.apiKey?.trim() || ""
        : update.apiKey.trim(),
    protocol,
    authStyle,
    profile,
    reasoningEffort,
  };

  writeSettingsFile(path, { version: 1, llm: next });
  return getPublicLlmSettings(env);
}
