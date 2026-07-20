import {
  BRIDGE_TOKEN_HEADER,
  parseGenAppsSettings,
  type BootstrapInfo,
  type ChatMessage,
  type ChatResponse,
  type HealthResponse,
  type GenAppsSettings,
  type LlmModelsRequest,
  type LlmModelsResponse,
  type LlmSettingsPublic,
  type LlmSettingsUpdate,
  type LlmTestRequest,
  type LlmTestResponse,
  type ProviderAuthActivateRequest,
  type ProviderAuthListResponse,
  type ProviderAuthRemoveRequest,
  type ProviderAuthSetRequest,
  type ProviderOauthAuthorizeRequest,
  type ProviderOauthAuthorizeResponse,
  type ProviderOauthCallbackRequest,
  type ProviderOauthCallbackResponse,
} from "@openos/shared";

export type ClientConfig = {
  apiBase: string;
  bridgeToken: string;
};

function resolveClientConfig(): ClientConfig {
  const desktop = window.openosDesktop;
  if (desktop?.apiBase) {
    return {
      apiBase: desktop.apiBase.replace(/\/$/, ""),
      bridgeToken: desktop.bridgeToken || "",
    };
  }

  // 浏览器 dev：走 Vite 同源代理 /api
  return {
    apiBase: "/api",
    bridgeToken: "",
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = resolveClientConfig();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (config.bridgeToken) {
    headers.set(BRIDGE_TOKEN_HEADER, config.bridgeToken);
  }

  const response = await fetch(`${config.apiBase}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON response (${response.status})`);
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body &&
      "error" in body &&
      typeof (body as { error?: { message?: string } }).error?.message === "string"
        ? (body as { error: { message: string } }).error.message
        : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return body as T;
}

export function fetchHealth() {
  return request<HealthResponse>("/health");
}

export function fetchBootstrap() {
  return request<BootstrapInfo>("/bootstrap");
}

export function sendChat(messages: ChatMessage[], model?: string) {
  return request<ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({ messages, model }),
  });
}

// ===== Sir 会话持久化（SQLite） =====

export type ThreadInfo = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type PersistedMessage = ChatMessage & {
  id: string;
  threadId: string;
  createdAt: number;
};

export function listThreads() {
  return request<{ threads: ThreadInfo[] }>("/threads");
}

export function createThreadApi(payload: { id?: string; title?: string } = {}) {
  return request<{ thread: ThreadInfo }>("/threads", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function renameThreadApi(threadId: string, title: string) {
  return request<{ ok: true }>(`/threads/${encodeURIComponent(threadId)}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function deleteThreadApi(threadId: string) {
  return request<{ ok: true }>(`/threads/${encodeURIComponent(threadId)}`, {
    method: "DELETE",
  });
}

export function listThreadMessages(threadId: string) {
  return request<{ messages: PersistedMessage[] }>(
    `/threads/${encodeURIComponent(threadId)}/messages`,
  );
}

export function appendThreadMessage(
  threadId: string,
  payload: { id?: string; role: ChatMessage["role"]; content: string },
) {
  return request<{ message: PersistedMessage }>(
    `/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function fetchLlmSettings() {
  return request<LlmSettingsPublic>("/settings/llm");
}

export function saveLlmSettings(update: LlmSettingsUpdate) {
  return request<LlmSettingsPublic>("/settings/llm", {
    method: "PUT",
    body: JSON.stringify(update),
  });
}

export function testLlmSettings(payload: LlmTestRequest = {}) {
  return request<LlmTestResponse>("/settings/llm/test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listLlmModels(payload: LlmModelsRequest = {}) {
  return request<LlmModelsResponse>("/settings/llm/models", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchProviderAuth() {
  return request<ProviderAuthListResponse>("/auth/providers");
}

export function setProviderAuth(payload: ProviderAuthSetRequest) {
  return request<ProviderAuthListResponse>("/auth/set", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function removeProviderAuth(payload: ProviderAuthRemoveRequest) {
  return request<ProviderAuthListResponse>("/auth/remove", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function activateProviderAuth(payload: ProviderAuthActivateRequest) {
  return request<ProviderAuthListResponse>("/auth/activate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function oauthAuthorize(payload: ProviderOauthAuthorizeRequest) {
  return request<ProviderOauthAuthorizeResponse>("/auth/oauth/authorize", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function oauthCallback(payload: ProviderOauthCallbackRequest) {
  return request<ProviderOauthCallbackResponse>("/auth/oauth/callback", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ===== Gen Apps 设置 =====

export type GenAppsSettingsPayload = GenAppsSettings;

export async function fetchGenAppsSettings() {
  const body = await request<{ settings: unknown }>("/settings/gen-apps", {
    signal: AbortSignal.timeout(2_000),
  });
  const settings = parseGenAppsSettings(body.settings);
  if (!settings) throw new Error("Malformed Gen Apps settings response.");
  return { settings };
}

export async function saveGenAppsSettings(update: Partial<GenAppsSettingsPayload>) {
  const body = await request<{ settings: unknown }>("/settings/gen-apps", {
    method: "PUT",
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(5_000),
  });
  const settings = parseGenAppsSettings(body.settings);
  if (!settings) throw new Error("Malformed Gen Apps settings response.");
  return { settings };
}
