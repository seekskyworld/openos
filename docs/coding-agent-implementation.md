# Gen Apps Coding Agent 实施文档

> 状态：核心链路已实施；本文保留 agentic 精修与后续拆分事项
> 原则：每步可独立验收、可回退；接缝不动（GenAppGenerator 端口）；先校验器后循环，先 fake 后真模型

---

## 阶段一：ArtifactValidator（校验器先行）

> 校验器是价值核心，先做并单独测通——它独立于循环存在，单发模式也能用它做“生成后提示”。

### 1.1 新增文件

```text
server/src/gen-apps/artifact-validator.ts
```

内容要点：

- `validateArtifact(html: string): ValidationIssue[]`（纯函数，零依赖零 IO）
- 实现架构文档 §3.1 的 V1–V9 校验项
- V2 JS 语法校验用 `node:vm` 的 `new vm.Script(code)`（只编译不执行），SyntaxError 时从 message 提取行号
- 从 `artifact-compiler.ts` 抽出 `extractParts()` 为共享私有模块（`artifact-extract.ts`），编译器与校验器共用，避免两套提取逻辑漂移

### 1.2 验收

- 单元冒烟（node 脚本即可，不引测试框架）：
  - 语法错 HTML → 返回 `js_syntax_error` fatal
  - 无事件绑定的按钮页 → `no_event_binding` fatal
  - 带 `fetch(` 字面量 → `external_resource` fatal
  - 用 localStorage → `uses_localstorage` warning
  - 正常计算器 fixture → 空数组
- `npx tsc -p server/tsconfig.json` 通过

### 1.3 回退

删除新文件即可，无其他改动。

---

## 阶段二：AgentLoop + AgenticGenAppGenerator

### 2.1 新增文件

```text
server/src/gen-apps/agent/agent-loop.ts        # 循环本体（纯逻辑）
server/src/gen-apps/agent/agentic-generator.ts # GenAppGenerator adapter
```

### 2.2 agent-loop.ts 要点

```ts
type AgentLoopDeps = {
  generate(messages: CoreMessage[], temperature: number, signal: AbortSignal): Promise<string>;
  validate(html: string): ValidationIssue[];
  extractHtml(raw: string): string;         // 代码块提取（复用现有 extract 逻辑）
  onProgress?(event: AgentProgressEvent): void;
  maxRounds: number;                        // 2-3
  roundTimeoutMs: number;                   // 90_000
};

async function runAgentLoop(deps, firstPrompt: CoreMessage[], signal): Promise<AgentRunResult>
```

- 事件顺序：`generating` → `checking(0)` → [`fixing(1)` → `checking(1)` → …] → `done(outcome)`
- 每轮：`AbortSignal.any([外部 signal, AbortSignal.timeout(roundTimeoutMs)])`
- 修复轮 prompt 按架构文档 §3.2 组装（上一轮 HTML + 错误清单 + 输出约束重申），固定温度 0.2
- 降级策略按架构文档 §2.4 实现
- **不 import llm-core / fs / http**——generate 是注入的函数，循环可用 fake 100% 单测

### 2.3 agentic-generator.ts 要点

- `class AgenticGenAppGenerator implements GenAppGenerator`
- `suggest()` 复用 `LlmGenAppGenerator.suggest` 的共享确定性策略；候选不进入 AgentLoop，也不调用 LLM
- `generate()`：
  1. 组装首轮 prompt（复用 `prompt-policy.buildGeneratePrompt`）
  2. 构造 deps：`generate` 走 `coreGenerate`（llm-core），`validate` 走阶段一校验器
  3. `runAgentLoop(...)` → 取 `result.html` 返回 `UntrustedArtifact`
  4. outcome/rounds 写入日志（console，含 requestId）

### 2.4 组合根装配

`create-server.ts`（当前实现）：

```ts
const genAppsGenerator =
  process.env.OPENOS_GENAPPS_FAKE === "1"
    ? new DeterministicFakeGenerator()
    : new GenerationOrchestrator({          // cache -> blueprint -> instant -> agentic
        suggestionProvider,
        instantGenerator,
        agenticGenerator,
        cache,
      });
```

候选、成品生成和缓存通过独立端口注入；组合根不再把设置切换、缓存和模型协议揉进单一 generator。

### 2.5 验收

- fake deps 单测循环：
  - 首轮即 PASS → 1 轮结束，outcome=clean
  - 首轮 fatal、修复轮 PASS → 2 轮，outcome=clean
  - 全轮 fatal 但有可编译版本 → outcome=degraded
  - 全轮不可用 → 抛 invalid_model_output
  - 外部 abort → 当前轮中断，错误传播
- `OPENOS_GENAPPS_FAKE=1` 全链路回归（fake generator 不走循环，不受影响）
- server build 通过

### 2.6 回退

组合根一行切回 `LlmGenAppGenerator`；新文件不影响其他路径。

---

## 阶段三：设置项与前端

### 3.1 服务端设置

`gen-app-settings.ts`：

- `generationMode: "fast" | "agentic"`（默认 `"fast"`）+ `clampMode`
- `agentMaxRounds: number`（默认 3，clamp 2-3；0 会迁移为 3，不再无限循环）
- `PUT /api/settings/gen-apps` 透传两字段（已有路由，加两行）

### 3.2 前端设置页

`SettingsApp.tsx`「AI 应用」面板：

- 生成模式分段控件（复用 `.mode-switch/.mode-chip` 样式）：快速 / 精修
- 精修模式下显示轮次滑杆（复用 `.genapps-slider`，min 1 max 4）
- i18n：`genapps.mode` / `genapps.mode.fast` / `genapps.mode.agentic` / `genapps.rounds` 等（zh/en）

### 3.3 验收

- 设置读写持久化（curl PUT/GET）
- 切快速模式 → 单发路径；切精修 → 循环路径（日志可见轮次）

---

## 阶段四：进度透传（轮询版）

### 4.1 服务端

- `AgenticGenAppGenerator` 持有 `Map<idempotencyKey, AgentProgressEvent>`（内存，run 结束后 60s 清理）
- Controller 新增只读路由：
  `GET /api/gen-apps/progress/:idempotencyKey` → `{ phase, round? }`（未知 key 返回 `{ phase: "unknown" }`，200）

### 4.2 前端

- `useGenAppWorkspace.activateSuggestion` 生成期间每 2s 轮询 progress，写入 `view.agentPhase`
- 进度条 UI 不变（仍是无文字光线细条）；`AppLauncher` 的 `aria-label` 带上阶段（无障碍，不显示文字）
- 生成结束（成功/失败）即停轮询

### 4.3 验收

- 精修模式生成期间，Network 面板可见 progress 轮询与 phase 变化
- 快速模式不发起轮询

---

## 阶段五：真实模型端到端

前置：上游服务可用（当前 api.golutra.cn 间歇 503）。

- 搜索「计算器」→ 点候选 → 精修模式生成 → Runner 打开可交互应用
- 人为构造失败场景验证修复轮：临时把 V5 阈值调严，确认错误喂回后第二轮产物变化
- 对比快速/精修两种模式的产物可用率（手测 5 个不同类型应用：计算器、番茄钟、待办、取色器、骰子）

---

## 里程碑与工作量预估

| 阶段 | 内容 | 预估 | 依赖 |
| --- | --- | --- | --- |
| 一 | ArtifactValidator + extract 抽取 | 0.5 天 | 无 |
| 二 | AgentLoop + AgenticGenerator + 组合根 | 1 天 | 阶段一 |
| 三 | 设置项（服务端+前端） | 0.5 天 | 阶段二 |
| 四 | 进度轮询 | 0.5 天 | 阶段二 |
| 五 | 真模型 E2E 调优（prompt/阈值微调） | 0.5-1 天 | 上游可用 |

总计约 3-3.5 天等效工作量；阶段一/二完成后即可在 fake 路径演示完整循环。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 修复轮模型输出 diff 而非完整 HTML | 提取器识别不完整输出（无 `<html`/长度骤减）→ 该轮判 fatal `incomplete_output`，喂回重申约束 |
| 校验器误报（把好代码判坏） | warning 不阻断；fatal 项全部选「确定性可判」的（语法/外链/零绑定）；V5 交互启发式留白名单（纯展示类应用如时钟可豁免——首轮 prompt 声明应用类型） |
| 轮次内存泄漏（progress Map） | run 结束 60s 定时清理 + Map 容量上限 100 |
| token 成本失控 | maxRounds clamp 4；修复轮不重发原始需求全文；整体 240s 预算硬顶 |
| 上游 503 期间无法验收阶段五 | 阶段一-四全部可用 fake/mock 验收，阶段五独立排期 |
