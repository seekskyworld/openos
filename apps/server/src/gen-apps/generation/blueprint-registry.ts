import type { UntrustedArtifact } from "../domain.js";

export type BlueprintResult = {
  intentKey: string;
  artifact: UntrustedArtifact;
};

type BlueprintInput = {
  query: string;
  name: string;
  description: string;
  language: "auto" | "zh" | "en";
  creativity: number;
};

const INTENT_KEYWORDS: Array<[string, readonly string[]]> = [
  ["calculator", ["计算", "计算器", "calculator", "math", "formula"]],
  ["tasks", ["待办", "任务", "清单", "todo", "task", "kanban", "planner"]],
  ["notes", ["笔记", "备忘", "note", "memo", "journal"]],
  ["timer", ["计时", "倒计时", "秒表", "番茄", "timer", "stopwatch", "pomodoro"]],
  ["browser", ["浏览器", "网页", "搜索", "browser", "web", "search"]],
  ["weather", ["天气", "气温", "weather", "forecast", "rain"]],
  ["translator", ["翻译", "词典", "语言", "translate", "dictionary"]],
  ["finance", ["记账", "预算", "账单", "财务", "budget", "finance", "expense"]],
  ["design", ["颜色", "配色", "色板", "设计", "color", "palette", "design"]],
  ["developer", ["代码", "开发", "json", "api", "regex", "developer", "code"]],
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function findIntent(input: BlueprintInput): string | null {
  const haystack = `${input.query} ${input.name} ${input.description}`.toLocaleLowerCase();
  let best: { key: string; score: number } | null = null;
  for (const [key, keywords] of INTENT_KEYWORDS) {
    let score = 0;
    for (const keyword of keywords) {
      if (haystack.includes(keyword.toLocaleLowerCase())) score += keyword.length;
    }
    if (score > (best?.score ?? 0)) best = { key, score };
  }
  return best?.key ?? null;
}

function composeMarkup(input: BlueprintInput, intentKey: string): string {
  const title = escapeHtml(input.name.trim() || "Generated App");
  const description = escapeHtml(input.description.trim());
  const query = escapeHtml(input.query.trim());
  const isEnglish = input.language === "en" ||
    (input.language === "auto" && !/[\u3400-\u9fff]/u.test(input.query));
  const addLabel = isEnglish ? "Add" : "添加";
  const inputPlaceholder = isEnglish ? "Enter something" : "输入内容";
  const status = isEnglish ? `Blueprint: ${intentKey}` : `蓝图：${intentKey}`;
  const listPanel = `<div class="field-row">
      <input id="entry" class="os-input" type="text" placeholder="${inputPlaceholder}" data-source="entry">
      <button id="add" class="os-button os-primary" type="button" data-action="list.add" data-target="items" data-source="entry">${addLabel}</button>
    </div>
    <div id="items" class="os-list" data-query="${query}">
      <div id="item-1" class="os-list-item" data-action="list.toggle">${description || title}</div>
    </div>`;
  const panels: Record<string, string> = {
    calculator: `<output id="display" class="os-heading" data-expression="0">0</output>
      <div class="os-grid" id="keys">
        <button id="key-clear" class="os-button os-danger" type="button" data-action="calc.clear" data-target="display">AC</button>
        <button id="key-7" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="7">7</button>
        <button id="key-8" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="8">8</button>
        <button id="key-plus" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="+">+</button>
        <button id="key-equals" class="os-button os-primary" type="button" data-action="calc.evaluate" data-target="display">=</button>
      </div>`,
    tasks: listPanel,
    notes: `<textarea id="note" class="os-textarea" rows="8" placeholder="${inputPlaceholder}" data-action="state.set" data-key="note"></textarea>
      <button id="save-note" class="os-button os-primary" type="button" data-action="toast" data-value="${isEnglish ? "Saved" : "已保存"}">${isEnglish ? "Save" : "保存"}</button>`,
    timer: `<output id="timer-value" class="os-heading">25:00</output>
      <div class="field-row"><button id="timer-start" class="os-button os-primary" type="button" data-action="toast" data-value="${isEnglish ? "Timer started" : "计时已开始"}">${isEnglish ? "Start" : "开始"}</button>
      <button id="timer-reset" class="os-button" type="button" data-action="state.set" data-target="timer-value" data-value="25:00">${isEnglish ? "Reset" : "重置"}</button></div>`,
    browser: `<div class="field-row"><input id="address" class="os-search" type="search" placeholder="${isEnglish ? "Search or enter address" : "搜索或输入地址"}">
      <button id="navigate" class="os-button os-primary" type="button" data-action="ai.patch" data-target="browser-results" data-source="address">${isEnglish ? "Go" : "前往"}</button></div>
      <section id="browser-results" class="os-card"><h2 class="os-subheading">${title}</h2><p>${description}</p></section>`,
    weather: `<div id="weather-now" class="os-card"><strong class="os-heading">22°</strong><p>${isEnglish ? "Clear · comfortable" : "晴朗 · 体感舒适"}</p></div>
      <div id="weather-days" class="os-list"><div class="os-list-item">${isEnglish ? "Tomorrow 21°" : "明天 21°"}</div><div class="os-list-item">${isEnglish ? "Next day 19°" : "后天 19°"}</div></div>`,
    translator: `<textarea id="source-text" class="os-textarea" rows="5" placeholder="${inputPlaceholder}"></textarea>
      <button id="translate" class="os-button os-primary" type="button" data-action="ai.patch" data-target="translation" data-source="source-text">${isEnglish ? "Translate" : "翻译"}</button>
      <section id="translation" class="os-card"><p>${isEnglish ? "Translation appears here" : "译文将在这里显示"}</p></section>`,
    finance: `<div class="os-list" id="transactions"><div class="os-list-item"><span>${isEnglish ? "Current balance" : "当前结余"}</span><strong>¥8,240</strong></div><div class="os-list-item"><span>${isEnglish ? "Monthly budget" : "本月预算"}</span><strong>¥5,000</strong></div></div>${listPanel}`,
    design: `<div class="field-row"><input id="color" type="color" value="#377cf6"><output id="color-code" class="os-badge">#377CF6</output></div>
      <div id="palette" class="os-grid"><div class="os-card">Primary</div><div class="os-card">Surface</div><div class="os-card">Accent</div></div>`,
    developer: `<textarea id="developer-input" class="os-textarea" rows="7" placeholder="JSON / Regex / API"></textarea>
      <button id="format-code" class="os-button os-primary" type="button" data-action="ai.patch" data-target="developer-output" data-source="developer-input">${isEnglish ? "Run" : "运行"}</button>
      <pre id="developer-output" class="os-card">{}</pre>`,
    generic: listPanel,
  };
  const panel = panels[intentKey] ?? listPanel;
  return `<main class="os-app os-column">
    <header class="os-toolbar" id="app-header"><strong class="os-toolbar-title">${title}</strong><span class="os-badge">${status}</span></header>
    <section class="os-main os-fill" id="app-panel">
      <div class="os-card os-column" id="app-card"><p id="app-description" class="os-caption">${description}</p>${panel}
        <button id="ai-explain" class="os-button" type="button" data-action="ai.patch" data-target="app-panel">${isEnglish ? "AI update" : "AI 更新"}</button>
      </div>
    </section>
  </main>`;
}

/** 高频意图的本地骨架；未知、fantasy 和复杂需求交给 Instant/Agentic。 */
export function resolveBlueprint(input: BlueprintInput): BlueprintResult | null {
  if (input.creativity > 50) return null;
  const intentKey = findIntent(input);
  if (!intentKey) return null;
  return {
    intentKey,
    artifact: {
      html: composeMarkup(input, intentKey),
      provider: "openos-blueprint",
      model: `blueprint-${intentKey}`,
      interactionMode: "hybrid",
    },
  };
}

export function createFallbackBlueprint(input: BlueprintInput): BlueprintResult {
  return {
    intentKey: "generic",
    artifact: {
      html: composeMarkup(input, "generic"),
      provider: "openos-blueprint",
      model: "blueprint-generic",
      interactionMode: "hybrid",
    },
  };
}
