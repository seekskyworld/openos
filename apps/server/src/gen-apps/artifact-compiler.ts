import { createHash } from "node:crypto";
import {
  GEN_APP_FORMAT_VERSION,
  GEN_APP_LIMITS,
  GEN_APP_POLICY_VERSION,
  GEN_APP_RUNTIME_VERSION,
} from "@openos/shared";
import { extractParts } from "./artifact-extract.js";
import {
  brandValidated,
  genAppError,
  type UntrustedArtifact,
  type ValidatedArtifact,
} from "./domain.js";

/**
 * ArtifactCompiler：进程内纯模块，把不可信模型输出编译为 ValidatedArtifact。
 * - 解析/剥离危险结构（无 DOM 环境下用保守的结构化清洗，而非单次正则替换）
 * - 重建固定外壳，在任何不可信字节前注入 CSP
 * - 校验体积；写入版本与哈希
 * Repository 只接受本模块输出。
 * extract 逻辑见 artifact-extract.ts（与校验器共用）。
 */

const CSP = [
  "default-src 'none'",
  "connect-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function compileArtifact(untrusted: UntrustedArtifact): ValidatedArtifact {
  const raw = untrusted.html ?? "";
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw genAppError("invalid_model_output", "Model returned empty artifact.", 422);
  }

  const { body, styles, scripts } = extractParts(raw);
  if (body.trim().length === 0 && scripts.length === 0) {
    throw genAppError(
      "invalid_model_output",
      "Artifact contained no usable content after sanitization.",
      422,
    );
  }

  // 重建固定外壳：CSP 在任何不可信字节之前
  const html = [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    styles.map((css) => `<style>${css}</style>`).join("\n"),
    "</head><body>",
    body,
    scripts.map((js) => `<script>${js}</script>`).join("\n"),
    "</body></html>",
  ].join("\n");

  const sizeBytes = Buffer.byteLength(html, "utf8");
  if (sizeBytes > GEN_APP_LIMITS.htmlMaxBytes) {
    throw genAppError(
      "artifact_rejected",
      `Artifact exceeds ${GEN_APP_LIMITS.htmlMaxBytes} bytes (${sizeBytes}).`,
      413,
    );
  }

  const contentSha256 = createHash("sha256").update(html).digest("hex");

  return brandValidated({
    html,
    contentSha256,
    sizeBytes,
    formatVersion: GEN_APP_FORMAT_VERSION,
    runtimeVersion: GEN_APP_RUNTIME_VERSION,
    policyVersion: GEN_APP_POLICY_VERSION,
  });
}
