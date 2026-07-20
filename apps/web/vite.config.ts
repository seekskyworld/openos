import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const appRoot = dirname(fileURLToPath(import.meta.url));

// 开发态代理到本地 bridge，避免浏览器 CORS 与端口耦合
export default defineConfig({
  root: appRoot,
  // Electron 通过 file:// 加载生产制品，资源必须相对 index.html 解析。
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5178,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:47821",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(appRoot, "dist"),
    emptyOutDir: true,
  },
});
