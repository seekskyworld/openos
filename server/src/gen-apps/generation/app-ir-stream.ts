import { parseAppIr, type AppIr } from "@openos/shared";
import { compileAppIr } from "../app-ir-compiler.js";

export const APP_IR_STAGES = ["surface", "core", "data", "behavior"] as const;
export type AppIrStage = (typeof APP_IR_STAGES)[number];

export type AppIrStageSnapshot = {
  stage: AppIrStage;
  appIr: AppIr;
  markup: string;
};

/**
 * 将任意模型 token 分块收敛为独立完整的阶段快照。
 * 不完整、重复、乱序或未通过 AppIR 校验的行不会进入前端。
 */
export class AppIrStageAssembler {
  private buffer = "";
  private lastStageIndex = -1;
  private latest: AppIr | null = null;

  push(chunk: string): AppIrStageSnapshot[] {
    this.buffer += chunk;
    const output: AppIrStageSnapshot[] = [];
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      const snapshot = this.parseLine(line);
      if (snapshot) output.push(snapshot);
    }
    return output;
  }

  finish(): AppIrStageSnapshot[] {
    if (!this.buffer.trim()) return [];
    const snapshot = this.parseLine(this.buffer);
    this.buffer = "";
    return snapshot ? [snapshot] : [];
  }

  latestAppIr(): AppIr | null {
    return this.latest;
  }

  private parseLine(rawLine: string): AppIrStageSnapshot | null {
    const line = rawLine.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/u, "").trim();
    if (!line.startsWith("{")) return null;
    try {
      const envelope = JSON.parse(line) as { stage?: unknown; ir?: unknown; patch?: unknown };
      const stageIndex = APP_IR_STAGES.indexOf(envelope.stage as AppIrStage);
      if (stageIndex < 0 || stageIndex <= this.lastStageIndex) return null;
      const candidate = envelope.ir ?? (this.latest && isRecord(envelope.patch)
        ? mergeAppIr(this.latest, envelope.patch)
        : null);
      const appIr = parseAppIr(candidate);
      if (!appIr) return null;
      const markup = compileAppIr(appIr).html;
      this.lastStageIndex = stageIndex;
      this.latest = appIr;
      return { stage: APP_IR_STAGES[stageIndex], appIr, markup };
    } catch {
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeRecord(base: unknown, patch: unknown): unknown {
  return isRecord(base) && isRecord(patch) ? { ...base, ...patch } : patch ?? base;
}

/** 后续阶段只传新增/替换字段，减少模型输出 token；合并结果仍需通过完整 AppIR 校验。 */
function mergeAppIr(base: AppIr, patch: Record<string, unknown>): unknown {
  return {
    ...base,
    ...patch,
    identity: mergeRecord(base.identity, patch.identity),
    components: mergeRecord(base.components, patch.components),
    actions: mergeRecord(base.actions, patch.actions),
    capabilities: mergeRecord(base.capabilities, patch.capabilities),
    engines: mergeRecord(base.engines, patch.engines),
    theme: mergeRecord(base.theme, patch.theme),
  };
}
