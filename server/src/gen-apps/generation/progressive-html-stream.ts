import { GEN_APP_LIMITS } from "@openos/shared";
import {
  compileReplacementMarkup,
  replaceMarkupElement,
  sanitizeGenAppMarkup,
} from "../markup-artifact.js";

export const PROGRESSIVE_HTML_STAGES = ["shell", "core", "content", "actions"] as const;
export type ProgressiveHtmlStage = (typeof PROGRESSIVE_HTML_STAGES)[number];

export type ProgressiveHtmlSnapshot = {
  stage: ProgressiveHtmlStage;
  markup: string;
};

const BLOCK_END = "<!--openos:end-->";
const BLOCK_HEADER = /^<!--openos:stage:(shell|core|content|actions)(?::([A-Za-z][A-Za-z0-9_-]{0,119}))?-->$/;
const BUFFER_MAX_BYTES = GEN_APP_LIMITS.htmlMaxBytes * 2;

/**
 * 模型仍直接书写 HTML；控制注释只负责划定闭合的原子子树，避免半截 token 进入 DOM。
 * 每个快照都经过完整引用图校验，前端因此只会看到可交互的有效文档。
 */
export class ProgressiveHtmlAssembler {
  private buffer = "";
  private currentMarkup: string | null = null;
  private lastStageIndex = -1;
  private lastFailure: string | null = null;

  push(chunk: string): ProgressiveHtmlSnapshot[] {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > BUFFER_MAX_BYTES) {
      this.buffer = this.buffer.slice(-GEN_APP_LIMITS.htmlMaxBytes);
    }
    return this.consumeBlocks();
  }

  finish(): ProgressiveHtmlSnapshot[] {
    return this.consumeBlocks();
  }

  latestMarkup(): string | null {
    return this.currentMarkup;
  }

  latestStage(): ProgressiveHtmlStage | null {
    return this.lastStageIndex >= 0 ? PROGRESSIVE_HTML_STAGES[this.lastStageIndex] : null;
  }

  latestFailure(): string | null {
    return this.lastFailure;
  }

  private consumeBlocks(): ProgressiveHtmlSnapshot[] {
    const snapshots: ProgressiveHtmlSnapshot[] = [];
    while (true) {
      const start = this.buffer.indexOf("<!--openos:stage:");
      if (start < 0) return snapshots;
      if (start > 0) this.buffer = this.buffer.slice(start);
      const headerEnd = this.buffer.indexOf("-->");
      if (headerEnd < 0) return snapshots;
      const blockEnd = this.buffer.indexOf(BLOCK_END, headerEnd + 3);
      if (blockEnd < 0) return snapshots;
      const header = this.buffer.slice(0, headerEnd + 3);
      const html = this.buffer.slice(headerEnd + 3, blockEnd).trim();
      this.buffer = this.buffer.slice(blockEnd + BLOCK_END.length);
      const snapshot = this.compileBlock(header, html);
      if (snapshot) snapshots.push(snapshot);
    }
  }

  private compileBlock(header: string, html: string): ProgressiveHtmlSnapshot | null {
    const match = header.match(BLOCK_HEADER);
    if (!match || !html) {
      this.lastFailure = "Invalid or empty progressive HTML block.";
      return null;
    }
    const stage = match[1] as ProgressiveHtmlStage;
    const targetId = match[2];
    const stageIndex = PROGRESSIVE_HTML_STAGES.indexOf(stage);
    if (stageIndex !== this.lastStageIndex + 1) {
      this.lastFailure = `Unexpected progressive HTML stage: ${stage}.`;
      return null;
    }

    try {
      const markup = stage === "shell"
        ? this.compileShell(html, targetId)
        : this.compileReplacement(html, targetId);
      this.currentMarkup = markup;
      this.lastStageIndex = stageIndex;
      return { stage, markup };
    } catch (error) {
      this.lastFailure = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  private compileShell(html: string, targetId: string | undefined): string {
    if (this.currentMarkup || targetId) throw new Error("Shell stage cannot target an element.");
    return sanitizeGenAppMarkup(html).markup;
  }

  private compileReplacement(html: string, targetId: string | undefined): string {
    if (!this.currentMarkup || !targetId) throw new Error("Replacement stage requires a target.");
    const replacement = compileReplacementMarkup(html, targetId);
    return replaceMarkupElement(this.currentMarkup, targetId, replacement);
  }
}

export function extractProgressiveHtml(raw: string): string | null {
  const assembler = new ProgressiveHtmlAssembler();
  assembler.push(raw);
  assembler.finish();
  return assembler.latestStage() === "actions"
    ? assembler.latestMarkup()
    : null;
}
