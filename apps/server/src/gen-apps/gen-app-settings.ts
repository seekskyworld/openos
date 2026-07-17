import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GEN_APP_LIMITS, clampSuggestionCount } from "@openos/shared";
import type { ServerEnv } from "../env.js";

/**
 * Gen Apps 独立设置（不混入 LLM settings，避免互相覆盖）。
 * 文件：<dataDir>/gen-apps-settings.json
 *
 * creativity（生成偏好，0-100）：
 *   0–25   system    仿 macOS 系统自带工具（计算器/备忘录级别的朴素实用）
 *   26–50  appstore  应用商店成熟产品风格
 *   51–75  indie     个人开发者小工具（有个性但可用）
 *   76–100 fantasy   天马行空的想象应用
 */

export type GenAppLanguage = "auto" | "zh" | "en";
export type GenerationMode = "fast" | "agentic";

export type GenAppsPersistedSettings = {
  version: 1;
  suggestionCount: number;
  creativity: number;
  /** 生成应用界面语言：auto=跟随系统语言 */
  appLanguage: GenAppLanguage;
  /** fast=单发；agentic=校验+修复循环 */
  generationMode: GenerationMode;
  /** agentic 最大轮次（含首轮）：1-10，0=无限（模型可自判提前完成，受总时长兜底） */
  agentMaxRounds: number;
};

export const DEFAULT_GEN_APPS_SETTINGS: GenAppsPersistedSettings = {
  version: 1,
  suggestionCount: GEN_APP_LIMITS.suggestionCountDefault,
  creativity: 25,
  appLanguage: "auto",
  generationMode: "agentic",
  agentMaxRounds: 3,
};

export function clampLanguage(value: unknown): GenAppLanguage {
  return value === "zh" || value === "en" ? value : "auto";
}

export function clampMode(value: unknown): GenerationMode {
  return value === "fast" ? "fast" : "agentic";
}

export function clampAgentMaxRounds(value: unknown): number {
  const n = typeof value === "number" ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_GEN_APPS_SETTINGS.agentMaxRounds;
  if (n <= 0) return 0; // 0 = 无限
  return Math.min(10, Math.max(1, n));
}

/**
 * agentic 总时长预算：按轮次伸缩；无限模式 15 分钟兜底。
 * 流式后网关不再限时，单轮慢速上游（大制品 4-6 分钟）也应能跑完；
 * 断流卡死由 llm-core idle 超时（60s）负责，总预算只防失控循环。
 */
export function agenticBudgetMs(agentMaxRounds: number): number {
  if (agentMaxRounds === 0) return 1_500_000;
  return Math.min(1_500_000, 720_000 + Math.max(0, agentMaxRounds - 3) * 120_000);
}

export type CreativityTier = "system" | "appstore" | "indie" | "fantasy";

export function creativityTier(value: number): CreativityTier {
  if (value <= 25) return "system";
  if (value <= 50) return "appstore";
  if (value <= 75) return "indie";
  return "fantasy";
}

function settingsPath(env: ServerEnv): string {
  const base = env.dataDir || join(process.cwd(), ".openos");
  return join(base, "gen-apps-settings.json");
}

export function loadGenAppsSettings(env: ServerEnv): GenAppsPersistedSettings {
  try {
    const path = settingsPath(env);
    if (!existsSync(path)) return { ...DEFAULT_GEN_APPS_SETTINGS };
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<GenAppsPersistedSettings>;
    return {
      version: 1,
      suggestionCount: clampSuggestionCount(raw.suggestionCount),
      creativity: clampCreativity(raw.creativity),
      appLanguage: clampLanguage(raw.appLanguage),
      generationMode: clampMode(raw.generationMode),
      agentMaxRounds: clampAgentMaxRounds(raw.agentMaxRounds),
    };
  } catch {
    return { ...DEFAULT_GEN_APPS_SETTINGS };
  }
}

export function saveGenAppsSettings(
  env: ServerEnv,
  update: Partial<
    Pick<
      GenAppsPersistedSettings,
      | "suggestionCount"
      | "creativity"
      | "appLanguage"
      | "generationMode"
      | "agentMaxRounds"
    >
  >,
): GenAppsPersistedSettings {
  const current = loadGenAppsSettings(env);
  const next: GenAppsPersistedSettings = {
    version: 1,
    suggestionCount:
      update.suggestionCount !== undefined
        ? clampSuggestionCount(update.suggestionCount)
        : current.suggestionCount,
    creativity:
      update.creativity !== undefined
        ? clampCreativity(update.creativity)
        : current.creativity,
    appLanguage:
      update.appLanguage !== undefined
        ? clampLanguage(update.appLanguage)
        : current.appLanguage,
    generationMode:
      update.generationMode !== undefined
        ? clampMode(update.generationMode)
        : current.generationMode,
    agentMaxRounds:
      update.agentMaxRounds !== undefined
        ? clampAgentMaxRounds(update.agentMaxRounds)
        : current.agentMaxRounds,
  };
  const path = settingsPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function clampCreativity(value: unknown): number {
  const n = typeof value === "number" ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_GEN_APPS_SETTINGS.creativity;
  return Math.min(100, Math.max(0, n));
}

/**
 * creativity → 采样温度：
 * 系统工具需要稳定收敛（低温），天马行空需要发散（高温）。
 * suggest 用满档温度；generate 略降（代码正确性优先）。
 */
export function creativityTemperature(value: number): {
  suggest: number;
  generate: number;
} {
  const tier = creativityTier(value);
  switch (tier) {
    case "system":
      return { suggest: 0.3, generate: 0.2 };
    case "appstore":
      return { suggest: 0.6, generate: 0.3 };
    case "indie":
      return { suggest: 0.85, generate: 0.4 };
    case "fantasy":
      return { suggest: 1.1, generate: 0.5 };
  }
}
