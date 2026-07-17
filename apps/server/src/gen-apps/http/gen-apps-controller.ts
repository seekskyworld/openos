import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  parseGenAppSuggestion,
  type GenAppApiError,
  type GenAppErrorCode,
  GEN_APP_ERROR_CODES,
} from "@openos/shared";
import type { GenAppsService } from "../gen-apps-service.js";

/**
 * HTTP Controller adapter：只做传输映射。
 * 不拼 Prompt、不做 SQL、不操作窗口。
 */

type SendJson = (res: ServerResponse, status: number, body: unknown) => void;
type ReadBody = (req: IncomingMessage) => Promise<string>;

type ProgressPort = {
  bind(key: string | null): void;
  get(key: string): { phase: string; round?: number; outcome?: string };
};

type ControllerDeps = {
  service: GenAppsService;
  sendJson: SendJson;
  readBody: ReadBody;
  /** agentic 进度；fast/fake 可省略 */
  progress?: ProgressPort;
};

function isKnownCode(code: unknown): code is GenAppErrorCode {
  return (
    typeof code === "string" &&
    (GEN_APP_ERROR_CODES as readonly string[]).includes(code)
  );
}

function toErrorBody(error: unknown, requestId: string): {
  status: number;
  body: GenAppApiError;
} {
  const err = error as Error & {
    code?: string;
    status?: number;
    retryable?: boolean;
  };
  const code: GenAppErrorCode = isKnownCode(err.code) ? err.code : "internal_error";
  const status =
    typeof err.status === "number" && err.status >= 400 && err.status < 600
      ? err.status
      : 500;
  return {
    status,
    body: {
      error: {
        code,
        message: err.message || "Internal error",
        requestId,
        retryable: Boolean(err.retryable),
      },
    },
  };
}

export class GenAppsController {
  constructor(private readonly deps: ControllerDeps) {}

  /**
   * 路由分发；命中返回 true。
   * 挂载点：/api/gen-apps*
   */
  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    pathname: string,
  ): Promise<boolean> {
    if (!pathname.startsWith("/api/gen-apps")) return false;
    const { service, sendJson, readBody } = this.deps;
    const requestId = `gar-${randomUUID()}`;

    const abort = new AbortController();
    // 客户端断开检测必须挂在 res（连接关闭）上；
    // req 的 close 在请求体读完后即触发，会误杀长时生成。
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    const context = { requestId, signal: abort.signal };

    try {
      if (method === "POST" && pathname === "/api/gen-apps/suggestions") {
        const payload = await this.parseJson(req, requestId, res);
        if (payload === undefined) return true;
        const suggestions = await service.suggest(
          {
            query: String((payload as Record<string, unknown>).query ?? ""),
            count: (payload as Record<string, unknown>).count as number | undefined,
          },
          context,
        );
        sendJson(res, 200, { suggestions, requestId });
        return true;
      }

      // 流式生成：SSE 推 delta/phase/done/error，窗口先开、内容边生成边渲染
      if (method === "POST" && pathname === "/api/gen-apps/drafts/stream") {
        const payload = await this.parseJson(req, requestId, res);
        if (payload === undefined) return true;
        const record = payload as Record<string, unknown>;
        const suggestion = parseGenAppSuggestion(record.suggestion);
        if (!suggestion) {
          sendJson(res, 400, {
            error: {
              code: "validation_failed",
              message: "suggestion is invalid.",
              requestId,
              retryable: false,
            },
          } satisfies GenAppApiError);
          return true;
        }
        const idempotencyKey = String(record.idempotencyKey ?? "");
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        const emit = (event: string, data: unknown) => {
          if (res.writableEnded) return;
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        this.deps.progress?.bind(idempotencyKey || null);
        try {
          const draft = await service.generateDraft(
            {
              suggestion,
              query: String(record.query ?? ""),
              idempotencyKey,
            },
            context,
            {
              onDelta: (text) => emit("delta", { text }),
              onPhase: (phase) => emit("phase", phase),
            },
          );
          emit("done", { draft, requestId });
        } catch (error) {
          const { body } = toErrorBody(error, requestId);
          emit("error", body);
        } finally {
          this.deps.progress?.bind(null);
          res.end();
        }
        return true;
      }

      if (method === "POST" && pathname === "/api/gen-apps/drafts") {
        const payload = await this.parseJson(req, requestId, res);
        if (payload === undefined) return true;
        const record = payload as Record<string, unknown>;
        const suggestion = parseGenAppSuggestion(record.suggestion);
        if (!suggestion) {
          sendJson(res, 400, {
            error: {
              code: "validation_failed",
              message: "suggestion is invalid.",
              requestId,
              retryable: false,
            },
          } satisfies GenAppApiError);
          return true;
        }
        const idempotencyKey = String(record.idempotencyKey ?? "");
        // 绑定进度键：agentic 循环期间可被前端轮询
        this.deps.progress?.bind(idempotencyKey || null);
        try {
          const draft = await service.generateDraft(
            {
              suggestion,
              query: String(record.query ?? ""),
              idempotencyKey,
            },
            context,
          );
          sendJson(res, 200, { draft, requestId });
        } finally {
          this.deps.progress?.bind(null);
        }
        return true;
      }

      // 进度轮询：未知 key 返回 { phase: "unknown" } 200
      const progressMatch = pathname.match(
        /^\/api\/gen-apps\/progress\/([^/]+)$/,
      );
      if (method === "GET" && progressMatch) {
        const key = decodeURIComponent(progressMatch[1]);
        const progress = this.deps.progress?.get(key) ?? { phase: "unknown" };
        sendJson(res, 200, { ...progress, requestId });
        return true;
      }

      if (method === "GET" && pathname === "/api/gen-apps") {
        sendJson(res, 200, { apps: service.list(), requestId });
        return true;
      }

      const idMatch = pathname.match(
        /^\/api\/gen-apps\/([^/]+)(\/install|\/launch|\/continue)?$/,
      );
      if (idMatch) {
        const appId = decodeURIComponent(idMatch[1]);
        const action = idMatch[2];

        if (method === "POST" && action === "/continue") {
          const payload = await this.parseJson(req, requestId, res);
          if (payload === undefined) return true;
          const record = payload as Record<string, unknown>;
          const result = await service.continueContent(
            {
              appId,
              intent: record.intent,
              prompt: record.prompt,
              context: record.context,
              sessionId: record.sessionId,
              targetId: record.targetId,
              currentHtml: record.currentHtml,
            },
            context,
          );
          sendJson(res, 200, { fragment: result.fragment, requestId });
          return true;
        }

        if (method === "POST" && action === "/install") {
          const summary = service.install(appId);
          sendJson(res, 200, { summary, requestId });
          return true;
        }
        if (method === "POST" && action === "/launch") {
          const bundle = service.launch(appId);
          sendJson(res, 200, { bundle, requestId });
          return true;
        }
        if (method === "DELETE" && !action) {
          service.remove(appId);
          sendJson(res, 200, { ok: true, requestId });
          return true;
        }
      }

      sendJson(res, 404, {
        error: {
          code: "app_not_found",
          message: `No gen-apps route for ${method} ${pathname}`,
          requestId,
          retryable: false,
        },
      } satisfies GenAppApiError);
      return true;
    } catch (error) {
      const { status, body } = toErrorBody(error, requestId);
      sendJson(res, status, body);
      return true;
    }
  }

  private async parseJson(
    req: IncomingMessage,
    requestId: string,
    res: ServerResponse,
  ): Promise<unknown | undefined> {
    const raw = await this.deps.readBody(req);
    try {
      return JSON.parse(raw || "{}");
    } catch {
      this.deps.sendJson(res, 400, {
        error: {
          code: "validation_failed",
          message: "Request body must be JSON.",
          requestId,
          retryable: false,
        },
      } satisfies GenAppApiError);
      return undefined;
    }
  }
}
