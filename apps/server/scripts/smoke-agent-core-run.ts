import { runAgent } from "../src/agent-core/index.js";
import type { AgentIssue, AgentTask } from "../src/agent-core/index.js";
import type { CoreMessage } from "../src/llm-core/index.js";

/**
 * agent-core 通用内核冒烟：用一个最小字符串任务验证
 * clean / 修复后 clean / degraded / failed / abort 五路径 + 任务无关性。
 */

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const GOOD = "GOOD_ARTIFACT";
const BAD = "BAD_ARTIFACT";
const WARN_ONLY = "WARN_ARTIFACT";

function makeTask(overrides: Partial<AgentTask<string>> = {}): AgentTask<string> {
  return {
    name: "smoke-task",
    firstTemperature: 0.3,
    buildFirstPrompt(): CoreMessage[] {
      return [{ role: "user", content: "make it" }];
    },
    buildFixPrompt(previous: string, issues: AgentIssue[]): CoreMessage[] {
      return [
        { role: "user", content: `fix: ${issues.map((i) => i.code).join(",")} prev=${previous}` },
      ];
    },
    extract(raw: string): string | null {
      return raw.trim() ? raw.trim() : null;
    },
    validate(artifact: string): AgentIssue[] {
      if (artifact === BAD) {
        return [{ severity: "fatal", code: "is_bad", message: "bad artifact" }];
      }
      if (artifact === WARN_ONLY) {
        return [{ severity: "warning", code: "minor", message: "warn only" }];
      }
      return [];
    },
    ...overrides,
  };
}

async function caseClean() {
  const events: string[] = [];
  const result = await runAgent(
    makeTask(),
    async () => GOOD,
    { maxRounds: 3, roundTimeoutMs: 5_000, onProgress: (e) => events.push(e.phase) },
    new AbortController().signal,
  );
  assert(result.outcome === "clean", "clean outcome");
  assert(result.rounds.length === 1, "1 round");
  assert(events[0] === "generating" && events.at(-1) === "done", "event order");
}

async function caseFixThenPass() {
  let n = 0;
  const result = await runAgent(
    makeTask(),
    async (messages) => {
      n++;
      if (n === 1) return BAD;
      // 修复轮应携带错误码与上一轮制品
      assert(messages[0].content.includes("is_bad"), "fix prompt has issue code");
      assert(messages[0].content.includes(BAD), "fix prompt has prev artifact");
      return GOOD;
    },
    { maxRounds: 3, roundTimeoutMs: 5_000 },
    new AbortController().signal,
  );
  assert(result.outcome === "clean", "fixed clean");
  assert(result.rounds.length === 2, "2 rounds");
}

async function caseDegradedWarnOnly() {
  // 每轮都 warning-only？warning-only 即 clean。degraded 需 fatal 后仅 canDegrade 可用
  let n = 0;
  const result = await runAgent(
    makeTask({ canDegrade: (a) => a === BAD }),
    async () => {
      n++;
      return BAD; // 全轮 fatal，但 canDegrade 放行
    },
    { maxRounds: 2, roundTimeoutMs: 5_000 },
    new AbortController().signal,
  );
  assert(result.outcome === "degraded", "degraded outcome");
  assert(result.artifact === BAD, "degraded picks last compilable");
}

async function caseFailed() {
  let threw = false;
  try {
    await runAgent(
      makeTask(),
      async () => BAD,
      { maxRounds: 2, roundTimeoutMs: 5_000 },
      new AbortController().signal,
    );
  } catch (err) {
    threw = true;
    const e = err as Error & { code?: string };
    assert(e.code === "invalid_model_output", "failed code");
  }
  assert(threw, "failed throws");
}

async function caseAbort() {
  const controller = new AbortController();
  controller.abort();
  let threw = false;
  try {
    await runAgent(
      makeTask(),
      async () => GOOD,
      { maxRounds: 2, roundTimeoutMs: 5_000 },
      controller.signal,
    );
  } catch (err) {
    threw = true;
    const e = err as Error & { code?: string };
    assert(e.code === "aborted", "abort code");
  }
  assert(threw, "abort throws");
}

async function main() {
  await caseClean();
  await caseFixThenPass();
  await caseDegradedWarnOnly();
  await caseFailed();
  await caseAbort();
  console.log("agent-core smoke: ALL PASS");
}

void main();
