import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type {
  ProviderOauthAuthorizeResponse,
  ProviderOauthCallbackResponse,
} from "@openos/shared";
import type { ServerEnv } from "./env.js";
import { setAuth, type StoredOauthAuth } from "./auth-store.js";

type PendingOauth = {
  providerId: string;
  method: "auto" | "code";
  state: string;
  verifier?: string;
  redirectUri?: string;
  userCode?: string;
  deviceCode?: string;
  createdAt: number;
  /** auto 模式：等 callback 写入的结果 */
  resolve?: (result: ProviderOauthCallbackResponse) => void;
  reject?: (error: Error) => void;
  server?: Server;
};

const pending = new Map<string, PendingOauth>();

function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

const HTML_OK = `<!doctype html>
<html><head><meta charset="utf-8"/><title>OpenOS · Authorized</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f}
.card{text-align:center;padding:2rem 2.5rem;border-radius:16px;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.08)}
h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;color:#6e6e73}
</style></head>
<body><div class="card"><h1>Authorization Successful</h1><p>You can close this window and return to OpenOS.</p></div>
<script>setTimeout(()=>window.close(),1800)</script></body></html>`;

const HTML_ERR = (msg: string) => `<!doctype html>
<html><head><meta charset="utf-8"/><title>OpenOS · Auth Failed</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f}
.card{text-align:center;padding:2rem 2.5rem;border-radius:16px;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.08);max-width:420px}
h1{font-size:1.25rem;margin:0 0 .5rem;color:#b42318}p{margin:0;color:#6e6e73;word-break:break-word}
</style></head>
<body><div class="card"><h1>Authorization Failed</h1><p>${msg.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</p></div></body></html>`;

function cleanup(state: string) {
  const item = pending.get(state);
  if (!item) return;
  try {
    item.server?.close();
  } catch {
    // ignore
  }
  pending.delete(state);
}

/**
 * 启动 OAuth 授权。
 * - openai: PKCE + loopback callback (auto)
 * - anthropic / google: 授权码模式（code），用户粘贴 code
 * - github-copilot: device code flow
 */
export async function startOauthAuthorize(
  env: ServerEnv,
  providerId: string,
  methodIndex = 0,
): Promise<ProviderOauthAuthorizeResponse> {
  void env;
  const state = b64url(randomBytes(16));

  // OpenAI: method 0 = browser PKCE, method 1 = headless device（对齐 OpenCode）
  const effectiveProviderId =
    providerId === "openai" && methodIndex === 1
      ? "openai-device"
      : providerId;

  if (effectiveProviderId === "openai" || effectiveProviderId === "openai-browser") {
    // 严格对齐 OpenCode codex plugin：
    // - client_id 固定
    // - redirect 必须是 http://localhost:1455/auth/callback（预注册）
    // - 必须带 id_token_add_organizations / codex_cli_simplified_flow
    const { verifier, challenge } = await pkce();
    const port = 1455;
    const redirectUri = `http://localhost:${port}/auth/callback`;
    const clientId =
      process.env.OPENOS_OPENAI_OAUTH_CLIENT_ID?.trim() ||
      "app_EMoamEEZ73f0CkXaXp7hrann";
    const issuer = "https://auth.openai.com";

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "openid profile email offline_access",
      code_challenge: challenge,
      code_challenge_method: "S256",
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      state,
      originator: "opencode",
    });
    const url = `${issuer}/oauth/authorize?${params.toString()}`;

    const entry: PendingOauth = {
      providerId: "openai",
      method: "auto",
      state,
      verifier,
      redirectUri,
      createdAt: Date.now(),
    };

    // 若 1455 已被占用，复用失败则明确报错（与 OpenCode 同端口约束）
    const server = createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || "/", `http://localhost:${port}`);
        if (reqUrl.pathname === "/cancel") {
          entry.reject?.(new Error("Login cancelled"));
          cleanup(state);
          res.writeHead(200);
          res.end("Login cancelled");
          return;
        }
        if (reqUrl.pathname !== "/auth/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const oauthError = reqUrl.searchParams.get("error");
        if (oauthError) {
          const desc =
            reqUrl.searchParams.get("error_description") || oauthError;
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(HTML_ERR(desc));
          entry.reject?.(new Error(desc));
          cleanup(state);
          return;
        }

        const code = reqUrl.searchParams.get("code") || "";
        const returnedState = reqUrl.searchParams.get("state") || "";
        if (!code || returnedState !== state) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(HTML_ERR("Missing authorization code or invalid state."));
          entry.reject?.(new Error("Invalid OAuth callback"));
          cleanup(state);
          return;
        }

        const tokenRes = await fetch(`${issuer}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: verifier,
          }).toString(),
        });
        if (!tokenRes.ok) {
          const text = await tokenRes.text();
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(
            HTML_ERR(
              `Token exchange failed: ${tokenRes.status} ${text.slice(0, 160)}`,
            ),
          );
          entry.reject?.(new Error("Token exchange failed"));
          cleanup(state);
          return;
        }
        const tokens = (await tokenRes.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in?: number;
          id_token?: string;
        };

        const auth: StoredOauthAuth = {
          type: "oauth",
          access: tokens.access_token,
          refresh: tokens.refresh_token || "",
          expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          accountId: extractEmail(tokens.id_token) || "openai",
        };
        setAuth(env, "openai", auth);

        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(HTML_OK);
        entry.resolve?.({
          ok: true,
          providerId: "openai",
          type: "oauth",
          preview: auth.accountId || "oauth",
        });
        cleanup(state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
        res.end(HTML_ERR(message));
        entry.reject?.(error instanceof Error ? error : new Error(message));
        cleanup(state);
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          reject(
            Object.assign(
              new Error(
                "端口 1455 被占用。OpenAI OAuth 必须使用 http://localhost:1455/auth/callback，请关闭占用进程后重试。",
              ),
              { code: "oauth_port_in_use" },
            ),
          );
          return;
        }
        reject(err);
      });
      // 与 OpenCode 一致：listen 不绑 127.0.0.1 限定，使用默认接口 + localhost redirect
      server.listen(port, () => resolve());
    });
    entry.server = server;
    pending.set(state, entry);

    return {
      url,
      method: "auto",
      instructions:
        "浏览器将打开 ChatGPT / OpenAI 登录页，完成后窗口会自动关闭并返回 OpenOS。",
      state,
    };
  }

  // OpenAI headless device flow（对齐 OpenCode codex deviceauth）
  if (effectiveProviderId === "openai-device") {
    const clientId =
      process.env.OPENOS_OPENAI_OAUTH_CLIENT_ID?.trim() ||
      "app_EMoamEEZ73f0CkXaXp7hrann";
    const issuer = "https://auth.openai.com";
    const deviceResponse = await fetch(
      `${issuer}/api/accounts/deviceauth/usercode`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "openos/0.1.0",
        },
        body: JSON.stringify({ client_id: clientId }),
      },
    );
    if (!deviceResponse.ok) {
      throw Object.assign(
        new Error("Failed to initiate OpenAI device authorization"),
        { code: "oauth_device_failed" },
      );
    }
    const deviceData = (await deviceResponse.json()) as {
      device_auth_id: string;
      user_code: string;
      interval?: string;
    };
    pending.set(state, {
      providerId: "openai",
      method: "auto",
      state,
      deviceCode: deviceData.device_auth_id,
      userCode: deviceData.user_code,
      createdAt: Date.now(),
      // 借用 redirectUri 字段存 interval
      redirectUri: String(Math.max(parseInt(deviceData.interval || "5") || 5, 1)),
    });
    return {
      url: `${issuer}/codex/device`,
      method: "auto",
      instructions: `在浏览器打开链接并输入代码：${deviceData.user_code}`,
      userCode: deviceData.user_code,
      state,
    };
  }

  if (effectiveProviderId === "anthropic") {
    // 授权码模式：打开控制台，用户粘贴 key/code（Claude 无公开通用 OAuth client 时退化为引导 + code 输入）
    const url =
      process.env.OPENOS_ANTHROPIC_OAUTH_URL?.trim() ||
      "https://console.anthropic.com/settings/keys";
    pending.set(state, {
      providerId: effectiveProviderId,
      method: "code",
      state,
      createdAt: Date.now(),
    });
    return {
      url,
      method: "code",
      instructions:
        "在浏览器完成登录后，将 API Key 或授权码粘贴回 OpenOS（当前 Anthropic 公开端点以 API Key 为主）。",
      state,
    };
  }

  if (effectiveProviderId === "google") {
    const clientId = process.env.OPENOS_GOOGLE_OAUTH_CLIENT_ID?.trim();
    if (!clientId) {
      // 无 client 时退化为 API Key 引导
      pending.set(state, {
        providerId: effectiveProviderId,
        method: "code",
        state,
        createdAt: Date.now(),
      });
      return {
        url: "https://aistudio.google.com/apikey",
        method: "code",
        instructions:
          "未配置 OPENOS_GOOGLE_OAUTH_CLIENT_ID。请在 AI Studio 创建 API Key 并粘贴回来。",
        state,
      };
    }
    const { verifier, challenge } = await pkce();
    const redirectUri =
      process.env.OPENOS_GOOGLE_OAUTH_REDIRECT?.trim() ||
      "http://127.0.0.1:1456/callback";
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/generative-language.retriever openid email",
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "consent",
      state,
    });
    pending.set(state, {
      providerId: effectiveProviderId,
      method: "code",
      state,
      verifier,
      redirectUri,
      createdAt: Date.now(),
    });
    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      method: "code",
      instructions: "浏览器登录 Google 后，将地址栏中的 code 参数粘贴回来。",
      state,
    };
  }

  if (effectiveProviderId === "github-copilot") {
    // Device code flow
    const clientId =
      process.env.OPENOS_GITHUB_OAUTH_CLIENT_ID?.trim() || "Iv1.b507a08c87ecfe98";
    const res = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: "read:user",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw Object.assign(new Error(`GitHub device code failed: ${text}`), {
        code: "oauth_device_failed",
      });
    }
    const data = (await res.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval?: number;
    };
    pending.set(state, {
      providerId: effectiveProviderId,
      method: "auto",
      state,
      deviceCode: data.device_code,
      userCode: data.user_code,
      createdAt: Date.now(),
    });
    return {
      url: data.verification_uri || "https://github.com/login/device",
      method: "auto",
      instructions: `在浏览器打开链接并输入代码：${data.user_code}`,
      userCode: data.user_code,
      state,
    };
  }

  throw Object.assign(
    new Error(`OAuth not supported for provider: ${effectiveProviderId}`),
    { code: "oauth_unsupported" },
  );
}

function extractEmail(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  try {
    const part = idToken.split(".")[1];
    if (!part) return undefined;
    const json = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
      email?: string;
    };
    return json.email;
  } catch {
    return undefined;
  }
}

/**
 * 完成 OAuth：
 * - auto + openai: 等待 loopback 回调（最长 3 分钟）
 * - auto + github: 轮询 device token
 * - code: 用用户粘贴的 code/key 落库
 */
export async function completeOauthCallback(
  env: ServerEnv,
  input: { providerId: string; code?: string; state?: string },
): Promise<ProviderOauthCallbackResponse> {
  // 按 state 或 provider 找 pending
  let entry: PendingOauth | undefined;
  if (input.state) entry = pending.get(input.state);
  if (!entry) {
    for (const item of pending.values()) {
      if (item.providerId === input.providerId) {
        entry = item;
        break;
      }
    }
  }
  if (!entry) {
    return {
      ok: false,
      providerId: input.providerId,
      type: "oauth",
      preview: "",
      error: { code: "oauth_missing", message: "No pending OAuth session. Start authorize first." },
    };
  }

  if (entry.method === "code") {
    const code = input.code?.trim();
    if (!code) {
      return {
        ok: false,
        providerId: input.providerId,
        type: "oauth",
        preview: "",
        error: { code: "oauth_code_missing", message: "Authorization code / API key is required." },
      };
    }

    // Google 真 OAuth code 交换
    if (entry.providerId === "google" && entry.verifier && entry.redirectUri) {
      const clientId = process.env.OPENOS_GOOGLE_OAUTH_CLIENT_ID?.trim() || "";
      const clientSecret = process.env.OPENOS_GOOGLE_OAUTH_CLIENT_SECRET?.trim() || "";
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: entry.redirectUri,
          grant_type: "authorization_code",
          code_verifier: entry.verifier,
        }).toString(),
      });
      if (!tokenRes.ok) {
        // 失败时把粘贴值当 API Key 存
        setAuth(env, entry.providerId, { type: "api", key: code });
        cleanup(entry.state);
        return {
          ok: true,
          providerId: entry.providerId,
          type: "api",
          preview: `${code.slice(0, 4)}…`,
        };
      }
      const tokens = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      setAuth(env, entry.providerId, {
        type: "oauth",
        access: tokens.access_token,
        refresh: tokens.refresh_token || "",
        expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      });
      cleanup(entry.state);
      return {
        ok: true,
        providerId: entry.providerId,
        type: "oauth",
        preview: "google-oauth",
      };
    }

    // Anthropic / 其他 code 模式：作为 API Key 保存（与 OpenCode 在无 OAuth client 时的务实路径一致）
    setAuth(env, entry.providerId, { type: "api", key: code });
    cleanup(entry.state);
    return {
      ok: true,
      providerId: entry.providerId,
      type: "api",
      preview: code.length > 8 ? `${code.slice(0, 4)}…${code.slice(-4)}` : "••••",
    };
  }

  // auto: openai browser wait for loopback (localhost:1455)
  if (entry.providerId === "openai" && entry.verifier && !entry.deviceCode) {
    const result = await new Promise<ProviderOauthCallbackResponse>((resolve, reject) => {
      entry!.resolve = resolve;
      entry!.reject = reject;
      const timer = setTimeout(() => {
        reject(new Error("OAuth callback timeout - authorization took too long"));
        cleanup(entry!.state);
      }, 5 * 60_000);
      const prevResolve = entry!.resolve;
      entry!.resolve = (value) => {
        clearTimeout(timer);
        prevResolve?.(value);
      };
    }).catch((error: Error) => ({
      ok: false as const,
      providerId: entry!.providerId,
      type: "oauth" as const,
      preview: "",
      error: { code: "oauth_timeout", message: error.message },
    }));
    return result;
  }

  // OpenAI headless deviceauth（对齐 OpenCode codex device flow）
  if (entry.providerId === "openai" && entry.deviceCode && entry.userCode) {
    const clientId =
      process.env.OPENOS_OPENAI_OAUTH_CLIENT_ID?.trim() ||
      "app_EMoamEEZ73f0CkXaXp7hrann";
    const issuer = "https://auth.openai.com";
    const intervalSec = Math.max(Number(entry.redirectUri) || 5, 1);
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, intervalSec * 1000 + 3000));
      const response = await fetch(`${issuer}/api/accounts/deviceauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "openos/0.1.0",
        },
        body: JSON.stringify({
          device_auth_id: entry.deviceCode,
          user_code: entry.userCode,
        }),
      });
      if (response.ok) {
        const data = (await response.json()) as {
          authorization_code: string;
          code_verifier: string;
        };
        const tokenResponse = await fetch(`${issuer}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: data.authorization_code,
            redirect_uri: `${issuer}/deviceauth/callback`,
            client_id: clientId,
            code_verifier: data.code_verifier,
          }).toString(),
        });
        if (!tokenResponse.ok) {
          cleanup(entry.state);
          return {
            ok: false,
            providerId: "openai",
            type: "oauth",
            preview: "",
            error: {
              code: "oauth_token_failed",
              message: `Token exchange failed: ${tokenResponse.status}`,
            },
          };
        }
        const tokens = (await tokenResponse.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in?: number;
          id_token?: string;
        };
        setAuth(env, "openai", {
          type: "oauth",
          access: tokens.access_token,
          refresh: tokens.refresh_token || "",
          expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          accountId: extractEmail(tokens.id_token) || "openai",
        });
        cleanup(entry.state);
        return {
          ok: true,
          providerId: "openai",
          type: "oauth",
          preview: extractEmail(tokens.id_token) || "openai",
        };
      }
      if (response.status !== 403 && response.status !== 404) {
        cleanup(entry.state);
        return {
          ok: false,
          providerId: "openai",
          type: "oauth",
          preview: "",
          error: {
            code: "oauth_device_failed",
            message: `Device auth failed: HTTP ${response.status}`,
          },
        };
      }
    }
    cleanup(entry.state);
    return {
      ok: false,
      providerId: "openai",
      type: "oauth",
      preview: "",
      error: { code: "oauth_timeout", message: "Device login timed out." },
    };
  }

  // github device poll
  if (entry.providerId === "github-copilot" && entry.deviceCode) {
    const clientId =
      process.env.OPENOS_GITHUB_OAUTH_CLIENT_ID?.trim() || "Iv1.b507a08c87ecfe98";
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code: entry.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      const data = (await res.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };
      if (data.access_token) {
        setAuth(env, entry.providerId, {
          type: "oauth",
          access: data.access_token,
          refresh: "",
          expires: Date.now() + 8 * 3600_000,
          accountId: "github",
        });
        cleanup(entry.state);
        return {
          ok: true,
          providerId: entry.providerId,
          type: "oauth",
          preview: "github",
        };
      }
      if (data.error && data.error !== "authorization_pending" && data.error !== "slow_down") {
        cleanup(entry.state);
        return {
          ok: false,
          providerId: entry.providerId,
          type: "oauth",
          preview: "",
          error: {
            code: data.error,
            message: data.error_description || data.error,
          },
        };
      }
    }
    cleanup(entry.state);
    return {
      ok: false,
      providerId: entry.providerId,
      type: "oauth",
      preview: "",
      error: { code: "oauth_timeout", message: "Device login timed out." },
    };
  }

  return {
    ok: false,
    providerId: input.providerId,
    type: "oauth",
    preview: "",
    error: { code: "oauth_unsupported", message: "Unsupported OAuth completion path." },
  };
}
