import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import {
  defaultTreeAdapter,
  parse,
  type DefaultTreeAdapterMap,
} from "parse5";
import { genAppError } from "../domain.js";
import type { WebPageContent, WebPageProvider } from "../ports.js";

type Element = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];
type ChildNode = DefaultTreeAdapterMap["childNode"];

const PAGE_TIMEOUT_MS = 12_000;
const PAGE_MAX_BYTES = 512 * 1024;
const PAGE_MAX_REDIRECTS = 3;
const PAGE_MAX_PARAGRAPHS = 24;
const PAGE_MAX_TEXT_CHARS = 12_000;
const BLOCK_TAGS = new Set(["h1", "h2", "h3", "p", "li", "pre", "blockquote"]);
const IGNORED_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "nav",
  "footer",
  "header",
  "aside",
]);

function isElement(node: ChildNode): node is Element {
  return defaultTreeAdapter.isElementNode(node);
}

function children(node: ParentNode): ChildNode[] {
  return defaultTreeAdapter.getChildNodes(node) as ChildNode[];
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((entry) => entry.name === name)?.value;
}

function normalizeText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function elementText(node: ParentNode): string {
  let output = "";
  for (const child of children(node)) {
    if (isElement(child)) {
      if (!IGNORED_TAGS.has(child.tagName)) output += ` ${elementText(child)}`;
    } else if (defaultTreeAdapter.isTextNode(child)) {
      output += ` ${child.value}`;
    }
  }
  return normalizeText(output, 2_000);
}

function findElement(
  node: ParentNode,
  predicate: (element: Element) => boolean,
): Element | null {
  for (const child of children(node)) {
    if (!isElement(child)) continue;
    if (predicate(child)) return child;
    const nested = findElement(child, predicate);
    if (nested) return nested;
  }
  return null;
}

function collectParagraphs(node: ParentNode, output: string[]): void {
  for (const child of children(node)) {
    if (!isElement(child) || IGNORED_TAGS.has(child.tagName)) continue;
    if (BLOCK_TAGS.has(child.tagName)) {
      const value = elementText(child);
      if (value.length >= 20 && !output.includes(value)) output.push(value.slice(0, 800));
      if (output.length >= PAGE_MAX_PARAGRAPHS) return;
      continue;
    }
    collectParagraphs(child, output);
    if (output.length >= PAGE_MAX_PARAGRAPHS) return;
  }
}

export function extractReadableWebPage(html: string, url: string): WebPageContent {
  const document = parse(html);
  const titleElement = findElement(document, (element) => element.tagName === "title");
  const descriptionElement = findElement(
    document,
    (element) =>
      element.tagName === "meta" &&
      (attribute(element, "name")?.toLowerCase() === "description" ||
        attribute(element, "property")?.toLowerCase() === "og:description"),
  );
  const body = findElement(document, (element) => element.tagName === "body") ?? document;
  const paragraphs: string[] = [];
  collectParagraphs(body, paragraphs);
  let usedChars = 0;
  const boundedParagraphs = paragraphs.filter((paragraph) => {
    if (usedChars >= PAGE_MAX_TEXT_CHARS) return false;
    usedChars += paragraph.length;
    return true;
  });
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  return {
    url,
    title: normalizeText(titleElement ? elementText(titleElement) : hostname, 240) || hostname,
    description: normalizeText(
      descriptionElement ? attribute(descriptionElement, "content") ?? "" : "",
      600,
    ),
    paragraphs: boundedParagraphs,
  };
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPublicIpv4(mapped);
  if (normalized === "::" || normalized === "::1") return false;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return false;
  if (/^fe[89ab]/.test(normalized) || normalized.startsWith("ff")) return false;
  if (normalized.startsWith("2001:db8:")) return false;
  return normalized.startsWith("2") || normalized.startsWith("3");
}

function isPublicAddress(address: string, family: number): boolean {
  return family === 4 ? isPublicIpv4(address) : family === 6 && isPublicIpv6(address);
}

async function resolvePublicAddress(
  hostname: string,
  signal: AbortSignal,
): Promise<{ address: string; family: number }> {
  let addresses: LookupAddress[];
  let onAbort: (() => void) | undefined;
  try {
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      aborted,
    ]);
  } catch (error) {
    if (signal.aborted) throw error;
    throw genAppError("web_page_failed", "Web page hostname could not be resolved.", 502, true);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
  const approved = addresses.find((entry) => isPublicAddress(entry.address, entry.family));
  if (!approved) {
    throw genAppError("web_page_failed", "Web page address is not public.", 400);
  }
  return approved;
}

function decodePage(buffer: Buffer, contentType: string): string {
  const charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw genAppError("validation_failed", "Web page URL is invalid.", 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw genAppError("validation_failed", "Web page URL must use HTTP or HTTPS.", 400);
  }
  if (url.username || url.password) {
    throw genAppError("validation_failed", "Web page URL cannot contain credentials.", 400);
  }
  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expectedPort) {
    throw genAppError("web_page_failed", "Non-standard web page ports are blocked.", 400);
  }
  return url;
}

async function fetchPage(
  rawUrl: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<{ url: string; html: string }> {
  const url = validateUrl(rawUrl);
  const resolved = await resolvePublicAddress(url.hostname, signal);
  const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, [resolved]);
    else callback(null, resolved.address, resolved.family);
  };
  return new Promise((resolve, reject) => {
    const request = transport(
      url,
      {
        method: "GET",
        signal,
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5",
          "accept-encoding": "identity",
          "user-agent": "OpenOS/0.1 WebPageReader",
        },
        lookup: pinnedLookup,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (redirects >= PAGE_MAX_REDIRECTS) {
            reject(genAppError("web_page_failed", "Web page redirected too many times.", 502, true));
            return;
          }
          const next = new URL(response.headers.location, url).toString();
          void fetchPage(next, signal, redirects + 1).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(genAppError("web_page_failed", `Web page returned HTTP ${status}.`, 502, true));
          return;
        }
        const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml") && !contentType.includes("text/plain")) {
          response.resume();
          reject(genAppError("web_page_failed", "Web page content type is not readable.", 415));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > PAGE_MAX_BYTES) {
            request.destroy(genAppError("web_page_failed", "Web page is too large.", 413));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({
          url: url.toString(),
          html: decodePage(Buffer.concat(chunks), contentType),
        }));
      },
    );
    request.setTimeout(PAGE_TIMEOUT_MS, () =>
      request.destroy(genAppError("generation_timeout", "Web page request timed out.", 504, true)),
    );
    request.on("error", (error) => reject(error));
    request.end();
  });
}

/** 公网页面只提取纯文本摘要，绝不把远端 HTML/脚本直接放入生成 iframe。 */
export class SafeWebPageProvider implements WebPageProvider {
  async open(url: string, signal: AbortSignal): Promise<WebPageContent> {
    const timeout = AbortSignal.timeout(PAGE_TIMEOUT_MS);
    const requestSignal = AbortSignal.any ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const page = await fetchPage(url, requestSignal);
      return extractReadableWebPage(page.html, page.url);
    } catch (error) {
      const typed = error as Error & { code?: string; status?: number };
      if (typed.status || signal.aborted) throw error;
      if (timeout.aborted) {
        throw genAppError("generation_timeout", "Web page request timed out.", 504, true);
      }
      throw genAppError("web_page_failed", "Web page is temporarily unavailable.", 502, true);
    }
  }
}
