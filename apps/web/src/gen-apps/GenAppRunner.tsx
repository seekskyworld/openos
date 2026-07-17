import { useEffect, useMemo, useRef } from "react";
import { DesktopWindow, type WindowManager } from "../window";
import { useI18n } from "../i18n";
import type { RunningGenApp } from "./useGenAppWorkspace.js";

/** 流式预览：脚本禁用（sandbox=""），CSP 拦外链；只做视觉渐进 */
const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";

function buildPreviewDoc(partial: string): string {
  // 剥模型输出前缀围栏（流式中途尾部围栏可能未到）
  let html = partial.replace(/^\s*```(?:html)?\s*/i, "");
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${cspMeta}`);
  }
  if (/<!DOCTYPE|<html/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, (m) => `${m}<head>${cspMeta}</head>`);
  }
  return `<!DOCTYPE html><html translate="no"><head><meta charset="utf-8"><meta name="google" content="notranslate">${cspMeta}</head><body>${html}</body></html>`;
}

type Props = {
  app: RunningGenApp;
  manager: WindowManager;
  /** 红灯关闭请求：draft 会先安装成功再真正关闭 */
  onRequestClose: (windowId: string) => void;
  /** 应用内 OpenOS.generate 中继（未提供则续生成不可用） */
  onContinue?: (
    appId: string,
    payload: { intent: string; prompt: string; context?: string },
  ) => Promise<string>;
  /** 安装中等状态提示 */
  meta?: string;
};

/**
 * GenAppRunner：统一沙箱运行窗口。
 * - 内容为服务端编译过的制品（CSP 已注入，含生成式运行时 SDK）
 * - sandbox 仅 allow-scripts：无同源、无表单、无弹窗、无下载、无顶层导航
 * - postMessage 中继：只认本窗口 iframe 的 event.source，schema 严格校验
 * - 关闭走 onRequestClose（草稿在此拦截安装）
 */
export function GenAppRunner({
  app,
  manager,
  onRequestClose,
  onContinue,
  meta,
}: Props) {
  const { t } = useI18n();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

  const streaming = app.status === "streaming";
  const doc = useMemo(
    () => (streaming ? buildPreviewDoc(app.html) : app.html),
    [streaming, app.html],
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

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      // 安全边界：只处理来自本窗口 iframe 的消息
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as {
        type?: unknown;
        requestId?: unknown;
        payload?: { intent?: unknown; prompt?: unknown; context?: unknown };
      };
      if (data?.type !== "openos:generate" || typeof data.requestId !== "string") {
        return;
      }
      const requestId = data.requestId;
      const reply = (body: { ok: boolean; fragment?: string; error?: string }) => {
        // sandbox srcdoc origin 为 opaque，targetOrigin 只能 "*"
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
      const payload = {
        intent: String(data.payload?.intent ?? ""),
        prompt: String(data.payload?.prompt ?? ""),
        ...(typeof data.payload?.context === "string"
          ? { context: data.payload.context }
          : {}),
      };
      relay(app.appId, payload)
        .then((fragment) => reply({ ok: true, fragment }))
        .catch((error: unknown) =>
          reply({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [app.appId]);

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
        sandbox={streaming ? "" : "allow-scripts"}
        referrerPolicy="no-referrer"
        allow=""
      />
      {streaming ? <div className="genapp-stream-bar" /> : null}
    </DesktopWindow>
  );
}
