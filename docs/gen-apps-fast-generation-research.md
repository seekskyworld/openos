# Gen Apps 快速、通用生成架构研究

> 日期：2026-07-19  
> 范围：只采用官方规范、官方文档与项目原始仓库。本文区分“来源事实”与“对 OpenOS 的建议”，不把实验性协议描述为稳定标准。

## 结论

当前 `AppRecipe -> EngineRegistry -> blueprint -> Instant -> bounded Agentic` 的方向是对的，但还不够通用。更合适的目标不是“预写很多完整 HTML，让 AI 挑一个”，而是建立一个版本化的 **AppSpec 中间表示 + 可信组件/引擎目录 + 能力调用协议**：

1. 常见应用由模型或规则只产生小体积 AppSpec；Shell 将 AppSpec 映射到预载组件，不生成通用 CSS/JavaScript。
2. 游戏、图表、地图、编辑器等由 AppSpec 绑定可信引擎；模型只填类型安全的配置、关卡和数据，不生成游戏循环。
3. 点击、输入、动画和确定性状态转换全部本地执行；搜索、文件、网络等副作用通过宿主能力调用；只有无法由规则处理的语义变化才请求 AI patch。
4. UI 资源与工具数据解耦并预加载；增量更新按稳定组件 ID 或数据路径执行，不再做任意 HTML diff。
5. 缓存分成路由、AppSpec 制品、不可变 Shell/引擎资源、模型 prompt 四层。缓存命中直接实例化独立 session，不共享运行态。

这不是单独照搬 A2UI 或 MCP Apps。A2UI 目前仍是 early-stage public preview，MCP Apps 主要解决跨宿主交互应用协议；OpenOS 应借鉴其边界，在现有 Runtime V2 上实现较小且可控的内部协议。

## 一手资料发现

### 1. A2UI：模型输出声明式意图，客户端持有实现

A2UI 的核心是让 agent 发送声明式 JSON，客户端用自己的组件库渲染。官方明确强调：

- agent 只能请求可信 catalog 中的组件，不执行模型生成代码；
- UI 使用带 ID 引用的扁平组件列表，适合渐进生成和增量更新；
- UI 结构与具体 React、Flutter、Web Components 等实现分离；
- v0.9 使用 `createSurface`、`updateComponents`、`updateDataModel`、`deleteSurface`，同一 ID 的组件可被更新，组件可流式加入。

来源：

- [A2UI 官方仓库 README](https://github.com/a2ui-project/a2ui/blob/main/README.md)
- [A2UI v1 协议](https://github.com/a2ui-project/a2ui/blob/main/specification/v1_0/docs/a2ui_protocol.md)
- [A2UI Message Types](https://github.com/a2ui-project/a2ui/blob/main/docs/public/reference/messages.md)
- [A2UI 官方站](https://a2ui.org/)

对 OpenOS 的意义：Runtime V2 的声明式 markup 已经走在相同方向，但 HTML 形态仍允许较多无效自由度。下一步应把动态部分收敛为可验证的 AppSpec：`components + data + actions + capabilities + engineBinding`，并让稳定 ID 成为协议字段，而不是依赖模型正确编写 DOM。

A2UI v1 还给出了更细的交互边界：输入控件可以先更新客户端 Data Model，让绑定视图本地响应；`updateDataModel` 可针对 JSON Pointer 路径更新数据而不重发组件树；只有显式 action 才需要回传服务端。OpenOS 可直接采用这种“本地绑定优先、显式副作用上行”的语义，而不必兼容 A2UI 的完整线协议。

### 2. MCP Apps：工具、UI 资源和运行数据应分离

MCP Apps 把交互应用建立在两个 MCP 原语上：tool description 引用一个 `ui://` UI resource，tool 调用返回数据，宿主在隔离 iframe 中渲染资源。官方流程还包括：

- 宿主可以在工具调用前预加载 UI resource；
- iframe 与宿主通过 `postMessage` 上的 JSON-RPC 双向通信；
- 应用可以请求工具调用，宿主负责能力授权和代理；
- CSP、权限和 iframe sandbox 由宿主控制；
- UI 支持 React、Vue、Svelte、Preact、Solid 或原生 JavaScript，协议不绑定框架。

来源：

- [MCP Apps 官方概览](https://modelcontextprotocol.io/extensions/apps/overview)
- [MCP Apps 官方构建指南](https://modelcontextprotocol.io/extensions/apps/build)
- [MCP Apps Extension 官方仓库](https://github.com/modelcontextprotocol/ext-apps)
- [MCP Apps 规范](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)

对 OpenOS 的意义：不要为每次生成重复传 Shell、UI Kit 或游戏引擎。制品只引用不可变资源版本，例如 `openos://shell/v3`、`engine://phaser/vX`；数据和 patch 单独发送。搜索、文件、导航等也不应由生成页面直接访问网络，而应调用宿主 capability。

### 3. OpenAI Apps SDK：组件模板与结构化工具结果解耦

OpenAI Apps SDK 的官方示例使用 `ui://` 模板资源，并在 tool metadata 中通过 `_meta["openai/outputTemplate"]` 关联模板。tool 结果通过 `structuredContent` 交给组件；组件可通过 `window.openai.callTool` 调用数据工具并原地更新，而无需重新挂载整个组件。官方还建议将仅提供数据的 tool 与负责渲染模板的 tool 分离。

来源：

- [Build your MCP server](https://developers.openai.com/apps-sdk/build/mcp-server)
- [Build your ChatGPT UI](https://developers.openai.com/apps-sdk/build/chatgpt-ui)
- [Apps SDK reference](https://developers.openai.com/apps-sdk/reference)

对 OpenOS 的意义：生成应用的“视图模板”和“当前数据”要分开缓存。一个搜索应用、数据看板或文件浏览器可以复用相同 AppSpec/组件树，只替换结构化数据；用户再次查询时只更新数据模型，不重新生成页面。

OpenAI 的组件状态指南也区分 UI-only state 与后端权威数据：临时选择、展开状态可留在 iframe，本应持久化或跨客户端共享的数据放在后端。这个边界适合 OpenOS 的每窗口 runtime state 与已安装制品分离。

- [OpenAI Apps SDK Components](https://developers.openai.com/apps-sdk/plan/components/)
- [OpenAI Apps SDK State Management](https://developers.openai.com/apps-sdk/build/state-management/)

### 4. Schema/component-driven UI 已有可复用实践

Vercel 的 `json-render` 官方仓库采用 catalog、schema、registry 和 renderer：AI 只能使用 catalog 中定义的组件和 action，JSON spec 通过 renderer 映射为实际 UI；其 spec 同样是 `root + elements map` 的扁平结构，并支持流式渐进渲染。

来源：

- [`json-render` 官方仓库](https://github.com/vercel-labs/json-render)

对 OpenOS 的意义：可以参考其 schema/catalog 设计，但没有必要替换现有运行时。关键是采用相同约束：组件属性有 schema、动作来自白名单、渲染实现由宿主持有、非法 spec 在进入运行态前被拒绝。

### 5. 游戏应复用引擎能力，而不是生成循环和动画代码

Phaser 官方将其定位为跨桌面和移动浏览器的 HTML5 游戏框架，提供 WebGL/Canvas 渲染并支持 JavaScript/TypeScript；官方还维护大量示例和模板。`boardgame.io` 则让开发者用纯状态转换函数描述回合制规则，并提供状态管理、阶段、AI、多人同步和日志等能力。

来源：

- [Phaser 官方仓库](https://github.com/phaserjs/phaser)
- [Phaser 官方文档](https://docs.phaser.io/)
- [`boardgame.io` 官方仓库](https://github.com/boardgameio/boardgame.io)

对 OpenOS 的意义：游戏不能只有一个通用 `game` 引擎。至少应分为两类可信执行器：

- `game.realtime-2d`：固定 tick、输入、碰撞、动画、音频和对象池，由 Phaser 类运行时承载；Spec 只描述场景、实体、规则参数和素材引用。
- `game.turn-based`：棋盘、回合、合法动作、胜负条件和状态迁移由确定性状态机承载；Spec 只描述规则组合和展示。

扫雷、数独、贪吃蛇仍可保留专用 engine，因为专用实现启动最快、行为最可靠；新游戏先尝试由上述通用引擎的受限规则组合表达。无法安全表达时才进入独立 sandbox bundle 路径。

### 6. 模型 prompt cache 只是第四层优化

OpenAI 官方说明 prompt cache 依赖精确前缀匹配；静态指令和示例应放在前面，用户变量放在后面。合格请求会自动缓存，`prompt_cache_key` 可改善共享长前缀请求的路由；`cached_tokens` 可用于观测命中。官方同时明确：prompt cache 不缓存最终响应，模型仍会重新生成输出。

来源：

- [OpenAI Prompt Caching](https://developers.openai.com/api/docs/guides/prompt-caching)

对 OpenOS 的意义：prompt cache 不能替代制品缓存。它只降低 cache miss 时的模型 prefill 延迟。真正的秒开依赖本地 Recipe/AppSpec 命中、资源预载和确定性运行时。

### 7. 减少模型输出比压缩输入更重要

OpenAI 官方延迟优化指南指出，生成 token 通常是延迟中最大的部分；减少输出 token 往往近似等比例减少生成延迟，而减少输入 token 的收益通常小得多。官方同时建议减少请求次数、并行无依赖步骤、流式展示结果，并在已知大部分输出时考虑 Predicted Outputs。

来源：

- [OpenAI Latency Optimization](https://developers.openai.com/api/docs/guides/latency-optimization/)

对 OpenOS 的意义：性能优化优先级应是“Recipe/缓存零生成 -> 只生成 AppSpec -> 只生成 component/data patch -> 完整 bundle”，而不是继续要求模型输出完整 HTML 后只优化 prompt 长度。

### 8. 增量补丁应采用可验证操作

JSON Patch 的 IETF RFC 6902 定义了 `add`、`remove`、`replace`、`move`、`copy`、`test` 六种顺序应用的操作。它不是 UI 协议，但可作为 AppSpec data patch 的成熟基础，比任意 HTML 字符串 diff 更容易做路径授权、体积限制、revision 检查和失败回滚。

来源：

- [RFC 6902: JSON Patch](https://www.rfc-editor.org/rfc/rfc6902)

建议初期只开放 `add/remove/replace/test`，组件结构 patch 和 data patch 分开校验，不让模型通过 `move/copy` 绕过路径权限。

## 建议目标架构

```text
用户需求
   |
   v
Intent Router（规则优先，小模型/LLM 兜底）
   |
   +-- exact/semantic artifact cache ----------------------+
   |                                                       |
   +-- Recipe Registry -> typed config --------------------+--> AppSpec Compiler
   |                                                       |         |
   +-- Composition Planner -> catalog components ----------+         v
   |                                                       |   versioned AppSpec
   +-- Long-tail generator -> constrained AppSpec ---------+         |
                                                                     v
Host Runtime
   +-- Component Renderer（表单/列表/图表/浏览器/编辑器）
   +-- Engine Registry（专用游戏/turn-based/realtime-2d）
   +-- Local Action Runtime（点击/输入/状态机/动画）
   +-- Capability Broker（web.search/file/storage/navigation）
   +-- Patch Applier（component/data patch + revision）
```

### AppSpec 最小边界

建议 V3 内部协议至少包含：

```ts
type AppSpec = {
  protocolVersion: "openos-appspec/v1";
  catalogVersion: string;
  root: ComponentId;
  components: Record<ComponentId, TypedComponent>;
  data: JsonValue;
  actions: Record<ActionId, LocalAction | CapabilityAction | AiAction>;
  capabilities: CapabilityGrant[];
  engineBindings?: EngineBinding[];
  assets?: ImmutableAssetRef[];
};
```

约束：

- `TypedComponent` 的属性由 catalog schema 校验；禁止任意事件脚本和任意 CSS。
- 动作明确分为 `local`、`capability`、`ai`，默认 local；不能识别的点击不得自动升级为网络或高权限能力。
- `engineBindings` 只接受版本化 engine id 和受限配置，不接受源码字符串。
- patch 只能修改已授权的组件 ID、数据路径或 engine command，并携带 `baseRevision`。
- 安装制品保存 canonical AppSpec；每次打开创建独立 runtime state。

## 生成与交互快路径

### 点击候选后的生成

1. 用标准化意图生成 `intentKey`，先查 exact cache，再查带阈值和类别约束的 semantic cache。
2. 命中 Recipe 时只填 typed config；命中 composition 时只组装 catalog 组件；两者都不调用大模型。
3. 未命中时让模型输出 AppSpec 操作序列或扁平组件表，而不是 HTML/CSS/JS。
4. 收到 root/shell 信息即创建 surface；后续组件和数据边生成边渲染。
5. 编译、schema 校验和 capability 审批通过后写 artifact cache。

### 用户交互

```text
event
  -> local reducer / engine command       0 次模型调用
  -> capability broker + data patch       0 次模型调用
  -> constrained AI component/data patch  仅长尾语义交互
```

网络搜索应是 `web.search(query)` capability：宿主取得结构化结果，更新 `/data/results`；结果点击调用 `web.open(trustedResultId)`。浏览器外观只是 renderer，不能把用户输入的任意 URL 直接变成 iframe 权限。

## 四层缓存设计

| 层 | Key | Value | 失效条件 |
| --- | --- | --- | --- |
| 路由缓存 | normalized intent + locale + policy | recipe/composition/engine route | router/policy version |
| 制品缓存 | canonical intent + catalog/engine/policy/model versions | validated AppSpec | 任一依赖版本或 TTL |
| 资源缓存 | content hash / immutable version URI | Shell、renderer、engine、asset | 内容寻址，原则上不原地失效 |
| Prompt cache | 稳定 prompt prefix + schema/tools | provider KV prefix | 供应商规则与保留期 |

补充规则：

- 保留现有 single-flight，避免同 fingerprint 重复生成。
- semantic cache 只复用结构，不复用用户数据；槽位参数在实例化阶段注入。
- 热门 Recipe/AppSpec 可进程启动预热；Shell 和常用 engine 在用户点击前 idle preload。
- 记录 `route_hit`、`artifact_hit`、`resource_hit`、`cached_tokens`，否则无法判断优化落在哪一层。

## 速度目标与验收

以下是建议 SLO，不是一手资料声称的性能：

| 路径 | 建议指标 |
| --- | --- |
| Recipe/专用 engine | 服务端 P95 < 50ms |
| artifact cache hit | 服务端 P95 < 50ms；窗口可用 P95 < 150ms |
| composition fast path | 首个可交互 surface P95 < 500ms |
| AppSpec 模型 cache miss | 首个有意义组件 P95 < 1.5s，持续流式完善 |
| 本地交互/游戏 tick | 不发模型请求；交互反馈 < 100ms |
| capability 交互 | 只受工具/网络延迟影响，不能重建整个应用 |
| AI patch | 只替换最小组件/数据路径，超时保持旧 UI 可用 |

验收不能只测 HTTP 生成耗时，还要测：首次可见、首次可交互、资源下载字节、模型输出 token、缓存命中率、每次交互模型调用率、patch 大小和运行时帧率。

## 分阶段实施建议

### 阶段 1：AppSpec 与现有 Runtime V2 并行

- 定义 `openos-appspec/v1`、catalog schema、canonical serializer 和 compiler。
- 先覆盖表单、列表、标签页、菜单、搜索结果、详情、图表等高频组件。
- compiler 输出当前 V2 markup，暂不重写 iframe renderer，降低迁移风险。

### 阶段 2：能力与数据分离

- 把 `web.search`、`web.open`、storage、file 统一为 Capability Broker。
- 数据返回改为结构化 data patch；UI 模板不随结果重新生成。
- 建立 local/capability/ai 三级动作路由和可观测指标。

### 阶段 3：通用游戏执行器

- 保留扫雷、数独、贪吃蛇专用 engine。
- 增加 `turn-based` 状态机引擎和 `realtime-2d` 场景引擎；先用受限内建规则块，不接受模型源码。
- 增加确定性回放、固定 seed、暂停/恢复、资源配额和帧率 smoke。

### 阶段 4：缓存与预热

- 上线路由 cache、槽位化 semantic artifact cache、不可变资源 cache。
- 预加载 Shell、基础 catalog 和热门 engine。
- 重排模型 prompt：稳定 catalog/schema 在前，用户输入在后，并记录 prompt cache usage。

### 阶段 5：长尾 sandbox bundle

- 只有 AppSpec 和可信 engine 都无法表达的需求才生成独立 bundle。
- 采用 MCP Apps 类似的 sandbox、CSP、permission、postMessage capability bridge。
- 该路径允许较慢，但必须流式展示进度，且不能拖慢默认快路径。

## 不建议的方案

1. **大量整页 HTML 模板直接拼装**：早期会快，但模板、样式、数据和行为耦合，组合数量爆炸，局部更新与跨应用复用困难。可以保留为 Recipe 制品，但不应成为通用协议。
2. **每个点击都请求模型生成 HTML diff**：能模拟任意交互，但延迟、成本、确定性和离线能力差。只适合作为 `ai` 级兜底。
3. **让模型生成任意游戏 JavaScript**：动画和规则可靠性无法靠 prompt 保证，也扩大安全与资源风险。模型应生成配置或受限规则图。
4. **只依赖 prompt cache**：它不缓存模型最终输出，无法提供确定性秒开。
5. **一次引入完整外部协议替换 Runtime V2**：A2UI 尚在预览，MCP Apps 的目标是跨宿主互操作。应先稳定内部 AppSpec，再按需要提供协议 adapter。

## 最终建议

下一轮重构优先级应是：

```text
AppSpec/compiler
  -> 组件 catalog + data model
  -> Capability Broker
  -> 通用 turn-based/realtime-2d engine
  -> 四层缓存与预热
  -> 长尾 sandbox bundle
```

这条路线能够同时保住当前专用 Recipe 的毫秒级速度，并把通用性从“继续增加三个专用游戏”提升为“通过可信组件、规则和引擎组合覆盖一类应用”。真正需要模型完整生成的比例越低，整体速度和可靠性越接近视频中的效果。
