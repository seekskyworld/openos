import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appName = process.platform === "darwin" ? "OpenOS.app" : "openos-unpacked";
const platformDir = process.platform === "darwin"
  ? process.arch === "arm64" ? "mac-arm64" : "mac"
  : process.platform === "win32"
    ? "win-unpacked"
    : "linux-unpacked";
const appPath = join(root, "release", platformDir, appName);

if (!existsSync(appPath)) {
  throw new Error(`Packaged desktop app missing: ${appPath}. Run npm run desktop:pack first.`);
}

const executable = process.platform === "darwin"
  ? join(appPath, "Contents", "MacOS", "OpenOS")
  : process.platform === "win32"
    ? join(appPath, "OpenOS.exe")
    : join(appPath, "openos");

const userData = join(root, "release", ".smoke-user-data");
rmSync(userData, { recursive: true, force: true });
const child = spawn(executable, [], {
  env: {
    ...process.env,
    OPENOS_DESKTOP_SMOKE: "1",
    OPENOS_USER_DATA_DIR: userData,
    OPENOS_GENAPPS_FAKE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString("utf8");
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString("utf8");
});

const exitCode = await new Promise((resolveExit, rejectExit) => {
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    rejectExit(new Error(`Packaged desktop smoke timed out.\n${output}`));
  }, 30_000);
  child.once("exit", (code) => {
    clearTimeout(timer);
    resolveExit(code);
  });
});

if (exitCode !== 0 || !output.includes("openos.desktop.smoke.ready")) {
  throw new Error(`Packaged desktop smoke failed (code=${exitCode ?? "?"}).\n${output}`);
}

console.log("[openos] packaged desktop smoke PASS");
