import { GEN_APP_LIMITS } from "@openos/shared";
import type { CoreMessage } from "../llm-core/index.js";

/**
 * 运行时续生成的会话记忆（进程内、非持久化）。
 *
 * 每个 session key（already 按 appId 命名空间）维护一段 CoreMessage 历史，
 * 让同一条续生成流（如生成式浏览器的同一个地址栏）跨多次调用保持上下文
 * 连贯——模型能"记得"自己之前虚构过什么，而不是每次从零脑补导致前后矛盾。
 *
 * 有界增长：每会话最多保留 N 轮 user/assistant 对话（裁剪最旧），
 * 每轮存入历史的文本另有长度上限（截断不影响当次已返回的内容，只影响
 * 未来轮次能看到多少上文）；总会话数超限时淘汰最久未活跃的一个。
 */

type SessionEntry = {
  messages: CoreMessage[];
  updatedAt: number;
};

const MAX_TURN_PAIRS = GEN_APP_LIMITS.continueSessionMaxTurns;
const TTL_MS = GEN_APP_LIMITS.continueSessionTtlMs;
const MAX_SESSIONS = GEN_APP_LIMITS.continueSessionMaxCount;
const HISTORY_CHARS_PER_TURN = GEN_APP_LIMITS.continueSessionHistoryCharsPerTurn;

function truncateForHistory(text: string): string {
  return text.length > HISTORY_CHARS_PER_TURN
    ? `${text.slice(0, HISTORY_CHARS_PER_TURN)}…[为控制上下文长度截断]`
    : text;
}

/** 保留 system（若存在）+ 最近 MAX_TURN_PAIRS 轮 user/assistant */
function trim(messages: CoreMessage[]): CoreMessage[] {
  const hasSystem = messages[0]?.role === "system";
  const system = hasSystem ? messages.slice(0, 1) : [];
  const rest = hasSystem ? messages.slice(1) : messages;
  const maxRest = MAX_TURN_PAIRS * 2;
  const trimmedRest = rest.length > maxRest ? rest.slice(rest.length - maxRest) : rest;
  return [...system, ...trimmedRest];
}

export class ContinueSessionStore {
  private readonly sessions = new Map<string, SessionEntry>();

  /** 已有历史（undefined = 新会话，调用方应带上首轮 system 消息） */
  get(key: string): CoreMessage[] | undefined {
    this.gc();
    return this.sessions.get(key)?.messages;
  }

  /**
   * 提交本轮：newTurns 是本轮实际发给模型的新增消息
   * （新会话时含 system+user，续接时只含 user），assistantReply 是模型回复原文。
   */
  commit(key: string, newTurns: CoreMessage[], assistantReply: string): void {
    const prior = this.sessions.get(key)?.messages ?? [];
    const merged = trim([
      ...prior,
      ...newTurns,
      { role: "assistant", content: truncateForHistory(assistantReply) },
    ]);
    if (this.sessions.size >= MAX_SESSIONS && !this.sessions.has(key)) {
      let oldestKey: string | null = null;
      let oldest = Infinity;
      for (const [k, v] of this.sessions) {
        if (v.updatedAt < oldest) {
          oldest = v.updatedAt;
          oldestKey = k;
        }
      }
      if (oldestKey) this.sessions.delete(oldestKey);
    }
    this.sessions.set(key, { messages: merged, updatedAt: Date.now() });
  }

  private gc(): void {
    const now = Date.now();
    for (const [k, v] of this.sessions) {
      if (now - v.updatedAt > TTL_MS) this.sessions.delete(k);
    }
  }
}
