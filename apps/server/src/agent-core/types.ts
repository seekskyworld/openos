import type { CoreMessage } from "../llm-core/index.js";

/**
 * Agent Core：任务无关的通用 coding-agent 循环。
 *
 * 分层：
 *   AgentCore（本模块）      —— 只懂「生成→校验→喂回→修复」的循环骨架
 *   AgentTask<T>（任务包）   —— 注入的上下文：怎么提取制品、怎么校验、怎么写修复提示词
 *   调用方（各 LLM 应用）    —— Gen Apps HTML / 未来的 SQL、图表配置、脚本…任何生成任务
 *
 * 循环内核对制品类型 T 完全不感知：HTML、JSON、SQL 都只是 T。
 */

export type AgentIssue = {
  severity: "fatal" | "warning";
  /** 稳定枚举码（任务自定义） */
  code: string;
  /** 喂回模型的自然语言描述 */
  message: string;
  /** 相关片段（截断），可选 */
  excerpt?: string;
};

export type AgentTurn<T> = {
  round: number;
  artifact: T | null;
  issues: AgentIssue[];
  durationMs: number;
};

export type AgentOutcome = "clean" | "degraded" | "failed";

export type AgentRunResult<T> = {
  artifact: T;
  rounds: AgentTurn<T>[];
  outcome: AgentOutcome;
};

export type AgentProgressEvent =
  | { phase: "generating" }
  | { phase: "checking"; round: number }
  | { phase: "fixing"; round: number }
  | { phase: "done"; outcome: AgentOutcome };

/**
 * 任务上下文包：把「这是个什么生成任务」全部注入进来。
 * 换一个应用场景 = 换一个 AgentTask 实现，循环内核不动。
 */
export interface AgentTask<T> {
  /** 任务名（日志/观测用） */
  readonly name: string;

  /** 首轮提示词（任务自己组装，含风格/语言/约束等上下文） */
  buildFirstPrompt(): CoreMessage[];

  /**
   * 修复轮提示词：拿到上一轮制品与问题清单，组装喂回消息。
   * 输出约束的重申（如「只输出完整 HTML」「只输出 JSON」）由任务自己写。
   */
  buildFixPrompt(previous: T, issues: AgentIssue[]): CoreMessage[];

  /** 从模型原始文本提取制品；提取失败返回 null（判 incomplete） */
  extract(raw: string, previous: T | null): T | null;

  /** 校验制品（本地、确定性、零 token） */
  validate(artifact: T): AgentIssue[];

  /**
   * 降级判定（可选）：预算耗尽仍有 fatal 时，该制品是否「勉强可用」。
   * 不提供则只有 warning-only 版本可降级。
   */
  canDegrade?(artifact: T): boolean;

  /** 首轮采样温度（任务按自己的 creativity 策略给出） */
  readonly firstTemperature: number;
  /** 修复轮温度（默认 0.2；收敛任务可覆盖） */
  readonly fixTemperature?: number;
}

export type AgentGenerateFn = (
  messages: CoreMessage[],
  temperature: number,
  signal: AbortSignal,
) => Promise<string>;

export type AgentCoreOptions = {
  /** 最大轮次（首轮+修复轮），clamp 1-4 */
  maxRounds: number;
  /** 单轮超时 ms */
  roundTimeoutMs: number;
  onProgress?: (event: AgentProgressEvent) => void;
};
