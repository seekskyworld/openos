import { createHash } from "node:crypto";
import {
  GEN_APP_FORMAT_VERSION,
  GEN_APP_POLICY_VERSION,
  GEN_APP_PROMPT_VERSION,
  GEN_APP_RUNTIME_VERSION,
  GEN_APP_UI_KIT_VERSION,
  type GenAppSuggestion,
} from "@openos/shared";

const GEN_APP_BLUEPRINT_VERSION = 2;

export type GenerationFingerprintInput = {
  query: string;
  suggestion: GenAppSuggestion;
  language: "auto" | "zh" | "en";
  creativity: number;
  profile: "instant" | "agentic";
  /** 不含密钥的模型配置身份；切换供应商/模型后必须自然失效。 */
  generatorKey?: string;
};

function normalize(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function creativityTier(value: number): number {
  if (value <= 25) return 0;
  if (value <= 50) return 1;
  if (value <= 75) return 2;
  return 3;
}

export function createGenerationFingerprint(input: GenerationFingerprintInput): string {
  const payload = {
    query: normalize(input.query),
    name: normalize(input.suggestion.name),
    description: normalize(input.suggestion.description),
    language: input.language,
    creativityTier: creativityTier(input.creativity),
    profile: input.profile,
    generatorKey: normalize(input.generatorKey ?? "default"),
    promptVersion: GEN_APP_PROMPT_VERSION,
    formatVersion: GEN_APP_FORMAT_VERSION,
    policyVersion: GEN_APP_POLICY_VERSION,
    runtimeVersion: GEN_APP_RUNTIME_VERSION,
    uiKitVersion: GEN_APP_UI_KIT_VERSION,
    blueprintVersion: GEN_APP_BLUEPRINT_VERSION,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createRecipeFingerprint(recipeCacheKey: string): string {
  return createHash("sha256").update(JSON.stringify({
    recipeCacheKey,
    formatVersion: GEN_APP_FORMAT_VERSION,
    policyVersion: GEN_APP_POLICY_VERSION,
    runtimeVersion: GEN_APP_RUNTIME_VERSION,
    uiKitVersion: GEN_APP_UI_KIT_VERSION,
    blueprintVersion: GEN_APP_BLUEPRINT_VERSION,
  })).digest("hex");
}
