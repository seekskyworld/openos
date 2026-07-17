import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createCerebras } from "@ai-sdk/cerebras";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createCohere } from "@ai-sdk/cohere";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createAlibaba } from "@ai-sdk/alibaba";
import { createAzure } from "@ai-sdk/azure";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  getLlmProviderMeta,
  type LlmAuthStyle,
  type LlmProtocolId,
  type LlmProviderId,
  type LlmRemoteModel,
} from "@openos/shared";
import type { EffectiveLlmConfig } from "./settings-store.js";

type CodedError = Error & { code?: string };

function coded(message: string, code: string): CodedError {
  const err = new Error(message) as CodedError;
  err.code = code;
  return err;
}

type SdkOptions = {
  apiKey: string;
  baseURL?: string;
  headers?: Record<string, string>;
  name?: string;
};

/**
 * 对齐 OpenCode 的 BUNDLED_PROVIDERS：
 * provider 目录里写 npm 标识，这里把标识映射到 create* 工厂。
 */
type ProviderFactory = (opts: SdkOptions) => {
  languageModel(modelId: string): LanguageModel;
};

const FACTORIES: Record<string, ProviderFactory> = {
  "@ai-sdk/openai": (opts) => {
    const sdk = createOpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk(id),
    };
  },
  "@ai-sdk/anthropic": (opts) => {
    const sdk = createAnthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk(id),
    };
  },
  "@ai-sdk/google": (opts) => {
    const sdk = createGoogleGenerativeAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk(id),
    };
  },
  "@ai-sdk/xai": (opts) => {
    const sdk = createXai({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk(id),
    };
  },
  "@ai-sdk/groq": (opts) => {
    const sdk = createGroq({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk(id),
    };
  },
  "@ai-sdk/mistral": (opts) => {
    const sdk = createMistral({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk(id),
    };
  },
  "@ai-sdk/deepinfra": (opts) => {
    const sdk = createDeepInfra({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk(id),
    };
  },
  "@ai-sdk/cerebras": (opts) => {
    const sdk = createCerebras({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk(id),
    };
  },
  "@ai-sdk/togetherai": (opts) => {
    const sdk = createTogetherAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk(id),
    };
  },
  "@ai-sdk/cohere": (opts) => {
    const sdk = createCohere({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk(id),
    };
  },
  "@ai-sdk/perplexity": (opts) => {
    const sdk = createPerplexity({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk(id),
    };
  },
  "@ai-sdk/alibaba": (opts) => {
    const sdk = createAlibaba({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk(id),
    };
  },
  "@ai-sdk/azure": (opts) => {
    // Azure 需要 resourceName 或完整 baseURL；有 baseURL 时从中解析
    const baseURL = opts.baseURL?.replace(/\/$/, "");
    let resourceName: string | undefined;
    if (baseURL) {
      try {
        const host = new URL(baseURL).hostname;
        // xxx.openai.azure.com 或 xxx.cognitiveservices.azure.com
        const match = host.match(/^([^.]+)\.(openai|cognitiveservices)\.azure\.com$/i);
        if (match) resourceName = match[1];
      } catch {
        // ignore
      }
    }
    const sdk = createAzure({
      apiKey: opts.apiKey,
      resourceName: resourceName || process.env.AZURE_RESOURCE_NAME || "openos",
      baseURL: baseURL || undefined,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk(id),
    };
  },
  "@openrouter/ai-sdk-provider": (opts) => {
    const sdk = createOpenRouter({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk.chat(id),
    };
  },
  "@ai-sdk/openai-compatible": (opts) => {
    const sdk = createOpenAICompatible({
      name: opts.name || "openai-compatible",
      apiKey: opts.apiKey,
      baseURL: opts.baseURL || "https://api.openai.com/v1",
      headers: opts.headers,
    });
    return {
      languageModel: (id) => sdk.chatModel(id),
    };
  },
};

/** 自定义模式：按 protocol 选择 SDK（对齐 OpenCode protocols） */
function factoryForProtocol(protocol: LlmProtocolId): ProviderFactory {
  switch (protocol) {
    case "anthropic-messages":
      return FACTORIES["@ai-sdk/anthropic"];
    case "google-gemini":
      return FACTORIES["@ai-sdk/google"];
    case "openai-responses":
      return (opts) => {
        const sdk = createOpenAI({
          apiKey: opts.apiKey,
          baseURL: opts.baseURL,
          headers: opts.headers,
        });
        return {
          // Responses API 默认 language model
          languageModel: (id) => sdk.responses(id),
        };
      };
    case "openai-chat":
      return (opts) => {
        const sdk = createOpenAI({
          apiKey: opts.apiKey,
          baseURL: opts.baseURL,
          headers: opts.headers,
        });
        return {
          languageModel: (id) => sdk.chat(id),
        };
      };
    case "openai-compatible":
    default:
      return FACTORIES["@ai-sdk/openai-compatible"];
  }
}

function authHeaders(
  authStyle: LlmAuthStyle,
  apiKey: string,
): Record<string, string> | undefined {
  if (!apiKey || apiKey === "no-key" || authStyle === "none") return undefined;
  if (authStyle === "x-api-key") {
    return { "x-api-key": apiKey };
  }
  // bearer / query：多数 SDK 用 apiKey 字段处理；额外 header 仅作补充
  return undefined;
}

function resolveApiKeyForSdk(
  authStyle: LlmAuthStyle,
  apiKey: string,
): string {
  if (authStyle === "none") return apiKey || "no-key";
  return apiKey;
}

/**
 * 根据生效配置创建 LanguageModel。
 * - 官方厂商：按 provider.npm 映射
 * - 自定义（openai-compatible provider）：按 protocol 映射
 */
export function createLanguageModel(config: EffectiveLlmConfig): LanguageModel {
  const { provider, model, baseUrl, apiKey, protocol, authStyle, profile } =
    config;

  const needsKey = authStyle !== "none";
  if (needsKey && (!apiKey || apiKey === "no-key")) {
    throw coded(
      "LLM API key is not configured. Open Settings to add a key.",
      "llm_not_configured",
    );
  }
  if (!model?.trim()) {
    throw coded("Model id is required.", "invalid_model");
  }

  const isCustom = provider === "openai-compatible";
  const meta = getLlmProviderMeta(provider);
  const factory = isCustom
    ? factoryForProtocol(protocol)
    : FACTORIES[meta.npm] ?? factoryForProtocol(protocol);

  const headers = authHeaders(authStyle, apiKey);
  const sdk = factory({
    apiKey: resolveApiKeyForSdk(authStyle, apiKey),
    baseURL: baseUrl || meta.defaultBaseUrl || undefined,
    headers,
    name: profile || provider,
  });
  return sdk.languageModel(model.trim());
}

function authFetchHeaders(
  authStyle: LlmAuthStyle,
  apiKey: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (!apiKey || apiKey === "no-key" || authStyle === "none") return headers;
  if (authStyle === "x-api-key") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    return headers;
  }
  if (authStyle === "query") {
    // query key 放在 URL
    return headers;
  }
  headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

const FETCH_MODELS_TIMEOUT_MS = 12_000;

async function fetchWithTimeout(
  endpoint: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS);
  try {
    return await fetch(endpoint, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 归一化模型列表结果 */
function ok(models: LlmRemoteModel[]): { models: LlmRemoteModel[] } {
  const seen = new Set<string>();
  const out: LlmRemoteModel[] = [];
  for (const m of models) {
    const id = m.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: m.name });
  }
  return { models: out.slice(0, 400) };
}

function fail(message: string, code: string): { models: LlmRemoteModel[]; error: CodedError } {
  return { models: [], error: coded(message, code) };
}

/**
 * 拉取远程模型列表，按协议路由到各自端点：
 * - openai-compatible / openai-chat / openai-responses → GET {base}/models (OpenAI 风格)
 * - anthropic-messages → GET {base}/models (x-api-key + anthropic-version)
 * - google-gemini → GET {base}/models?key=API_KEY (Gemini 风格 models[].name)
 * Ollama 原生 {base}/api/tags 由 openai-compatible 的 /models 覆盖不到时可手动填。
 */
export async function discoverRemoteModels(input: {
  provider: LlmProviderId | string;
  baseUrl: string;
  apiKey: string;
  protocol?: LlmProtocolId;
  authStyle?: LlmAuthStyle;
}): Promise<{ models: LlmRemoteModel[]; error?: CodedError }> {
  const meta = getLlmProviderMeta(input.provider);
  const protocol =
    input.protocol ||
    (input.provider === "anthropic"
      ? "anthropic-messages"
      : input.provider === "google"
        ? "google-gemini"
        : "openai-compatible");
  const authStyle =
    input.authStyle ||
    (protocol === "anthropic-messages"
      ? "x-api-key"
      : protocol === "google-gemini"
        ? "query"
        : "bearer");
  const base = (input.baseUrl || meta.defaultBaseUrl).replace(/\/$/, "");

  if (authStyle !== "none" && (!input.apiKey || input.apiKey === "no-key")) {
    return fail("API key is required to list models.", "llm_not_configured");
  }

  try {
    // —— Anthropic Messages：GET /models ——
    if (protocol === "anthropic-messages") {
      const response = await fetchWithTimeout(`${base}/models`, {
        method: "GET",
        headers: {
          "content-type": "application/json",
          "x-api-key": input.apiKey,
          "anthropic-version": "2023-06-01",
        },
      });
      const text = await response.text();
      const payload = safeJson(text) as {
        data?: Array<{ id?: string; display_name?: string }>;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        return fail(
          payload?.error?.message ||
            `List models failed with HTTP ${response.status}`,
          "llm_upstream_error",
        );
      }
      const arr = payload?.data ?? [];
      return ok(
        arr.map((m) => ({
          id: String(m.id ?? "").trim(),
          name: m.display_name ? String(m.display_name) : undefined,
        })),
      );
    }

    // —— Google Gemini：GET /models?key= ——
    if (protocol === "google-gemini") {
      const url = new URL(`${base}/models`);
      url.searchParams.set("key", input.apiKey);
      url.searchParams.set("pageSize", "200");
      const response = await fetchWithTimeout(url.toString(), {
        method: "GET",
        headers: { "content-type": "application/json" },
      });
      const text = await response.text();
      const payload = safeJson(text) as {
        models?: Array<{
          name?: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
        }>;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        return fail(
          payload?.error?.message ||
            `List models failed with HTTP ${response.status}`,
          "llm_upstream_error",
        );
      }
      const arr = (payload?.models ?? []) as Array<{
        name?: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }>;
      return ok(
        arr
          // 仅保留支持 generateContent 的对话模型
          .filter(
            (m) =>
              !m.supportedGenerationMethods ||
              m.supportedGenerationMethods.includes("generateContent"),
          )
          .map((m) => ({
            // Gemini 返回 "models/gemini-2.5-flash"，去前缀
            id: String(m.name ?? "").replace(/^models\//, "").trim(),
            name: m.displayName ? String(m.displayName) : undefined,
          })),
      );
    }

    // —— OpenAI 风格（含 compatible / chat / responses / 网关）——
    let endpoint = `${base}/models`;
    if (authStyle === "query" && input.apiKey && input.apiKey !== "no-key") {
      const url = new URL(endpoint);
      url.searchParams.set("key", input.apiKey);
      endpoint = url.toString();
    }
    const response = await fetchWithTimeout(endpoint, {
      method: "GET",
      headers: authFetchHeaders(authStyle, input.apiKey),
    });
    const text = await response.text();
    const payload = safeJson(text) as {
      data?: Array<{ id?: string; name?: string }>;
      models?: Array<{ name?: string; model?: string; id?: string }>;
      error?: { message?: string };
    } | null;
    if (payload === null && text) {
      return fail(
        `Model list returned non-JSON (HTTP ${response.status}).`,
        "llm_bad_response",
      );
    }
    if (!response.ok) {
      return fail(
        payload?.error?.message ||
          `List models failed with HTTP ${response.status}`,
        "llm_upstream_error",
      );
    }
    const fromData = (payload?.data ?? []).map((item) => ({
      id: String(item.id ?? "").trim(),
      name: item.name ? String(item.name) : undefined,
    }));
    // Ollama 原生 /api/tags 或 models[]
    const fromModels = (payload?.models ?? []).map((item) => ({
      id: String(item.id ?? item.name ?? item.model ?? "").trim(),
      name: item.name ? String(item.name) : undefined,
    }));
    return ok([...fromData, ...fromModels]);
  } catch (error) {
    const name = (error as Error)?.name;
    if (name === "AbortError" || name === "TimeoutError") {
      return fail(
        `拉取模型超时（${FETCH_MODELS_TIMEOUT_MS}ms）。请检查网络 / Base URL。`,
        "models_timeout",
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail(message, "llm_upstream_error");
  }
}

function safeJson(text: string): Record<string, unknown> | null {
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}
