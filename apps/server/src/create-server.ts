import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  BRIDGE_TOKEN_HEADER,
  getLlmProviderMeta,
  isLlmProviderId,
  type ApiErrorBody,
  type BootstrapInfo,
  type ChatRequest,
  type HealthResponse,
  type LlmModelsRequest,
  type LlmModelsResponse,
  type LlmSettingsUpdate,
  type LlmTestRequest,
  type LlmTestResponse,
  type ProviderAuthActivateRequest,
  type ProviderAuthRemoveRequest,
  type ProviderAuthSetRequest,
  type ProviderOauthAuthorizeRequest,
  type ProviderOauthCallbackRequest,
} from "@openos/shared";
import { loadServerEnv, type ServerEnv } from "./env.js";
import {
  appendMessage,
  createThread,
  deleteThread,
  listMessages,
  listThreads,
  renameThread,
} from "./chat-store.js";
import {
  chatCompletion,
  discoverRemoteModels,
  mockChatCompletion,
  testLlmConnection,
} from "./llm.js";
import {
  getPublicLlmSettings,
  resolveEffectiveLlm,
  updateLlmSettings,
  type PersistedLlmSettings,
} from "./settings-store.js";
import {
  listProviderAuth,
  removeAuth,
  setAuth,
} from "./auth-store.js";
import { completeOauthCallback, startOauthAuthorize } from "./oauth.js";
import { getOpenOsDatabase } from "./database/openos-database.js";
import { SettingsSwitchedGenerator } from "./gen-apps/agent/agentic-generator.js";
import { GenAppsService } from "./gen-apps/gen-apps-service.js";
import { GenAppsController } from "./gen-apps/http/gen-apps-controller.js";
import { DeterministicFakeGenerator } from "./gen-apps/infrastructure/deterministic-fake-generator.js";
import {
  agenticBudgetMs,
  loadGenAppsSettings,
  saveGenAppsSettings,
} from "./gen-apps/gen-app-settings.js";
import { SqliteGenAppRepository } from "./gen-apps/infrastructure/sqlite-gen-app-repository.js";

export type BridgeReadyInfo = {
  host: string;
  port: number;
  url: string;
  apiBase: string;
  authMode: "bridge-token" | "open";
  channel: ServerEnv["channel"];
  pid: number;
};

type CreateOptions = {
  env?: ServerEnv;
  onListening?: (info: BridgeReadyInfo) => void;
};

const startedAt = Date.now();

export function startBridgeServer(options: CreateOptions = {}) {
  const env = options.env ?? loadServerEnv();
  const authMode: BootstrapInfo["authMode"] = env.bridgeToken ? "bridge-token" : "open";

  // 组合根：装配 Gen Apps 模块。
  // 默认走 SettingsSwitched（fast/agentic 热切换）；
  // OPENOS_GENAPPS_FAKE=1 强制确定性 fake（开发/测试）。
  const switchedGenerator =
    process.env.OPENOS_GENAPPS_FAKE === "1"
      ? null
      : new SettingsSwitchedGenerator(env);
  const genAppsGenerator =
    switchedGenerator ?? new DeterministicFakeGenerator();
  const genAppsController = new GenAppsController({
    service: new GenAppsService({
      generator: genAppsGenerator,
      repository: new SqliteGenAppRepository(getOpenOsDatabase(env)),
      defaultSuggestionCount: () => loadGenAppsSettings(env).suggestionCount,
      // agent 循环整体预算随轮次伸缩（无限模式 10 分钟兜底）；fast 路径 90s
      generateTimeoutMs: () => {
        const s = loadGenAppsSettings(env);
        return s.generationMode === "agentic"
          ? agenticBudgetMs(s.agentMaxRounds)
          : 90_000;
      },
    }),
    sendJson,
    readBody,
    progress: switchedGenerator
      ? {
          bind: (key) => switchedGenerator.bindProgressKey(key),
          get: (key) => switchedGenerator.getProgressPublic(key),
        }
      : undefined,
  });

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, env, authMode, genAppsController);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, {
        error: { code: "internal_error", message },
      } satisfies ApiErrorBody);
    }
  });

  // loopback 本地桥：放开 Node 默认 5 分钟 requestTimeout，
  // 否则多轮 agent 生成的长 POST 会被 HTTP 层掐断
  server.requestTimeout = 0;

  server.listen(env.port, env.host, () => {
    const address = server.address();
    const port =
      address && typeof address === "object" ? address.port : env.port;
    const url = `http://${env.host}:${port}`;
    const info: BridgeReadyInfo = {
      host: env.host,
      port,
      url,
      apiBase: `${url}/api`,
      authMode,
      channel: env.channel,
      pid: process.pid,
    };
    options.onListening?.(info);
  });

  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: ServerEnv,
  authMode: BootstrapInfo["authMode"],
  genAppsController: GenAppsController,
) {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${env.host}`);

  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // 健康检查可无鉴权，便于桌面 supervisor 探测
  if (method === "GET" && url.pathname === "/api/health") {
    const body: HealthResponse = {
      ok: true,
      service: "openos-bridge",
      channel: env.channel,
      uptimeMs: Date.now() - startedAt,
    };
    sendJson(res, 200, body);
    return;
  }

  if (!authorize(req, env)) {
    sendJson(res, 401, {
      error: {
        code: "unauthorized",
        message: "Missing or invalid bridge token.",
      },
    } satisfies ApiErrorBody);
    return;
  }

  // Gen Apps 设置（独立文件，不与 LLM 设置互相覆盖）
  if (url.pathname === "/api/settings/gen-apps") {
    if (method === "GET") {
      sendJson(res, 200, { settings: loadGenAppsSettings(env) });
      return;
    }
    if (method === "PUT") {
      const raw = await readBody(req);
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(raw || "{}");
      } catch {
        sendJson(res, 400, {
          error: { code: "bad_json", message: "Request body must be JSON." },
        } satisfies ApiErrorBody);
        return;
      }
      const settings = saveGenAppsSettings(env, {
        suggestionCount: payload.suggestionCount as number | undefined,
        creativity: payload.creativity as number | undefined,
        appLanguage: payload.appLanguage as never,
        generationMode: payload.generationMode as never,
        agentMaxRounds: payload.agentMaxRounds as number | undefined,
      });
      sendJson(res, 200, { settings });
      return;
    }
  }

  // Gen Apps 模块：Controller 自处理其 /api/gen-apps* 路由
  if (await genAppsController.handle(req, res, method, url.pathname)) {
    return;
  }

  if (method === "GET" && url.pathname === "/api/bootstrap") {
    const llm = resolveEffectiveLlm(env);
    const body: BootstrapInfo = {
      appName: env.channel === "stable" ? "OpenOS" : "OpenOS Dev",
      version: "0.1.0",
      channel: env.channel,
      apiBase: `http://${env.host}:${env.port}/api`,
      authMode,
      llm: {
        provider: llm.provider,
        model: llm.model,
        configured: Boolean(llm.apiKey && llm.apiKey !== "no-key") || llm.authStyle === "none",
        baseUrl: llm.baseUrl,
        protocol: llm.protocol,
        profile: llm.profile,
      },
    };
    sendJson(res, 200, body);
    return;
  }

  if (method === "GET" && url.pathname === "/api/settings/llm") {
    sendJson(res, 200, getPublicLlmSettings(env));
    return;
  }

  // —— Provider Auth（对齐 OpenCode Providers 页）——
  if (method === "GET" && url.pathname === "/api/auth/providers") {
    const current = resolveEffectiveLlm(env);
    sendJson(
      res,
      200,
      listProviderAuth(env, {
        provider: current.provider,
        model: current.model,
      }),
    );
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/set") {
    const raw = await readBody(req);
    let payload: ProviderAuthSetRequest;
    try {
      payload = JSON.parse(raw || "{}") as ProviderAuthSetRequest;
    } catch {
      sendJson(res, 400, {
        error: { code: "bad_json", message: "Request body must be JSON." },
      } satisfies ApiErrorBody);
      return;
    }
    if (!payload.providerId?.trim() || !payload.key?.trim()) {
      sendJson(res, 400, {
        error: {
          code: "invalid_auth",
          message: "providerId and key are required.",
        },
      } satisfies ApiErrorBody);
      return;
    }
    setAuth(env, payload.providerId.trim(), {
      type: "api",
      key: payload.key.trim(),
    });
    // 仅当显式 activate=true 且带了 model 时才激活；默认只保存凭证
    if (
      payload.activate === true &&
      payload.model?.trim() &&
      isLlmProviderId(payload.providerId)
    ) {
      const meta = getLlmProviderMeta(payload.providerId);
      updateLlmSettings(env, {
        provider: payload.providerId,
        model: payload.model.trim(),
        baseUrl: meta.defaultBaseUrl,
        apiKey: payload.key.trim(),
      });
    }
    const current = resolveEffectiveLlm(env);
    sendJson(
      res,
      200,
      listProviderAuth(env, {
        provider: current.provider,
        model: current.model,
      }),
    );
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/activate") {
    const raw = await readBody(req);
    let payload: ProviderAuthActivateRequest;
    try {
      payload = JSON.parse(raw || "{}") as ProviderAuthActivateRequest;
    } catch {
      sendJson(res, 400, {
        error: { code: "bad_json", message: "Request body must be JSON." },
      } satisfies ApiErrorBody);
      return;
    }
    if (!payload.providerId?.trim() || !payload.model?.trim()) {
      sendJson(res, 400, {
        error: {
          code: "invalid_activate",
          message: "providerId and model are required.",
        },
      } satisfies ApiErrorBody);
      return;
    }
    if (!isLlmProviderId(payload.providerId) && payload.providerId !== "github-copilot") {
      sendJson(res, 400, {
        error: {
          code: "invalid_provider",
          message: `Unknown provider: ${payload.providerId}`,
        },
      } satisfies ApiErrorBody);
      return;
    }
    // github-copilot 暂无完整 LLM 路由时，仍允许写入 settings 若在目录内
    if (isLlmProviderId(payload.providerId)) {
      const meta = getLlmProviderMeta(payload.providerId);
      updateLlmSettings(env, {
        provider: payload.providerId,
        model: payload.model.trim(),
        baseUrl: meta.defaultBaseUrl,
      });
    }
    const current = resolveEffectiveLlm(env);
    sendJson(
      res,
      200,
      listProviderAuth(env, {
        provider: current.provider,
        model: current.model,
      }),
    );
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/remove") {
    const raw = await readBody(req);
    let payload: ProviderAuthRemoveRequest;
    try {
      payload = JSON.parse(raw || "{}") as ProviderAuthRemoveRequest;
    } catch {
      sendJson(res, 400, {
        error: { code: "bad_json", message: "Request body must be JSON." },
      } satisfies ApiErrorBody);
      return;
    }
    if (!payload.providerId?.trim()) {
      sendJson(res, 400, {
        error: { code: "invalid_auth", message: "providerId is required." },
      } satisfies ApiErrorBody);
      return;
    }
    removeAuth(env, payload.providerId.trim());
    const current = resolveEffectiveLlm(env);
    sendJson(
      res,
      200,
      listProviderAuth(env, {
        provider: current.provider,
        model: current.model,
      }),
    );
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/oauth/authorize") {
    const raw = await readBody(req);
    let payload: ProviderOauthAuthorizeRequest;
    try {
      payload = JSON.parse(raw || "{}") as ProviderOauthAuthorizeRequest;
    } catch {
      sendJson(res, 400, {
        error: { code: "bad_json", message: "Request body must be JSON." },
      } satisfies ApiErrorBody);
      return;
    }
    if (!payload.providerId?.trim()) {
      sendJson(res, 400, {
        error: { code: "invalid_auth", message: "providerId is required." },
      } satisfies ApiErrorBody);
      return;
    }
    try {
      const result = await startOauthAuthorize(
        env,
        payload.providerId.trim(),
        payload.method ?? 0,
      );
      sendJson(res, 200, result);
    } catch (error) {
      const err = error as Error & { code?: string };
      sendJson(res, 400, {
        error: {
          code: err.code || "oauth_error",
          message: err.message,
        },
      } satisfies ApiErrorBody);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/auth/oauth/callback") {
    const raw = await readBody(req);
    let payload: ProviderOauthCallbackRequest;
    try {
      payload = JSON.parse(raw || "{}") as ProviderOauthCallbackRequest;
    } catch {
      sendJson(res, 400, {
        error: { code: "bad_json", message: "Request body must be JSON." },
      } satisfies ApiErrorBody);
      return;
    }
    if (!payload.providerId?.trim()) {
      sendJson(res, 400, {
        error: { code: "invalid_auth", message: "providerId is required." },
      } satisfies ApiErrorBody);
      return;
    }
    try {
      // OAuth 成功只保存凭证；模型选择由前端 /auth/activate 完成
      const result = await completeOauthCallback(env, {
        providerId: payload.providerId.trim(),
        code: payload.code,
        state: payload.state,
      });
      sendJson(res, 200, result);
    } catch (error) {
      const err = error as Error & { code?: string };
      sendJson(res, 400, {
        error: {
          code: err.code || "oauth_error",
          message: err.message,
        },
      } satisfies ApiErrorBody);
    }
    return;
  }

  if (method === "PUT" && url.pathname === "/api/settings/llm") {
    const raw = await readBody(req);
    let payload: LlmSettingsUpdate;
    try {
      payload = JSON.parse(raw || "{}") as LlmSettingsUpdate;
    } catch {
      sendJson(res, 400, {
        error: { code: "bad_json", message: "Request body must be JSON." },
      } satisfies ApiErrorBody);
      return;
    }

    if (!payload.provider || !payload.model?.trim()) {
      sendJson(res, 400, {
        error: {
          code: "invalid_settings",
          message: "provider and model are required.",
        },
      } satisfies ApiErrorBody);
      return;
    }

    try {
      const next = updateLlmSettings(env, payload);
      sendJson(res, 200, next);
    } catch (error) {
      const err = error as Error & { code?: string };
      sendJson(res, 400, {
        error: {
          code: err.code || "settings_error",
          message: err.message,
        },
      } satisfies ApiErrorBody);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/settings/llm/test") {
    const raw = await readBody(req);
    let payload: LlmTestRequest = {};
    try {
      payload = JSON.parse(raw || "{}") as LlmTestRequest;
    } catch {
      sendJson(res, 400, {
        error: { code: "bad_json", message: "Request body must be JSON." },
      } satisfies ApiErrorBody);
      return;
    }

    const override: Partial<PersistedLlmSettings> = {};
    if (payload.provider) override.provider = payload.provider;
    if (payload.model) override.model = payload.model;
    if (payload.baseUrl !== undefined) override.baseUrl = payload.baseUrl;
    if (payload.protocol) override.protocol = payload.protocol;
    if (payload.authStyle) override.authStyle = payload.authStyle;
    if (payload.profile !== undefined) override.profile = payload.profile;
    if (payload.reasoningEffort) override.reasoningEffort = payload.reasoningEffort;
    if (payload.apiKey !== undefined) override.apiKey = payload.apiKey;

    const config = resolveEffectiveLlm(env, override);
    const started = Date.now();
    try {
      const needsKey = config.authStyle !== "none";
      if (needsKey && (!config.apiKey || config.apiKey === "no-key")) {
        const body: LlmTestResponse = {
          ok: false,
          provider: config.provider,
          model: config.model,
          latencyMs: Date.now() - started,
          error: {
            code: "llm_not_configured",
            message: "API key is required for connection test.",
          },
        };
        sendJson(res, 200, body);
        return;
      }

      const result = await testLlmConnection(config, payload.prompt);
      const body: LlmTestResponse = {
        ok: true,
        provider: config.provider,
        model: config.model,
        content: result.content,
        latencyMs: result.latencyMs,
      };
      sendJson(res, 200, body);
    } catch (error) {
      const err = error as Error & { code?: string };
      const body: LlmTestResponse = {
        ok: false,
        provider: config.provider,
        model: config.model,
        latencyMs: Date.now() - started,
        error: {
          code: err.code || "llm_error",
          message: err.message,
        },
      };
      sendJson(res, 200, body);
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/settings/llm/models") {
    const raw = await readBody(req);
    let payload: LlmModelsRequest = {};
    try {
      payload = JSON.parse(raw || "{}") as LlmModelsRequest;
    } catch {
      sendJson(res, 400, {
        error: { code: "bad_json", message: "Request body must be JSON." },
      } satisfies ApiErrorBody);
      return;
    }

    const override: Partial<PersistedLlmSettings> = {};
    if (payload.provider) override.provider = payload.provider;
    if (payload.baseUrl !== undefined) override.baseUrl = payload.baseUrl;
    if (payload.apiKey !== undefined) override.apiKey = payload.apiKey;
    if (payload.protocol) override.protocol = payload.protocol;
    if (payload.authStyle) override.authStyle = payload.authStyle;
    const config = resolveEffectiveLlm(env, override);
    const discovered = await discoverRemoteModels({
      provider: config.provider,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      protocol: config.protocol,
      authStyle: config.authStyle,
    });
    const body: LlmModelsResponse = {
      ok: !discovered.error,
      provider: config.provider,
      baseUrl: config.baseUrl,
      models: discovered.models,
      ...(discovered.error
        ? {
            error: {
              code: discovered.error.code || "llm_error",
              message: discovered.error.message,
            },
          }
        : {}),
    };
    sendJson(res, 200, body);
    return;
  }

  // ===== Sir 会话持久化（SQLite） =====
  if (method === "GET" && url.pathname === "/api/threads") {
    sendJson(res, 200, { threads: listThreads(env) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/threads") {
    const raw = await readBody(req);
    let payload: { id?: string; title?: string } = {};
    try {
      payload = JSON.parse(raw || "{}");
    } catch {
      sendJson(res, 400, {
        error: { code: "bad_json", message: "Request body must be JSON." },
      } satisfies ApiErrorBody);
      return;
    }
    const id = payload.id?.trim() || `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const thread = createThread(env, id, payload.title?.trim() || "New Chat");
    sendJson(res, 200, { thread });
    return;
  }

  {
    const threadMatch = url.pathname.match(/^\/api\/threads\/([^/]+)(\/messages)?$/);
    if (threadMatch) {
      const threadId = decodeURIComponent(threadMatch[1]);
      const isMessages = Boolean(threadMatch[2]);

      if (method === "GET" && isMessages) {
        sendJson(res, 200, { messages: listMessages(env, threadId) });
        return;
      }

      if (method === "POST" && isMessages) {
        const raw = await readBody(req);
        let payload: { id?: string; role?: string; content?: string } = {};
        try {
          payload = JSON.parse(raw || "{}");
        } catch {
          sendJson(res, 400, {
            error: { code: "bad_json", message: "Request body must be JSON." },
          } satisfies ApiErrorBody);
          return;
        }
        const role = payload.role;
        if (role !== "user" && role !== "assistant" && role !== "system") {
          sendJson(res, 400, {
            error: { code: "invalid_role", message: "role must be user/assistant/system." },
          } satisfies ApiErrorBody);
          return;
        }
        const content = payload.content ?? "";
        const id =
          payload.id?.trim() || `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const message = appendMessage(env, threadId, { id, role, content });
        sendJson(res, 200, { message });
        return;
      }

      if (method === "PATCH" && !isMessages) {
        const raw = await readBody(req);
        let payload: { title?: string } = {};
        try {
          payload = JSON.parse(raw || "{}");
        } catch {
          sendJson(res, 400, {
            error: { code: "bad_json", message: "Request body must be JSON." },
          } satisfies ApiErrorBody);
          return;
        }
        const title = payload.title?.trim();
        if (!title) {
          sendJson(res, 400, {
            error: { code: "invalid_title", message: "title is required." },
          } satisfies ApiErrorBody);
          return;
        }
        const ok = renameThread(env, threadId, title);
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : {
          error: { code: "not_found", message: "thread not found" },
        });
        return;
      }

      if (method === "DELETE" && !isMessages) {
        const ok = deleteThread(env, threadId);
        sendJson(res, ok ? 200 : 404, ok ? { ok: true } : {
          error: { code: "not_found", message: "thread not found" },
        });
        return;
      }
    }
  }

  if (method === "POST" && url.pathname === "/api/chat") {
    const raw = await readBody(req);
    let payload: ChatRequest;
    try {
      payload = JSON.parse(raw || "{}") as ChatRequest;
    } catch {
      sendJson(res, 400, {
        error: { code: "bad_json", message: "Request body must be JSON." },
      } satisfies ApiErrorBody);
      return;
    }

    if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
      sendJson(res, 400, {
        error: {
          code: "invalid_messages",
          message: "messages must be a non-empty array.",
        },
      } satisfies ApiErrorBody);
      return;
    }

    const llm = resolveEffectiveLlm(env);
    try {
      const hasKey =
        (Boolean(llm.apiKey) && llm.apiKey !== "no-key") ||
        llm.authStyle === "none";
      const result = hasKey
        ? await chatCompletion(llm, payload.messages, payload.model)
        : mockChatCompletion(llm, payload.messages, payload.model);
      sendJson(res, 200, result);
    } catch (error) {
      const err = error as Error & { code?: string };
      const code = err.code || "llm_error";
      const status = code === "llm_not_configured" ? 503 : 502;
      sendJson(res, status, {
        error: { code, message: err.message },
      } satisfies ApiErrorBody);
    }
    return;
  }

  sendJson(res, 404, {
    error: { code: "not_found", message: `No route for ${method} ${url.pathname}` },
  } satisfies ApiErrorBody);
}

function authorize(req: IncomingMessage, env: ServerEnv): boolean {
  if (env.allowUnauthenticated && !env.bridgeToken) return true;
  if (!env.bridgeToken) return env.allowUnauthenticated;
  const header = req.headers[BRIDGE_TOKEN_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value === env.bridgeToken;
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": `content-type, ${BRIDGE_TOKEN_HEADER}`,
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      // 简单防护：避免超大 body
      if (chunks.reduce((n, c) => n + c.length, 0) > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createRequestId(): string {
  return randomUUID();
}
