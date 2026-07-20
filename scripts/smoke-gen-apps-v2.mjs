import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function parseEvent(raw) {
  let name = "message";
  const data = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return { name, data: data.length ? JSON.parse(data.join("\n")) : null };
}

async function streamDraft(base, payload) {
  const started = performance.now();
  const response = await fetch(`${base}/gen-apps/drafts/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert(response.ok && response.body, `draft stream failed: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstRegionMs = null;
  let draft = null;
  const snapshotStages = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator;
    while ((separator = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buffer.slice(0, separator);
      buffer = buffer.slice(separator).replace(/^\r?\n\r?\n/, "");
      const event = parseEvent(raw);
      if ((event.name === "delta" || event.name === "snapshot") && firstRegionMs === null) {
        firstRegionMs = performance.now() - started;
      }
      if (event.name === "snapshot" && typeof event.data?.stage === "string") {
        snapshotStages.push(event.data.stage);
      }
      if (event.name === "done") draft = event.data.draft;
      if (event.name === "error") {
        throw new Error(event.data?.error?.message || "stream error");
      }
    }
  }
  assert(draft, "draft stream ended without a draft");
  return {
    draft,
    firstDeltaMs: firstRegionMs ?? performance.now() - started,
    totalMs: performance.now() - started,
    snapshotStages,
  };
}

const root = new URL("..", import.meta.url).pathname;
const port = await freePort();
const base = `http://127.0.0.1:${port}/api`;
const dataDir = mkdtempSync(join(tmpdir(), "openos-genapps-v2-smoke-"));
const child = spawn("node", ["server/dist/cli.js"], {
  cwd: root,
  env: {
    ...process.env,
    OPENOS_GENAPPS_FAKE: "1",
    OPENOS_CHANNEL: "dev",
    OPENOS_BRIDGE_PORT: String(port),
    OPENOS_BRIDGE_ALLOW_UNAUTHENTICATED: "1",
    OPENOS_DATA_DIR: dataDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let ready = false;
const observe = (chunk) => {
  const text = chunk.toString("utf8");
  if (text.includes("openos.desktop.bridge.ready")) ready = true;
};
child.stdout.on("data", observe);
child.stderr.on("data", observe);

try {
  const deadline = Date.now() + 10_000;
  while (!ready && Date.now() < deadline) await sleep(25);
  assert(ready, "isolated fake server did not become ready");

  const suggestionStarted = performance.now();
  const suggestionResponse = await fetch(`${base}/gen-apps/suggestions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "browser", count: 2 }),
  });
  const suggestionBody = await suggestionResponse.json();
  const suggestionMs = performance.now() - suggestionStarted;
  assert(suggestionResponse.ok && suggestionBody.suggestions.length === 2, "suggestions failed");

  const recipeTimes = [];
  for (let index = 0; index < 12; index += 1) {
    const started = performance.now();
    const recipe = await streamDraft(base, {
      suggestion: {
        id: `recipe-${index}`,
        name: "贪吃蛇",
        description: "本地可玩的贪吃蛇",
        iconEmoji: "🐍",
        iconTheme: "green",
      },
      query: "贪吃蛇",
      idempotencyKey: `smoke-recipe-${index}`,
    });
    assert(
      recipe.draft.artifact.markup.includes('data-engine="game.snake"'),
      "recipe did not select snake engine",
    );
    recipeTimes.push(performance.now() - started);
  }
  recipeTimes.sort((a, b) => a - b);
  const recipeP95Ms = recipeTimes[Math.ceil(recipeTimes.length * 0.95) - 1];
  assert(recipeP95Ms < 50, `recipe P95 exceeded 50ms: ${recipeP95Ms.toFixed(1)}ms`);

  const generated = await streamDraft(base, {
    suggestion: {
      id: "smoke-suggestion",
      name: "Browser",
      description: "Network search browser",
      iconEmoji: "🌐",
      iconTheme: "blue",
    },
    query: "browser",
    idempotencyKey: "smoke-v2-draft",
  });
  const { draft } = generated;
  assert(draft.artifact.format === "openos-markup", "draft is not V2");
  assert(draft.artifact.html === "", "V2 wire payload repeated the runtime shell");
  assert(draft.artifact.markup.includes('data-action="web.search"'), "V2 markup missing web search action");
  assert(draft.runtimeSessionId, "draft runtime session missing");

  const progressive = await streamDraft(base, {
    suggestion: {
      id: "smoke-progressive",
      name: "Quantum Garden",
      description: "A novel generated workspace",
      iconEmoji: "✨",
      iconTheme: "purple",
    },
    query: "quantum garden",
    idempotencyKey: "smoke-progressive-draft",
    bypassCache: true,
  });
  assert(
    JSON.stringify(progressive.snapshotStages) === JSON.stringify(["shell", "core", "content", "actions"]),
    `model path emitted invalid HTML stages: ${JSON.stringify(progressive.snapshotStages)}`,
  );
  assert(progressive.firstDeltaMs < 500, `progressive HTML first snapshot regressed to ${progressive.firstDeltaMs}ms`);

  const patchStarted = performance.now();
  const patchResponse = await fetch(
    `${base}/gen-apps/${encodeURIComponent(draft.summary.id)}/interact`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runtimeSessionId: draft.runtimeSessionId,
        baseRevision: draft.artifact.revision,
        event: { type: "click", targetId: "navigate", action: "web.search", value: "https://google.com" },
      }),
    },
  );
  const patchBody = await patchResponse.json();
  const patchMs = performance.now() - patchStarted;
  assert(patchResponse.ok, `patch failed: ${JSON.stringify(patchBody)}`);
  assert(patchBody.patch.revision === draft.artifact.revision + 1, "revision did not advance");
  assert(patchBody.patch.ops.length === 1, "patch is not single-target");

  const staleResponse = await fetch(
    `${base}/gen-apps/${encodeURIComponent(draft.summary.id)}/interact`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runtimeSessionId: draft.runtimeSessionId,
        baseRevision: draft.artifact.revision,
        event: { type: "click", targetId: "navigate", action: "web.search", value: "https://google.com" },
      }),
    },
  );
  const staleBody = await staleResponse.json();
  assert(staleResponse.status === 409, "stale revision was not rejected");
  assert(
    staleBody.error?.details?.currentRevision === 2 &&
      typeof staleBody.error?.details?.currentMarkup === "string",
    "revision conflict omitted the authoritative recovery snapshot",
  );

  const rollbackResponse = await fetch(
    `${base}/gen-apps/${encodeURIComponent(draft.summary.id)}/resume`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runtimeSessionId: draft.runtimeSessionId,
        revision: draft.artifact.revision,
        markup: draft.artifact.markup,
        interactionMode: draft.artifact.interactionMode,
      }),
    },
  );
  assert(rollbackResponse.status === 409, "resume rolled back an active session");

  const recoveredSessionId = "rs-expired-smoke";
  const resumeResponse = await fetch(
    `${base}/gen-apps/${encodeURIComponent(draft.summary.id)}/resume`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runtimeSessionId: recoveredSessionId,
        revision: draft.artifact.revision,
        markup: draft.artifact.markup,
        interactionMode: draft.artifact.interactionMode,
      }),
    },
  );
  const resumeBody = await resumeResponse.json();
  assert(resumeResponse.ok, `runtime resume failed: ${JSON.stringify(resumeBody)}`);
  const recoveredPatchResponse = await fetch(
    `${base}/gen-apps/${encodeURIComponent(draft.summary.id)}/interact`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runtimeSessionId: recoveredSessionId,
        baseRevision: resumeBody.revision,
        event: { type: "click", targetId: "navigate", action: "web.search", value: "https://google.com" },
      }),
    },
  );
  const recoveredPatchBody = await recoveredPatchResponse.json();
  assert(
    recoveredPatchResponse.ok && recoveredPatchBody.patch.revision === 2,
    "runtime did not recover from a missing session",
  );

  const installResponse = await fetch(
    `${base}/gen-apps/${encodeURIComponent(draft.summary.id)}/install`,
    { method: "POST", headers: { "content-type": "application/json" } },
  );
  assert(installResponse.ok, "install failed");
  const launchResponse = await fetch(
    `${base}/gen-apps/${encodeURIComponent(draft.summary.id)}/launch`,
    { method: "POST", headers: { "content-type": "application/json" } },
  );
  const launchBody = await launchResponse.json();
  assert(launchResponse.ok, "launch failed");
  assert(launchBody.bundle.artifact.html === "", "launch repeated the V2 shell");
  assert(
    launchBody.bundle.runtimeSessionId !== draft.runtimeSessionId,
    "launch did not isolate the new window session",
  );

  const wireBytes = Buffer.byteLength(JSON.stringify(draft));
  const shellBytes = draft.artifact.sizeBytes;
  assert(suggestionMs < 500, `local suggestion plumbing regressed to ${suggestionMs}ms`);
  assert(generated.firstDeltaMs < 500, `first streamed region regressed to ${generated.firstDeltaMs}ms`);
  assert(generated.totalMs < 2_000, `deterministic generation regressed to ${generated.totalMs}ms`);
  assert(patchMs < 500, `deterministic patch plumbing regressed to ${patchMs}ms`);
  assert(wireBytes < shellBytes * 0.5, "V2 wire payload did not remove at least half of shell bytes");
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        metrics: {
          suggestionMs: Math.round(suggestionMs),
          firstDeltaMs: Math.round(generated.firstDeltaMs),
          progressiveSnapshotMs: Math.round(progressive.firstDeltaMs),
          generationMs: Math.round(generated.totalMs),
          recipeP95Ms: Math.round(recipeP95Ms * 100) / 100,
          patchMs: Math.round(patchMs),
          revisionRecovery: true,
          wireBytes,
          compiledShellBytes: shellBytes,
          wireReductionPercent: Math.round((1 - wireBytes / shellBytes) * 100),
        },
      },
      null,
      2,
    ),
  );
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(2_000).then(() => child.kill("SIGKILL")),
  ]);
  rmSync(dataDir, { recursive: true, force: true });
}
