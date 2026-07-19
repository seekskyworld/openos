import type { ServerEnv } from "../../env.js";
import { createFastGenAppSuggestionSeeds } from "@openos/shared";
import { coreGenerate, type WireTarget } from "../../llm-core/index.js";
import { resolveEffectiveLlm } from "../../settings-store.js";
import {
  creativityGenerationTemperature,
  creativityTier,
  loadGenAppsSettings,
} from "../gen-app-settings.js";
import { buildGeneratePrompt } from "../prompt-policy.js";
import { genAppError, type UntrustedArtifact, type UntrustedSuggestion } from "../domain.js";
import type {
  ContinuePortInput,
  GenAppGenerator,
  GeneratePortInput,
  SuggestPortInput,
} from "../ports.js";

/**
 * 真实 LLM 生成器（反腐层）：
 * - 候选由共享确定性策略同步生成，不占用重型模型请求
 * - generate/continue 走当前生效的 LLM 配置
 * - Prompt 由 prompt-policy 组装，随设置里的 creativity 档位/语言变化
 */

export class LlmGenAppGenerator implements GenAppGenerator {
  private readonly suggestionCache = new Map<string, { expiresAt: number; values: UntrustedSuggestion[] }>();

  constructor(private readonly env: ServerEnv) {}

  private ensureConfigured() {
    const llm = resolveEffectiveLlm(this.env);
    const configured =
      (Boolean(llm.apiKey) && llm.apiKey !== "no-key") || llm.authStyle === "none";
    if (!configured) {
      throw genAppError(
        "llm_not_configured",
        "No LLM provider configured. Connect one in System Settings.",
        503,
      );
    }
    return llm;
  }

  private wireTarget(llm: ReturnType<typeof resolveEffectiveLlm>): WireTarget {
    return {
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      authStyle: llm.authStyle,
    };
  }

  async suggest(
    input: SuggestPortInput,
    signal: AbortSignal,
  ): Promise<UntrustedSuggestion[]> {
    signal.throwIfAborted();
    const settings = loadGenAppsSettings(this.env);
    const fallback = createFastGenAppSuggestionSeeds({
      query: input.query,
      count: input.count,
      language: settings.appLanguage,
      style: creativityTier(settings.creativity),
    });
    const key = `${input.query.trim().toLocaleLowerCase()}|${input.count}|${settings.appLanguage}|${creativityTier(settings.creativity)}`;
    const cached = this.suggestionCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.values.map((value) => ({ ...value }));
    const llm = resolveEffectiveLlm(this.env);
    const configured = (Boolean(llm.apiKey) && llm.apiKey !== "no-key") || llm.authStyle === "none";
    if (!configured || process.env.OPENOS_GENAPPS_MODEL_SUGGESTIONS === "0") return fallback;
    try {
      const languageHint = settings.appLanguage === "en" ? "English" : settings.appLanguage === "zh" ? "简体中文" : "query language";
      const result = await coreGenerate(
        {
          protocol: llm.protocol,
          target: this.wireTarget(llm),
          timeoutMs: 8_000,
          signal,
        },
        {
          model: llm.model,
          messages: [
            {
              role: "system",
              content: `Return exactly a JSON array of ${input.count} diverse interactive app candidates. Each item must have name, description, iconEmoji, iconTheme, intentKey, routeHint. Use ${languageHint}. routeHint is recipe, composition, or generate. No markdown or explanation.`,
            },
            { role: "user", content: JSON.stringify({ query: input.query, count: input.count }) },
          ],
          temperature: 0.85,
          reasoningEffort: "off",
          maxOutputTokens: 900,
        },
      );
      const fenced = result.text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? result.text;
      const parsed: unknown = JSON.parse(fenced.trim());
      const rows = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" && Array.isArray((parsed as { suggestions?: unknown }).suggestions) ? (parsed as { suggestions: unknown[] }).suggestions : []);
      const values = rows.filter((row): row is UntrustedSuggestion => typeof row === "object" && row !== null).slice(0, input.count) as UntrustedSuggestion[];
      if (values.length === 0) return fallback;
      this.suggestionCache.set(key, { expiresAt: Date.now() + 120_000, values });
      if (this.suggestionCache.size > 100) this.suggestionCache.delete(this.suggestionCache.keys().next().value!);
      return values.map((value) => ({ ...value }));
    } catch {
      return fallback;
    }
  }

  async generate(
    input: GeneratePortInput,
    signal: AbortSignal,
  ): Promise<UntrustedArtifact> {
    const llm = this.ensureConfigured();
    const settings = loadGenAppsSettings(this.env);
    const tier = creativityTier(settings.creativity);
    const prompt = buildGeneratePrompt({
      name: input.name,
      description: input.description,
      query: input.query,
      tier,
      language: settings.appLanguage,
    });

    input.onPhase?.({ phase: "generating" });
    const result = await coreGenerate(
      {
        protocol: llm.protocol,
        target: this.wireTarget(llm),
        timeoutMs: 600_000,
        signal,
        onDelta: input.onDelta,
      },
      {
        model: llm.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: creativityGenerationTemperature(settings.creativity),
        reasoningEffort: "off",
        maxOutputTokens: 2_500,
      },
    );

    return {
      html: result.text,
      provider: llm.provider,
      model: result.model,
      interactionMode: tier === "fantasy" ? "improv" : "hybrid",
    };
  }

  /**
   * 运行时续生成：单轮快速，无修复循环（烂片段重试成本低）。
   * 提示词与会话历史已由 GenAppsService 组装好，本层只是纯粹的模型调用。
   */
  async continueContent(
    input: ContinuePortInput,
    signal: AbortSignal,
  ): Promise<string> {
    const llm = this.ensureConfigured();
    const result = await coreGenerate(
      {
        protocol: llm.protocol,
        target: this.wireTarget(llm),
        timeoutMs: 90_000,
        signal,
      },
      {
        model: llm.model,
        messages: input.messages,
        // 内容类（browse/content）温度略高更有真实感；界面/局部更新类收敛
        temperature: input.intent === "panel" || input.intent === "update" ? 0.3 : 0.7,
        reasoningEffort: "off",
        maxOutputTokens:
          input.intent === "browse" ? 4_000 : input.intent === "update" ? 1_500 : 2_500,
      },
    );
    return result.text;
  }
}
