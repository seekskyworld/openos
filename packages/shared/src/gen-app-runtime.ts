import { GEN_APP_RUNTIME_VERSION, GEN_APP_UI_KIT_VERSION } from "./gen-apps.js";

/**
 * OpenOS UI Kit V1：生成应用共享的视觉与交互语言。
 * 模型只输出语义标记；样式和通用行为由可信运行时承担。
 */
export const GEN_APP_UI_KIT_CSS = String.raw`
:root {
  color-scheme: light dark;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  --os-bg: #f5f5f7;
  --os-surface: rgba(255, 255, 255, 0.94);
  --os-surface-2: #ffffff;
  --os-sidebar: rgba(235, 235, 239, 0.92);
  --os-border: rgba(60, 60, 67, 0.18);
  --os-text: #1d1d1f;
  --os-muted: #6e6e73;
  --os-accent: #007aff;
  --os-danger: #d70015;
  --os-success: #248a3d;
  --os-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
  --os-radius: 8px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --os-bg: #1c1c1e;
    --os-surface: rgba(44, 44, 46, 0.96);
    --os-surface-2: #2c2c2e;
    --os-sidebar: rgba(36, 36, 38, 0.96);
    --os-border: rgba(235, 235, 245, 0.16);
    --os-text: #f5f5f7;
    --os-muted: #aeaeb2;
    --os-accent: #0a84ff;
    --os-danger: #ff453a;
    --os-success: #30d158;
    --os-shadow: 0 12px 34px rgba(0, 0, 0, 0.32);
  }
}
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
body { background: var(--os-bg); color: var(--os-text); font-size: 13px; }
button, input, select, textarea { font: inherit; letter-spacing: 0; }
button { color: inherit; }
#openos-root { width: 100%; height: 100%; overflow: auto; }
.os-app { width: 100%; min-height: 100%; background: var(--os-bg); }
.os-column { display: flex; flex-direction: column; min-height: 0; }
.os-row { display: flex; align-items: center; min-width: 0; }
.os-fill { flex: 1; min-width: 0; min-height: 0; }
.os-split { display: grid; grid-template-columns: minmax(150px, 220px) minmax(0, 1fr); min-height: 100%; }
.os-sidebar { padding: 12px; background: var(--os-sidebar); border-right: 1px solid var(--os-border); overflow: auto; }
.os-main { padding: 16px; min-width: 0; overflow: auto; }
.os-toolbar { min-height: 44px; display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid var(--os-border); background: var(--os-surface); position: sticky; top: 0; z-index: 5; }
.os-toolbar-title { font-size: 15px; font-weight: 650; margin-right: auto; }
.os-section { padding: 14px 0; }
.os-section + .os-section { border-top: 1px solid var(--os-border); }
.os-heading { margin: 0 0 10px; font-size: 17px; line-height: 1.25; }
.os-subheading { margin: 0 0 8px; font-size: 13px; font-weight: 650; }
.os-muted { color: var(--os-muted); }
.os-card { padding: 14px; border: 1px solid var(--os-border); border-radius: var(--os-radius); background: var(--os-surface-2); box-shadow: 0 1px 2px rgba(0,0,0,.04); }
.os-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
.os-list { display: flex; flex-direction: column; gap: 1px; margin: 0; padding: 0; list-style: none; }
.os-list-item { min-height: 36px; display: flex; align-items: center; gap: 9px; padding: 7px 9px; border-radius: 6px; cursor: default; }
.os-list-item:hover { background: rgba(120,120,128,.12); }
.os-list-item.is-selected { background: var(--os-accent); color: #fff; }
.os-list-item.is-complete { color: var(--os-muted); text-decoration: line-through; }
.os-button, button.os-button { min-height: 30px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--os-border); border-radius: 6px; padding: 4px 11px; background: var(--os-surface-2); cursor: pointer; }
.os-button:hover { filter: brightness(.96); }
.os-button:active { transform: translateY(1px); }
.os-button.os-primary { color: #fff; border-color: transparent; background: var(--os-accent); }
.os-button.os-danger { color: var(--os-danger); }
.os-icon-button { width: 30px; height: 30px; display: inline-grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; cursor: pointer; }
.os-icon-button:hover { background: rgba(120,120,128,.14); }
.os-field { display: grid; gap: 5px; margin-bottom: 10px; }
.os-field > label { color: var(--os-muted); font-size: 12px; }
.os-input, .os-select, .os-textarea, input:not([type]), input[type="text"], input[type="search"], input[type="number"], select, textarea { width: 100%; min-height: 30px; border: 1px solid var(--os-border); border-radius: 6px; padding: 5px 8px; color: var(--os-text); background: var(--os-surface-2); outline: none; }
.os-input:focus, .os-select:focus, .os-textarea:focus, input:focus, select:focus, textarea:focus { border-color: var(--os-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--os-accent) 22%, transparent); }
.os-search { position: relative; flex: 1; max-width: 420px; }
.os-search input { padding-left: 28px; }
.os-search::before { content: "⌕"; position: absolute; left: 9px; top: 5px; color: var(--os-muted); pointer-events: none; z-index: 1; }
.os-tabs { display: flex; gap: 3px; padding: 3px; border-radius: 7px; background: rgba(120,120,128,.13); }
.os-tab { min-height: 26px; flex: 1; border: 0; border-radius: 5px; padding: 3px 10px; color: var(--os-muted); background: transparent; cursor: pointer; }
.os-tab.is-active { color: var(--os-text); background: var(--os-surface-2); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.os-tab-panel[hidden] { display: none !important; }
.os-badge { display: inline-flex; align-items: center; min-height: 20px; border-radius: 10px; padding: 2px 7px; color: var(--os-muted); background: rgba(120,120,128,.14); font-size: 11px; }
.os-status { min-height: 24px; display: flex; align-items: center; gap: 8px; padding: 3px 9px; border-top: 1px solid var(--os-border); color: var(--os-muted); background: var(--os-surface); font-size: 11px; }
.os-table { width: 100%; border-collapse: collapse; background: var(--os-surface-2); }
.os-table th, .os-table td { padding: 8px 9px; border-bottom: 1px solid var(--os-border); text-align: left; }
.os-table th { color: var(--os-muted); font-size: 11px; font-weight: 650; }
.os-empty { display: grid; place-items: center; min-height: 160px; padding: 24px; color: var(--os-muted); text-align: center; }
.os-modal[hidden] { display: none !important; }
.os-modal { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.28); }
.os-modal-dialog { width: min(420px, 100%); max-height: 80vh; overflow: auto; padding: 16px; border: 1px solid var(--os-border); border-radius: var(--os-radius); background: var(--os-surface-2); box-shadow: var(--os-shadow); }
.os-toast-region { position: fixed; right: 12px; bottom: 12px; z-index: 30; display: grid; gap: 7px; pointer-events: none; }
.os-toast { max-width: 320px; padding: 9px 12px; border: 1px solid var(--os-border); border-radius: 7px; background: var(--os-surface-2); box-shadow: var(--os-shadow); animation: os-toast-in .16s ease-out; }
.os-progress { height: 4px; overflow: hidden; border-radius: 2px; background: rgba(120,120,128,.18); }
.os-progress > span { display: block; width: var(--value, 0%); height: 100%; background: var(--os-accent); transition: width .2s ease; }
.os-skeleton { border-radius: 5px; color: transparent !important; background: linear-gradient(90deg, rgba(120,120,128,.12), rgba(120,120,128,.22), rgba(120,120,128,.12)); background-size: 220% 100%; animation: os-shimmer 1.25s linear infinite; }
.os-game-grid { display: grid; gap: 1px; width: min(100%, 520px); margin: 8px auto; overflow: hidden; border: 1px solid var(--os-border); border-radius: 6px; background: var(--os-border); }
.os-game-cols-9 { grid-template-columns: repeat(9, minmax(0, 1fr)); }
.os-game-cols-16 { grid-template-columns: repeat(16, minmax(0, 1fr)); }
.os-game-cols-20 { grid-template-columns: repeat(20, minmax(0, 1fr)); }
.os-game-cell { min-width: 0; width: 100%; aspect-ratio: 1; display: grid; place-items: center; border: 0; border-radius: 0; padding: 0; color: var(--os-text); background: var(--os-surface-2); font-weight: 700; text-align: center; }
button.os-game-cell { cursor: pointer; }
button.os-game-cell:hover { background: color-mix(in srgb, var(--os-accent) 14%, var(--os-surface-2)); }
.os-minesweeper .os-game-cell.is-revealed { background: var(--os-bg); cursor: default; }
.os-minesweeper .os-game-cell.is-mine { color: #fff; background: var(--os-danger); }
.os-sudoku { width: min(100%, 470px); gap: 1px; border: 2px solid var(--os-text); }
.os-sudoku .os-game-cell { font-size: 16px; outline: none; }
.os-sudoku .os-game-given { color: var(--os-text); background: var(--os-sidebar); opacity: 1; }
.os-sudoku .os-game-cell.is-error { color: var(--os-danger); background: color-mix(in srgb, var(--os-danger) 12%, var(--os-surface-2)); }
.os-sudoku .os-game-box-right { border-right: 2px solid var(--os-text); }
.os-sudoku .os-game-box-bottom { border-bottom: 2px solid var(--os-text); }
.os-snake { width: min(100%, 620px); aspect-ratio: 20 / 14; }
.os-snake-cell { min-width: 0; background: var(--os-surface-2); }
.os-snake-cell.is-snake { background: var(--os-accent); }
.os-snake-cell.is-snake-head { background: var(--os-success); }
.os-snake-cell.is-food { background: var(--os-danger); border-radius: 50%; transform: scale(.68); }
.os-game-controls { justify-content: center; gap: 4px; }
.is-busy { opacity: .66; pointer-events: none; }
.is-hidden, [hidden] { display: none !important; }
@keyframes os-shimmer { to { background-position: -220% 0; } }
@keyframes os-toast-in { from { opacity: 0; transform: translateY(5px); } }
@media (max-width: 560px) {
  .os-split { grid-template-columns: 1fr; }
  .os-sidebar { border-right: 0; border-bottom: 1px solid var(--os-border); }
  .os-main { padding: 12px; }
  .os-grid { grid-template-columns: 1fr; }
}
`;

/**
 * 固定 iframe 内的可信运行时。CSP 只允许该 nonce 脚本，模型标记中的脚本和 on* 属性无法执行。
 */
export const GEN_APP_ACTION_RUNTIME = String.raw`
(function () {
  "use strict";
  var root = document.getElementById("openos-root");
  var toastRegion = document.getElementById("openos-toasts");
  var sessionId = "";
  var revision = 0;
  var interactionMode = "hybrid";
  var state = Object.create(null);
  var gameState = Object.create(null);
  var activeSnakeBoardId = "";
  var pending = Object.create(null);
  var requestSeq = 0;
  var activePatchRequestId = "";

  function send(type, payload) {
    parent.postMessage({ type: type, payload: payload }, "*");
  }
  function releasePatchRequest(requestId) {
    if (activePatchRequestId === requestId) activePatchRequestId = "";
  }
  function byId(id) { return id ? document.getElementById(id) : null; }
  var removedTags = { SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, BASE: 1, IFRAME: 1, FRAME: 1, OBJECT: 1, EMBED: 1, FORM: 1, SVG: 1, MATH: 1, CANVAS: 1, TEMPLATE: 1 };
  function sanitizeMarkup(markup) {
    var source = String(markup || "").replace(/^\s*\x60\x60\x60(?:html)?\s*/i, "").replace(/\x60\x60\x60\s*$/i, "");
    var template = document.createElement("template");
    template.innerHTML = source;
    var elements = Array.prototype.slice.call(template.content.querySelectorAll("*"));
    var seenIds = Object.create(null);
    seenIds["openos-root"] = 1;
    seenIds["openos-toasts"] = 1;
    var idAliases = Object.create(null);
    var generatedId = 0;
    elements.forEach(function (element) {
      if (element.tagName === "FORM") { element.replaceWith.apply(element, Array.prototype.slice.call(element.childNodes)); return; }
      if (removedTags[element.tagName]) { element.remove(); return; }
      Array.prototype.slice.call(element.attributes).forEach(function (attribute) {
        var name = attribute.name.toLowerCase();
        if (name.indexOf("on") === 0 || name === "style" || name === "href" || name === "src" || name === "srcset") element.removeAttribute(attribute.name);
      });
      var originalId = String(element.id || "").trim();
      var normalizedId = originalId.replace(/\s+/g, "-").slice(0, 120);
      if (normalizedId) {
        var reservedId = normalizedId === "openos-root" || normalizedId === "openos-toasts";
        var duplicateOriginal = Boolean(seenIds[normalizedId]) && !reservedId;
        var preferred = reservedId ? "app-" + normalizedId : normalizedId;
        var candidate = preferred;
        while (seenIds[candidate]) candidate = preferred + "-" + (++generatedId);
        element.id = candidate;
        seenIds[candidate] = 1;
        if (!duplicateOriginal && originalId !== candidate && typeof idAliases[originalId] === "undefined") idAliases[originalId] = candidate;
      }
      if (element.tagName === "BUTTON" && !element.getAttribute("type")) element.setAttribute("type", "button");
    });
    elements.forEach(function (element) {
      if (!element.isConnected && !template.content.contains(element)) return;
      ["data-target", "data-source", "for"].forEach(function (name) {
        var value = String(element.getAttribute(name) || "").trim();
        if (value) element.setAttribute(name, idAliases[value] || value);
      });
      ["aria-controls", "aria-describedby", "aria-labelledby", "aria-owns"].forEach(function (name) {
        var value = String(element.getAttribute(name) || "").trim();
        if (value) element.setAttribute(name, value.split(/\s+/).map(function (token) { return idAliases[token] || token; }).join(" "));
      });
    });
    return template.innerHTML;
  }
  function asInput(node) {
    return node && (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.tagName === "SELECT") ? node : null;
  }
  function valueFor(node) {
    var input = asInput(node);
    if (!input) return node && node.getAttribute ? (node.getAttribute("data-value") || node.textContent || "") : "";
    return input.type === "checkbox" ? String(input.checked) : String(input.value || "");
  }
  function showToast(message) {
    var item = document.createElement("div");
    item.className = "os-toast";
    item.textContent = String(message || "Done");
    toastRegion.appendChild(item);
    setTimeout(function () { item.remove(); }, 2200);
  }
  function targetFor(node) { return byId(node.getAttribute("data-target")); }
  function sourceFor(node) { return byId(node.getAttribute("data-source")); }
  function selectTab(node) {
    var target = targetFor(node);
    var group = node.closest(".os-tabs") || node.parentElement;
    if (group) {
      var tabs = group.querySelectorAll('[data-action="tabs.select"]');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle("is-active", tabs[i] === node);
        tabs[i].setAttribute("aria-selected", tabs[i] === node ? "true" : "false");
      }
    }
    var scope = node.closest(".os-app") || document;
    var panels = scope.querySelectorAll(".os-tab-panel");
    for (var j = 0; j < panels.length; j++) panels[j].hidden = panels[j] !== target;
  }
  function evaluateExpression(expression) {
    var source = String(expression || "").replace(/×/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
    if (!source || !/^[0-9.+\-*/%()]+$/.test(source)) return "Error";
    var tokens = source.match(/\d+(?:\.\d+)?|[()+\-*/%]/g) || [];
    var values = [];
    var operators = [];
    var precedence = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2 };
    function apply() {
      var op = operators.pop();
      var b = values.pop();
      var a = values.pop();
      if (typeof a !== "number" || typeof b !== "number") throw new Error("bad expression");
      if (op === "+") values.push(a + b);
      else if (op === "-") values.push(a - b);
      else if (op === "*") values.push(a * b);
      else if (op === "/") values.push(b === 0 ? NaN : a / b);
      else values.push(b === 0 ? NaN : a % b);
    }
    try {
      for (var i = 0; i < tokens.length; i++) {
        var token = tokens[i];
        if (/^\d/.test(token)) values.push(Number(token));
        else if (token === "(") operators.push(token);
        else if (token === ")") {
          while (operators.length && operators[operators.length - 1] !== "(") apply();
          if (operators.pop() !== "(") throw new Error("unbalanced");
        } else {
          while (operators.length && operators[operators.length - 1] !== "(" && precedence[operators[operators.length - 1]] >= precedence[token]) apply();
          operators.push(token);
        }
      }
      while (operators.length) apply();
      var result = values.length === 1 ? values[0] : NaN;
      return Number.isFinite(result) ? String(Math.round(result * 1e10) / 1e10) : "Error";
    } catch (_) { return "Error"; }
  }
  function runListAction(action, node, target, value) {
    if (action.indexOf("list.") !== 0) return null;
    if (action === "list.select") {
      var item = node.closest(".os-list-item") || node;
      var list = item.parentElement;
      if (list) Array.prototype.forEach.call(list.children, function (child) { child.classList.toggle("is-selected", child === item); });
      return true;
    }
    if (action === "list.remove") {
      var removable = node.closest(".os-list-item") || target;
      if (!removable) return false;
      removable.remove();
      return true;
    }
    if (action === "list.toggle") {
      var row = node.closest(".os-list-item") || target;
      if (!row) return false;
      row.classList.toggle("is-complete");
      return true;
    }
    if (action === "list.add") {
      if (!target) return false;
      var text = value.trim();
      if (!text) return true;
      var itemNode = document.createElement("div");
      itemNode.className = "os-list-item";
      itemNode.textContent = text;
      target.appendChild(itemNode);
      var source = sourceFor(node);
      if (asInput(source)) source.value = "";
      return true;
    }
    return false;
  }
  function runCalculatorAction(action, target, value) {
    if (action.indexOf("calc.") !== 0) return null;
    if (!target) return false;
    var expression = target.getAttribute("data-expression") || "";
    if (action === "calc.clear") expression = "";
    else if (action === "calc.backspace") expression = expression.slice(0, -1);
    else if (action === "calc.evaluate") expression = evaluateExpression(expression);
    else expression += value;
    target.setAttribute("data-expression", expression === "Error" ? "" : expression);
    target.textContent = expression || "0";
    return true;
  }
  function gameKey(board) { return board ? "game:" + board.id : ""; }
  function gameStatus(board, id) {
    var app = board && board.closest(".os-app");
    return app ? app.querySelector("#" + id) : null;
  }
  function seededRandom(seed) {
    var value = Number(seed) || 1;
    return function () {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 4294967296;
    };
  }
  function resetMinesweeper(board) {
    if (!board) return false;
    var key = gameKey(board);
    gameState[key] = null;
    Array.prototype.forEach.call(board.children, function (cell) {
      cell.textContent = "";
      cell.disabled = false;
      cell.classList.remove("is-revealed", "is-mine");
      cell.removeAttribute("data-mine");
    });
    var status = gameStatus(board, "mine-status");
    if (status) status.textContent = "Ready / 准备";
    return true;
  }
  function ensureMinesweeper(board, safeIndex) {
    var key = gameKey(board);
    if (gameState[key]) return gameState[key];
    var total = Math.min(board.children.length, 1024);
    var mineCount = Math.max(1, Math.min(total - 1, Number(board.getAttribute("data-mines")) || 10));
    var random = seededRandom(Number(board.getAttribute("data-seed")) + safeIndex);
    var mines = Object.create(null);
    while (Object.keys(mines).length < mineCount) {
      var candidate = Math.floor(random() * total);
      if (candidate !== safeIndex) mines[candidate] = 1;
    }
    var session = { mines: mines, revealed: Object.create(null), mineCount: mineCount, done: false };
    gameState[key] = session;
    return session;
  }
  function mineNeighbors(index, rows, columns) {
    var output = [];
    var row = Math.floor(index / columns);
    var column = index % columns;
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      var nextRow = row + dr;
      var nextColumn = column + dc;
      if (nextRow >= 0 && nextRow < rows && nextColumn >= 0 && nextColumn < columns) output.push(nextRow * columns + nextColumn);
    }
    return output;
  }
  function revealMineCell(node, board) {
    if (!board) return false;
    var index = Number(node.getAttribute("data-index"));
    var boundedTotal = Math.min(board.children.length, 1024);
    if (!Number.isInteger(index) || index < 0 || index >= boundedTotal) return false;
    var rows = Math.min(32, Math.max(1, Number(board.getAttribute("data-rows")) || 9));
    var columns = Math.min(32, Math.max(1, Number(board.getAttribute("data-columns")) || 9));
    var session = ensureMinesweeper(board, index);
    if (session.done || session.revealed[index]) return true;
    if (session.mines[index]) {
      session.done = true;
      Array.prototype.forEach.call(board.children, function (cell, cellIndex) {
        if (session.mines[cellIndex]) { cell.textContent = "✹"; cell.classList.add("is-mine"); }
        cell.disabled = true;
      });
      var lost = gameStatus(board, "mine-status");
      if (lost) lost.textContent = "Game over / 踩雷";
      return true;
    }
    var queue = [index];
    while (queue.length) {
      var current = queue.shift();
      if (session.revealed[current] || session.mines[current]) continue;
      session.revealed[current] = 1;
      var cell = board.children[current];
      if (!cell) continue;
      var neighbors = mineNeighbors(current, rows, columns);
      var nearby = neighbors.filter(function (next) { return Boolean(session.mines[next]); }).length;
      cell.textContent = nearby ? String(nearby) : "";
      cell.disabled = true;
      cell.classList.add("is-revealed");
      if (!nearby) neighbors.forEach(function (next) { if (!session.revealed[next]) queue.push(next); });
    }
    if (Object.keys(session.revealed).length === board.children.length - session.mineCount) {
      session.done = true;
      var won = gameStatus(board, "mine-status");
      if (won) won.textContent = "You win / 胜利";
    }
    return true;
  }
  function runSudoku(action, node, board) {
    if (action === "game.sudoku.reset") {
      if (!board) return false;
      Array.prototype.forEach.call(board.querySelectorAll('[data-action="game.sudoku.input"]'), function (cell) {
        cell.value = "";
        cell.classList.remove("is-error");
      });
      var resetStatus = gameStatus(board, "sudoku-status");
      if (resetStatus) resetStatus.textContent = "Fill the grid / 填写空格";
      return true;
    }
    if (action !== "game.sudoku.input") return null;
    var value = String(node.value || "").replace(/[^1-9]/g, "").slice(-1);
    node.value = value;
    node.classList.toggle("is-error", Boolean(value) && value !== node.getAttribute("data-solution"));
    var app = node.closest(".os-app");
    var editable = app ? app.querySelectorAll('[data-action="game.sudoku.input"]') : [];
    var solved = editable.length > 0 && Array.prototype.every.call(editable, function (cell) {
      return cell.value === cell.getAttribute("data-solution");
    });
    var status = board ? gameStatus(board, "sudoku-status") : null;
    if (status) status.textContent = solved ? "Solved / 完成" : "Fill the grid / 填写空格";
    return true;
  }
  function snakeSession(board) {
    var key = gameKey(board);
    if (gameState[key]) return gameState[key];
    var rows = Math.min(32, Math.max(2, Number(board.getAttribute("data-rows")) || 14));
    var columns = Math.min(32, Math.max(3, Number(board.getAttribute("data-columns")) || 20));
    var center = Math.floor(rows / 2) * columns + Math.floor(columns / 2);
    gameState[key] = { board: board, rows: rows, columns: columns, snake: [center, center - 1, center - 2], direction: "right", nextDirection: "right", food: center + 4, score: 0, timer: null, running: false };
    return gameState[key];
  }
  function renderSnake(session) {
    Array.prototype.forEach.call(session.board.children, function (cell) { cell.classList.remove("is-snake", "is-snake-head", "is-food"); });
    session.snake.forEach(function (index, part) {
      var cell = session.board.children[index];
      if (cell) cell.classList.add("is-snake", part === 0 ? "is-snake-head" : "is-snake");
    });
    var food = session.board.children[session.food];
    if (food) food.classList.add("is-food");
    var score = gameStatus(session.board, "snake-score");
    if (score) score.textContent = String(session.score);
  }
  function stopSnake(session, message) {
    if (session.timer) clearInterval(session.timer);
    session.timer = null;
    session.running = false;
    var status = gameStatus(session.board, "snake-status");
    if (status) status.textContent = message;
  }
  function placeSnakeFood(session) {
    var free = [];
    for (var index = 0; index < session.rows * session.columns; index++) if (session.snake.indexOf(index) === -1) free.push(index);
    session.food = free.length ? free[Math.floor(Math.random() * free.length)] : -1;
  }
  function tickSnake(session) {
    var opposite = { up: "down", down: "up", left: "right", right: "left" };
    if (opposite[session.direction] !== session.nextDirection) session.direction = session.nextDirection;
    var head = session.snake[0];
    var row = Math.floor(head / session.columns);
    var column = head % session.columns;
    if (session.direction === "up") row--;
    else if (session.direction === "down") row++;
    else if (session.direction === "left") column--;
    else column++;
    if (row < 0 || row >= session.rows || column < 0 || column >= session.columns) { stopSnake(session, "Game over / 结束"); return; }
    var next = row * session.columns + column;
    var grows = next === session.food;
    var body = grows ? session.snake : session.snake.slice(0, -1);
    if (body.indexOf(next) !== -1) { stopSnake(session, "Game over / 结束"); return; }
    session.snake.unshift(next);
    if (grows) { session.score++; placeSnakeFood(session); }
    else session.snake.pop();
    renderSnake(session);
  }
  function resetSnake(board) {
    if (!board) return false;
    var key = gameKey(board);
    var previous = gameState[key];
    if (previous && previous.timer) clearInterval(previous.timer);
    gameState[key] = null;
    var session = snakeSession(board);
    activeSnakeBoardId = board.id;
    renderSnake(session);
    stopSnake(session, "Ready / 准备");
    return true;
  }
  function setSnakeDirection(board, value) {
    if (!board) return false;
    var session = snakeSession(board);
    if ({ up: 1, down: 1, left: 1, right: 1 }[value]) session.nextDirection = value;
    activeSnakeBoardId = board.id;
    board.focus();
    return true;
  }
  function runSnake(action, board, value) {
    if (action.indexOf("game.snake.") !== 0) return null;
    if (action === "game.snake.reset") return resetSnake(board);
    if (!board) return false;
    var session = snakeSession(board);
    activeSnakeBoardId = board.id;
    if (action === "game.snake.direction") return setSnakeDirection(board, value);
    if (action === "game.snake.pause") { stopSnake(session, "Paused / 暂停"); return true; }
    if (action === "game.snake.start") {
      if (!session.running) {
        session.running = true;
        var status = gameStatus(board, "snake-status");
        if (status) status.textContent = "Running / 进行中";
        var speed = Math.min(1000, Math.max(50, Number(board.getAttribute("data-speed")) || 140));
        session.timer = setInterval(function () { tickSnake(session); }, speed);
      }
      board.focus();
      return true;
    }
    return false;
  }
  function runGameAction(action, node, target, value) {
    if (action === "game.minesweeper.reset") return resetMinesweeper(target);
    if (action === "game.minesweeper.reveal") return revealMineCell(node, target);
    var sudoku = runSudoku(action, node, target || node.closest(".os-sudoku"));
    if (sudoku !== null) return sudoku;
    return runSnake(action, target, value);
  }
  function findGameNode(scope, selector) {
    if (scope.matches && scope.matches(selector)) return scope;
    return scope.querySelector(selector);
  }
  function initializeGamesWithin(scope) {
    var mine = findGameNode(scope, ".os-minesweeper");
    if (mine) resetMinesweeper(mine);
    var snake = findGameNode(scope, ".os-snake");
    if (snake) resetSnake(snake);
  }
  function disposeGamesWithin(scope) {
    var boards = [];
    if (scope.matches && scope.matches(".os-minesweeper, .os-snake")) boards.push(scope);
    Array.prototype.forEach.call(scope.querySelectorAll ? scope.querySelectorAll(".os-minesweeper, .os-snake") : [], function (board) { boards.push(board); });
    boards.forEach(function (board) {
      var key = gameKey(board);
      var session = gameState[key];
      if (session && session.timer) clearInterval(session.timer);
      delete gameState[key];
      if (activeSnakeBoardId === board.id) activeSnakeBoardId = "";
    });
  }
  function disposeGames() {
    disposeGamesWithin(root);
    gameState = Object.create(null);
    activeSnakeBoardId = "";
  }
  function runLocal(action, node) {
    var target = targetFor(node);
    var value = node.getAttribute("data-value") || valueFor(sourceFor(node)) || valueFor(node);
    if (action === "tabs.select") { selectTab(node); return true; }
    if (action === "toggle") {
      if (!target) return false;
      target.hidden = !target.hidden;
      node.setAttribute("aria-expanded", target.hidden ? "false" : "true");
      return true;
    }
    if (action === "modal.open") { if (!target) return false; target.hidden = false; return true; }
    if (action === "modal.close") {
      var modal = target || node.closest(".os-modal");
      if (!modal) return false;
      modal.setAttribute("hidden", "");
      return true;
    }
    var listResult = runListAction(action, node, target, value);
    if (listResult !== null) return listResult;
    if (action === "filter") {
      if (!target) return false;
      var query = String(value || "").toLowerCase();
      Array.prototype.forEach.call(target.children, function (child) { child.hidden = !String(child.textContent || "").toLowerCase().includes(query); });
      return true;
    }
    if (action === "sort") {
      if (!target) return false;
      var children = Array.prototype.slice.call(target.children);
      children.sort(function (a, b) { return String(a.textContent || "").localeCompare(String(b.textContent || "")); });
      children.forEach(function (child) { target.appendChild(child); });
      return true;
    }
    if (action === "counter.increment" || action === "counter.decrement") {
      if (!target) return false;
      var next = Number(target.textContent || "0") + (action === "counter.increment" ? 1 : -1);
      target.textContent = String(next);
      return true;
    }
    var calculatorResult = runCalculatorAction(action, target, value);
    if (calculatorResult !== null) return calculatorResult;
    var gameResult = runGameAction(action, node, target, value);
    if (gameResult !== null) return gameResult;
    if (action === "state.set") {
      var key = node.getAttribute("data-key") || node.id;
      state[key] = value;
      if (target) target.textContent = value;
      return true;
    }
    if (action === "toast") { showToast(value || node.getAttribute("aria-label") || "Done"); return true; }
    return false;
  }
  function requestAi(node, event, action, completion) {
    if (!node.id || activePatchRequestId || node.classList.contains("is-busy")) return null;
    var requestId = "ai-" + (++requestSeq) + "-" + Date.now();
    activePatchRequestId = requestId;
    pending[requestId] = { node: node, resolve: completion && completion.resolve, reject: completion && completion.reject };
    node.classList.add("is-busy");
    var input = asInput(event.target);
    var source = sourceFor(node);
    var patchTarget = targetFor(node) || node;
    send("openos:interact", {
      requestId: requestId,
      runtimeSessionId: sessionId,
      baseRevision: revision,
      event: {
        type: event.type === "input" ? "input" : event.type === "change" ? "change" : "click",
        targetId: node.id,
        action: action || "ai.patch",
        value: completion && completion.value !== undefined ? String(completion.value) : input ? String(input.value || "") : (node.getAttribute("data-value") || valueFor(source) || undefined),
        checked: input && input.type === "checkbox" ? Boolean(input.checked) : undefined,
        currentHtml: patchTarget.outerHTML
      }
    });
    return requestId;
  }
  function onAction(event) {
    var target = event.target && event.target.closest ? event.target.closest("[data-action],[data-href]") : null;
    if (!target || !root.contains(target)) return;
    var action = target.getAttribute("data-action") || (target.hasAttribute("data-href") ? "ai.generate" : "");
    if (event.type === "click" && target.tagName === "A") event.preventDefault();
    if (action === "ai.generate" || action === "ai.patch" || action === "web.search" || action === "web.open") {
      if (event.type !== "input" || target.getAttribute("data-trigger") === "input") requestAi(target, event, action);
    }
    else if (event.type !== "click" && action !== "filter" && action !== "state.set" && action !== "game.sudoku.input") {
      if (interactionMode === "improv") requestAi(target, event, action || "ai.patch");
    }
    else if (!runLocal(action, target) && interactionMode === "improv") requestAi(target, event, action || "ai.patch");
  }
  document.addEventListener("click", onAction);
  document.addEventListener("input", onAction);
  document.addEventListener("change", onAction);
  document.addEventListener("keydown", function (event) {
    if (!activeSnakeBoardId || asInput(event.target)) return;
    var directions = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right" };
    var direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    setSnakeDirection(byId(activeSnakeBoardId), direction);
  });

  window.addEventListener("message", function (event) {
    var message = event.data || {};
    if (message.type === "openos:configure") {
      sessionId = String(message.runtimeSessionId || "");
      revision = Number(message.revision || 0);
      interactionMode = message.interactionMode === "improv" ? "improv" : "hybrid";
    } else if (message.type === "openos:render") {
      disposeGames();
      root.innerHTML = sanitizeMarkup(message.markup);
      initializeGamesWithin(root);
      revision = Number(message.revision || 0);
      var renderedRequest = pending[message.requestId];
      if (renderedRequest) {
        if (renderedRequest.node) renderedRequest.node.classList.remove("is-busy");
        delete pending[message.requestId];
        releasePatchRequest(message.requestId);
        if (message.error) {
          if (renderedRequest.reject) renderedRequest.reject(new Error(String(message.error)));
          showToast(message.error);
        } else if (renderedRequest.resolve) {
          renderedRequest.resolve({ revision: revision, resynced: true });
        }
        send("openos:patch-settled", { requestId: message.requestId });
      }
    } else if (message.type === "openos:patch") {
      var patch = message.patch;
      var request = pending[message.requestId];
      var requestNode = request && request.node;
      if (requestNode) requestNode.classList.remove("is-busy");
      if (!patch || patch.baseRevision !== revision || !patch.ops || patch.ops.length !== 1) {
        if (patch && Number(patch.revision) > revision) {
          send("openos:patch-resync", { requestId: message.requestId });
          return;
        }
        delete pending[message.requestId];
        releasePatchRequest(message.requestId);
        if (request && request.reject) request.reject(new Error("Invalid runtime patch"));
        send("openos:patch-settled", { requestId: message.requestId });
        return;
      }
      var op = patch.ops[0];
      var current = byId(op.targetId);
      if (!current) {
        send("openos:patch-resync", { requestId: message.requestId });
        return;
      }
      var template = document.createElement("template");
      template.innerHTML = sanitizeMarkup(op.html).trim();
      var replacement = template.content.firstElementChild;
      if (!replacement || replacement.id !== op.targetId) {
        send("openos:patch-resync", { requestId: message.requestId });
        return;
      }
      disposeGamesWithin(current);
      current.replaceWith(replacement);
      initializeGamesWithin(replacement);
      revision = Number(patch.revision);
      delete pending[message.requestId];
      releasePatchRequest(message.requestId);
      if (request && request.resolve) request.resolve({ targetId: op.targetId, revision: revision });
      send("openos:patch-settled", { requestId: message.requestId });
    } else if (message.type === "openos:patch-error") {
      var failed = pending[message.requestId];
      if (failed && failed.node) failed.node.classList.remove("is-busy");
      delete pending[message.requestId];
      releasePatchRequest(message.requestId);
      if (failed && failed.reject) failed.reject(new Error(String(message.error || "Unable to update")));
      showToast(message.error || "Unable to update");
    }
  });

  window.OpenOS = {
    state: state,
    generate: function (payload) {
      return new Promise(function (resolve, reject) {
        var requestId = "gen-" + (++requestSeq) + "-" + Date.now();
        var handler = function (event) {
          var data = event.data || {};
          if (data.type !== "openos:result" || data.requestId !== requestId) return;
          window.removeEventListener("message", handler);
          if (data.ok) resolve(String(data.fragment || ""));
          else reject(new Error(String(data.error || "generate failed")));
        };
        window.addEventListener("message", handler);
        parent.postMessage({ type: "openos:generate", requestId: requestId, payload: Object.assign({}, payload, { runtimeSessionId: sessionId }) }, "*");
      });
    },
    mount: function (container, markup) { container.innerHTML = sanitizeMarkup(markup); },
    update: function (payload) {
      var target = payload && byId(payload.targetId);
      if (!target) return Promise.reject(new Error("targetId not found"));
      var instruction = String(payload.instruction || payload.prompt || "Update this element");
      if (payload.context) instruction += "\nContext: " + String(payload.context);
      return new Promise(function (resolve, reject) {
        var requestId = requestAi(
          target,
          { type: "click", target: target },
          "ai.patch",
          { value: instruction, resolve: resolve, reject: reject }
        );
        if (!requestId) reject(new Error("update already in progress"));
      });
    }
  };
  send("openos:ready", { runtimeVersion: ${GEN_APP_RUNTIME_VERSION}, kitVersion: ${GEN_APP_UI_KIT_VERSION} });
})();
`;

const RUNTIME_NONCE = "openos-runtime-v2";

export function buildGenAppRuntimeDocument(markup = ""): string {
  return [
    "<!DOCTYPE html>",
    '<html translate="no"><head><meta charset="utf-8">',
    '<meta name="google" content="notranslate">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${RUNTIME_NONCE}'; style-src 'nonce-${RUNTIME_NONCE}'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'">`,
    `<style nonce="${RUNTIME_NONCE}">${GEN_APP_UI_KIT_CSS}</style>`,
    "</head><body>",
    `<main id="openos-root">${markup}</main>`,
    '<div id="openos-toasts" class="os-toast-region" aria-live="polite"></div>',
    `<script nonce="${RUNTIME_NONCE}">${GEN_APP_ACTION_RUNTIME}</script>`,
    "</body></html>",
  ].join("\n");
}
