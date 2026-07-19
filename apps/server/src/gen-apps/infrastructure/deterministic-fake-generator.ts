import {
  createFastGenAppSuggestionSeeds,
  type FastGenAppSuggestionInput,
} from "@openos/shared";
import type {
  ContinuePortInput,
  GenAppGenerator,
  GeneratePortInput,
  SuggestPortInput,
} from "../ports.js";
import type { UntrustedArtifact, UntrustedSuggestion } from "../domain.js";
import { ProgressiveHtmlAssembler } from "../generation/progressive-html-stream.js";

function escapeMarkup(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDeterministicStageBlocks(input: GeneratePortInput): string[] {
  const name = escapeMarkup(input.name.trim() || "Generated App");
  const description = escapeMarkup(input.description.trim() || input.query.trim());
  const query = escapeMarkup(input.query.trim());
  return [
    `<!--openos:stage:shell--><main class="os-app os-column">
  <header class="os-toolbar" id="app-header"><strong class="os-toolbar-title">${name}</strong><span class="os-badge">Fake</span></header>
  <section id="calculator-panel"><section id="app-core"></section><section id="app-content"></section><footer id="app-actions"></footer></section>
</main><!--openos:end-->`,
    `<!--openos:stage:core:app-core--><section class="os-main os-fill" id="app-core">
  <div class="os-card os-column" id="calculator">
      <p id="app-description" class="os-caption">${description}</p>
      <output id="display" class="os-heading" data-expression="0">0</output>
  </div>
</section><!--openos:end-->`,
    `<!--openos:stage:content:app-content--><section class="os-main" id="app-content"><div class="os-grid" id="keys">
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
      </div></section><!--openos:end-->`,
    `<!--openos:stage:actions:app-actions--><footer class="os-main os-row" id="app-actions"><button id="ai-explain" class="os-button" type="button" data-action="ai.patch" data-target="calculator-panel" data-prompt="解释当前计算器的使用方式">AI 说明</button><p id="source-query" class="os-caption">${query}</p></footer><!--openos:end-->`,
  ];
}

export class DeterministicFakeGenerator implements GenAppGenerator {
  constructor(
    private readonly suggestionSettings: () => Pick<
      FastGenAppSuggestionInput,
      "language" | "style"
    > = () => ({}),
  ) {}

  async suggest(
    input: SuggestPortInput,
    signal: AbortSignal,
  ): Promise<UntrustedSuggestion[]> {
    signal.throwIfAborted();
    return createFastGenAppSuggestionSeeds({
      ...input,
      ...this.suggestionSettings(),
    });
  }

  async generate(
    input: GeneratePortInput,
    _signal: AbortSignal,
  ): Promise<UntrustedArtifact> {
    const assembler = new ProgressiveHtmlAssembler();
    input.onPhase?.({ phase: "generating-html" });
    for (const block of buildDeterministicStageBlocks(input)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      for (const snapshot of assembler.push(block)) {
        input.onSnapshot?.(snapshot);
        input.onPhase?.({ phase: `html-${snapshot.stage}` });
      }
    }
    const markup = assembler.latestMarkup();
    if (!markup || assembler.latestStage() !== "actions") {
      throw new Error(`Deterministic progressive HTML failed: ${assembler.latestFailure() ?? "incomplete stages"}`);
    }
    return {
      html: markup,
      provider: "fake",
      model: "deterministic-v2",
      interactionMode:
        this.suggestionSettings().style === "fantasy" ? "improv" : "hybrid",
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
