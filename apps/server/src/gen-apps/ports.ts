import type {
  GenAppContinueIntent,
  GenAppDraft,
  GenAppLaunchBundle,
  GenAppSummary,
} from "@openos/shared";
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
};

/** 运行时续生成（应用内 OpenOS.generate 触发） */
export type ContinuePortInput = {
  appName: string;
  appDescription: string;
  sourceQuery: string;
  intent: GenAppContinueIntent;
  prompt: string;
  context?: string;
};

export interface GenAppGenerator {
  suggest(
    input: SuggestPortInput,
    signal: AbortSignal,
  ): Promise<UntrustedSuggestion[]>;
  generate(
    input: GeneratePortInput,
    signal: AbortSignal,
  ): Promise<UntrustedArtifact>;
  /** 单轮快速续生成，返回未清洗的 fragment 文本 */
  continueContent(
    input: ContinuePortInput,
    signal: AbortSignal,
  ): Promise<string>;
}

/** 应用身份（续生成上下文用，不 touch openedAt） */
export type GenAppIdentity = {
  id: string;
  name: string;
  description: string;
  sourceQuery: string;
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
