import type { UntrustedArtifact } from "../domain.js";
import {
  composeGameEngine,
  type GameEngineId,
  type GameRecipe,
} from "./engine-registry.js";

type RecipeInput = {
  query: string;
  name: string;
  description: string;
  language: "auto" | "zh" | "en";
  creativity: number;
};

export type ResolvedAppRecipe = GameRecipe & {
  cacheKey: string;
  artifact: UntrustedArtifact;
};

const GAME_KEYWORDS: Array<[GameEngineId, readonly string[]]> = [
  ["game.minesweeper", ["扫雷", "minesweeper", "mine sweeper"]],
  ["game.sudoku", ["数独", "sudoku"]],
  ["game.snake", ["贪吃蛇", "snake", "snake game", "classic snake"]],
];

function resolveEngine(input: RecipeInput): GameEngineId | null {
  const source = `${input.query} ${input.name} ${input.description}`.normalize("NFKC").toLowerCase();
  const matches = (keyword: string) => {
    if (/[\u3400-\u9fff]/u.test(keyword)) return source.includes(keyword);
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s_-]+");
    return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(source);
  };
  return GAME_KEYWORDS.find(([, keywords]) => keywords.some(matches))?.[0] ?? null;
}

function configFor(engine: GameEngineId, source: string): Record<string, number> {
  const expert = /专家|高级|困难|hard|expert/i.test(source);
  if (engine === "game.minesweeper") {
    return expert
      ? { rows: 16, columns: 16, mines: 40 }
      : { rows: 9, columns: 9, mines: 10 };
  }
  if (engine === "game.snake") return { rows: 14, columns: 20, speedMs: expert ? 90 : 140 };
  return { puzzle: 1 };
}

export function resolveAppRecipe(input: RecipeInput): ResolvedAppRecipe | null {
  const engine = resolveEngine(input);
  if (!engine) return null;
  const language = input.language === "en"
    ? "en"
    : input.language === "zh" || /[\u3400-\u9fff]/u.test(input.query)
      ? "zh"
      : "en";
  const config = configFor(engine, `${input.query} ${input.name}`);
  const recipe: GameRecipe = { engine, engineVersion: 1, language, config };
  return {
    ...recipe,
    cacheKey: JSON.stringify({ engine, engineVersion: 1, language, config }),
    artifact: composeGameEngine(recipe),
  };
}
