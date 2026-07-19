import {
  GEN_APP_LIMITS,
  isGenAppLocalAction,
  type GenAppDeclaredAction,
  type GenAppLocalAction,
} from "@openos/shared";
import {
  defaultTreeAdapter,
  parse,
  parseFragment,
  serialize,
  serializeOuter,
  type DefaultTreeAdapterMap,
} from "parse5";
import { genAppError } from "./domain.js";

type Element = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];
type ChildNode = DefaultTreeAdapterMap["childNode"];
type DocumentFragment = DefaultTreeAdapterMap["documentFragment"];

const REMOVED_TAGS = new Set([
  "script",
  "style",
  "link",
  "meta",
  "base",
  "iframe",
  "frame",
  "object",
  "embed",
  "form",
  "svg",
  "math",
  "canvas",
  "template",
]);

const UNWRAPPED_TAGS = new Set(["form"]);
const RESERVED_RUNTIME_IDS = new Set(["openos-root", "openos-toasts"]);
const SINGLE_ID_REFERENCE_ATTRIBUTES = ["data-target", "data-source", "for"];
const MULTI_ID_REFERENCE_ATTRIBUTES = [
  "aria-controls",
  "aria-describedby",
  "aria-labelledby",
  "aria-owns",
];

const ALLOWED_ATTRIBUTES = new Set([
  "id",
  "class",
  "role",
  "type",
  "name",
  "value",
  "placeholder",
  "checked",
  "selected",
  "disabled",
  "hidden",
  "for",
  "rows",
  "cols",
  "min",
  "max",
  "step",
  "title",
  "tabindex",
  "colspan",
  "rowspan",
  "autocomplete",
]);

const ACTIONS_REQUIRING_TARGET = new Set<GenAppLocalAction>([
  "tabs.select",
  "toggle",
  "modal.open",
  "filter",
  "sort",
  "counter.increment",
  "counter.decrement",
  "calc.input",
  "calc.evaluate",
  "calc.clear",
  "calc.backspace",
  "list.add",
]);

function isElement(node: ChildNode): node is Element {
  return defaultTreeAdapter.isElementNode(node);
}

function childNodes(node: ParentNode): ChildNode[] {
  return defaultTreeAdapter.getChildNodes(node) as ChildNode[];
}

function attr(element: Element, name: string): string | undefined {
  return element.attrs.find((entry) => entry.name === name)?.value;
}

function setAttr(element: Element, name: string, value: string): void {
  const existing = element.attrs.find((entry) => entry.name === name);
  if (existing) existing.value = value;
  else element.attrs.push({ name, value });
}

function removeNode(parent: ParentNode, node: ChildNode): void {
  void parent;
  defaultTreeAdapter.detachNode(node);
}

function normalizeInput(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  const fence = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n?```\s*$/i);
  const source = fence ? fence[1].trim() : trimmed;
  if (/<(?:html|body)\b/i.test(source)) {
    const document = parse(source);
    const html = childNodes(document).find(
      (node): node is Element => isElement(node) && node.tagName === "html",
    );
    const body = html
      ? childNodes(html).find(
          (node): node is Element => isElement(node) && node.tagName === "body",
        )
      : undefined;
    if (body) return serialize(body);
  }
  return source;
}

type SanitizeResult = {
  markup: string;
  actions: GenAppDeclaredAction[];
};

export type MarkupValidationIssue = {
  severity: "fatal" | "warning";
  code: string;
  message: string;
  excerpt?: string;
};

/** Agent 修复轮使用的确定性契约检查；安全清洗仍由 sanitizeGenAppMarkup 兜底。 */
export function validateGenAppMarkup(raw: string): MarkupValidationIssue[] {
  const source = normalizeInput(raw);
  if (!source) {
    return [{ severity: "fatal", code: "empty_markup", message: "声明式标记为空。" }];
  }
  const fragment = parseFragment(source);
  const issues: MarkupValidationIssue[] = [];
  let elementCount = 0;
  let firstRoot: Element | null = null;
  const inspect = (parent: ParentNode): void => {
    for (const node of childNodes(parent)) {
      if (!isElement(node)) continue;
      elementCount += 1;
      firstRoot ??= node;
      if (REMOVED_TAGS.has(node.tagName)) {
        issues.push({
          severity: "fatal",
          code: "forbidden_element",
          message: `V2 标记禁止 <${node.tagName}>，行为和样式必须使用宿主 UI Kit。`,
          excerpt: serializeOuter(node).slice(0, 180),
        });
      }
      for (const entry of node.attrs) {
        const name = entry.name.toLowerCase();
        if (
          name === "style" ||
          name === "href" ||
          name === "src" ||
          name === "srcset" ||
          name.startsWith("on")
        ) {
          issues.push({
            severity: "fatal",
            code: "forbidden_attribute",
            message: `V2 标记禁止 ${name} 属性，请改用 os-* 类名和 data-action。`,
            excerpt: serializeOuter(node).slice(0, 180),
          });
        }
      }
      const action = attr(node, "data-action");
      if (action && !isGenAppLocalAction(action)) {
        issues.push({
          severity: "fatal",
          code: "unknown_action",
          message: `data-action=${JSON.stringify(action)} 不在宿主动作词表中。`,
          excerpt: serializeOuter(node).slice(0, 180),
        });
      }
      if (node.tagName === "button" && !action) {
        issues.push({
          severity: "fatal",
          code: "button_without_action",
          message: "每个 button 都必须声明 data-action，优先使用本地动作。",
          excerpt: serializeOuter(node).slice(0, 180),
        });
      }
      inspect(node);
    }
  };
  inspect(fragment);
  if (elementCount < 2) {
    issues.push({
      severity: "fatal",
      code: "hollow_markup",
      message: "标记内容过少，无法形成可用应用。",
    });
  }
  if (elementCount > GEN_APP_LIMITS.markupNodeMaxCount) {
    issues.push({
      severity: "fatal",
      code: "node_limit_exceeded",
      message: `元素节点数 ${elementCount} 超过上限 ${GEN_APP_LIMITS.markupNodeMaxCount}。`,
    });
  }
  const rootClasses = firstRoot ? attr(firstRoot, "class")?.split(/\s+/) ?? [] : [];
  if (firstRoot && !rootClasses.includes("os-app")) {
    issues.push({
      severity: "warning",
      code: "missing_os_app_root",
      message: "最外层建议使用 class=\"os-app\" 以铺满窗口。",
    });
  }
  try {
    sanitizeGenAppMarkup(source);
  } catch (error) {
    issues.push({
      severity: "fatal",
      code: "markup_compile_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return issues.slice(0, 12);
}

/**
 * V2 标记编译：parse5 解析后重建允许的声明式子集。
 * 通用行为由 UI Kit Runtime 提供，模型脚本、样式和事件属性一律不进入制品。
 */
export function sanitizeGenAppMarkup(
  raw: string,
  options: { allowExternalReferences?: boolean } = {},
): SanitizeResult {
  const source = normalizeInput(raw);
  if (!source) {
    throw genAppError("invalid_model_output", "Model returned empty markup.", 422);
  }
  const fragment = parseFragment(source);
  let nodeCount = 0;
  const countElements = (parent: ParentNode): void => {
    for (const node of childNodes(parent)) {
      if (!isElement(node)) continue;
      nodeCount += 1;
      countElements(node);
    }
  };
  countElements(fragment);
  if (nodeCount > GEN_APP_LIMITS.markupNodeMaxCount) {
    throw genAppError(
      "artifact_rejected",
      `Markup exceeds the ${GEN_APP_LIMITS.markupNodeMaxCount} node limit.`,
      413,
      true,
    );
  }
  let generatedId = 0;
  const actions: GenAppDeclaredAction[] = [];
  const references: Array<{
    elementId: string;
    attribute: string;
    targetId: string;
  }> = [];
  const ids = new Set<string>();
  const idAliases = new Map<string, string>();

  const uniqueId = (preferred: string): string => {
    let candidate = preferred;
    while (ids.has(candidate) || RESERVED_RUNTIME_IDS.has(candidate)) {
      candidate = `${preferred}-${++generatedId}`;
    }
    return candidate;
  };

  const clean = (parent: ParentNode): void => {
    for (const node of [...childNodes(parent)]) {
      if (!isElement(node)) continue;
      if (REMOVED_TAGS.has(node.tagName)) {
        if (UNWRAPPED_TAGS.has(node.tagName)) {
          clean(node);
          for (const child of [...childNodes(node)]) {
            defaultTreeAdapter.detachNode(child);
            defaultTreeAdapter.insertBefore(parent, child, node);
          }
        }
        removeNode(parent, node);
        continue;
      }

      node.attrs = node.attrs.filter((entry) => {
        const name = entry.name.toLowerCase();
        if (name.startsWith("on")) return false;
        if (name === "style" || name === "href" || name === "src" || name === "srcset") {
          return false;
        }
        return (
          ALLOWED_ATTRIBUTES.has(name) ||
          name.startsWith("data-") ||
          name.startsWith("aria-")
        );
      });

      const interactive =
        node.tagName === "button" ||
        node.tagName === "a" ||
        node.tagName === "input" ||
        node.tagName === "select" ||
        node.tagName === "textarea";
      const originalId = attr(node, "id")?.trim();
      let id = originalId?.replace(/\s+/g, "-").slice(0, 120);
      if ((interactive || attr(node, "data-action")) && !id) {
        id = uniqueId(`os-action-${++generatedId}`);
      }
      if (id) {
        const duplicateOriginal = ids.has(id);
        const preferred = RESERVED_RUNTIME_IDS.has(id) ? `app-${id}` : id;
        id = uniqueId(preferred);
        setAttr(node, "id", id);
        if (
          originalId &&
          originalId !== id &&
          !duplicateOriginal &&
          !idAliases.has(originalId)
        ) {
          idAliases.set(originalId, id);
        }
        ids.add(id);
      }

      if (node.tagName === "button" && !attr(node, "type")) {
        setAttr(node, "type", "button");
      }
      if (node.tagName === "a" && attr(node, "data-href") && !attr(node, "data-action")) {
        setAttr(node, "data-action", "ai.generate");
      }
      if (node.tagName === "button" && !attr(node, "data-action")) {
        // 遗漏接线时进入 AI fallback，避免出现“按钮完全无反应”。
        setAttr(node, "data-action", "ai.patch");
      }

      const actionValue = attr(node, "data-action");
      if (actionValue) {
        if (!isGenAppLocalAction(actionValue)) {
          setAttr(node, "data-action", "ai.patch");
        }
      }
      clean(node);
    }
  };
  clean(fragment);

  const rewriteReferencesAndCollectActions = (parent: ParentNode): void => {
    for (const node of childNodes(parent)) {
      if (!isElement(node)) continue;
      const elementId = attr(node, "id") ?? `<${node.tagName}>`;
      for (const name of SINGLE_ID_REFERENCE_ATTRIBUTES) {
        const value = attr(node, name)?.trim();
        if (value) {
          const targetId = idAliases.get(value) ?? value;
          setAttr(node, name, targetId);
          references.push({ elementId, attribute: name, targetId });
        }
      }
      for (const name of MULTI_ID_REFERENCE_ATTRIBUTES) {
        const value = attr(node, name)?.trim();
        if (!value) continue;
        const targetIds = value
          .split(/\s+/)
          .map((token) => idAliases.get(token) ?? token);
        setAttr(node, name, targetIds.join(" "));
        for (const targetId of targetIds) {
          references.push({ elementId, attribute: name, targetId });
        }
      }
      const actionValue = attr(node, "data-action");
      const actionElementId = attr(node, "id");
      if (actionValue && actionElementId && isGenAppLocalAction(actionValue)) {
        actions.push({
          elementId: actionElementId,
          action: actionValue,
          targetId: attr(node, "data-target")?.trim() || undefined,
        });
      }
      rewriteReferencesAndCollectActions(node);
    }
  };
  rewriteReferencesAndCollectActions(fragment);

  for (const action of actions) {
    if (
      action.targetId &&
      !ids.has(action.targetId) &&
      !options.allowExternalReferences
    ) {
      throw genAppError(
        "artifact_rejected",
        `Action ${action.action} on #${action.elementId} references missing target #${action.targetId}.`,
        422,
        true,
      );
    }
    if (
      ACTIONS_REQUIRING_TARGET.has(action.action) &&
      !action.targetId
    ) {
      throw genAppError(
        "artifact_rejected",
        `Action ${action.action} on #${action.elementId} requires an existing data-target.`,
        422,
        true,
      );
    }
  }
  if (!options.allowExternalReferences) {
    for (const reference of references) {
      if (reference.attribute === "data-target" || ids.has(reference.targetId)) continue;
      throw genAppError(
        "artifact_rejected",
        `${reference.attribute} on #${reference.elementId} references missing id #${reference.targetId}.`,
        422,
        true,
      );
    }
  }

  const markup = serialize(fragment).trim();
  if (!markup || Buffer.byteLength(markup, "utf8") > GEN_APP_LIMITS.htmlMaxBytes) {
    throw genAppError("artifact_rejected", "Markup is empty or exceeds the size limit.", 413);
  }
  return { markup, actions };
}

function findElementById(parent: ParentNode, id: string): Element | null {
  for (const node of childNodes(parent)) {
    if (!isElement(node)) continue;
    if (attr(node, "id") === id) return node;
    const nested = findElementById(node, id);
    if (nested) return nested;
  }
  return null;
}

export function extractMarkupElement(raw: string, id: string): string | null {
  const fragment = parseFragment(normalizeInput(raw));
  const element = findElementById(fragment, id);
  return element ? serializeOuter(element) : null;
}

export type ResolvedMarkupInteraction = {
  action: GenAppLocalAction | null;
  actionElementHtml: string;
  patchTargetId: string;
  patchTargetHtml: string;
  dataHref?: string;
  dataPrompt?: string;
  dataValue?: string;
};

/**
 * 交互事件只信任元素 id；动作和补丁目标必须从服务端会话标记重新解析，
 * 不能接受 iframe 回传的 currentHtml/data-target 作为事实来源。
 */
export function resolveMarkupInteraction(
  raw: string,
  elementId: string,
): ResolvedMarkupInteraction | null {
  const fragment = parseFragment(normalizeInput(raw));
  const actionElement = findElementById(fragment, elementId);
  if (!actionElement) return null;
  const actionValue = attr(actionElement, "data-action");
  const action = isGenAppLocalAction(actionValue) ? actionValue : null;
  const patchTargetId = attr(actionElement, "data-target")?.trim() || elementId;
  const patchTarget = findElementById(fragment, patchTargetId);
  if (!patchTarget) return null;
  return {
    action,
    actionElementHtml: serializeOuter(actionElement),
    patchTargetId,
    patchTargetHtml: serializeOuter(patchTarget),
    dataHref: attr(actionElement, "data-href")?.trim() || undefined,
    dataPrompt: attr(actionElement, "data-prompt")?.trim() || undefined,
    dataValue: attr(actionElement, "data-value")?.trim() || undefined,
  };
}

export function compileReplacementMarkup(raw: string, targetId: string): string {
  const { markup } = sanitizeGenAppMarkup(raw, {
    // A replacement subtree may legitimately point at a sibling/ancestor.
    // replaceMarkupElement validates the reference again after merging.
    allowExternalReferences: true,
  });
  const fragment = parseFragment(markup);
  const roots = childNodes(fragment).filter(isElement);
  if (roots.length !== 1 || attr(roots[0], "id") !== targetId) {
    throw genAppError(
      "artifact_rejected",
      `Patch must contain exactly one root element with id ${targetId}.`,
      422,
      true,
    );
  }
  const bytes = Buffer.byteLength(markup, "utf8");
  if (bytes > GEN_APP_LIMITS.runtimePatchMaxBytes) {
    throw genAppError("artifact_rejected", "Patch exceeds the runtime size limit.", 413, true);
  }
  return markup;
}

function collectElementIds(
  parent: ParentNode,
  output: Set<string>,
  skip?: Element,
): void {
  for (const node of childNodes(parent)) {
    if (!isElement(node) || node === skip) continue;
    const id = attr(node, "id");
    if (id) output.add(id);
    collectElementIds(node, output, skip);
  }
}

export function replaceMarkupElement(
  source: string,
  targetId: string,
  replacement: string,
): string {
  const fragment = parseFragment(normalizeInput(source));
  const current = findElementById(fragment, targetId);
  if (!current || !current.parentNode) {
    throw genAppError("artifact_rejected", `Target ${targetId} was not found.`, 422, true);
  }
  const replacementFragment = parseFragment(replacement);
  const next = childNodes(replacementFragment).find(isElement);
  if (!next || attr(next, "id") !== targetId) {
    throw genAppError("artifact_rejected", `Replacement must preserve id ${targetId}.`, 422, true);
  }
  const outsideIds = new Set<string>();
  const replacementIds = new Set<string>();
  collectElementIds(fragment, outsideIds, current);
  collectElementIds(replacementFragment, replacementIds);
  const collision = [...replacementIds].find((id) => outsideIds.has(id));
  if (collision) {
    throw genAppError(
      "artifact_rejected",
      `Replacement id ${collision} already exists outside target ${targetId}.`,
      422,
      true,
    );
  }
  const parent = current.parentNode as ParentNode;
  defaultTreeAdapter.insertBefore(parent, next, current);
  defaultTreeAdapter.detachNode(current);
  const combined = serialize(fragment).trim();
  // The replacement can remove ids referenced by controls outside its subtree.
  // Recompile the whole document so a patch cannot commit a broken reference graph.
  sanitizeGenAppMarkup(combined);
  return combined;
}

export function parseMarkupFragment(raw: string): DocumentFragment {
  return parseFragment(normalizeInput(raw));
}
