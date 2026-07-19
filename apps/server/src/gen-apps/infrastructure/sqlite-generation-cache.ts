import { Buffer } from "node:buffer";
import type { OpenOsDatabase } from "../../database/openos-database.js";
import type { CachedGeneration, GenerationCache } from "../ports.js";

type CacheRow = {
  fingerprint: string;
  intent_key: string | null;
  markup: string;
  interaction_mode: string;
  provider: string;
  model: string;
  created_at: number;
  expires_at: number;
};

export class SqliteGenerationCache implements GenerationCache {
  constructor(private readonly database: OpenOsDatabase) {}

  get(fingerprint: string, now: number): CachedGeneration | null {
    const row = this.database.db
      .prepare(`SELECT fingerprint, intent_key, markup, interaction_mode, provider, model,
                       created_at, expires_at
                  FROM gen_app_generation_cache WHERE fingerprint = ?`)
      .get(fingerprint) as CacheRow | undefined;
    if (!row) return null;
    if (row.expires_at <= now) {
      this.delete(fingerprint);
      return null;
    }
    this.database.db
      .prepare(`UPDATE gen_app_generation_cache
                   SET last_hit_at = ?, hit_count = hit_count + 1
                 WHERE fingerprint = ?`)
      .run(now, fingerprint);
    return {
      fingerprint: row.fingerprint,
      intentKey: row.intent_key,
      markup: row.markup,
      interactionMode: row.interaction_mode === "improv" ? "improv" : "hybrid",
      provider: row.provider,
      model: row.model,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  put(value: CachedGeneration): void {
    const sizeBytes = Buffer.byteLength(value.markup, "utf8");
    this.database.db
      .prepare(`INSERT INTO gen_app_generation_cache
        (fingerprint, intent_key, markup, interaction_mode, provider, model,
         created_at, last_hit_at, hit_count, size_bytes, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(fingerprint) DO UPDATE SET
          intent_key = excluded.intent_key,
          markup = excluded.markup,
          interaction_mode = excluded.interaction_mode,
          provider = excluded.provider,
          model = excluded.model,
          created_at = excluded.created_at,
          last_hit_at = excluded.last_hit_at,
          hit_count = 0,
          size_bytes = excluded.size_bytes,
          expires_at = excluded.expires_at`)
      .run(
        value.fingerprint,
        value.intentKey,
        value.markup,
        value.interactionMode,
        value.provider,
        value.model,
        value.createdAt,
        value.createdAt,
        sizeBytes,
        value.expiresAt,
      );
  }

  delete(fingerprint: string): void {
    this.database.db
      .prepare("DELETE FROM gen_app_generation_cache WHERE fingerprint = ?")
      .run(fingerprint);
  }

  prune(now: number, maxEntries: number, maxBytes: number): number {
    const before = Number(
      (this.database.db.prepare("SELECT COUNT(*) AS n FROM gen_app_generation_cache").get() as { n: number }).n,
    );
    this.database.db
      .prepare("DELETE FROM gen_app_generation_cache WHERE expires_at <= ?")
      .run(now);
    const rows = this.database.db
      .prepare(`SELECT fingerprint, size_bytes FROM gen_app_generation_cache
                 ORDER BY last_hit_at DESC, created_at DESC`)
      .all() as Array<{ fingerprint: string; size_bytes: number }>;
    let bytes = 0;
    for (let index = 0; index < rows.length; index += 1) {
      bytes += rows[index].size_bytes;
      if (index >= maxEntries || bytes > maxBytes) this.delete(rows[index].fingerprint);
    }
    const after = Number(
      (this.database.db.prepare("SELECT COUNT(*) AS n FROM gen_app_generation_cache").get() as { n: number }).n,
    );
    return before - after;
  }
}
