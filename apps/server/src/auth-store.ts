import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  getLlmProviderMeta,
  isLlmProviderId,
  LLM_PROVIDERS,
  type LlmProviderId,
  type ProviderAuthCatalogItem,
  type ProviderAuthInfoPublic,
  type ProviderAuthListResponse,
  type ProviderAuthMethod,
  type ProviderAuthType,
} from "@openos/shared";
import type { ServerEnv } from "./env.js";

/** 对齐 OpenCode auth.json 结构 */
export type StoredApiAuth = {
  type: "api";
  key: string;
  metadata?: Record<string, string>;
};

export type StoredOauthAuth = {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  metadata?: Record<string, string>;
};

export type StoredAuth = StoredApiAuth | StoredOauthAuth;

type AuthFile = Record<string, StoredAuth>;

const POPULAR_IDS = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "openrouter",
  "moonshot",
  "groq",
  "xai",
] as const;

function resolveAuthPath(env: ServerEnv): string {
  if (env.dataDir) return join(env.dataDir, "auth.json");
  return join(process.cwd(), ".openos", "auth.json");
}

function maskKey(key: string): string {
  const k = key.trim();
  if (!k) return "";
  if (k.length <= 8) return "••••";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

function readAuthFile(path: string): AuthFile {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as AuthFile;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeAuthFile(path: string, data: AuthFile) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function getAuth(env: ServerEnv, providerId: string): StoredAuth | undefined {
  const file = readAuthFile(resolveAuthPath(env));
  return file[providerId];
}

export function getAllAuth(env: ServerEnv): AuthFile {
  return readAuthFile(resolveAuthPath(env));
}

export function setAuth(env: ServerEnv, providerId: string, info: StoredAuth) {
  const path = resolveAuthPath(env);
  const file = readAuthFile(path);
  file[providerId] = info;
  writeAuthFile(path, file);
}

export function removeAuth(env: ServerEnv, providerId: string) {
  const path = resolveAuthPath(env);
  const file = readAuthFile(path);
  delete file[providerId];
  writeAuthFile(path, file);
}

/**
 * 解析可用于 LLM 调用的密钥：
 * auth.json (oauth.access / api.key) > 厂商 env > OPENOS_LLM_API_KEY
 */
export function resolveProviderCredential(
  env: ServerEnv,
  providerId: string,
): { key: string; source: "auth" | "env" | "none"; authType?: ProviderAuthType } {
  const stored = getAuth(env, providerId);
  if (stored?.type === "api" && stored.key) {
    return { key: stored.key, source: "auth", authType: "api" };
  }
  if (stored?.type === "oauth" && stored.access) {
    // 过期仍返回，调用侧可尝试 refresh
    return { key: stored.access, source: "auth", authType: "oauth" };
  }

  if (isLlmProviderId(providerId)) {
    const meta = getLlmProviderMeta(providerId);
    for (const envKey of meta.envKeys) {
      const value = process.env[envKey]?.trim();
      if (value) return { key: value, source: "env" };
    }
  }
  const fallback = env.llm.apiKey?.trim();
  if (fallback) return { key: fallback, source: "env" };
  return { key: "", source: "none" };
}

function methodsForProvider(providerId: string): ProviderAuthMethod[] {
  // 对齐 OpenCode codex plugin 的 methods 顺序
  if (providerId === "openai") {
    return [
      {
        type: "oauth",
        label: "ChatGPT Pro/Plus (browser)",
        description: "浏览器登录，回调 http://localhost:1455/auth/callback",
      },
      {
        type: "oauth",
        label: "ChatGPT Pro/Plus (headless)",
        description: "设备码登录，适合无浏览器环境",
      },
      { type: "api", label: "API Key" },
    ];
  }
  if (providerId === "anthropic") {
    return [
      { type: "oauth", label: "Claude OAuth", description: "浏览器授权 Claude（授权码）" },
      { type: "api", label: "API Key" },
    ];
  }
  if (providerId === "google") {
    return [
      { type: "oauth", label: "Google OAuth", description: "Google 账号授权 Gemini" },
      { type: "api", label: "API Key" },
    ];
  }
  if (providerId === "github-copilot") {
    return [
      { type: "oauth", label: "GitHub Device Login", description: "设备码登录 GitHub Copilot" },
    ];
  }
  return [{ type: "api", label: "API Key" }];
}

function toPublicInfo(
  providerId: string,
  stored: StoredAuth | undefined,
  envHit: boolean,
  active?: { provider: string; model: string },
): ProviderAuthInfoPublic | undefined {
  const meta = isLlmProviderId(providerId)
    ? getLlmProviderMeta(providerId)
    : { label: providerId };
  const activeModel =
    active?.provider === providerId ? active.model : undefined;

  if (stored?.type === "api") {
    return {
      providerId,
      label: meta.label,
      type: "api",
      preview: maskKey(stored.key),
      source: "auth",
      activeModel,
    };
  }
  if (stored?.type === "oauth") {
    return {
      providerId,
      label: meta.label,
      type: "oauth",
      preview: stored.accountId
        ? stored.accountId
        : maskKey(stored.access),
      source: "auth",
      expiresAt: stored.expires,
      accountId: stored.accountId,
      activeModel,
    };
  }
  if (envHit) {
    return {
      providerId,
      label: meta.label,
      type: "env",
      preview: "environment",
      source: "env",
      activeModel,
    };
  }
  return undefined;
}

export function listProviderAuth(
  env: ServerEnv,
  active?: { provider: string; model: string },
): ProviderAuthListResponse {
  const all = getAllAuth(env);
  const connected: ProviderAuthInfoPublic[] = [];
  const catalog: ProviderAuthCatalogItem[] = [];

  // 先收集已连接（auth.json）
  for (const [providerId, stored] of Object.entries(all)) {
    const info = toPublicInfo(providerId, stored, false, active);
    if (info) connected.push(info);
  }

  // env 命中但未写入 auth 的也算 connected（不可 disconnect 到 env）
  for (const p of LLM_PROVIDERS) {
    if (p.id === "openai-compatible") continue;
    if (all[p.id]) continue;
    const cred = resolveProviderCredential(env, p.id);
    if (cred.source === "env" && cred.key) {
      const info = toPublicInfo(p.id, undefined, true, active);
      if (info) connected.push(info);
    }
  }

  const connectedIds = new Set(connected.map((c) => c.providerId));

  for (const p of LLM_PROVIDERS) {
    if (p.id === "openai-compatible") continue;
    const methods = methodsForProvider(p.id);
    catalog.push({
      providerId: p.id,
      label: p.label,
      category: p.category,
      description: p.description,
      docsUrl: p.docsUrl,
      methods,
      defaultModel: p.defaultModel,
      suggestedModels: p.suggestedModels,
      popular: (POPULAR_IDS as readonly string[]).includes(p.id),
      connected: connectedIds.has(p.id),
      connectedInfo: connected.find((c) => c.providerId === p.id),
    });
  }

  // 额外 OAuth 目标：GitHub Copilot（目录外）
  if (!catalog.some((c) => c.providerId === "github-copilot")) {
    catalog.push({
      providerId: "github-copilot",
      label: "GitHub Copilot",
      category: "gateway",
      description: "GitHub 设备码登录",
      docsUrl: "https://github.com/settings/tokens",
      methods: methodsForProvider("github-copilot"),
      defaultModel: "gpt-4.1",
      suggestedModels: ["gpt-4.1", "gpt-4o", "gpt-4o-mini", "claude-sonnet-4"],
      popular: true,
      connected: connectedIds.has("github-copilot"),
      connectedInfo: connected.find((c) => c.providerId === "github-copilot"),
    });
  }

  return { connected, catalog };
}

export function activateProviderFromAuth(
  env: ServerEnv,
  providerId: LlmProviderId,
  model?: string,
): void {
  // 延迟 import 避免循环
  // 实际激活在 create-server 调用 updateLlmSettings
  void env;
  void providerId;
  void model;
}
