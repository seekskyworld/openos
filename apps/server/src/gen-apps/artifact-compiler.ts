import { createHash } from "node:crypto";
import {
  buildGenAppRuntimeDocument,
  GEN_APP_FORMAT,
  GEN_APP_FORMAT_VERSION,
  GEN_APP_LIMITS,
  GEN_APP_POLICY_VERSION,
  GEN_APP_RUNTIME_VERSION,
  GEN_APP_UI_KIT_VERSION,
} from "@openos/shared";
import {
  brandValidated,
  genAppError,
  type UntrustedArtifact,
  type ValidatedArtifact,
} from "./domain.js";
import {
  compileReplacementMarkup,
  sanitizeGenAppMarkup,
} from "./markup-artifact.js";

/**
 * Artifact V2 编译器：模型只提供声明式标记，可信外壳注入 UI Kit 与 ActionRuntime。
 * Repository 只接受这里产出的 branded artifact。
 */
export function compileArtifact(untrusted: UntrustedArtifact): ValidatedArtifact {
  const { markup, actions } = sanitizeGenAppMarkup(untrusted.html);
  const interactionMode =
    untrusted.interactionMode === "improv" ? "improv" : "hybrid";
  const html = buildGenAppRuntimeDocument(markup);
  const sizeBytes = Buffer.byteLength(html, "utf8");
  if (sizeBytes > GEN_APP_LIMITS.htmlMaxBytes) {
    throw genAppError(
      "artifact_rejected",
      `Compiled artifact exceeds ${GEN_APP_LIMITS.htmlMaxBytes} bytes (${sizeBytes}).`,
      413,
    );
  }

  return brandValidated({
    format: GEN_APP_FORMAT,
    html,
    markup,
    actions,
    kitVersion: GEN_APP_UI_KIT_VERSION,
    interactionMode,
    contentSha256: createHash("sha256").update(html).digest("hex"),
    sizeBytes,
    formatVersion: GEN_APP_FORMAT_VERSION,
    runtimeVersion: GEN_APP_RUNTIME_VERSION,
    policyVersion: GEN_APP_POLICY_VERSION,
  });
}

const LEGACY_FRAGMENT_EXTERNAL_PATTERNS: RegExp[] = [
  /<script\b[^>]*\bsrc\s*=/i,
  /<link\b[^>]*\bhref\s*=/i,
  /\bfetch\s*\(/i,
  /\bXMLHttpRequest\b/i,
  /\bWebSocket\s*\(/i,
  /\bimport\s*\(/i,
];

/**
 * 运行时片段编译。
 * V2 默认只允许声明式标记；V1 历史制品可显式 allowScripts 保持兼容。
 */
export function compileFragment(
  raw: string,
  options: { allowScripts?: boolean; targetId?: string } = {},
): string {
  const source = String(raw ?? "").trim();
  if (!source) {
    throw genAppError("invalid_model_output", "Model returned empty fragment.", 422, true);
  }
  if (!options.allowScripts) {
    const fragment = options.targetId
      ? compileReplacementMarkup(source, options.targetId)
      : sanitizeGenAppMarkup(source).markup;
    if (Buffer.byteLength(fragment, "utf8") > GEN_APP_LIMITS.continueMaxBytes) {
      throw genAppError("artifact_rejected", "Fragment exceeds the size limit.", 413, true);
    }
    return fragment;
  }

  let fragment = source;
  const fence = fragment.match(/^```(?:html)?\s*\n([\s\S]*?)\n?```\s*$/);
  if (fence) fragment = fence[1].trim();
  const bodyMatch = fragment.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) fragment = bodyMatch[1].trim();
  fragment = fragment
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, "")
    .replace(/<meta\b[^>]*>/gi, "")
    .trim();
  for (const pattern of LEGACY_FRAGMENT_EXTERNAL_PATTERNS) {
    if (pattern.test(fragment)) {
      throw genAppError(
        "artifact_rejected",
        "Fragment references external resources.",
        422,
        true,
      );
    }
  }
  if (Buffer.byteLength(fragment, "utf8") > GEN_APP_LIMITS.continueMaxBytes) {
    throw genAppError("artifact_rejected", "Fragment exceeds the size limit.", 413, true);
  }
  return fragment;
}
