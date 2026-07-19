# Gen Apps Coding Agent 架构设计

> 状态：待 owner 审核
> 目标：把 Gen Apps 的「单发生成」升级为「agent 循环生成」——生成 → 本地校验 → 错误反馈 → 修复，直到制品可用或预算耗尽
> 参考：pi（packages/agent 的事件化 agent loop 思想）、opencode（协议分层思想）；核心实现为自研，不引入外部 agent 框架
> 配套文档：`coding-agent-implementation.md`（实施步骤）

---

## 0. 参考项目核心思想提炼（pi）

研读 `project/pi/packages/agent` 后，提炼出与我们场景相关的四个设计要点：

| pi 的设计 | 要点 | 我们的取舍 |
| --- | --- | --- |
| **事件化循环**（agent_start / turn_start / message_start / tool_execution / turn_end / agent_end） | 循环的每一步都以事件流对外发布，UI 与循环解耦 | ✅ 采纳：我们的进度事件（generating / checking / fixing-round-N）走同样思路，前端进度条只订阅事件 |
| **转换边界**（convertToLlm：内部消息 → LLM 消息只在调用边界转换一次） | 循环内部用自己的消息模型，与厂商协议无关 | ✅ 采纳：循环内部只操作 `AgentTurn` 内部结构，出口才经 llm-core 编码为 wire 协议 |
| **工具即校验**（tool execute → result → 错误回喂） | 工具执行结果（含错误）作为下一轮输入 | ✅ 转化采纳：我们没有通用工具，但「校验器」正是一种确定性工具——它的输出（错误清单）就是喂回模型的 tool result |
| **可中断/可继续**（AbortSignal 贯穿、steering message 注入、shouldStopAfterTurn 钩子） | 外部随时可以打断或注入新指令 | ✅ 部分采纳：AbortSignal 贯穿每轮；steering 暂不需要（无交互式用户插话场景），保留钩子位 |

不采纳的部分及原因：

- **通用工具系统 / 文件系统访问 / bash 执行**：我们的制品是纯内存单文件 HTML，无文件系统操作，引入即是攻击面。
- **流式 token 输出**：Runner 是"生成完→一次展示"，不需要 token 级流式；轮次级进度事件已足够。
- **压缩/上下文管理（compaction）**：循环最多 3-4 轮，上下文远小于窗口，不需要。

## 1. 在现有架构中的位置

Coding Agent 是 **`GenAppGenerator` 端口的又一个 adapter**，接缝完全不变：

```text
GenAppsService（不变）
    └─ GenAppGenerator port（不变）
         ├─ DeterministicFakeGenerator   （已有：开发/测试）
         ├─ LlmGenAppGenerator           （已有：单发模式）
         └─ AgenticGenAppGenerator       （新增：agent 循环模式）★
              ├─ ArtifactValidator       （新增：本地校验器，零 token）
              ├─ AgentLoop               （新增：轮次循环 + 事件发布）
              └─ llm-core                （已有：内部协议 → wire 协议）
```

依赖规则（延续既有约定）：

- `AgenticGenAppGenerator` 只依赖 `llm-core`、`prompt-policy`、`ArtifactValidator`，不依赖 HTTP / SQLite / React；
- `GenAppsService`、Repository、Controller、前端 Workspace **零改动**（除进度事件透传）；
- 单发/循环模式的选择在组合根（`create-server.ts`）与设置项完成。

## 2. Agent 循环设计

### 2.1 状态机

```text
        ┌─────────────────────────────────────────────┐
        v                                             │
generate(首轮 prompt)                                  │
        │                                             │
        v                                             │
   validate（本地，零 token）                          │
        │                                             │
   ┌────┴─────┐                                       │
   v          v                                       │
 PASS       FAIL ──> 剩余轮次 > 0 ？──yes──> fix(错误清单喂回) ──┘
   │          │
   │          no
   v          v
 完成    降级策略（见 2.4）
```

### 2.2 内部数据结构（循环私有，不进任何契约）

```ts
type AgentTurn = {
  round: number;                    // 0 = 首轮生成，1+ = 修复轮
  html: string;                     // 该轮模型产出（已提取）
  issues: ValidationIssue[];        // 校验器输出
  usage?: { promptTokens; completionTokens };
  durationMs: number;
};

type ValidationIssue = {
  severity: "fatal" | "warning";    // fatal 必须修复；warning 仅提示
  code: string;                     // 稳定枚举，见 §3
  message: string;                  // 喂回模型的自然语言描述
  excerpt?: string;                 // 相关代码片段（截断）
};

type AgentRunResult = {
  html: string;                     // 最终制品（未过编译器；由 Service 继续走 compileArtifact）
  rounds: AgentTurn[];              // 全部轮次（观测用）
  outcome: "clean" | "degraded" | "failed";
};
```

### 2.3 轮次预算与超时

| 项 | 默认值 | 说明 |
| --- | --- | --- |
| 最大轮次 | 3（首轮 + 2 修复轮） | 设置可调 2-3；游戏/recipe 不进入 AgentLoop |
| 单轮超时 | 90s | 每轮独立计时（沿用 llm-core timeoutMs） |
| 整体预算 | 240s | 由 Service 层 AbortSignal.timeout 控制，超时中断当前轮 |
| 修复轮温度 | 0.2（固定低温） | 修复是收敛任务，与 creativity 档位无关 |

### 2.4 降级策略（预算耗尽仍 FAIL 时）

按优先级：

1. 若历史轮次中存在「仅 warning 无 fatal」的版本 → 取该版本（outcome=degraded）；
2. 若所有轮次都有 fatal，但存在能被 ArtifactCompiler 接受的版本 → 取最后一个可编译版本（outcome=degraded）；
3. 否则抛 `invalid_model_output`（retryable=true），前端错误横幅提示可重试。

### 2.5 事件与进度透传

沿用 pi 的事件化思想，但轮次级粒度即可：

```ts
type AgentProgressEvent =
  | { phase: "generating" }                 // 首轮
  | { phase: "checking"; round: number }    // 校验中
  | { phase: "fixing"; round: number }      // 修复轮进行中
  | { phase: "done"; outcome: AgentRunResult["outcome"] };
```

传播路径：AgentLoop → Generator（onProgress 回调）→ Controller（SSE 或轮询暂不做，第一期把当前 phase 写入内存 Map，前端轮询 `GET /api/gen-apps/drafts/:key/progress`）→ 前端光线进度条不变，仅 title 提示轮次（可选）。

> 第一期简化：不上 SSE。生成通常 1-3 轮 × 数十秒，轮询 2s 一次成本可忽略；接口形状先定，后续换 SSE 不动契约。

## 3. ArtifactValidator（本地校验器）

这是本方案的价值核心——**检查器质量决定 agent 上限**。全部本地执行，零 token。

### 3.1 校验项清单

| # | 校验项 | severity | 实现方式 |
| --- | --- | --- | --- |
| V1 | HTML 可提取（非空、可解析出 body/script） | fatal | 复用 ArtifactCompiler 的 extract 阶段（重构为可单独调用） |
| V2 | JS 语法合法 | fatal | `new Function(js)` 包裹 parse（不执行）；捕获 SyntaxError 行号 |
| V3 | 无外链资源（script src / link href / fetch / XHR / WebSocket 字面量） | fatal | 静态扫描（编译器会剥离，但剥离后功能会坏——提前让模型改掉比默剥离更好） |
| V4 | 体积 ≤ 512KiB | fatal | byteLength |
| V5 | 交互性启发：存在事件绑定（addEventListener / on*= ）且可交互元素（button/input/select）数 > 0 | fatal | 正则计数 + 比对 |
| V6 | 无明显空壳：body 文本+元素数量下限 | fatal | 节点粗计数 |
| V7 | localStorage / cookie 使用 | warning | 静态扫描（沙箱里会静默失败，提示模型改内存变量） |
| V8 | viewport/自适应缺失 | warning | meta 检查 |
| V9 | 未捕获的顶层 throw 模式（如直接访问不存在 API） | warning | 已知危险 API 列表扫描（navigator.clipboard、Notification 等沙箱不可用项） |

### 3.2 错误喂回格式

修复轮的 user 消息 = 上一轮完整 HTML + 结构化错误清单：

```text
你上一轮生成的应用未通过自动检查，请修复以下问题后重新输出完整 HTML（仍然单文件、无外部资源）：

[FATAL] js_syntax_error: 第 42 行附近 SyntaxError: Unexpected token '}'
  相关片段：`function calc() { retrun a + b; }`
[FATAL] no_event_binding: 检测到 6 个 button 但没有任何事件绑定，应用不可交互
[WARN] uses_localstorage: localStorage 在沙箱中不可用，请改用内存变量

只输出修复后的完整 HTML 文档，不要解释。
```

要点：

- fatal 在前、附代码摘录（截断 200 字符）——给模型可定位的信号；
- 明确重申输出约束（完整单文件），防止模型只输出 diff；
- 修复轮不重发原始需求全文，节省 token（HTML 本身已携带需求实现信息）。

## 4. 与设置系统的集成

`gen-apps-settings.json` 新增：

```json
{
  "version": 1,
  "suggestionCount": 6,
  "creativity": 25,
  "appLanguage": "auto",
  "generationMode": "fast",        // "fast" 单发 | "agentic" 循环（显式）
  "agentMaxRounds": 3              // 2-3
}
```

设置页「AI 应用」增加：

- 生成模式分段控件：快速（单发，约 30-60s）/ 精修（agent 循环，约 1-3 分钟，更可靠）；
- 精修轮次滑杆 2-3（仅精修模式显示）。

组合根按 `generationMode` 装配 `LlmGenAppGenerator` 或 `AgenticGenAppGenerator`（每请求读取设置，支持热切换）。

## 5. 可观测性

每次 agent run 记录（仅日志/内存，不入库）：

- requestId、轮次数、每轮 durationMs 与 usage、每轮 issue code 列表；
- 最终 outcome（clean/degraded/failed）；
- 不记录完整 HTML 与 API key。

后续可将 rounds 摘要挂到 `gen_apps` 表的观测字段（本期不做，避免 schema 抖动）。

## 6. 安全边界（不变式）

- Agent 循环全程在服务端内存运行，不触碰文件系统、不起子进程；
- V2 语法校验用 `new Function` **仅 parse 不调用**；为彻底杜绝执行风险，实现上使用 `node:vm` 的 `new Script(code)`（只编译不运行）替代；
- 最终制品仍必须经过 ArtifactCompiler（CSP 注入 + 剥离 + 体积复核），校验器不豁免编译器；
- 沙箱 iframe 策略不变（allow-scripts only）。

## 7. 决策记录

| 决策 | 结论 | 理由 |
| --- | --- | --- |
| 自研 vs 接框架 | 自研 | 场景是纯内存单文件 HTML，无文件/终端/多文件需求；框架 90% 能力用不上且绕开 llm-core 分层 |
| 参考 pi 什么 | 事件化循环、转换边界、错误即工具结果、AbortSignal 贯穿 | 思想级复用，不复制实现 |
| 校验放本地还是让模型自查 | 本地确定性校验为主 | 零 token、结果可信；模型自查作为可选终审轮（本期不做） |
| 修复轮温度 | 固定 0.2 | 修复是收敛任务，与创意档位解耦 |
| 进度通知 | 第一期轮询，接口形状兼容 SSE | 轮次级粒度 + 短时长，轮询足够；避免第一期引入流式复杂度 |
| 降级策略 | warning-only > 可编译 > 报错 | 尽量给用户可用的东西，同时 outcome 如实标记 |
