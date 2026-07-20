import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createServer } from "node:net";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronPath = require("electron");

const useWebDevServer = process.argv.includes("--web-dev");
let webDevUrl = process.env.OPENOS_WEB_DEV_URL || "http://127.0.0.1:5178";

// 静态开发模式需要 web dist；热开发模式由 Vite 提供页面。
const webIndex = join(root, "apps/web/dist/index.html");
if (!useWebDevServer && !existsSync(webIndex)) {
  console.error("[openos] missing apps/web/dist. Run: npm run build:web");
  process.exit(1);
}

const mainEntry = join(root, "apps/desktop/dist/main.cjs");
if (!existsSync(mainEntry)) {
  console.error("[openos] missing desktop dist. Run: npm run build:desktop");
  process.exit(1);
}

let webChild;
if (useWebDevServer) {
  const requestedUrl = new URL(webDevUrl);
  const requestedPort = Number(requestedUrl.port || "80");
  const webPort = await findAvailablePort(requestedUrl.hostname, requestedPort);
  requestedUrl.port = String(webPort);
  webDevUrl = requestedUrl.toString().replace(/\/$/, "");
  const viteEntry = resolve(dirname(require.resolve("vite")), "../../bin/vite.js");
  webChild = spawn(process.execPath, [
    viteEntry,
    "--config",
    join(root, "apps/web/vite.config.ts"),
    "--host",
    requestedUrl.hostname,
    "--port",
    String(webPort),
    "--strictPort",
  ], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  await waitForHttp(webDevUrl, 30_000, webChild);
}

const env = {
  ...process.env,
  OPENOS_CHANNEL: process.env.OPENOS_CHANNEL || "dev",
  ...(useWebDevServer ? { OPENOS_WEB_DEV_URL: webDevUrl } : {}),
};
delete env.ELECTRON_RUN_AS_NODE;

// 通过 package main 指向 desktop dist
const child = spawn(String(electronPath), ["."], {
  cwd: root,
  env,
  stdio: "inherit",
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!child.killed) child.kill(signal);
  if (webChild && !webChild.killed) webChild.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(signal);
  });
}

child.on("exit", (code, signal) => {
  if (webChild && !webChild.killed) webChild.kill("SIGTERM");
  if (signal) {
    if (!shuttingDown) process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

webChild?.on("exit", (code) => {
  if (shuttingDown || code === 0) return;
  console.error(`[openos] web dev server exited (code=${code ?? "?"})`);
  shutdown("SIGTERM");
});

async function waitForHttp(url, timeoutMs, processToWatch) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processToWatch.exitCode !== null) {
      throw new Error(`Web dev server exited before it became ready (code=${processToWatch.exitCode}).`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Vite 启动期间连接失败属于预期，继续轮询。
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`Web dev server did not become ready within ${timeoutMs}ms: ${url}`);
}

async function findAvailablePort(host, preferredPort) {
  for (let offset = 0; offset < 20; offset += 1) {
    const port = preferredPort + offset;
    if (await canListen(host, port)) return port;
  }
  throw new Error(`No available web port in ${preferredPort}-${preferredPort + 19}.`);
}

function canListen(host, port) {
  return new Promise((resolvePort) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => resolvePort(false));
    probe.listen(port, host, () => probe.close(() => resolvePort(true)));
  });
}
