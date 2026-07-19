import type {
  GenAppArtifactFormat,
  GenAppContinueIntent,
  GenAppDraft,
  GenAppLaunchBundle,
  GenAppSummary,
} from "@openos/shared";
import type { CoreMessage } from "../llm-core/index.js";
import type {
  UntrustedArtifact,
  UntrustedSuggestion,
  ValidatedDraftInput,
} from "./domain.js";

/** 生成器端口：LLM adapter 与 deterministic fake 都实现它 */
export type SuggestPortInput = {
  query: string;
  count: number;
};

export type GeneratePortInput = {
  query: string;
  name: string;
  description: string;
  /** 流式渲染：模型增量文本回调（agentic 修复轮会重新从头流出） */
  onDelta?: (text: string) => void;
  /** 流式渲染：阶段变化回调（generating/checking/fixing/done） */
  onPhase?: (phase: { phase: string; round?: number }) => void;
};

/**
 * 运行时续生成（应用内 OpenOS.generate 触发）。
 * 提示词组装 + 会话历史组装归 GenAppsService（唯一知道 session 状态的层）；
 * 本端口只做「给一段 messages，换一段回复文本」——不关心是否有历史、
 * 上一轮说了什么。intent 仅用于按场景挑温度/输出长度。
 */
export type ContinuePortInput = {
  intent: GenAppContinueIntent;
  messages: CoreMessage[];
};

export interface SuggestionProvider {
  suggest(
    input: SuggestPortInput,
    signal: AbortSignal,
  ): Promise<UntrustedSuggestion[]>;
}

export interface ArtifactGenerator {
  generate(
    input: GeneratePortInput,
    signal: AbortSignal,
  ): Promise<UntrustedArtifact>;
}

export interface FragmentGenerator {
  /** 单轮快速续生成，返回未清洗的 fragment 文本 */
  continueContent(
    input: ContinuePortInput,
    signal: AbortSignal,
  ): Promise<string>;
}

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchResponse = {
  query: string;
  provider: string;
  results: WebSearchResult[];
};

/** 固定出口的宿主网络搜索端口；生成 iframe 本身始终保持无网络权限。 */
export interface WebSearchProvider {
  search(query: string, signal: AbortSignal): Promise<WebSearchResponse>;
}

/** 兼容组合适配器；新编排代码依赖上面的最小能力端口。 */
export interface GenAppGenerator
  extends SuggestionProvider,
    ArtifactGenerator,
    FragmentGenerator {}

export type CachedGeneration = {
  fingerprint: string;
  intentKey: string | null;
  markup: string;
  interactionMode: "hybrid" | "improv";
  provider: string;
  model: string;
  createdAt: number;
  expiresAt: number;
};

export interface GenerationCache {
  get(fingerprint: string, now: number): CachedGeneration | null;
  put(value: CachedGeneration): void;
  delete(fingerprint: string): void;
  prune(now: number, maxEntries: number, maxBytes: number): number;
}

/** 应用身份（续生成上下文用，不 touch openedAt） */
export type GenAppIdentity = {
  id: string;
  name: string;
  description: string;
  sourceQuery: string;
  format: GenAppArtifactFormat;
};

/** 仓储端口：只接收已校验领域对象 */
export interface GenAppRepository {
  createDraft(input: ValidatedDraftInput): GenAppDraft;
  install(draftId: string, now: number): GenAppSummary;
  listInstalled(): GenAppSummary[];
  loadAndTouch(appId: string, now: number): GenAppLaunchBundle;
  remove(appId: string): void;
  discardExpiredDrafts(now: number): number;
  countInstalled(): number;
  findByIdempotencyKey(key: string): GenAppDraft | null;
  rememberIdempotencyKey(key: string, draftId: string): void;
  /** 按 id 取应用身份（draft 与 installed 均可；续生成上下文用） */
  findIdentity(appId: string): GenAppIdentity | null;
}
