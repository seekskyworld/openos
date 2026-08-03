# 为 OpenOS 贡献

感谢你的关注！OpenOS 是 TypeScript + Electron 的 monorepo（npm workspaces），
欢迎任何形式的贡献：Bug 报告、功能建议、文档改进、代码 PR。

使用 Coding Agent 参与贡献时，必须先阅读并遵守根目录 [AGENTS.md](AGENTS.md)。

除非贡献者在提交时明确书面声明其他条款，所有有意提交并被项目接收的贡献均按
[Apache License 2.0](LICENSE) 授权，不附加额外条款。

## 开发环境

- Node.js ≥ 22（`node:sqlite` 为内置模块）
- macOS 上体验最佳（桌面壳按 macOS 风格设计），浏览器模式跨平台可用

```bash
npm install
npm run build          # shared → server → web → desktop
npm run dev:web-stack  # 后端 + Vite dev server，浏览器打开 http://127.0.0.1:5178
```

无模型开发：`OPENOS_GENAPPS_FAKE=1 npm run dev:server` 使用确定性 fake 生成器，
所有 Gen Apps 流程（候选 → 生成 → 安装 → 打开 → 删除）都可离线走通。

## 目录导览

| 路径 | 内容 |
| --- | --- |
| `web/src/window/` | 窗口系统（`DesktopWindow` + `useWindowManager`） |
| `web/src/launcher/` | 启动台与 Gen Apps 前端工作流 |
| `server/src/llm-core/` | 内部协议层与厂商 wire 适配器 |
| `server/src/agent-core/` | 任务无关的 agent 循环内核 |
| `server/src/gen-apps/` | 生成应用服务 / 校验 / 编译 / 仓储 |
| `packages/shared/` | 前后端共享类型与线协议 schema |
| `docs/` | 架构与实施文档 |

## 提交 PR 前

1. 有对应 Issue 时使用 `Closes #编号` / `Fixes #编号` / `Refs #编号` 关联；没有时在 PR 中简述原因；
2. 代码与对应架构、接口或用户文档在同一个 PR 中同步更新；
3. `npm run typecheck` 与 `npm run build` 全部通过；
4. 后端改动跑一遍相关冒烟脚本（`server/scripts/`），如
   `npx tsx server/scripts/smoke-agent-core-run.ts`；
5. UI 改动同时检查浅色与深色主题——颜色一律使用主题变量
   （`--surface-*` / `--ink-*` / `--line-*`），不要硬编码色值；
6. 文案改动同步 `web/src/i18n/` 的 zh-CN 与 en-US 两份词条；
7. 涉及生成应用安全面（ArtifactCompiler / ArtifactValidator / iframe 沙箱策略 / CSP）
   的改动，请在 PR 描述中说明威胁模型影响并附冒烟结果。

## 架构约定

- **端口与适配器**：跨边界依赖走 `ports.ts` 接口注入，组合只发生在 `create-server.ts`；
- **agent-core 保持任务无关**：任何制品特定逻辑（提示词、提取、校验）放进 `AgentTask<T>` 实现，不进内核；
- **llm-core 保持厂商无关**：新协议只加 wire 适配器，业务代码只依赖 CoreRequest/CoreResponse；
- **密钥不进前端**：renderer 无 Node 权限，任何密钥只落在服务端存储。

## 报告问题

提 Issue 时请附：复现步骤、期望/实际行为、运行方式（浏览器 / Electron）、
Node 版本，以及（若与生成相关）所用提供商与模型。

安全漏洞不要提交公开 Issue，请遵循 [SECURITY.md](SECURITY.md) 的私密报告流程。
参与项目即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
