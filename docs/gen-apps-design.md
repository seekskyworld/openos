# Gen Apps（AI 生成应用）架构设计

> 状态：V1 竖切、Hybrid Runtime V2 与 cache-first Instant 生成已实施，V1 制品保持兼容
> 归属：App 启动台搜索 -> 大模型生成应用 -> 隔离运行 -> 关闭后安装 -> 持久化复用  
> 目标端：Electron 桌面端与浏览器端；两端共享业务模块，但运行时隔离强度允许不同  
> 最近实施：2026-07-18

## Cache-first 生成链（已实施）

点击候选后的生成不再由单一生成器承担。`GenerationOrchestrator` 将请求拆成可观测、可替换的阶段：

```text
query + suggestion + settings
        |
        v
fingerprint（prompt / policy / UI Kit / runtime 版本）
        |
        +--> 成品缓存命中 ----> 重新创建 draft/session/revision（不共享运行态）
        +--> AppRecipe 命中 --> EngineRegistry 组装可信本地引擎 -> 缓存 -> draft
        +--> 本地 blueprint 命中 -> 编译 -> 缓存 -> draft
        +--> 相同 fingerprint 在途 -> join 同一模型调用
        +--> Instant 单轮模型 -> 编译 -> 缓存 -> draft
        +--> Agentic 多轮（显式 profile） -> 编译 -> 缓存 -> draft
```

边界约束：

- `SuggestionProvider` 只负责确定性候选策略，候选首屏不调用 LLM。
- `ArtifactGenerator`、`FragmentGenerator` 与 `GenerationCache` 是独立端口，便于替换模型、缓存或测试 fake。
- `AppRecipe` 只描述 engine/version/language/config；`EngineRegistry` 为扫雷、数独、贪吃蛇组装受信任标记，游戏规则、状态、键盘和动画由预载 Runtime 执行，任何生成模式都不调用模型。
- blueprint 只存语义模板和受信任 markup，不绕过编译器；编译失败时 Instant 使用本地 generic fallback。
- 成品缓存与 draft/installed 生命周期分离；命中缓存仍创建新的草稿、运行会话和 revision，避免窗口状态串线。
- 缓存 fingerprint 包含供应商/协议/端点/模型、策略版本、blueprint/UI Kit/runtime 版本和 creativity tier，切换模型或升级任一版本会自然失效；SQLite 按 TTL、大小和 LRU 淘汰，且不记录 API Key。
- 同一 fingerprint 的并发请求共享底层模型调用，订阅者各自接收流式 delta；最后一个订阅者取消才中止底层任务。

默认 `generationMode` 为 `fast`（兼容内部称呼 Instant）；`agentic` 仅在用户显式选择精修模式时启用且限制为 2-3 轮。游戏优先走 recipe/engine，常见工具走本地 blueprint，未知需求走单轮 Instant，只有可由声明式标记修复的场景才支付有限多轮延迟。

## Hybrid Generative Runtime V2（已实施）

V2 把原先由模型一次性生成的 HTML/CSS/JavaScript 拆成三层：

```text
模型输出：openos-markup（声明式、小体积、无 CSS/JS）
    ↓ ArtifactCompiler(parse5 清洗、动作/目标校验、版本化)
可信 Shell：OpenOS UI Kit + ActionRuntime（随 Web bundle 预载）
    ↓ postMessage render / event / patch
RuntimeSession：每窗口独立 markup + revision + 有界模型历史
```

关键行为：

1. 通用控件动作（tab、弹层、列表、筛选、计数、计算器、toast）在 iframe 内本地执行，不调用模型。
2. `web.search` / `web.open` / `ai.generate` / `ai.patch` 只发送事件类型、元素 id、输入值与当前目标快照；服务端从权威会话标记重新解析动作和目标。`web.search` 走固定搜索适配器，`web.open` 只读取搜索结果中由服务端写入的可信 URL，两者都返回声明式 patch 且不调用模型。
3. 模型只提议一个 `replace` 操作；服务端校验 revision/target，清洗替换标记，失败时最多修复一次，再原子推进 revision。
4. V2 iframe 只加载一次固定 Shell；流式与最终内容都通过 `postMessage` 渲染，不再随 token 重载 `srcDoc`。
5. fantasy 档使用 `improv` 模式，未被本地运行时处理的声明式动作自动进入 AI 补丁路径。
6. `html-single-file` V1 制品仍按旧 `srcDoc` 与 script-capable `/continue` 路径运行。
7. 每窗口 AI patch 串行且窗口关闭会取消在途交互。服务端 revision 领先时，409
   携带权威快照供 iframe 全量对齐；仅会话已过期时才通过 `/resume` 重新编译宿主快照并重试一次。

V2 线协议不重复返回 Shell 的 CSS/JavaScript，`html` 在 V2 响应中为空，客户端使用
`markup + kitVersion + interactionMode`。SQLite 仍保存完整兼容文档，同时在
`gen_app_artifacts.payload_json` 保存结构化 V2 payload。

---

## 0. 评审结论

原方案的产品路径成立，但不能直接按“store + routes + hook + iframe”落地。需要先修正以下架构问题：

1. **以 Gen Apps 功能模块作为主接缝（Seam）**：Controller 只做传输映射，应用服务承载用例，Repository 与模型供应商通过端口注入；Prompt、模型输出解析、制品编译和 SQL 不再进入 `create-server.ts`。
2. **显式建模草稿与安装状态**：生成完成只得到 `draft`，首次窗口关闭成功执行 `install` 后才进入启动台，解决“生成时已入库”和“关闭才保存”的语义冲突。
3. **把 HTML 当作不可信输入**：Prompt 约束不是安全措施；必须由可信的制品编译模块解析、规范化、注入 CSP、限制体积并记录策略版本。
4. **修正 iframe 安全假设**：`sandbox="allow-scripts"` 不会自动禁网，也不提供 CPU/内存隔离。MVP 只能承诺来源、DOM、宿主存储与常见网络能力隔离；强对抗代码需要 Electron 独立运行进程或未来受限 DSL。
5. **数据库只物理复用，不复用 Chat 模块所有权**：抽取 OpenOS 数据库基础设施与迁移机制，ChatRepository 和 GenAppRepository 分别持有自己的表。
6. **前端建立动态应用注册表与动态窗口能力**：现有 `AppId`、`WINDOW_DEFAULTS`、`windowMeta`、`launcherApps` 都是静态的；仅新增 Runner 无法真正打开动态生成的应用。
7. **共享传输契约，不共享存储行**：接口返回 `GenAppSummary` / `GenAppArtifact`，禁止把 `GenAppRow` 暴露给前端。

这些调整的目标不是增加文件数量，而是形成几个有深度（Depth）的模块：调用方只学习少量接口，生成、校验、事务、竞态和平台差异集中在模块内部。

## 1. 目标与非目标

### 1.1 第一阶段目标

1. 搜索词非空后，同步生成 2–12 个名字和图标不同的候选（默认 6 个），候选首屏不依赖模型或网络。
2. 点击候选后生成一个可交互应用，并立即以草稿窗口预览。
3. 首次关闭草稿窗口时安装；安装成功后出现在启动台。
4. 已安装应用再次打开时不调用模型。
5. 支持删除、最近打开排序、生成失败重试和草稿过期清理。
6. 生成应用不能访问宿主 DOM、Cookie、localStorage、Bridge token 或任意 OpenOS 数据。
7. 记事本等应用通过受限、按应用隔离的键值能力保存用户数据。

### 1.2 第一阶段非目标

- 不支持生成应用直接访问公网、Node.js、Electron、文件系统、剪贴板、摄像头或麦克风。
- 不支持导入、分享或运行第三方提供的任意 HTML。
- 不承诺浏览器 iframe 能抵御恶意死循环、内存炸弹或 DOM 炸弹。
- 不支持多用户云部署；当前“Web”指本机 Bridge + 浏览器 UI。未来云端需要另行设计身份、租户和远端存储。
- 不支持制品热更新；但数据模型保留 revision 与格式版本。

## 2. 领域模型与状态机

### 2.1 统一术语

| 术语 | 含义 |
| --- | --- |
| `GenAppSuggestion` | 短生命周期候选，只包含经校验的名称、描述、emoji 和主题 token |
| `GenAppDraft` | 已生成并通过制品策略校验、但尚未安装的应用 |
| `GenAppSummary` | 启动台所需的已安装应用元数据，不包含 HTML |
| `GenAppArtifact` | 版本化、已规范化的单文件 HTML 制品 |
| `GenAppLaunchBundle` | 打开应用所需的 Summary、Artifact 与运行时会话信息 |
| `GenAppRuntimeSession` | 一次窗口运行实例；与持久化应用身份分离 |
| `GenAppData` | 由宿主托管、按 app id 隔离并受配额约束的用户键值数据 |

Storage Row 只属于 Repository Adapter，不是领域模型，也不是 HTTP 契约。

### 2.2 生命周期

```text
candidate-ready
    |
    v
generating -> failed
    |
    v
draft -> running-draft -> installing -> installed -> running-installed
  |                         |              |               |
  +------ expired ----------+              +---- delete ----+
                            |
                            +-> install-failed -> retry / discard
```

关键不变量：

- `GET /gen-apps` 只返回 `installed`，草稿不会提前出现在启动台。
- 首次红灯关闭执行幂等安装；安装失败时保留窗口和草稿，允许重试或明确丢弃。
- 最小化不触发安装。
- 已安装应用的“打开”必须在同一事务中读取制品并更新 `opened_at`。
- 删除运行中的应用时，当前内存会话可继续到关闭，但目录记录立即消失，关闭后不得重新安装。
- 草稿具有 TTL；进程异常退出遗留的草稿由启动清理任务删除。

## 3. 总体分层

```text
apps/web
  Presentation
    AppLauncher / GenAppRunner / Settings
        |
        v
  GenAppWorkspace module
    同步候选、设置快照、草稿状态、安装、动态窗口协调
        |
        v
  GenAppsClient port
        |
        +-- HttpGenAppsClient adapter

packages/shared
  版本化 DTO/schema/error code + 浏览器安全的运行时与候选策略

apps/server
  HTTP Controller adapter
        |
        v
  GenApps application service / facade
    用例编排、状态转换、幂等、配额
        |
        +-- GenAppCatalogService（installed/draft/launch/remove）
        +-- GenerationOrchestrator（fingerprint/cache/blueprint/model/compile）
        +-- RuntimeInteractionCoordinator + RuntimeSessionStore（V2 runtime）
        |
        +-- GenAppGenerator port
        |     +-- LlmGenAppGenerator adapter
        |     +-- DeterministicFakeGenerator adapter
        |
        +-- GenAppRepository port
        |     +-- SqliteGenAppRepository adapter
        |     +-- InMemoryGenAppRepository adapter
        |
        +-- ArtifactCompiler module（进程内纯逻辑）

platform runtime seam
  GenAppRuntime
    +-- BrowserIframeRuntime adapter
    +-- ElectronIsolatedRuntime adapter（强隔离阶段）
```

依赖规则：

- 严格遵守 **Controller -> Application Service -> Repository Port**。
- Controller 不拼 Prompt、不做 SQL、不操作窗口。
- Application Service 不依赖 Node HTTP、React、SQLite 或具体模型 SDK。
- Repository 只接收已校验的领域对象，不负责解释模型原始输出。
- LLM Adapter 是反腐层：把不同厂商返回转换为稳定领域对象。
- `packages/shared` 只承载线协议与 schema，不导出数据库 Row。
- `create-server.ts` 是组合根与总路由入口，只装配 Adapter 并委托 Controller。

## 4. 深模块与接口

### 4.1 服务端 GenApps 模块

```ts
interface GenApps {
  suggest(input: SuggestInput, context: RequestContext): Promise<GenAppSuggestion[]>;
  generateDraft(input: GenerateDraftInput, context: RequestContext): Promise<GenAppDraft>;
  install(draftId: GenAppId, context: RequestContext): Promise<GenAppSummary>;
  list(context: RequestContext): Promise<GenAppSummary[]>;
  launch(appId: GenAppId, context: RequestContext): Promise<GenAppLaunchBundle>;
  remove(appId: GenAppId, context: RequestContext): Promise<void>;
}
```

这六个入口分别对应真实用例；接口虽然不是单方法，但隐藏了模型选择、Prompt 版本、结构化解析、制品编译、事务、幂等、TTL、配额和错误映射，具有足够深度。

### 4.2 内部端口

```ts
interface GenAppGenerator {
  suggest(input: SuggestInput, signal: AbortSignal): Promise<UntrustedSuggestion[]>;
  generate(input: GenerateInput, signal: AbortSignal): Promise<UntrustedArtifact>;
}

interface GenAppRepository {
  createDraft(input: ValidatedDraft): GenAppDraft;
  install(draftId: GenAppId): GenAppSummary;
  listInstalled(): GenAppSummary[];
  loadAndTouch(appId: GenAppId): GenAppLaunchBundle;
  remove(appId: GenAppId): void;
  discardExpiredDrafts(now: number): number;
}
```

依赖分类：

| 依赖 | 分类 | 测试方式 |
| --- | --- | --- |
| 制品编译、状态规则、配额计算 | in-process | 直接通过模块接口测试，不增加 Adapter |
| SQLite、Settings | local-substitutable | 生产 SQLite Adapter + 测试内存 Adapter |
| Bridge HTTP | remote but owned | HTTP Adapter + 测试内存 Client |
| 模型供应商 | true external | AI SDK Adapter + deterministic fake |
| iframe / Electron 运行时 | 平台接缝 | 平台 Adapter + fake runtime |

不为 Clock、ID 等只存在一个实现的细节提前创建公开端口；测试可通过模块构造参数注入固定值。

### 4.3 前端 GenAppWorkspace 模块

```ts
type GenAppWorkspace = {
  view: {
    installed: GenAppSummary[];
    suggestions: GenAppSuggestion[];
    pendingSuggestionId?: string;
    phase: "idle" | "generating" | "installing" | "error";
    error?: GenAppClientError;
  };
  search(query: string): void;
  activate(ref: BuiltInAppRef | InstalledAppRef | SuggestionRef): Promise<void>;
  requestClose(runtimeId: string): Promise<void>;
  remove(appId: string): Promise<void>;
};
```

`search` 用已加载的设置快照同步生成候选，不发网络请求；`activate` 隐藏“生成还是读取”、动态窗口注册与触达；`requestClose` 隐藏草稿安装状态机。AppLauncher 和 App.tsx 不直接调用 CRUD。

## 5. 服务端目录建议

```text
packages/shared/src/gen-apps.ts
  DTO、schema、错误码、artifact/runtime 版本
packages/shared/src/gen-app-suggestions.ts
  浏览器与 Bridge 共用的确定性候选策略

apps/server/src/database/
  openos-database.ts
  migrations.ts

apps/server/src/gen-apps/
  domain.ts
  gen-apps-service.ts
  ports.ts
  artifact-compiler.ts
  prompt-policy.ts
  http/gen-apps-controller.ts
  infrastructure/llm-gen-app-generator.ts
  infrastructure/sqlite-gen-app-repository.ts
```

`create-server.ts` 只挂载 `GenAppsController`。不要新增一组直接 import store 函数的 if/else 路由，也不要复用 `chat-store.ts` 的全局数据库单例。

## 6. HTTP 契约

统一使用 `/api/gen-apps`，不使用 `/api/genapps`。

| 方法 | 路径 | 语义 |
| --- | --- | --- |
| `POST` | `/api/gen-apps/suggestions` | 返回经 schema 校验的候选 |
| `POST` | `/api/gen-apps/drafts` | 生成、编译并保存草稿；支持幂等键 |
| `POST` | `/api/gen-apps/drafts/stream` | SSE 流式生成声明式预览并返回最终草稿 |
| `POST` | `/api/gen-apps/:id/install` | 幂等地把草稿转换为已安装应用 |
| `GET` | `/api/gen-apps` | 只返回 Summary 列表，不返回 HTML |
| `POST` | `/api/gen-apps/:id/launch` | 原子读取 Artifact 并更新最近打开时间 |
| `POST` | `/api/gen-apps/:id/interact` | V2 元素事件换取单目标 revision patch |
| `POST` | `/api/gen-apps/:id/resume` | 重新编译宿主快照并恢复过期/分叉的 V2 会话 |
| `POST` | `/api/gen-apps/:id/continue` | V1 兼容续生成及声明式 V2 fragment |
| `DELETE` | `/api/gen-apps/:id` | 幂等删除草稿或已安装应用 |
| `GET/PUT` | `/api/settings/gen-apps` | 独立读写 Gen Apps 设置 |

请求与响应要点：

- 搜索词 trim 后长度为 1–120；`count` 必须是整数并在服务端 clamp 到 2–12。
- Suggestion 使用 opaque id；`iconTheme` 是服务端允许的主题 token，不接受模型提供的任意 CSS。
- 生成请求携带 `idempotencyKey`，双击、网络重试和超时重试不能产生重复应用。
- `generateDraft` 返回预览所需 Artifact；列表不携带 HTML。
- 请求支持 `AbortSignal`，服务端在客户端断开、超时或取消时终止上游生成。
- 所有响应都经过运行时 schema 校验，不能只靠 TypeScript 强转。

统一错误结构：

```ts
type ApiErrorBody = {
  error: {
    code: GenAppErrorCode;
    message: string;
    requestId: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
};
```

至少定义：`validation_failed`、`llm_not_configured`、`generation_timeout`、`invalid_model_output`、`artifact_rejected`、`draft_not_found`、`invalid_transition`、`app_not_found`、`storage_quota_exceeded`。

HTTP 状态明确映射到 400 / 404 / 409 / 413 / 422 / 429 / 502 / 503 / 504。前端抛出携带 `status`、`code`、`requestId`、`retryable` 的 `GenAppClientError`，不再只保留 message。

## 7. 数据库与迁移

### 7.1 所有权

第一阶段可继续使用现有 `chat.sqlite` 文件以避免迁移用户数据，但它应由新的 `OpenOsDatabase` 基础设施模块持有；文件名只是兼容细节，不代表 Gen Apps 依赖 Chat。

`OpenOsDatabase` 统一负责：

- 单连接生命周期与测试关闭；
- `PRAGMA journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout`；
- 事务；
- `schema_migrations` 或 `user_version`；
- 启动时按顺序执行幂等迁移。

路径：

| 端 | 当前兼容路径 |
| --- | --- |
| Electron dev | `~/Library/Application Support/OpenOS Dev/data/chat.sqlite` |
| Electron stable | `~/Library/Application Support/OpenOS/data/chat.sqlite` |
| 浏览器开发态 | Server cwd 下 `.openos/chat.sqlite`，当前通常为 `<repo>/apps/server/.openos/chat.sqlite` |

浏览器本身不直接持有 SQLite，始终通过本机 Bridge 访问。

### 7.2 表结构

```sql
CREATE TABLE gen_apps (
  id                    TEXT PRIMARY KEY,
  state                 TEXT NOT NULL CHECK (state IN ('draft', 'installed')),
  name                  TEXT NOT NULL,
  icon_emoji            TEXT NOT NULL,
  icon_theme            TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  category              TEXT NOT NULL DEFAULT 'AI',
  source_query          TEXT NOT NULL,
  generator_provider    TEXT NOT NULL,
  generator_model       TEXT NOT NULL,
  prompt_version        INTEGER NOT NULL,
  artifact_revision     INTEGER NOT NULL,
  created_at            INTEGER NOT NULL,
  installed_at          INTEGER,
  opened_at             INTEGER,
  draft_expires_at      INTEGER,
  deleted_at            INTEGER
);

CREATE TABLE gen_app_artifacts (
  app_id                 TEXT NOT NULL REFERENCES gen_apps(id) ON DELETE CASCADE,
  revision               INTEGER NOT NULL,
  format                 TEXT NOT NULL,
  format_version         INTEGER NOT NULL,
  runtime_version        INTEGER NOT NULL,
  policy_version         INTEGER NOT NULL,
  html                   TEXT NOT NULL,
  content_sha256         TEXT NOT NULL,
  size_bytes             INTEGER NOT NULL,
  PRIMARY KEY (app_id, revision)
);

CREATE TABLE gen_app_data (
  app_id                 TEXT NOT NULL REFERENCES gen_apps(id) ON DELETE CASCADE,
  key                    TEXT NOT NULL,
  value_json             TEXT NOT NULL,
  updated_at             INTEGER NOT NULL,
  PRIMARY KEY (app_id, key)
);
```

列表查询不读取 `html`。安装转换、读取并 touch、删除及配额检查必须使用事务。Repository 只返回领域对象。

## 8. 模型生成与制品编译

### 8.1 LLM Adapter

- Suggest 使用结构化输出 schema，不对自由文本直接 `JSON.parse` 后强转。
- Generate 允许模型返回完整 HTML 或代码块，但 Adapter 先提取为 `UntrustedArtifact`。
- Prompt、模型名、provider、token 使用量、耗时和 Prompt 版本写入可观测元数据。
- Query 是不可信文本；Prompt injection 不能改变安全策略。
- 上游调用设置超时、最大重试数与并发上限。

### 8.2 ArtifactCompiler

`ArtifactCompiler.compile(untrusted)` 是进程内纯模块，输出 branded `ValidatedArtifact`。它负责：

1. 使用 HTML parser 解析，而不是正则替换字符串。
2. 丢弃 `base`、`object`、`embed`、`frame/iframe`、外链资源和危险元数据。
3. 重新构造固定的 `html/head/body` 外壳，并在任何不可信字节之前注入 CSP 与运行时 bootstrap。
4. 验证名称、emoji、主题 token、HTML 字节数和节点数量。
5. 写入 `formatVersion`、`runtimeVersion`、`policyVersion`、SHA-256 与字节数。
6. Repository 只接受 `ValidatedArtifact`，不能绕过编译器写入原始模型输出。

建议默认限制：

| 项目 | 默认值 |
| --- | --- |
| HTML | 512 KiB |
| 声明式元素节点 | 2,000 个 |
| 单次生成超时 | 60 秒 |
| 同时生成任务 | 2 个 |
| 已安装应用 | 100 个 |
| 单应用用户数据 | 1 MiB |
| 草稿 TTL | 24 小时 |

这些值集中定义并可配置，不能散落为 magic number。

## 9. 运行时安全

### 9.1 固定 iframe 策略

```tsx
<iframe
  srcDoc={compiledHtml}
  sandbox="allow-scripts"
  referrerPolicy="no-referrer"
  allow=""
/>
```

禁止增加 `allow-same-origin`、`allow-forms`、`allow-popups`、`allow-downloads` 或 `allow-top-navigation`。

固定 CSP 至少包含：

```text
default-src 'none';
connect-src 'none';
script-src 'unsafe-inline';
style-src 'unsafe-inline';
img-src data: blob:;
font-src data:;
media-src data: blob:;
object-src 'none';
frame-src 'none';
worker-src 'none';
base-uri 'none';
form-action 'none';
```

CSP 必须由可信编译器注入；模型生成的 CSP 不能替代它。Prompt 中“禁止 fetch”只改善输出质量，不计入安全保证。

### 9.2 Bridge 前置加固

在 Gen Apps 上线前必须：

- 移除 Bridge 的通配 CORS，按运行通道校验 Origin；
- 拒绝来自 sandbox opaque origin（`Origin: null`）的 Bridge 请求；
- stable 始终要求随机 token；dev 不得把无鉴权 Bridge 暴露给生成 iframe；
- CORS 方法补齐实际使用的 `DELETE`，但预检通过不等于取消鉴权；
- 413 等输入错误不能落成泄露内部消息的 500。

### 9.3 能力桥

生成应用不使用 localStorage。可信 Runner 通过 `MessageChannel` 暴露最小 `openos.storage` 能力：

- 仅允许 `get/set/remove/listKeys`；
- app id 由宿主会话绑定，子页面不能指定其他 app id；
- 每条消息校验 schema、session nonce、key/value 大小和总配额；
- 不提供通用 HTTP、文件、剪贴板或宿主命令能力；
- 删除应用同时删除其 namespaced data。

### 9.4 残余风险

iframe 是来源隔离，不是资源隔离。任意同步死循环或内存炸弹仍可能拖慢浏览器 renderer。因而：

- 个人本地 MVP 可使用 `BrowserIframeRuntime`，但必须明确该风险。
- Electron 上线强隔离版本应使用独立 WebContents/独立 session，并能从宿主强制终止。
- 若未来允许分享或导入第三方应用，应切换到受限 `AppSpec` DSL 或可终止的解释器；不能继续把任意 HTML/JS 当成强安全沙箱。

## 10. 前端解耦

### 10.1 先建立动态应用注册表

当前 `App.tsx` 中 `AppId`、`WINDOW_DEFAULTS`、`windowMeta`、`launcherApps` 和窗口 JSX 各自维护应用信息。新增 Gen Apps 前先收敛为：

```ts
type DesktopAppDescriptor = {
  id: string;
  kind: "builtin" | "generated";
  title: string;
  category: string;
  icon: IconDescriptor;
  window: WindowDefaults;
};
```

Built-in Adapter 与 Generated Adapter 都产出 Descriptor；Launcher、菜单栏、最小化抽屉和窗口层从同一注册表派生，避免在多个数组重复注册。

### 10.2 动态窗口

`useWindowManager` 至少增加：

```ts
openDynamic(definition: WindowDefaults): void;
unregister(id: string): void;
requestClose(id: string): Promise<void>;
```

约束：

- 未知 id 不能把 `focusedId` 设为悬空值。
- 同一 app 重复打开默认聚焦现有窗口，不创建重复窗口。
- 多个 Gen App 可同时打开。
- 最小化、恢复、删除运行中应用和安装失败都必须保持合法窗口状态。
- `DesktopWindow` 提供 `onRequestClose`，草稿 Runner 可在真正 close 前安装。
- `MinimizedShelf` 接收动态 meta。

### 10.3 Launcher 保持纯展示

`AppLauncher` 改为受控 `query/onQueryChange`，接收判别联合：

```ts
type LauncherItem =
  | { kind: "builtin"; app: BuiltInApp }
  | { kind: "installed"; app: GenAppSummary }
  | { kind: "suggestion"; suggestion: GenAppSuggestion; loading: boolean };
```

它只渲染、上报 activate/remove，不发请求、不防抖、不安装应用。

`GenAppWorkspace` 负责：

- 从 `/api/settings/gen-apps` 加载并订阅进程内设置快照；
- 每次输入在浏览器内同步生成完整候选，不创建候选 HTTP 请求；
- 已安装 -> 内置 -> 候选的混排策略；
- 生成、草稿运行、关闭安装与错误恢复；
- 删除后同步注册表和运行时。

## 11. 设置与配置

不要把 `genAppCount` 塞进 `LlmSettingsUpdate` 或 `/api/settings/llm`。当前 SettingsStore 保存 LLM 时会重建文件，混入字段容易被静默丢失。

建议升级为：

```json
{
  "version": 2,
  "llm": {},
  "features": {
    "genApps": {
      "suggestionCount": 6
    }
  }
}
```

`/api/settings/gen-apps` 独立校验和原子 merge；修改 LLM 设置不能覆盖 Gen Apps 设置，反向亦然。

浏览器通过 `settings-sync` 维护可订阅快照：设置编辑先乐观更新候选，300ms 内合并持久化；点击候选前必须 flush 待保存设置，确保 Bridge 生成使用同一份语言、creativity 和模式。保存失败回滚到最近一次服务端确认值并显示错误。多标签页用 `BroadcastChannel` 传播失效通知，再从 Bridge GET 权威快照，避免乱序响应覆盖较新设置；窗口重新聚焦时也会校准。

## 12. 可观测性与错误处理

每次 suggest/generate/install/launch 记录：

- `requestId`、app/draft id、阶段与耗时；
- suggest 的本地策略版本；generate 的 provider、model、Prompt version、token 使用量；
- artifact hash、大小、policy/runtime 版本；
- 标准错误码和是否可重试。

不得记录 API Key、Bridge token、完整用户数据或未经脱敏的制品内容。生成失败、制品拒绝和安装失败应可区分。

## 13. 测试与质量门槛

### 13.1 模块测试

- 使用 FakeGenerator + InMemoryRepository 覆盖完整状态机、幂等、TTL、配额和错误映射。
- 候选在 LLM 未配置或上游不可用时仍须返回完整数量，进程内耗时门槛低于 100ms。
- ArtifactCompiler 使用恶意 fixture 覆盖外链、动态标签、超大 HTML、非法 metadata 和畸形文档。
- 测试只通过 GenApps 模块接口断言可观察结果，不测试内部函数。

### 13.2 SQLite 集成测试

- 在临时数据库执行从现有 Chat schema 到新 migration 的升级。
- 验证并发聊天写入与 Gen App 安装、事务回滚、外键级联、重启恢复。
- 验证 dev/stable 数据目录隔离。

### 13.3 HTTP 契约测试

- 覆盖非法 JSON、超长 query、非法 count、重复 idempotency key、模型未配置、超时、取消及上游失败。
- 精确断言 status、error code、requestId 与 retryable。
- token 模式下验证 GET/POST/DELETE 及预检。

### 13.4 浏览器与 Electron 安全测试

恶意制品逐项尝试：

- `fetch`、XHR、WebSocket、Beacon；
- img/script/CSS url、form、iframe、popup、top navigation；
- parent DOM、Cookie、localStorage、Bridge API；
- 摄像头、麦克风、剪贴板和下载。

公网捕获端点和 `/api` 必须收到 0 个可成功请求。Electron 强隔离版本还必须验证死循环和内存炸弹下宿主仍可在限定时间内终止运行时。
如果 Chromium 中的同 frame 导航或其他通道绕过上述策略，`BrowserIframeRuntime` 不得上线；应改用受限 AppSpec/解释器，而不是降低验收标准。

### 13.5 端到端流程

- 生成完成但未关闭时，启动台列表无记录。
- 首次关闭安装成功后出现；失败时窗口不关闭且可重试/丢弃。
- 双击生成与重复关闭只产生一个应用。
- 二次打开不调用模型；Runner 成功加载后才更新 `opened_at`。
- 动态窗口打开、聚焦、最小化、恢复、多应用并行和运行中删除行为确定。
- 修改 LLM 设置不丢 Gen Apps 设置，反向亦然。

核心状态机、ArtifactCompiler 和 Repository 覆盖率目标不低于 80%。

## 14. 实施顺序

### Tracer 1：不接模型的完整竖切

- 建 shared contract/schema、数据库迁移、GenApps 模块接口与 FakeGenerator。
- 固定生成一个安全计算器制品。
- 跑通 suggest -> draft -> Runner -> close/install -> reopen -> delete。
- 同时完成动态应用注册表与动态窗口，不先堆临时分支。

### Tracer 2：安全制品链

- 实现 ArtifactCompiler、固定 CSP、Bridge 加固、MessageChannel storage。
- 先让恶意 fixture 测试通过，再接真实模型。

### Tracer 3：真实 LLM Adapter

- 接入结构化 Suggest、HTML Generate、超时/取消/错误映射。
- 加入设置项、token/耗时观测和幂等。

### Tracer 4：双端与强隔离

- 浏览器完成 iframe E2E。
- Electron 增加独立运行时 Adapter 和可终止性测试。
- packaged 构建通过后再开放功能开关。

## 15. 关键决策记录

| 决策 | 结论 |
| --- | --- |
| 制品格式 | 第一阶段保留单文件 HTML，但增加格式/运行时/策略版本 |
| 生命周期 | 生成产生 draft，首次成功关闭才 install |
| 模块接缝 | Controller -> GenApps application service -> Repository/Generator ports |
| 数据库 | 可继续使用物理 chat.sqlite；所有权迁移到 OpenOsDatabase |
| 列表载荷 | 只返回 Summary；Artifact 仅在 draft/launch 时返回 |
| 图标背景 | 使用受限 iconTheme token，不接受任意 CSS |
| 设置 | 独立 `settings.genApps` 与 `/api/settings/gen-apps` |
| 沙箱 | iframe + CSP 是 MVP 隔离，不宣称资源级强安全 |
| 用户数据 | 通过宿主 MessageChannel KV 能力，不开放 localStorage |
| 平台差异 | 业务模块共享；Runtime 通过真实平台接缝使用不同 Adapter |

## 16. 预估改动清单

| 位置 | 内容 |
| --- | --- |
| `packages/shared/src/gen-apps.ts` | DTO、schema、错误码、版本 |
| `apps/server/src/database/*` | 通用 SQLite 生命周期与 migration |
| `apps/server/src/gen-apps/*` | 领域、应用服务、端口、Controller、Adapter、Compiler |
| `apps/server/src/create-server.ts` | 组合并委托 GenAppsController；补齐 CORS/错误映射 |
| `apps/server/src/settings-store.ts` | version 2、原子 merge、Gen Apps 独立设置 |
| `apps/web/src/gen-apps/*` | Client Adapter、Workspace、Runner、能力桥 |
| `apps/web/src/window/*` | 动态注册、关闭拦截、动态 meta |
| `apps/web/src/launcher/AppLauncher.tsx` | 受控搜索与判别联合展示 |
| `apps/web/src/App.tsx` | 动态应用注册表与统一渲染入口 |
| `apps/web/src/api.ts` | AbortSignal、结构化 Client Error；逐步拆出 feature client |
| Electron main/preload | 强隔离 Runtime、权限/导航/网络拒绝策略 |
| i18n / styles | 状态、错误、安装重试、删除与生成视觉反馈 |
| tests | 模块、SQLite、HTTP、安全及双端 E2E |
