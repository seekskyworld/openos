# OpenOS 启动流程（Startup Process）

记录本地启动 OpenOS 的方式、端口、依赖关系与常见排障。

## 端口与进程

| 进程 | 端口 | 说明 |
| --- | --- | --- |
| 前端 Web（Vite dev） | `127.0.0.1:5178` | React 桌面 UI；`/api` 代理到后端 |
| 后端 Bridge | `127.0.0.1:47821` | loopback HTTP + LLM 适配 |

- 前端 `vite.config.ts` 将 `/api` 代理到 `http://127.0.0.1:47821`。
- **只跑前端**页面能打开，但 `/api` 会 502（后端没起）；对话/设置需要后端。

## 首次准备

```bash
cd openos
cp .env.example .env   # 可选：填 API Key（也可在 UI Settings 里配）
npm install
npm run build:shared
```

## 方式 A：浏览器 + 后端（推荐调试）

```bash
npm run dev:web-stack
```

- 等价于同时启动：后端 `dev:server`(47821) + 前端 `dev:web`(5178)
- 打开：http://127.0.0.1:5178/
- `-k` 参数：任一进程退出会一起关闭

单独启动（两个终端）：

```bash
npm run dev:server   # 后端 Bridge :47821
npm run dev:web      # 前端 Vite  :5178
```

## 方式 B：Electron 桌面

```bash
npm run desktop:dev
```

- 先 build shared/desktop，再启动 Vite 热更新服务，由主进程托管内置 Bridge 并打开桌面窗口
- Vite 默认使用 5178，端口占用时自动向后选择；Bridge 同样会从 47821 起选择空闲端口
- macOS：`~/Library/Application Support/OpenOS Dev/data/`（打包版为 `OpenOS`）

生产静态资源联调与打包验收：

```bash
npm run desktop:dev:static
npm run desktop:pack
npm run smoke:desktop-package
npm run desktop:dist
```

- `desktop:pack` 产出当前平台未压缩应用目录，便于快速验证。
- `desktop:dist` 产出安装包到 `release/`；本地默认不签名，正式发布需在 CI 配置签名/公证。
- 打包后的 Bridge 由 Electron 自带 Node 运行，不依赖系统安装 Node.js。

## 构建

```bash
npm run build          # shared + server + web + desktop
npm run typecheck      # 全量类型检查
```

## 授权 / 配置存储

| 文件 | 内容 | 位置 |
| --- | --- | --- |
| `auth.json` | 各 provider 的 API Key / OAuth token（0600） | 桌面：`userData/data/`；纯后端回退：`./.openos/` |
| `settings.json` | 当前 provider / model / baseUrl | 同上 |

- 密钥只在本机后端读取，不进前端构建产物，不入库（`.openos/` 已在 .gitignore）。

## 排障：http://127.0.0.1:5178/ 进不去

1. **dev server 没在跑**（最常见）：`lsof -ti:5178` 为空即未启动 → 运行 `npm run dev:web-stack`。
2. **只跑了后端**：`dev:server` 不含前端 → 需再跑 `dev:web` 或直接用 `dev:web-stack`。
3. **用的是桌面模式**：`desktop:dev` 会自行启动一个 Vite 端口，但应直接使用 Electron 窗口。
4. **端口被占用**：`lsof -ti:5178 | xargs kill -9` 释放后重启。
5. **后端未起导致 /api 502**：确认 47821 已监听（`curl 127.0.0.1:47821/api/health`）。

快速自检：

```bash
curl -s -o /dev/null -w "web %{http_code}\n" http://127.0.0.1:5178/
curl -s http://127.0.0.1:47821/api/health
```
