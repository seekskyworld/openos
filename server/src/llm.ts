import { generateText } from "ai";
import type { ChatMessage, ChatResponse } from "@openos/shared";
import type { EffectiveLlmConfig } from "./settings-store.js";
import { createLanguageModel } from "./provider-registry.js";

export { createLanguageModel, discoverRemoteModels } from "./provider-registry.js";

type CodedError = Error & { code?: string };

function coded(message: string, code: string): CodedError {
  const err = new Error(message) as CodedError;
  err.code = code;
  return err;
}

function toCoreMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

/**
 * 推理强度 → 各协议 providerOptions（对齐 AI SDK）：
 * - OpenAI(Chat/Responses/compatible/xai/grok)：reasoningEffort
 * - Anthropic：thinking.budgetTokens
 * - Google：thinkingConfig.thinkingBudget
 */
function reasoningProviderOptions(
  config: EffectiveLlmConfig,
): Record<string, Record<string, unknown>> | undefined {
  const eff = config.reasoningEffort;
  if (!eff || eff === "off") return undefined;

  const { protocol, provider } = config;

  // Anthropic thinking：按档位给 budget tokens
  if (protocol === "anthropic-messages" || provider === "anthropic") {
    const budget =
      eff === "minimal"
        ? 1024
        : eff === "low"
          ? 4096
          : eff === "medium"
            ? 8192
            : 16000;
    return { anthropic: { thinking: { type: "enabled", budgetTokens: budget } } };
  }

  // Google Gemini thinkingConfig
  if (protocol === "google-gemini" || provider === "google") {
    const budget =
      eff === "minimal"
        ? 512
        : eff === "low"
          ? 2048
          : eff === "medium"
            ? 8192
            : 24576;
    return {
      google: { thinkingConfig: { thinkingBudget: budget, includeThoughts: false } },
    };
  }

  // OpenAI 家族 + 兼容端点：reasoningEffort（minimal/low/medium/high）
  const openaiEffort = eff;
  const opts: Record<string, Record<string, unknown>> = {
    openai: { reasoningEffort: openaiEffort },
  };
  if (provider === "xai") opts.xai = { reasoningEffort: openaiEffort };
  if (provider === "groq") opts.groq = { reasoningEffort: openaiEffort };
  return opts;
}

type ChatOptions = {
  /** 覆盖模型 */
  modelOverride?: string;
  /** 重试次数（测试连接用 0，快速失败） */
  maxRetries?: number;
  /** 整体超时毫秒 */
  timeoutMs?: number;
  /** 采样温度（缺省 0.7） */
  temperature?: number;
};

export async function chatCompletion(
  config: EffectiveLlmConfig,
  messages: ChatMessage[],
  options: ChatOptions | string = {},
): Promise<ChatResponse> {
  const opts: ChatOptions =
    typeof options === "string" ? { modelOverride: options } : options;
  const effective: EffectiveLlmConfig = {
    ...config,
    model: opts.modelOverride?.trim() || config.model,
  };

  const controller = new AbortController();
  const timer =
    opts.timeoutMs && opts.timeoutMs > 0
      ? setTimeout(() => controller.abort(), opts.timeoutMs)
      : undefined;

  try {
    const model = createLanguageModel(effective);
    const providerOptions = reasoningProviderOptions(effective) as
      | Parameters<typeof generateText>[0]["providerOptions"]
      | undefined;
    // openai-responses（gpt-5/o 系推理模型）不支持 temperature，传入会被上游拒绝
    const supportsTemperature = effective.protocol !== "openai-responses";
    const result = await generateText({
      model,
      messages: toCoreMessages(messages),
      ...(supportsTemperature
        ? { temperature: opts.temperature ?? 0.7 }
        : {}),
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      abortSignal: controller.signal,
    });

    const content = result.text?.trim() ?? "";
    if (!content) {
      throw coded("LLM response contained empty content.", "llm_empty_content");
    }

    const usage = result.usage;
    return {
      id: result.response?.id || `ai-${Date.now()}`,
      model: result.response?.modelId || effective.model,
      provider: effective.provider,
      content,
      usage: {
        promptTokens: usage?.inputTokens,
        completionTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
      },
    };
  } catch (error) {
    if ((error as CodedError).code) throw error;
    const isAbort =
      (error as Error)?.name === "AbortError" ||
      (error as Error)?.name === "TimeoutError";
    const message = isAbort
      ? `请求超时（${opts.timeoutMs}ms）。请检查网络 / Base URL / 模型名。`
      : error instanceof Error
        ? error.message
        : String(error);
    throw coded(message, isAbort ? "llm_timeout" : "llm_upstream_error");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 无密钥时的本地回声，保证架构可先跑通 */
export function mockChatCompletion(
  config: EffectiveLlmConfig,
  messages: ChatMessage[],
  modelOverride?: string,
): ChatResponse {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return {
    id: `mock-${Date.now()}`,
    model: modelOverride?.trim() || config.model,
    provider: `${config.provider}-mock`,
    content: [
      "（本地 mock：未配置 API Key）",
      `提供商：${config.provider}`,
      `协议：${config.protocol}`,
      `模型：${modelOverride?.trim() || config.model}`,
      config.baseUrl ? `地址：${config.baseUrl}` : "",
      `收到：${lastUser?.content ?? "(empty)"}`,
      "请打开 Settings 配置密钥后接入真实模型。",
      "官方厂商 + 自定义协议（OpenAI Compatible / Chat / Responses / Anthropic / Gemini）与本地 Ollama 等预设。",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function testLlmConnection(
  config: EffectiveLlmConfig,
  prompt = "Reply with exactly: ok",
): Promise<{ content: string; latencyMs: number }> {
  const started = Date.now();
  // 测试连接：不重试 + 15s 超时，快速给出结果
  const result = await chatCompletion(
    config,
    [{ role: "user", content: prompt }],
    { maxRetries: 0, timeoutMs: 15_000 },
  );
  return {
    content: result.content,
    latencyMs: Date.now() - started,
  };
}
