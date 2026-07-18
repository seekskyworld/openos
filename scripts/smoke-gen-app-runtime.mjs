import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { buildGenAppRuntimeDocument } from "../packages/shared/dist/index.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const harness = String.raw`
<script nonce="openos-runtime-v2">
(function () {
  window.addEventListener("error", function (event) {
    var output = document.createElement("pre");
    output.id = "runtime-smoke-error";
    output.textContent = String(event.message || event.error || "runtime error");
    document.body.appendChild(output);
  });
  var interactions = [];
  var resyncRequested = false;
  var resyncSettled = false;
  window.addEventListener("message", function (event) {
    if (event.data && event.data.type === "openos:interact") interactions.push(event.data.payload);
    if (event.data && event.data.type === "openos:patch-resync") {
      resyncRequested = true;
      window.postMessage({
        type: "openos:render",
        requestId: event.data.payload.requestId,
        revision: 4,
        markup: '<main class="os-app os-column"><section id="panel" class="os-main"><p id="patched">Patched</p></section><section id="resync-row" class="os-list-item"><p id="resynced">Resynced</p><button id="next-ai" type="button" data-action="ai.patch" data-target="resync-row">Next AI</button><input id="improv-change" data-action="mystery-change" value="changed"></section></main>'
      }, "*");
    }
    if (event.data && event.data.type === "openos:patch-settled" && resyncRequested) {
      resyncSettled = true;
    }
  });
  window.postMessage({ type: "openos:configure", runtimeSessionId: "runtime-smoke", revision: 1, interactionMode: "hybrid" }, "*");
  window.postMessage({
    type: "openos:render",
    revision: 1,
    markup: '<main class="os-app os-column"><header class="os-toolbar"><strong class="os-toolbar-title">Runtime</strong></header><section id="panel" class="os-main"><output id="display" data-expression="">0</output><button id="seven" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="7">7</button><button id="plus" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="+">+</button><button id="eight" class="os-button" type="button" data-action="calc.input" data-target="display" data-value="8">8</button><button id="equals" class="os-button" type="button" data-action="calc.evaluate" data-target="display">=</button><button id="improv" class="os-button" type="button" data-action="mystery">Improv</button><button id="ai" class="os-button" type="button" data-action="ai.patch" data-target="panel">AI</button><button id="unsafe" onclick="window.__unsafe=true">Unsafe</button><div id="openos-root"><button id="host-target" type="button" data-action="toggle" data-target="openos-root">Host target</button></div><span id="constructor">Prototype-safe id</span></section><section id="resync-row" class="os-list-item"><button id="resync-ai" type="button" data-action="ai.patch" data-target="resync-row">Resync AI</button><button id="remove-row" type="button" data-action="list.remove">Remove</button></section></main>'
  }, "*");
  setTimeout(function () {
    var started = performance.now();
    document.getElementById("seven").click();
    document.getElementById("plus").click();
    document.getElementById("eight").click();
    document.getElementById("equals").click();
    var localActionMs = performance.now() - started;
    var value = document.getElementById("display").textContent;
    var unsafeAttribute = document.getElementById("unsafe").getAttribute("onclick");
    var reservedIdRenamed = Boolean(document.getElementById("app-openos-root"));
    var reservedTargetRewritten = document.getElementById("host-target").getAttribute("data-target");
    var prototypeIdPreserved = Boolean(document.getElementById("constructor"));
    window.postMessage({ type: "openos:configure", runtimeSessionId: "runtime-smoke", revision: 1, interactionMode: "improv" }, "*");
    setTimeout(function () {
      document.getElementById("improv").click();
      var updateResolved = false;
      var concurrentRejected = false;
      var interaction = null;
      window.OpenOS.update({ targetId: "panel", instruction: "Make it concise", context: "runtime smoke" })
        .catch(function () { concurrentRejected = true; });
      setTimeout(function () {
        var improvInteraction = interactions[0];
        window.postMessage({
          type: "openos:patch",
          requestId: improvInteraction.requestId,
          patch: {
            baseRevision: 1,
            revision: 2,
            ops: [{ op: "replace", targetId: "improv", html: '<button id="improv" class="os-button" type="button" data-action="mystery">Improv</button>' }]
          }
        }, "*");
        setTimeout(function () {
          window.OpenOS.update({ targetId: "panel", instruction: "Make it concise", context: "runtime smoke" })
            .then(function () { updateResolved = true; });
          setTimeout(function () {
            interaction = interactions[1];
            window.postMessage({
              type: "openos:patch",
              requestId: interaction.requestId,
              patch: {
                baseRevision: 2,
                revision: 3,
                ops: [{ op: "replace", targetId: "panel", html: '<section id="panel" class="os-main"><p id="patched">Patched</p></section>' }]
              }
            }, "*");
          }, 20);
          setTimeout(function () {
            var resyncButton = document.getElementById("resync-ai");
            var removeButton = document.getElementById("remove-row");
            resyncButton.click();
            setTimeout(function () {
              var resyncInteraction = interactions[2];
              removeButton.click();
              window.postMessage({
                type: "openos:patch",
                requestId: resyncInteraction.requestId,
                patch: {
                  baseRevision: 3,
                  revision: 4,
                  ops: [{ op: "replace", targetId: "resync-row", html: '<section id="resync-row" class="os-list-item"><p id="resynced">Resynced</p><input id="improv-change" data-action="mystery-change" value="changed"></section>' }]
                }
              }, "*");
            }, 20);
            setTimeout(function () {
              document.getElementById("improv-change").dispatchEvent(new Event("change", { bubbles: true }));
            }, 50);
            setTimeout(function () {
              var changeInteraction = interactions[3];
              window.postMessage({
                type: "openos:render",
                requestId: changeInteraction.requestId,
                revision: 5,
                error: "Runtime state was synchronized. Please retry the action.",
                markup: '<main class="os-app os-column"><section id="panel" class="os-main"><p id="patched">Patched</p></section><section id="resync-row" class="os-list-item"><p id="resynced">Resynced</p><input id="improv-change" data-action="mystery-change" value="changed"><button id="after-conflict" type="button" data-action="ai.patch" data-target="resync-row">Retry</button></section></main>'
              }, "*");
            }, 65);
            setTimeout(function () {
              document.getElementById("after-conflict").click();
            }, 85);
            setTimeout(function () {
              var changeInteraction = interactions[3];
              var afterConflictInteraction = interactions[4];
              var result = {
                value: value,
                localActionMs: localActionMs,
                improvTargetId: improvInteraction.event.targetId,
                concurrentRejected: concurrentRejected,
                forwardedTargetId: interaction.event.targetId,
                forwardedInstruction: interaction.event.value,
                targetSnapshot: interaction.event.currentHtml,
                updateResolved: updateResolved,
                patched: Boolean(document.getElementById("patched")),
                unsafeAttribute: unsafeAttribute,
                reservedIdRenamed: reservedIdRenamed,
                reservedTargetRewritten: reservedTargetRewritten,
                prototypeIdPreserved: prototypeIdPreserved,
                resyncRequested: resyncRequested,
                resyncSettled: resyncSettled,
                resynced: Boolean(document.getElementById("resynced")),
                nextBaseRevision: afterConflictInteraction.baseRevision,
                improvChangeTargetId: changeInteraction.event.targetId,
                improvChangeType: changeInteraction.event.type,
                conflictToast: document.getElementById("openos-toasts").textContent,
                background: getComputedStyle(document.body).backgroundColor
              };
              var output = document.createElement("pre");
              output.id = "runtime-smoke-result";
              output.textContent = JSON.stringify(result);
              document.body.appendChild(output);
            }, 115);
          }, 50);
        }, 20);
      }, 20);
    }, 10);
  }, 20);
})();
</script>`;

const runtimeDocument = buildGenAppRuntimeDocument().replace("</body>", `${harness}</body>`);
const server = createServer((request, response) => {
  if (request.url !== "/runtime") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(runtimeDocument);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;

try {
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-extensions",
      "--virtual-time-budget=1000",
      "--dump-dom",
      `http://127.0.0.1:${port}/runtime`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  assert(exitCode === 0, `headless Chrome failed: ${stderr.slice(-500)}`);
  const encoded = stdout.match(/<pre id="runtime-smoke-result">([\s\S]*?)<\/pre>/)?.[1];
  const runtimeError = stdout.match(/<pre id="runtime-smoke-error">([\s\S]*?)<\/pre>/)?.[1];
  assert(
    encoded,
    `runtime smoke result was not rendered: ${runtimeError || stderr.slice(-500)} ${stdout.slice(-500)}`,
  );
  const decoded = encoded
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  const result = JSON.parse(decoded);
  assert(result.value === "15", `local calculator returned ${result.value}`);
  assert(result.localActionMs < 16, `local actions took ${result.localActionMs}ms`);
  assert(result.forwardedTargetId === "panel", "OpenOS.update was not forwarded");
  assert(result.forwardedInstruction.includes("Make it concise"), "update instruction missing");
  assert(result.updateResolved, "OpenOS.update did not resolve after the patch");
  assert(result.improvTargetId === "improv", "improv fallback was not forwarded");
  assert(result.concurrentRejected, "runtime accepted concurrent AI patch requests");
  assert(result.targetSnapshot.includes('id="panel"'), "target snapshot missing");
  assert(result.patched, "revision patch was not applied");
  assert(result.unsafeAttribute === null, "runtime sanitizer kept an inline handler");
  assert(result.reservedIdRenamed, "runtime sanitizer kept a host-reserved id");
  assert(result.reservedTargetRewritten === "app-openos-root", "reserved target was not rewritten");
  assert(result.prototypeIdPreserved, "prototype-like id diverged from the server sanitizer");
  assert(result.resyncRequested, "missing patch target did not request a full resync");
  assert(result.resyncSettled, "resynchronized patch did not settle");
  assert(result.resynced, "authoritative resync markup was not rendered");
  assert(result.nextBaseRevision === 5, `interaction after conflict sync used revision ${result.nextBaseRevision}`);
  assert(result.improvChangeTargetId === "improv-change", "improv change fallback was not forwarded");
  assert(result.improvChangeType === "change", "improv change event type was not preserved");
  assert(result.conflictToast.includes("Please retry"), "conflict sync did not surface a retry message");
  assert(result.background !== "rgba(0, 0, 0, 0)", "UI Kit background was not applied");
  console.log(
    JSON.stringify({
      result: "PASS",
      localActionMs: Number(result.localActionMs.toFixed(3)),
      patchForwarded: true,
      improvFallback: true,
      improvChangeFallback: true,
      windowSerialized: true,
      patchResync: true,
      conflictSyncRetry: true,
      styled: true,
    }),
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
