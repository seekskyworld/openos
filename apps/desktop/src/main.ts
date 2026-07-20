import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  shell,
  type BrowserWindowConstructorOptions,
} from "electron";
import { BridgeSupervisor, type BridgeRuntimeInfo } from "./bridge-supervisor.js";
import { resolveDesktopEnvironment } from "./shell-env.js";

type DesktopChannel = "dev" | "stable";

const PRODUCT_NAME = "OpenOS";
const DESKTOP_CHANNEL: DesktopChannel = app.isPackaged ? "stable" : "dev";
// 开发版独立 userData，可与安装版并存
const APP_NAME = DESKTOP_CHANNEL === "stable" ? PRODUCT_NAME : `${PRODUCT_NAME} Dev`;
const APP_USER_DATA_DIR = DESKTOP_CHANNEL === "stable" ? "OpenOS" : "OpenOS Dev";
const USER_DATA_OVERRIDE = process.env.OPENOS_USER_DATA_DIR?.trim();

app.setName(APP_NAME);
app.setPath(
  "userData",
  USER_DATA_OVERRIDE || join(app.getPath("appData"), APP_USER_DATA_DIR),
);

let mainWindow: BrowserWindow | undefined;
let supervisor: BridgeSupervisor | undefined;
let bridgeInfo: BridgeRuntimeInfo | undefined;
let bridgeToken = "";

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    // stable 强制 token；dev 可空 token 便于联调
    bridgeToken =
      DESKTOP_CHANNEL === "stable"
        ? randomBytes(24).toString("base64url")
        : process.env.OPENOS_BRIDGE_TOKEN?.trim() || "";

    const env = await resolveDesktopEnvironment(process.env);
    supervisor = new BridgeSupervisor({
      appRoot: resolveAppRoot(),
      userDataDir: app.getPath("userData"),
      token: bridgeToken,
      channel: DESKTOP_CHANNEL,
      isPackaged: app.isPackaged,
      baseEnv: env,
    });

    bridgeInfo = await supervisor.start();
    createWindow(bridgeInfo);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0 && bridgeInfo) {
        createWindow(bridgeInfo);
      }
    });
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[openos] desktop startup failed", error);
    dialog.showErrorBox("OpenOS 启动失败", `${message}\n\n日志目录：${app.getPath("userData")}/logs`);
    app.quit();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async (event) => {
  if (!supervisor) return;
  event.preventDefault();
  const current = supervisor;
  supervisor = undefined;
  await current.stop();
  app.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
});

function createWindow(info: BridgeRuntimeInfo) {
  // CJS 打包后 __dirname 指向 apps/desktop/dist
  const preloadPath = join(__dirname, "preload.cjs");
  const options: BrowserWindowConstructorOptions = {
    show: process.env.OPENOS_DESKTOP_SMOKE !== "1",
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: "#0b1020",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        `--openos-api-base=${info.apiBase}`,
        `--openos-bridge-token=${bridgeToken}`,
        `--openos-channel=${DESKTOP_CHANNEL}`,
        `--openos-packaged=${app.isPackaged ? "1" : "0"}`,
      ],
    },
  };

  mainWindow = new BrowserWindow(options);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const webDistIndex = join(resolveAppRoot(), "apps/web/dist/index.html");
  const devServerUrl = process.env.OPENOS_WEB_DEV_URL?.trim();

  if (!app.isPackaged && devServerUrl) {
    void mainWindow.loadURL(devServerUrl).then(() => completeDesktopSmokeIfRequested(mainWindow, info));
  } else if (existsSync(webDistIndex)) {
    void mainWindow.loadFile(webDistIndex).then(() => completeDesktopSmokeIfRequested(mainWindow, info));
  } else {
    void mainWindow.loadURL("data:text/html,<h1>OpenOS web dist missing. Run build:web.</h1>");
  }
}

async function completeDesktopSmokeIfRequested(
  window: BrowserWindow | undefined,
  info: BridgeRuntimeInfo,
): Promise<void> {
  if (process.env.OPENOS_DESKTOP_SMOKE !== "1") return;
  try {
    if (!window || window.isDestroyed()) throw new Error("Desktop window is unavailable.");
    const renderer = await window.webContents.executeJavaScript(`(async () => {
      const response = await fetch(${JSON.stringify(`${info.apiBase}/health`)});
      const health = await response.json();
      return {
        rootChildren: document.querySelector('#root')?.childElementCount ?? 0,
        styleSheets: document.styleSheets.length,
        healthOk: response.ok && health?.ok === true,
      };
    })()`);
    if (
      !renderer ||
      renderer.rootChildren < 1 ||
      renderer.styleSheets < 1 ||
      renderer.healthOk !== true
    ) {
      throw new Error(`Renderer readiness check failed: ${JSON.stringify(renderer)}`);
    }
    console.log("openos.desktop.smoke.ready");
  } catch (error) {
    process.exitCode = 1;
    console.error("openos.desktop.smoke.failed", error);
  } finally {
    app.quit();
  }
}

function resolveAppRoot(): string {
  // 开发态返回仓库根，安装态返回 app.asar；两者都由 Electron 统一解析。
  return app.getAppPath();
}
