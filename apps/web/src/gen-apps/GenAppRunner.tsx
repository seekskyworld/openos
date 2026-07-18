import { useEffect, useMemo, useRef } from "react";
import {
  buildGenAppRuntimeDocument,
  GEN_APP_FORMAT,
  parseGenAppRuntimeEvent,
  type GenAppInteractRequest,
} from "@openos/shared";
import { DesktopWindow, type WindowManager } from "../window";
import { useI18n } from "../i18n";
import type {
  GenAppPatchDelivery,
  RunningGenApp,
} from "./useGenAppWorkspace.js";

/** V1 流式预览：脚本禁用（sandbox=""），CSP 拦外链；只做视觉渐进。 */
const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

/** V2 Shell 与应用内容无关，因此 iframe 生命周期内只加载一次。 */
const V2_RUNTIME_DOCUMENT = buildGenAppRuntimeDocument();

function buildPreviewDoc(partial: string): string {
  let html = partial.replace(/^\s*```(?:html)?\s*/i, "");
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}${cspMeta}`);
  }
  if (/<!DOCTYPE|<html/i.test(html)) {
    return html.replace(
      /(<html[^>]*>)/i,
      (match) => `${match}<head>${cspMeta}</head>`,
    );
  }
  return `<!DOCTYPE html><html translate="no"><head><meta charset="utf-8"><meta name="google" content="notranslate">${cspMeta}</head><body>${html}</body></html>`;
}

type Props = {
  app: RunningGenApp;
  manager: WindowManager;
  onRequestClose: (windowId: string) => void;
  /** V1 OpenOS.generate/update 兼容中继。 */
  onContinue?: (
    appId: string,
    payload: {
      intent: string;
      prompt: string;
      context?: string;
      sessionId?: string;
      targetId?: string;
      currentHtml?: string;
    },
  ) => Promise<string>;
  /** V2 统一 AI 事件中继。 */
  onInteract?: (
    windowId: string,
    request: GenAppInteractRequest,
    signal?: AbortSignal,
  ) => Promise<GenAppPatchDelivery>;
  meta?: string;
};

/**
 * GenAppRunner：V2 使用固定可信 Shell + postMessage 增量渲染；V1 保留 srcDoc 路径。
 * 两条路径都只接受本 iframe 的消息，且从不开放同源、表单、弹窗或导航能力。
 */
export function GenAppRunner({
  app,
  manager,
  onRequestClose,
  onContinue,
  onInteract,
  meta,
}: Props) {
  const { t } = useI18n();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const appRef = useRef(app);
  const patchDeliveriesRef = useRef(new Map<string, GenAppPatchDelivery>());
  const interactionAbortsRef = useRef(new Map<string, AbortController>());
  const onContinueRef = useRef(onContinue);
  const onInteractRef = useRef(onInteract);
  appRef.current = app;
  onContinueRef.current = onContinue;
  onInteractRef.current = onInteract;

  const streaming = app.status === "streaming";
  const isV2 = app.format === GEN_APP_FORMAT;
  const doc = useMemo(
    () =>
      isV2
        ? V2_RUNTIME_DOCUMENT
        : streaming
          ? buildPreviewDoc(app.html)
          : app.html,
    [isV2, streaming, app.html],
  );
  const streamMeta = useMemo(() => {
    if (!streaming) return undefined;
    const key = (app.streamPhase ?? "generating").split(":")[0];
    const label =
      key === "fixing"
        ? t("genapps.streaming.fixing")
        : key === "checking"
          ? t("genapps.streaming.checking")
          : t("genapps.streaming.generating");
    const round = app.streamPhase?.includes(":")
      ? ` · ${app.streamPhase.split(":")[1]}`
      : "";
    return `${label}${round}`;
  }, [streaming, app.streamPhase, t]);

  const postV2State = () => {
    const frame = frameRef.current;
    const current = appRef.current;
    if (!frame?.contentWindow || !readyRef.current || current.format !== GEN_APP_FORMAT) {
      return;
    }
    frame.contentWindow.postMessage(
      {
        type: "openos:configure",
        runtimeSessionId: current.runtimeSessionId,
        revision: current.revision,
        interactionMode: current.interactionMode,
      },
      "*",
    );
    frame.contentWindow.postMessage(
      { type: "openos:render", markup: current.markup, revision: current.revision },
      "*",
    );
  };

  useEffect(() => {
    postV2State();
  }, [app.renderSequence, app.runtimeSessionId, app.interactionMode, isV2]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as Record<string, unknown>;

      if (data?.type === "openos:ready" && appRef.current.format === GEN_APP_FORMAT) {
        readyRef.current = true;
        postV2State();
        return;
      }

      if (data?.type === "openos:patch-resync") {
        const payload = data.payload as Record<string, unknown> | undefined;
        const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
        const delivery = patchDeliveriesRef.current.get(requestId);
        if (!requestId || !delivery || delivery.kind !== "patch") return;
        frame.contentWindow?.postMessage(
          {
            type: "openos:render",
            requestId,
            markup: delivery.markup,
            revision: delivery.patch.revision,
          },
          "*",
        );
        return;
      }

      if (data?.type === "openos:patch-settled") {
        const payload = data.payload as Record<string, unknown> | undefined;
        if (typeof payload?.requestId === "string") {
          patchDeliveriesRef.current.delete(payload.requestId);
        }
        return;
      }

      if (data?.type === "openos:interact") {
        const payload = data.payload as Record<string, unknown> | undefined;
        const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
        const runtimeSessionId =
          typeof payload?.runtimeSessionId === "string" ? payload.runtimeSessionId : "";
        const baseRevision = payload?.baseRevision;
        const runtimeEvent = parseGenAppRuntimeEvent(payload?.event);
        const relay = onInteractRef.current;
        const replyError = (error: unknown) => {
          frame.contentWindow?.postMessage(
            {
              type: "openos:patch-error",
              requestId,
              error: error instanceof Error ? error.message : String(error),
            },
            "*",
          );
        };
        if (
          !requestId ||
          !runtimeSessionId ||
          !Number.isInteger(baseRevision) ||
          !runtimeEvent ||
          !relay
        ) {
          replyError("Invalid runtime interaction.");
          return;
        }
        if (interactionAbortsRef.current.size > 0) {
          replyError("Another interaction for this window is in progress.");
          return;
        }
        const abort = new AbortController();
        interactionAbortsRef.current.set(requestId, abort);
        relay(
          appRef.current.windowId,
          {
            runtimeSessionId,
            baseRevision: baseRevision as number,
            event: runtimeEvent,
          },
          abort.signal,
        )
          .then((delivery) => {
            if (abort.signal.aborted) return;
            if (delivery.kind === "render") {
              frame.contentWindow?.postMessage(
                {
                  type: "openos:render",
                  requestId,
                  markup: delivery.markup,
                  revision: delivery.revision,
                  error: delivery.error,
                },
                "*",
              );
              return;
            }
            patchDeliveriesRef.current.set(requestId, delivery);
            frame.contentWindow?.postMessage(
              { type: "openos:patch", requestId, patch: delivery.patch },
              "*",
            );
          })
          .catch((error: unknown) => {
            if (!abort.signal.aborted) replyError(error);
          })
          .finally(() => interactionAbortsRef.current.delete(requestId));
        return;
      }

      if (data?.type !== "openos:generate" || typeof data.requestId !== "string") {
        return;
      }
      const requestId = data.requestId;
      const payload = data.payload as Record<string, unknown> | undefined;
      const reply = (body: { ok: boolean; fragment?: string; error?: string }) => {
        frame.contentWindow?.postMessage(
          { type: "openos:result", requestId, ...body },
          "*",
        );
      };
      const relay = onContinueRef.current;
      if (!relay) {
        reply({ ok: false, error: "runtime generation unavailable" });
        return;
      }
      const optionalString = (value: unknown) =>
        typeof value === "string" ? value : undefined;
      const sessionId = optionalString(
        payload?.sessionId ??
          payload?.runtimeSessionId ??
          appRef.current.runtimeSessionId,
      );
      relay(appRef.current.appId, {
        intent: String(payload?.intent ?? ""),
        prompt: String(payload?.prompt ?? ""),
        ...(optionalString(payload?.context) !== undefined
          ? { context: optionalString(payload?.context) }
          : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...(optionalString(payload?.targetId) !== undefined
          ? { targetId: optionalString(payload?.targetId) }
          : {}),
        ...(optionalString(payload?.currentHtml) !== undefined
          ? { currentHtml: optionalString(payload?.currentHtml) }
          : {}),
      })
        .then((fragment) => reply({ ok: true, fragment }))
        .catch((error: unknown) =>
          reply({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    }

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      for (const abort of interactionAbortsRef.current.values()) abort.abort();
      interactionAbortsRef.current.clear();
      patchDeliveriesRef.current.clear();
    };
  }, []);

  return (
    <DesktopWindow
      id={app.windowId}
      title={`${app.iconEmoji} ${app.name}`}
      meta={streamMeta ?? meta}
      className={`genapp-window ${streaming ? "genapp-streaming" : ""}`.trim()}
      manager={manager}
      scroll="none"
      onRequestClose={() => onRequestClose(app.windowId)}
    >
      <iframe
        ref={frameRef}
        className="genapp-frame"
        title={app.name}
        srcDoc={doc}
        sandbox={isV2 || !streaming ? "allow-scripts" : ""}
        referrerPolicy="no-referrer"
        allow=""
        onLoad={() => {
          if (appRef.current.format === GEN_APP_FORMAT) {
            readyRef.current = true;
            postV2State();
          }
        }}
      />
      {streaming ? <div className="genapp-stream-bar" /> : null}
    </DesktopWindow>
  );
}
