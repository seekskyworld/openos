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

/**
 * 生成式运行时 SDK（编译期注入，先于应用代码执行）。
 * - OpenOS.generate(payload)：postMessage RPC → 宿主中继 → /continue，Promise 返回 HTML 片段
 * - OpenOS.mount(container, html)：插入片段并重建 <script> 节点（innerHTML 不执行脚本）
 * 沙箱 srcdoc origin 为 opaque，targetOrigin 只能 "*"；安全由宿主 source 校验保证。
 */
const RUNTIME_SDK = `(function () {
  var pending = {};
  var seq = 0;
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.type !== "openos:result" || !pending[d.requestId]) return;
    var p = pending[d.requestId];
    delete pending[d.requestId];
    if (d.ok) p.resolve(String(d.fragment || ""));
    else p.reject(new Error(String(d.error || "generate failed")));
  });
  window.OpenOS = {
    generate: function (payload) {
      return new Promise(function (resolve, reject) {
        var id = "rq" + (++seq) + "-" + Math.random().toString(36).slice(2);
        pending[id] = { resolve: resolve, reject: reject };
        parent.postMessage({ type: "openos:generate", requestId: id, payload: payload }, "*");
        setTimeout(function () {
          if (pending[id]) {
            delete pending[id];
            reject(new Error("generate timeout"));
          }
        }, 120000);
      });
    },
    mount: function (container, html) {
      container.innerHTML = html;
      var scripts = container.querySelectorAll("script");
      for (var i = 0; i < scripts.length; i++) {
        var old = scripts[i];
        var s = document.createElement("script");
        s.textContent = old.textContent;
        old.parentNode.replaceChild(s, old);
      }
    },
  };
})();`;

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

  // 重建固定外壳：CSP 在任何不可信字节之前；运行时 SDK 先于应用代码
  const html = [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<script>${RUNTIME_SDK}</script>`,
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

const FRAGMENT_EXTERNAL_PATTERNS: RegExp[] = [
  /<script\b[^>]*\bsrc\s*=/i,
  /<link\b[^>]*\bhref\s*=/i,
  /\bfetch\s*\(/i,
  /\bXMLHttpRequest\b/i,
  /\bWebSocket\s*\(/i,
  /\bimport\s*\(/i,
];

/**
 * 续生成 fragment 清洗：剥围栏与文档外壳、拒外链、限体积。
 * fragment 与主制品同沙箱同信任级——只拦「会失效/超限」项。
 */
export function compileFragment(raw: string): string {
  let fragment = (raw ?? "").trim();
  if (!fragment) {
    throw genAppError("invalid_model_output", "Model returned empty fragment.", 422, true);
  }
  // 剥 ```html 围栏
  const fence = fragment.match(/^```(?:html)?\s*\n([\s\S]*?)\n?```\s*$/);
  if (fence) fragment = fence[1].trim();
  // 剥文档外壳（模型偶尔不听话给整页）：取 body 内容
  const bodyMatch = fragment.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) fragment = bodyMatch[1].trim();
  fragment = fragment
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, "")
    .replace(/<meta\b[^>]*>/gi, "")
    .trim();

  for (const re of FRAGMENT_EXTERNAL_PATTERNS) {
    if (re.test(fragment)) {
      throw genAppError(
        "artifact_rejected",
        "Fragment references external resources (blocked in sandbox).",
        422,
        true,
      );
    }
  }

  const sizeBytes = Buffer.byteLength(fragment, "utf8");
  if (sizeBytes > GEN_APP_LIMITS.continueMaxBytes) {
    throw genAppError(
      "artifact_rejected",
      `Fragment exceeds ${GEN_APP_LIMITS.continueMaxBytes} bytes (${sizeBytes}).`,
      413,
      true,
    );
  }
  return fragment;
}
