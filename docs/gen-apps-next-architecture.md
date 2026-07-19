# Gen Apps Next：通用、随机、快速的重建方案

> 日期：2026-07-19  
> 状态：提案  
> 决策前提：允许推翻现有生成架构，以通用性、结果多样性和速度为第一优先级。

## 核心判断

三个目标不能用同一种手段解决：

- **通用**：需要可组合的 UI、行为、能力和游戏引擎，而不是更多整页模板。
- **随机**：需要可控的变体系统，随机布局、主题、功能组合和样例数据，而不是让模型每次自由生成全部代码。
- **快速**：需要缓存结构、预载运行时、本地执行和小体积增量，让模型退出绝大多数热路径。

因此建议新建 Gen Apps Next，与现有 V2 并行开发，达到验收门槛后一次切流并删除旧链路。新架构的中心制品不再是 HTML，而是 `AppIR`。

## 最终架构

```text
用户输入
   |
   v
Discovery Engine
   |-- lexical/semantic intent retrieval
   |-- diversity sampler
   |-- candidate stream
   v
AppCandidate(intent + variationSeed + capabilityProfile)
   |
   v
App Composer
   |-- exact/semantic AppIR cache
   |-- prefab composition
   |-- constrained AI planner
   |-- sandbox bundle fallback
   v
AppIR
   |
   +----------------+-------------------+
   v                v                   v
Declarative Runtime Behavior Runtime    Engine Runtime
UI/data binding     statechart/reducer  game/media/canvas
   |                |                   |
   +----------------+-------------------+
                    v
             Capability Gateway
        web / file / storage / navigation
```

## 1. AppIR：唯一生成制品

```ts
type AppIR = {
  version: "openos-appir/v1";
  catalogVersion: string;
  identity: {
    family: string;
    variant: string;
    title: LocalizedText;
  };
  surface: SurfaceGraph;
  data: JsonValue;
  behaviors: BehaviorGraph;
  capabilities: CapabilityBinding[];
  engines: EngineBinding[];
  assets: AssetRef[];
  theme: ThemeTokens;
};
```

AppIR 只允许引用宿主 Catalog 中已注册的类型：

- Surface：窗口、工具栏、表单、列表、表格、树、标签页、图表、画布、媒体、搜索结果等；
- Behavior：状态机、reducer、验证规则、计时器、拖拽、排序、筛选、快捷键等；
- Capability：网络搜索、网页读取、文件、存储、导航等；
- Engine：专用游戏、回合制、实时 2D、图表、地图、富文本等；
- Asset：内容寻址的图像、音频、字体和数据集。

模型不能输出脚本、任意 CSS、事件函数或直接网络请求。未知需求只有在 AppIR 无法表达时才进入隔离 bundle。

## 2. 三类运行时

### Declarative Runtime

负责 UI 结构、数据绑定和局部渲染。它直接消费 AppIR，不先生成 HTML 字符串。Web 端可用 React renderer，iframe 内仍由宿主控制组件实现。

适用：表单、待办、记账、看板、浏览器、搜索、仪表盘、内容工具。

### Behavior Runtime

使用受限状态图和 reducer 表达交互：

```ts
type Transition = {
  event: string;
  when?: Expression;
  update?: DataPatch[];
  effects?: CapabilityCall[];
  targetState?: string;
};
```

表达式只支持受限运算符和白名单函数，不允许执行字符串代码。点击、输入、验证、计时、选择、拖拽、撤销等都本地运行。

适用：绝大多数业务应用和回合制交互。

### Engine Runtime

为无法用普通组件高效表达的领域提供可信引擎：

- `game.specialized.*`：扫雷、数独、贪吃蛇等高频专用实现；
- `game.turn-based`：棋盘、回合、合法动作、胜负、回放；
- `game.realtime-2d`：tick、碰撞、动画、输入、音频、对象池；
- `visual.chart`、`visual.map`、`editor.richtext`、`media.player`。

模型只产受限场景、实体、规则参数和素材引用。引擎实现由宿主预载。

## 3. Discovery Engine：候选既快又随机

当前候选目录应整体替换为两阶段候选流：

### 即时批次

本地在 20ms 内返回 6 个候选：

- 2 个精确意图候选；
- 2 个能力不同的相邻候选；
- 1 个风格化变体；
- 1 个自定义生成候选。

候选来自统一 Catalog metadata 和本地语义检索，不调用模型。

### 可选增强批次

仅当输入属于未知长尾时，并行调用快速规划模型产生 2-3 个补充候选；如果结果在 500ms 内到达且用户尚未点击，再以流式方式插入。即时批次永不等待它。

### 随机性模型

每次搜索生成 `variationSeed`，控制：

- 候选排序与相邻能力采样；
- 布局 recipe；
- 主题 token；
- 可选功能块；
- 示例数据与游戏关卡 seed。

随机性按层拆分：

```text
canonical intent       可缓存，不随机
structural AppIR       高复用，少量候选变体
variation overlay      小体积，按 seed 变化
runtime state          每窗口独立
```

这样用户每次看到的结果可以不同，但昂贵的结构和引擎仍可命中缓存。提供“换一批”会改变 seed，不清除结构缓存。

## 4. App Composer：模型只规划，不写页面

唯一外部接口：

```ts
compose(candidate: AppCandidate, options: ComposeOptions): AsyncIterable<ComposeEvent>;
```

内部执行 DAG：

```text
validate candidate
   |
   +-- parallel: preload runtime/assets
   +-- parallel: lookup exact/semantic AppIR
   +-- parallel: resolve prefab/capability coverage
   |
   v
best route
   +-- cached AppIR
   +-- prefab graph composition
   +-- constrained AI planning
   +-- sandbox bundle fallback
```

AI planner 使用严格结构化输出，只产生 1-4KB 的 AppIR 操作序列。收到 root surface 后立即开窗；组件、数据和行为分块流式补齐。生成完成前已到达的组件可直接交互。

## 5. Prefab 与 Catalog

Catalog 不存完整网页，而存四种可组合资产：

- primitive：Button、Input、Table、Grid、Canvas；
- pattern：搜索+结果、主从详情、看板、编辑器、设置页；
- behavior：CRUD、筛选、排序、分页、拖拽、计时、撤销；
- domain engine：游戏、图表、地图、媒体。

Prefab 是一组已验证 AppIR 子图，例如：

```text
search-page = search-input + result-list + pagination + web.search
task-board  = toolbar + kanban + editor-modal + local-storage
arcade-game = canvas + score-hud + pause-overlay + realtime-2d
```

增加通用性时优先添加能被多类应用复用的 pattern/behavior，而不是添加一个应用模板。

## 6. Capability Gateway

```ts
invoke(bindingId, input, runtimeContext): Promise<DataPatch>
```

所有外部副作用经过宿主：

- 权限与用户确认；
- 输入 schema；
- SSRF、速率、超时与配额；
- 结构化结果；
- 审计与可观测性。

应用无法直接联网或读取文件。Capability 结果只更新 AppIR data path，不重建页面。

## 7. 增量协议

放弃 HTML replacement，改为三类受限操作：

- `surfacePatch`：组件增删改；
- `dataPatch`：JSON Pointer 数据更新；
- `engineCommand`：开始、暂停、移动、加载关卡等。

每个操作携带 `baseRevision`、目标路径和预算。结构补丁与数据补丁分开验证；失败保持旧 UI，并请求最小快照，不做整页回退。

## 8. 五层缓存

| 层 | 缓存内容 | 是否受 variationSeed 影响 |
| --- | --- | --- |
| Intent cache | query -> canonical intent | 否 |
| Route cache | intent -> prefab/engine/planner route | 否 |
| Structural AppIR cache | 已验证结构图 | 只按结构变体 |
| Variation overlay cache | 主题、布局、样例、关卡 | 是 |
| Resource cache | renderer、engine、asset | 否，内容寻址 |

额外保留 single-flight 和模型 prompt cache。语义缓存只复用结构，不复用用户数据和 runtime state。

## 9. 深模块与接口

| 模块 | 唯一外部接口 | 隐藏的实现 |
| --- | --- | --- |
| Discovery Engine | `discover(query, seed)` | 规范化、检索、多样性、命名、排序 |
| App Composer | `compose(candidate)` | 缓存、route、prefab、模型、fallback |
| AppIR Runtime | `mount(ir)` | renderer、binding、patch、revision |
| Behavior Runtime | `dispatch(event)` | 状态图、reducer、timer、undo |
| Engine Runtime | `command(binding, command)` | 游戏循环、碰撞、动画、媒体 |
| Capability Gateway | `invoke(binding, input)` | 权限、外部 adapters、安全、审计 |
| Artifact Store | `materialize(key, factory)` | cache、single-flight、TTL、LRU、版本 |

Controller 只解析协议和映射错误；安装目录只保存应用身份和 AppIR 引用；每次启动创建独立运行态。

## 10. 真实速度目标

| 场景 | P95 目标 |
| --- | --- |
| 即时候选 6 个 | < 20ms |
| 换一批候选 | < 20ms |
| 结构缓存/Prefab 命中开窗可用 | < 150ms |
| 本地组合首次可交互 | < 300ms |
| AI AppIR 首个 surface | < 1.0s |
| AI AppIR 完整可用 | < 3.0s，取决于上游模型 |
| 本地点击/输入反馈 | < 50ms，0 次模型调用 |
| 实时游戏 | 60fps 目标，0 次模型调用/tick |

不能承诺所有未知需求都与缓存命中一样快。通用长尾首次需要模型，但通过 1-4KB AppIR、并行预载和流式 surface，可以把“看到并开始操作”的时间显著提前。

## 11. 重建实施计划

### Phase 0：冻结与基准

- 冻结 V2 新功能，只修缺陷。
- 建立真实查询集：常见工具、业务应用、内容应用、回合制游戏、实时游戏、未知长尾各 50 条。
- 记录候选时间、首次可见、首次可交互、完整可用、输出 token、缓存率、模型调用率、帧率。

### Phase 1：AppIR 内核

- 定义 AppIR schema、canonical serializer、validator 和 content hash。
- 实现 Declarative Runtime、data binding 和受限 patch。
- 建立 20 个 primitives、10 个 patterns、10 个 behaviors。

退出条件：无模型生成一个表单、表格、搜索、看板应用；本地组合 P95 < 300ms。

### Phase 2：Discovery 与随机层

- 统一 Catalog metadata、语义检索和命名。
- 实现即时批次、未知意图增强批次、variationSeed 与“换一批”。
- 删除旧 `SUGGESTION_FAMILIES` 独立文案逻辑。

退出条件：候选 P95 < 20ms；同一输入多 seed 有明显差异且意图准确率不下降。

### Phase 3：Composer 与缓存

- 实现 Composer DAG、Artifact Store 和五层缓存。
- 接入结构化 AI planner，流式输出 AppIR ops。
- 预载 Shell、Catalog 和预测 engine。

退出条件：缓存开窗 < 150ms；未知长尾首 surface < 1s；缓存命中不共享 session。

### Phase 4：行为与引擎

- 实现 statechart/reducer DSL、timer、drag/drop、undo。
- 接入 turn-based 与 realtime-2d engine。
- 迁移扫雷、数独、贪吃蛇，并新增 2048、五子棋、俄罗斯方块作为通用性验收。

退出条件：所有游戏规则和动画本地运行；tick 不调用模型；可暂停、恢复和确定性回放。

### Phase 5：Capability 与 sandbox

- 统一 web/file/storage/navigation adapters。
- 未覆盖长尾进入独立 sandbox bundle，限制 CSP、CPU、内存、网络和生命周期。
- 建立权限提示、审计、失败隔离和降级界面。

退出条件：外部能力全部经过 Gateway；sandbox 崩溃不影响宿主或其他窗口。

### Phase 6：切流与删除

- 先 10% shadow 对比，再 10%/50%/100% 切流。
- 仅在 SLO、成功率和交互覆盖全面优于 V2 后切换默认。
- 删除旧 SuggestionProvider、Blueprint HTML、自然语言二次分类和 V2 生成编排；保留只读旧制品 adapter 到迁移期结束。

## 12. 验收门槛

必须同时满足：

- 通用查询集可用率 >= 90%；
- 常见应用模型调用率 <= 10%；
- 常见交互模型调用率 <= 5%；
- 即时候选 P95 < 20ms；
- 缓存/Prefab 首次可交互 P95 < 300ms；
- 长尾首 surface P95 < 1s；
- 生成结果跨 seed 的结构或功能差异可测，同时核心意图保持一致；
- 非法 AppIR、越权 Capability、超预算 engine 全部拒绝；
- 每类运行时都有 replay、资源泄漏和 patch 冲突 smoke。

## 最终建议

直接把下一阶段定义为 **Gen Apps Next 重建项目**，不再继续扩展现有 Blueprint HTML。先用 6 个阶段在旁路完成新内核，再切流删除旧实现。

最关键的设计是：

```text
随机 overlay 与可缓存结构分离
AI 规划与宿主执行分离
应用结构与运行时状态分离
普通 UI、行为和领域引擎分层
```

这四个分离同时解决通用、随机和快速，而不是牺牲其中一个换另一个。
