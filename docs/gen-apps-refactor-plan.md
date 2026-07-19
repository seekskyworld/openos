# Gen Apps 搜索与生成架构重构方案

> 日期：2026-07-19  
> 状态：建议方案，待分阶段实施  
> 目标：候选名称即时出现，点击后尽可能在 500ms 内可交互，同时让普通应用和更多游戏通过组合能力扩展。

## 决策摘要

最优方案不是继续增加整页 HTML 模板，也不是让模型在每次点击后重新理解应用类型，而是引入一个贯穿搜索和生成的类型化 `AppIntent`，再由版本化 `AppSpec` 描述应用结构：

```text
query
  -> AppDiscovery.resolve()      一次识别意图、槽位和候选
  -> AppCandidate.intent         点击后原样传递，不再重新猜测
  -> AppFactory.create()
       -> artifact cache
       -> recipe
       -> catalog composition
       -> constrained AppSpec generator
       -> sandbox bundle fallback
  -> AppSpecCompiler
  -> Runtime V2
```

搜索结果和生成链必须共享同一个意图对象、目录版本和缓存键。名称只是展示字段，不再作为生成路由依据。

## 当前问题

### 1. 同一意图被重复推断

当前有三套独立关键词判断：

- `packages/shared/src/gen-app-suggestions.ts` 决定候选名称；
- `generation/app-recipe.ts` 决定游戏引擎；
- `generation/blueprint-registry.ts` 决定普通应用蓝图。

同一个查询会先生成展示名称，点击后再从 `query + name + description` 重新分类。目录增加后容易出现候选承诺一种应用、生成却进入另一条路径的问题。

### 2. 候选只是展示文案

`GenAppSuggestion` 只有名称、描述、图标和主题，没有稳定的 `intentKey`、参数槽位、Recipe、组件组合或能力声明。生成器只能依赖自然语言重新恢复这些信息。

### 3. GenerationOrchestrator 过宽

当前模块同时处理：

- 候选调用与清洗；
- 幂等、配额和草稿持久化；
- Recipe、Blueprint 和模型路由；
- fingerprint、制品缓存和 single-flight；
- 并发、超时、流式事件和 fallback。

其外部接口看似简单，但内部变化原因过多，搜索、目录、缓存或模型策略修改都会进入同一个模块。

### 4. Blueprint 是整块 HTML

`blueprint-registry.ts` 将意图直接映射到 HTML 字符串。短期很快，但结构、数据、动作和能力耦合在一起，无法自然复用“搜索框 + 结果列表”“表单 + 表格”等组合，也不利于局部数据更新。

## 目标领域对象

### AppIntent

```ts
type AppIntent = {
  kind: "game" | "tool" | "content" | "browser" | "unknown";
  family: string;
  variant?: string;
  slots: Record<string, string | number | boolean>;
  locale: "zh" | "en";
  confidence: number;
  resolverVersion: string;
};
```

示例：

```json
{
  "kind": "game",
  "family": "snake",
  "variant": "fast",
  "slots": { "difficulty": "hard", "speedMs": 90 },
  "locale": "zh",
  "confidence": 1,
  "resolverVersion": "intent-v1"
}
```

### AppCandidate

```ts
type AppCandidate = {
  id: string;
  display: {
    name: string;
    description: string;
    iconEmoji: string;
    iconTheme: GenAppIconTheme;
  };
  intent: AppIntent;
  routeHint: "recipe" | "composition" | "generate";
  catalogVersion: string;
};
```

候选 ID 应由 canonical intent 和 catalog version 派生，保证同一查询稳定；点击请求必须携带完整候选或服务端可验证的候选 token。服务端不信任客户端权限声明，但可以信任自己重新计算后的 intent。

### AppSpec

```ts
type AppSpec = {
  protocolVersion: "openos-appspec/v1";
  catalogVersion: string;
  root: string;
  components: Record<string, TypedComponent>;
  data: JsonValue;
  actions: Record<string, LocalAction | CapabilityAction | AiAction>;
  capabilities: CapabilityGrant[];
  engineBindings?: EngineBinding[];
  assets?: ImmutableAssetRef[];
};
```

模型不得输出任意脚本或 CSS。它只能使用 Catalog 已登记的组件、动作、引擎和能力。

## 深模块设计

### 1. AppDiscovery

唯一外部接口：

```ts
discover(input: DiscoveryInput): AppCandidate[];
```

模块内部负责规范化查询、语言识别、确定性分类、名称生成、去重和稳定排序。先使用规则目录；只有无法分类且确实需要多个语义候选时，才允许小模型适配器参与。浏览器与 Bridge 调用同一纯函数核心，保证零网络候选首屏。

删除 `GenerationOrchestrator.suggest()`；HTTP suggestions controller 直接调用 `AppDiscovery`。

### 2. AppCatalog

唯一外部接口：

```ts
resolve(intent: AppIntent): AppPlan | null;
```

目录统一注册：

- Recipe：扫雷、数独、贪吃蛇等专用实现；
- Composition：表单、列表、表格、搜索、详情、图表、文件等组件组合；
- Engine binding：turn-based、realtime-2d、媒体、编辑器等可信引擎；
- Capability requirement：网络搜索、网页读取、文件、存储、导航。

`app-recipe.ts` 和 `blueprint-registry.ts` 合并到此模块的内部 adapters，不再各自识别自然语言。

### 3. AppFactory

唯一外部接口：

```ts
create(input: CreateAppInput, hooks?: GenerationHooks): Promise<CreatedArtifact>;
```

模块内部顺序固定：

```text
validated candidate
  -> exact artifact cache
  -> AppCatalog plan
  -> deterministic AppSpec composition
  -> constrained AppSpec generation
  -> sandbox bundle fallback
```

它负责路由、single-flight、并发、超时和流式阶段，但不负责候选名称、草稿数据库或安装目录。

### 4. AppSpecCompiler

唯一外部接口：

```ts
compile(spec: AppSpec): ValidatedArtifact;
```

首期编译到现有 Runtime V2 markup，因此不用立即重写 iframe。编译器集中校验组件属性、动作白名单、ID、数据绑定、能力、引擎配置和资源配额。

### 5. DraftManager

唯一外部接口：

```ts
createDraft(input: CreateDraftInput): GenAppDraft;
```

负责幂等、安装配额、草稿 TTL、持久化和独立 runtime session。缓存命中的 AppSpec 可以复用，但每次点击必须创建独立 draft/session。

### 6. CapabilityBroker

唯一外部接口：

```ts
invoke(request: CapabilityRequest, context: RuntimeContext): Promise<DataPatch>;
```

统一承载 `web.search`、`web.open`、storage、file、navigation。应用只拿结构化结果；权限、SSRF、速率和审计由宿主管理。

## 候选名称策略

名称生成应从“拼接用户原句和后缀”改为“意图模板 + 变体槽位”：

1. 精确意图首项始终是用户期望的标准名称，如“贪吃蛇”“预算表”“网页搜索”。
2. 其余候选必须是能力上真实不同的变体，而不是只换“专业版/实验室/助手”等后缀。
3. 候选描述声明差异能力，例如“键盘控制 + 加速”“多人回合”“实时网络结果”，生成计划必须能兑现。
4. 未知意图只保留一个“按当前需求生成”的候选，再提供基于通用组件能力可实现的相邻候选。
5. 名称、描述和 routeHint 均从同一 Catalog metadata 产生，避免文案目录和生成目录漂移。

例如查询“做一个项目管理工具”时，应返回：

```text
项目看板       看板列、拖拽和任务详情      composition
项目计划       里程碑、日期和进度          composition
团队任务       分派、筛选和完成状态        composition
自定义项目工具 按用户原始需求生成           generate
```

## 缓存与速度

### 四层缓存

| 层 | Key | Value |
| --- | --- | --- |
| Discovery cache | normalized query + locale + resolver/catalog version | `AppCandidate[]` |
| Plan cache | canonical `AppIntent` + catalog/policy version | `AppPlan` |
| Artifact cache | canonical plan/spec + renderer/engine version | validated AppSpec |
| Resource cache | content hash/version URI | Shell、Catalog、Engine、Assets |

模型 prompt cache 只用于 constrained generator miss，不算应用制品缓存。

### 性能预算

| 路径 | 目标 |
| --- | --- |
| 候选名称 | 浏览器同步 P95 < 20ms；不发模型请求 |
| Recipe / artifact hit | 服务端 P95 < 50ms |
| Composition | 首次可交互 P95 < 300ms |
| AppSpec 模型 miss | 首个组件 P95 < 1.5s，持续流式完善 |
| 本地交互 / 游戏 tick | 0 次模型调用，反馈 < 100ms |
| capability | 只等待工具/网络，不重建应用 |

热点 Catalog、Shell 和游戏引擎在候选展示期间 idle preload；点击后只传 AppSpec/data，不重复发送 Shell/CSS/engine。

## 分阶段迁移

### 阶段 1：统一意图和候选

- 新增 `AppIntent`、`AppCandidate`、`AppDiscovery`。
- 把现有 `SUGGESTION_FAMILIES`、`GAME_KEYWORDS`、`INTENT_KEYWORDS` 合并为一个 Catalog metadata 源。
- 点击候选携带 typed intent，生成链停止从名称和描述重新分类。
- 保留旧 `GenAppSuggestion` parser 作为兼容 adapter。

验收：候选 P95 < 20ms；中英文、同义句、难度和变体路由一致；候选承诺与生成计划一一对应。

### 阶段 2：AppFactory 深化

- 从 `GenerationOrchestrator` 移出 suggestions 和 Draft persistence。
- 引入 `AppCatalog.resolve(intent)` 与 `AppFactory.create(candidate)`。
- 保留现有 Recipe、Blueprint、LLM adapters，但都只接收 typed intent/plan。

验收：旧功能不变；生成路由可通过 AppFactory 接口完整测试；同一 intent 的 cache/single-flight 行为一致。

### 阶段 3：AppSpec v1

- 定义 schema、canonical serializer、validator 和 compiler。
- 先覆盖表单、列表、表格、标签页、菜单、搜索结果、详情和图表。
- 将现有 Blueprint HTML 改成 Catalog composition，再编译为 V2 markup。

验收：普通应用不生成通用 CSS/JS；非法组件、动作和能力在编译前拒绝；结构化 patch 可局部更新。

### 阶段 4：通用游戏和能力

- 保留三个专用游戏 engine。
- 增加 turn-based 与 realtime-2d 两类受限引擎。
- 统一 CapabilityBroker，网络、文件和存储均返回 data patch。

验收：新增 2048/五子棋/俄罗斯方块等只添加受限规则配置或 Catalog adapter；动画保持本地帧率且不调用模型。

### 阶段 5：缓存、预载和长尾

- 增加 Discovery/Plan/Artifact/Resource 四层指标和预热。
- 未知需求由模型输出受约束 AppSpec；只有 Catalog 无法表达时进入独立 sandbox bundle。
- 按真实首次可见、首次可交互、输出 token、缓存命中率、patch 大小和帧率验收。

## 不采用的路径

- 不继续复制整页 HTML 作为主扩展机制；只保留少数专用 Recipe。
- 不让候选名称决定生成类型；路由只依赖类型化 intent。
- 不为每个新游戏生成 JavaScript；模型只配置可信引擎。
- 不把 prompt cache 当成制品缓存。
- 不一次性替换 Runtime V2；AppSpec 先编译到现有运行时，稳定后再考虑原生 renderer。

## 最终模块关系

```text
Controller
  -> AppDiscovery
  -> DraftManager
       -> AppFactory
            -> ArtifactCache
            -> AppCatalog
            -> AppSpecGenerator
            -> AppSpecCompiler
  -> RuntimeCoordinator
       -> CapabilityBroker
       -> PatchApplier
       -> EngineRegistry
```

Controller 只做协议解析和错误映射。搜索、生成、目录和运行态之间通过上述小接口连接；每个模块的复杂度留在内部，测试与调用方只依赖其接口。
