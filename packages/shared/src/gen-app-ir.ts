/**
 * Model-first Gen Apps 中间表示。
 * 模型只产生受限数据结构，宿主根据 catalog 渲染和执行，不执行模型代码。
 */

export const APP_IR_PROTOCOL_VERSION = "openos-appir/v1" as const;
export const APP_IR_LIMITS = {
  maxComponents: 500,
  maxActions: 300,
  maxTransitions: 500,
  maxDataBytes: 256 * 1024,
  maxStringLength: 8_000,
} as const;

export type AppIrPrimitive = string | number | boolean | null;
export type AppIrValue = AppIrPrimitive | AppIrValue[] | { [key: string]: AppIrValue };

export type AppIrText = string | { zh?: string; en?: string; fallback: string };

export type AppIrComponent = {
  type: string;
  props?: Record<string, AppIrValue>;
  children?: string[];
  dataPath?: string;
  actionIds?: string[];
};

export type AppIrAction = {
  kind: "local" | "capability" | "ai";
  name: string;
  targetId?: string;
  input?: Record<string, AppIrValue>;
};

export type AppIrTransition = {
  event: string;
  targetState?: string;
  when?: AppIrExpression;
  updates?: AppIrDataPatch[];
  effects?: string[];
};

export type AppIrState = {
  transitions: AppIrTransition[];
};

export type AppIrBehavior = {
  initial: string;
  states: Record<string, AppIrState>;
};

export type AppIrExpression =
  | { op: "literal"; value: AppIrPrimitive }
  | { op: "path"; path: string }
  | { op: "not"; value: AppIrExpression }
  | { op: "equals" | "gt" | "gte" | "lt" | "lte"; left: AppIrExpression; right: AppIrExpression }
  | { op: "and" | "or"; values: AppIrExpression[] };

export type AppIrDataPatch = {
  op: "add" | "remove" | "replace" | "test";
  path: string;
  value?: AppIrValue;
};

export type AppIrCapability = {
  id: string;
  name: string;
  inputSchema?: Record<string, AppIrValue>;
};

export type AppIrEngine = {
  id: string;
  version: number;
  config: Record<string, AppIrValue>;
};

export type AppIr = {
  protocolVersion: typeof APP_IR_PROTOCOL_VERSION;
  catalogVersion: string;
  identity: {
    family: string;
    variant: string;
    title: AppIrText;
  };
  root: string;
  components: Record<string, AppIrComponent>;
  data: AppIrValue;
  actions: Record<string, AppIrAction>;
  behavior?: AppIrBehavior;
  capabilities?: Record<string, AppIrCapability>;
  engines?: Record<string, AppIrEngine>;
  theme?: Record<string, AppIrValue>;
};

export type AppIrValidationIssue = {
  path: string;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValue(value: unknown, depth = 0): value is AppIrValue {
  if (depth > 30 || value === null) return value === null;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isValue(item, depth + 1));
  return isRecord(value) && Object.values(value).every((item) => isValue(item, depth + 1));
}

function isText(value: unknown): value is AppIrText {
  if (typeof value === "string") return value.length <= APP_IR_LIMITS.maxStringLength;
  return isRecord(value) && typeof value.fallback === "string" &&
    value.fallback.length <= APP_IR_LIMITS.maxStringLength &&
    (value.zh === undefined || typeof value.zh === "string") &&
    (value.en === undefined || typeof value.en === "string");
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_.:-]{0,119}$/u.test(value);
}

function validPath(value: unknown): value is string {
  return typeof value === "string" && (value === "" || /^\/(?:[^/~]|~[01])*(?:\/(?:[^/~]|~[01])*)*$/u.test(value));
}

function validateExpression(value: unknown, path: string, issues: AppIrValidationIssue[], depth = 0): void {
  if (!isRecord(value) || typeof value.op !== "string" || depth > 12) {
    issues.push({ path, message: "invalid expression" });
    return;
  }
  if (value.op === "literal") {
    if (!isValue(value.value)) issues.push({ path: `${path}.value`, message: "literal must be JSON data" });
    return;
  }
  if (value.op === "path") {
    if (!validPath(value.path)) issues.push({ path: `${path}.path`, message: "invalid data path" });
    return;
  }
  if (value.op === "not") {
    validateExpression(value.value, `${path}.value`, issues, depth + 1);
    return;
  }
  if (value.op === "and" || value.op === "or") {
    if (!Array.isArray(value.values) || value.values.length === 0 || value.values.length > 20) {
      issues.push({ path: `${path}.values`, message: "boolean expression list is out of bounds" });
      return;
    }
    value.values.forEach((item, index) => validateExpression(item, `${path}.values[${index}]`, issues, depth + 1));
    return;
  }
  if (["equals", "gt", "gte", "lt", "lte"].includes(value.op)) {
    validateExpression(value.left, `${path}.left`, issues, depth + 1);
    validateExpression(value.right, `${path}.right`, issues, depth + 1);
    return;
  }
  issues.push({ path: `${path}.op`, message: "unsupported expression operator" });
}

export function validateAppIr(value: unknown): AppIrValidationIssue[] {
  const issues: AppIrValidationIssue[] = [];
  if (!isRecord(value)) return [{ path: "", message: "AppIR must be an object" }];
  if (value.protocolVersion !== APP_IR_PROTOCOL_VERSION) issues.push({ path: "/protocolVersion", message: "unsupported protocol version" });
  if (typeof value.catalogVersion !== "string" || value.catalogVersion.length > 80) issues.push({ path: "/catalogVersion", message: "invalid catalog version" });
  if (!isRecord(value.identity)) issues.push({ path: "/identity", message: "identity is required" });
  else {
    for (const key of ["family", "variant"] as const) {
      if (typeof value.identity[key] !== "string" || value.identity[key].length > 120) issues.push({ path: `/identity/${key}`, message: "invalid identity field" });
    }
    if (!isText(value.identity.title)) issues.push({ path: "/identity/title", message: "invalid title" });
  }
  if (!validId(value.root)) issues.push({ path: "/root", message: "root must be a valid component id" });
  if (!isRecord(value.components)) issues.push({ path: "/components", message: "components are required" });
  else {
    const ids = Object.keys(value.components);
    if (ids.length === 0 || ids.length > APP_IR_LIMITS.maxComponents) issues.push({ path: "/components", message: "component count is out of bounds" });
    for (const [id, component] of Object.entries(value.components)) {
      if (!validId(id)) issues.push({ path: `/components/${id}`, message: "invalid component id" });
      if (!isRecord(component) || typeof component.type !== "string" || component.type.length === 0 || component.type.length > 100) {
        issues.push({ path: `/components/${id}`, message: "invalid component" });
        continue;
      }
      if (component.props !== undefined && (!isRecord(component.props) || !isValue(component.props))) issues.push({ path: `/components/${id}/props`, message: "props must be JSON data" });
      if (component.children !== undefined && (!Array.isArray(component.children) || !component.children.every(validId))) issues.push({ path: `/components/${id}/children`, message: "children must reference component ids" });
      if (component.dataPath !== undefined && !validPath(component.dataPath)) issues.push({ path: `/components/${id}/dataPath`, message: "invalid data path" });
      if (component.actionIds !== undefined && (!Array.isArray(component.actionIds) || !component.actionIds.every(validId))) issues.push({ path: `/components/${id}/actionIds`, message: "actionIds must reference action ids" });
    }
    if (validId(value.root) && !value.components[value.root]) issues.push({ path: "/root", message: "root component does not exist" });
  }
  if (!isValue(value.data)) issues.push({ path: "/data", message: "data must be JSON data" });
  if (!isRecord(value.actions) || Object.keys(value.actions).length > APP_IR_LIMITS.maxActions) issues.push({ path: "/actions", message: "actions are missing or out of bounds" });
  else for (const [id, action] of Object.entries(value.actions)) {
    if (!validId(id) || !isRecord(action) || !(typeof action.kind === "string" && ["local", "capability", "ai"].includes(action.kind)) || typeof action.name !== "string") issues.push({ path: `/actions/${id}`, message: "invalid action" });
    if (isRecord(action) && action.input !== undefined && (!isRecord(action.input) || !isValue(action.input))) issues.push({ path: `/actions/${id}/input`, message: "action input must be JSON data" });
  }
  if (value.behavior !== undefined) {
    if (!isRecord(value.behavior) || typeof value.behavior.initial !== "string" || !isRecord(value.behavior.states)) issues.push({ path: "/behavior", message: "invalid behavior graph" });
    else {
      const transitions = Object.values(value.behavior.states).flatMap((state) => isRecord(state) && Array.isArray(state.transitions) ? state.transitions : []);
      if (transitions.length > APP_IR_LIMITS.maxTransitions) issues.push({ path: "/behavior/states", message: "transition count is out of bounds" });
      for (const [stateId, state] of Object.entries(value.behavior.states)) {
        if (!validId(stateId) || !isRecord(state) || !Array.isArray(state.transitions)) issues.push({ path: `/behavior/states/${stateId}`, message: "invalid state" });
        else state.transitions.forEach((transition, index) => {
          if (!isRecord(transition) || typeof transition.event !== "string") issues.push({ path: `/behavior/states/${stateId}/transitions/${index}`, message: "invalid transition" });
          else if (transition.when !== undefined) validateExpression(transition.when, `/behavior/states/${stateId}/transitions/${index}/when`, issues);
        });
      }
    }
  }
  if (value.capabilities !== undefined && (!isRecord(value.capabilities) || !Object.keys(value.capabilities).every(validId))) issues.push({ path: "/capabilities", message: "invalid capabilities" });
  if (value.engines !== undefined && (!isRecord(value.engines) || !Object.keys(value.engines).every(validId))) issues.push({ path: "/engines", message: "invalid engines" });
  if (value.theme !== undefined && (!isRecord(value.theme) || !isValue(value.theme))) issues.push({ path: "/theme", message: "theme must be JSON data" });
  if (isValue(value.data) && JSON.stringify(value.data).length > APP_IR_LIMITS.maxDataBytes) issues.push({ path: "/data", message: "data exceeds byte limit" });
  return issues;
}

function sortValue(value: AppIrValue): AppIrValue {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

export function canonicalizeAppIr(value: AppIr): AppIr {
  return sortValue(value) as AppIr;
}

export function createAppIrCacheKey(value: AppIr): string {
  const input = JSON.stringify(canonicalizeAppIr(value));
  let hash = 0x811c9dc5;
  for (const char of input) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193);
  return `appir-${(hash >>> 0).toString(36)}`;
}

export function parseAppIr(value: unknown): AppIr | null {
  return validateAppIr(value).length === 0 ? value as AppIr : null;
}
