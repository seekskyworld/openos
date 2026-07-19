import type { UntrustedArtifact } from "../domain.js";

export type GameEngineId =
  | "game.minesweeper"
  | "game.sudoku"
  | "game.snake";

export type GameRecipe = {
  engine: GameEngineId;
  engineVersion: 1;
  language: "zh" | "en";
  config: Record<string, number>;
};

type EngineComposer = (recipe: GameRecipe) => string;

function minesweeperMarkup(recipe: GameRecipe): string {
  const rows = recipe.config.rows ?? 9;
  const columns = recipe.config.columns ?? 9;
  const mines = recipe.config.mines ?? 10;
  const zh = recipe.language === "zh";
  const cells = Array.from({ length: rows * columns }, (_, index) =>
    `<button id="mine-cell-${index}" class="os-game-cell" type="button" data-action="game.minesweeper.reveal" data-target="mine-board" data-index="${index}" aria-label="${zh ? "未揭开的方格" : "Hidden cell"}"></button>`,
  ).join("");
  return `<main class="os-app os-column">
    <header class="os-toolbar"><strong class="os-toolbar-title">${zh ? "扫雷" : "Minesweeper"}</strong><span id="mine-status" class="os-status">${zh ? "进行中" : "Ready"}</span></header>
    <section class="os-main os-column os-fill">
      <div class="os-row"><span class="os-badge">${zh ? "雷" : "Mines"}: <strong id="mine-count">${mines}</strong></span><span class="os-badge">${rows} × ${columns}</span><button id="mine-reset" class="os-button" type="button" data-action="game.minesweeper.reset" data-target="mine-board">${zh ? "重新开始" : "New game"}</button></div>
      <div id="mine-board" class="os-game-grid os-minesweeper os-game-cols-${columns}" data-engine="game.minesweeper" role="grid" data-rows="${rows}" data-columns="${columns}" data-mines="${mines}" data-seed="20260719">${cells}</div>
    </section>
  </main>`;
}

const SUDOKU_PUZZLE = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SUDOKU_SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

function sudokuMarkup(recipe: GameRecipe): string {
  const zh = recipe.language === "zh";
  const cells = Array.from({ length: 81 }, (_, index) => {
    const value = SUDOKU_PUZZLE[index];
    const row = Math.floor(index / 9);
    const column = index % 9;
    const boxClass = `${column === 2 || column === 5 ? " os-game-box-right" : ""}${row === 2 || row === 5 ? " os-game-box-bottom" : ""}`;
    return value === "0"
      ? `<input id="sudoku-cell-${index}" class="os-game-cell${boxClass}" type="text" value="" data-action="game.sudoku.input" data-index="${index}" data-solution="${SUDOKU_SOLUTION[index]}" aria-label="${zh ? `第 ${row + 1} 行第 ${column + 1} 列` : `Row ${row + 1}, column ${column + 1}`}">`
      : `<input id="sudoku-cell-${index}" class="os-game-cell os-game-given${boxClass}" type="text" value="${value}" disabled aria-label="${value}">`;
  }).join("");
  return `<main class="os-app os-column">
    <header class="os-toolbar"><strong class="os-toolbar-title">${zh ? "数独" : "Sudoku"}</strong><span id="sudoku-status" class="os-status">${zh ? "填写空格" : "Fill the grid"}</span></header>
    <section class="os-main os-column os-fill">
      <div class="os-row"><span class="os-badge">9 × 9</span><button id="sudoku-reset" class="os-button" type="button" data-action="game.sudoku.reset" data-target="sudoku-board">${zh ? "重置" : "Reset"}</button></div>
      <div id="sudoku-board" class="os-game-grid os-sudoku os-game-cols-9" data-engine="game.sudoku" role="grid" data-solution="${SUDOKU_SOLUTION}">${cells}</div>
    </section>
  </main>`;
}

function snakeMarkup(recipe: GameRecipe): string {
  const rows = recipe.config.rows ?? 14;
  const columns = recipe.config.columns ?? 20;
  const speedMs = recipe.config.speedMs ?? 140;
  const zh = recipe.language === "zh";
  const cells = Array.from({ length: rows * columns }, (_, index) =>
    `<div id="snake-cell-${index}" class="os-snake-cell" role="gridcell"></div>`,
  ).join("");
  const directionButton = (id: string, direction: string, label: string) =>
    `<button id="${id}" class="os-icon-button" type="button" data-action="game.snake.direction" data-target="snake-board" data-value="${direction}">${label}</button>`;
  return `<main class="os-app os-column">
    <header class="os-toolbar"><strong class="os-toolbar-title">${zh ? "贪吃蛇" : "Snake"}</strong><span class="os-badge">${zh ? "得分" : "Score"}: <strong id="snake-score">0</strong></span><span id="snake-status" class="os-status">${zh ? "准备" : "Ready"}</span></header>
    <section class="os-main os-column os-fill">
      <div class="os-row"><button id="snake-start" class="os-button os-primary" type="button" data-action="game.snake.start" data-target="snake-board">${zh ? "开始" : "Start"}</button><button id="snake-pause" class="os-button" type="button" data-action="game.snake.pause" data-target="snake-board">${zh ? "暂停" : "Pause"}</button><button id="snake-reset" class="os-button" type="button" data-action="game.snake.reset" data-target="snake-board">${zh ? "重开" : "Reset"}</button></div>
      <div id="snake-board" class="os-game-grid os-snake os-game-cols-${columns}" data-engine="game.snake" role="grid" tabindex="0" data-rows="${rows}" data-columns="${columns}" data-speed="${speedMs}">${cells}</div>
      <div class="os-row os-game-controls">${directionButton("snake-up", "up", "↑")}${directionButton("snake-left", "left", "←")}${directionButton("snake-down", "down", "↓")}${directionButton("snake-right", "right", "→")}</div>
    </section>
  </main>`;
}

const ENGINE_REGISTRY: Record<GameEngineId, EngineComposer> = {
  "game.minesweeper": minesweeperMarkup,
  "game.sudoku": sudokuMarkup,
  "game.snake": snakeMarkup,
};

export function composeGameEngine(recipe: GameRecipe): UntrustedArtifact {
  return {
    html: ENGINE_REGISTRY[recipe.engine](recipe),
    provider: "openos-engine",
    model: `${recipe.engine}@${recipe.engineVersion}`,
    interactionMode: "hybrid",
  };
}
