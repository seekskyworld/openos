type RuntimePatchProposal = {
  baseRevision: number;
  targetId: string;
  html: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function jsonCandidates(raw: string): string[] {
  const source = String(raw ?? "").trim();
  const candidates = [source];
  const fence = source.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i);
  if (fence) candidates.unshift(fence[1].trim());
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(source.slice(first, last + 1));
  return [...new Set(candidates)];
}

/** 解析模型提案但不信任其 revision/target；调用方必须传入期望值进行比对。 */
export function parseRuntimePatchProposal(
  raw: string,
  expected: { baseRevision: number; targetId: string },
): RuntimePatchProposal {
  let parsed: unknown;
  for (const candidate of jsonCandidates(raw)) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      // 继续尝试 fence/对象截取候选。
    }
  }
  const record = asRecord(parsed);
  if (!record) throw new Error("response is not a JSON object");
  if (record.baseRevision !== expected.baseRevision) {
    throw new Error("baseRevision does not match the active session");
  }
  if (!Array.isArray(record.ops) || record.ops.length !== 1) {
    throw new Error("ops must contain exactly one operation");
  }
  const operation = asRecord(record.ops[0]);
  if (!operation || operation.op !== "replace") {
    throw new Error("operation must be replace");
  }
  if (operation.targetId !== expected.targetId) {
    throw new Error("targetId does not match the server-selected target");
  }
  if (typeof operation.html !== "string" || !operation.html.trim()) {
    throw new Error("replacement html is empty");
  }
  return {
    baseRevision: expected.baseRevision,
    targetId: expected.targetId,
    html: operation.html,
  };
}
