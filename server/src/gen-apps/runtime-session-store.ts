import { GEN_APP_LIMITS, type GenAppInteractionMode } from "@openos/shared";
import type { CoreMessage } from "../llm-core/index.js";
import type { GenAppIdentity } from "./ports.js";

export type RuntimeSessionSnapshot = {
  id: string;
  appId: string;
  revision: number;
  markup: string;
  interactionMode: GenAppInteractionMode;
  identity: GenAppIdentity;
  messages: CoreMessage[];
};

type RuntimeSessionEntry = RuntimeSessionSnapshot & {
  updatedAt: number;
};

type RegisterInput = Omit<RuntimeSessionSnapshot, "messages">;

function cloneMessages(messages: CoreMessage[]): CoreMessage[] {
  return messages.map((message) => ({ ...message }));
}

/**
 * 窗口运行态只保存在有界内存中：持久化制品保持不可变，每次 launch 都得到独立会话。
 * 该模块同时收口 revision、权威 markup 与模型上下文，调用方不能分别更新三份状态。
 */
export class RuntimeSessionStore {
  private readonly sessions = new Map<string, RuntimeSessionEntry>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  register(input: RegisterInput): RuntimeSessionSnapshot {
    this.gc();
    if (!this.sessions.has(input.id)) this.evictForCapacity();
    const entry: RuntimeSessionEntry = {
      ...input,
      messages: [],
      updatedAt: this.now(),
    };
    this.sessions.set(input.id, entry);
    return this.snapshot(entry);
  }

  read(sessionId: string, appId: string): RuntimeSessionSnapshot | null {
    this.gc();
    const entry = this.sessions.get(sessionId);
    if (!entry || entry.appId !== appId) return null;
    entry.updatedAt = this.now();
    return this.snapshot(entry);
  }

  inspect(sessionId: string): RuntimeSessionSnapshot | null {
    this.gc();
    const entry = this.sessions.get(sessionId);
    return entry ? this.snapshot(entry) : null;
  }

  commit(input: {
    sessionId: string;
    appId: string;
    baseRevision: number;
    markup: string;
    turns: CoreMessage[];
  }):
    | { ok: true; session: RuntimeSessionSnapshot }
    | { ok: false; currentRevision: number | null } {
    const entry = this.sessions.get(input.sessionId);
    if (!entry || entry.appId !== input.appId) {
      return { ok: false, currentRevision: null };
    }
    if (entry.revision !== input.baseRevision) {
      return { ok: false, currentRevision: entry.revision };
    }
    entry.markup = input.markup;
    entry.revision += 1;
    entry.messages = this.compactMessages([...entry.messages, ...input.turns]);
    entry.updatedAt = this.now();
    return { ok: true, session: this.snapshot(entry) };
  }

  private snapshot(entry: RuntimeSessionEntry): RuntimeSessionSnapshot {
    return {
      id: entry.id,
      appId: entry.appId,
      revision: entry.revision,
      markup: entry.markup,
      interactionMode: entry.interactionMode,
      identity: { ...entry.identity },
      messages: cloneMessages(entry.messages),
    };
  }

  private compactMessages(messages: CoreMessage[]): CoreMessage[] {
    const system = messages.find((message) => message.role === "system");
    const conversational = messages
      .filter((message) => message.role !== "system")
      .slice(-GEN_APP_LIMITS.runtimeSessionMaxTurns * 2);
    const compact = system ? [system, ...conversational] : conversational;
    return compact.map((message) => ({
      ...message,
      content: message.content.slice(
        0,
        GEN_APP_LIMITS.runtimeSessionHistoryCharsPerTurn,
      ),
    }));
  }

  private gc(): void {
    const cutoff = this.now() - GEN_APP_LIMITS.runtimeSessionTtlMs;
    for (const [sessionId, entry] of this.sessions) {
      if (entry.updatedAt < cutoff) this.sessions.delete(sessionId);
    }
  }

  private evictForCapacity(): void {
    if (this.sessions.size < GEN_APP_LIMITS.runtimeSessionMaxCount) return;
    let oldestId: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [sessionId, entry] of this.sessions) {
      if (entry.updatedAt < oldestAt) {
        oldestId = sessionId;
        oldestAt = entry.updatedAt;
      }
    }
    if (oldestId) this.sessions.delete(oldestId);
  }
}
