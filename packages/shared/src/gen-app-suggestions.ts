import {
  clampSuggestionCount,
  type GenAppLanguage,
  type GenAppIconTheme,
  type GenAppSuggestion,
} from "./gen-apps.js";

/**
 * 候选必须同时在浏览器和 Bridge 内同步生成，才能保证首屏不受模型延迟影响。
 * 这里集中维护确定性语义目录，LLM 只负责用户选中候选后的应用制品生成。
 */

export type FastSuggestionLanguage = GenAppLanguage;
export type FastSuggestionStyle = "system" | "appstore" | "indie" | "fantasy";

export function fastSuggestionStyle(creativity: number): FastSuggestionStyle {
  if (creativity <= 25) return "system";
  if (creativity <= 50) return "appstore";
  if (creativity <= 75) return "indie";
  return "fantasy";
}

export type FastGenAppSuggestionSeed = Omit<GenAppSuggestion, "id">;
type SuggestionCopy = FastGenAppSuggestionSeed;
type LocalizedSuggestion = { zh: SuggestionCopy; en: SuggestionCopy };
type SuggestionFamily = {
  keywords: readonly string[];
  suggestions: readonly LocalizedSuggestion[];
};

function localized(
  zhName: string,
  zhDescription: string,
  enName: string,
  enDescription: string,
  iconEmoji: string,
  iconTheme: GenAppIconTheme,
): LocalizedSuggestion {
  return {
    zh: { name: zhName, description: zhDescription, iconEmoji, iconTheme },
    en: { name: enName, description: enDescription, iconEmoji, iconTheme },
  };
}

const SUGGESTION_FAMILIES: readonly SuggestionFamily[] = [
  {
    keywords: ["浏览器", "网页", "上网", "搜索引擎", "browser", "web", "web search", "chrome", "google"],
    suggestions: [
      localized("浏览器", "快速浏览与搜索网页", "Web Browser", "Browse and search the web", "🌐", "blue"),
      localized("极速浏览器", "专注速度的轻量浏览器", "Fast Browser", "A lightweight browser focused on speed", "🚀", "blue"),
      localized("隐私浏览器", "减少追踪的私密浏览", "Private Browser", "Private browsing with less tracking", "🛡️", "graphite"),
      localized("网页搜索", "聚合网页搜索结果", "Web Search", "Search and organize web results", "🔎", "teal"),
      localized("阅读模式", "清爽阅读网页正文", "Reader", "Read web pages without distractions", "📖", "orange"),
      localized("书签管理", "整理收藏与常用网站", "Bookmark Manager", "Organize bookmarks and favorite sites", "🔖", "purple"),
      localized("标签页管理", "分组整理大量标签页", "Tab Manager", "Group and organize open tabs", "🗂️", "green"),
      localized("下载管理", "集中查看下载任务", "Download Manager", "Track and organize downloads", "📥", "blue"),
    ],
  },
  {
    keywords: ["计算器", "计算", "数学", "公式", "calculator", "calculate", "math", "formula"],
    suggestions: [
      localized("计算器", "快速完成日常计算", "Calculator", "Fast everyday calculations", "🧮", "orange"),
      localized("科学计算器", "函数与科学运算", "Scientific Calculator", "Functions and scientific calculations", "📐", "orange"),
      localized("单位换算", "长度重量温度换算", "Unit Converter", "Convert common measurements", "🔁", "purple"),
      localized("汇率换算", "常用货币快速换算", "Currency Converter", "Convert common currencies", "💱", "green"),
      localized("房贷计算", "估算月供与利息", "Mortgage Calculator", "Estimate payments and interest", "🏠", "blue"),
      localized("小费计算", "分摊账单与小费", "Tip Calculator", "Split bills and calculate tips", "🧾", "teal"),
      localized("日期计算", "计算日期间隔与偏移", "Date Calculator", "Calculate date ranges and offsets", "📅", "red"),
      localized("公式本", "保存并复用常用公式", "Formula Pad", "Save and reuse common formulas", "🧠", "graphite"),
    ],
  },
  {
    keywords: ["笔记", "备忘", "清单", "待办", "任务", "看板", "note", "memo", "todo", "task", "checklist", "kanban", "planner", "project"],
    suggestions: [
      localized("备忘录", "快速记录想法", "Notes", "Capture ideas quickly", "📝", "orange"),
      localized("待办清单", "记录任务并勾选完成", "To-do List", "Track tasks and mark them complete", "✅", "green"),
      localized("灵感便签", "收集零散灵感", "Idea Notes", "Collect quick ideas", "💡", "orange"),
      localized("每日计划", "安排今天的重要事项", "Daily Planner", "Plan the important parts of your day", "📋", "blue"),
      localized("会议记录", "整理会议要点与行动项", "Meeting Notes", "Capture decisions and action items", "👥", "purple"),
      localized("习惯清单", "按天追踪重复习惯", "Habit Checklist", "Track recurring daily habits", "🔄", "teal"),
      localized("项目看板", "按状态组织工作项", "Project Board", "Organize work by status", "🗃️", "graphite"),
      localized("稍后阅读", "保存稍后处理的内容", "Read Later", "Save items to revisit later", "📚", "red"),
    ],
  },
  {
    keywords: ["计时", "倒计时", "秒表", "番茄", "专注", "timer", "stopwatch", "pomodoro", "focus"],
    suggestions: [
      localized("专注计时", "番茄钟与专注记录", "Focus Timer", "Pomodoro sessions and focus history", "⏱️", "red"),
      localized("倒计时", "为重要时刻设置倒计时", "Countdown", "Count down to important moments", "⌛", "orange"),
      localized("秒表", "计圈与精确计时", "Stopwatch", "Precise timing with laps", "⏲️", "blue"),
      localized("世界时钟", "查看多个城市时间", "World Clock", "Track time across cities", "🌍", "blue"),
      localized("会议计时", "控制议程与发言时间", "Meeting Timer", "Keep agendas and speakers on time", "🗣️", "purple"),
      localized("间歇训练", "自定义运动间隔", "Interval Timer", "Custom workout intervals", "🏃", "green"),
      localized("休息提醒", "定时提醒活动与休息", "Break Reminder", "Schedule movement and rest breaks", "🧘", "teal"),
      localized("时间记录", "追踪任务所用时间", "Time Tracker", "Track time spent on tasks", "🕒", "graphite"),
    ],
  },
  {
    keywords: ["天气", "气温", "降雨", "空气质量", "weather", "forecast", "temperature", "rain"],
    suggestions: [
      localized("天气", "当前天气与未来预报", "Weather", "Current conditions and forecast", "🌤️", "blue"),
      localized("逐小时天气", "查看全天温度与降雨", "Hourly Weather", "Hourly temperature and rain", "🌦️", "blue"),
      localized("空气质量", "查看空气质量与建议", "Air Quality", "Air quality readings and guidance", "🍃", "green"),
      localized("降雨雷达", "查看附近降雨趋势", "Rain Radar", "Nearby rain trends", "🌧️", "teal"),
      localized("穿衣建议", "按天气推荐穿搭", "What to Wear", "Clothing suggestions for the weather", "🧥", "purple"),
      localized("日出日落", "查看晨昏与黄金时刻", "Sun Times", "Sunrise, sunset, and golden hour", "🌅", "orange"),
      localized("旅行天气", "对比目的地天气", "Travel Weather", "Compare weather across destinations", "🧳", "pink"),
      localized("气象记录", "记录与比较历史天气", "Weather Log", "Record and compare past weather", "📊", "graphite"),
    ],
  },
  {
    keywords: ["翻译", "词典", "单词", "语言", "translate", "translation", "dictionary", "language", "word"],
    suggestions: [
      localized("翻译", "快速翻译文本", "Translator", "Translate text quickly", "🌐", "blue"),
      localized("词典", "查词、释义与例句", "Dictionary", "Definitions and examples", "📖", "graphite"),
      localized("双语对照", "逐段查看双语文本", "Bilingual Reader", "Read text side by side", "🈯", "red"),
      localized("生词本", "收藏并复习新词", "Vocabulary Book", "Save and review new words", "📚", "orange"),
      localized("语法检查", "检查语法与表达", "Grammar Checker", "Review grammar and phrasing", "✍️", "green"),
      localized("短语手册", "常用场景短语速查", "Phrasebook", "Useful phrases by situation", "💬", "teal"),
      localized("术语表", "维护团队专用词汇", "Glossary", "Maintain shared terminology", "🔤", "purple"),
      localized("发音练习", "按音节练习发音", "Pronunciation", "Practice pronunciation by syllable", "🎙️", "pink"),
    ],
  },
  {
    keywords: ["颜色", "配色", "色板", "设计", "取色", "color", "colour", "palette", "design", "picker"],
    suggestions: [
      localized("色板", "创建与保存配色方案", "Color Palette", "Create and save color palettes", "🎨", "pink"),
      localized("取色器", "查看颜色代码与格式", "Color Picker", "Inspect colors and code values", "🖌️", "purple"),
      localized("渐变生成", "组合并预览颜色渐变", "Gradient Maker", "Build and preview gradients", "🌈", "pink"),
      localized("对比度检查", "检查文字颜色可读性", "Contrast Checker", "Check text color readability", "◐", "graphite"),
      localized("字体预览", "对比字体与字号组合", "Type Preview", "Compare type and size combinations", "🔤", "blue"),
      localized("间距标尺", "规划界面尺寸与间距", "Spacing Scale", "Plan interface spacing and sizes", "📏", "teal"),
      localized("图标目录", "整理与搜索常用图标", "Icon Library", "Organize and search icons", "🔷", "orange"),
      localized("设计令牌", "管理颜色字体与尺寸", "Design Tokens", "Manage colors, type, and sizing", "🧩", "green"),
    ],
  },
  {
    keywords: ["记账", "预算", "账单", "汇率", "财务", "股票", "budget", "finance", "expense", "bill", "currency", "stock"],
    suggestions: [
      localized("记账本", "记录收入与支出", "Expense Tracker", "Track income and spending", "💰", "green"),
      localized("预算", "规划每月可用金额", "Budget", "Plan monthly spending", "📊", "blue"),
      localized("账单提醒", "追踪账单与到期日", "Bill Reminder", "Track bills and due dates", "🧾", "orange"),
      localized("汇率", "查看常用货币汇率", "Exchange Rates", "Check common currency rates", "💱", "teal"),
      localized("储蓄目标", "规划并追踪储蓄进度", "Savings Goals", "Plan and track savings", "🎯", "green"),
      localized("分账", "多人账单快速分摊", "Split Expenses", "Split shared expenses", "👛", "purple"),
      localized("投资组合", "汇总资产与收益", "Portfolio", "Summarize assets and returns", "📈", "blue"),
      localized("订阅管理", "查看周期订阅支出", "Subscriptions", "Review recurring subscriptions", "🔁", "red"),
    ],
  },
  {
    keywords: ["代码", "开发", "正则", "json", "api", "programming", "developer", "code", "regex"],
    suggestions: [
      localized("JSON 工具", "格式化与检查 JSON", "JSON Tools", "Format and validate JSON", "🧩", "graphite"),
      localized("正则测试", "实时测试正则表达式", "Regex Tester", "Test regular expressions live", "🔣", "purple"),
      localized("代码片段", "整理常用代码片段", "Code Snippets", "Organize reusable snippets", "💻", "blue"),
      localized("时间戳转换", "转换时间戳与日期", "Timestamp Converter", "Convert timestamps and dates", "🕓", "teal"),
      localized("Base64 工具", "编码与解码文本", "Base64 Tools", "Encode and decode text", "🔐", "orange"),
      localized("API 草稿", "组织请求参数与响应", "API Scratchpad", "Organize requests and responses", "🔌", "green"),
      localized("差异对比", "逐行比较两段文本", "Diff Viewer", "Compare two texts line by line", "↔️", "red"),
      localized("Cron 助手", "创建与解释 Cron 表达式", "Cron Helper", "Build and explain cron expressions", "⚙️", "graphite"),
    ],
  },
  {
    keywords: ["健康", "运动", "习惯", "饮水", "睡眠", "health", "fitness", "habit", "water", "sleep"],
    suggestions: [
      localized("习惯追踪", "记录每日习惯", "Habit Tracker", "Track daily habits", "✅", "green"),
      localized("饮水提醒", "记录饮水并定时提醒", "Water Reminder", "Track water and get reminders", "💧", "blue"),
      localized("睡眠记录", "记录作息与睡眠时长", "Sleep Log", "Track sleep schedules and duration", "🌙", "purple"),
      localized("运动日志", "记录训练项目与进度", "Workout Log", "Track workouts and progress", "🏋️", "red"),
      localized("呼吸练习", "跟随节奏放松呼吸", "Breathing", "Relax with guided breathing", "🫁", "teal"),
      localized("步数目标", "设置并追踪步数目标", "Step Goals", "Set and track step goals", "👟", "orange"),
      localized("心情日记", "记录每天的情绪", "Mood Journal", "Record your daily mood", "🙂", "pink"),
      localized("健康看板", "汇总个人健康趋势", "Health Dashboard", "Review personal health trends", "❤️", "red"),
    ],
  },
];

const STYLE_SUFFIXES: Record<
  FastSuggestionStyle,
  { zh: readonly [string, string][]; en: readonly [string, string][] }
> = {
  system: {
    zh: [["工作台", "集中处理相关信息"], ["助手", "快速完成常用操作"], ["看板", "汇总关键状态"], ["资料库", "分类整理相关内容"], ["追踪器", "持续记录变化"], ["计划", "规划下一步行动"]],
    en: [["Workspace", "Handle related information in one place"], ["Assistant", "Complete common actions quickly"], ["Dashboard", "Summarize key status"], ["Library", "Organize related content"], ["Tracker", "Track changes over time"], ["Planner", "Plan the next actions"]],
  },
  appstore: {
    zh: [["专业版", "提供更完整的日常工作流"], ["中心", "在一个界面集中管理"], ["管家", "自动整理常用事项"], ["仪表盘", "清晰展示进度与数据"], ["协作台", "组织共享信息与任务"], ["精简版", "保留核心功能快速使用"]],
    en: [["Pro", "A more complete everyday workflow"], ["Hub", "Manage everything in one place"], ["Manager", "Organize common tasks"], ["Dashboard", "Show progress and data clearly"], ["Teamspace", "Organize shared information and tasks"], ["Lite", "The essential workflow, kept simple"]],
  },
  indie: {
    zh: [["小站", "小而专注的实用工具"], ["实验室", "灵活探索不同方案"], ["口袋助手", "随手完成核心任务"], ["快捷台", "减少重复操作"], ["灵感板", "收集并组织新想法"], ["极简版", "用最少步骤完成任务"]],
    en: [["Studio", "A small, focused utility"], ["Lab", "Explore flexible approaches"], ["Pocket", "Keep the core workflow close"], ["Quickdesk", "Reduce repetitive steps"], ["Idea Board", "Collect and organize new ideas"], ["Minimal", "Finish the task in fewer steps"]],
  },
  fantasy: {
    zh: [["实验室", "用可交互方式探索新可能"], ["模拟器", "模拟不同情景与结果"], ["星图", "把复杂信息变成探索地图"], ["灵感引擎", "生成并连接意外想法"], ["未来台", "体验未来式工作流"], ["平行空间", "从多个视角展开内容"]],
    en: [["Lab", "Explore new possibilities interactively"], ["Simulator", "Simulate scenarios and outcomes"], ["Atlas", "Turn complex information into a map"], ["Idea Engine", "Generate and connect unexpected ideas"], ["Future Desk", "Try a future-facing workflow"], ["Parallel Space", "Explore content from multiple viewpoints"]],
  },
};

const STYLE_ICONS: Record<FastSuggestionStyle, readonly string[]> = {
  system: ["🧭", "🧰", "📊", "🗂️", "🎯", "⚡"],
  appstore: ["💼", "🏢", "🧱", "📈", "🤝", "🪶"],
  indie: ["🛠️", "🧪", "🎒", "🎛️", "💡", "🪄"],
  fantasy: ["🔮", "🪐", "🌌", "🧬", "🛰️", "🪞"],
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function resolveLanguage(query: string, language: FastSuggestionLanguage): "zh" | "en" {
  if (language !== "auto") return language;
  return queryLanguage(query);
}

function queryLanguage(query: string): "zh" | "en" {
  return /[\u3400-\u9fff]/u.test(query) ? "zh" : "en";
}

function matchesKeyword(query: string, keyword: string): boolean {
  if (/[\u3400-\u9fff]/u.test(keyword)) {
    return normalize(query).includes(normalize(keyword));
  }
  const escaped = keyword
    .toLowerCase()
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "[\\s\\p{P}\\p{S}]+");
  if (!escaped) return false;
  return new RegExp(
    `(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`,
    "iu",
  ).test(query);
}

function matchFamily(query: string): SuggestionFamily | null {
  let match: { family: SuggestionFamily; score: number } | null = null;
  for (const family of SUGGESTION_FAMILIES) {
    for (const keyword of family.keywords) {
      const normalizedKeyword = normalize(keyword);
      if (
        matchesKeyword(query, keyword) &&
        normalizedKeyword.length > (match?.score ?? 0)
      ) {
        match = { family, score: normalizedKeyword.length };
      }
    }
  }
  return match?.family ?? null;
}

function conciseQueryName(query: string): string | null {
  const trimmed = query.trim().replace(/\s+/g, " ");
  const subject = trimmed
    .replace(/^(?:请)?(?:帮我|给我)?(?:做|生成|创建)(?:一个|个)?/u, "")
    .replace(/^我想要?(?:一个|个)?/u, "")
    .replace(
      /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:create|build|make(?:\s+me)?)\s+(?:an?\s+)?/iu,
      "",
    )
    .replace(/^[\s,:，：]+/u, "")
    .trim();
  if (!subject) return null;
  const shortened = subject.slice(0, 36);
  if (queryLanguage(shortened) === "en" && shortened === shortened.toLowerCase()) {
    return `${shortened.charAt(0).toUpperCase()}${shortened.slice(1)}`;
  }
  return shortened;
}

function withSuffix(base: string, suffix: string, language: "zh" | "en"): string {
  const separator = language === "zh" ? "" : " ";
  const available = Math.max(1, 60 - separator.length - suffix.length);
  return `${base.slice(0, available)}${separator}${suffix}`;
}

function suffixBaseName(query: string, language: "zh" | "en"): string | null {
  const concise = conciseQueryName(query);
  if (!concise) return null;
  const stripped =
    language === "zh"
      ? concise.replace(/(?:管理器|助手|工具箱|工具|应用|软件|系统|平台|工作台)$/u, "").trim()
      : concise.replace(/\s+(?:app|application|tool|manager|assistant|system|platform|software)$/iu, "").trim();
  return stripped || concise;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export type FastGenAppSuggestionInput = {
  query: string;
  count?: number;
  language?: FastSuggestionLanguage;
  style?: FastSuggestionStyle;
};

export function createFastGenAppSuggestionSeeds(
  input: FastGenAppSuggestionInput,
): FastGenAppSuggestionSeed[] {
  const query = input.query.trim();
  if (!query) return [];
  const count = clampSuggestionCount(input.count);
  const language = resolveLanguage(query, input.language ?? "auto");
  const keepQueryName =
    input.language === undefined ||
    input.language === "auto" ||
    language === queryLanguage(query);
  const style = input.style ?? "system";
  const family = matchFamily(query);
  const candidates: SuggestionCopy[] = [];
  const exactName = keepQueryName ? conciseQueryName(query) : null;

  if (exactName) {
    candidates.push({
      name: exactName,
      description:
        language === "zh" ? "按当前需求生成可交互应用" : "Generate an interactive app for this request",
      iconEmoji: "✨",
      iconTheme: family?.suggestions[0]?.[language].iconTheme ?? "blue",
    });
  }
  const familyCandidates = family?.suggestions.map((item) => item[language]) ?? [];
  const primaryFamilyCount =
    style === "system" ? familyCandidates.length : style === "appstore" ? 2 : 1;

  const genericBase =
    (keepQueryName ? suffixBaseName(query, language) : null) ??
    family?.suggestions[0]?.[language].name ??
    (language === "zh" ? "智能工具" : "Smart Tool");
  const themes: readonly GenAppIconTheme[] = ["blue", "purple", "teal", "green", "orange", "pink"];
  const styleOrder = [
    style,
    ...(["system", "appstore", "indie", "fantasy"] as const).filter(
      (candidateStyle) => candidateStyle !== style,
    ),
  ];
  const styleCandidates = (
    candidateStyle: FastSuggestionStyle,
  ): SuggestionCopy[] =>
    STYLE_SUFFIXES[candidateStyle][language].map(
      ([suffix, description], index) => ({
        name: withSuffix(genericBase, suffix, language),
        description,
        iconEmoji: STYLE_ICONS[candidateStyle][index],
        iconTheme: themes[index],
      }),
    );
  if (style === "system") {
    candidates.push(...familyCandidates);
    candidates.push(...styleCandidates(style));
  } else {
    // 小数量设置也必须体现 creativity，同时保留一个直接相关的基础候选。
    const preferredStyleCandidates = styleCandidates(style);
    candidates.push(preferredStyleCandidates[0]);
    candidates.push(...familyCandidates.slice(0, primaryFamilyCount));
    candidates.push(...preferredStyleCandidates.slice(1));
  }
  for (const candidateStyle of styleOrder.slice(1)) {
    candidates.push(...styleCandidates(candidateStyle));
  }
  candidates.push(...familyCandidates.slice(primaryFamilyCount));

  const seenNames = new Set<string>();
  const seenIcons = new Set<string>();
  const unique = candidates.filter((candidate) => {
    const key = normalize(candidate.name);
    if (!key || seenNames.has(key) || seenIcons.has(candidate.iconEmoji)) return false;
    seenNames.add(key);
    seenIcons.add(candidate.iconEmoji);
    return true;
  });
  return unique.slice(0, count);
}

export function createFastGenAppSuggestions(
  input: FastGenAppSuggestionInput,
): GenAppSuggestion[] {
  const queryKey = normalize(input.query);
  return createFastGenAppSuggestionSeeds(input).map((candidate) => ({
    id: `fast-${stableHash(`${queryKey}|${normalize(candidate.name)}`)}`,
    ...candidate,
  }));
}
