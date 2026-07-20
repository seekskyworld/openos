/// <reference types="vite/client" />

import type { OpenosDesktopBridge } from "./desktop-bridge";

declare global {
  interface Window {
    openosDesktop?: OpenosDesktopBridge;
  }
}

export {};
