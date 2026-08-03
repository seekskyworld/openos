# OpenOS Agent Contribution Guide

本文件是自动化 Coding Agent 在 OpenOS 仓库中的根级执行规范。Agent 在分析、修改、测试、提交或创建 Pull Request 前必须完整阅读本文件，并同时遵守 `CONTRIBUTING.md`、`SECURITY.md` 和任务范围内更深目录的 `AGENTS.md`（如果存在）。

## 1. 基本原则

- **Issue 驱动**：任何 Pull Request 都必须关联对应 Issue。没有 Issue 时先创建或请求创建，不得虚构编号。
- **代码与文档同一变更**：代码、架构说明、接口说明、迁移说明和用户文档必须在同一个 PR 中保持一致。
- **最小且完整**：只修改解决 Issue 所需的范围，但必须补齐测试、文档、兼容性和安全处理。
- **事实可验证**：不得声称未实际执行的测试、性能结果或兼容性结论。
- **保护贡献者工作**：不得回退、覆盖或格式化与当前 Issue 无关的修改；不得使用破坏性 Git 命令处理未知变更。

## 2. 开始工作前

1. 阅读关联 Issue，提取验收标准、非目标、兼容性要求和风险边界。
2. 阅读相关代码、测试和 `docs/` 架构文档，先理解既有模块边界再设计修改。
3. 检查 `git status`，识别并保留其他贡献者或 Agent 的未提交修改。
4. 对非平凡改动写出可验证的执行计划；计划必须包含实现、文档、测试和迁移/兼容性检查。
5. 无法确认业务规则、法律条款、外部权限或不可逆决策时，停止假设并请求维护者决策。

## 3. 代码与架构文档必须同步

以下任一变化都视为架构变化，必须在同一个 PR 中更新对应 `docs/*.md`：

- 模块职责、目录边界、依赖方向或组合根发生变化；
- HTTP、IPC、postMessage、共享类型、持久化 schema 或错误契约发生变化；
- 生成应用的缓存、编排、编译、校验、安全沙箱或运行时生命周期发生变化；
- 新增外部提供商、能力端口、后台服务、数据存储或跨层调用；
- 性能方案改变首屏、流式输出、并发、超时、重试或降级语义。

文档更新必须说明：为什么改变、边界如何变化、调用/数据流如何变化、失败与降级行为、兼容或迁移策略，以及验证方式。不能只记录文件清单，也不能让文档描述未来实现而代码仍是旧行为。

主要文档入口：

| 变更范围 | 首选文档 |
| --- | --- |
| Gen Apps 总体分层与安全边界 | `docs/gen-apps-design.md` |
| 实时生成运行时与交互协议 | `docs/generative-runtime-design.md` |
| Coding Agent 内核与任务接口 | `docs/coding-agent-architecture.md`、`docs/coding-agent-implementation.md` |
| 下一代生成路线或重大重构 | `docs/gen-apps-next-architecture.md`、`docs/gen-apps-refactor-plan.md` |
| 用户可见能力、启动方式、目录或配置 | `README.md`、`CONTRIBUTING.md` |

如果确认没有架构影响，PR 的“架构与文档”部分仍需写明 `无` 并说明理由。

## 4. 仓库边界

- `web/`：React UI、窗口系统和浏览器端工作流；不得读取本地密钥或引入 Node 权限。
- `server/`：本地 Bridge、LLM/Agent/Gen Apps 服务和持久化；业务层依赖端口，不直接耦合外部实现。
- `desktop/`：Electron 主进程、preload 和 Bridge supervisor；桌面特有能力通过受限 IPC/preload 暴露。
- `packages/shared/`：跨进程共享类型和线协议；变更必须考虑 Web、Server、Desktop 的兼容性。

遵守既有架构约定：跨边界依赖走端口注入，组合集中在组合根；`agent-core` 保持任务无关；`llm-core` 保持厂商无关；外部模型先经过适配/防腐层再进入业务层。

## 5. 实现规范

- 使用 TypeScript 严格类型，禁止用 `any`、非空断言或静默 catch 掩盖契约问题。
- 单一职责、显式依赖和可替换接口优先；避免巨型函数、隐式全局状态、魔法数字和重复逻辑。
- 错误必须可追踪，保留稳定错误码和 request ID；用户可见错误不得只写入控制台。
- 复杂约束的注释解释“为什么”，并与实现同步；不要用注释复述代码。
- 用户可见文案同时更新 `zh-CN` 与 `en-US`；UI 颜色使用主题变量并验证浅色/深色模式。
- 不提交生成目录、数据库、日志、缓存、密钥、Cookie、个人数据或本地绝对路径。
- 不随意增加依赖。新增依赖必须说明必要性、许可证、维护状态、体积和安全影响，并更新锁文件及第三方许可说明。

## 6. 安全规范

- 模型密钥只能存在服务端或本地安全存储，不能进入 renderer、日志、测试快照或 Issue/PR。
- 修改生成制品、HTML 编译、CSP、iframe sandbox、网络访问、文件读取或 Electron IPC 时，必须写明威胁模型并增加负向测试。
- 外部输入默认不可信；校验协议、大小、超时、重定向、目标地址和输出编码。
- 安全漏洞不得创建公开 Issue，按 `SECURITY.md` 使用私密渠道报告。
- 项目使用 Apache License 2.0；贡献和分发必须保留 `LICENSE`、`NOTICE` 及适用的第三方声明。

## 7. 测试与质量门禁

提交前至少执行：

```bash
npm run typecheck
npm run build
npm test -w @openos/server
```

根据改动范围追加：

```bash
npm run smoke:genapps-v2
npm run smoke:genapps-runtime
npm run smoke:genapps-games
npm run desktop:pack
npm run smoke:desktop-package
```

- Bug 修复必须先有能复现问题的回归测试；核心逻辑和边界输入必须覆盖。
- UI 修改必须验证目标桌面/移动视口、浅色/深色主题、加载/空/错误状态和无重叠。
- 性能改动必须给出可重复的基线、样本数、环境和修改后数据，不能只描述主观感受。
- 无法执行某项门禁时必须在 PR 中明确原因和残余风险，不能标记为已通过。

## 8. Commit 与 Pull Request

- 分支使用清晰前缀：`feat/`、`fix/`、`docs/`、`refactor/`、`perf/`、`test/`。
- Commit 使用 Conventional Commits：`feat:`、`fix:`、`docs:`、`refactor:`、`perf:`、`test:`。
- 一个 PR 只解决一个连贯问题；禁止混入无关重构、依赖升级或格式化。
- PR 描述必须包含：问题与动机、实现摘要、架构与文档影响、验证证据、安全/兼容性、迁移或回滚方式。
- PR 必须在“关联 Issue”中使用 GitHub 关键字：完整解决使用 `Closes #123` 或 `Fixes #123`；仅有关联但不关闭时使用 `Refs #123`。
- CI 会校验 PR 正文中的关联关键字和 Issue 编号；只在标题、评论或截图中提及不会通过门禁。
- 一个 PR 涉及多个 Issue 时逐项列出关系；不得用普通文本模糊关联，也不得关联不相关 Issue 规避要求。
- Agent 未获维护者明确授权时，不得自行合并 PR、发布 Release、推送到受保护分支或关闭未完成 Issue。

## 9. 完成定义

只有同时满足以下条件，Agent 才能报告任务完成：

- Issue 验收标准全部满足，非目标未被意外扩大；
- 代码、测试、架构文档和用户文档一致；
- 必要质量门禁已实际通过，失败和残余风险已公开说明；
- 安全、兼容性、数据迁移和回滚路径已评估；
- PR 已使用 `Closes/Fixes/Refs #编号` 关联真实 Issue；
- diff 中没有密钥、本地数据、调试代码、无关改动或过期文档。

完成报告应简洁列出实际改动、验证命令与结果、关联 Issue/PR，以及仍存在的已知风险。
