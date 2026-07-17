# 生成式运行时（Generative Runtime）架构设计

> 状态：owner 已批准。T1 + 频控（T2 核心）+ 会话记忆 + 局部更新（Vibe OS 对照后追加）已实施；剩余：设置页开关、遥测（T2/T3 尾项）。

## 8. 追加能力（对照 Microsoft Build 2026「Vibe OS」演示后实施）

参考对象：Steve Sanderson 的 Vibe OS 演示——纯幻觉 UI，每个窗口绑一个持续的 Copilot
session（对话记忆即状态），交互靠「发元素 id → 模型回 diff → 局部更新」实现速度与连贯性。
我们保留真实执行的核心架构（不改），但吸收了它两个有价值的点：

### 8.1 续生成会话记忆

`/continue` 从完全无状态单发，改为按「会话流」维护 CoreMessage 历史
（`ContinueSessionStore`，进程内、有界增长：每会话最多 6 轮、总会话数上限
300、30 分钟闲置回收、单轮历史文本截断 4000 字符防 token 爆炸）。

会话分组：显式 `sessionId` 优先；`update` intent 默认按目标元素分组
（`update:${targetId}`）；其余按 `intent` 分组——单地址栏浏览器的连续导航
天然共享一条上下文，应用代码不需要自己管理 sessionId；只有需要多个并行独立
会话（多标签页）时才显式传不同 id。

效果：生成式浏览器多次跳转后，模型记得自己虚构过的站点结构/品牌/数据，
不会每次点击都重新脑补出不一致的内容（E2E 验证：品牌名、CSS 类名前缀、
导航结构跨两次导航保持一致）。

### 8.2 局部更新（`OpenOS.update`）

不做字面 HTML diff 算法（parse+patch 在无 DOM 的服务端环境复杂且难安全校验），
而是「发送目标元素当前完整标记 → 模型返回替换后的同一元素 → 客户端原地
outerHTML 替换」——收益等价（只重新生成变化的部分，不必重建整个容器），
实现和校验都更简单。

```js
await OpenOS.update({ targetId: "hero-card", instruction: "标题改得更耸动" });
```

新增 intent `update`；`buildContinuePrompt` 要求模型只输出替换元素本身
（保留原 id），不输出周围内容、不解释。

## 1. 目标

生成的应用不再是一次性静态制品，运行中可**继续生成**：

- **生成浏览器**：地址栏输入任意 URL / 搜索词 → 该"网页"由模型现场生成，可继续点击页内链接跳转（WebSim 式体验）
- **按需弹窗**：点击应用里的设置按钮 → 设置面板此刻才生成
- **生成式搜索/输入框**：应用内搜索框的结果、推荐内容由模型按需产出

核心理念：首次生成只做**应用骨架**，深层内容延迟到用户真正触达时生成——生成得更快、应用可以"无限深"。

## 2. 现状与缺口

当前沙箱 iframe：`sandbox="allow-scripts"` + CSP `connect-src 'none'`——应用完全无网络、无宿主访问（安全边界正确，不能破坏）。缺口：应用运行期没有任何合法通道请求再生成。

## 3. 架构：三层一通道

```
┌─ 沙箱 iframe（生成的应用）──────────────────────────┐
│  App 代码 ──调用──▶ OpenOS.generate(payload)        │
│                     （编译期注入的运行时 SDK）        │
└──────────────────────┬──────────────────────────────┘
              postMessage RPC（唯一出口，白名单协议）
┌──────────────────────▼──────────────────────────────┐
│  GenAppRunner（宿主中继）                            │
│  校验 event.source / schema / 频控 → Bridge API     │
└──────────────────────┬──────────────────────────────┘
                  POST /api/gen-apps/:id/continue
┌──────────────────────▼──────────────────────────────┐
│  Server：ContinueService                             │
│  应用上下文 + intent 约束 → llm-core 流式单轮生成    │
│  → fragment 轻量清洗（去外链/限体积）→ 返回          │
└─────────────────────────────────────────────────────┘
```

### 3.1 运行时 SDK（ArtifactCompiler 注入）

编译制品时内联注入 `openos-runtime` 脚本（先于应用代码）：

```js
window.OpenOS = {
  /** 返回 Promise<string>（生成的 HTML 片段或文本） */
  generate({ intent, prompt, context, format }) { /* postMessage + requestId 等待应答 */ },
};
```

- `intent`：语义标签（`browse` / `panel` / `search` / `content`），服务端据此挑系统提示词模板
- `prompt`：应用给的生成指令（如浏览器输入的 URL）
- `context`：可选补充（当前页面摘要等，限长）
- `format`：`html-fragment`（默认）| `text` | `json`

### 3.2 postMessage 协议

```
iframe → host: { type: "openos:generate", requestId, payload }
host → iframe: { type: "openos:result", requestId, ok, fragment? , error? }
```

宿主校验：`event.source === iframe.contentWindow`（只认自己窗口）、schema 严格解析、单应用并发 1 + 频控。

### 3.3 服务端 `/api/gen-apps/:id/continue`

- 单轮快速生成（不走 agent 多轮）：低温度、流式（llm-core 已具备）、`maxOutputTokens` 默认 4k
- 系统提示词 = 应用身份上下文（名称/描述/来源搜索词/沙箱规则）+ intent 模板：
  - `browse`：'你是这个生成式浏览器的网页引擎，为给定 URL/搜索词生成一个完整可读的网页正文片段，页内链接用 `data-href` 标注（app 拦截后继续 generate）'
  - `panel`：'生成一个内嵌面板/弹窗片段，风格与宿主应用一致'
- 产出过 fragment 轻量清洗：复用校验器的外链规则（fatal 即拒）、体积上限（如 256KB）、剥 `<html>/<head>` 外壳只留片段

### 3.4 安全模型（边界不变）

- iframe 仍然无网络（CSP 不动）；唯一出口是 postMessage → 宿主白名单 RPC → 本机 Bridge
- fragment 与主制品同沙箱运行：即使含脚本，也出不了沙箱（这与主制品的信任级别一致）
- 清洗只拦「会失效/超限」项（外链、体积），不做无意义的假净化
- 配额防滥用：每应用每分钟 N 次（默认 6）、单次输出上限、设置页总开关

## 4. 提示词协同（主生成 prompt 增补）

生成主应用时告知 SDK 的存在与适用场景：

> 应用可调用 `await OpenOS.generate({intent, prompt})` 在运行时继续生成内容。
> 适用：浏览器式导航、按需面板、生成式搜索结果。
> 不适用：普通计算/状态更新（本地 JS 完成）。调用期间必须渲染页面内 loading 态。

模型自行决定哪些交互挂运行时生成——简单工具依旧纯本地，不强加。

## 5. 成本与配置

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| 运行时生成开关 | 开 | 设置 → AI 应用 |
| 频控 | 6 次/分/应用 | 服务端强制 |
| 单次输出上限 | 4k tokens | intent 可微调（browse 8k） |
| 温度 | 0.4（browse 0.7） | 内容类略高 |

## 6. 实施切片

| Tracer | 内容 | 验收 |
| --- | --- | --- |
| T1 | SDK 注入 + Runner 中继 + `/continue` 端点 + browse/panel 两个 intent 模板 + 主 prompt 增补 | 生成"浏览器"应用，输入词条能出页、页内链接能续跳 |
| T2 | 频控/配额/设置开关/错误态（频控命中时 app 收到 error 并展示） | 超频返回 429 语义错误 |
| T3 | fragment 清洗强化 + loading 规范 + 遥测（continue 次数/耗时入日志） | 校验器冒烟含 fragment 规则 |

## 7. 风险

- **token 消耗放大**：浏览器应用重度使用时每次导航都是一次生成——靠频控 + 设置开关 + 单次上限兜底；后续可加会话级预算
- **fragment 质量**：单轮无修复循环，可能偶发烂片段——app 端 loading/错误态由主 prompt 要求，烂片段重试成本低（再点一次）
- **旧应用不受益**：历史制品没有 SDK 调用——无碍，重新生成即得
