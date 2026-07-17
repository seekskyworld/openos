import {
  CoreProtocolError,
  type CoreRequest,
  type CoreResponse,
  type WireTarget,
} from "./types.js";
import { resolveWireProtocol } from "./protocols.js";

/**
 * LLM Core Client：执行层。
 * - 用 protocol id + target 把 CoreRequest 编成 wire 请求并执行
 * - 遇到「协议形态不符」类失败（400/404/405 或输出解析失败）时，
 *   可按 fallback 链自动转换到下一个协议重试（如 responses → chat）
 */

export type CoreCallOptions = {
  protocol: string;
  target: WireTarget;
  timeoutMs?: number;
  /** 协议失败时的转换链（默认 responses→chat） */
  fallbackProtocols?: string[];
};

const DEFAULT_FALLBACKS: Record<string, string[]> = {
  "openai-responses": ["openai-chat"],
};

function isProtocolShapeError(error: unknown): boolean {
  if (!(error instanceof CoreProtocolError)) return false;
  if (error.kind === "invalid_output") return true;
  if (error.kind === "http_error") {
    return (
      error.status === 400 || error.status === 404 || error.status === 405
    );
  }
  return false;
}

async function callOnce(
  protocolId: string,
  options: CoreCallOptions,
  request: CoreRequest,
): Promise<CoreResponse> {
  const protocol = resolveWireProtocol(protocolId);
  const wire = protocol.toWire(options.target, request);

  const controller = new AbortController();
  const timer = options.timeoutMs
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;

  let response: Response;
  try {
    response = await fetch(wire.url, {
      method: "POST",
      headers: wire.headers,
      body: JSON.stringify(wire.body),
      signal: controller.signal,
    });
  } catch (error) {
    const aborted = controller.signal.aborted;
    throw new CoreProtocolError({
      kind: aborted ? "timeout" : "network",
      message: aborted
        ? `LLM request timed out after ${options.timeoutMs}ms`
        : `Network error: ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }

  const rawText = await response.text();
  let payload: unknown = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    throw new CoreProtocolError({
      kind: "invalid_output",
      message: `Upstream returned non-JSON (HTTP ${response.status}): ${rawText.slice(0, 160)}`,
      status: response.status,
    });
  }

  if (!response.ok) {
    const upstream =
      payload && typeof payload === "object"
        ? JSON.stringify(payload).slice(0, 240)
        : rawText.slice(0, 240);
    throw new CoreProtocolError({
      kind: "http_error",
      message: `Upstream HTTP ${response.status}: ${upstream}`,
      status: response.status,
      upstreamMessage: upstream,
    });
  }

  return protocol.fromWire(payload, request);
}

export async function coreGenerate(
  options: CoreCallOptions,
  request: CoreRequest,
): Promise<CoreResponse> {
  const chain = [
    options.protocol,
    ...(options.fallbackProtocols ?? DEFAULT_FALLBACKS[options.protocol] ?? []),
  ];

  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    try {
      return await callOnce(chain[i], options, request);
    } catch (error) {
      lastError = error;
      // 仅协议形态错误才转换到下一协议；网络/超时/鉴权类错误直接抛出
      if (i < chain.length - 1 && isProtocolShapeError(error)) {
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
