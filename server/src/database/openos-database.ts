import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ServerEnv } from "../env.js";
import { runMigrations } from "./migrations.js";

/**
 * OpenOS 数据库基础设施（所有权模块）：
 * - 单连接生命周期（含测试关闭）
 * - WAL / foreign_keys / busy_timeout PRAGMA
 * - 事务助手
 * - 启动时按序执行幂等迁移（user_version）
 *
 * ChatRepository / GenAppRepository 各持有自己的表；
 * 物理文件沿用 chat.sqlite 仅为兼容既有用户数据。
 */

let singleton: OpenOsDatabase | null = null;

export class OpenOsDatabase {
  readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 3000;");
    runMigrations(this.db);
  }

  /** 事务：回调抛错即回滚 */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = fn();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {
        // 回滚失败时保留原始错误
      }
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}

function resolveDbPath(env: ServerEnv): string {
  if (env.dataDir) return join(env.dataDir, "chat.sqlite");
  return join(process.cwd(), ".openos", "chat.sqlite");
}

export function getOpenOsDatabase(env: ServerEnv): OpenOsDatabase {
  if (singleton) return singleton;
  singleton = new OpenOsDatabase(resolveDbPath(env));
  return singleton;
}

/** 测试专用：关闭并重置单例 */
export function closeOpenOsDatabase() {
  singleton?.close();
  singleton = null;
}

/** 测试专用：在指定路径开独立实例（不动单例） */
export function createOpenOsDatabaseAt(path: string): OpenOsDatabase {
  return new OpenOsDatabase(path);
}
