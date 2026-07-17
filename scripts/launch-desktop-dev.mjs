import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronPath = require("electron");

// 先确保 web dist 存在；若无则提示走 web 构建
const webIndex = join(root, "apps/web/dist/index.html");
if (!existsSync(webIndex)) {
  console.error("[openos] missing apps/web/dist. Run: npm run build:web");
  process.exit(1);
}

const mainEntry = join(root, "apps/desktop/dist/main.cjs");
if (!existsSync(mainEntry)) {
  console.error("[openos] missing desktop dist. Run: npm run build:desktop");
  process.exit(1);
}

const env = {
  ...process.env,
  OPENOS_CHANNEL: process.env.OPENOS_CHANNEL || "dev",
};
delete env.ELECTRON_RUN_AS_NODE;

// 通过 package main 指向 desktop dist
const child = spawn(String(electronPath), ["."], {
  cwd: root,
  env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
