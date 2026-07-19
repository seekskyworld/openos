import type {
  GenAppArtifactFormat,
  GenAppContinueIntent,
  GenAppRuntimeEvent,
} from "@openos/shared";
import { GEN_APP_LEGACY_FORMAT } from "@openos/shared";
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
    "应用必须是 macOS 系统级自带工具的风格：朴素、单一职责、真实存在于操作系统里的那类应用（如计算器、备忘录、时钟、词典、预览）。禁止花哨概念。",
  appstore:
    "应用应是应用商店里常见的成熟商业产品风格：功能完整、面向大众、有清晰使用场景（如番茄钟、记账、习惯打卡、白噪音）。",
  indie:
    "应用应是个人独立开发者会做的小而美工具：有个性、解决一个具体的小痛点、可能有点极客味（如正则测试器、色板生成、Git 提交词生成）。",
  fantasy:
    "应用可以天马行空：大胆想象未来或超现实的概念，但仍要能用网页交互表达出核心玩法（如情绪天气台、梦境记录仪、平行人生模拟）。",
};

export function buildGeneratePrompt(input: {
  name: string;
  description: string;
  query: string;
  tier: CreativityTier;
  language: GenAppLanguage;
}): { system: string; user: string } {
  const system = [
    "你是 OpenOS 声明式应用设计器。宿主已经预载 macOS 风格 UI Kit、状态存储和通用交互运行时。",
    "输出要求：只输出可放进 <body> 的 HTML 标记片段，不要代码块围栏，不要解释。",
    "硬性约束：",
    "1. 禁止输出 <html>/<head>/<body>/<style>/<script>/<link>/<meta>/<form>/<iframe>/<svg>；禁止任何 on* 事件属性、href/src、外链、CSS 和 JavaScript。",
    "2. 所有可点击或可变元素必须有稳定、语义化、嵌套粒度尽量细的唯一 id。button 一律 type=\"button\"。",
    "3. 所有按钮必须声明 data-action；需要操作另一个元素时同时声明 data-target=\"目标id\"。输入来源可用 data-source，按钮值用 data-value。",
    "4. 优先使用宿主本地行为；真实网络检索使用 web.search；只有需要模型虚构或改写内容时才用 ai.generate 或 ai.patch。",
    "5. 不绘制窗口外壳、标题栏、红黄绿圆点、壁纸或居中假窗口；最外层直接使用 class=\"os-app\" 铺满内容区。",
    "6. 首次只生成可用骨架和核心内容，深层内容按需生成；标记保持精简，避免重复占位数据。",
    `7. 应用定位风格：${TIER_GUIDANCE[input.tier]}`,
    `8. ${LANGUAGE_GUIDANCE[input.language]}`,
    "",
    "【UI Kit 速查】",
    "布局：os-app / os-split / os-sidebar / os-main / os-toolbar / os-row / os-column / os-fill / os-grid / os-section。",
    "控件：os-button os-primary、os-icon-button、os-input、os-select、os-textarea、os-search、os-tabs/os-tab/os-tab-panel、os-list/os-list-item、os-card、os-table、os-modal/os-modal-dialog、os-status、os-badge、os-empty、os-progress。",
    "本地动作：tabs.select、toggle、modal.open、modal.close、list.select、list.add、list.remove、list.toggle、filter、sort、counter.increment、counter.decrement、calc.input、calc.evaluate、calc.clear、calc.backspace、state.set、toast。",
    "宿主动作：web.search 用于真实网络搜索，按钮必须同时声明 data-target 和 data-source；ai.generate 用于虚构/生成式浏览，ai.patch 用于修改当前最深层带 id 区块。",
    "示例：<button id=\"tab-notes\" class=\"os-tab\" data-action=\"tabs.select\" data-target=\"panel-notes\" type=\"button\">笔记</button>。",
    "示例：<button id=\"search-action\" class=\"os-button os-primary\" data-action=\"web.search\" data-target=\"results\" data-source=\"search-input\" type=\"button\">网络搜索</button>。",
    "示例：计算器数字键 data-action=\"calc.input\" data-target=\"display\" data-value=\"7\"；等号使用 calc.evaluate。",
  ].join("\n");

  const user = JSON.stringify({
    应用名: input.name,
    应用描述: input.description,
    来源搜索词: input.query,
  });
  return { system, user };
}

/** AppIR 模型输出：业务语义由模型决定，结构由 schema 和 Catalog 约束。 */
export function buildAppIrPrompt(input: {
  name: string;
  description: string;
  query: string;
  tier: CreativityTier;
  language: GenAppLanguage;
}): { system: string; user: string } {
  const system = [
    "你是 OpenOS AppIR 应用设计器。模型负责决定应用的布局、文案、功能、行为和初始数据；宿主只负责渲染和执行已声明行为。",
    "只输出一个 JSON 对象，不要 Markdown、解释或代码围栏。协议版本必须是 openos-appir/v1。",
    "顶层字段：protocolVersion,catalogVersion,identity,root,components,data,actions,behavior,capabilities,engines,theme。",
    "组件只能使用 surface、stack、column、text、button、input、list、table、chart、canvas、modal；每个组件必须有稳定 id，children 只能引用已有 id。",
    "动作 kind 只能是 local、capability、ai；禁止脚本、CSS、任意表达式、URL、网络请求和源码字符串。",
    "behavior 只能用 initial/states/transitions；transition 包含 event、targetState、updates（add/remove/replace/test JSON Pointer）、effects。",
    "优先声明完整可用的行为图，让常见点击和输入无需再次调用模型；外部搜索、网页、文件、存储只能通过 capability action。",
    `应用定位风格：${TIER_GUIDANCE[input.tier]}`,
    LANGUAGE_GUIDANCE[input.language],
  ].join("\n");
  return {
    system,
    user: JSON.stringify({ 应用名: input.name, 应用描述: input.description, 来源搜索词: input.query }),
  };
}

const CONTINUE_INTENT_GUIDANCE: Record<GenAppContinueIntent, string> = {
  browse:
    "为给定 URL 或搜索词生成完整、可读、内容丰富的网页正文片段。可点击链接使用 id + data-href + data-action=\"ai.generate\"，不要 href。",
  panel:
    "生成内嵌面板或弹窗标记，使用 os-modal/os-modal-dialog 与 data-action，不输出脚本。",
  search:
    "为给定的搜索词生成一组真实可信的搜索结果列表片段（标题、摘要、来源），链接一律用 data-href 属性。",
  content:
    "为给定主题生成一段高质量的内容片段（文章/数据/列表等），排版干净可读。",
  update:
    "你会收到一个界面元素当前的完整标记（含其 id 与内部结构）和一句修改指令。只输出该元素修改后的完整替换标记（同一个根元素，保留原 id，除非指令明确要求更换 id），不要输出周围的其他元素、不要解释、不要代码块围栏。视觉风格必须与现有界面保持一致。",
};

const LEGACY_CONTINUE_INTENT_GUIDANCE: Record<GenAppContinueIntent, string> = {
  browse:
    "为给定 URL 或搜索词生成完整可读的网页正文片段；页内链接使用 data-href，应用会继续调用 OpenOS.generate。",
  panel: "生成与当前应用风格一致的内嵌面板或弹窗片段，并在需要时内联交互脚本。",
  search: "生成真实可信的搜索结果列表片段，链接使用 data-href。",
  content: "为给定主题生成高质量内容片段。",
  update:
    "只输出目标元素修改后的完整替换标记，保留根 id；可以保留该元素所需的内联样式和脚本。",
};

/**
 * 运行时续生成（OpenOS.generate/update → /continue）。
 * 单轮无修复循环；是否带会话历史由 GenAppsService 决定——
 * 本函数只负责当前这一轮的 system/user 文本，历史轮次的拼接在调用方完成。
 */
export function buildContinuePrompt(input: {
  appName: string;
  appDescription: string;
  sourceQuery: string;
  intent: GenAppContinueIntent;
  prompt: string;
  context?: string;
  /** update intent：目标元素 id 与当前完整标记 */
  targetId?: string;
  currentHtml?: string;
  language: GenAppLanguage;
  format: GenAppArtifactFormat;
}): { system: string; user: string } {
  const legacy = input.format === GEN_APP_LEGACY_FORMAT;
  const system = legacy
    ? [
        `你在为 OpenOS V1 应用「${input.appName}」（${input.appDescription}）维护同一个窗口会话。`,
        "只输出一段 HTML fragment，不含 html/head/body 外壳，不要解释或围栏。允许该 V1 应用所需的内联 style/script。",
        "硬性约束：禁止外链资源、fetch/XHR/WebSocket、form 提交、alert/confirm/prompt；按钮 type=button。",
        "保持此前的 CSS 前缀、事件接线、品牌、数据和布局；修改现有区块时保留目标根 id。",
        LANGUAGE_GUIDANCE[input.language],
      ].join("\n")
    : [
        `你在为 OpenOS 应用「${input.appName}」（${input.appDescription}）维护同一个窗口会话。`,
        "输出只允许声明式 HTML 片段，不含 html/head/body/style/script，不要解释或围栏。",
        "硬性约束：",
        "1. 禁止脚本、样式、on* 属性、form、外链和 href/src；使用 os-* UI Kit 与 data-action。",
        "2. 所有可点击/可变元素都要有稳定 id；按钮 type=button。",
        "3. 修改现有区块时，只返回最深层需要变化的那一个根元素并保留其 id。",
        "4. 保持本窗口此前确立的品牌、数据和布局，不要重新发明。",
        `5. ${LANGUAGE_GUIDANCE[input.language]}`,
      ].join("\n");

  const user = JSON.stringify({
    生成指令: input.prompt,
    任务类型: input.intent,
    任务要求: legacy
      ? LEGACY_CONTINUE_INTENT_GUIDANCE[input.intent]
      : CONTINUE_INTENT_GUIDANCE[input.intent],
    ...(input.context ? { 应用上下文: input.context } : {}),
    ...(input.intent === "update" && input.targetId
      ? { 目标元素id: input.targetId }
      : {}),
    ...(input.intent === "update" && input.currentHtml
      ? { 目标元素当前标记: input.currentHtml }
      : {}),
    应用来源搜索词: input.sourceQuery,
  });
  return { system, user };
}

/** V2 交互只允许单目标 replace；revision 由服务端最终签发。 */
export function buildRuntimePatchPrompt(input: {
  appName: string;
  appDescription: string;
  sourceQuery: string;
  baseRevision: number;
  event: GenAppRuntimeEvent;
  declaredAction: string;
  actionElementHtml: string;
  patchTargetId: string;
  patchTargetHtml: string;
  dataHref?: string;
  dataPrompt?: string;
  language: GenAppLanguage;
}): { system: string; user: string } {
  const system = [
    "你是 OpenOS V2 的声明式 UI 补丁引擎。你维护同一个窗口会话，只修改用户本次交互真正影响的最小区块。",
    "只输出原始 JSON 对象，不要 Markdown、解释或代码块。",
    "输出 schema：{\"baseRevision\":整数,\"ops\":[{\"op\":\"replace\",\"targetId\":\"目标id\",\"html\":\"替换元素完整HTML\"}]}。",
    "硬性约束：",
    "1. ops 必须恰好一项，targetId 必须与给定补丁目标完全相同；html 必须恰好一个根元素并保留该 id。",
    "2. 只返回最深层需要变化的元素，不返回 html/head/body/style/script/form/iframe/svg，不写 CSS、JavaScript、on*、href/src 或外链。",
    "3. 使用 os-* UI Kit 与 data-action；所有新增可点击或可变元素必须有稳定唯一 id，按钮 type=button。",
    "4. 保留未受影响的数据、结构和既有设定。不要重写整个应用。",
    `5. ${LANGUAGE_GUIDANCE[input.language]}`,
  ].join("\n");
  const user = JSON.stringify({
    contract: "openos-patch-batch",
    app: {
      name: input.appName,
      description: input.appDescription,
      sourceQuery: input.sourceQuery,
    },
    baseRevision: input.baseRevision,
    event: input.event,
    declaredAction: input.declaredAction,
    actionElementHtml: input.actionElementHtml,
    patchTarget: {
      id: input.patchTargetId,
      currentHtml: input.patchTargetHtml,
    },
    ...(input.dataHref ? { navigationTarget: input.dataHref } : {}),
    ...(input.dataPrompt ? { instruction: input.dataPrompt } : {}),
  });
  return { system, user };
}

export function buildRuntimePatchRepairPrompt(input: {
  baseRevision: number;
  targetId: string;
  reason: string;
}): string {
  return [
    `上一条输出无效：${input.reason}`,
    "重新输出一次，且只能输出原始 JSON 对象。",
    `baseRevision 必须为 ${input.baseRevision}；ops 恰好一项 replace；targetId 必须为 ${JSON.stringify(input.targetId)}；html 根元素必须保留同一 id。`,
  ].join("\n");
}
