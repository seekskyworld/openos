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
</main>`;

const harness = `<script nonce="openos-runtime-v2">
setTimeout(function () {
  window.postMessage({ type: "openos:configure", runtimeSessionId: "games", revision: 1, interactionMode: "hybrid" }, "*");
  window.postMessage({ type: "openos:render", markup: ${JSON.stringify(markup)}, revision: 1 }, "*");
  setTimeout(function () {
    document.getElementById("mine-0").click();
    var sudoku = document.getElementById("sudoku-input");
    sudoku.value = "5";
    sudoku.dispatchEvent(new Event("input", { bubbles: true }));
    var before = document.querySelector(".is-snake-head").id;
    document.getElementById("snake-start").click();
    setTimeout(function () {
      var board = document.getElementById("snake-board");
      window.postMessage({ type: "openos:patch", requestId: "game-patch", patch: { baseRevision: 1, revision: 2, ops: [{ op: "replace", targetId: "snake-board", html: board.outerHTML }] } }, "*");
      setTimeout(function () { document.getElementById("snake-start").click(); }, 10);
    }, 25);
    setTimeout(function () {
      document.getElementById("snake-pause").click();
      var result = {
        mineRevealed: document.getElementById("mine-0").classList.contains("is-revealed"),
        sudokuSolved: document.getElementById("sudoku-status").textContent.indexOf("Solved") >= 0,
        snakeMoved: document.querySelector(".is-snake-head").id !== before,
        snakePaused: document.getElementById("snake-status").textContent.indexOf("Paused") >= 0,
        patchRebound: document.getElementById("snake-board").children.length === 25
      };
      var output = document.createElement("pre");
      output.id = "game-smoke-result";
      output.textContent = JSON.stringify(result);
      document.body.appendChild(output);
    }, 115);
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
    "--virtual-time-budget=600",
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
  console.log(JSON.stringify({ result: "PASS", ...result }));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
