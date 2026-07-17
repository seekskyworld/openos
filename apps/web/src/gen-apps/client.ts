import {
  parseGenAppArtifact,
  parseGenAppError,
  parseGenAppSuggestion,
  parseGenAppSummary,
  type GenAppDraft,
  type GenAppErrorCode,
  type GenAppLaunchBundle,
  type GenAppSuggestion,
  type GenAppSummary,
} from "@openos/shared";
import { BRIDGE_TOKEN_HEADER } from "@openos/shared";

/**
 * GenAppsClient port + HTTP adapter。
 * 抛出结构化 GenAppClientError（status/code/requestId/retryable），
 * 响应经运行时 schema 校验，不做纯 TS 强转。
 */

export class GenAppClientError extends Error {
  readonly status: number;
  readonly code: GenAppErrorCode;
  readonly requestId: string;
  readonly retryable: boolean;

  constructor(input: {
    status: number;
    code: GenAppErrorCode;
    message: string;
    requestId: string;
    retryable: boolean;
  }) {
    super(input.message);
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId;
    this.retryable = input.retryable;
  }
}

export type GenAppProgress = {
  phase: string;
  round?: number;
  outcome?: string;
};

export interface GenAppsClient {
  suggest(
    query: string,
    count: number | undefined,
    signal: AbortSignal,
  ): Promise<GenAppSuggestion[]>;
  generateDraft(
    suggestion: GenAppSuggestion,
    query: string,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<GenAppDraft>;
  install(appId: string): Promise<GenAppSummary>;
  list(): Promise<GenAppSummary[]>;
  launch(appId: string): Promise<GenAppLaunchBundle>;
  remove(appId: string): Promise<void>;
  /** agentic 进度轮询；未知 key 返回 phase=unknown */
  progress?(key: string, signal?: AbortSignal): Promise<GenAppProgress>;
  /** 运行时续生成（应用内 OpenOS.generate 中继） */
  continueContent(
    appId: string,
    payload: { intent: string; prompt: string; context?: string },
  ): Promise<string>;
}

function resolveConfig(): { apiBase: string; bridgeToken: string } {
  const desktop = window.openosDesktop;
  if (desktop?.apiBase) {
    return {
      apiBase: desktop.apiBase.replace(/\/$/, ""),
      bridgeToken: desktop.bridgeToken || "",
    };
  }
  return { apiBase: "/api", bridgeToken: "" };
}

async function request(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const config = resolveConfig();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (config.bridgeToken) headers.set(BRIDGE_TOKEN_HEADER, config.bridgeToken);

  const response = await fetch(`${config.apiBase}${path}`, { ...init, headers });
  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new GenAppClientError({
      status: response.status,
      code: "internal_error",
      message: `Non-JSON response (${response.status})`,
      requestId: "",
      retryable: false,
    });
  }

  if (!response.ok) {
    const parsed = parseGenAppError(body);
    throw new GenAppClientError({
      status: response.status,
      code: parsed?.code ?? "internal_error",
      message: parsed?.message ?? `HTTP ${response.status}`,
      requestId: parsed?.requestId ?? "",
      retryable: parsed?.retryable ?? false,
    });
  }
  return body;
}

function badPayload(context: string): never {
  throw new GenAppClientError({
    status: 500,
    code: "internal_error",
    message: `Malformed ${context} payload from bridge.`,
    requestId: "",
    retryable: false,
  });
}

function parseDraft(v: unknown): GenAppDraft {
  const record = v as Record<string, unknown>;
  const summary = parseGenAppSummary(record?.summary);
  const artifact = parseGenAppArtifact(record?.artifact);
  if (!summary || !artifact || typeof record.draftExpiresAt !== "number") {
    badPayload("draft");
  }
  return { summary, artifact, draftExpiresAt: record.draftExpiresAt as number };
}

export class HttpGenAppsClient implements GenAppsClient {
  async suggest(
    query: string,
    count: number | undefined,
    signal: AbortSignal,
  ): Promise<GenAppSuggestion[]> {
    const body = (await request("/gen-apps/suggestions", {
      method: "POST",
      body: JSON.stringify({ query, count }),
      signal,
    })) as Record<string, unknown>;
    const list = Array.isArray(body.suggestions) ? body.suggestions : [];
    const parsed = list
      .map(parseGenAppSuggestion)
      .filter((s): s is GenAppSuggestion => s !== null);
    if (parsed.length === 0 && list.length > 0) badPayload("suggestions");
    return parsed;
  }

  async generateDraft(
    suggestion: GenAppSuggestion,
    query: string,
    idempotencyKey: string,
    signal: AbortSignal,
  ): Promise<GenAppDraft> {
    const body = (await request("/gen-apps/drafts", {
      method: "POST",
      body: JSON.stringify({ suggestion, query, idempotencyKey }),
      signal,
    })) as Record<string, unknown>;
    return parseDraft(body.draft);
  }

  async progress(key: string, signal?: AbortSignal): Promise<GenAppProgress> {
    const body = (await request(
      `/gen-apps/progress/${encodeURIComponent(key)}`,
      { method: "GET", signal },
    )) as Record<string, unknown>;
    return {
      phase: typeof body.phase === "string" ? body.phase : "unknown",
      round: typeof body.round === "number" ? body.round : undefined,
      outcome: typeof body.outcome === "string" ? body.outcome : undefined,
    };
  }

  async install(appId: string): Promise<GenAppSummary> {
    const body = (await request(
      `/gen-apps/${encodeURIComponent(appId)}/install`,
      { method: "POST" },
    )) as Record<string, unknown>;
    const summary = parseGenAppSummary(body.summary);
    if (!summary) badPayload("install");
    return summary;
  }

  async list(): Promise<GenAppSummary[]> {
    const body = (await request("/gen-apps")) as Record<string, unknown>;
    const list = Array.isArray(body.apps) ? body.apps : [];
    return list
      .map(parseGenAppSummary)
      .filter((s): s is GenAppSummary => s !== null);
  }

  async launch(appId: string): Promise<GenAppLaunchBundle> {
    const body = (await request(
      `/gen-apps/${encodeURIComponent(appId)}/launch`,
      { method: "POST" },
    )) as Record<string, unknown>;
    const record = body.bundle as Record<string, unknown>;
    const summary = parseGenAppSummary(record?.summary);
    const artifact = parseGenAppArtifact(record?.artifact);
    if (!summary || !artifact || typeof record.runtimeSessionId !== "string") {
      badPayload("launch");
    }
    return {
      summary,
      artifact,
      runtimeSessionId: record.runtimeSessionId as string,
    };
  }

  async remove(appId: string): Promise<void> {
    await request(`/gen-apps/${encodeURIComponent(appId)}`, {
      method: "DELETE",
    });
  }

  async continueContent(
    appId: string,
    payload: { intent: string; prompt: string; context?: string },
  ): Promise<string> {
    const body = (await request(
      `/gen-apps/${encodeURIComponent(appId)}/continue`,
      { method: "POST", body: JSON.stringify(payload) },
    )) as Record<string, unknown>;
    if (typeof body.fragment !== "string") badPayload("continue");
    return body.fragment;
  }
}
