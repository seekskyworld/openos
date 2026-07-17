import { Script } from "node:vm";
import { GEN_APP_LIMITS } from "@openos/shared";
import { extractParts, unwrapHtmlFence } from "./artifact-extract.js";

/**
 * ArtifactValidator：本地确定性校验（零 token）。
 * 实现 coding-agent-architecture.md §3.1 V1–V9。
 * 不执行 JS；语法检查用 node:vm Script 只编译。
 */

export type ValidationSeverity = "fatal" | "warning";

export type ValidationIssue = {
  severity: ValidationSeverity;
  code: string;
  message: string;
  excerpt?: string;
};

const DANGEROUS_APIS = [
  "navigator.clipboard",
  "Notification",
  "window.open",
  "indexedDB",
  "webkitRequestFileSystem",
  "showOpenFilePicker",
  "showSaveFilePicker",
];

function excerptAround(source: string, index: number, radius = 80): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(source.length, index + radius);
  return source.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 200);
}

function countMatches(source: string, re: RegExp): number {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  return (source.match(global) ?? []).length;
}

export function validateArtifact(html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const raw = typeof html === "string" ? html : "";
  const source = unwrapHtmlFence(raw).trim();

  // V1: 可提取
  if (!source) {
    issues.push({
      severity: "fatal",
      code: "empty_artifact",
      message: "制品为空，无法解析出 HTML。",
    });
    return issues;
  }

  // incomplete_output：无 <html 且长度骤减时由循环层另判；这里做基础可提取
  const parts = extractParts(source);
  if (parts.body.trim().length === 0 && parts.scripts.length === 0) {
    issues.push({
      severity: "fatal",
      code: "empty_content",
      message: "解析后 body 与 script 均为空，制品无可用内容。",
    });
  }

  // V4: 体积
  const sizeBytes = Buffer.byteLength(source, "utf8");
  if (sizeBytes > GEN_APP_LIMITS.htmlMaxBytes) {
    issues.push({
      severity: "fatal",
      code: "too_large",
      message: `制品体积 ${sizeBytes} 字节超过上限 ${GEN_APP_LIMITS.htmlMaxBytes}。`,
    });
  }

  // V2: JS 语法
  for (let i = 0; i < parts.scripts.length; i++) {
    const js = parts.scripts[i];
    try {
      // 只编译不执行
      // eslint-disable-next-line no-new
      new Script(js, { filename: `inline-script-${i}.js` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lineMatch = msg.match(/:(\d+)/);
      const lineHint = lineMatch ? `第 ${lineMatch[1]} 行附近 ` : "";
      issues.push({
        severity: "fatal",
        code: "js_syntax_error",
        message: `${lineHint}SyntaxError: ${msg}`,
        excerpt: js.slice(0, 200),
      });
    }
  }

  // V3: 外链资源
  const externalPatterns: Array<{ re: RegExp; label: string }> = [
    { re: /<script\b[^>]*\bsrc\s*=/i, label: "script src" },
    { re: /<link\b[^>]*\bhref\s*=/i, label: "link href" },
    { re: /\bfetch\s*\(/i, label: "fetch(" },
    { re: /\bXMLHttpRequest\b/i, label: "XMLHttpRequest" },
    { re: /\bWebSocket\s*\(/i, label: "WebSocket" },
    { re: /\bimport\s*\(/i, label: "dynamic import(" },
    { re: /https?:\/\/[^\s"'`]+/i, label: "http(s) URL" },
  ];
  for (const { re, label } of externalPatterns) {
    if (re.test(source)) {
      const m = source.match(re);
      issues.push({
        severity: "fatal",
        code: "external_resource",
        message: `检测到外部资源引用（${label}），沙箱内会失效，请改为内联实现。`,
        excerpt: m ? excerptAround(source, m.index ?? 0) : undefined,
      });
      break; // 同类问题报一次即可
    }
  }

  // V5: 交互性启发
  const interactiveCount =
    countMatches(source, /<button\b/i) +
    countMatches(source, /<input\b/i) +
    countMatches(source, /<select\b/i) +
    countMatches(source, /<textarea\b/i);
  const bindingCount =
    countMatches(source, /addEventListener\s*\(/i) +
    countMatches(source, /\bon[a-z]+\s*=/i);
  // 纯展示类（时钟等）可能无按钮：若既无交互元素也无绑定，才 fatal
  if (interactiveCount > 0 && bindingCount === 0) {
    issues.push({
      severity: "fatal",
      code: "no_event_binding",
      message: `检测到 ${interactiveCount} 个可交互元素但没有任何事件绑定，应用不可交互。`,
    });
  } else if (interactiveCount === 0 && bindingCount === 0) {
    // 可能是纯展示；若 body 文本也很少则并入 V6
  }

  // V10: 沙箱交互杀手——form 提交与模态弹窗在 sandbox iframe 中被禁，
  // 表现为「按钮点了没反应」，必须在生成期拦下
  const usesForm = /<form\b/i.test(source) || /type\s*=\s*["']submit["']/i.test(source);
  if (usesForm && !/preventDefault\s*\(/.test(source)) {
    const m = source.match(/<form\b/i) ?? source.match(/type\s*=\s*["']submit["']/i);
    issues.push({
      severity: "fatal",
      code: "form_submit_in_sandbox",
      message:
        "沙箱禁止表单提交：<form> 内按钮默认 type=submit，点击会被浏览器吞掉、看似无反应。移除 <form> 提交行为，按钮改为 type=\"button\" 并用 click 事件处理。",
      excerpt: m ? excerptAround(source, m.index ?? 0) : undefined,
    });
  }
  const modalMatch = source.match(/(?<![.\w])(?:window\.)?(alert|confirm|prompt)\s*\(/);
  if (modalMatch) {
    issues.push({
      severity: "fatal",
      code: "modal_in_sandbox",
      message: `沙箱禁止 ${modalMatch[1]}() 弹窗：调用不会有任何显示，交互看似无反应。请把提示/确认/结果渲染在页面内。`,
      excerpt: excerptAround(source, modalMatch.index ?? 0),
    });
  }

  // V6: 空壳
  const bodyText = parts.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const elementCount = countMatches(parts.body, /<[a-zA-Z][\w:-]*/);
  if (bodyText.length < 2 && elementCount < 2 && parts.scripts.length === 0) {
    issues.push({
      severity: "fatal",
      code: "hollow_shell",
      message: "body 内容过少，疑似空壳页面。",
    });
  }

  // V7: localStorage / cookie
  if (/\blocalStorage\b/.test(source) || /\bsessionStorage\b/.test(source)) {
    issues.push({
      severity: "warning",
      code: "uses_localstorage",
      message: "localStorage/sessionStorage 在沙箱中不可用，请改用内存变量。",
    });
  }
  if (/\bdocument\.cookie\b/.test(source)) {
    issues.push({
      severity: "warning",
      code: "uses_cookie",
      message: "document.cookie 在沙箱中不可用，请改用内存变量。",
    });
  }

  // V8: viewport
  if (!/name\s*=\s*["']viewport["']/i.test(source)) {
    issues.push({
      severity: "warning",
      code: "missing_viewport",
      message: "缺少 viewport meta，小窗口自适应可能不佳。",
    });
  }

  // V9: 危险 API
  for (const api of DANGEROUS_APIS) {
    if (source.includes(api)) {
      issues.push({
        severity: "warning",
        code: "sandbox_unavailable_api",
        message: `使用了沙箱中可能不可用的 API：${api}。`,
      });
      break;
    }
  }

  return issues;
}

export function hasFatal(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "fatal");
}

/** 组装修复轮错误清单文本 */
export function formatIssuesForModel(issues: ValidationIssue[]): string {
  return issues
    .map((i) => {
      const tag = i.severity === "fatal" ? "FATAL" : "WARN";
      const head = `[${tag}] ${i.code}: ${i.message}`;
      if (i.excerpt) return `${head}\n  相关片段：\`${i.excerpt}\``;
      return head;
    })
    .join("\n");
}
