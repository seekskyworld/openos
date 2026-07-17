import type { ServerEnv } from "../../env.js";
import { coreGenerate, type WireTarget } from "../../llm-core/index.js";
import { resolveEffectiveLlm } from "../../settings-store.js";
import {
  creativityTemperature,
  creativityTier,
  loadGenAppsSettings,
} from "../gen-app-settings.js";
import {
  buildContinuePrompt,
  buildGeneratePrompt,
  buildSuggestPrompt,
} from "../prompt-policy.js";
import { genAppError, type UntrustedArtifact, type UntrustedSuggestion } from "../domain.js";
import type {
  ContinuePortInput,
  GenAppGenerator,
  GeneratePortInput,
  SuggestPortInput,
} from "../ports.js";

/**
 * 真实 LLM 生成器（反腐层）：
 * - 走当前生效的 LLM 配置（Providers/Custom 里配置的模型）
 * - suggest 输出解析为 UntrustedSuggestion[]，generate 提取为 UntrustedArtifact
 * - Prompt 由 prompt-policy 组装，随设置里的 creativity 档位/语言变化
 */

function extractJsonArray(text: string): unknown[] | null {
  // 容错解析：直接 JSON、代码块内 JSON、或截取首个 [...] 段
  const candidates: string[] = [text];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.unshift(fence[1]);
  const bracket = text.match(/\[[\s\S]*\]/);
  if (bracket) candidates.push(bracket[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // 尝试下一种
    }
  }
  return null;
}

export class LlmGenAppGenerator implements GenAppGenerator {
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
    const llm = this.ensureConfigured();
    const settings = loadGenAppsSettings(this.env);
    const prompt = buildSuggestPrompt({
      query: input.query,
      count: input.count,
      tier: creativityTier(settings.creativity),
      language: settings.appLanguage,
    });

    // llm-core：内部协议 → wire 协议适配（system 处理、温度支持差异都在适配层）
    const result = await coreGenerate(
      {
        protocol: llm.protocol,
        target: this.wireTarget(llm),
        timeoutMs: 90_000,
        signal,
      },
      {
        model: llm.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: creativityTemperature(settings.creativity).suggest,
        reasoningEffort: llm.reasoningEffort,
      },
    );

    const parsed = extractJsonArray(result.text);
    if (!parsed) {
      throw genAppError(
        "invalid_model_output",
        "Model did not return a JSON array of suggestions.",
        422,
        true,
      );
    }
    return parsed as UntrustedSuggestion[];
  }

  async generate(
    input: GeneratePortInput,
    signal: AbortSignal,
  ): Promise<UntrustedArtifact> {
    const llm = this.ensureConfigured();
    const settings = loadGenAppsSettings(this.env);
    const prompt = buildGeneratePrompt({
      name: input.name,
      description: input.description,
      query: input.query,
      tier: creativityTier(settings.creativity),
      language: settings.appLanguage,
    });

    input.onPhase?.({ phase: "generating" });
    const result = await coreGenerate(
      {
        protocol: llm.protocol,
        target: this.wireTarget(llm),
        timeoutMs: 300_000,
        signal,
        onDelta: input.onDelta,
      },
      {
        model: llm.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: creativityTemperature(settings.creativity).generate,
        reasoningEffort: llm.reasoningEffort,
        maxOutputTokens: 16_000,
      },
    );

    return {
      html: result.text,
      provider: llm.provider,
      model: result.model,
    };
  }

  /** 运行时续生成：单轮快速，无修复循环（烂片段重试成本低） */
  async continueContent(
    input: ContinuePortInput,
    signal: AbortSignal,
  ): Promise<string> {
    const llm = this.ensureConfigured();
    const settings = loadGenAppsSettings(this.env);
    const prompt = buildContinuePrompt({
      appName: input.appName,
      appDescription: input.appDescription,
      sourceQuery: input.sourceQuery,
      intent: input.intent,
      prompt: input.prompt,
      context: input.context,
      language: settings.appLanguage,
    });

    const result = await coreGenerate(
      {
        protocol: llm.protocol,
        target: this.wireTarget(llm),
        timeoutMs: 90_000,
        signal,
      },
      {
        model: llm.model,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        // 内容类（browse/content）温度略高更有真实感；界面类收敛
        temperature: input.intent === "panel" ? 0.3 : 0.7,
        reasoningEffort: llm.reasoningEffort,
        maxOutputTokens: input.intent === "browse" ? 8_000 : 4_000,
      },
    );
    return result.text;
  }
}
