import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { buildGenAppRuntimeDocument } from "../packages/shared/dist/index.js";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const mineCells = Array.from({ length: 4 }, (_, index) =>
  `<button id="mine-${index}" type="button" class="os-game-cell" data-action="game.minesweeper.reveal" data-target="mine-board" data-index="${index}"></button>`,
).join("");
const snakeCells = Array.from({ length: 25 }, (_, index) =>
  `<div id="snake-${index}" class="os-snake-cell"></div>`,
).join("");
const markup = `<main class="os-app os-column">
  <section data-engine="game.minesweeper"><span id="mine-status"></span><div id="mine-board" class="os-game-grid os-minesweeper os-game-cols-9" data-rows="2" data-columns="2" data-mines="1" data-seed="7">${mineCells}</div></section>
  <span id="sudoku-status"></span><div id="sudoku-board" class="os-game-grid os-sudoku os-game-cols-9" data-engine="game.sudoku"><input id="sudoku-input" data-action="game.sudoku.input" data-solution="5"></div>
  <section data-engine="game.snake"><span id="snake-status"></span><strong id="snake-score">0</strong><div id="snake-board" class="os-game-grid os-snake os-game-cols-20" tabindex="0" data-rows="5" data-columns="5" data-speed="30">${snakeCells}</div></section>
  <button id="snake-start" type="button" data-action="game.snake.start" data-target="snake-board">Start</button>
  <button id="snake-pause" type="button" data-action="game.snake.pause" data-target="snake-board">Pause</button>
  <section><span id="platformer-status"></span><strong id="platformer-score">0</strong>
    <div id="platformer-board" class="os-platformer" data-engine="game.platformer" tabindex="0" data-gravity="1700" data-speed="260" data-jump="620">
      <div class="os-platformer-platform" data-x="0" data-y="88" data-w="100" data-h="12"></div>
      <div class="os-platformer-coin" data-x="45" data-y="70"></div>
      <div class="os-platformer-goal" data-x="92" data-y="66"></div>
      <div id="platformer-player" class="os-platformer-player" data-start-x="7" data-start-y="76"></div>
    </div>
  </section>
  <button id="platformer-right" type="button" data-action="game.platformer.right" data-target="platformer-board">Right</button>
  <button id="platformer-jump" type="button" data-action="game.platformer.jump" data-target="platformer-board">Jump</button>
  <button id="platformer-pause" type="button" data-action="game.platformer.pause" data-target="platformer-board">Pause</button>
</main>`;

const harness = `<script nonce="openos-runtime-v2">
window.__gameSmokeError = "";
window.addEventListener("error", function (event) { window.__gameSmokeError = String(event.message || event.error || "runtime error"); });
window.requestAnimationFrame = function (callback) { return window.setTimeout(function () { callback(performance.now()); }, 16); };
window.cancelAnimationFrame = function (handle) { window.clearTimeout(handle); };
setTimeout(function () {
  window.postMessage({ type: "openos:configure", runtimeSessionId: "games", revision: 1, interactionMode: "hybrid" }, "*");
  window.postMessage({ type: "openos:render", markup: ${JSON.stringify(markup)}, revision: 1 }, "*");
  setTimeout(function () {
    document.getElementById("mine-0").click();
    var sudoku = document.getElementById("sudoku-input");
    sudoku.value = "5";
    sudoku.dispatchEvent(new Event("input", { bubbles: true }));
    var before = document.querySelector(".is-snake-head").id;
    var platformerPlayer = document.getElementById("platformer-player");
    var platformerBeforeX = Number(platformerPlayer.getAttribute("data-runtime-x"));
    var platformerBeforeY = Number(platformerPlayer.getAttribute("data-runtime-y"));
    var platformerJumped = false;
    var platformerMoved = false;
    var platformerJumpStatus = "";
    var platformerFrameBeforePatch = 0;
    var platformerXBeforePatch = 0;
    var platformerYBeforePatch = 0;
    document.getElementById("snake-start").click();
    document.getElementById("platformer-right").click();
    document.getElementById("platformer-jump").click();
    platformerJumpStatus = document.getElementById("platformer-status").textContent;
    setTimeout(function () {
      var board = document.getElementById("snake-board");
      window.postMessage({ type: "openos:patch", requestId: "game-patch", patch: { baseRevision: 1, revision: 2, ops: [{ op: "replace", targetId: "snake-board", html: board.outerHTML }] } }, "*");
      setTimeout(function () { document.getElementById("snake-start").click(); }, 10);
    }, 25);
    setTimeout(function () {
      var player = document.getElementById("platformer-player");
      platformerJumped = Number(player.getAttribute("data-runtime-y")) < platformerBeforeY;
      platformerMoved = Number(player.getAttribute("data-runtime-x")) > platformerBeforeX;
    }, 90);
    setTimeout(function () {
      document.getElementById("platformer-board").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    }, 130);
    setTimeout(function () {
      var player = document.getElementById("platformer-player");
      platformerFrameBeforePatch = Number(player.getAttribute("data-runtime-frame"));
      platformerXBeforePatch = Number(player.getAttribute("data-runtime-x"));
      platformerYBeforePatch = Number(player.getAttribute("data-runtime-y"));
      var replacement = player.cloneNode(true);
      replacement.removeAttribute("data-runtime-x");
      replacement.removeAttribute("data-runtime-y");
      replacement.removeAttribute("data-runtime-frame");
      window.postMessage({ type: "openos:patch", requestId: "platformer-patch", patch: { baseRevision: 2, revision: 3, ops: [{ op: "replace", targetId: "platformer-player", html: replacement.outerHTML }] } }, "*");
    }, 160);
    setTimeout(function () {
      document.getElementById("snake-pause").click();
      var platformerPlayer = document.getElementById("platformer-player");
      var platformerStillRunning = platformerPlayer.classList.contains("is-running");
      document.getElementById("platformer-board").dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
      document.getElementById("platformer-pause").click();
      var result = {
        mineRevealed: document.getElementById("mine-0").classList.contains("is-revealed"),
        sudokuSolved: document.getElementById("sudoku-status").textContent.indexOf("Solved") >= 0,
        snakeMoved: document.querySelector(".is-snake-head").id !== before,
        snakePaused: document.getElementById("snake-status").textContent.indexOf("Paused") >= 0,
        patchRebound: document.getElementById("snake-board").children.length === 25,
        platformerMoved: platformerMoved,
        platformerJumped: platformerJumped,
        platformerPaused: document.getElementById("platformer-status").textContent.indexOf("Paused") >= 0,
        platformerPatchRebound: platformerPlayer.isConnected && platformerStillRunning && Number(platformerPlayer.getAttribute("data-runtime-frame")) > platformerFrameBeforePatch && Number(platformerPlayer.getAttribute("data-runtime-x")) > platformerXBeforePatch,
        platformerBeforeX: platformerBeforeX,
        platformerAfterX: Number(platformerPlayer.getAttribute("data-runtime-x")),
        platformerBeforeY: platformerBeforeY,
        platformerAfterY: Number(platformerPlayer.getAttribute("data-runtime-y")),
        runtimeError: window.__gameSmokeError,
        platformerJumpStatus: platformerJumpStatus,
        platformerFrameBeforePatch: platformerFrameBeforePatch,
        platformerFrameAfterPatch: Number(platformerPlayer.getAttribute("data-runtime-frame")),
        platformerXBeforePatch: platformerXBeforePatch,
        platformerYBeforePatch: platformerYBeforePatch,
        platformerStillRunning: platformerStillRunning
      };
      var output = document.createElement("pre");
      output.id = "game-smoke-result";
      output.textContent = JSON.stringify(result);
      document.body.appendChild(output);
    }, 600);
  }, 20);
}, 0);
</script>`;

const documentHtml = buildGenAppRuntimeDocument().replace("</body>", `${harness}</body>`);
const server = createServer((request, response) => {
  if (request.url !== "/games") return response.writeHead(404).end();
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(documentHtml);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;

try {
  const child = spawn(CHROME, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-extensions",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=1800",
    "--dump-dom",
    `http://127.0.0.1:${port}/games`,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  assert(exitCode === 0, `headless Chrome failed: ${stderr.slice(-500)}`);
  const encoded = stdout.match(/<pre id="game-smoke-result">([\s\S]*?)<\/pre>/)?.[1];
  assert(encoded, `game smoke result missing: ${stderr.slice(-500)} ${stdout.slice(-500)}`);
  const result = JSON.parse(encoded.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  assert(result.mineRevealed, "minesweeper did not reveal a cell");
  assert(result.sudokuSolved, "sudoku did not validate the solution");
  assert(result.snakeMoved, "snake animation did not advance");
  assert(result.snakePaused, "snake did not pause");
  assert(result.patchRebound, "snake board patch did not rebind the local engine");
  assert(result.platformerMoved, `platformer did not move horizontally: ${JSON.stringify(result)}`);
  assert(result.platformerJumped, "platformer did not jump");
  assert(result.platformerPaused, "platformer did not pause");
  assert(result.platformerPatchRebound, `platformer child patch did not rebind the local engine: ${JSON.stringify(result)}`);
  assert(!result.runtimeError, `platformer runtime threw: ${result.runtimeError}`);
  console.log(JSON.stringify({ result: "PASS", ...result }));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
