<p align="center">
  <img src="assets/logo.png" alt="OpenOS logo" width="160" />
</p>

<h1 align="center">OpenOS</h1>

<p align="center"><b>Generate Everything, Create Infinite.</b></p>

<p align="center">
  一个「AI 生成应用」的桌面操作系统 —— macOS 风格的 Web/Electron 桌面壳，
  内置 Siri 风格助手 <b>Sir</b>，在启动台里搜索即可让大模型为你<b>现场生成可用的应用</b>，
  关闭即安装、下次秒开。
</p>

<p align="center">
  <img src="assets/logo-text.png" alt="OpenOS — Generate Everything, Create Infinite" width="420" />
</p>

---

## ✨ 特性

### 🖥 macOS 风格桌面（纯前端实现，零图片资源）
- CSS 绘制的渐变壁纸、透明菜单栏（下拉菜单随聚焦应用变化）、毛玻璃 Dock
- 完整窗口系统：拖拽 / 红黄绿交通灯（关闭 · 抽屉式最小化到 Dock 缩略图 · 最大化）/ 点击背后窗口置顶 / 点击壁纸「显示桌面」四周散开
- 通知中心（点击菜单栏时间滑出：通知卡片 + 走秒的世界时钟）、应用数字角标、启动台（网格 / 列表、分类、搜索）
- 全局浅色 / 深色主题、中英文即时切换（统一 CSS 变量 + i18n）

### 🤖 Sir 助手
- Siri 风格玻璃光球动效（花瓣色块 bloom + 表面与内部流光）
- iMessage 风格深色聊天界面，多会话管理，SQLite 持久化，会话可删除

### 🪄 Gen Apps：搜索即生成应用
- 启动台输入关键词 → 浏览器按已加载设置同步生成完整候选；Bridge API 为其他调用方复用同一策略（均不等待模型）
- 点击候选 → **Cache-first Instant 生成**：成品缓存 → AppRecipe/本地引擎 → blueprint → 单轮 Instant；仅显式精修模式进入最多 3 轮校验/修复
- 扫雷、数独、贪吃蛇命中 `AppRecipe + EngineRegistry`，毫秒组装并由可信本地规则/动画引擎运行，不调用模型
- 生成的应用运行在 CSP + sandbox iframe 中（无网络、无宿主访问）；关闭即安装进启动台，二次打开直接读库、不再调模型
- 搜索框可通过声明式 `web.search` 注入真实网络结果并用 `web.open` 打开正文；iframe 仍无公网权限，服务端固定搜索出口并安全提取网页纯文本
- 生成偏好滑杆四档：系统工具 → 商店应用 → 独立开发 → 天马行空（同时映射提示词风格与采样温度）

### 🔌 多厂商 LLM 接入
- **llm-core 自有协议层**：内部统一请求协议（CoreRequest/CoreResponse）+ wire 适配器（OpenAI Chat / OpenAI Responses / Anthropic Messages / Google Gemini）+ 协议自动回退链
- 十余家提供商一键连接（OAuth / API Key），自定义端点支持多协议、多鉴权与真实模型列表拉取
- 未配置密钥时自动走本地 mock / fake 生成器，纯前端开发不依赖任何模型

## 🏗 架构

```text
apps/desktop      Electron 主进程 / preload / Bridge supervisor
apps/web          React 桌面 UI（窗口系统 / 启动台 / Sir / 设置 / 通知中心）
apps/server       本地 Bridge（loopback HTTP）
  ├─ llm-core     内部协议 → 各厂商 wire 协议适配 + 回退链
  ├─ agent-core   任务无关的 coding-agent 循环内核（AgentTask<T> 注入）
  ├─ gen-apps     生成应用：Service / Repository / ArtifactCompiler / Validator
  └─ database     SQLite（WAL + 版本迁移）：会话消息 / 生成应用制品
packages/shared   前后端共享类型、线协议 schema、错误码
```

设计要点：

- **端口与适配器**：Suggestion / Artifact / Fragment / Cache / Runtime 都是独立端口，`GenerationOrchestrator` 负责缓存优先和并发合并，`create-server.ts` 只做组合根；fake / blueprint / llm / agentic 生成器可替换
- **agent-core 与任务解耦**：循环内核只懂「生成 → 校验 → 喂回 → 修复」，HTML 应用只是一个 `AgentTask<string>` 实现——接入新的生成任务（SQL、图表、脚本…）只需再写一个任务包
- **安全**：生成代码经 ArtifactCompiler 重建外壳并注入 CSP，运行于 `sandbox="allow-scripts"` iframe；密钥只存在服务端，renderer 无 Node 权限
- **双端一致**：浏览器走 Vite 代理 `/api`，Electron 走 preload 注入的 apiBase + token，同一套 UI 与接口；dev / stable 通道数据隔离

## 🚀 快速开始

要求：Node.js ≥ 22（SQLite 使用内置 `node:sqlite`）

```bash
git clone <repo-url> && cd openos
cp .env.example .env        # 可选：预填 LLM Key（也可稍后在设置界面配置）
npm install
npm run build

# 方式 A：浏览器（后端 + 前端 dev server）
npm run dev:web-stack
# 打开 http://127.0.0.1:5178

# 方式 B：Electron 桌面
npm run desktop:dev
```

`desktop:dev` 会自动构建主进程和内置 Bridge、启动 Vite 热更新服务并拉起 Electron；
若 5178 已占用，会自动使用后续空闲端口。使用生产静态资源联调可运行
`npm run desktop:dev:static`。

桌面打包：

```bash
npm run desktop:pack          # 生成当前平台的未压缩应用目录，适合快速验收
npm run smoke:desktop-package # 启动打包应用，验证内置 Bridge 和渲染页
npm run desktop:dist          # 生成当前平台的安装包到 release/
```

安装包内置 Bridge 和运行时，不依赖用户预装 Node.js。当前本地构建默认不签名；
正式分发时应在 CI 中配置对应平台的签名与公证凭据。

首次使用：打开 **系统设置 → Providers** 连接一个模型提供商（OAuth 或 API Key），
然后在 Dock 点 **App** 打开启动台，搜索任意关键词（如「计算器」）体验 AI 生成应用。

## ⚙️ 配置

| 途径 | 说明 |
| --- | --- |
| 设置界面 | Providers（OAuth / API Key + 模型选择）、自定义端点、生成偏好、外观、语言 |
| `.env` | 见 `.env.example`；UI 里的配置优先于环境变量 |
| 厂商标准 env | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 等会被自动读取 |

数据目录（按通道隔离，密钥与数据只落在本机）：

| 端 | 路径 |
| --- | --- |
| Electron dev | `~/Library/Application Support/OpenOS Dev/data/` |
| Electron stable | `~/Library/Application Support/OpenOS/data/`（默认强制 bridge token） |
| 浏览器开发态 | 服务端工作目录下 `.openos/` |

## 📡 主要 API（本地 Bridge）

| 端点 | 说明 |
| --- | --- |
| `GET /api/health` · `GET /api/bootstrap` | 健康检查 / 运行时信息 |
| `POST /api/chat` | Sir 对话 |
| `GET/POST /api/threads*` | 会话与消息（SQLite） |
| `POST /api/gen-apps/suggestions` | 毫秒级生成应用候选（不调用 LLM） |
| `POST /api/gen-apps/drafts` | Coding Agent 生成应用（多轮） |
| `POST /api/gen-apps/:id/install` · `/launch` · `DELETE /:id` | 安装 / 打开 / 删除 |
| `GET /api/gen-apps/progress/:key` | 生成进度轮询 |
| `GET/PUT /api/settings/llm` · `/gen-apps` | 设置读写（密钥脱敏返回） |

## 🧭 开发

```bash
npm run typecheck        # 全部 workspace 类型检查
npm run build            # shared → server → web → desktop
npx tsx apps/server/scripts/smoke-agent-core-run.ts   # agent 内核冒烟（5 路径）
OPENOS_GENAPPS_FAKE=1 npm run dev:server              # 无模型开发（确定性 fake 生成器）
```

设计文档见 [`docs/`](docs/)：Gen Apps 架构、Coding Agent 架构与实施文档。

## 🤝 贡献

欢迎 Issue 与 PR。提交前请确保：

1. `npm run typecheck` 与 `npm run build` 通过；
2. 涉及生成应用安全面（ArtifactCompiler / Validator / 沙箱策略）的改动附带说明与冒烟结果；
3. UI 改动兼顾浅色与深色主题（统一使用 `--surface-*` / `--ink-*` / `--line-*` 主题变量）。

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 📄 License

[MIT](LICENSE)
