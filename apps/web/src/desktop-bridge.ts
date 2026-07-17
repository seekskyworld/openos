/** 桌面 preload 注入到 renderer 的最小 API（无 Node 权限） */
export type OpenosDesktopBridge = {
  apiBase: string;
  bridgeToken: string;
  channel: "dev" | "stable";
  platform: string;
  isPackaged: boolean;
};
