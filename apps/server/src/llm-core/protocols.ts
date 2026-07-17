import {
  CoreProtocolError,
  isRecord,
  type CoreRequest,
  type CoreResponse,
  type CoreUsage,
  type WireHttpRequest,
  type WireProtocol,
  type WireStreamAccumulator,
  type WireStreamEvent,
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

function parseData(evt: WireStreamEvent): Record<string, unknown> | null {
  const raw = evt.data.trim();
  if (!raw || raw === "[DONE]") return null;
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 厂商在流中发出的错误事件 → CoreProtocolError（5xx 语义按可重试处理） */
function throwStreamError(protocolId: string, error: unknown): never {
  const e = isRecord(error) ? error : {};
  const code = textOrEmpty(e.code) || textOrEmpty(e.type);
  const message = textOrEmpty(e.message) || JSON.stringify(error).slice(0, 200);
  const overloaded = /overload|server_error|internal/i.test(code + message);
  throw new CoreProtocolError({
    kind: "http_error",
    status: overloaded ? 503 : 400,
    message: `${protocolId} stream error: ${code ? `${code}: ` : ""}${message}`,
    upstreamMessage: message,
  });
}

/** 累加器公共骨架：文本增量 + id/model/usage 汇总 */
function makeAccumulator(input: {
  protocolId: string;
  request: CoreRequest;
  onDelta?: (text: string) => void;
  onEvent: (
    data: Record<string, unknown>,
    evt: WireStreamEvent,
    acc: {
      push: (text: string) => void;
      set: (patch: { id?: string; model?: string; usage?: CoreUsage }) => void;
    },
  ) => void;
}): WireStreamAccumulator {
  const parts: string[] = [];
  let id = "";
  let model = "";
  let usage: CoreUsage = {};
  const acc = {
    push: (text: string) => {
      if (!text) return;
      parts.push(text);
      input.onDelta?.(text);
    },
    set: (patch: { id?: string; model?: string; usage?: CoreUsage }) => {
      if (patch.id) id = patch.id;
      if (patch.model) model = patch.model;
      if (patch.usage) usage = { ...usage, ...patch.usage };
    },
  };
  return {
    onEvent(evt) {
      const data = parseData(evt);
      if (!data) return;
      if (isRecord(data.error)) throwStreamError(input.protocolId, data.error);
      input.onEvent(data, evt, acc);
    },
    finish() {
      const text = parts.join("").trim();
      if (!text) {
        throw new CoreProtocolError({
          kind: "invalid_output",
          message: `${input.protocolId}: stream produced no text`,
        });
      }
      return {
        id: id || `core-${Date.now()}`,
        model: model || input.request.model,
        text,
        usage,
      };
    },
  };
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
  toWireStream(target, request) {
    const wire = this.toWire(target, request);
    return { ...wire, body: { ...(wire.body as object), stream: true } };
  },
  createAccumulator(request, onDelta) {
    return makeAccumulator({
      protocolId: this.id,
      request,
      onDelta,
      onEvent(data, _evt, acc) {
        acc.set({ id: textOrEmpty(data.id), model: textOrEmpty(data.model) });
        const choices = Array.isArray(data.choices) ? data.choices : [];
        const first = isRecord(choices[0]) ? choices[0] : undefined;
        const delta = first && isRecord(first.delta) ? first.delta : undefined;
        acc.push(textOrEmpty(delta?.content));
        if (isRecord(data.usage)) {
          acc.set({
            usage: {
              promptTokens: Number(data.usage.prompt_tokens) || undefined,
              completionTokens: Number(data.usage.completion_tokens) || undefined,
              totalTokens: Number(data.usage.total_tokens) || undefined,
            },
          });
        }
      },
    });
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
    // 只取 type=message 的 item——跳过 reasoning 等非正文项，避免思考文本混入制品
    let text = textOrEmpty(payload.output_text).trim();
    if (!text && Array.isArray(payload.output)) {
      const parts: string[] = [];
      for (const item of payload.output) {
        if (!isRecord(item) || item.type !== "message") continue;
        if (!Array.isArray(item.content)) continue;
        for (const c of item.content) {
          if (isRecord(c) && c.type === "output_text" && typeof c.text === "string") {
            parts.push(c.text);
          }
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
  toWireStream(target, request) {
    const wire = this.toWire(target, request);
    return { ...wire, body: { ...(wire.body as object), stream: true } };
  },
  createAccumulator(request, onDelta) {
    const protocol = this;
    let completed: CoreResponse | null = null;
    const base = makeAccumulator({
      protocolId: this.id,
      request,
      onDelta,
      onEvent(data, _evt, acc) {
        const type = textOrEmpty(data.type);
        if (type === "response.output_text.delta") {
          acc.push(textOrEmpty(data.delta));
          return;
        }
        if (type === "response.completed" && isRecord(data.response)) {
          // 终帧带完整 response 对象：id/model/usage 以它为准
          const r = data.response;
          const usage = isRecord(r.usage) ? r.usage : {};
          acc.set({
            id: textOrEmpty(r.id),
            model: textOrEmpty(r.model),
            usage: {
              promptTokens: Number(usage.input_tokens) || undefined,
              completionTokens: Number(usage.output_tokens) || undefined,
              totalTokens: Number(usage.total_tokens) || undefined,
            },
          });
          try {
            completed = protocol.fromWire(r, request);
          } catch {
            completed = null;
          }
          return;
        }
        if (
          (type === "response.failed" || type === "response.incomplete") &&
          isRecord(data.response)
        ) {
          const err = isRecord(data.response.error) ? data.response.error : {};
          throwStreamError(protocol.id, {
            code: err.code ?? type,
            message: err.message ?? `responses stream ${type}`,
          });
        }
      },
    });
    return {
      onEvent: (evt) => base.onEvent(evt),
      finish() {
        // 有些网关不发 output_text.delta，只在终帧给完整对象——用它兜底
        try {
          return base.finish();
        } catch (error) {
          if (completed) return completed;
          throw error;
        }
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
  toWireStream(target, request) {
    const wire = this.toWire(target, request);
    return { ...wire, body: { ...(wire.body as object), stream: true } };
  },
  createAccumulator(request, onDelta) {
    return makeAccumulator({
      protocolId: this.id,
      request,
      onDelta,
      onEvent(data, _evt, acc) {
        const type = textOrEmpty(data.type);
        if (type === "message_start" && isRecord(data.message)) {
          const usage = isRecord(data.message.usage) ? data.message.usage : {};
          acc.set({
            id: textOrEmpty(data.message.id),
            model: textOrEmpty(data.message.model),
            usage: { promptTokens: Number(usage.input_tokens) || undefined },
          });
          return;
        }
        if (type === "content_block_delta" && isRecord(data.delta)) {
          // 只取正文增量；thinking_delta 等跳过
          if (data.delta.type === "text_delta") acc.push(textOrEmpty(data.delta.text));
          return;
        }
        if (type === "message_delta" && isRecord(data.usage)) {
          acc.set({
            usage: { completionTokens: Number(data.usage.output_tokens) || undefined },
          });
        }
      },
    });
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
  toWireStream(target, request) {
    const wire = this.toWire(target, request);
    // 流式走 streamGenerateContent + alt=sse；保留原 query（key）
    const url = wire.url.replace(":generateContent", ":streamGenerateContent");
    const sep = url.includes("?") ? "&" : "?";
    return { ...wire, url: `${url}${sep}alt=sse` };
  },
  createAccumulator(request, onDelta) {
    return makeAccumulator({
      protocolId: this.id,
      request,
      onDelta,
      onEvent(data, _evt, acc) {
        const candidates = Array.isArray(data.candidates) ? data.candidates : [];
        const first = isRecord(candidates[0]) ? candidates[0] : undefined;
        const content = first && isRecord(first.content) ? first.content : undefined;
        const parts = content && Array.isArray(content.parts) ? content.parts : [];
        for (const p of parts) {
          // thought:true 为思考轨迹，不入正文
          if (isRecord(p) && typeof p.text === "string" && p.thought !== true) {
            acc.push(p.text);
          }
        }
        if (isRecord(data.usageMetadata)) {
          acc.set({
            usage: {
              promptTokens: Number(data.usageMetadata.promptTokenCount) || undefined,
              completionTokens:
                Number(data.usageMetadata.candidatesTokenCount) || undefined,
              totalTokens: Number(data.usageMetadata.totalTokenCount) || undefined,
            },
          });
        }
      },
    });
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
