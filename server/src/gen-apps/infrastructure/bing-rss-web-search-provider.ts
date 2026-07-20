import { XMLParser } from "fast-xml-parser";
import { genAppError } from "../domain.js";
import type {
  WebSearchProvider,
  WebSearchResponse,
  WebSearchResult,
} from "../ports.js";

type BingRssItem = {
  title?: unknown;
  link?: unknown;
  description?: unknown;
};

type BingRssDocument = {
  rss?: {
    channel?: {
      item?: BingRssItem | BingRssItem[];
    };
  };
};

const SEARCH_TIMEOUT_MS = 10_000;
const SEARCH_RESULT_LIMIT = 6;

function text(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function validResult(item: BingRssItem): WebSearchResult | null {
  const title = text(item.title, 180);
  const snippet = text(item.description, 600);
  const rawUrl = text(item.link, 2_000);
  if (!title || !rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { title, snippet, url: url.toString() };
  } catch {
    return null;
  }
}

/**
 * Bing RSS 是固定目的地的服务端适配器：不接受调用方 URL，因此不会形成 SSRF。
 * 生成 iframe 仍保持 connect-src none，只能通过受控的 web.search 动作间接访问。
 */
export class BingRssWebSearchProvider implements WebSearchProvider {
  private readonly parser = new XMLParser({
    ignoreAttributes: true,
    trimValues: true,
    processEntities: true,
  });

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async search(query: string, signal: AbortSignal): Promise<WebSearchResponse> {
    const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
    const requestSignal = AbortSignal.any
      ? AbortSignal.any([signal, timeout])
      : timeout;
    let response: Response;
    try {
      const url = new URL("https://www.bing.com/search");
      url.searchParams.set("format", "rss");
      url.searchParams.set("q", query);
      response = await this.fetchFn(url, {
        headers: {
          accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
          "user-agent": "OpenOS/0.1 WebSearch",
        },
        signal: requestSignal,
      });
    } catch (error) {
      if (timeout.aborted && !signal.aborted) {
        throw genAppError("generation_timeout", "Web search timed out.", 504, true);
      }
      if (signal.aborted) throw error;
      throw genAppError("web_search_failed", "Web search is temporarily unavailable.", 502, true);
    }
    if (!response.ok) {
      throw genAppError(
        "web_search_failed",
        `Web search provider returned HTTP ${response.status}.`,
        502,
        true,
      );
    }
    const xml = await response.text();
    let document: BingRssDocument;
    try {
      document = this.parser.parse(xml) as BingRssDocument;
    } catch {
      throw genAppError("web_search_failed", "Web search returned invalid XML.", 502, true);
    }
    const rawItems = document.rss?.channel?.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
    const results = items
      .map(validResult)
      .filter((item): item is WebSearchResult => item !== null)
      .slice(0, SEARCH_RESULT_LIMIT);
    return { query, provider: "Bing", results };
  }
}
