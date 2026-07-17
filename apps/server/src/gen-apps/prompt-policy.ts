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
    "2. 功能必须真实可用，不是静态摆设：按钮点得动、输入有反应、状态有变化；",
    "3. UI 参考 macOS 审美：系统字体栈、圆角、克制的配色、支持小窗口（最小 400×360）自适应；",
    "4. 应用运行在 OpenOS 的真实窗口内部——窗口边框、标题栏、红黄绿交通灯按钮由系统提供。因此绝对禁止：自己绘制窗口外壳/标题栏/红黄绿圆点/关闭最小化按钮；把内容做成居中悬浮的『窗口卡片』；给最外层加大圆角+投影模拟窗口；绘制桌面壁纸背景。正文内容应直接铺满整个视口（html,body{height:100%;margin:0}）。",
    "5. 数据只存内存变量（刷新丢失可接受），不使用 localStorage/cookie；",
    "6. 不引入框架，原生 HTML/CSS/JS 完成；",
    `7. 应用定位风格：${TIER_GUIDANCE[input.tier]}`,
    `8. ${LANGUAGE_GUIDANCE[input.language]}`,
    "代码质量：语义化结构、事件用 addEventListener、避免全局污染。",
  ].join("\n");

  const user = JSON.stringify({
    应用名: input.name,
    应用描述: input.description,
    来源搜索词: input.query,
  });
  return { system, user };
}
