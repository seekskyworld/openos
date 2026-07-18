import type { AgentIssue, AgentTask } from "../../agent-core/index.js";
import type { CoreMessage } from "../../llm-core/index.js";
import { unwrapHtmlFence } from "../artifact-extract.js";
import { validateGenAppMarkup } from "../markup-artifact.js";

type MarkupAppTaskInput = {
  system: string;
  user: string;
  firstTemperature: number;
  canCompile: (markup: string) => boolean;
};

/** V2 声明式任务包：修复轮只处理小标记，不再让模型重写 CSS/JS/文档外壳。 */
export function createMarkupAppTask(
  input: MarkupAppTaskInput,
): AgentTask<string> {
  return {
    name: "gen-app-markup-v2",
    firstTemperature: input.firstTemperature,
    fixTemperature: 0.15,

    buildFirstPrompt(): CoreMessage[] {
      return [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ];
    },

    buildFixPrompt(previous: string, issues: AgentIssue[]): CoreMessage[] {
      const issueText = issues
        .map(
          (issue) =>
            `[${issue.severity === "fatal" ? "FATAL" : "WARN"}] ${issue.code}: ${issue.message}${issue.excerpt ? `\n相关片段：${issue.excerpt}` : ""}`,
        )
        .join("\n");
      return [
        {
          role: "user",
          content: [
            "上一轮声明式标记未通过检查，请只修复列出的问题。",
            issueText,
            "只输出修复后的完整 body 标记片段；不要 HTML 文档外壳、CSS、JavaScript、解释、diff 或代码块。",
            "如果上一轮已经可用且问题只能是误报，只输出 OPENOS_DONE。",
            "上一轮标记：",
            previous,
          ].join("\n\n"),
        },
      ];
    },

    detectDone(raw: string): boolean {
      const trimmed = raw.trim();
      return trimmed.length < 200 && /\bOPENOS_DONE\b/.test(trimmed);
    },

    extract(raw: string): string | null {
      const markup = unwrapHtmlFence(raw).trim();
      return markup.length >= 20 ? markup : null;
    },

    validate(markup: string): AgentIssue[] {
      return validateGenAppMarkup(markup);
    },

    canDegrade(markup: string): boolean {
      return input.canCompile(markup);
    },
  };
}
