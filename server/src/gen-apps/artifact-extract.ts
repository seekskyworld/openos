/**
 * 从不可信模型输出中提取 body / 内联 style / 内联 script。
 * 编译器与校验器共用，避免两套提取逻辑漂移。
 */

export type ExtractedParts = {
  /** 最终用于展示的 HTML 原文（已解 fence） */
  sourceHtml: string;
  body: string;
  styles: string[];
  scripts: string[];
};

/** 解 ```html 代码块；无 fence 则原样返回 */
export function unwrapHtmlFence(raw: string): string {
  const fence = raw.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && fence[1].trim().length > 0) return fence[1];
  return raw;
}

/** 提取 <body> 内容与内联 <style>/<script>；带 src 的 script 丢弃 */
export function extractParts(rawHtml: string): ExtractedParts {
  let html = unwrapHtmlFence(rawHtml);

  const styles: string[] = [];
  const scripts: string[] = [];

  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css: string) => {
    styles.push(css);
    return "";
  });

  html = html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (_, attrs: string, js: string) => {
      if (/\bsrc\s*=/i.test(attrs)) return "";
      scripts.push(js);
      return "";
    },
  );

  const dropTags = [
    "base",
    "object",
    "embed",
    "frame",
    "frameset",
    "iframe",
    "link",
    "meta",
    "form",
  ];
  for (const tag of dropTags) {
    html = html
      .replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), "")
      .replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  }

  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1] : html;
  body = body
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "")
    .replace(/<!DOCTYPE[^>]*>/gi, "");

  body = body.replace(/(src|href)\s*=\s*(["'])https?:\/\//gi, "$1=$2//blocked//");

  return {
    sourceHtml: unwrapHtmlFence(rawHtml),
    body,
    styles,
    scripts,
  };
}

/** 从模型原始输出提取完整 HTML（优先 fence；否则原样） */
export function extractHtml(raw: string): string {
  const unwrapped = unwrapHtmlFence(raw).trim();
  return unwrapped;
}
