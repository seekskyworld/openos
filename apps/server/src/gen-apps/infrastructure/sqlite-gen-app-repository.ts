import {
  GEN_APP_FORMAT,
  type GenAppArtifact,
  type GenAppDraft,
  type GenAppLaunchBundle,
  type GenAppSummary,
} from "@openos/shared";
import { randomUUID } from "node:crypto";
import type { OpenOsDatabase } from "../../database/openos-database.js";
import { genAppError, type ValidatedDraftInput } from "../domain.js";
import type { GenAppRepository } from "../ports.js";

/**
 * SQLite 仓储 adapter：只接受 ValidatedDraftInput，只返回领域对象。
 * Row 结构不出本文件。列表查询不读 html；安装/触达/删除走事务。
 */

type AppRow = {
  id: string;
  name: string;
  icon_emoji: string;
  icon_theme: string;
  description: string;
  category: string;
  created_at: number;
  installed_at: number | null;
  opened_at: number | null;
  draft_expires_at: number | null;
  artifact_revision: number;
};

type ArtifactRow = {
  app_id: string;
  revision: number;
  format_version: number;
  runtime_version: number;
  policy_version: number;
  html: string;
  content_sha256: string;
  size_bytes: number;
};

function toSummary(row: AppRow): GenAppSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    iconEmoji: row.icon_emoji,
    iconTheme: row.icon_theme as GenAppSummary["iconTheme"],
    category: row.category,
    createdAt: row.created_at,
    installedAt: row.installed_at,
    openedAt: row.opened_at,
  };
}

function toArtifact(row: ArtifactRow): GenAppArtifact {
  return {
    appId: row.app_id,
    revision: row.revision,
    format: GEN_APP_FORMAT,
    formatVersion: row.format_version,
    runtimeVersion: row.runtime_version,
    policyVersion: row.policy_version,
    html: row.html,
    contentSha256: row.content_sha256,
    sizeBytes: row.size_bytes,
  };
}

export class SqliteGenAppRepository implements GenAppRepository {
  /** 幂等键（内存态；进程重启后由 TTL 清理草稿兜底） */
  private idempotency = new Map<string, string>();

  constructor(private readonly database: OpenOsDatabase) {}

  createDraft(input: ValidatedDraftInput): GenAppDraft {
    const { artifact } = input;
    const draftExpiresAt = input.now + input.draftTtlMs;
    this.database.transaction(() => {
      this.database.db
        .prepare(
          `INSERT INTO gen_apps
             (id, state, name, icon_emoji, icon_theme, description, category,
              source_query, generator_provider, generator_model, prompt_version,
              artifact_revision, created_at, draft_expires_at)
           VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          input.id,
          input.name,
          input.iconEmoji,
          input.iconTheme,
          input.description,
          input.category,
          input.sourceQuery,
          input.generatorProvider,
          input.generatorModel,
          input.promptVersion,
          input.now,
          draftExpiresAt,
        );
      this.database.db
        .prepare(
          `INSERT INTO gen_app_artifacts
             (app_id, revision, format, format_version, runtime_version,
              policy_version, html, content_sha256, size_bytes)
           VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          GEN_APP_FORMAT,
          artifact.formatVersion,
          artifact.runtimeVersion,
          artifact.policyVersion,
          artifact.html,
          artifact.contentSha256,
          artifact.sizeBytes,
        );
    });

    return {
      summary: {
        id: input.id,
        name: input.name,
        description: input.description,
        iconEmoji: input.iconEmoji,
        iconTheme: input.iconTheme,
        category: input.category,
        createdAt: input.now,
        installedAt: null,
        openedAt: null,
      },
      artifact: {
        appId: input.id,
        revision: 1,
        format: GEN_APP_FORMAT,
        formatVersion: artifact.formatVersion,
        runtimeVersion: artifact.runtimeVersion,
        policyVersion: artifact.policyVersion,
        html: artifact.html,
        contentSha256: artifact.contentSha256,
        sizeBytes: artifact.sizeBytes,
      },
      draftExpiresAt,
    };
  }

  install(draftId: string, now: number): GenAppSummary {
    return this.database.transaction(() => {
      const row = this.database.db
        .prepare(
          `SELECT id, name, icon_emoji, icon_theme, description, category,
                  created_at, installed_at, opened_at, draft_expires_at, artifact_revision,
                  state
             FROM gen_apps WHERE id = ? AND deleted_at IS NULL`,
        )
        .get(draftId) as (AppRow & { state: string }) | undefined;
      if (!row) {
        throw genAppError("draft_not_found", `Draft ${draftId} not found.`, 404);
      }
      if (row.state === "installed") {
        // 幂等：重复关闭/双次 install 返回现状
        return toSummary(row);
      }
      this.database.db
        .prepare(
          "UPDATE gen_apps SET state = 'installed', installed_at = ?, draft_expires_at = NULL WHERE id = ?",
        )
        .run(now, draftId);
      return toSummary({ ...row, installed_at: now });
    });
  }

  listInstalled(): GenAppSummary[] {
    const rows = this.database.db
      .prepare(
        `SELECT id, name, icon_emoji, icon_theme, description, category,
                created_at, installed_at, opened_at, draft_expires_at, artifact_revision
           FROM gen_apps
          WHERE state = 'installed' AND deleted_at IS NULL
          ORDER BY COALESCE(opened_at, installed_at) DESC`,
      )
      .all() as AppRow[];
    return rows.map(toSummary);
  }

  loadAndTouch(appId: string, now: number): GenAppLaunchBundle {
    return this.database.transaction(() => {
      const row = this.database.db
        .prepare(
          `SELECT id, name, icon_emoji, icon_theme, description, category,
                  created_at, installed_at, opened_at, draft_expires_at, artifact_revision
             FROM gen_apps
            WHERE id = ? AND state = 'installed' AND deleted_at IS NULL`,
        )
        .get(appId) as AppRow | undefined;
      if (!row) {
        throw genAppError("app_not_found", `App ${appId} not found.`, 404);
      }
      const artifactRow = this.database.db
        .prepare(
          `SELECT app_id, revision, format_version, runtime_version, policy_version,
                  html, content_sha256, size_bytes
             FROM gen_app_artifacts WHERE app_id = ? AND revision = ?`,
        )
        .get(appId, row.artifact_revision) as ArtifactRow | undefined;
      if (!artifactRow) {
        throw genAppError("app_not_found", `Artifact for ${appId} missing.`, 404);
      }
      this.database.db
        .prepare("UPDATE gen_apps SET opened_at = ? WHERE id = ?")
        .run(now, appId);
      return {
        summary: toSummary({ ...row, opened_at: now }),
        artifact: toArtifact(artifactRow),
        runtimeSessionId: `rs-${randomUUID()}`,
      };
    });
  }

  remove(appId: string): void {
    this.database.transaction(() => {
      // 物理删除（artifacts/data 级联）
      this.database.db.prepare("DELETE FROM gen_apps WHERE id = ?").run(appId);
    });
  }

  discardExpiredDrafts(now: number): number {
    const result = this.database.db
      .prepare(
        "DELETE FROM gen_apps WHERE state = 'draft' AND draft_expires_at IS NOT NULL AND draft_expires_at < ?",
      )
      .run(now);
    return Number(result.changes);
  }

  countInstalled(): number {
    const row = this.database.db
      .prepare(
        "SELECT COUNT(*) AS n FROM gen_apps WHERE state = 'installed' AND deleted_at IS NULL",
      )
      .get() as { n: number };
    return Number(row.n);
  }

  findByIdempotencyKey(key: string): GenAppDraft | null {
    const draftId = this.idempotency.get(key);
    if (!draftId) return null;
    const row = this.database.db
      .prepare(
        `SELECT id, name, icon_emoji, icon_theme, description, category,
                created_at, installed_at, opened_at, draft_expires_at, artifact_revision
           FROM gen_apps WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(draftId) as AppRow | undefined;
    if (!row) {
      this.idempotency.delete(key);
      return null;
    }
    const artifactRow = this.database.db
      .prepare(
        `SELECT app_id, revision, format_version, runtime_version, policy_version,
                html, content_sha256, size_bytes
           FROM gen_app_artifacts WHERE app_id = ? AND revision = ?`,
      )
      .get(draftId, row.artifact_revision) as ArtifactRow | undefined;
    if (!artifactRow) return null;
    return {
      summary: toSummary(row),
      artifact: toArtifact(artifactRow),
      draftExpiresAt: row.draft_expires_at ?? 0,
    };
  }

  rememberIdempotencyKey(key: string, draftId: string): void {
    this.idempotency.set(key, draftId);
    // 简单容量控制
    if (this.idempotency.size > 500) {
      const first = this.idempotency.keys().next().value;
      if (first) this.idempotency.delete(first);
    }
  }
}
