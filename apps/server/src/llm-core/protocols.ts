import {
  CoreProtocolError,
  isRecord,
  type CoreRequest,
  type CoreResponse,
  type WireHttpRequest,
  type WireProtocol,
  type WireTarget,
} from "./types.js";

/**
 * Wire 协议适配器（内部协议 ↔ 各厂商 HTTP 格式）。
 * 每个适配器只关心自己协议的字段映射与限制；调用方永远面向 CoreRequest。
 */

function authHeaders(target: WireTarget): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (target.authStyle === "bearer" && target.apiKey) {
    headers.authorization = `Bearer ${target.apiKey}`;
  } else if (target.authStyle === "x-api-key" && target.apiKey) {
    headers["x-api-key"] = target.apiKey;
  }
  return headers;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}${path}`;
}

function textOrEmpty(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// ===== OpenAI Chat Completions（/chat/completions；兼容多数厂商）=====
export const openAiChatProtocol: WireProtocol = {
  id: "openai-chat",
  toWire(target, request) {
    return {
      url: joinUrl(target.baseUrl, "/chat/completions"),
      headers: authHeaders(target),
      body: {
        model: request.model,
        messages: request.messages,
        ...(request.temperature !== undefined
          ? { temperature: request.temperature }
          : {}),
        ...(request.maxOutputTokens
          ? { max_tokens: request.maxOutputTokens }
          : {}),
      },
    };
  },
  fromWire(payload, request) {
    if (!isRecord(payload)) {
      throw new CoreProtocolError({
        kind: "invalid_output",
        message: "openai-chat: payload is not an object",
      });
    }
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = isRecord(choices[0]) ? choices[0] : undefined;
    const message = first && isRecord(first.message) ? first.message : undefined;
    const text = textOrEmpty(message?.content).trim();
    if (!text) {
      throw new CoreProtocolError({
        kind: "invalid_output",
        message: "openai-chat: empty content",
      });
    }
    const usage = isRecord(payload.usage) ? payload.usage : {};
    return {
      id: textOrEmpty(payload.id) || `core-${Date.now()}`,
      model: textOrEmpty(payload.model) || request.model,
      text,
      usage: {
        promptTokens: Number(usage.prompt_tokens) || undefined,
        completionTokens: Number(usage.completion_tokens) || undefined,
        totalTokens: Number(usage.total_tokens) || undefined,
      },
    };
  },
};

// ===== OpenAI Responses（/responses；gpt-5/o 系）=====
// 限制：不接受 system 角色（并入 instructions）；不接受 temperature
export const openAiResponsesProtocol: WireProtocol = {
  id: "openai-responses",
  toWire(target, request) {
    const systemText = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const rest = request.messages.filter((m) => m.role !== "system");
    return {
      url: joinUrl(target.baseUrl, "/responses"),
      headers: authHeaders(target),
      body: {
        model: request.model,
        ...(systemText ? { instructions: systemText } : {}),
        input: rest.map((m) => ({
          role: m.role,
          content: [
            {
              type: m.role === "assistant" ? "output_text" : "input_text",
              text: m.content,
            },
          ],
        })),
        ...(request.maxOutputTokens
          ? { max_output_tokens: request.maxOutputTokens }
          : {}),
        ...(request.reasoningEffort && request.reasoningEffort !== "off"
          ? { reasoning: { effort: request.reasoningEffort } }
          : {}),
      },
    };
  },
  fromWire(payload, request) {
    if (!isRecord(payload)) {
      throw new CoreProtocolError({
        kind: "invalid_output",
        message: "openai-responses: payload is not an object",
      });
    }
    // 首选 output_text 汇总字段；退化到遍历 output[].content[].text
    let text = textOrEmpty(payload.output_text).trim();
    if (!text && Array.isArray(payload.output)) {
      const parts: string[] = [];
      for (const item of payload.output) {
        if (!isRecord(item) || !Array.isArray(item.content)) continue;
        for (const c of item.content) {
          if (isRecord(c) && typeof c.text === "string") parts.push(c.text);
        }
      }
      text = parts.join("").trim();
    }
    if (!text) {
      throw new CoreProtocolError({
        kind: "invalid_output",
        message: "openai-responses: empty output",
      });
    }
    const usage = isRecord(payload.usage) ? payload.usage : {};
    return {
      id: textOrEmpty(payload.id) || `core-${Date.now()}`,
      model: textOrEmpty(payload.model) || request.model,
      text,
      usage: {
        promptTokens: Number(usage.input_tokens) || undefined,
        completionTokens: Number(usage.output_tokens) || undefined,
        totalTokens: Number(usage.total_tokens) || undefined,
      },
    };
  },
};

// ===== Anthropic Messages（/messages）=====
export const anthropicMessagesProtocol: WireProtocol = {
  id: "anthropic-messages",
  toWire(target, request) {
    const systemText = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const rest = request.messages.filter((m) => m.role !== "system");
    const headers = authHeaders(target);
    headers["anthropic-version"] = "2023-06-01";
    return {
      url: joinUrl(target.baseUrl, "/messages"),
      headers,
      body: {
        model: request.model,
        ...(systemText ? { system: systemText } : {}),
        messages: rest.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: request.maxOutputTokens ?? 4096,
        ...(request.temperature !== undefined
          ? { temperature: Math.min(1, request.temperature) }
          : {}),
      },
    };
  },
  fromWire(payload, request) {
    if (!isRecord(payload)) {
      throw new CoreProtocolError({
        kind: "invalid_output",
        message: "anthropic: payload is not an object",
      });
    }
    const content = Array.isArray(payload.content) ? payload.content : [];
    const text = content
      .map((c) => (isRecord(c) && typeof c.text === "string" ? c.text : ""))
      .join("")
      .trim();
    if (!text) {
      throw new CoreProtocolError({
        kind: "invalid_output",
        message: "anthropic: empty content",
      });
    }
    const usage = isRecord(payload.usage) ? payload.usage : {};
    return {
      id: textOrEmpty(payload.id) || `core-${Date.now()}`,
      model: textOrEmpty(payload.model) || request.model,
      text,
      usage: {
        promptTokens: Number(usage.input_tokens) || undefined,
        completionTokens: Number(usage.output_tokens) || undefined,
      },
    };
  },
};

// ===== Google Gemini（generateContent；key 走 query）=====
export const geminiProtocol: WireProtocol = {
  id: "google-gemini",
  toWire(target, request) {
    const systemText = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const rest = request.messages.filter((m) => m.role !== "system");
    const keyQuery =
      target.authStyle === "query" && target.apiKey
        ? `?key=${encodeURIComponent(target.apiKey)}`
        : "";
    return {
      url: joinUrl(
        target.baseUrl,
        `/models/${encodeURIComponent(request.model)}:generateContent${keyQuery}`,
      ),
      headers:
        target.authStyle === "query"
          ? { "content-type": "application/json" }
          : authHeaders(target),
      body: {
        ...(systemText
          ? { systemInstruction: { parts: [{ text: systemText }] } }
          : {}),
        contents: rest.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          ...(request.temperature !== undefined
            ? { temperature: Math.min(2, request.temperature) }
            : {}),
          ...(request.maxOutputTokens
            ? { maxOutputTokens: request.maxOutputTokens }
            : {}),
        },
      },
    };
  },
  fromWire(payload, request) {
    if (!isRecord(payload)) {
      throw new CoreProtocolError({
        kind: "invalid_output",
        message: "gemini: payload is not an object",
      });
    }
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const first = isRecord(candidates[0]) ? candidates[0] : undefined;
    const content = first && isRecord(first.content) ? first.content : undefined;
    const parts = content && Array.isArray(content.parts) ? content.parts : [];
    const text = parts
      .map((p) => (isRecord(p) && typeof p.text === "string" ? p.text : ""))
      .join("")
      .trim();
    if (!text) {
      throw new CoreProtocolError({
        kind: "invalid_output",
        message: "gemini: empty candidates",
      });
    }
    const usage = isRecord(payload.usageMetadata) ? payload.usageMetadata : {};
    return {
      id: `core-${Date.now()}`,
      model: request.model,
      text,
      usage: {
        promptTokens: Number(usage.promptTokenCount) || undefined,
        completionTokens: Number(usage.candidatesTokenCount) || undefined,
        totalTokens: Number(usage.totalTokenCount) || undefined,
      },
    };
  },
};

const PROTOCOLS: Record<string, WireProtocol> = {
  "openai-chat": openAiChatProtocol,
  "openai-compatible": openAiChatProtocol,
  "openai-responses": openAiResponsesProtocol,
  "anthropic-messages": anthropicMessagesProtocol,
  "google-gemini": geminiProtocol,
};

export function resolveWireProtocol(id: string): WireProtocol {
  return PROTOCOLS[id] ?? openAiChatProtocol;
}
