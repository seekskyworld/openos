import type { ServerEnv } from "../../env.js";
import { coreGenerate, type CoreMessage, type WireTarget } from "../../llm-core/index.js";
import { GEN_APP_LLM_BUDGETS } from "../llm-budgets.js";
import { resolveEffectiveLlm } from "../../settings-store.js";
import { compileArtifact } from "../artifact-compiler.js";
import {
  creativityGenerationTemperature,
  creativityTier,
  loadGenAppsSettings,
} from "../gen-app-settings.js";
import { genAppError, type UntrustedArtifact } from "../domain.js";
import { buildProgressiveHtmlPrompt } from "../prompt-policy.js";
import { ProgressiveHtmlAssembler } from "../generation/progressive-html-stream.js";
import type {
  ContinuePortInput,
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
import { createMarkupAppTask } from "./markup-app-task.js";

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

  continueContent(input: ContinuePortInput, signal: AbortSignal) {
    // 续生成永远单轮快速，不走 agent 循环
    return this.llmSuggest.continueContent(input, signal);
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
    const tier = creativityTier(settings.creativity);
    const prompt = buildProgressiveHtmlPrompt({
      name: input.name,
      description: input.description,
      query: input.query,
      tier,
      language: settings.appLanguage,
    });
    const firstTemp = creativityGenerationTemperature(settings.creativity);

    const target: WireTarget = {
      baseUrl: llm.baseUrl,
      apiKey: llm.apiKey,
      authStyle: llm.authStyle,
    };

    const progressKey = this.currentProgressKey;
    const onProgress = (event: AgentProgressEvent) => {
      this.setProgress(event);
      // SSE 流式路径：阶段同步给调用方
      if (input.onPhase) {
        if (event.phase === "checking" || event.phase === "fixing") {
          input.onPhase({ phase: event.phase, round: event.round });
        } else if (event.phase === "done") {
          input.onPhase({ phase: "done" });
        } else {
          input.onPhase({ phase: event.phase });
        }
      }
    };

    // 任务包：V2 标记的全部上下文（提示词/提取/校验/降级）都在这里；
    // 内核 runAgent 与任务解耦——其他 LLM 应用换任务包即可复用同一 agent
    const task = createMarkupAppTask({
      system: prompt.system,
      user: prompt.user,
      firstTemperature: firstTemp,
      canCompile: (markup) => {
        try {
          compileArtifact({
            html: markup,
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
          const assembler = new ProgressiveHtmlAssembler();
          const emitSnapshots = (snapshots: ReturnType<ProgressiveHtmlAssembler["push"]>) => {
            for (const snapshot of snapshots) {
              input.onPhase?.({ phase: `html-${snapshot.stage}` });
              input.onSnapshot?.(snapshot);
            }
          };
          // 流式生成：断流/重试由 llm-core 处理；roundSignal 直通取消
          // 慢速上游单轮可达 6-8 分钟；卡死由 llm-core idle 超时(60s)负责，
          // 这里的总预算只防失控，不应掐断仍在活跃流动的流
          const out = await coreGenerate(
            {
              protocol: llm.protocol,
              target,
              timeoutMs: GEN_APP_LLM_BUDGETS.generationTotalMs,
              headerTimeoutMs: GEN_APP_LLM_BUDGETS.generationHeaderMs,
              idleTimeoutMs: GEN_APP_LLM_BUDGETS.generationIdleMs,
              signal: roundSignal,
              onDelta: (chunk) => emitSnapshots(assembler.push(chunk)),
            },
            {
              model: llm.model,
              messages,
              temperature,
              reasoningEffort: "off",
              maxOutputTokens: 4_000,
            },
          );
          emitSnapshots(assembler.finish());
          return out.text;
        },
        {
          maxRounds: settings.agentMaxRounds,
          roundTimeoutMs: 600_000,
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
      interactionMode: tier === "fantasy" ? "improv" : "hybrid",
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

  continueContent(input: ContinuePortInput, signal: AbortSignal) {
    return this.fast.continueContent(input, signal);
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
