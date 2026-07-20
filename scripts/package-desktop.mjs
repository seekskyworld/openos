import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const builderEntry = resolve(dirname(require.resolve("electron-builder")), "../cli.js");
const signingConfigured =
  process.env.OPENOS_DESKTOP_SIGN === "1" ||
  Boolean(process.env.CSC_LINK) ||
  Boolean(process.env.CSC_NAME);
const env = { ...process.env };

// 本地证书可能触发不可见的钥匙串确认；只有发布环境明确配置后才签名。
if (!signingConfigured) env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

const child = spawn(process.execPath, [builderEntry, ...process.argv.slice(2)], {
  cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  env,
  stdio: "inherit",
});

const result = await new Promise((resolveExit) => {
  child.once("exit", (code, signal) => resolveExit({ code, signal }));
});
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.code ?? 1);
