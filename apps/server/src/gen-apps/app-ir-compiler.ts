import { parseAppIr, type AppIr, type AppIrComponent, type AppIrValue } from "@openos/shared";
import { genAppError, type UntrustedArtifact } from "./domain.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function valueText(value: AppIrValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function prop(component: AppIrComponent, name: string): AppIrValue | undefined {
  return component.props?.[name];
}

function classFor(type: string): string {
  if (type === "surface") return "os-app os-column";
  if (type === "stack" || type === "column") return "os-card os-column";
  if (type === "list") return "os-list";
  if (type === "text") return "os-caption";
  if (type === "button") return "os-button";
  if (type === "input") return "os-input";
  return "os-card";
}

/**
 * 将模型产生的 AppIR 编译为当前 Runtime V2 可消费的声明式 markup。
 * 这是迁移期 adapter；运行时稳定后可替换为原生 renderer，而不改变 AppIR 接口。
 */
export function compileAppIr(input: AppIr): UntrustedArtifact {
  if (!parseAppIr(input)) throw genAppError("artifact_rejected", "Invalid AppIR.", 422, true);
  const rendered = new Set<string>();
  const render = (id: string, depth = 0): string => {
    if (depth > 40 || rendered.has(id)) throw genAppError("artifact_rejected", "AppIR contains a cycle or excessive nesting.", 422, true);
    const component = input.components[id];
    if (!component) throw genAppError("artifact_rejected", `Missing AppIR component: ${id}.`, 422, true);
    rendered.add(id);
    const children = (component.children ?? []).map((child) => render(child, depth + 1)).join("");
    const label = escapeHtml(valueText(prop(component, "label") ?? prop(component, "value")));
    const action = component.actionIds?.[0] ? input.actions[component.actionIds[0]] : undefined;
    const actionAttrs = action
      ? ` data-action="${escapeHtml(action.name)}"${action.targetId ? ` data-target="${escapeHtml(action.targetId)}"` : ""}`
      : "";
    const classes = classFor(component.type);
    rendered.delete(id);
    if (component.type === "input") {
      const inputType = escapeHtml(valueText(prop(component, "inputType") ?? "text"));
      return `<input id="${escapeHtml(id)}" class="${classes}" type="${inputType}"${component.dataPath ? ` data-path="${escapeHtml(component.dataPath)}"` : ""}${actionAttrs} placeholder="${label}">`;
    }
    if (component.type === "button") return `<button id="${escapeHtml(id)}" class="${classes}" type="button"${actionAttrs}>${label}</button>`;
    if (component.type === "text") return `<p id="${escapeHtml(id)}" class="${classes}">${label}${children}</p>`;
    const tag = component.type === "surface" ? "main" : "div";
    return `<${tag} id="${escapeHtml(id)}" class="${classes}">${label}${children}</${tag}>`;
  };
  const markup = render(input.root);
  return {
    html: markup,
    provider: "openos-appir",
    model: `appir-${input.catalogVersion}`,
    interactionMode: "hybrid",
    appIr: input,
  };
}
