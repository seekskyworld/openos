import { contextBridge } from "electron";

type DesktopBridge = {
  apiBase: string;
  bridgeToken: string;
  channel: "dev" | "stable";
  platform: string;
  isPackaged: boolean;
};

const args = parseArguments(process.argv);

contextBridge.exposeInMainWorld("openosDesktop", {
  apiBase: args["openos-api-base"] ?? "",
  bridgeToken: args["openos-bridge-token"] ?? "",
  channel: args["openos-channel"] === "stable" ? "stable" : "dev",
  platform: process.platform,
  isPackaged: args["openos-packaged"] === "1",
} satisfies DesktopBridge);

function parseArguments(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const body = item.slice(2);
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}
