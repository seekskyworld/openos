import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GenAppArtifactFormat,
  GenAppDraft,
  GenAppInteractRequest,
  GenAppInteractResponse,
  GenAppInteractionMode,
  GenAppPatchBatch,
  GenAppSuggestion,
  GenAppSummary,
} from "@openos/shared";
import {
  GEN_APP_FORMAT,
  GEN_APP_LEGACY_FORMAT,
  GEN_APP_LIMITS,
} from "@openos/shared";
import {
  GenAppClientError,
  HttpGenAppsClient,
  type GenAppsClient,
} from "./client.js";
import { debounceWithThrottle } from "../utils/rate-control.js";

/**
 * GenAppWorkspace：前端主接缝模块。
 * 隐藏：搜索防抖 / AbortController / 请求序号防旧覆盖新 /
 * 生成、草稿运行、关闭安装状态机 / 删除同步。
 * Launcher 与 App.tsx 只消费 view + 动作方法，不直接调 CRUD。
 */

const SUGGEST_DEBOUNCE_MS = 500;
/** 节流保底：持续输入超过该间隔仍强制请求一次 */
const SUGGEST_MAX_WAIT_MS = 2000;

const LOCAL_APP_CATALOG: Array<{
  name: string;
  description: string;
  iconEmoji: string;
  iconTheme: GenAppSummary["iconTheme"];
  keywords: string;
}> = [
  { name: "计算器", description: "快速计算与换算", iconEmoji: "🧮", iconTheme: "orange", keywords: "计算 数学 calculator" },
  { name: "备忘录", description: "记录想法与清单", iconEmoji: "📝", iconTheme: "orange", keywords: "笔记 记录 备忘 note todo 清单" },
  { name: "专注计时", description: "番茄钟与倒计时", iconEmoji: "⏱️", iconTheme: "red", keywords: "时间 时钟 计时 番茄 timer focus" },
  { name: "单位换算", description: "长度重量温度换算", iconEmoji: "🔁", iconTheme: "purple", keywords: "换算 单位 convert conversion" },
  { name: "天气", description: "城市天气与预报", iconEmoji: "🌤️", iconTheme: "blue", keywords: "天气 weather 气温 预报" },
  { name: "词典", description: "查词、释义与例句", iconEmoji: "📖", iconTheme: "graphite", keywords: "词典 翻译 单词 dictionary translate" },
  { name: "色板", description: "配色与颜色代码", iconEmoji: "🎨", iconTheme: "pink", keywords: "颜色 色板 取色 color palette" },
  { name: "汇率", description: "常用货币快速换算", iconEmoji: "💱", iconTheme: "green", keywords: "汇率 货币 外汇 currency money" },
];

function localSuggestions(query: string): GenAppSuggestion[] {
  const normalized = query.trim().toLocaleLowerCase();
  const matches = LOCAL_APP_CATALOG.filter((item) =>
    `${item.name} ${item.description} ${item.keywords}`.toLocaleLowerCase().includes(normalized),
  ).slice(0, 3);
  if (matches.length === 0) {
    let hash = 0;
    for (const char of normalized) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
    return [{
      id: `local-exact-${(hash >>> 0).toString(36)}`,
      name: query.trim().slice(0, 60),
      description: "按当前需求生成应用",
      iconEmoji: "✨",
      iconTheme: "blue",
    }];
  }
  return matches.map((item) => ({
    id: `local-${item.name}`,
    name: item.name,
    description: item.description,
    iconEmoji: item.iconEmoji,
    iconTheme: item.iconTheme,
  }));
}

function mergeSuggestions(
  immediate: GenAppSuggestion[],
  remote: GenAppSuggestion[],
): GenAppSuggestion[] {
  const names = new Set<string>();
  return [...immediate, ...remote].filter((item) => {
    const key = item.name.trim().toLocaleLowerCase();
    if (!key || names.has(key)) return false;
    names.add(key);
    return true;
  }).slice(0, GEN_APP_LIMITS.suggestionCountMax);
}

function applyMarkupPatch(markup: string, patch: GenAppPatchBatch): string {
  const container = document.createElement("template");
  container.innerHTML = markup;
  const operation = patch.ops[0];
  const current = Array.from(container.content.querySelectorAll<HTMLElement>("[id]"))
    .find((node) => node.id === operation.targetId);
  if (!current) return markup;
  const replacementTemplate = document.createElement("template");
  replacementTemplate.innerHTML = operation.html.trim();
  const replacement = replacementTemplate.content.firstElementChild;
  if (!(replacement instanceof HTMLElement) || replacement.id !== operation.targetId) {
    return markup;
  }
  current.replaceWith(replacement);
  return container.innerHTML;
}

export type GenAppPatchDelivery =
  | {
      kind: "patch";
      patch: GenAppPatchBatch;
      /** Authoritative post-patch markup, used only if the iframe asks to resynchronize. */
      markup: string;
    }
  | {
      /** Server was ahead after a lost response; apply its authoritative snapshot. */
      kind: "render";
      revision: number;
      markup: string;
      error: string;
    };

export type RunningGenApp = {
  /** 窗口 id：genapp-<appId>（流式期为 genapp-<幂等键>） */
  windowId: string;
  /** 流式生成期为空串，done 后回填 */
  appId: string;
  name: string;
  iconEmoji: string;
  iconTheme: GenAppSummary["iconTheme"];
  html: string;
  format: GenAppArtifactFormat;
  /** V2 声明式内容；流式期随 delta 更新。 */
  markup: string;
  runtimeSessionId: string;
  revision: number;
  interactionMode: GenAppInteractionMode;
  /** 仅全量 render/流式快照递增；局部 patch 不递增，避免覆盖 iframe 本地状态。 */
  renderSequence: number;
  /** draft = 关闭时需安装；installed = 直接关闭 */
  mode: "draft" | "installed";
  /** streaming = 生成中渐进预览（脚本禁用）；ready = 编译制品可交互 */
  status?: "streaming" | "ready";
  /** 流式期的阶段文案（修复中 r2 等） */
  streamPhase?: string;
};

export type GenAppWorkspaceView = {
  installed: GenAppSummary[];
  suggestions: GenAppSuggestion[];
  pendingSuggestionId: string | null;
  phase: "idle" | "suggesting" | "generating" | "installing" | "error";
  /** agentic 进度 phase（generating/checking/fixing/done/unknown） */
  agentPhase: string | null;
  error: GenAppClientError | null;
  running: RunningGenApp[];
};

type HostHooks = {
  /** 打开动态窗口 */
  openWindow: (app: RunningGenApp) => void;
  /** 真正关闭窗口（安装完成或直接关闭后调用） */
  closeWindow: (windowId: string) => void;
};

export function useGenAppWorkspace(host: HostHooks, client?: GenAppsClient) {
  const clientRef = useRef<GenAppsClient>(client ?? new HttpGenAppsClient());
  const [installed, setInstalled] = useState<GenAppSummary[]>([]);
  const [suggestions, setSuggestions] = useState<GenAppSuggestion[]>([]);
  const [pendingSuggestionId, setPendingSuggestionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<GenAppWorkspaceView["phase"]>("idle");
  const [agentPhase, setAgentPhase] = useState<string | null>(null);
  const [error, setError] = useState<GenAppClientError | null>(null);
  const [running, setRunning] = useState<RunningGenApp[]>([]);

  const queryRef = useRef("");
  const localSuggestionsRef = useRef<GenAppSuggestion[]>([]);
  const runningRef = useRef<RunningGenApp[]>([]);
  const suggestAbort = useRef<AbortController | null>(null);
  /** 单调请求序号：旧响应不得覆盖新响应 */
  const suggestSeq = useRef(0);
  const progressTimer = useRef<number | null>(null);

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  const stopProgressPoll = useCallback(() => {
    if (progressTimer.current != null) {
      window.clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }, []);

  const startProgressPoll = useCallback(
    (key: string) => {
      stopProgressPoll();
      setAgentPhase("generating");
      const poll = () => {
        const progressFn = clientRef.current.progress;
        if (!progressFn) return;
        void progressFn(key)
          .then((p) => {
            if (p.phase && p.phase !== "unknown") {
              const label =
                p.round != null ? `${p.phase}:${p.round}` : p.phase;
              setAgentPhase(label);
            }
          })
          .catch(() => {
            /* 轮询失败静默 */
          });
      };
      poll();
      progressTimer.current = window.setInterval(poll, 2000);
    },
    [stopProgressPoll],
  );

  const refreshInstalled = useCallback(async () => {
    try {
      const apps = await clientRef.current.list();
      setInstalled(apps);
    } catch {
      // bridge 未起时静默
    }
  }, []);

  /** 实际发起 suggest 请求（由防抖/节流包装触发） */
  const fireSuggest = useCallback((trimmed: string) => {
    suggestAbort.current?.abort();
    const seq = ++suggestSeq.current;
    const abort = new AbortController();
    suggestAbort.current = abort;
    setPhase("suggesting");
    setError(null);
    clientRef.current
      .suggest(trimmed, undefined, abort.signal)
      .then((result) => {
        if (seq !== suggestSeq.current) return; // 旧响应丢弃
        setSuggestions(mergeSuggestions(localSuggestionsRef.current, result));
        setPhase("idle");
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted || seq !== suggestSeq.current) return;
        if (localSuggestionsRef.current.length > 0) {
          setSuggestions(localSuggestionsRef.current);
          setError(null);
          setPhase("idle");
          return;
        }
        setSuggestions([]);
        if (err instanceof GenAppClientError) {
          setError(err);
          setPhase("error");
        } else {
          setPhase("idle");
        }
      });
  }, []);

  /** 防抖为主（停顿 500ms 发起）+ 节流保底（连续输入 2s 强制发一次） */
  const debouncedSuggest = useMemo(
    () => debounceWithThrottle(fireSuggest, SUGGEST_DEBOUNCE_MS, SUGGEST_MAX_WAIT_MS),
    [fireSuggest],
  );

  useEffect(() => {
    void refreshInstalled();
    return () => {
      debouncedSuggest.cancel();
      suggestAbort.current?.abort();
      stopProgressPoll();
    };
  }, [refreshInstalled, debouncedSuggest, stopProgressPoll]);

  const search = useCallback(
    (query: string) => {
      queryRef.current = query;
      // 输入一变化就让在途响应失效，不能等下一次防抖请求真正发出。
      suggestAbort.current?.abort();
      suggestAbort.current = null;
      suggestSeq.current += 1;
      const trimmed = query.trim();
      if (!trimmed) {
        debouncedSuggest.cancel();
        setSuggestions([]);
        localSuggestionsRef.current = [];
        setPhase("idle");
        setError(null);
        return;
      }
      if (trimmed.length > GEN_APP_LIMITS.queryMaxLength) {
        debouncedSuggest.cancel();
        setSuggestions([]);
        localSuggestionsRef.current = [];
        setPhase("idle");
        setError(null);
        return;
      }
      const immediate = localSuggestions(trimmed);
      localSuggestionsRef.current = immediate;
      setSuggestions(immediate);
      debouncedSuggest(trimmed);
    },
    [debouncedSuggest],
  );

  /** 流式生成的中断控制（windowId → abort） */
  const streamAborts = useRef<Map<string, AbortController>>(new Map());

  /** 流式失败时窗口内错误页（启动台已关，横幅不可见——错误必须留在窗口里） */
  const buildErrorPage = (name: string, message: string) => {
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<!DOCTYPE html><html translate="no"><head><meta charset="utf-8"></head>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;font-family:-apple-system,system-ui,sans-serif;background:#f5f5f7;color:#1d1d1f">
<div style="text-align:center;max-width:420px;padding:24px">
<div style="font-size:44px">⚠️</div>
<h2 style="margin:12px 0 8px;font-size:17px">「${esc(name)}」生成失败</h2>
<p style="margin:0;font-size:13px;color:#6e6e73;word-break:break-all">${esc(message)}</p>
<p style="margin:14px 0 0;font-size:12px;color:#6e6e73">关闭窗口后可在启动台重新点击生成</p>
</div></body></html>`;
  };

  const patchRunning = useCallback(
    (windowId: string, patch: Partial<RunningGenApp>) => {
      setRunning((prev) =>
        prev.map((r) => (r.windowId === windowId ? { ...r, ...patch } : r)),
      );
    },
    [],
  );

  const renderRunning = useCallback(
    (windowId: string, patch: Partial<RunningGenApp>) => {
      setRunning((prev) =>
        prev.map((item) =>
          item.windowId === windowId
            ? { ...item, ...patch, renderSequence: item.renderSequence + 1 }
            : item,
        ),
      );
    },
    [],
  );

  /**
   * 点击候选：流式生成——窗口立即打开，内容边生成边渲染（节流刷新），
   * done 后换编译制品；流式端点不可用时回退非流式。
   */
  const activateSuggestion = useCallback(
    async (suggestion: GenAppSuggestion) => {
      if (pendingSuggestionId) return; // 单并发
      setPendingSuggestionId(suggestion.id);
      setPhase("generating");
      setError(null);
      const idempotencyKey = `${suggestion.id}-${Date.now()}`;
      const windowId = `genapp-${idempotencyKey}`;
      const streamFn = clientRef.current.generateDraftStream?.bind(clientRef.current);

      const finishWithDraft = (draft: GenAppDraft, streamed: boolean) => {
        const app: RunningGenApp = {
          windowId: streamed ? windowId : `genapp-${draft.summary.id}`,
          appId: draft.summary.id,
          name: draft.summary.name,
          iconEmoji: draft.summary.iconEmoji,
          iconTheme: draft.summary.iconTheme,
          html: draft.artifact.html,
          format: draft.artifact.format,
          markup: draft.artifact.markup ?? "",
          runtimeSessionId: draft.runtimeSessionId,
          revision: draft.artifact.revision,
          interactionMode: draft.artifact.interactionMode ?? "hybrid",
          renderSequence: 0,
          mode: "draft",
          status: "ready",
        };
        if (streamed) {
          renderRunning(windowId, {
            appId: app.appId,
            html: app.html,
            format: app.format,
            markup: app.markup,
            runtimeSessionId: app.runtimeSessionId,
            revision: app.revision,
            interactionMode: app.interactionMode,
            status: "ready",
            streamPhase: undefined,
          });
        } else {
          setRunning((prev) =>
            prev.some((r) => r.appId === app.appId) ? prev : [...prev, app],
          );
          host.openWindow(app);
        }
        setPhase("idle");
      };

      try {
        if (streamFn) {
          // —— 流式路径：先开窗，再渐进渲染 ——
          const abort = new AbortController();
          streamAborts.current.set(windowId, abort);
          const app: RunningGenApp = {
            windowId,
            appId: "",
            name: suggestion.name,
            iconEmoji: suggestion.iconEmoji,
            iconTheme: suggestion.iconTheme,
            html: "",
            format: GEN_APP_FORMAT,
            markup: "",
            runtimeSessionId: "",
            revision: 0,
            interactionMode: "hybrid",
            renderSequence: 0,
            mode: "draft",
            status: "streaming",
            streamPhase: "generating",
          };
          setRunning((prev) => [...prev, app]);
          host.openWindow(app);

          let buffer = "";
          let lastFlush = 0;
          let flushTimer: number | null = null;
          const flush = () => {
            lastFlush = Date.now();
            renderRunning(windowId, { markup: buffer });
          };
          const scheduleFlush = () => {
            const since = Date.now() - lastFlush;
            if (since >= 300) {
              flush();
              return;
            }
            if (flushTimer == null) {
              flushTimer = window.setTimeout(() => {
                flushTimer = null;
                flush();
              }, 300 - since);
            }
          };

          try {
            const draft = await streamFn(
              suggestion,
              queryRef.current,
              idempotencyKey,
              {
                onDelta: (text) => {
                  buffer += text;
                  scheduleFlush();
                },
                onPhase: (p) => {
                  if (p.phase === "fixing") {
                    // 修复轮从头重流：清空预览
                    buffer = "";
                    flush();
                  }
                  const label =
                    p.round != null ? `${p.phase}:${p.round}` : p.phase;
                  setAgentPhase(label);
                  patchRunning(windowId, { streamPhase: label });
                },
              },
              abort.signal,
            );
            finishWithDraft(draft, true);
          } finally {
            if (flushTimer != null) window.clearTimeout(flushTimer);
            streamAborts.current.delete(windowId);
          }
          return;
        }

        // —— 非流式回退：老路径 + 进度轮询 ——
        startProgressPoll(idempotencyKey);
        const draft: GenAppDraft = await clientRef.current.generateDraft(
          suggestion,
          queryRef.current,
          idempotencyKey,
          new AbortController().signal,
        );
        finishWithDraft(draft, false);
      } catch (err: unknown) {
        const userCancelled =
          err instanceof DOMException && err.name === "AbortError";
        if (userCancelled) {
          // 用户点红灯取消：requestClose 已撤窗
          setPhase("idle");
        } else if (
          err instanceof GenAppClientError &&
          /Stream endpoint unavailable/.test(err.message)
        ) {
          // 旧服务端无流式端点：撤预览窗，退回非流式
          setRunning((prev) => prev.filter((r) => r.windowId !== windowId));
          host.closeWindow(windowId);
          try {
            startProgressPoll(idempotencyKey);
            const draft = await clientRef.current.generateDraft(
              suggestion,
              queryRef.current,
              idempotencyKey,
              new AbortController().signal,
            );
            finishWithDraft(draft, false);
          } catch (fallbackErr: unknown) {
            if (fallbackErr instanceof GenAppClientError) {
              setError(fallbackErr);
              setPhase("error");
            } else {
              setPhase("idle");
            }
          }
        } else {
          // 流式失败：窗口保留并显示错误页（红灯直接关闭）
          let message =
            err instanceof GenAppClientError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          if (/Another generation is in progress/i.test(message)) {
            message = "已有一个应用正在生成，请等它完成（或关闭其窗口取消）后再试。";
          } else if (/rate limit/i.test(message)) {
            message = "生成太频繁，请稍等一分钟再试。";
          } else if (/timed out/i.test(message)) {
            message = "生成超时（上游响应过慢），请重试一次。";
          }
          renderRunning(windowId, {
            status: "ready",
            mode: "installed", // 红灯走直接关闭分支，不触发安装
            html: buildErrorPage(suggestion.name, message),
            format: GEN_APP_LEGACY_FORMAT,
            markup: "",
            runtimeSessionId: "",
            revision: 0,
            interactionMode: "hybrid",
            renderSequence: 0,
            streamPhase: undefined,
          });
          if (err instanceof GenAppClientError) {
            setError(err);
            setPhase("error");
          } else {
            setPhase("idle");
          }
        }
      } finally {
        stopProgressPoll();
        setAgentPhase(null);
        setPendingSuggestionId(null);
      }
    },
    [
      host,
      patchRunning,
      pendingSuggestionId,
      renderRunning,
      startProgressPoll,
      stopProgressPoll,
    ],
  );

  /** 点击已安装应用：读库秒开（不调模型） */
  const activateInstalled = useCallback(
    async (appId: string) => {
      const existing = running.find((r) => r.appId === appId);
      if (existing) {
        host.openWindow(existing); // 已开 → 聚焦
        return;
      }
      try {
        const bundle = await clientRef.current.launch(appId);
        const app: RunningGenApp = {
          windowId: `genapp-${bundle.summary.id}`,
          appId: bundle.summary.id,
          name: bundle.summary.name,
          iconEmoji: bundle.summary.iconEmoji,
          iconTheme: bundle.summary.iconTheme,
          html: bundle.artifact.html,
          format: bundle.artifact.format,
          markup: bundle.artifact.markup ?? "",
          runtimeSessionId: bundle.runtimeSessionId,
          revision: bundle.artifact.revision,
          interactionMode: bundle.artifact.interactionMode ?? "hybrid",
          renderSequence: 0,
          mode: "installed",
        };
        setRunning((prev) => [...prev, app]);
        host.openWindow(app);
        void refreshInstalled(); // opened_at 更新后刷新排序
      } catch (err: unknown) {
        if (err instanceof GenAppClientError) {
          setError(err);
          setPhase("error");
        }
      }
    },
    [host, running, refreshInstalled],
  );

  /**
   * 关闭请求（红灯）：
   * draft → 先安装成功再关窗；失败保留窗口可重试
   * installed → 直接关窗
   */
  const requestClose = useCallback(
    async (windowId: string): Promise<void> => {
      const app = running.find((r) => r.windowId === windowId);
      if (!app) {
        host.closeWindow(windowId);
        return;
      }
      // 流式生成中关闭 = 取消生成
      if (app.status === "streaming") {
        streamAborts.current.get(windowId)?.abort();
        streamAborts.current.delete(windowId);
        host.closeWindow(windowId);
        setRunning((prev) => prev.filter((r) => r.windowId !== windowId));
        setPhase("idle");
        return;
      }
      if (app.mode === "installed") {
        host.closeWindow(windowId);
        setRunning((prev) => prev.filter((r) => r.windowId !== windowId));
        return;
      }
      setPhase("installing");
      try {
        await clientRef.current.install(app.appId);
        host.closeWindow(windowId);
        setRunning((prev) => prev.filter((r) => r.windowId !== windowId));
        setPhase("idle");
        await refreshInstalled();
      } catch (err: unknown) {
        // 安装失败：窗口不关，暴露错误可重试
        if (err instanceof GenAppClientError) setError(err);
        setPhase("error");
      }
    },
    [host, running, refreshInstalled],
  );

  const remove = useCallback(
    async (appId: string) => {
      try {
        await clientRef.current.remove(appId);
      } catch {
        // 幂等删除失败静默
      }
      setInstalled((prev) => prev.filter((a) => a.id !== appId));
      // 运行中的实例可继续到关闭，但目录立即消失；标记为 installed 模式防止重装
      setRunning((prev) =>
        prev.map((r) => (r.appId === appId ? { ...r, mode: "installed" } : r)),
      );
    },
    [],
  );

  /** Runner 中继：应用内 OpenOS.generate/update → /continue（错误抛回给沙箱侧展示） */
  const continueContent = useCallback(
    (
      appId: string,
      payload: {
        intent: string;
        prompt: string;
        context?: string;
        sessionId?: string;
        targetId?: string;
        currentHtml?: string;
      },
    ) => clientRef.current.continueContent(appId, payload),
    [],
  );

  /** Runner 中继：V2 事件只带元素 id，服务端返回经编译的单目标 revision patch。 */
  const interact = useCallback(
    async (
      windowId: string,
      request: GenAppInteractRequest,
      signal?: AbortSignal,
    ): Promise<GenAppPatchDelivery> => {
      const app = runningRef.current.find((item) => item.windowId === windowId);
      if (
        !app ||
        !app.appId ||
        !app.runtimeSessionId ||
        app.runtimeSessionId !== request.runtimeSessionId
      ) {
        throw new Error("Runtime session is not ready.");
      }
      const sendInteraction = (baseRevision: number) =>
        clientRef.current.interact(
          app.appId,
          {
            ...request,
            runtimeSessionId: app.runtimeSessionId,
            baseRevision,
          },
          signal,
        );
      let recoveredMarkup: string | undefined;
      let response: GenAppInteractResponse;
      try {
        response = await sendInteraction(request.baseRevision);
      } catch (error) {
        if (
          !(error instanceof GenAppClientError) ||
          error.status !== 409 ||
          error.code !== "invalid_transition" ||
          signal?.aborted
        ) {
          throw error;
        }
        const resumableApp = runningRef.current.find(
          (item) =>
            item.windowId === windowId &&
            item.runtimeSessionId === app.runtimeSessionId &&
            item.revision === request.baseRevision,
        );
        if (!resumableApp) {
          throw new DOMException("Runtime window was replaced.", "AbortError");
        }
        const currentRevision = error.details?.currentRevision;
        const currentMarkup = error.details?.currentMarkup;
        if (
          Number.isInteger(currentRevision) &&
          (currentRevision as number) > resumableApp.revision &&
          typeof currentMarkup === "string" &&
          currentMarkup.trim()
        ) {
          setRunning((current) =>
            current.map((item) =>
              item.windowId === windowId &&
              item.runtimeSessionId === app.runtimeSessionId &&
              item.revision === request.baseRevision
                ? {
                    ...item,
                    markup: currentMarkup,
                    revision: currentRevision as number,
                  }
                : item,
            ),
          );
          return {
            kind: "render",
            revision: currentRevision as number,
            markup: currentMarkup,
            error: "Runtime state was synchronized. Please retry the action.",
          };
        }
        const resumed = await clientRef.current.resumeRuntime(
          app.appId,
          {
            runtimeSessionId: app.runtimeSessionId,
            revision: resumableApp.revision,
            markup: resumableApp.markup,
            interactionMode: resumableApp.interactionMode,
          },
          signal,
        );
        recoveredMarkup = resumed.markup;
        response = await sendInteraction(resumed.revision);
      }
      const activeApp = runningRef.current.find(
        (item) =>
          item.windowId === windowId &&
          item.runtimeSessionId === app.runtimeSessionId &&
          item.revision === response.patch.baseRevision,
      );
      if (!activeApp) {
        throw new DOMException("Runtime window was replaced.", "AbortError");
      }
      const markup = applyMarkupPatch(
        recoveredMarkup ?? activeApp.markup,
        response.patch,
      );
      setRunning((current) =>
        current.map((item) => {
          if (
            item.windowId !== windowId ||
            item.runtimeSessionId !== app.runtimeSessionId ||
            item.revision !== response.patch.baseRevision
          ) {
            return item;
          }
          return {
            ...item,
            markup: applyMarkupPatch(
              recoveredMarkup ?? item.markup,
              response.patch,
            ),
            revision: response.patch.revision,
          };
        }),
      );
      return { kind: "patch", patch: response.patch, markup };
    },
    [],
  );

  const view: GenAppWorkspaceView = useMemo(
    () => ({
      installed,
      suggestions,
      pendingSuggestionId,
      phase,
      agentPhase,
      error,
      running,
    }),
    [installed, suggestions, pendingSuggestionId, phase, agentPhase, error, running],
  );

  return {
    view,
    search,
    activateSuggestion,
    activateInstalled,
    requestClose,
    remove,
    continueContent,
    interact,
  };
}

export type GenAppWorkspace = ReturnType<typeof useGenAppWorkspace>;
