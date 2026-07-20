import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
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

    const bridgePort = await findAvailablePort(DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT);
    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      OPENOS_CHANNEL: channel,
      OPENOS_DATA_DIR: dataDir,
      OPENOS_BRIDGE_HOST: DEFAULT_BRIDGE_HOST,
      OPENOS_BRIDGE_PORT: String(bridgePort),
      OPENOS_BRIDGE_TOKEN: token,
      OPENOS_BRIDGE_ALLOW_UNAUTHENTICATED: token ? "" : "1",
    };

    const executable = this.options.isPackaged ? process.execPath : "node";
    if (this.options.isPackaged) {
      // 安装包不能假设用户装有 Node；Electron 的 Node 模式负责运行内置 bridge。
      env.ELECTRON_RUN_AS_NODE = "1";
    }

    const child = spawn(executable, [serverEntry], {
      // app.asar 不是系统目录，不能作为 child_process 的 cwd。
      cwd: this.options.isPackaged ? userDataDir : appRoot,
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

async function findAvailablePort(host: string, preferredPort: number): Promise<number> {
  for (let offset = 0; offset < 20; offset += 1) {
    const port = preferredPort + offset;
    if (await canListen(host, port)) return port;
  }
  throw new Error(`No available bridge port in ${preferredPort}-${preferredPort + 19}.`);
}

function canListen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => {
      probe.close(() => resolve(true));
    });
  });
}

function resolveServerEntry(appRoot: string): string {
  const candidates = [
    join(appRoot, "apps/desktop/dist/bridge.cjs"),
    join(appRoot, "apps/server/dist/cli.js"),
    join(appRoot, "apps/server/src/cli.ts"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Server entry not found below ${dirname(appRoot)}. Run build:desktop first.`,
  );
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
