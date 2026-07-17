import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GenAppDraft,
  GenAppSuggestion,
  GenAppSummary,
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

export type RunningGenApp = {
  /** 窗口 id：genapp-<appId> */
  windowId: string;
  appId: string;
  name: string;
  iconEmoji: string;
  iconTheme: GenAppSummary["iconTheme"];
  html: string;
  /** draft = 关闭时需安装；installed = 直接关闭 */
  mode: "draft" | "installed";
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
  const suggestAbort = useRef<AbortController | null>(null);
  /** 单调请求序号：旧响应不得覆盖新响应 */
  const suggestSeq = useRef(0);
  const progressTimer = useRef<number | null>(null);

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
        setSuggestions(result);
        setPhase("idle");
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted || seq !== suggestSeq.current) return;
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
      const trimmed = query.trim();
      if (!trimmed) {
        debouncedSuggest.cancel();
        suggestAbort.current?.abort();
        setSuggestions([]);
        setPhase("idle");
        setError(null);
        return;
      }
      debouncedSuggest(trimmed);
    },
    [debouncedSuggest],
  );

  /** 点击候选：生成草稿并打开 Runner 窗口 */
  const activateSuggestion = useCallback(
    async (suggestion: GenAppSuggestion) => {
      if (pendingSuggestionId) return; // 单并发
      setPendingSuggestionId(suggestion.id);
      setPhase("generating");
      setError(null);
      // 幂等键带时间戳避免复用旧草稿挡住重新生成；进度轮询同 key
      const idempotencyKey = `${suggestion.id}-${Date.now()}`;
      // 始终轮询：fast 路径 phase 多为 unknown，2s 成本可忽略；agentic 可见 phase 变化
      startProgressPoll(idempotencyKey);
      try {
        const draft: GenAppDraft = await clientRef.current.generateDraft(
          suggestion,
          queryRef.current,
          idempotencyKey,
          new AbortController().signal,
        );
        const app: RunningGenApp = {
          windowId: `genapp-${draft.summary.id}`,
          appId: draft.summary.id,
          name: draft.summary.name,
          iconEmoji: draft.summary.iconEmoji,
          iconTheme: draft.summary.iconTheme,
          html: draft.artifact.html,
          mode: "draft",
        };
        setRunning((prev) =>
          prev.some((r) => r.appId === app.appId) ? prev : [...prev, app],
        );
        host.openWindow(app);
        setPhase("idle");
      } catch (err: unknown) {
        if (err instanceof GenAppClientError) {
          setError(err);
          setPhase("error");
        } else {
          setPhase("idle");
        }
      } finally {
        stopProgressPoll();
        setAgentPhase(null);
        setPendingSuggestionId(null);
      }
    },
    [host, pendingSuggestionId, startProgressPoll, stopProgressPoll],
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

  return { view, search, activateSuggestion, activateInstalled, requestClose, remove };
}

export type GenAppWorkspace = ReturnType<typeof useGenAppWorkspace>;
