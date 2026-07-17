import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ChatMessage } from "@openos/shared";
import type { ServerEnv } from "./env.js";

/**
 * Sir 会话/消息持久化：Node 内置 node:sqlite，零外部依赖。
 * 表结构：
 *   threads(id, title, created_at, updated_at)
 *   messages(id, thread_id, role, content, created_at)
 */

export type ThreadRow = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type MessageRow = ChatMessage & {
  id: string;
  threadId: string;
  createdAt: number;
};

let db: DatabaseSync | null = null;

function resolveDbPath(env: ServerEnv): string {
  if (env.dataDir) return join(env.dataDir, "chat.sqlite");
  return join(process.cwd(), ".openos", "chat.sqlite");
}

export function getChatDb(env: ServerEnv): DatabaseSync {
  if (db) return db;
  const path = resolveDbPath(env);
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
  `);
  return db;
}

export function listThreads(env: ServerEnv): ThreadRow[] {
  const rows = getChatDb(env)
    .prepare(
      "SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM threads ORDER BY updated_at DESC",
    )
    .all() as ThreadRow[];
  return rows;
}

export function createThread(env: ServerEnv, id: string, title: string): ThreadRow {
  const now = Date.now();
  getChatDb(env)
    .prepare("INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, title || "New Chat", now, now);
  return { id, title: title || "New Chat", createdAt: now, updatedAt: now };
}

export function renameThread(env: ServerEnv, id: string, title: string): boolean {
  const result = getChatDb(env)
    .prepare("UPDATE threads SET title = ?, updated_at = ? WHERE id = ?")
    .run(title, Date.now(), id);
  return Number(result.changes) > 0;
}

export function deleteThread(env: ServerEnv, id: string): boolean {
  const database = getChatDb(env);
  database.prepare("DELETE FROM messages WHERE thread_id = ?").run(id);
  const result = database.prepare("DELETE FROM threads WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

export function listMessages(env: ServerEnv, threadId: string): MessageRow[] {
  return getChatDb(env)
    .prepare(
      "SELECT id, thread_id AS threadId, role, content, created_at AS createdAt FROM messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC",
    )
    .all(threadId) as MessageRow[];
}

export function appendMessage(
  env: ServerEnv,
  threadId: string,
  message: { id: string; role: ChatMessage["role"]; content: string },
): MessageRow {
  const database = getChatDb(env);
  const now = Date.now();
  // thread 不存在时自动补建（前端先发消息的场景）
  database
    .prepare(
      "INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, 'New Chat', ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at",
    )
    .run(threadId, now, now);
  database
    .prepare(
      "INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(message.id, threadId, message.role, message.content, now);
  return { ...message, threadId, createdAt: now };
}

/** 仅测试/重置用 */
export function closeChatDb() {
  db?.close();
  db = null;
}
