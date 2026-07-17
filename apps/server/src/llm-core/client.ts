import {
  CoreProtocolError,
  type CoreRequest,
  type CoreResponse,
  type WireHttpRequest,
  type WireTarget,
} from "./types.js";
import { resolveWireProtocol } from "./protocols.js";
import { SseParser } from "./sse.js";

/**
 * LLM Core Client：执行层（压缩复刻 opencode 的健壮性精华）。
 *
 * - 永远优先流式：SSE 每个 chunk 都会重置网关读超时，长生成不再被
 *   反代（nginx 默认 60s proxy_read_timeout）掐断——非流式仅作为
 *   「上游拒绝 stream 参数」时的单次兜底。
 * - 双层超时：headerTimeoutMs（响应头未到）+ idleTimeoutMs（流中断），
 *   替代一刀切的总超时；totalTimeoutMs 只作最外层保险。
 * - 重试：429/5xx/网络错误按指数退避重试（尊重 retry-after / retry-after-ms），
 *   鉴权与请求形态错误不重试。
 * - 协议降级：400/404/405 或输出解析失败视为「协议形态不符」，
 *   按 fallback 链转换协议重试（默认 responses → chat）。
 * - 外部 AbortSignal 与内部定时器经 AbortSignal.any 合并，取消即断连。
 */

export type CoreCallOptions = {
  protocol: string;
  target: WireTarget;
  /** 兼容旧字段：总预算（含全部重试），默认 300s */
  timeoutMs?: number;
  /** 响应头到达超时，默认 30s */
  headerTimeoutMs?: number;
  /** 流式 chunk 间隔超时，默认 60s */
  idleTimeoutMs?: number;
  /** 每协议最大尝试次数（含首次），默认 3 */
  maxAttempts?: number;
  /** 外部取消信号 */
  signal?: AbortSignal;
  /** 协议失败时的转换链（默认 responses→chat） */
  fallbackProtocols?: string[];
  /** 增量文本回调（进度展示用） */
  onDelta?: (text: string) => void;
};

const DEFAULT_FALLBACKS: Record<string, string[]> = {
  "openai-responses": ["openai-chat"],
};

const DEFAULTS = {
  totalTimeoutMs: 300_000,
  headerTimeoutMs: 30_000,
  idleTimeoutMs: 60_000,
  maxAttempts: 3,
  backoffBaseMs: 2_000,
  backoffCapMs: 30_000,
};

function isProtocolShapeError(error: unknown): boolean {
  if (!(error instanceof CoreProtocolError)) return false;
  if (error.kind === "invalid_output") return true;
  if (error.kind === "http_error") {
    return error.status === 400 || error.status === 404 || error.status === 405;
  }
  return false;
}

/** opencode 准则：5xx/429/网络/断流必重试；鉴权与形态错误不重试 */
export function isRetryableCoreError(error: unknown): boolean {
  if (!(error instanceof CoreProtocolError)) return false;
  if (error.kind === "network" || error.kind === "timeout") return true;
  if (error.kind === "http_error") {
    const s = error.status ?? 0;
    return s === 429 || s >= 500;
  }
  return false;
}

/** 上游拒绝 stream 参数（少数老网关）→ 单次非流式兜底 */
function isStreamRejectedError(error: unknown): boolean {
  return (
    error instanceof CoreProtocolError &&
    error.kind === "http_error" &&
    error.status === 400 &&
    /stream/i.test(error.upstreamMessage ?? error.message)
  );
}

function parseRetryAfter(headers: Headers): number | undefined {
  const ms = headers.get("retry-after-ms");
  if (ms && Number(ms) > 0) return Number(ms);
  const sec = headers.get("retry-after");
  if (!sec) return undefined;
  if (Number(sec) > 0) return Number(sec) * 1000;
  const date = Date.parse(sec);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function backoffDelay(attempt: number, error: unknown): number {
  if (error instanceof CoreProtocolError && error.retryAfterMs) {
    return Math.min(error.retryAfterMs, DEFAULTS.backoffCapMs);
  }
  return Math.min(DEFAULTS.backoffBaseMs * 2 ** attempt, DEFAULTS.backoffCapMs);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CoreProtocolError({ kind: "network", message: "Aborted during retry wait" }));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function httpErrorFromResponse(response: Response): Promise<CoreProtocolError> {
  const rawText = await response.text().catch(() => "");
  let upstream = rawText.slice(0, 240);
  try {
    const payload = JSON.parse(rawText);
    upstream = JSON.stringify(payload).slice(0, 240);
  } catch {
    // 网关错误页常是 HTML（如 nginx 504）——压成一行摘要
    upstream = rawText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  }
  return new CoreProtocolError({
    kind: "http_error",
    status: response.status,
    message: `Upstream HTTP ${response.status}: ${upstream || response.statusText}`,
    upstreamMessage: upstream,
    retryAfterMs: parseRetryAfter(response.headers),
  });
}

type AttemptContext = {
  options: CoreCallOptions;
  deadline: number;
};

function remainingBudget(ctx: AttemptContext): number {
  return ctx.deadline - Date.now();
}

async function doFetch(
  wire: WireHttpRequest,
  ctx: AttemptContext,
  headerTimeoutMs: number,
): Promise<{ response: Response; signal: AbortSignal; clearHeaderTimer: () => void }> {
  const budget = remainingBudget(ctx);
  if (budget <= 0) {
    throw new CoreProtocolError({
      kind: "timeout",
      message: "LLM total time budget exhausted",
    });
  }
  const headerController = new AbortController();
  const headerTimer = setTimeout(
    () => headerController.abort(new Error("header timeout")),
    Math.min(headerTimeoutMs, budget),
  );
  const signals = [headerController.signal, AbortSignal.timeout(budget)];
  if (ctx.options.signal) signals.push(ctx.options.signal);
  const merged = AbortSignal.any(signals);

  let response: Response;
  try {
    response = await fetch(wire.url, {
      method: "POST",
      headers: wire.headers,
      body: JSON.stringify(wire.body),
      signal: merged,
    });
  } catch (error) {
    clearTimeout(headerTimer);
    if (ctx.options.signal?.aborted) {
      throw new CoreProtocolError({ kind: "network", message: "Request aborted by caller" });
    }
    const timedOut = headerController.signal.aborted || merged.aborted;
    throw new CoreProtocolError({
      kind: timedOut ? "timeout" : "network",
      message: timedOut
        ? `No response headers within ${headerTimeoutMs}ms`
        : `Network error: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return { response, signal: merged, clearHeaderTimer: () => clearTimeout(headerTimer) };
}

/** 流式单次调用 */
async function streamOnce(
  protocolId: string,
  ctx: AttemptContext,
  request: CoreRequest,
): Promise<CoreResponse> {
  const { options } = ctx;
  const protocol = resolveWireProtocol(protocolId);
  const wire = protocol.toWireStream(options.target, request);
  wire.headers.accept = "text/event-stream";

  const headerTimeoutMs = options.headerTimeoutMs ?? DEFAULTS.headerTimeoutMs;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULTS.idleTimeoutMs;

  const { response, clearHeaderTimer } = await doFetch(wire, ctx, headerTimeoutMs);
  clearHeaderTimer();

  if (!response.ok) throw await httpErrorFromResponse(response);

  const contentType = response.headers.get("content-type") ?? "";
  // 个别网关无视 stream 参数直接回 JSON——按非流式解析
  if (!contentType.includes("event-stream")) {
    const rawText = await response.text();
    try {
      return protocol.fromWire(JSON.parse(rawText), request);
    } catch (error) {
      if (error instanceof CoreProtocolError) throw error;
      throw new CoreProtocolError({
        kind: "invalid_output",
        message: `Upstream returned non-SSE non-JSON (HTTP ${response.status}): ${rawText.slice(0, 160)}`,
        status: response.status,
      });
    }
  }

  if (!response.body) {
    throw new CoreProtocolError({ kind: "invalid_output", message: "Upstream returned empty stream body" });
  }

  const accumulator = protocol.createAccumulator(request, options.onDelta);
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idleAbort: (() => void) | undefined;
  const idlePromise = new Promise<never>((_, reject) => {
    idleAbort = () => {
      reject(
        new CoreProtocolError({
          kind: "timeout",
          message: `Stream stalled: no data within ${idleTimeoutMs}ms`,
        }),
      );
      void reader.cancel().catch(() => undefined);
    };
  });
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idleAbort?.(), idleTimeoutMs);
  };

  try {
    resetIdle();
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), idlePromise]);
      if (options.signal?.aborted) {
        throw new CoreProtocolError({ kind: "network", message: "Request aborted by caller" });
      }
      if (done) break;
      resetIdle();
      for (const evt of parser.push(decoder.decode(value, { stream: true }))) {
        accumulator.onEvent(evt);
      }
    }
    for (const evt of parser.flush()) accumulator.onEvent(evt);
    return accumulator.finish();
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof CoreProtocolError) throw error;
    throw new CoreProtocolError({
      kind: "network",
      message: `Stream read error: ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}

/** 非流式单次调用（仅作 stream 被拒时的兜底） */
async function callOnce(
  protocolId: string,
  ctx: AttemptContext,
  request: CoreRequest,
): Promise<CoreResponse> {
  const protocol = resolveWireProtocol(protocolId);
  const wire = protocol.toWire(ctx.options.target, request);
  const { response, clearHeaderTimer } = await doFetch(
    wire,
    ctx,
    ctx.options.headerTimeoutMs ?? DEFAULTS.headerTimeoutMs,
  );
  clearHeaderTimer();
  if (!response.ok) throw await httpErrorFromResponse(response);
  const rawText = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new CoreProtocolError({
      kind: "invalid_output",
      message: `Upstream returned non-JSON (HTTP ${response.status}): ${rawText.slice(0, 160)}`,
      status: response.status,
    });
  }
  return protocol.fromWire(payload, request);
}

async function attemptProtocol(
  protocolId: string,
  ctx: AttemptContext,
  request: CoreRequest,
): Promise<CoreResponse> {
  const maxAttempts = ctx.options.maxAttempts ?? DEFAULTS.maxAttempts;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await streamOnce(protocolId, ctx, request);
    } catch (error) {
      lastError = error;
      if (ctx.options.signal?.aborted) throw error;
      if (isStreamRejectedError(error)) {
        return callOnce(protocolId, ctx, request);
      }
      const retryable = isRetryableCoreError(error);
      const delay = backoffDelay(attempt, error);
      const enoughBudget = remainingBudget(ctx) > delay + 5_000;
      if (retryable && attempt < maxAttempts - 1 && enoughBudget) {
        await sleep(delay, ctx.options.signal);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function coreGenerate(
  options: CoreCallOptions,
  request: CoreRequest,
): Promise<CoreResponse> {
  const ctx: AttemptContext = {
    options,
    deadline: Date.now() + (options.timeoutMs ?? DEFAULTS.totalTimeoutMs),
  };
  const chain = [
    options.protocol,
    ...(options.fallbackProtocols ?? DEFAULT_FALLBACKS[options.protocol] ?? []),
  ];

  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    try {
      return await attemptProtocol(chain[i], ctx, request);
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) throw error;
      // 仅协议形态错误才转换到下一协议；重试已在 attemptProtocol 内做完
      if (i < chain.length - 1 && isProtocolShapeError(error)) {
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
