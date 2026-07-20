/**
 * 生成模型常在代理完成预填充后才返回响应头，不能复用短交互的 30s 默认值。
 * header 预算只覆盖首响应；流开始后由 idle 预算检测真正卡死。
 */
export const GEN_APP_LLM_BUDGETS = {
  generationTotalMs: 600_000,
  generationHeaderMs: 120_000,
  generationIdleMs: 90_000,
  continuationTotalMs: 120_000,
  continuationHeaderMs: 60_000,
  continuationIdleMs: 60_000,
} as const;
