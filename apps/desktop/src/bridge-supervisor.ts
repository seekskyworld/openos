import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT } from "@openos/shared";

export type BridgeRuntimeInfo = {
  host: string;
  port: number;
  url: string;
  apiBase: string;
  authMode: "bridge-token" | "open";
  channel: "dev" | "stable";
  pid: number;
};

export type BridgeSupervisorOptions = {
  appRoot: string;
  userDataDir: string;
  token: string;
  channel: "dev" | "stable";
  isPackaged: boolean;
  baseEnv: NodeJS.ProcessEnv;
};

/**
 * 桌面主进程托管本地 bridge：注入运行环境、解析 ready 信号、负责生命周期。
 * 参考 opengrove 的 supervisor 分层，不把业务塞进 Electron main。
 */
export class BridgeSupervisor {
  private child: ChildProcess | undefined;
  private logStream: WriteStream | undefined;
  private readonly options: BridgeSupervisorOptions;

  constructor(options: BridgeSupervisorOptions) {
    this.options = options;
  }

  async start(): Promise<BridgeRuntimeInfo> {
    const { appRoot, userDataDir, token, channel, baseEnv } = this.options;
    const dataDir = join(userDataDir, "data");
    const logDir = join(userDataDir, "logs");
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(logDir, { recursive: true });

    const serverEntry = resolveServerEntry(appRoot);
    const logPath = join(logDir, "bridge.log");
    this.logStream = createWriteStream(logPath, { flags: "a" });

    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      OPENOS_CHANNEL: channel,
      OPENOS_DATA_DIR: dataDir,
      OPENOS_BRIDGE_HOST: DEFAULT_BRIDGE_HOST,
      OPENOS_BRIDGE_PORT: String(DEFAULT_BRIDGE_PORT),
      OPENOS_BRIDGE_TOKEN: token,
      OPENOS_BRIDGE_ALLOW_UNAUTHENTICATED: token ? "" : "1",
    };

    // 始终用系统 node 启动 bridge，避免 Electron 可执行文件路径混淆
    const child = spawn("node", [serverEntry], {
      cwd: appRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    return await waitForReady(child, this.logStream, 15_000);
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.killed) {
      this.logStream?.end();
      return;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
        resolve();
      }, 3_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
    this.logStream?.end();
  }
}

function resolveServerEntry(appRoot: string): string {
  const candidates = [
    join(appRoot, "apps/server/dist/cli.js"),
    join(appRoot, "apps/server/src/cli.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Server entry not found. Run build:server first.");
}

function waitForReady(
  child: ChildProcess,
  logStream: WriteStream | undefined,
  timeoutMs: number,
): Promise<BridgeRuntimeInfo> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error("Bridge start timeout."));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      logStream?.write(text);
      for (const line of text.split(/\r?\n/)) {
        if (!line.includes("openos.desktop.bridge.ready")) continue;
        try {
          const payload = JSON.parse(line) as BridgeRuntimeInfo & {
            type?: string;
          };
          if (payload.type === "openos.desktop.bridge.ready") {
            finish(undefined, payload);
            return;
          }
        } catch {
          // 非 JSON 行忽略
        }
      }
    };

    const onExit = (code: number | null) => {
      finish(new Error(`Bridge exited before ready (code=${code ?? "?"}).`));
    };

    const finish = (error?: Error, info?: BridgeRuntimeInfo) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
      if (error) reject(error);
      else if (info) resolve(info);
      else reject(new Error("Bridge ready payload missing."));
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", onExit);
  });
}
