import { randomUUID } from "node:crypto";
import {
  clampSuggestionCount,
  GEN_APP_LIMITS,
  GEN_APP_PROMPT_VERSION,
  isGenAppContinueIntent,
  isGenAppIconTheme,
  type GenAppDraft,
  type GenAppIconTheme,
  type GenAppLaunchBundle,
  type GenAppSuggestion,
  type GenAppSummary,
} from "@openos/shared";
import { compileArtifact, compileFragment } from "./artifact-compiler.js";
import { ContinueSessionStore } from "./continue-session-store.js";
import { genAppError, type UntrustedSuggestion } from "./domain.js";
import type { GenAppLanguage } from "./gen-app-settings.js";
import type { CoreMessage } from "../llm-core/index.js";
import { buildContinuePrompt } from "./prompt-policy.js";
import type { GenAppGenerator, GenAppRepository } from "./ports.js";

/**
 * GenApps 应用服务：用例编排、状态转换、幂等、配额。
 * 不依赖 Node HTTP / React / SQLite / 具体模型 SDK。
 */

export type RequestContext = {
  requestId: string;
  signal: AbortSignal;
};

type ServiceDeps = {
  generator: GenAppGenerator;
  repository: GenAppRepository;
  /** 测试可注入固定 now */
  now?: () => number;
  /** suggest count 缺省值提供者（读设置）；缺省用共享默认 */
  defaultSuggestionCount?: () => number;
  /** 生成整体超时（ms）；agentic 建议 240s */
  generateTimeoutMs?: () => number;
  /** 续生成提示词的界面语言；缺省 auto */
  appLanguage?: () => GenAppLanguage;
};

const FALLBACK_THEMES: GenAppIconTheme[] = [
  "blue",
  "purple",
  "pink",
  "orange",
  "green",
  "teal",
];

function sanitizeSuggestion(
  raw: UntrustedSuggestion,
  index: number,
): GenAppSuggestion | null {
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 60) : "";
  if (!name) return null;
  const description =
    typeof raw.description === "string" ? raw.description.slice(0, 300) : "";
  const iconEmoji =
    typeof raw.iconEmoji === "string" && raw.iconEmoji.trim()
      ? raw.iconEmoji.trim().slice(0, 8)
      : "✨";
  const iconTheme = isGenAppIconTheme(raw.iconTheme)
    ? raw.iconTheme
    : FALLBACK_THEMES[index % FALLBACK_THEMES.length];
  return {
    id: `gs-${randomUUID()}`,
    name,
    description,
    iconEmoji,
    iconTheme,
  };
}

export class GenAppsService {
  private readonly generator: GenAppGenerator;
  private readonly repository: GenAppRepository;
  private readonly nowFn: () => number;
  private readonly defaultCountFn: () => number;
  private readonly generateTimeoutMsFn: () => number;
  private readonly appLanguageFn: () => GenAppLanguage;
  private activeGenerations = 0;
  /** 续生成滑动窗口（appId → 时间戳数组，频控按应用维度） */
  private readonly continueHistory = new Map<string, number[]>();
  /** 并发锁按会话维度（同应用的不同会话/标签页可并行） */
  private readonly continueInFlight = new Set<string>();
  /** 续生成会话记忆：同一条续生成流跨调用保持上下文 */
  private readonly continueSessions = new ContinueSessionStore();

  constructor(deps: ServiceDeps) {
    this.generator = deps.generator;
    this.repository = deps.repository;
    this.nowFn = deps.now ?? (() => Date.now());
    this.defaultCountFn =
      deps.defaultSuggestionCount ??
      (() => GEN_APP_LIMITS.suggestionCountDefault);
    this.generateTimeoutMsFn =
      deps.generateTimeoutMs ?? (() => GEN_APP_LIMITS.generateTimeoutMs);
    this.appLanguageFn = deps.appLanguage ?? (() => "auto");
  }

  async suggest(
    input: { query: string; count?: number },
    context: RequestContext,
  ): Promise<GenAppSuggestion[]> {
    const query = (input.query ?? "").trim();
    if (
      query.length < GEN_APP_LIMITS.queryMinLength ||
      query.length > GEN_APP_LIMITS.queryMaxLength
    ) {
      throw genAppError(
        "validation_failed",
        `query must be ${GEN_APP_LIMITS.queryMinLength}-${GEN_APP_LIMITS.queryMaxLength} chars.`,
        400,
      );
    }
    const count = clampSuggestionCount(
      input.count !== undefined ? input.count : this.defaultCountFn(),
    );

    const raw = await this.generator.suggest({ query, count }, context.signal);
    const seenNames = new Set<string>();
    const out: GenAppSuggestion[] = [];
    for (let i = 0; i < raw.length && out.length < count; i++) {
      const s = sanitizeSuggestion(raw[i], i);
      if (!s || seenNames.has(s.name)) continue;
      seenNames.add(s.name);
      out.push(s);
    }
    if (out.length === 0) {
      throw genAppError(
        "invalid_model_output",
        "Generator returned no valid suggestions.",
        422,
        true,
      );
    }
    return out;
  }

  async generateDraft(
    input: {
      suggestion: GenAppSuggestion;
      query: string;
      idempotencyKey: string;
    },
    context: RequestContext,
    hooks?: {
      onDelta?: (text: string) => void;
      onPhase?: (phase: { phase: string; round?: number }) => void;
    },
  ): Promise<GenAppDraft> {
    const { suggestion } = input;
    if (!suggestion?.name?.trim()) {
      throw genAppError("validation_failed", "suggestion.name is required.", 400);
    }
    const key = (input.idempotencyKey ?? "").trim();
    if (!key) {
      throw genAppError("validation_failed", "idempotencyKey is required.", 400);
    }

    // 幂等：同 key 直接返回已有草稿
    const existing = this.repository.findByIdempotencyKey(key);
    if (existing) return existing;

    if (
      this.repository.countInstalled() >= GEN_APP_LIMITS.maxInstalledApps
    ) {
      throw genAppError(
        "storage_quota_exceeded",
        `Installed app limit (${GEN_APP_LIMITS.maxInstalledApps}) reached.`,
        429,
      );
    }

    if (this.activeGenerations >= GEN_APP_LIMITS.maxConcurrentGenerations) {
      throw genAppError(
        "validation_failed",
        "Another generation is in progress.",
        429,
        true,
      );
    }

    this.activeGenerations += 1;
    try {
      const timeoutMs = this.generateTimeoutMsFn();
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = AbortSignal.any
        ? AbortSignal.any([context.signal, timeout])
        : timeout;

      const untrusted = await this.generator
        .generate(
          {
            query: input.query ?? "",
            name: suggestion.name,
            description: suggestion.description,
            onDelta: hooks?.onDelta,
            onPhase: hooks?.onPhase,
          },
          signal,
        )
        .catch((error: unknown) => {
          if (timeout.aborted) {
            throw genAppError(
              "generation_timeout",
              "Generation timed out.",
              504,
              true,
            );
          }
          throw error;
        });

      const artifact = compileArtifact(untrusted);
      const now = this.nowFn();
      const draft = this.repository.createDraft({
        id: `ga-${randomUUID()}`,
        name: suggestion.name,
        description: suggestion.description,
        iconEmoji: suggestion.iconEmoji,
        iconTheme: suggestion.iconTheme,
        category: "AI",
        sourceQuery: input.query ?? "",
        generatorProvider: untrusted.provider,
        generatorModel: untrusted.model,
        promptVersion: GEN_APP_PROMPT_VERSION,
        artifact,
        now,
        draftTtlMs: GEN_APP_LIMITS.draftTtlMs,
      });
      this.repository.rememberIdempotencyKey(key, draft.summary.id);
      return draft;
    } finally {
      this.activeGenerations -= 1;
    }
  }

  /**
   * 运行时续生成（OpenOS.generate/update → /continue）：
   * 频控（按应用）+ 并发锁（按会话）+ 会话记忆（跨调用连贯）+ fragment 清洗。
   *
   * 会话分组：显式 sessionId 优先；update 默认按目标元素分组（同一元素的连续
   * 修改共享上下文）；其余按 intent 分组（单地址栏浏览器天然共享一条上下文，
   * 应用代码无需自己管理 sessionId）。
   */
  async continueContent(
    input: {
      appId: string;
      intent: unknown;
      prompt: unknown;
      context?: unknown;
      sessionId?: unknown;
      targetId?: unknown;
      currentHtml?: unknown;
    },
    context: RequestContext,
  ): Promise<{ fragment: string }> {
    const appId = String(input.appId ?? "").trim();
    const identity = appId ? this.repository.findIdentity(appId) : null;
    if (!identity) {
      throw genAppError("app_not_found", `App ${appId} not found.`, 404);
    }
    if (!isGenAppContinueIntent(input.intent)) {
      throw genAppError(
        "validation_failed",
        "intent must be one of: browse | panel | search | content | update.",
        400,
      );
    }
    const intent = input.intent;
    const prompt = String(input.prompt ?? "").trim();
    if (!prompt || prompt.length > GEN_APP_LIMITS.continuePromptMaxLength) {
      throw genAppError(
        "validation_failed",
        `prompt must be 1-${GEN_APP_LIMITS.continuePromptMaxLength} chars.`,
        400,
      );
    }
    const extra =
      typeof input.context === "string"
        ? input.context.slice(0, GEN_APP_LIMITS.continueContextMaxLength)
        : undefined;
    const sessionId =
      typeof input.sessionId === "string" && input.sessionId.trim()
        ? input.sessionId.trim().slice(0, GEN_APP_LIMITS.continueSessionIdMaxLength)
        : undefined;
    const targetId =
      typeof input.targetId === "string" && input.targetId.trim()
        ? input.targetId.trim().slice(0, 200)
        : undefined;
    const currentHtml =
      typeof input.currentHtml === "string"
        ? input.currentHtml.slice(0, GEN_APP_LIMITS.continueCurrentHtmlMaxLength)
        : undefined;
    if (intent === "update" && (!targetId || !currentHtml)) {
      throw genAppError(
        "validation_failed",
        "update intent requires targetId and currentHtml.",
        400,
      );
    }

    const sessionKey = `${appId}:${sessionId ?? (intent === "update" ? `update:${targetId}` : intent)}`;

    if (this.continueInFlight.has(sessionKey)) {
      throw genAppError(
        "validation_failed",
        "Another runtime generation for this session is in progress.",
        429,
        true,
      );
    }
    // 滑动窗口频控（次/分钟/应用，跨该应用所有会话共享额度）
    const now = this.nowFn();
    const windowStart = now - 60_000;
    const recent = (this.continueHistory.get(appId) ?? []).filter(
      (t) => t > windowStart,
    );
    if (recent.length >= GEN_APP_LIMITS.continueMaxPerMinute) {
      throw genAppError(
        "storage_quota_exceeded",
        `Runtime generation rate limit (${GEN_APP_LIMITS.continueMaxPerMinute}/min) reached.`,
        429,
        true,
      );
    }
    recent.push(now);
    this.continueHistory.set(appId, recent);

    this.continueInFlight.add(sessionKey);
    try {
      const timeout = AbortSignal.timeout(GEN_APP_LIMITS.continueTimeoutMs);
      const signal = AbortSignal.any
        ? AbortSignal.any([context.signal, timeout])
        : timeout;

      const built = buildContinuePrompt({
        appName: identity.name,
        appDescription: identity.description,
        sourceQuery: identity.sourceQuery,
        intent,
        prompt,
        context: extra,
        targetId,
        currentHtml,
        language: this.appLanguageFn(),
      });
      const priorMessages = this.continueSessions.get(sessionKey) ?? [];
      // 新会话：system+user 都是新增；续接会话：system 已在历史里，只新增 user
      const newTurns: CoreMessage[] =
        priorMessages.length > 0
          ? [{ role: "user", content: built.user }]
          : [
              { role: "system", content: built.system },
              { role: "user", content: built.user },
            ];
      const messages: CoreMessage[] = [...priorMessages, ...newTurns];

      const raw = await this.generator.continueContent({ intent, messages }, signal);
      const fragment = compileFragment(raw);
      this.continueSessions.commit(sessionKey, newTurns, raw);
      return { fragment };
    } finally {
      this.continueInFlight.delete(sessionKey);
    }
  }

  install(draftId: string): GenAppSummary {
    return this.repository.install(draftId, this.nowFn());
  }

  list(): GenAppSummary[] {
    // 顺带清理过期草稿
    this.repository.discardExpiredDrafts(this.nowFn());
    return this.repository.listInstalled();
  }

  launch(appId: string): GenAppLaunchBundle {
    return this.repository.loadAndTouch(appId, this.nowFn());
  }

  remove(appId: string): void {
    this.repository.remove(appId);
  }
}
