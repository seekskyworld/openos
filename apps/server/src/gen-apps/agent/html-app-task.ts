import type { CoreMessage } from "../../llm-core/index.js";
import type { AgentIssue, AgentTask } from "../../agent-core/index.js";
import { extractHtml } from "../artifact-extract.js";
import { validateArtifact } from "../artifact-validator.js";

/**
 * Gen Apps 的 AgentTask 实现：单文件 HTML 应用生成任务。
 * agent-core 对制品类型不感知——本文件承载全部「HTML 应用」上下文：
 * 首轮提示词、修复提示词措辞、提取、校验、可编译降级判定。
 *
 * 其他 LLM 应用要用同一个 coding agent，只需仿照本文件实现自己的 AgentTask
 * （如 SQL 任务：extract=剥代码块、validate=EXPLAIN 试跑、fix 提示词=重申只输出 SQL）。
 */

type HtmlAppTaskInput = {
  /** 首轮 system 提示词（由 prompt-policy 组装，含风格/语言上下文） */
  system: string;
  /** 首轮 user 数据 */
  user: string;
  /** 首轮采样温度（creativity 映射） */
  firstTemperature: number;
  /** 判断制品能否被 ArtifactCompiler 接受（降级策略 2） */
  canCompile: (html: string) => boolean;
};

export function createHtmlAppTask(input: HtmlAppTaskInput): AgentTask<string> {
  return {
    name: "gen-app-html",
    firstTemperature: input.firstTemperature,
    fixTemperature: 0.2,

    buildFirstPrompt(): CoreMessage[] {
      return [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ];
    },

    buildFixPrompt(previous: string, issues: AgentIssue[]): CoreMessage[] {
      const list = issues
        .map(
          (i) =>
            `[${i.severity === "fatal" ? "FATAL" : "WARN"}] ${i.code}: ${i.message}${i.excerpt ? `\n  相关片段：\`${i.excerpt}\`` : ""}`,
        )
        .join("\n");
      const user = [
        "你上一轮生成的应用未通过自动检查，请修复以下问题后重新输出完整 HTML（仍然单文件、无外部资源）：",
        "",
        list,
        "",
        "只输出修复后的完整 HTML 文档，不要解释。不要输出 diff 或片段。",
        "",
        "上一轮完整 HTML：",
        "```html",
        previous,
        "```",
      ].join("\n");
      return [{ role: "user", content: user }];
    },

    extract(raw: string, previous: string | null): string | null {
      const html = extractHtml(raw);
      const trimmed = html.trim();
      if (!trimmed) return null;
      // 疑似 diff / 片段：无文档标签且长度骤减
      if (!/<html\b/i.test(trimmed) && !/<!DOCTYPE/i.test(trimmed)) {
        const prevLen = previous?.length ?? 0;
        if (prevLen > 0 && trimmed.length < prevLen * 0.4) return null;
        if (trimmed.length < 80 && !/<body\b/i.test(trimmed)) return null;
      }
      return html;
    },

    validate(artifact: string): AgentIssue[] {
      return validateArtifact(artifact);
    },

    canDegrade(artifact: string): boolean {
      return input.canCompile(artifact);
    },
  };
}
