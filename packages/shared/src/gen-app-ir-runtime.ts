import type { AppIr, AppIrDataPatch, AppIrExpression, AppIrValue } from "./gen-app-ir.js";

export type AppIrEvent = {
  type: string;
  payload?: AppIrValue;
};

export type AppIrRuntimeState = {
  activeState: string;
  data: AppIrValue;
  effects: string[];
  patches: AppIrDataPatch[];
  handled: boolean;
};

function clone(value: AppIrValue): AppIrValue {
  if (Array.isArray(value)) return value.map(clone);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
}

function tokens(path: string): string[] {
  if (!path) return [];
  return path.slice(1).split("/").map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function getPath(data: AppIrValue, path: string): AppIrValue | undefined {
  let current: AppIrValue | undefined = data;
  for (const token of tokens(path)) {
    if (Array.isArray(current)) current = current[Number(token)];
    else if (current !== null && typeof current === "object") current = current[token];
    else return undefined;
  }
  return current;
}

function setPath(data: AppIrValue, path: string, value: AppIrValue, remove = false): AppIrValue {
  const pathTokens = tokens(path);
  if (pathTokens.length === 0) return remove ? null : clone(value);
  const root = clone(data);
  let current: AppIrValue = root;
  for (let index = 0; index < pathTokens.length - 1; index += 1) {
    const token = pathTokens[index];
    const next = pathTokens[index + 1];
    if (Array.isArray(current)) {
      const item = current[Number(token)];
      if (item === undefined) current[Number(token)] = /^\d+$/u.test(next) ? [] : {};
      current = current[Number(token)]!;
    } else if (current !== null && typeof current === "object") {
      if (current[token] === undefined) current[token] = /^\d+$/u.test(next) ? [] : {};
      current = current[token]!;
    } else throw new Error("cannot traverse data path");
  }
  const last = pathTokens[pathTokens.length - 1];
  if (Array.isArray(current)) {
    const index = Number(last);
    if (remove) current.splice(index, 1);
    else current[index] = clone(value);
  } else if (current !== null && typeof current === "object") {
    if (remove) delete current[last];
    else current[last] = clone(value);
  } else throw new Error("cannot set data path");
  return root;
}

function expressionValue(expression: AppIrExpression, data: AppIrValue): AppIrValue | undefined {
  if (expression.op === "literal") return expression.value;
  if (expression.op === "path") return getPath(data, expression.path);
  if (expression.op === "not") return !Boolean(expressionValue(expression.value, data));
  if (expression.op === "and") return expression.values.every((item) => Boolean(expressionValue(item, data)));
  if (expression.op === "or") return expression.values.some((item) => Boolean(expressionValue(item, data)));
  if (!("left" in expression && "right" in expression)) return false;
  const left = expressionValue(expression.left, data);
  const right = expressionValue(expression.right, data);
  if (expression.op === "equals") return JSON.stringify(left) === JSON.stringify(right);
  if (typeof left !== "number" || typeof right !== "number") return false;
  if (expression.op === "gt") return left > right;
  if (expression.op === "gte") return left >= right;
  if (expression.op === "lt") return left < right;
  return left <= right;
}

function applyPatch(data: AppIrValue, patch: AppIrDataPatch): AppIrValue {
  if (patch.op === "test") return JSON.stringify(getPath(data, patch.path)) === JSON.stringify(patch.value) ? data : data;
  if (patch.op === "remove") return setPath(data, patch.path, null, true);
  if (patch.value === undefined) throw new Error("patch value is required");
  return setPath(data, patch.path, patch.value);
}

/** 在本地执行模型声明的状态图；不执行字符串代码，也不发起外部请求。 */
export function dispatchAppIrEvent(
  ir: AppIr,
  current: Pick<AppIrRuntimeState, "activeState" | "data">,
  event: AppIrEvent,
): AppIrRuntimeState {
  const state = ir.behavior?.states[current.activeState];
  if (!state) return { activeState: current.activeState, data: current.data, effects: [], patches: [], handled: false };
  const transition = state.transitions.find((candidate) => candidate.event === event.type && (!candidate.when || Boolean(expressionValue(candidate.when, current.data))));
  if (!transition) return { activeState: current.activeState, data: current.data, effects: [], patches: [], handled: false };
  let data = clone(current.data);
  for (const patch of transition.updates ?? []) data = applyPatch(data, patch);
  return {
    activeState: transition.targetState ?? current.activeState,
    data,
    effects: [...(transition.effects ?? [])],
    patches: [...(transition.updates ?? [])],
    handled: true,
  };
}
