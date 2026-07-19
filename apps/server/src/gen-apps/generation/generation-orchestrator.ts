import { randomUUID } from "node:crypto";
import {
  clampSuggestionCount,
  GEN_APP_LIMITS,
  GEN_APP_PROMPT_VERSION,
  isGenAppIconTheme,
  type GenAppIconTheme,
  type GenAppSuggestion,
} from "@openos/shared";
import { compileArtifact } from "../artifact-compiler.js";
import {
  genAppError,
  type UntrustedArtifact,
  type UntrustedSuggestion,
  type ValidatedArtifact,
} from "../domain.js";
import type {
  ArtifactGenerator,
  CachedGeneration,
  GenerationCache,
  GenAppRepository,
  SuggestionProvider,
  GeneratePortInput,
} from "../ports.js";
import {
  createGenerationFingerprint,
  createRecipeFingerprint,
} from "./fingerprint.js";
import { InFlightGenerationRegistry } from "./in-flight-generation.js";
import { createFallbackBlueprint, resolveBlueprint } from "./blueprint-registry.js";
import { resolveAppRecipe } from "./app-recipe.js";

type GenerationProfile = "instant" | "agentic";

type GenerationSettings = {
  language: "auto" | "zh" | "en";
  creativity: number;
  profile: GenerationProfile;
  generatorKey?: string;
  suggestionCount: number;
  timeoutMs: number;
};

type GenerationHooks = {
  onDelta?: (text: string) => void;
  onPhase?: (phase: { phase: string; round?: number }) => void;
};

type GeneratedResult = {
  artifact: ValidatedArtifact;
  provider: string;
  model: string;
  intentKey: string | null;
};

type GenerationInput = {
  suggestion: GenAppSuggestion;
  query: string;
  idempotencyKey: string;
  bypassCache?: boolean;
};

const FALLBACK_THEMES: GenAppIconTheme[] = ["blue", "purple", "pink", "orange", "green", "teal"];

function normalizeQuery(value: unknown): string {
  const query = String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  if (query.length < GEN_APP_LIMITS.queryMinLength || query.length > GEN_APP_LIMITS.queryMaxLength) {
    throw genAppError(
      "validation_failed",
      `query must be ${GEN_APP_LIMITS.queryMinLength}-${GEN_APP_LIMITS.queryMaxLength} chars.`,
      400,
    );
  }
  return query;
}

function sanitizeSuggestion(raw: UntrustedSuggestion, index: number): GenAppSuggestion | null {
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 60) : "";
  if (!name) return null;
  const description = typeof raw.description === "string" ? raw.description.slice(0, 300) : "";
  const iconEmoji = typeof raw.iconEmoji === "string" && raw.iconEmoji.trim()
    ? raw.iconEmoji.trim().slice(0, 8)
    : "✨";
  return {
    id: `gs-${randomUUID()}`,
    name,
    description,
    iconEmoji,
    iconTheme: isGenAppIconTheme(raw.iconTheme)
      ? raw.iconTheme
      : FALLBACK_THEMES[index % FALLBACK_THEMES.length],
  };
}

function cachedArtifact(cached: CachedGeneration): GeneratedResult {
  return {
    artifact: compileArtifact({
      html: cached.markup,
      provider: cached.provider,
      model: cached.model,
      interactionMode: cached.interactionMode,
    }),
    provider: cached.provider,
    model: cached.model,
    intentKey: cached.intentKey,
  };
}

export type GenerationOrchestratorDeps = {
  suggestionProvider: SuggestionProvider;
  instantGenerator: ArtifactGenerator;
  agenticGenerator: ArtifactGenerator;
  repository: GenAppRepository;
  cache: GenerationCache;
  settings: () => GenerationSettings;
  now?: () => number;
  maxConcurrent?: number;
};

/**
 * 首次生成的唯一编排接缝：缓存、蓝图、并发合并和模型 profile 都在此收敛。
 * Catalog/Runtime 不应知道生成器、cache key 或模型重试细节。
 */
export class GenerationOrchestrator {
  private readonly nowFn: () => number;
  private readonly maxConcurrent: number;
  private activeGenerations = 0;
  private readonly inFlight = new InFlightGenerationRegistry<GeneratedResult>();

  constructor(private readonly deps: GenerationOrchestratorDeps) {
    this.nowFn = deps.now ?? (() => Date.now());
    this.maxConcurrent = deps.maxConcurrent ?? GEN_APP_LIMITS.maxConcurrentGenerations;
  }

  async suggest(input: { query: string; count?: number }, signal: AbortSignal): Promise<GenAppSuggestion[]> {
    const query = normalizeQuery(input.query);
    const count = clampSuggestionCount(input.count ?? this.deps.settings().suggestionCount);
    const raw = await this.deps.suggestionProvider.suggest({ query, count }, signal);
    const seen = new Set<string>();
    const output: GenAppSuggestion[] = [];
    for (let index = 0; index < raw.length && output.length < count; index += 1) {
      const suggestion = sanitizeSuggestion(raw[index], index);
      if (!suggestion || seen.has(suggestion.name.toLocaleLowerCase())) continue;
      seen.add(suggestion.name.toLocaleLowerCase());
      output.push(suggestion);
    }
    if (output.length === 0) {
      throw genAppError("invalid_model_output", "Generator returned no valid suggestions.", 422, true);
    }
    return output;
  }

  async generateDraft(
    input: GenerationInput,
    context: { signal: AbortSignal },
    hooks: GenerationHooks = {},
  ) {
    const query = normalizeQuery(input.query);
    const key = input.idempotencyKey.trim();
    if (!key) throw genAppError("validation_failed", "idempotencyKey is required.", 400);
    const existing = this.deps.repository.findByIdempotencyKey(key);
    if (existing) return existing;
    if (this.deps.repository.countInstalled() >= GEN_APP_LIMITS.maxInstalledApps) {
      throw genAppError("storage_quota_exceeded", `Installed app limit (${GEN_APP_LIMITS.maxInstalledApps}) reached.`, 429);
    }

    const settings = this.deps.settings();
    const recipe = resolveAppRecipe({
      query,
      name: input.suggestion.name,
      description: input.suggestion.description,
      language: settings.language,
      creativity: settings.creativity,
    });
    const fingerprint = recipe
      ? createRecipeFingerprint(recipe.cacheKey)
      : createGenerationFingerprint({
          query,
          suggestion: input.suggestion,
          language: settings.language,
          creativity: settings.creativity,
          profile: settings.profile,
          generatorKey: settings.generatorKey,
        });
    const now = this.nowFn();
    const startedAt = performance.now();

    if (!input.bypassCache) {
      const cached = this.deps.cache.get(fingerprint, now);
      if (cached) {
        try {
          hooks.onPhase?.({ phase: "cache-hit" });
          this.logMetric("artifact_hit", fingerprint, performance.now() - startedAt);
          return this.createDraft(key, query, input.suggestion, cachedArtifact(cached));
        } catch {
          this.deps.cache.delete(fingerprint);
        }
      }
    }

    if (recipe) {
      hooks.onPhase?.({ phase: "recipe-hit" });
      const result = this.compileAndCache(
        fingerprint,
        recipe.artifact,
        recipe.engine,
        now,
      );
      this.logMetric("recipe_hit", fingerprint, performance.now() - startedAt);
      return this.createDraft(key, query, input.suggestion, result);
    }

    if (settings.profile === "instant" && !input.bypassCache) {
      const blueprint = resolveBlueprint({
        query,
        name: input.suggestion.name,
        description: input.suggestion.description,
        language: settings.language,
        creativity: settings.creativity,
      });
      if (blueprint) {
        try {
          hooks.onPhase?.({ phase: "blueprint-hit" });
          const result = this.compileAndCache(
            fingerprint,
            blueprint.artifact,
            blueprint.intentKey,
            now,
          );
          this.logMetric("blueprint_hit", fingerprint, performance.now() - startedAt);
          return this.createDraft(key, query, input.suggestion, result);
        } catch {
          hooks.onPhase?.({ phase: "blueprint-fallback" });
        }
      }
    }

    const inFlightKey = input.bypassCache ? `${fingerprint}:${key}` : fingerprint;
    const result = await this.inFlight.run(
      inFlightKey,
      context.signal,
      hooks,
      (signal, streamHooks) => this.generateOnce(
        settings,
        fingerprint,
        query,
        input.suggestion,
        signal,
        streamHooks,
      ),
    );
    if (result.joined) hooks.onPhase?.({ phase: "inflight-join" });
    this.logMetric(result.joined ? "inflight_join" : "miss", fingerprint, performance.now() - startedAt);
    return this.createDraft(key, query, input.suggestion, result.value);
  }

  private async generateOnce(
    settings: GenerationSettings,
    fingerprint: string,
    query: string,
    suggestion: GenAppSuggestion,
    signal: AbortSignal,
    hooks: Required<GenerationHooks>,
  ): Promise<GeneratedResult> {
    if (this.activeGenerations >= this.maxConcurrent) {
      throw genAppError("validation_failed", "Another generation is in progress.", 429, true);
    }
    this.activeGenerations += 1;
    try {
      hooks.onPhase({ phase: settings.profile === "agentic" ? "generating" : "instant" });
      const generator = settings.profile === "agentic"
        ? this.deps.agenticGenerator
        : this.deps.instantGenerator;
      const input: GeneratePortInput = {
        query,
        name: suggestion.name,
        description: suggestion.description,
        onDelta: hooks.onDelta,
        onPhase: hooks.onPhase,
      };
      const timeout = AbortSignal.timeout(settings.timeoutMs);
      const generationSignal = AbortSignal.any
        ? AbortSignal.any([signal, timeout])
        : timeout;
      try {
        const untrusted = await generator.generate(input, generationSignal);
        return this.compileAndCache(fingerprint, untrusted, null, this.nowFn());
      } catch (error) {
        if (timeout.aborted && !signal.aborted) {
          throw genAppError("generation_timeout", "Generation timed out.", 504, true);
        }
        if (settings.profile === "agentic" || generationSignal.aborted) throw error;
        hooks.onPhase({ phase: "fallback" });
        const fallback = createFallbackBlueprint({
          query,
          name: suggestion.name,
          description: suggestion.description,
          language: settings.language,
          creativity: settings.creativity,
        });
        return this.compileAndCache(
          fingerprint,
          fallback.artifact,
          fallback.intentKey,
          this.nowFn(),
        );
      }
    } finally {
      this.activeGenerations -= 1;
    }
  }

  private compileAndCache(
    fingerprint: string,
    untrusted: UntrustedArtifact,
    intentKey: string | null,
    now: number,
  ): GeneratedResult {
    const artifact = compileArtifact(untrusted);
    this.deps.cache.put({
      fingerprint,
      intentKey,
      markup: artifact.markup ?? "",
      interactionMode: artifact.interactionMode === "improv" ? "improv" : "hybrid",
      provider: untrusted.provider,
      model: untrusted.model,
      createdAt: now,
      expiresAt: now + 14 * 24 * 60 * 60 * 1_000,
    });
    this.deps.cache.prune(now, 500, 50 * 1024 * 1024);
    return { artifact, provider: untrusted.provider, model: untrusted.model, intentKey };
  }

  private createDraft(
    idempotencyKey: string,
    query: string,
    suggestion: GenAppSuggestion,
    result: GeneratedResult,
  ) {
    const now = this.nowFn();
    const draft = this.deps.repository.createDraft({
      id: `ga-${randomUUID()}`,
      name: suggestion.name,
      description: suggestion.description,
      iconEmoji: suggestion.iconEmoji,
      iconTheme: suggestion.iconTheme,
      category: "AI",
      sourceQuery: query,
      generatorProvider: result.provider,
      generatorModel: result.model,
      promptVersion: GEN_APP_PROMPT_VERSION,
      artifact: result.artifact,
      now,
      draftTtlMs: GEN_APP_LIMITS.draftTtlMs,
    });
    this.deps.repository.rememberIdempotencyKey(idempotencyKey, draft.summary.id);
    return draft;
  }

  private logMetric(
    outcome: "artifact_hit" | "recipe_hit" | "blueprint_hit" | "inflight_join" | "miss",
    fingerprint: string,
    durationMs: number,
  ): void {
    console.info(JSON.stringify({
      scope: "gen-app-generation",
      outcome,
      fingerprint: fingerprint.slice(0, 12),
      durationMs: Math.round(durationMs * 100) / 100,
    }));
  }
}
