import { genAppError } from "./domain.js";
import type { WebSearchResponse } from "./ports.js";

export type WebSearchRequest =
  | { kind: "landing"; engineName: string }
  | { kind: "search"; query: string };

const SEARCH_ENGINE_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)google\.[a-z.]+$/i, "Google"],
  [/(^|\.)bing\.com$/i, "Bing"],
  [/(^|\.)duckduckgo\.com$/i, "DuckDuckGo"],
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function possibleUrl(value: string): URL | null {
  const source = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(source);
  } catch {
    return null;
  }
}

export function resolveWebSearchRequest(value: unknown): WebSearchRequest {
  const input = String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!input || input.length > 300) {
    throw genAppError("validation_failed", "Search query must be 1-300 characters.", 400);
  }
  const url = possibleUrl(input);
  if (url) {
    const engine = SEARCH_ENGINE_HOSTS.find(([pattern]) => pattern.test(url.hostname));
    if (engine) {
      const query = url.searchParams.get("q")?.trim();
      return query ? { kind: "search", query: query.slice(0, 300) } : { kind: "landing", engineName: engine[1] };
    }
  }
  return { kind: "search", query: input };
}

export function renderSearchLanding(targetId: string, engineName: string): string {
  const name = escapeHtml(engineName);
  const queryId = `${targetId}-web-query`;
  const submitId = `${targetId}-web-submit`;
  return `<section id="${escapeHtml(targetId)}" class="os-card os-column">
    <div class="os-empty"><h2 class="os-heading">${name}</h2><p class="os-caption">输入关键词搜索真实网络内容</p></div>
    <div class="field-row"><input id="${escapeHtml(queryId)}" class="os-search" type="search" placeholder="搜索网络" autocomplete="off">
      <button id="${escapeHtml(submitId)}" class="os-button os-primary" type="button" data-action="web.search" data-target="${escapeHtml(targetId)}" data-source="${escapeHtml(queryId)}">搜索</button></div>
  </section>`;
}

export function renderWebSearchResults(
  targetId: string,
  response: WebSearchResponse,
): string {
  const resultMarkup = response.results.length > 0
    ? response.results.map((result, index) => {
        const hostname = new URL(result.url).hostname.replace(/^www\./, "");
        return `<article id="${escapeHtml(targetId)}-web-result-${index + 1}" class="os-card os-column">
          <div class="os-row"><strong>${escapeHtml(result.title)}</strong><span class="os-badge">${escapeHtml(hostname)}</span></div>
          <p class="os-caption">${escapeHtml(result.snippet || result.url)}</p>
          <p class="os-status">${escapeHtml(result.url)}</p>
        </article>`;
      }).join("")
    : `<div class="os-empty"><p>没有找到相关网络结果</p></div>`;
  return `<section id="${escapeHtml(targetId)}" class="os-column">
    <div class="os-row"><h2 class="os-subheading">${escapeHtml(response.query)}</h2><span class="os-badge">${escapeHtml(response.provider)} 网络结果</span></div>
    <div class="os-column" id="${escapeHtml(targetId)}-web-results-list">${resultMarkup}</div>
  </section>`;
}
