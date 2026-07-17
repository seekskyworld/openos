import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ALLOWED_EXACT = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "USERNAME",
  "LANG",
  "TMPDIR",
  "TEMP",
  "TMP",
]);

// 仅透传与模型/运行相关的环境变量，避免污染 bridge 进程
const ALLOWED_PREFIXES = [
  "LC_",
  "OPENAI_",
  "ANTHROPIC_",
  "GEMINI_",
  "QWEN_",
  "OPENOS_",
];

/**
 * macOS/Linux 从登录 shell 回收环境，确保 GUI 启动时也能拿到 API Key。
 * Windows 直接继承当前进程环境。
 */
export async function resolveDesktopEnvironment(
  baseEnv: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  if (process.platform === "win32") {
    return { ...baseEnv };
  }

  const shell = baseEnv.SHELL || "/bin/zsh";
  try {
    const result = await execFileAsync(shell, ["-lc", "env"], {
      env: baseEnv,
      timeout: 5_000,
      maxBuffer: 1_000_000,
    });
    return {
      ...baseEnv,
      ...filterAllowed(parseEnv(result.stdout)),
    };
  } catch {
    return { ...baseEnv };
  }
}

function parseEnv(output: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    env[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return env;
}

function filterAllowed(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (ALLOWED_EXACT.has(key) || ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
      out[key] = value;
    }
  }
  return out;
}
