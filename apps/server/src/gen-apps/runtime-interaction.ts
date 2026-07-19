import {
  GEN_APP_LIMITS,
  type GenAppInteractRequest,
  type GenAppPatchBatch,
} from "@openos/shared";
import type { CoreMessage } from "../llm-core/index.js";
import { genAppError } from "./domain.js";
import type { GenAppLanguage } from "./gen-app-settings.js";
import {
  compileReplacementMarkup,
  extractMarkupElement,
  replaceMarkupElement,
  resolveMarkupInteraction,
  type ResolvedMarkupInteraction,
} from "./markup-artifact.js";
import type {
  GenAppGenerator,
  GenAppIdentity,
  WebSearchProvider,
} from "./ports.js";
import {
  buildRuntimePatchPrompt,
  buildRuntimePatchRepairPrompt,
} from "./prompt-policy.js";
import { parseRuntimePatchProposal } from "./runtime-patch.js";
import {
  RuntimeSessionStore,
  type RuntimeSessionSnapshot,
} from "./runtime-session-store.js";
import {
  renderSearchLanding,
  renderWebSearchResults,
  resolveWebSearchRequest,
} from "./web-search.js";

type InteractionContext = {
  session: RuntimeSessionSnapshot;
  resolved: ResolvedMarkupInteraction;
  declaredAction: string;
  currentTargetHtml: string;
};

type CoordinatorDeps = {
  generator: GenAppGenerator;
  sessions: RuntimeSessionStore;
  language: () => GenAppLanguage;
  webSearch?: WebSearchProvider;
};

/**
 * V2 交互协调器把「事件 id → 可信单目标 patch」隐藏在一个接口后面。
 * GenAppsService 只负责用例级身份、频控和并发，模型协议细节不会泄漏到服务层。
 */
export class RuntimeInteractionCoordinator {
  constructor(private readonly deps: CoordinatorDeps) {}

  async execute(
    input: {
      identity: GenAppIdentity;
      request: GenAppInteractRequest;
    },
    externalSignal: AbortSignal,
  ): Promise<GenAppPatchBatch> {
    const context = this.resolveContext(input.identity.id, input.request);
    if (context.declaredAction === "web.search") {
      return this.executeWebSearch(input.identity.id, input.request, context, externalSignal);
    }
    const prompt = buildRuntimePatchPrompt({
      appName: input.identity.name,
      appDescription: input.identity.description,
      sourceQuery: input.identity.sourceQuery,
      baseRevision: input.request.baseRevision,
      event: {
        type: input.request.event.type,
        targetId: input.request.event.targetId,
        action: context.declaredAction,
        value: input.request.event.value,
        checked: input.request.event.checked,
      },
      declaredAction: context.declaredAction,
      actionElementHtml: context.resolved.actionElementHtml,
      patchTargetId: context.resolved.patchTargetId,
      patchTargetHtml: context.currentTargetHtml,
      dataHref: context.resolved.dataHref,
      dataPrompt: context.resolved.dataPrompt,
      language: this.deps.language(),
    });
    const newTurns: CoreMessage[] =
      context.session.messages.length > 0
        ? [{ role: "user", content: prompt.user }]
        : [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ];
    const timeout = AbortSignal.timeout(GEN_APP_LIMITS.continueTimeoutMs);
    const signal = AbortSignal.any
      ? AbortSignal.any([externalSignal, timeout])
      : timeout;

    let generated: {
      raw: string;
      nextMarkup: string;
      normalizedReplacement: string;
    };
    try {
      generated = await this.generateReplacement({
        messages: [...context.session.messages, ...newTurns],
        baseRevision: input.request.baseRevision,
        targetId: context.resolved.patchTargetId,
        sessionMarkup: context.session.markup,
        signal,
      });
    } catch (error) {
      if (timeout.aborted) {
        throw genAppError("generation_timeout", "Runtime patch generation timed out.", 504, true);
      }
      throw error;
    }
    return this.compileAndCommit({
      appId: input.identity.id,
      request: input.request,
      targetId: context.resolved.patchTargetId,
      nextMarkup: generated.nextMarkup,
      normalizedReplacement: generated.normalizedReplacement,
      turns: [...newTurns, { role: "assistant", content: generated.raw }],
    });
  }

  private resolveContext(
    appId: string,
    request: GenAppInteractRequest,
  ): InteractionContext {
    const session = this.deps.sessions.read(request.runtimeSessionId, appId);
    if (!session) {
      throw genAppError(
        "invalid_transition",
        "Runtime session expired or does not belong to this app.",
        409,
        true,
      );
    }
    if (session.revision !== request.baseRevision) {
      throw genAppError(
        "invalid_transition",
        `Revision conflict: expected ${session.revision}, received ${request.baseRevision}.`,
        409,
        true,
        { currentRevision: session.revision },
      );
    }
    const resolved = resolveMarkupInteraction(session.markup, request.event.targetId);
    if (!resolved) {
      throw genAppError(
        "validation_failed",
        `Interactive element ${request.event.targetId} was not found.`,
        400,
      );
    }
    const declaredAction = resolved.action ?? "ai.patch";
    const isRemoteAction =
      declaredAction === "ai.generate" ||
      declaredAction === "ai.patch" ||
      declaredAction === "web.search";
    if (!isRemoteAction && session.interactionMode !== "improv") {
      throw genAppError(
        "validation_failed",
        "This action is handled locally by the trusted runtime.",
        400,
      );
    }
    let currentTargetHtml = resolved.patchTargetHtml;
    if (request.event.currentHtml) {
      try {
        currentTargetHtml = compileReplacementMarkup(
          request.event.currentHtml,
          resolved.patchTargetId,
        );
      } catch {
        // iframe 快照只作经编译的上下文；非法快照不影响权威会话状态。
      }
    }
    return { session, resolved, declaredAction, currentTargetHtml };
  }

  private async executeWebSearch(
    appId: string,
    request: GenAppInteractRequest,
    context: InteractionContext,
    signal: AbortSignal,
  ): Promise<GenAppPatchBatch> {
    const searchRequest = resolveWebSearchRequest(request.event.value);
    let replacement: string;
    if (searchRequest.kind === "landing") {
      replacement = renderSearchLanding(
        context.resolved.patchTargetId,
        searchRequest.engineName,
      );
    } else {
      if (!this.deps.webSearch) {
        throw genAppError("web_search_failed", "Web search provider is unavailable.", 503, true);
      }
      const response = await this.deps.webSearch.search(searchRequest.query, signal);
      replacement = renderWebSearchResults(context.resolved.patchTargetId, response);
    }
    const normalizedReplacement = compileReplacementMarkup(
      replacement,
      context.resolved.patchTargetId,
    );
    const nextMarkup = replaceMarkupElement(
      context.session.markup,
      context.resolved.patchTargetId,
      normalizedReplacement,
    );
    return this.compileAndCommit({
      appId,
      request,
      targetId: context.resolved.patchTargetId,
      nextMarkup,
      normalizedReplacement,
      turns: [],
    });
  }

  private async generateReplacement(input: {
    messages: CoreMessage[];
    baseRevision: number;
    targetId: string;
    sessionMarkup: string;
    signal: AbortSignal;
  }): Promise<{
    raw: string;
    nextMarkup: string;
    normalizedReplacement: string;
  }> {
    let raw = await this.deps.generator.continueContent(
      { intent: "update", messages: input.messages },
      input.signal,
    );
    try {
      return { raw, ...this.compileProposal(raw, input) };
    } catch (firstError) {
      const repair = buildRuntimePatchRepairPrompt({
        baseRevision: input.baseRevision,
        targetId: input.targetId,
        reason: firstError instanceof Error ? firstError.message : String(firstError),
      });
      raw = await this.deps.generator.continueContent(
        {
          intent: "update",
          messages: [
            ...input.messages,
            { role: "assistant", content: raw.slice(0, 4_000) },
            { role: "user", content: repair },
          ],
        },
        input.signal,
      );
      try {
        return { raw, ...this.compileProposal(raw, input) };
      } catch (secondError) {
        throw genAppError(
          "invalid_model_output",
          secondError instanceof Error ? secondError.message : String(secondError),
          422,
          true,
        );
      }
    }
  }

  private compileProposal(
    raw: string,
    input: { baseRevision: number; targetId: string; sessionMarkup: string },
  ): { nextMarkup: string; normalizedReplacement: string } {
    const proposal = parseRuntimePatchProposal(raw, {
      baseRevision: input.baseRevision,
      targetId: input.targetId,
    });
    const replacement = compileReplacementMarkup(proposal.html, input.targetId);
    const nextMarkup = replaceMarkupElement(
      input.sessionMarkup,
      input.targetId,
      replacement,
    );
    const normalizedReplacement = extractMarkupElement(nextMarkup, input.targetId);
    if (!normalizedReplacement) {
      throw genAppError(
        "artifact_rejected",
        "Compiled patch target disappeared.",
        422,
        true,
      );
    }
    return { nextMarkup, normalizedReplacement };
  }

  private compileAndCommit(input: {
    appId: string;
    request: GenAppInteractRequest;
    targetId: string;
    nextMarkup: string;
    normalizedReplacement: string;
    turns: CoreMessage[];
  }): GenAppPatchBatch {
    const committed = this.deps.sessions.commit({
      sessionId: input.request.runtimeSessionId,
      appId: input.appId,
      baseRevision: input.request.baseRevision,
      markup: input.nextMarkup,
      turns: input.turns,
    });
    if (!committed.ok) {
      throw genAppError(
        "invalid_transition",
        "Runtime revision changed while the patch was being generated.",
        409,
        true,
        { currentRevision: committed.currentRevision },
      );
    }
    return {
      baseRevision: input.request.baseRevision,
      revision: committed.session.revision,
      ops: [
        {
          op: "replace",
          targetId: input.targetId,
          html: input.normalizedReplacement,
        },
      ],
    };
  }
}
