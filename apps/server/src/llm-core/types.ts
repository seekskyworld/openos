/**
 * LLM Core：OpenOS 自有内部协议（参考 opencode 的分层思想，独立实现）。
 *
 * 分层：
 *   调用方 → CoreRequest（内部规范协议）
 *          → WireProtocol 适配器（openai-chat / openai-responses / anthropic / gemini）
 *          → HTTP wire 请求/响应
 *          → CoreResponse（内部规范协议）
 *
 * 好处：调用方只面向 CoreRequest/CoreResponse；协议差异（system 角色限制、
 * temperature 支持、字段命名）全部收敛在适配器；同一请求可在失败时
 * 重新emit 到另一个 wire 协议（协议转换/降级）。
 */

export type CoreRole = "system" | "user" | "assistant";

export type CoreMessage = {
  role: CoreRole;
  content: string;
};

export type CoreRequest = {
  model: string;
  messages: CoreMessage[];
  /** 采样温度；协议不支持时由适配器丢弃 */
  temperature?: number;
  maxOutputTokens?: number;
  /** 推理强度（off 不传） */
  reasoningEffort?: "off" | "minimal" | "low" | "medium" | "high";
};

export type CoreUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type CoreResponse = {
  id: string;
  model: string;
  text: string;
  usage: CoreUsage;
};

export type WireAuthStyle = "bearer" | "x-api-key" | "query" | "none";

export type WireTarget = {
  baseUrl: string;
  apiKey: string;
  authStyle: WireAuthStyle;
};

/** 适配器产出的 HTTP 描述（不含执行） */
export type WireHttpRequest = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

/** 单个 wire 协议适配器：内部协议 ↔ 厂商格式 */
export interface WireProtocol {
  readonly id: string;
  toWire(target: WireTarget, request: CoreRequest): WireHttpRequest;
  /** 解析成功响应；格式不符时抛 CoreProtocolError(kind="invalid_output") */
  fromWire(payload: unknown, request: CoreRequest): CoreResponse;
}

export type CoreErrorKind =
  | "http_error"
  | "invalid_output"
  | "network"
  | "timeout";

export class CoreProtocolError extends Error {
  readonly kind: CoreErrorKind;
  readonly status?: number;
  readonly upstreamMessage?: string;

  constructor(input: {
    kind: CoreErrorKind;
    message: string;
    status?: number;
    upstreamMessage?: string;
  }) {
    super(input.message);
    this.kind = input.kind;
    this.status = input.status;
    this.upstreamMessage = input.upstreamMessage;
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
