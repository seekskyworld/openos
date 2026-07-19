import type {
  GenAppArtifact,
  GenAppArtifactFormat,
  GenAppDeclaredAction,
  GenAppDraft,
  GenAppIconTheme,
  GenAppInteractionMode,
  GenAppLaunchBundle,
  GenAppSuggestion,
  GenAppSummary,
} from "@openos/shared";

/**
 * Gen Apps 领域类型（服务端内部）。
 * UntrustedX：模型输出，未经校验前不得入库。
 * ValidatedX：ArtifactCompiler 输出的 branded 类型，Repository 只接受它。
 */

export type GenAppErrorShape = Error & {
  code: string;
  retryable: boolean;
  status: number;
  details?: Record<string, unknown>;
};

export function genAppError(
  code: string,
  message: string,
  status: number,
  retryable = false,
  details?: Record<string, unknown>,
): GenAppErrorShape {
  const err = new Error(message) as GenAppErrorShape;
  err.code = code;
  err.retryable = retryable;
  err.status = status;
  err.details = details;
  return err;
}

/** 模型返回的候选（未信任） */
export type UntrustedSuggestion = {
  name?: unknown;
  description?: unknown;
  iconEmoji?: unknown;
  iconTheme?: unknown;
  intentKey?: unknown;
  variationSeed?: unknown;
  routeHint?: unknown;
};

/** 模型返回的制品（未信任） */
export type UntrustedArtifact = {
  html: string;
  provider: string;
  model: string;
  /** V2 交互策略由可信设置映射，不从模型文本读取。 */
  interactionMode?: GenAppInteractionMode;
};

declare const validatedBrand: unique symbol;

/** 编译器输出：带 brand 的已验证制品，Repository 唯一入口 */
export type ValidatedArtifact = {
  readonly [validatedBrand]: true;
  format: GenAppArtifactFormat;
  html: string;
  markup?: string;
  actions?: GenAppDeclaredAction[];
  kitVersion?: number;
  interactionMode?: GenAppInteractionMode;
  contentSha256: string;
  sizeBytes: number;
  formatVersion: number;
  runtimeVersion: number;
  policyVersion: number;
};

export function brandValidated(
  input: Omit<ValidatedArtifact, typeof validatedBrand>,
): ValidatedArtifact {
  return input as ValidatedArtifact;
}

export type ValidatedDraftInput = {
  id: string;
  name: string;
  description: string;
  iconEmoji: string;
  iconTheme: GenAppIconTheme;
  category: string;
  sourceQuery: string;
  generatorProvider: string;
  generatorModel: string;
  promptVersion: number;
  artifact: ValidatedArtifact;
  now: number;
  draftTtlMs: number;
};

export type {
  GenAppArtifact,
  GenAppDraft,
  GenAppLaunchBundle,
  GenAppSuggestion,
  GenAppSummary,
};
