import type { ServerEnv } from "../../env.js";
import { coreGenerate, type CoreMessage, type WireTarget } from "../../llm-core/index.js";
import { resolveEffectiveLlm } from "../../settings-store.js";
import { compileArtifact } from "../artifact-compiler.js";
import {
  creativityTemperature,
  creativityTier,
  loadGenAppsSettings,
} from "../gen-app-settings.js";
import { genAppError, type UntrustedArtifact } from "../domain.js";
import { buildGeneratePrompt } from "../prompt-policy.js";
import type {
  GenAppGenerator,
  GeneratePortInput,
  SuggestPortInput,
} from "../ports.js";
import { LlmGenAppGenerator } from "../infrastructure/llm-gen-app-generator.js";
import {
  runAgent,
  type AgentProgressEvent,
  type AgentRunResult,
} from "../../agent-core/index.js";
import { createHtmlAppTask } from "./html-app-task.js";

/**
 * AgenticGenAppGenerator：GenAppGenerator adapter。
 * suggest 委托 LlmGenAppGenerator；generate 走 AgentLoop。
 * 进度写入内存 Map，供 GET /api/gen-apps/progress/:key 轮询。
 */

type ProgressEntry = {
  event: AgentProgressEvent;
  updatedAt: number;
};

const PROGRESS_TTL_MS = 60_000;
const PROGRESS_CAP = 100;

export class AgenticGenAppGenerator implements GenAppGenerator {
  private readonly llmSuggest: LlmGenAppGenerator;
  private readonly progress = new Map<string, ProgressEntry>();
  /** 当前 generate 绑定的幂等键（由 setProgressKey 注入） */
  private currentProgressKey: string | null = null;

  constructor(private readonly env: ServerEnv) {
    this.llmSuggest = new LlmGenAppGenerator(env);
  }

  /** 供 Controller 在 generate 前绑定幂等键（可选） */
  bindProgressKey(key: string | null) {
    this.currentProgressKey = key && key.trim() ? key.trim() : null;
  }

  getProgress(key: string): AgentProgressEvent {
    this.gcProgress();
    const entry = this.progress.get(key);
    if (!entry) return { phase: "unknown" } as AgentProgressEvent & { phase: "unknown" };
    return entry.event;
  }

  /** 扩展 progress 类型，unknown 给 HTTP 层 */
  getProgressPublic(key: string): { phase: string; round?: number; outcome?: string } {
    this.gcProgress();
    const entry = this.progress.get(key);
    if (!entry) return { phase: "unknown" };
    const e = entry.event;
    if (e.phase === "checking" || e.phase === "fixing") {
      return { phase: e.phase, round: e.round };
    }
    if (e.phase === "done") {
      return { phase: e.phase, outcome: e.outcome };
    }
    return { phase: e.phase };
  }

  private setProgress(event: AgentProgressEvent) {
    const key = this.currentProgressKey;
    if (!key) return;
    if (this.progress.size >= PROGRESS_CAP && !this.progress.has(key)) {
      // 淘汰最旧
      let oldestKey: string | null = null;
      let oldest = Infinity;
      for (const [k, v] of this.progress) {
        if (v.updatedAt < oldest) {
          oldest = v.updatedAt;
          oldestKey = k;
        }
      }
      if (oldestKey) this.progress.delete(oldestKey);
    }
    this.progress.set(key, { event, updatedAt: Date.now() });
  }

  private gcProgress() {
    const now = Date.now();
    for (const [k, v] of this.progress) {
      if (now - v.updatedAt > PROGRESS_TTL_MS) this.progress.delete(k);
    }
  }

  private scheduleProgressCleanup(key: string) {
    setTimeout(() => {
      this.progress.delete(key);
    }, PROGRESS_TTL_MS).unref?.();
  }

  suggest(input: SuggestPortInput, signal: AbortSignal) {
    return this.llmSuggest.suggest(input, signal);
  }

  async generate(
    input: GeneratePortInput,
    signal: AbortSignal,
  ): Promise<UntrustedArtifact> {
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

    const settings = loadGenAppsSettings(this.env);
    const prompt = buildGeneratePrompt({
      name: input.name,
      description: input.description,
      query: input.query,
      tier: creativityTier(settings.creativity),
      language: settings.appLanguage,
    });
    const firstTemp = creativityTemperature(settings.creativity).generate;

    const target: WireTarget = {
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      authStyle: llm.authStyle,
    };

    const progressKey = this.currentProgressKey;
    const onProgress = (event: AgentProgressEvent) => {
      this.setProgress(event);
    };

    // 任务包：HTML 应用的全部上下文（提示词/提取/校验/降级）都在这里；
    // 内核 runAgent 与任务解耦——其他 LLM 应用换任务包即可复用同一 agent
    const task = createHtmlAppTask({
      system: prompt.system,
      user: prompt.user,
      firstTemperature: firstTemp,
      canCompile: (html) => {
        try {
          compileArtifact({
            html,
            provider: llm.provider,
            model: llm.model,
          });
          return true;
        } catch {
          return false;
        }
      },
    });

    let result: AgentRunResult<string>;
    try {
      result = await runAgent(
        task,
        async (messages, temperature, roundSignal) => {
          // 流式生成：断流/重试由 llm-core 处理；roundSignal 直通取消
          const out = await coreGenerate(
            {
              protocol: llm.protocol,
              target,
              timeoutMs: 300_000,
              signal: roundSignal,
            },
            {
              model: llm.model,
              messages,
              temperature,
              reasoningEffort: llm.reasoningEffort,
              maxOutputTokens: 16_000,
            },
          );
          return out.text;
        },
        {
          maxRounds: settings.agentMaxRounds,
          roundTimeoutMs: 300_000,
          onProgress,
        },
        signal,
      );
    } catch (err) {
      if (progressKey) this.scheduleProgressCleanup(progressKey);
      const e = err as Error & { code?: string; status?: number; retryable?: boolean };
      if (e.code === "invalid_model_output" || e.code === "aborted") {
        throw genAppError(
          e.code === "aborted" ? "internal_error" : "invalid_model_output",
          e.message,
          e.status ?? 422,
          e.retryable ?? true,
        );
      }
      throw err;
    }

    console.info(
      JSON.stringify({
        scope: "gen-apps-agent",
        outcome: result.outcome,
        rounds: result.rounds.length,
        issues: result.rounds.map((r) => r.issues.map((i) => i.code)),
        durations: result.rounds.map((r) => r.durationMs),
        model: llm.model,
        provider: llm.provider,
      }),
    );

    if (progressKey) this.scheduleProgressCleanup(progressKey);

    return {
      html: result.artifact,
      provider: llm.provider,
      model: llm.model,
    };
  }
}

/**
 * 按设置热切换 fast / agentic。
 * 每请求读 generationMode；progress 委托 agentic 实例。
 */
export class SettingsSwitchedGenerator implements GenAppGenerator {
  private readonly fast: LlmGenAppGenerator;
  private readonly agentic: AgenticGenAppGenerator;

  constructor(private readonly env: ServerEnv) {
    this.fast = new LlmGenAppGenerator(env);
    this.agentic = new AgenticGenAppGenerator(env);
  }

  get agenticGenerator() {
    return this.agentic;
  }

  bindProgressKey(key: string | null) {
    this.agentic.bindProgressKey(key);
  }

  getProgressPublic(key: string) {
    return this.agentic.getProgressPublic(key);
  }

  suggest(input: SuggestPortInput, signal: AbortSignal) {
    return this.fast.suggest(input, signal);
  }

  generate(input: GeneratePortInput, signal: AbortSignal) {
    const mode = loadGenAppsSettings(this.env).generationMode;
    if (mode === "fast") {
      this.agentic.bindProgressKey(null);
      return this.fast.generate(input, signal);
    }
    return this.agentic.generate(input, signal);
  }
}
