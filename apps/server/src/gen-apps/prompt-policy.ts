import type { GenAppContinueIntent } from "@openos/shared";
import type { CreativityTier, GenAppLanguage } from "./gen-app-settings.js";

const LANGUAGE_GUIDANCE: Record<GenAppLanguage, string> = {
  auto: "界面文案语言与搜索词语言保持一致（中文搜索词→中文界面）。",
  zh: "界面文案一律使用简体中文。",
  en: "All UI copy must be in English.",
};

/**
 * Prompt 策略集中地（可版本化）。
 * Query 是不可信文本：以数据形式嵌入，注入内容不改变安全策略——
 * 安全由 ArtifactCompiler + CSP 保证，Prompt 只负责输出质量。
 */

const TIER_GUIDANCE: Record<CreativityTier, string> = {
  system:
    "候选必须是 macOS 系统级自带工具的风格：朴素、单一职责、真实存在于操作系统里的那类应用（如计算器、备忘录、时钟、词典、预览）。禁止花哨概念。",
  appstore:
    "候选应是应用商店里常见的成熟商业产品风格：功能完整、面向大众、有清晰使用场景（如番茄钟、记账、习惯打卡、白噪音）。",
  indie:
    "候选应是个人独立开发者会做的小而美工具：有个性、解决一个具体的小痛点、可能有点极客味（如正则测试器、色板生成、Git 提交词生成）。",
  fantasy:
    "候选可以天马行空：大胆想象未来或超现实的应用概念，但仍要能用网页交互表达出核心玩法（如情绪天气台、梦境记录仪、平行人生模拟）。",
};

export function buildSuggestPrompt(input: {
  query: string;
  count: number;
  tier: CreativityTier;
  language: GenAppLanguage;
}): { system: string; user: string } {
  const system = [
    "你是 OpenOS 的应用商店策划，为用户搜索词生成应用候选。",
    "输出严格 JSON 数组，无任何额外文本，每项形如：",
    '{"name":"应用名","description":"一句话描述","iconEmoji":"单个emoji","iconTheme":"blue|purple|pink|orange|green|teal|graphite|red"}',
    "硬性要求：",
    `1. 恰好 ${input.count} 个候选；`,
    "2. name 是自然、真实可信的应用名（2-6 个字为佳），彼此完全不同；",
    "3. 绝对禁止把搜索词原样拼接进名字（如搜索“计算器”不能出现“计算器记事本”这类结果）；名字应当是搜索词所指的那类应用本身或语义相近的真实应用；",
    "4. description 说明这个应用做什么（≤20 字）；",
    "5. iconEmoji 与应用功能贴合；iconTheme 从给定枚举里选；",
    `6. 风格定位：${TIER_GUIDANCE[input.tier]}`,
    `7. ${LANGUAGE_GUIDANCE[input.language]}`,
    "示例：搜索“计算器”应产出类似：计算器、科学计算器、汇率换算、房贷计算、单位换算、小费计算 —— 每个都是真实成立的应用。",
  ].join("\n");

  const user = JSON.stringify({ 搜索词: input.query, 数量: input.count });
  return { system, user };
}

export function buildGeneratePrompt(input: {
  name: string;
  description: string;
  query: string;
  tier: CreativityTier;
  language: GenAppLanguage;
}): { system: string; user: string } {
  const system = [
    "你是资深前端工程师，为 OpenOS 生成一个可直接运行的单文件网页小应用。",
    "输出要求：只输出一个完整 HTML 文档（可用 ```html 代码块包裹），不要任何解释文字。",
    "硬性约束：",
    "1. 单文件：所有 CSS/JS 内联在文档中；禁止任何外部资源（script src、link href、图片外链、字体外链、fetch/XHR/WebSocket 一律不写）；",
    "2. 功能必须真实可用，不是静态摆设：每个按钮/输入都必须绑定事件（addEventListener）并产生可见反馈；脚本放在 </body> 前直接执行；脚本必须零运行时错误——引用的每个 id/选择器都必须在文档中真实存在，任何一处抛错都会让整个应用点不动；",
    "2b. 沙箱限制（违反会导致点击看似无效）：应用运行在禁止表单提交、禁止弹窗的沙箱 iframe 中——禁止使用 <form> 的提交行为与 type=submit（点击会被浏览器吞掉），按钮一律 type=\"button\" 并用 click 事件处理；禁止 alert/confirm/prompt（沙箱内不会弹出），所有提示、结果、确认一律渲染在页面内；",
    "3. UI 参考 macOS 审美：系统字体栈、圆角、克制的配色、支持小窗口（最小 400×360）自适应；",
    "4. 应用运行在 OpenOS 的真实窗口内部——窗口边框、标题栏、红黄绿交通灯按钮由系统提供。因此绝对禁止：自己绘制窗口外壳/标题栏/红黄绿圆点/关闭最小化按钮；把内容做成居中悬浮的『窗口卡片』；给最外层加大圆角+投影模拟窗口；绘制桌面壁纸背景。正文内容应直接铺满整个视口（html,body{height:100%;margin:0}）。",
    "5. 数据只存内存变量（刷新丢失可接受），不使用 localStorage/cookie；",
    "6. 不引入框架，原生 HTML/CSS/JS 完成；",
    `7. 应用定位风格：${TIER_GUIDANCE[input.tier]}`,
    `8. ${LANGUAGE_GUIDANCE[input.language]}`,
    "代码质量：语义化结构、事件用 addEventListener、避免全局污染。",
    "",
    "【生成式运行时（重要能力）】",
    "环境已注入 window.OpenOS.generate({ intent, prompt, context? }) → Promise<HTML片段字符串>，可在运行时让 AI 继续生成内容。",
    "核心原则：不要一次性生成完所有内容——首次只做应用骨架与核心交互，深层内容留到用户真正触达时用 OpenOS.generate 按需生成。",
    "intent 取值：browse（生成完整网页内容，如浏览器地址栏导航）、panel（按需生成设置面板/弹窗等界面区块）、search（生成搜索结果列表）、content（生成一段文章/数据等内容）。",
    "调用模式：async 事件处理里 const html = await OpenOS.generate({intent:'browse', prompt: url}); container.innerHTML = html;",
    "适用：浏览器式导航、点开才需要的面板、搜索结果、详情页、下一章内容。不适用：计算、状态更新等本地 JS 能完成的事。",
    "要求：调用期间必须渲染页面内 loading 态；失败（reject）时展示页面内错误提示并允许重试；返回片段直接插入容器即可。",
    "browse 类应用（浏览器等）：生成的页面片段里可点击的链接会带 data-href 属性，用事件委托拦截 click 后再次调用 OpenOS.generate({intent:'browse', prompt: 该href}) 实现继续跳转。",
  ].join("\n");

  const user = JSON.stringify({
    应用名: input.name,
    应用描述: input.description,
    来源搜索词: input.query,
  });
  return { system, user };
}

const CONTINUE_INTENT_GUIDANCE: Record<GenAppContinueIntent, string> = {
  browse:
    "你是这个生成式浏览器的网页引擎。为给定的 URL 或搜索词生成一个完整、可读、内容丰富的网页正文片段（虚构但真实可信，风格贴合该 URL 所暗示的站点）。页内所有可点击链接一律写成 <a data-href=\"目标url\">文字</a>（不要 href 属性），供宿主应用拦截后继续生成跳转。",
  panel:
    "为宿主应用生成一个内嵌面板/弹窗界面片段，视觉风格与 macOS 审美一致（系统字体栈、圆角、克制配色）。控件需绑定行为的，内联 <script> 写在片段末尾。",
  search:
    "为给定的搜索词生成一组真实可信的搜索结果列表片段（标题、摘要、来源），链接一律用 data-href 属性。",
  content:
    "为给定主题生成一段高质量的内容片段（文章/数据/列表等），排版干净可读。",
};

/** 运行时续生成（OpenOS.generate → /continue）：单轮、无修复循环 */
export function buildContinuePrompt(input: {
  appName: string;
  appDescription: string;
  sourceQuery: string;
  intent: GenAppContinueIntent;
  prompt: string;
  context?: string;
  language: GenAppLanguage;
}): { system: string; user: string } {
  const system = [
    `你在为 OpenOS 应用「${input.appName}」（${input.appDescription}）运行时生成增量内容。`,
    "输出要求：只输出一段 HTML 片段（不含 <html>/<head>/<body> 外壳，可含 <style>/<script>），不要任何解释文字，不要代码块围栏。",
    "硬性约束：",
    "1. 禁止任何外部资源（script src、link href、图片外链、fetch/XHR/WebSocket）；",
    "2. 沙箱限制：禁止 <form> 提交与 type=submit，按钮一律 type=\"button\"；禁止 alert/confirm/prompt；",
    "3. 片段将被直接插入应用容器，样式作用域尽量收敛（避免覆盖宿主全局样式）；",
    `4. 任务：${CONTINUE_INTENT_GUIDANCE[input.intent]}`,
    `5. ${LANGUAGE_GUIDANCE[input.language]}`,
  ].join("\n");

  const user = JSON.stringify({
    生成指令: input.prompt,
    ...(input.context ? { 应用上下文: input.context } : {}),
    应用来源搜索词: input.sourceQuery,
  });
  return { system, user };
}
