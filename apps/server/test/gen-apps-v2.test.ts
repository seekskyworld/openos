import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  buildGenAppRuntimeDocument,
  GEN_APP_FORMAT,
  GEN_APP_LEGACY_FORMAT,
  GEN_APP_LIMITS,
  parseGenAppArtifact,
} from "@openos/shared";
import { compileArtifact, compileFragment } from "../src/gen-apps/artifact-compiler.js";
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
import { createOpenOsDatabaseAt } from "../src/database/openos-database.js";

const context = () => ({
  requestId: "test-request",
  signal: new AbortController().signal,
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

test("migration v3 upgrades an existing V2 database with structured payload storage", () => {
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
    assert.equal(version.user_version, 3);
  } finally {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
