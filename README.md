<p align="center">
  <img src="assets/logo.png" alt="OpenOS logo" width="140" />
</p>

<h1 align="center">OpenOS</h1>

<p align="center">
  <b>Generate Everything, Create Infinite.</b><br />
  让想法直接成为正在运行的应用。
</p>

<p align="center">
  一个面向实时生成应用的 AI 桌面操作系统。<br />
  在启动台描述需求，让大模型现场生成可运行、可交互、可持续更新的应用；<br />
  关闭即安装，再次打开直接恢复。
</p>

<p align="center">
  <a href="https://github.com/seekskyworld/openos/actions/workflows/ci.yml"><img src="https://github.com/seekskyworld/openos/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-3da639" alt="Apache License 2.0" /></a>
  <img src="https://img.shields.io/badge/platform-Web%20%7C%20macOS-2f7af8" alt="Web and macOS" />
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22 or newer" /></a>
  <a href="https://www.electronjs.org/"><img src="https://img.shields.io/badge/Electron-39-47848f?logo=electron&logoColor=white" alt="Electron 39" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=111" alt="React 19" /></a>
</p>

<p align="center">
  <a href="#vision">开源愿景</a> ·
  <a href="#features">核心特性</a> ·
  <a href="#architecture">架构</a> ·
  <a href="#quick-start">快速开始</a> ·
  <a href="#contributing">参与贡献</a>
</p>

<p align="center">
  <img src="assets/logo-text.png" alt="OpenOS — Generate Everything, Create Infinite" width="420" />
</p>

---

<a id="vision"></a>

## 🌌 开源愿景：让应用在模型输出时就开始运行

大模型正在进入高速 Token 输出时代，但传统 AI 编程链路仍然要求模型先生成完整项目、安装依赖、编译，再把结果交给用户。模型越快，后面的工程等待越显得笨重。

OpenOS 想探索另一条开源路线：**不等待完整应用一次性交付，而是让生成过程本身成为应用的启动过程。** 模型先返回最小可运行界面，宿主立即渲染；随后以闭合、可校验的 HTML 阶段持续补齐内容与交互。通用样式、安全边界、窗口能力和可信行为由本地运行时提供，模型只生成真正属于这个应用的部分。

这条路线会分阶段推进：

| 阶段 | 用户体验 | 核心机制 |
| --- | --- | --- |
| 已知应用秒开 | 常见应用和历史生成结果即时出现 | 成品缓存、语义缓存、`AppRecipe`、可信本地引擎 |
| 冷生成快速首屏 | 模型尚未输出完，窗口已经可见 | `shell -> core -> content -> actions` 原子渐进 HTML、流式快照 |
| 生成即交互 | 页面补齐过程中即可点击、输入和运行 | 宿主 UI Kit、本地 Action Runtime、按需最小更新 |
| 高速模型实时应用 | 充分利用各厂商更高的 Token 速率 | 协议适配、流控、并发生成、增量校验与即时提交 |

“秒开”不应该只是先展示一个空壳来掩盖等待，而应该意味着：首个有用界面尽早出现，已经生成的部分立即可用，后续内容稳定地原地补齐。随着模型推理和输出速度继续提升，自然语言到可运行应用的距离会不断缩短，直到应用可以按想法实时出现。

最终，OpenOS 不只是一个固定应用集合，而是一套开放的生成式应用运行时：工具、内容、游戏、数据界面，乃至今天还没有名字的软件形态，都可以被现场组合出来。**一切皆有可能。**

---

<a id="features"></a>

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

<a id="architecture"></a>

## 🏗 架构

```text
desktop      Electron 主进程 / preload / Bridge supervisor
web          React 桌面 UI（窗口系统 / 启动台 / Sir / 设置 / 通知中心）
server       本地 Bridge（loopback HTTP）
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

<a id="quick-start"></a>

## 🚀 快速开始

要求：Node.js ≥ 22（SQLite 使用内置 `node:sqlite`）

```bash
git clone https://github.com/seekskyworld/openos.git && cd openos
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
npx tsx server/scripts/smoke-agent-core-run.ts   # agent 内核冒烟（5 路径）
OPENOS_GENAPPS_FAKE=1 npm run dev:server              # 无模型开发（确定性 fake 生成器）
```

设计文档见 [`docs/`](docs/)：Gen Apps 架构、Coding Agent 架构与实施文档。

<a id="contributing"></a>

## 🤝 贡献

欢迎 Issue 与 PR。提交前请确保：

1. `npm run typecheck` 与 `npm run build` 通过；
2. 涉及生成应用安全面（ArtifactCompiler / Validator / 沙箱策略）的改动附带说明与冒烟结果；
3. UI 改动兼顾浅色与深色主题（统一使用 `--surface-*` / `--ink-*` / `--line-*` 主题变量）。

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。使用 Coding Agent 贡献时请先阅读
[AGENTS.md](AGENTS.md)，其中定义了 Issue 关联、代码与架构文档同步、安全和验证规范。

社区协作遵循 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。安全漏洞请按
[SECURITY.md](SECURITY.md) 私密报告，不要创建公开 Issue。第三方依赖许可说明见
[docs/third-party-licenses.md](docs/third-party-licenses.md)。

## 📄 License

[Apache License 2.0](LICENSE)。再分发时请同时保留 [NOTICE](NOTICE)。
