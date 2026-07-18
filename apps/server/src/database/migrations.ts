import type { DatabaseSync } from "node:sqlite";

/**
 * 幂等迁移：user_version 顺序执行。
 * v1：chat 表（与既有 chat-store 建表语句等价，IF NOT EXISTS 兼容已存在库）
 * v2：gen_apps / gen_app_artifacts / gen_app_data
 * v3：Artifact V2 的结构化 payload（保留 html 作为 V1/兼容回退）
 */

type Migration = {
  version: number;
  up: (db: DatabaseSync) => void;
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
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
    },
  },
  {
    version: 2,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS gen_apps (
          id                    TEXT PRIMARY KEY,
          state                 TEXT NOT NULL CHECK (state IN ('draft', 'installed')),
          name                  TEXT NOT NULL,
          icon_emoji            TEXT NOT NULL,
          icon_theme            TEXT NOT NULL,
          description           TEXT NOT NULL DEFAULT '',
          category              TEXT NOT NULL DEFAULT 'AI',
          source_query          TEXT NOT NULL,
          generator_provider    TEXT NOT NULL,
          generator_model       TEXT NOT NULL,
          prompt_version        INTEGER NOT NULL,
          artifact_revision     INTEGER NOT NULL,
          created_at            INTEGER NOT NULL,
          installed_at          INTEGER,
          opened_at             INTEGER,
          draft_expires_at      INTEGER,
          deleted_at            INTEGER
        );
        CREATE TABLE IF NOT EXISTS gen_app_artifacts (
          app_id                 TEXT NOT NULL REFERENCES gen_apps(id) ON DELETE CASCADE,
          revision               INTEGER NOT NULL,
          format                 TEXT NOT NULL,
          format_version         INTEGER NOT NULL,
          runtime_version        INTEGER NOT NULL,
          policy_version         INTEGER NOT NULL,
          html                   TEXT NOT NULL,
          content_sha256         TEXT NOT NULL,
          size_bytes             INTEGER NOT NULL,
          PRIMARY KEY (app_id, revision)
        );
        CREATE TABLE IF NOT EXISTS gen_app_data (
          app_id                 TEXT NOT NULL REFERENCES gen_apps(id) ON DELETE CASCADE,
          key                    TEXT NOT NULL,
          value_json             TEXT NOT NULL,
          updated_at             INTEGER NOT NULL,
          PRIMARY KEY (app_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_gen_apps_state ON gen_apps(state, opened_at);
      `);
    },
  },
  {
    version: 3,
    up(db) {
      db.exec("ALTER TABLE gen_app_artifacts ADD COLUMN payload_json TEXT;");
    },
  },
];

export function runMigrations(db: DatabaseSync) {
  const row = db.prepare("PRAGMA user_version").get() as
    | { user_version: number }
    | undefined;
  let current = Number(row?.user_version ?? 0);
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.exec("BEGIN;");
    try {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version};`);
      db.exec("COMMIT;");
      current = migration.version;
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }
}
