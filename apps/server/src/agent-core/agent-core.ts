import type { CoreMessage } from "../llm-core/index.js";
import type {
  AgentCoreOptions,
  AgentGenerateFn,
  AgentIssue,
  AgentRunResult,
  AgentTask,
  AgentTurn,
} from "./types.js";

/**
 * 通用 agent 循环内核（任务无关，纯逻辑无 IO）：
 * generating → checking → [fixing → checking]… → done
 *
 * 对制品类型 T 完全不感知；任务差异全部由 AgentTask<T> 注入。
 */

function hasFatal(issues: AgentIssue[]): boolean {
  return issues.some((i) => i.severity === "fatal");
}

function combineSignals(
  external: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const anyFn = (
    AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }
  ).any;
  const timeoutFn = (
    AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }
  ).timeout;

  if (anyFn && timeoutFn) {
    return { signal: anyFn([external, timeoutFn(timeoutMs)]), cleanup: () => undefined };
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort(external.reason);
  if (external.aborted) controller.abort(external.reason);
  else external.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new Error(`round timeout after ${timeoutMs}ms`));
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external.removeEventListener("abort", onAbort);
    },
  };
}

/** 降级：warning-only 版本 > 任务自定义可降级版本 > null */
function pickDegraded<T>(
  turns: AgentTurn<T>[],
  canDegrade?: (artifact: T) => boolean,
): T | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.artifact !== null && !hasFatal(t.issues)) return t.artifact;
  }
  if (canDegrade) {
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      if (t.artifact !== null && canDegrade(t.artifact)) return t.artifact;
    }
  }
  return null;
}

export async function runAgent<T>(
  task: AgentTask<T>,
  generate: AgentGenerateFn,
  options: AgentCoreOptions,
  signal: AbortSignal,
): Promise<AgentRunResult<T>> {
  const maxRounds = Math.min(4, Math.max(1, Math.floor(options.maxRounds) || 1));
  const rounds: AgentTurn<T>[] = [];
  let previous: T | null = null;

  for (let round = 0; round < maxRounds; round++) {
    if (signal.aborted) {
      throw Object.assign(new Error(`Agent[${task.name}] aborted`), {
        code: "aborted",
        status: 499,
        retryable: true,
      });
    }

    if (round === 0) options.onProgress?.({ phase: "generating" });
    else options.onProgress?.({ phase: "fixing", round });

    const messages: CoreMessage[] =
      round === 0 || previous === null
        ? task.buildFirstPrompt()
        : task.buildFixPrompt(previous, rounds[round - 1].issues);
    const temperature =
      round === 0 ? task.firstTemperature : (task.fixTemperature ?? 0.2);

    const { signal: roundSignal, cleanup } = combineSignals(
      signal,
      options.roundTimeoutMs,
    );
    const started = Date.now();
    let rawText = "";
    try {
      rawText = await generate(messages, temperature, roundSignal);
    } finally {
      cleanup();
    }
    const durationMs = Date.now() - started;

    options.onProgress?.({ phase: "checking", round });

    const artifact = task.extract(rawText, previous);
    let issues: AgentIssue[] = [];
    if (artifact === null) {
      issues.push({
        severity: "fatal",
        code: "incomplete_output",
        message:
          "输出不完整或无法提取有效制品，请按约束重新输出完整内容（不要 diff、不要片段、不要解释文字）。",
      });
    } else {
      issues = task.validate(artifact);
    }

    rounds.push({ round, artifact, issues, durationMs });
    if (artifact !== null) previous = artifact;

    if (artifact !== null && !hasFatal(issues)) {
      const result: AgentRunResult<T> = {
        artifact,
        rounds,
        outcome: "clean",
      };
      options.onProgress?.({ phase: "done", outcome: result.outcome });
      return result;
    }
  }

  const degraded = pickDegraded(rounds, task.canDegrade?.bind(task));
  if (degraded !== null) {
    options.onProgress?.({ phase: "done", outcome: "degraded" });
    return { artifact: degraded, rounds, outcome: "degraded" };
  }

  options.onProgress?.({ phase: "done", outcome: "failed" });
  const lastFatal = (rounds[rounds.length - 1]?.issues ?? [])
    .filter((i) => i.severity === "fatal")
    .map((i) => i.code)
    .join(", ");
  throw Object.assign(
    new Error(
      `Agent[${task.name}] failed after ${rounds.length} round(s)${lastFatal ? `: ${lastFatal}` : ""}`,
    ),
    { code: "invalid_model_output", status: 422, retryable: true },
  );
}
