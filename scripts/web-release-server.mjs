import { randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs";
import {
  createServer,
  request as createUpstreamRequest,
} from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const bundleRoot = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(bundleRoot, "public");
const bridgeEntry = join(bundleRoot, "server", "bridge.cjs");
const dataDir = resolve(process.env.OPENOS_DATA_DIR || join(bundleRoot, "data"));
const webHost = process.env.OPENOS_WEB_HOST?.trim() || "127.0.0.1";
const webPort = parsePort(process.env.OPENOS_WEB_PORT, 5178, "OPENOS_WEB_PORT");
const bridgeHost = "127.0.0.1";
const bridgePort = parsePort(
  process.env.OPENOS_BRIDGE_PORT,
  47821,
  "OPENOS_BRIDGE_PORT",
);

if (!existsSync(join(publicRoot, "index.html"))) {
  throw new Error(`Web assets are missing under ${publicRoot}.`);
}
if (!existsSync(bridgeEntry)) {
  throw new Error(`Bundled Bridge is missing: ${bridgeEntry}.`);
}
if (!isLoopbackHost(webHost) && process.env.OPENOS_WEB_ALLOW_REMOTE !== "1") {
  throw new Error(
    "Remote binding is disabled because the local Web edition has no multi-user authentication. " +
    "Set OPENOS_WEB_ALLOW_REMOTE=1 only on a trusted network and behind your own access control.",
  );
}

mkdirSync(dataDir, { recursive: true });

const bridge = spawn(process.execPath, [bridgeEntry], {
  cwd: bundleRoot,
  env: {
    ...process.env,
    OPENOS_BRIDGE_HOST: bridgeHost,
    OPENOS_BRIDGE_PORT: String(bridgePort),
    OPENOS_BRIDGE_TOKEN: "",
    OPENOS_BRIDGE_ALLOW_UNAUTHENTICATED: "1",
    OPENOS_CHANNEL: process.env.OPENOS_CHANNEL || "stable",
    OPENOS_DATA_DIR: dataDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

bridge.stderr.pipe(process.stderr);
const bridgeReady = waitForBridge(bridge);
const webServer = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    const requestId = `web-${randomUUID()}`;
    const message = error instanceof Error ? error.message : String(error);
    if (!response.headersSent) {
      sendJson(response, 500, {
        error: { code: "web_host_error", message, requestId, retryable: false },
      });
    } else {
      response.destroy(error instanceof Error ? error : new Error(message));
    }
  });
});

let shuttingDown = false;

try {
  await bridgeReady;
  await listen(webServer, webPort, webHost);
  const address = webServer.address();
  const actualPort = address && typeof address === "object" ? address.port : webPort;
  const visibleHost = webHost === "0.0.0.0" ? "127.0.0.1" : webHost;
  const url = `http://${visibleHost}:${actualPort}`;
  console.log(JSON.stringify({ type: "openos.web.ready", url, pid: process.pid }));
  console.error(`[openos-web] listening ${url}; data=${dataDir}`);
} catch (error) {
  await shutdown(1);
  throw error;
}

bridge.once("exit", (code, signal) => {
  if (shuttingDown) return;
  console.error(
    `[openos-web] Bridge exited unexpectedly (code=${code ?? "?"}, signal=${signal ?? "none"}).`,
  );
  void shutdown(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void shutdown(0);
  });
}

async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${webHost}`);
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    proxyToBridge(request, response);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, {
      allow: "GET, HEAD",
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("Method Not Allowed");
    return;
  }

  const file = resolvePublicFile(url.pathname);
  if (!file) {
    response.writeHead(403, {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("Forbidden");
    return;
  }

  const stats = statSync(file);
  response.writeHead(200, {
    "cache-control": file.endsWith("index.html")
      ? "no-store"
      : "public, max-age=31536000, immutable",
    "content-length": String(stats.size),
    "content-type": contentType(file),
    "referrer-policy": "same-origin",
    "x-content-type-options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

function proxyToBridge(request, response) {
  const requestId = `web-${randomUUID()}`;
  const headers = { ...request.headers, host: `${bridgeHost}:${bridgePort}` };
  removeHopByHopHeaders(headers);

  const upstream = createUpstreamRequest(
    {
      host: bridgeHost,
      port: bridgePort,
      method: request.method,
      path: request.url,
      headers,
    },
    (upstreamResponse) => {
      const responseHeaders = { ...upstreamResponse.headers };
      removeHopByHopHeaders(responseHeaders);
      response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
      upstreamResponse.pipe(response);
    },
  );

  upstream.once("error", (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    sendJson(response, 502, {
      error: {
        code: "bridge_unavailable",
        message: "The local OpenOS Bridge is unavailable.",
        requestId,
        retryable: true,
      },
    });
  });
  request.once("aborted", () => upstream.destroy());
  request.pipe(upstream);
}

function resolvePublicFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  const requested = resolve(publicRoot, decoded.replace(/^\/+/, "") || "index.html");
  if (!isWithin(publicRoot, requested)) return null;

  if (existsSync(requested)) {
    const stats = statSync(requested);
    if (stats.isFile()) return requested;
    if (stats.isDirectory()) {
      const index = join(requested, "index.html");
      if (existsSync(index) && statSync(index).isFile()) return index;
    }
  }

  // React 当前没有路径路由，但保留 SPA fallback，避免静态服务器刷新路径时 404。
  return join(publicRoot, "index.html");
}

function isWithin(root, candidate) {
  const value = relative(root, candidate);
  return value === "" || (
    value !== ".." &&
    !value.startsWith(`..${sep}`) &&
    !isAbsolute(value)
  );
}

function removeHopByHopHeaders(headers) {
  for (const name of [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]) {
    delete headers[name];
  }
}

function contentType(file) {
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  })[extname(file).toLowerCase()] || "application/octet-stream";
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function waitForBridge(child) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectReady(new Error("OpenOS Bridge did not become ready within 30 seconds."));
    }, 30_000);
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      console.log(line);
      try {
        const message = JSON.parse(line);
        if (message?.type !== "openos.desktop.bridge.ready" || settled) return;
        settled = true;
        clearTimeout(timeout);
        resolveReady(message);
      } catch {
        // Bridge 允许输出普通日志；只有结构化 ready 行参与启动握手。
      }
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectReady(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectReady(new Error(
        `OpenOS Bridge exited before ready (code=${code ?? "?"}, signal=${signal ?? "none"}).`,
      ));
    });
  });
}

function listen(server, port, host) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => rejectListen(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolveListen();
    });
  });
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = exitCode;
  await new Promise((resolveClose) => webServer.close(() => resolveClose()));
  if (bridge.exitCode === null && bridge.signalCode === null) {
    bridge.kill("SIGTERM");
    const killTimer = setTimeout(() => bridge.kill("SIGKILL"), 5_000);
    killTimer.unref();
    await new Promise((resolveExit) => bridge.once("exit", resolveExit));
    clearTimeout(killTimer);
  }
}

function parsePort(raw, fallback, name) {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return value;
}

function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
