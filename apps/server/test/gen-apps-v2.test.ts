import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  buildGenAppRuntimeDocument,
  createFastGenAppSuggestions,
  GEN_APP_FORMAT,
  GEN_APP_LEGACY_FORMAT,
  GEN_APP_LIMITS,
  parseGenAppArtifact,
  parseGenAppSuggestion,
  canonicalizeAppIr,
  createAppIrCacheKey,
  parseAppIr,
  validateAppIr,
} from "@openos/shared";
import { compileArtifact, compileFragment } from "../src/gen-apps/artifact-compiler.js";
import { compileAppIr } from "../src/gen-apps/app-ir-compiler.js";
import { brandValidated } from "../src/gen-apps/domain.js";
import { GenAppsService } from "../src/gen-apps/gen-apps-service.js";
import { DeterministicFakeGenerator } from "../src/gen-apps/infrastructure/deterministic-fake-generator.js";
import { SqliteGenAppRepository } from "../src/gen-apps/infrastructure/sqlite-gen-app-repository.js";
import {
  compileReplacementMarkup,
  extractMarkupElement,
  replaceMarkupElement,
  resolveMarkupInteraction,
  sanitizeGenAppMarkup,
  validateGenAppMarkup,
} from "../src/gen-apps/markup-artifact.js";
import type { GenAppGenerator } from "../src/gen-apps/ports.js";
import { parseRuntimePatchProposal } from "../src/gen-apps/runtime-patch.js";
import { RuntimeSessionStore } from "../src/gen-apps/runtime-session-store.js";
import { RuntimeInteractionCoordinator } from "../src/gen-apps/runtime-interaction.js";
import { createOpenOsDatabaseAt } from "../src/database/openos-database.js";
import { loadServerEnv } from "../src/env.js";
import { LlmGenAppGenerator } from "../src/gen-apps/infrastructure/llm-gen-app-generator.js";
import { GenerationOrchestrator } from "../src/gen-apps/generation/generation-orchestrator.js";
import { InMemoryGenerationCache } from "../src/gen-apps/infrastructure/in-memory-generation-cache.js";
import { BingRssWebSearchProvider } from "../src/gen-apps/infrastructure/bing-rss-web-search-provider.js";
import {
  extractReadableWebPage,
  SafeWebPageProvider,
} from "../src/gen-apps/infrastructure/safe-web-page-provider.js";
import type { WebPageProvider, WebSearchProvider } from "../src/gen-apps/ports.js";
import { InFlightGenerationRegistry } from "../src/gen-apps/generation/in-flight-generation.js";
import { createGenerationFingerprint } from "../src/gen-apps/generation/fingerprint.js";
import { resolveAppRecipe } from "../src/gen-apps/generation/app-recipe.js";
import {
  clampAgentMaxRounds,
  loadGenAppsSettings,
} from "../src/gen-apps/gen-app-settings.js";

const context = () => ({
  requestId: "test-request",
  signal: new AbortController().signal,
});

const validAppIr = () => ({
  protocolVersion: "openos-appir/v1" as const,
  catalogVersion: "catalog-v1",
  identity: { family: "tool", variant: "notes", title: "Notes" },
  root: "root",
  components: {
    root: { type: "surface", children: ["title", "save"] },
    title: { type: "text", props: { value: "Notes" } },
    save: { type: "button", actionIds: ["save"] },
  },
  data: { note: "" },
  actions: { save: { kind: "local" as const, name: "state.save" } },
});

test("AppIR validates model output and creates stable canonical cache keys", () => {
  const value = validAppIr();
  assert.deepEqual(validateAppIr(value), []);
  assert.equal(parseAppIr(value)?.root, "root");
  const reordered = { ...value, components: { save: value.components.save, root: value.components.root, title: value.components.title } };
  assert.equal(createAppIrCacheKey(value), createAppIrCacheKey(reordered));
  assert.deepEqual(canonicalizeAppIr(value).components, canonicalizeAppIr(reordered).components);
});

test("AppIR rejects invalid references and unsupported model actions", () => {
  const invalid = validAppIr();
  invalid.root = "missing root";
  invalid.components.root.props = { script: "javascript:alert(1)" };
  invalid.actions.save = { kind: "unsupported" as never, name: "run" };
  const issues = validateAppIr(invalid);
  assert.ok(issues.some((issue) => issue.path === "/root"));
  assert.ok(issues.some((issue) => issue.path === "/actions/save"));
});

test("AppIR compiler emits V2 markup without executing model code", () => {
  const artifact = compileAppIr(validAppIr());
  assert.equal(artifact.provider, "openos-appir");
  assert.match(artifact.html, /class="os-app os-column"/);
  assert.match(artifact.html, /data-action="state\.save"/);
  assert.doesNotMatch(artifact.html, /<script/i);
});

test("suggestions are complete without waiting for an LLM provider", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openos-fast-suggestions-test-"));
  try {
    const generator = new LlmGenAppGenerator(
      loadServerEnv({
        dataDir: directory,
        llm: {
          provider: "openai-compatible",
          baseUrl: "http://127.0.0.1:1/v1",
          apiKey: "",
          model: "intentionally-unavailable",
        },
      }),
    );
    const startedAt = performance.now();
    const suggestions = await generator.suggest(
      { query: "谷歌浏览器", count: 6 },
      new AbortController().signal,
    );
    const durationMs = performance.now() - startedAt;

    assert.equal(suggestions.length, 6);
    assert.equal(new Set(suggestions.map((item) => item.name)).size, 6);
    assert(suggestions.some((item) => String(item.name).includes("浏览器")));
    assert(durationMs < 100, `suggestions took ${durationMs.toFixed(1)}ms`);

    const longList = await generator.suggest(
      { query: "quantum garden manager", count: 12 },
      new AbortController().signal,
    );
    assert.equal(longList.length, 12);
    assert.equal(new Set(longList.map((item) => item.name)).size, 12);
    assert(longList.some((item) => item.name === "Quantum garden Workspace"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fast suggestion policy keeps language, style, and intent deterministic", () => {
  const forcedChinese = createFastGenAppSuggestions({
    query: "calculator",
    count: 2,
    language: "zh",
  });
  assert.deepEqual(
    forcedChinese.map((item) => item.name),
    ["计算器", "科学计算器"],
  );

  const systemCalculator = createFastGenAppSuggestions({
    query: "calculator",
    count: 6,
    style: "system",
  });
  const fantasyCalculator = createFastGenAppSuggestions({
    query: "calculator",
    count: 6,
    style: "fantasy",
  });
  assert.notDeepEqual(
    fantasyCalculator.map((item) => item.name),
    systemCalculator.map((item) => item.name),
  );
  assert(fantasyCalculator.some((item) => item.name.includes("Simulator")));
  const minimalStyleNames = (["system", "appstore", "indie", "fantasy"] as const)
    .map((style) =>
      createFastGenAppSuggestions({ query: "calculator", count: 2, style })[1]
        .name,
    );
  assert.equal(new Set(minimalStyleNames).size, 4);

  const boundaryCases = ["a pie recipe", "rainbow maker", "billion counter"];
  for (const query of boundaryCases) {
    const names = createFastGenAppSuggestions({ query, count: 6 }).map(
      (item) => item.name,
    );
    assert(!names.includes("JSON Tools"), `${query} matched developer tools`);
    assert(!names.includes("Weather"), `${query} matched weather`);
    assert(!names.includes("Bill Reminder"), `${query} matched finance`);
  }
  assert(
    createFastGenAppSuggestions({ query: "web", count: 6 }).some(
      (item) => item.name === "Web Browser",
    ),
  );
  assert.equal(
    createFastGenAppSuggestions({ query: "build a kanban board", count: 6 })[0]
      .name,
    "Kanban board",
  );
  assert.equal(createFastGenAppSuggestions({ query: "扫雷", count: 6 })[0].name, "扫雷");
  assert.equal(createFastGenAppSuggestions({ query: "数独", count: 6 })[0].name, "数独");
  assert.equal(createFastGenAppSuggestions({ query: "贪吃蛇", count: 6 })[0].name, "贪吃蛇");
  assert(
    createFastGenAppSuggestions({
      query: "build a personal recipe organizer with pantry tracking",
      count: 6,
    })[0].name.includes("recipe"),
  );

  const twelveGeneric = createFastGenAppSuggestions({
    query: "quantum garden manager",
    count: 12,
    style: "indie",
  });
  assert.equal(new Set(twelveGeneric.map((item) => item.iconEmoji)).size, 12);
  assert(twelveGeneric.every((item) => parseGenAppSuggestion(item) !== null));
});

test("deterministic fake keeps the selected app identity and interaction style", async () => {
  const fake = new DeterministicFakeGenerator(() => ({
    language: "en",
    style: "fantasy",
  }));
  const artifact = await fake.generate(
    {
      query: "weather <tracker>",
      name: "Weather & Forecast",
      description: "Forecasts with <alerts>",
    },
    new AbortController().signal,
  );

  assert.equal(artifact.interactionMode, "improv");
  assert(artifact.html.includes("Weather &amp; Forecast"));
  assert(artifact.html.includes("Forecasts with &lt;alerts&gt;"));
  assert(artifact.html.includes("weather &lt;tracker&gt;"));
  assert(!artifact.html.includes("<alerts>"));
});

test("generation orchestrator composes blueprints, deduplicates misses, and reuses artifacts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openos-generation-orchestrator-test-"));
  const database = createOpenOsDatabaseAt(join(directory, "openos.sqlite"));
  try {
    const repository = new SqliteGenAppRepository(database);
    let generateCalls = 0;
    const generator: GenAppGenerator = {
      async suggest() {
        return [];
      },
      async generate(input, signal) {
        generateCalls += 1;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 20);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(signal.reason);
          }, { once: true });
        });
        return {
          html: `<main class="os-app"><section id="result"><h1>${input.name}</h1></section></main>`,
          provider: "test",
          model: "instant",
          interactionMode: "hybrid",
        };
      },
      async continueContent() {
        return "<section id=\"result\">continued</section>";
      },
    };
    const orchestrator = new GenerationOrchestrator({
      suggestionProvider: generator,
      instantGenerator: generator,
      agenticGenerator: generator,
      repository,
      cache: new InMemoryGenerationCache(),
      settings: () => ({
        language: "en",
        creativity: 60,
        profile: "instant",
        suggestionCount: 6,
        timeoutMs: 5_000,
      }),
    });
    const suggestion = {
      id: "s-quantum",
      name: "Quantum Garden",
      description: "An unfamiliar interactive garden",
      iconEmoji: "✨",
      iconTheme: "blue" as const,
    };
    const [first, joined] = await Promise.all([
      orchestrator.generateDraft(
        { suggestion, query: "quantum garden", idempotencyKey: "generation-a" },
        context(),
      ),
      orchestrator.generateDraft(
        { suggestion, query: "quantum garden", idempotencyKey: "generation-b" },
        context(),
      ),
    ]);
    assert.equal(generateCalls, 1);
    assert.notEqual(first.summary.id, joined.summary.id);
    const cached = await orchestrator.generateDraft(
      { suggestion, query: "quantum garden", idempotencyKey: "generation-c" },
      context(),
    );
    assert.equal(generateCalls, 1);
    assert(cached.artifact.markup?.includes("Quantum Garden"));
    await orchestrator.generateDraft(
      {
        suggestion,
        query: "quantum garden",
        idempotencyKey: "generation-regenerate",
        bypassCache: true,
      },
      context(),
    );
    assert.equal(generateCalls, 2);

    let blueprintGenerateCalls = 0;
    const blueprintGenerator: GenAppGenerator = {
      ...generator,
      async generate() {
        blueprintGenerateCalls += 1;
        throw new Error("blueprint should avoid the model");
      },
    };
    const blueprintOrchestrator = new GenerationOrchestrator({
      suggestionProvider: blueprintGenerator,
      instantGenerator: blueprintGenerator,
      agenticGenerator: blueprintGenerator,
      repository,
      cache: new InMemoryGenerationCache(),
      settings: () => ({
        language: "zh",
        creativity: 25,
        profile: "instant",
        suggestionCount: 6,
        timeoutMs: 5_000,
      }),
    });
    const blueprintDraft = await blueprintOrchestrator.generateDraft(
      {
        suggestion: {
          id: "s-todo",
          name: "待办清单",
          description: "记录任务",
          iconEmoji: "✅",
          iconTheme: "green",
        },
        query: "做一个待办清单",
        idempotencyKey: "blueprint-a",
      },
      context(),
    );
    assert.equal(blueprintGenerateCalls, 0);
    assert(blueprintDraft.artifact.markup?.includes('data-action="list.add"'));
    assert(!blueprintDraft.artifact.markup?.includes("AI 更新"));
    assert(!blueprintDraft.artifact.markup?.includes("AI update"));
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("generation cache expires entries and prunes least recently used artifacts", () => {
  const cache = new InMemoryGenerationCache();
  const put = (fingerprint: string, markup: string, expiresAt = 10_000) =>
    cache.put({
      fingerprint,
      intentKey: null,
      markup,
      interactionMode: "hybrid",
      provider: "test",
      model: "test",
      createdAt: 1,
      expiresAt,
    });
  put("expired", "old", 5);
  put("hot", "1234");
  put("cold", "5678");
  assert.equal(cache.get("expired", 5), null);
  assert(cache.get("hot", 20));
  assert.equal(cache.prune(21, 1, 100), 1);
  assert(cache.get("hot", 22));
  assert.equal(cache.get("cold", 22), null);

  put("large", "1234567890");
  assert.equal(cache.prune(23, 10, 5), 1);
  assert.equal(cache.get("large", 24), null);
});

test("generation fingerprint invalidates model and policy-sensitive artifacts", () => {
  const input = {
    query: "calculator",
    suggestion: {
      id: "fingerprint-id-is-ignored",
      name: "Calculator",
      description: "Local calculator",
      iconEmoji: "🧮",
      iconTheme: "orange" as const,
    },
    language: "en" as const,
    creativity: 25,
    profile: "instant" as const,
    generatorKey: "openai-compatible:https://example.test:v1:model-a",
  };
  const first = createGenerationFingerprint(input);
  assert.equal(first, createGenerationFingerprint({ ...input, creativity: 20 }));
  assert.notEqual(first, createGenerationFingerprint({ ...input, creativity: 26 }));
  assert.notEqual(
    first,
    createGenerationFingerprint({ ...input, generatorKey: "openai-compatible:https://example.test:v1:model-b" }),
  );
});

test("game recipes route common games to trusted local engines", () => {
  const cases = [
    ["经典扫雷", "game.minesweeper", "game.minesweeper.reveal"],
    ["数独游戏", "game.sudoku", "game.sudoku.input"],
    ["贪吃蛇", "game.snake", "game.snake.start"],
  ] as const;
  for (const [query, engine, action] of cases) {
    const recipe = resolveAppRecipe({
      query,
      name: query,
      description: "可玩的本地游戏",
      language: "zh",
      creativity: 80,
    });
    assert(recipe, `${query} did not resolve a recipe`);
    assert.equal(recipe.engine, engine);
    assert(recipe.artifact.html.includes(`data-engine="${engine}"`));
    assert(recipe.artifact.html.includes(`data-action="${action}"`));
    assert.equal(recipe.artifact.interactionMode, "hybrid");
    const compiled = compileArtifact(recipe.artifact);
    assert.equal(compiled.format, GEN_APP_FORMAT);
    assert(compiled.markup?.includes(`data-engine="${engine}"`));
  }
  assert.equal(resolveAppRecipe({
    query: "quantum garden",
    name: "Quantum Garden",
    description: "Unknown app",
    language: "en",
    creativity: 25,
  }), null);
});

test("generation orchestrator serves game recipes before Agentic and shares semantic cache", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openos-game-recipe-test-"));
  const database = createOpenOsDatabaseAt(join(directory, "openos.sqlite"));
  try {
    const repository = new SqliteGenAppRepository(database);
    let modelCalls = 0;
    const generator: GenAppGenerator = {
      async suggest() { return []; },
      async generate() {
        modelCalls += 1;
        throw new Error("game recipe must not call the model");
      },
      async continueContent() { return ""; },
    };
    const orchestrator = new GenerationOrchestrator({
      suggestionProvider: generator,
      instantGenerator: generator,
      agenticGenerator: generator,
      repository,
      cache: new InMemoryGenerationCache(),
      settings: () => ({
        language: "zh",
        creativity: 80,
        profile: "agentic",
        suggestionCount: 6,
        timeoutMs: 60_000,
      }),
    });
    const first = await orchestrator.generateDraft(
      {
        query: "扫雷",
        idempotencyKey: "recipe-minesweeper-a",
        suggestion: { id: "mine-a", name: "扫雷", description: "经典扫雷", iconEmoji: "💣", iconTheme: "blue" },
      },
      context(),
    );
    const cached = await orchestrator.generateDraft(
      {
        query: "生成一个经典扫雷游戏",
        idempotencyKey: "recipe-minesweeper-b",
        suggestion: { id: "mine-b", name: "经典扫雷", description: "本地棋盘游戏", iconEmoji: "💣", iconTheme: "orange" },
      },
      context(),
    );
    assert.equal(modelCalls, 0);
    assert.notEqual(first.summary.id, cached.summary.id);
    assert.equal(first.artifact.contentSha256, cached.artifact.contentSha256);
    assert(first.artifact.markup?.includes('data-engine="game.minesweeper"'));
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("in-flight generation isolates subscriber cancellation and clears failures", async () => {
  const registry = new InFlightGenerationRegistry<string>();
  const firstAbort = new AbortController();
  let starts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const start = async () => {
    starts += 1;
    await gate;
    return "done";
  };
  const cancelled = registry.run("shared", firstAbort.signal, {}, start);
  const survivor = registry.run("shared", new AbortController().signal, {}, start);
  firstAbort.abort();
  release();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal((await survivor).value, "done");
  assert.equal(starts, 1);

  let failingStarts = 0;
  const fail = () => {
    failingStarts += 1;
    return Promise.reject(new Error("failed once"));
  };
  await assert.rejects(
    registry.run("failure", new AbortController().signal, {}, fail),
    /failed once/,
  );
  await assert.rejects(
    registry.run("failure", new AbortController().signal, {}, fail),
    /failed once/,
  );
  assert.equal(failingStarts, 2);
});

test("legacy Gen Apps settings migrate to the Instant default", () => {
  const directory = mkdtempSync(join(tmpdir(), "openos-gen-app-settings-test-"));
  try {
    writeFileSync(
      join(directory, "gen-apps-settings.json"),
      JSON.stringify({
        version: 1,
        suggestionCount: 6,
        creativity: 25,
        appLanguage: "auto",
        generationMode: "agentic",
        agentMaxRounds: 3,
      }),
    );
    const settings = loadGenAppsSettings(loadServerEnv({ dataDir: directory }));
    assert.equal(settings.version, 3);
    assert.equal(settings.generationMode, "fast");
    writeFileSync(
      join(directory, "gen-apps-settings.json"),
      JSON.stringify({ version: 2, generationMode: "invalid" }),
    );
    assert.equal(
      loadGenAppsSettings(loadServerEnv({ dataDir: directory })).generationMode,
      "fast",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Gen Apps refinement rounds are finite and bounded", () => {
  assert.equal(clampAgentMaxRounds(0), 3);
  assert.equal(clampAgentMaxRounds(1), 2);
  assert.equal(clampAgentMaxRounds(2), 2);
  assert.equal(clampAgentMaxRounds(10), 3);
});

test("V2 compiler removes executable markup and declares stable actions", () => {
  const raw = `<main class="os-app"><style>body{display:none}</style>
    <form><button onclick="alert(1)">Run</button></form>
    <template><script nonce="openos-runtime-v2">window.escape=true</script></template>
    <section id="openos-root"><button id="toggle-host" type="button" data-action="toggle" data-target=" openos-root ">Toggle</button></section>
    <section id="panel"><a id="next" href="https://example.com" data-href="next">Next</a></section>
  </main>`;
  const validated = validateGenAppMarkup(raw);
  assert(validated.some((issue) => issue.code === "forbidden_element"));
  assert(validated.some((issue) => issue.code === "forbidden_attribute"));
  assert(validated.some((issue) => issue.code === "button_without_action"));

  const { markup, actions } = sanitizeGenAppMarkup(raw);
  assert(!markup.includes("<style"));
  assert(!markup.includes("<form"));
  assert(!markup.includes("<template"));
  assert(markup.includes(">Run</button>"));
  assert(!markup.includes("onclick"));
  assert(!markup.includes(" href="));
  assert(markup.includes('data-action="ai.patch"'));
  assert(markup.includes('data-action="ai.generate"'));
  assert(markup.includes('id="app-openos-root"'));
  assert(markup.includes('data-target="app-openos-root"'));
  assert(!markup.includes('id="openos-root"'));
  assert(actions.some((action) => action.action === "ai.patch"));

  const artifact = compileArtifact({ html: raw, provider: "test", model: "test" });
  assert.equal(artifact.format, GEN_APP_FORMAT);
  assert(artifact.html.includes("openos:interact"));
  assert(artifact.html.includes("nonce-openos-runtime-v2"));
});

test("replacement compiler enforces one preserved target and normalizes the session markup", () => {
  const source = `<main class="os-app"><section id="panel"><button id="go" type="button" data-action="ai.patch" data-target="panel">Go</button></section></main>`;
  const interaction = resolveMarkupInteraction(source, "go");
  assert.equal(interaction?.patchTargetId, "panel");
  assert(interaction?.patchTargetHtml.includes('id="panel"'));

  const replacement = compileReplacementMarkup(
    `<section id="panel"><button id="next">Next</button></section>`,
    "panel",
  );
  assert(replacement.includes('data-action="ai.patch"'));
  const next = replaceMarkupElement(source, "panel", replacement);
  assert.equal(extractMarkupElement(next, "panel"), replacement);
  assert.throws(
    () => compileReplacementMarkup('<section id="wrong">No</section>', "panel"),
    /exactly one root element/,
  );
  assert.throws(
    () =>
      replaceMarkupElement(
        '<main class="os-app"><section id="panel">Old</section><aside id="shared">Outside</aside></main>',
        "panel",
        '<section id="panel"><span id="shared">Duplicate</span></section>',
      ),
    /already exists outside target/,
  );
  assert.throws(
    () =>
      sanitizeGenAppMarkup(
        '<main class="os-app"><button id="broken" data-action="ai.patch" data-target="missing">Broken</button></main>',
      ),
    /references missing target/,
  );
  assert.throws(
    () =>
      replaceMarkupElement(
        '<main class="os-app"><button id="outside" data-action="toggle" data-target="inner">Toggle</button><section id="panel"><div id="inner">Inside</div></section></main>',
        "panel",
        '<section id="panel"><p>Inner target removed</p></section>',
      ),
    /references missing target/,
  );
  const crossBoundarySource =
    '<main class="os-app"><header id="toolbar"><button id="open" data-action="modal.open" data-target="modal">Open</button></header><section id="modal" class="os-modal" hidden>Modal</section></main>';
  const crossBoundaryReplacement = compileReplacementMarkup(
    '<header id="toolbar"><strong>Updated</strong><button id="open" data-action="modal.open" data-target="modal">Open</button></header>',
    "toolbar",
  );
  assert(
    replaceMarkupElement(
      crossBoundarySource,
      "toolbar",
      crossBoundaryReplacement,
    ).includes('data-target="modal"'),
  );
  assert.throws(
    () =>
      replaceMarkupElement(
        '<main class="os-app"><button id="search" data-action="ai.generate" data-target="panel" data-source="query">Search</button><section id="panel"><input id="query"></section></main>',
        "panel",
        '<section id="panel"><p>Query removed</p></section>',
      ),
    /data-source.*references missing id/,
  );
  assert.throws(
    () =>
      sanitizeGenAppMarkup(
        '<main class="os-app"><label for="missing">Missing field</label></main>',
      ),
    /for.*references missing id/,
  );
  assert.throws(
    () =>
      sanitizeGenAppMarkup(
        `<main class="os-app">${"<span>x</span>".repeat(GEN_APP_LIMITS.markupNodeMaxCount)}</main>`,
      ),
    /node limit/,
  );
  assert.throws(
    () =>
      sanitizeGenAppMarkup(
        '<main class="os-app" data-engine="game.snake" data-rows="999" data-columns="999" data-speed="0"><div id="board"></div></main>',
      ),
    /棋盘尺寸/,
  );
});

test("runtime patch proposals must match the active revision and server-selected target", () => {
  const raw = JSON.stringify({
    baseRevision: 3,
    ops: [{ op: "replace", targetId: "panel", html: '<section id="panel">Next</section>' }],
  });
  assert.equal(
    parseRuntimePatchProposal(raw, { baseRevision: 3, targetId: "panel" }).targetId,
    "panel",
  );
  assert.throws(
    () => parseRuntimePatchProposal(raw, { baseRevision: 4, targetId: "panel" }),
    /baseRevision/,
  );
  assert.throws(
    () => parseRuntimePatchProposal(raw, { baseRevision: 3, targetId: "other" }),
    /targetId/,
  );
});

test("runtime sessions isolate windows, advance revisions atomically, and expire", () => {
  let now = 1_000;
  const store = new RuntimeSessionStore(() => now);
  store.register({
    id: "session-a",
    appId: "app-a",
    revision: 1,
    markup: '<main id="root">A</main>',
    interactionMode: "hybrid",
    identity: {
      id: "app-a",
      name: "A",
      description: "A",
      sourceQuery: "A",
      format: GEN_APP_FORMAT,
    },
  });
  store.register({
    id: "session-b",
    appId: "app-a",
    revision: 1,
    markup: '<main id="root">B</main>',
    interactionMode: "improv",
    identity: {
      id: "app-a",
      name: "A",
      description: "A",
      sourceQuery: "A",
      format: GEN_APP_FORMAT,
    },
  });
  const committed = store.commit({
    sessionId: "session-a",
    appId: "app-a",
    baseRevision: 1,
    markup: '<main id="root">A2</main>',
    turns: [{ role: "user", content: "update" }],
  });
  assert.equal(committed.ok && committed.session.revision, 2);
  assert.equal(store.read("session-b", "app-a")?.markup.includes("B"), true);
  assert.deepEqual(
    store.commit({
      sessionId: "session-a",
      appId: "app-a",
      baseRevision: 1,
      markup: "stale",
      turns: [],
    }),
    { ok: false, currentRevision: 2 },
  );
  now += 31 * 60 * 1_000;
  assert.equal(store.read("session-a", "app-a"), null);
});

test("web.search opens search-engine landings and injects real provider results without an LLM", async () => {
  const sessions = new RuntimeSessionStore();
  const appId = "web-search-app";
  const runtimeSessionId = "web-search-session";
  sessions.register({
    id: runtimeSessionId,
    appId,
    revision: 1,
    interactionMode: "hybrid",
    identity: {
      id: appId,
      name: "Browser",
      description: "Network browser",
      sourceQuery: "browser",
      format: GEN_APP_FORMAT,
    },
    markup: '<main class="os-app"><input id="address"><button id="navigate" type="button" data-action="web.search" data-target="browser-results" data-source="address">Go</button><section id="browser-results">Ready</section></main>',
  });
  let searchCalls = 0;
  const webSearch: WebSearchProvider = {
    async search(query) {
      searchCalls += 1;
      return {
        query,
        provider: "Test Search",
        results: [{
          title: "OpenOS <result>",
          url: "https://example.com/openos",
          snippet: "A real result & useful summary",
        }],
      };
    },
  };
  const coordinator = new RuntimeInteractionCoordinator({
    generator: new DeterministicFakeGenerator(),
    sessions,
    language: () => "en",
    webSearch,
    webPage: {
      async open(url) {
        assert.equal(url, "https://example.com/openos");
        return {
          url,
          title: "OpenOS Documentation",
          description: "Official documentation",
          paragraphs: ["OpenOS provides generated applications with a secure runtime."],
        };
      },
    } satisfies WebPageProvider,
  });
  const landing = await coordinator.execute(
    {
      identity: sessions.read(runtimeSessionId, appId)!.identity,
      request: {
        runtimeSessionId,
        baseRevision: 1,
        event: { type: "click", targetId: "navigate", action: "web.search", value: "https://google.com" },
      },
    },
    new AbortController().signal,
  );
  assert.equal(landing.revision, 2);
  assert(landing.ops[0].html.includes("Google"), landing.ops[0].html);
  assert(landing.ops[0].html.includes('data-action="web.search"'));
  assert.equal(searchCalls, 0);

  const results = await coordinator.execute(
    {
      identity: sessions.read(runtimeSessionId, appId)!.identity,
      request: {
        runtimeSessionId,
        baseRevision: 2,
        event: { type: "click", targetId: "browser-results-web-submit", action: "web.search", value: "OpenOS" },
      },
    },
    new AbortController().signal,
  );
  assert.equal(results.revision, 3);
  assert.equal(searchCalls, 1);
  assert(results.ops[0].html.includes("Test Search 网络结果"));
  assert(results.ops[0].html.includes("OpenOS &lt;result&gt;"));
  assert(!results.ops[0].html.includes("<result>"));
  assert(results.ops[0].html.includes('data-action="web.open"'));

  const page = await coordinator.execute(
    {
      identity: sessions.read(runtimeSessionId, appId)!.identity,
      request: {
        runtimeSessionId,
        baseRevision: 3,
        event: {
          type: "click",
          targetId: "browser-results-web-open-1",
          action: "web.open",
          value: "http://127.0.0.1/private",
        },
      },
    },
    new AbortController().signal,
  );
  assert.equal(page.revision, 4);
  assert(page.ops[0].html.includes("OpenOS Documentation"));
  assert(page.ops[0].html.includes("secure runtime"));
});

test("Bing RSS search adapter parses bounded structured results", async () => {
  const rss = `<?xml version="1.0"?><rss><channel><item><title>OpenOS</title><link>https://example.com/openos</link><description>Desktop result</description></item><item><title>Unsafe</title><link>javascript:alert(1)</link><description>Skip</description></item></channel></rss>`;
  const provider = new BingRssWebSearchProvider(async () =>
    new Response(rss, { status: 200, headers: { "content-type": "application/rss+xml" } }),
  );
  const response = await provider.search("OpenOS", new AbortController().signal);
  assert.equal(response.provider, "Bing");
  assert.deepEqual(response.results, [{
    title: "OpenOS",
    url: "https://example.com/openos",
    snippet: "Desktop result",
  }]);
});

test("web page reader extracts safe text and rejects private network targets", async () => {
  const page = extractReadableWebPage(
    '<html><head><title>Example</title><meta name="description" content="Readable page"></head><body><nav>Ignore navigation</nav><main><h1>Example heading</h1><p>This paragraph contains enough useful page text for the generated browser.</p><script>window.bad=true</script></main></body></html>',
    "https://example.com/docs",
  );
  assert.equal(page.title, "Example");
  assert.equal(page.description, "Readable page");
  assert(page.paragraphs.some((paragraph) => paragraph.includes("useful page text")));
  assert(!page.paragraphs.some((paragraph) => paragraph.includes("window.bad")));

  const provider = new SafeWebPageProvider();
  await assert.rejects(
    provider.open("http://127.0.0.1/private", new AbortController().signal),
    (error: Error & { code?: string }) => error.code === "web_page_failed",
  );
});

test("service generates V2 drafts and applies one repaired, revisioned AI patch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openos-genapps-v2-test-"));
  const database = createOpenOsDatabaseAt(join(directory, "openos.sqlite"));
  try {
    const repository = new SqliteGenAppRepository(database);
    const fake = new DeterministicFakeGenerator();
    let patchCalls = 0;
    const patchMessages: string[] = [];
    const repairingGenerator: GenAppGenerator = {
      suggest: fake.suggest.bind(fake),
      generate: fake.generate.bind(fake),
      async continueContent(input, signal) {
        patchMessages.push(...input.messages.map((message) => message.content));
        if (
          input.intent === "update" &&
          input.messages.some((message) => message.content.includes("openos-patch-batch")) &&
          patchCalls++ === 0
        ) {
          return JSON.stringify({
            baseRevision: 1,
            ops: [
              {
                op: "replace",
                targetId: "calculator-panel",
                html: '<section id="calculator-panel"><span id="app-header">Duplicate outside id</span></section>',
              },
            ],
          });
        }
        return fake.continueContent(input, signal);
      },
    };
    const service = new GenAppsService({
      generator: repairingGenerator,
      repository,
      now: () => 10_000,
    });
    await assert.rejects(
      service.generateDraft(
        {
          suggestion: {
            id: "oversized-query",
            name: "Oversized",
            description: "Must be rejected before generation",
            iconEmoji: "🧪",
            iconTheme: "blue",
          },
          query: "x".repeat(GEN_APP_LIMITS.queryMaxLength + 1),
          idempotencyKey: "oversized-query-draft",
        },
        context(),
      ),
      (error: Error & { code?: string }) => error.code === "validation_failed",
    );
    const draft = await service.generateDraft(
      {
        suggestion: {
          id: "suggestion-1",
          name: "Calculator",
          description: "Local calculator",
          iconEmoji: "🧮",
          iconTheme: "orange",
        },
        query: "calculator",
        idempotencyKey: "draft-1",
      },
      context(),
    );
    assert.equal(draft.artifact.format, GEN_APP_FORMAT);
    assert(draft.artifact.markup?.includes('id="ai-explain"'));
    service.install(draft.summary.id);
    assert.equal(service.list().length, 1);
    service.remove(draft.summary.id);
    assert.equal(service.list().length, 0);

    const result = await service.interact(
      {
        appId: draft.summary.id,
        runtimeSessionId: draft.runtimeSessionId,
        baseRevision: draft.artifact.revision,
        event: {
          type: "click",
          targetId: "ai-explain",
          action: "ai.patch",
          currentHtml:
            '<section id="wrong"><script>RAW_PROMPT_INJECTION</script></section>',
        },
      },
      context(),
    );
    assert.equal(result.patch.baseRevision, 1);
    assert.equal(result.patch.revision, 2);
    assert.equal(result.patch.ops[0].targetId, "calculator-panel");
    assert(result.patch.ops[0].html.includes("确定性补丁"));
    assert.equal(patchCalls, 2);
    assert(!patchMessages.some((message) => message.includes("RAW_PROMPT_INJECTION")));
    assert.throws(
      () =>
        service.resumeRuntime(
          {
            appId: draft.summary.id,
            runtimeSessionId: draft.runtimeSessionId,
            revision: 1,
            markup: draft.artifact.markup ?? "",
            interactionMode: "hybrid",
          },
          "active-resume",
        ),
      (error: Error & { code?: string }) => error.code === "invalid_transition",
    );
    const resumed = service.resumeRuntime(
      {
        appId: draft.summary.id,
        runtimeSessionId: "expired-window-session",
        revision: 1,
        markup: draft.artifact.markup ?? "",
        interactionMode: "hybrid",
      },
      "expired-resume",
    );
    assert.equal(resumed.revision, 1);
    const recovered = await service.interact(
      {
        appId: draft.summary.id,
        runtimeSessionId: resumed.runtimeSessionId,
        baseRevision: resumed.revision,
        event: { type: "click", targetId: "ai-explain", action: "ai.patch" },
      },
      context(),
    );
    assert.equal(recovered.patch.revision, 2);

    await assert.rejects(
      service.interact(
        {
          appId: draft.summary.id,
          runtimeSessionId: draft.runtimeSessionId,
          baseRevision: 1,
          event: { type: "click", targetId: "ai-explain", action: "ai.patch" },
        },
        context(),
      ),
      (error: Error & { code?: string }) => error.code === "invalid_transition",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy artifacts remain parseable and keep the script-capable continue path", async () => {
  const directory = mkdtempSync(join(tmpdir(), "openos-genapps-v1-test-"));
  const database = createOpenOsDatabaseAt(join(directory, "openos.sqlite"));
  try {
    const repository = new SqliteGenAppRepository(database);
    const legacyHtml = "<!doctype html><html><body><main>Legacy</main></body></html>";
    const artifact = brandValidated({
      format: GEN_APP_LEGACY_FORMAT,
      html: legacyHtml,
      contentSha256: createHash("sha256").update(legacyHtml).digest("hex"),
      sizeBytes: Buffer.byteLength(legacyHtml),
      formatVersion: 1,
      runtimeVersion: 1,
      policyVersion: 1,
    });
    const draft = repository.createDraft({
      id: "legacy-app",
      name: "Legacy",
      description: "V1",
      iconEmoji: "📦",
      iconTheme: "graphite",
      category: "AI",
      sourceQuery: "legacy",
      generatorProvider: "test",
      generatorModel: "test",
      promptVersion: 1,
      artifact,
      now: 1_000,
      draftTtlMs: 60_000,
    });
    const fake = new DeterministicFakeGenerator();
    let legacyMessages: Array<{ role: string; content: string }> = [];
    const generator: GenAppGenerator = {
      suggest: fake.suggest.bind(fake),
      generate: fake.generate.bind(fake),
      async continueContent(input) {
        legacyMessages = input.messages;
        return '<section id="legacy-fragment">Legacy<script>window.legacyReady=true</script></section>';
      },
    };
    const service = new GenAppsService({ generator, repository, now: () => 2_000 });
    service.install(draft.summary.id);
    service.launch(draft.summary.id);
    service.remove(draft.summary.id);
    const continued = await service.continueContent(
      {
        appId: draft.summary.id,
        intent: "content",
        prompt: "continue",
        sessionId: "legacy-session",
      },
      context(),
    );
    assert(continued.fragment.includes("<script>"));
    assert(legacyMessages[0]?.content.includes("允许该 V1 应用所需的内联 style/script"));
    assert(!legacyMessages[0]?.content.includes("使用 os-* UI Kit"));
    assert(parseGenAppArtifact({
      appId: "legacy-app",
      revision: 1,
      format: GEN_APP_LEGACY_FORMAT,
      formatVersion: 1,
      runtimeVersion: 1,
      policyVersion: 1,
      html: legacyHtml,
      contentSha256: artifact.contentSha256,
      sizeBytes: artifact.sizeBytes,
    }));
    assert.equal(
      parseGenAppArtifact({
        appId: "legacy-app",
        revision: 1,
        format: GEN_APP_LEGACY_FORMAT,
        formatVersion: 1,
        runtimeVersion: 1,
        policyVersion: 1,
        html: "",
        contentSha256: artifact.contentSha256,
        sizeBytes: 0,
      }),
      null,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("V2 wire artifacts may omit the preloaded shell while runtime document stays styled", () => {
  const runtime = buildGenAppRuntimeDocument();
  assert(runtime.includes("GEN_APP_ACTION_RUNTIME") === false);
  assert(runtime.includes("openos:ready"));
  assert(runtime.includes("style-src 'nonce-openos-runtime-v2'"));
  assert(!runtime.includes("style-src 'unsafe-inline'"));

  const artifact = parseGenAppArtifact({
    appId: "app-v2",
    revision: 1,
    format: GEN_APP_FORMAT,
    formatVersion: 2,
    runtimeVersion: 2,
    policyVersion: 2,
    html: "",
    markup: '<main class="os-app">Ready</main>',
    contentSha256: "a".repeat(64),
    sizeBytes: 100,
  });
  assert.equal(artifact?.format, GEN_APP_FORMAT);
});

test("V2 fragments are scriptless by default", () => {
  const fragment = compileFragment(
    '<section id="result"><script>alert(1)</script><button id="next">Next</button></section>',
  );
  assert(!fragment.includes("script"));
  assert(fragment.includes('data-action="ai.patch"'));
  assert.throws(
    () =>
      compileFragment(
        `<section id="oversized">${"x".repeat(GEN_APP_LIMITS.continueMaxBytes)}</section>`,
      ),
    /size limit/,
  );
});

test("migration v4 upgrades an existing V2 database with payload and generation cache storage", () => {
  const directory = mkdtempSync(join(tmpdir(), "openos-genapps-migration-test-"));
  const path = join(directory, "openos.sqlite");
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE gen_app_artifacts (
      app_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      format TEXT NOT NULL,
      format_version INTEGER NOT NULL,
      runtime_version INTEGER NOT NULL,
      policy_version INTEGER NOT NULL,
      html TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      PRIMARY KEY (app_id, revision)
    );
    PRAGMA user_version = 2;
  `);
  old.close();
  const migrated = createOpenOsDatabaseAt(path);
  try {
    const columns = migrated.db
      .prepare("PRAGMA table_info(gen_app_artifacts)")
      .all() as Array<{ name: string }>;
    assert(columns.some((column) => column.name === "payload_json"));
    const version = migrated.db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    assert.equal(version.user_version, 4);
    const cacheTable = migrated.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gen_app_generation_cache'")
      .get() as { name?: string } | undefined;
    assert.equal(cacheTable?.name, "gen_app_generation_cache");
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
