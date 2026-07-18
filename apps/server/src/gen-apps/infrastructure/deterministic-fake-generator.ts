import type {
  ContinuePortInput,
  GenAppGenerator,
  GeneratePortInput,
  SuggestPortInput,
} from "../ports.js";
import type { UntrustedArtifact, UntrustedSuggestion } from "../domain.js";

const SUGGESTION_POOL = [
  { suffix: "计算器", emoji: "🧮", theme: "orange", desc: "四则运算与百分比" },
  { suffix: "记事本", emoji: "📝", theme: "blue", desc: "快速记录想法" },
  { suffix: "计时器", emoji: "⏱️", theme: "green", desc: "倒计时与秒表" },
  { suffix: "清单", emoji: "✅", theme: "teal", desc: "待办与勾选" },
  { suffix: "转换器", emoji: "🔁", theme: "purple", desc: "单位换算" },
  { suffix: "取色器", emoji: "🎨", theme: "pink", desc: "颜色预览与代码" },
] as const;

const CALCULATOR_MARKUP = `<main class="os-app os-column">
  <header class="os-toolbar" id="app-header"><strong class="os-toolbar-title">计算器</strong><span class="os-badge">Local</span></header>
  <section class="os-main os-fill" id="calculator-panel">
    <div class="os-card os-column" id="calculator">
      <output id="display" class="os-heading" data-expression="0">0</output>
      <div class="os-grid" id="keys">
        <button id="key-clear" class="os-button os-danger" type="button" data-action="calc.clear" data-target="display">AC</button>
        <button id="key-7" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="7">7</button>
        <button id="key-8" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="8">8</button>
        <button id="key-9" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="9">9</button>
        <button id="key-divide" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="÷">÷</button>
        <button id="key-4" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="4">4</button>
        <button id="key-5" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="5">5</button>
        <button id="key-6" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="6">6</button>
        <button id="key-times" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="×">×</button>
        <button id="key-1" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="1">1</button>
        <button id="key-2" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="2">2</button>
        <button id="key-3" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="3">3</button>
        <button id="key-minus" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="-">−</button>
        <button id="key-0" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="0">0</button>
        <button id="key-dot" class="os-button" type="button" data-action="calc.input" data-target="display" data-value=".">.</button>
        <button id="key-equals" class="os-button os-primary" type="button" data-action="calc.evaluate" data-target="display">=</button>
        <button id="key-plus" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="+">+</button>
      </div>
      <button id="ai-explain" class="os-button" type="button" data-action="ai.patch" data-target="calculator-panel" data-prompt="解释当前计算器的使用方式">AI 说明</button>
    </div>
  </section>
</main>`;

export class DeterministicFakeGenerator implements GenAppGenerator {
  async suggest(
    input: SuggestPortInput,
    _signal: AbortSignal,
  ): Promise<UntrustedSuggestion[]> {
    const base = input.query.trim();
    return SUGGESTION_POOL.slice(0, input.count).map((item) => ({
      name: `${base}${item.suffix}`,
      description: item.desc,
      iconEmoji: item.emoji,
      iconTheme: item.theme,
    }));
  }

  async generate(
    input: GeneratePortInput,
    _signal: AbortSignal,
  ): Promise<UntrustedArtifact> {
    if (input.onDelta) {
      input.onPhase?.({ phase: "generating" });
      const chunkSize = 320;
      for (let index = 0; index < CALCULATOR_MARKUP.length; index += chunkSize) {
        input.onDelta(CALCULATOR_MARKUP.slice(index, index + chunkSize));
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    return {
      html: CALCULATOR_MARKUP,
      provider: "fake",
      model: "deterministic-v2",
      interactionMode: "hybrid",
    };
  }

  async continueContent(
    input: ContinuePortInput,
    _signal: AbortSignal,
  ): Promise<string> {
    const users = input.messages.filter((message) => message.role === "user");
    const last = String(users.at(-1)?.content ?? "");
    const patchTurn = [...users]
      .reverse()
      .find((message) => message.content.includes("openos-patch-batch"));
    if (patchTurn) {
      let baseRevision = 0;
      let targetId = "calculator-panel";
      try {
        const payload = JSON.parse(patchTurn.content) as {
          baseRevision?: number;
          patchTarget?: { id?: string };
        };
        baseRevision = Number(payload.baseRevision ?? 0);
        targetId = String(payload.patchTarget?.id ?? targetId);
      } catch {
        // 确定性 fake 的异常输入仍交给服务端补丁校验处理。
      }
      return JSON.stringify({
        baseRevision,
        ops: [
          {
            op: "replace",
            targetId,
            html: `<section id="${targetId}" class="os-card"><h3 class="os-subheading">AI update</h3><p>确定性补丁已应用。</p></section>`,
          },
        ],
      });
    }
    return [
      '<section class="os-card" id="fake-content">',
      `<h3 class="os-subheading">Fake ${input.intent} · turn ${users.length}</h3>`,
      `<p>${last.slice(0, 120)}</p>`,
      '<button id="fake-next" class="os-button" type="button" data-action="ai.generate" data-href="fake://next">继续</button>',
      "</section>",
    ].join("");
  }
}
