import { useEffect, useRef } from "react";
import { DesktopWindow, type WindowManager } from "../window";
import type { RunningGenApp } from "./useGenAppWorkspace.js";

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
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

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
      meta={meta}
      className="genapp-window"
      manager={manager}
      scroll="none"
      onRequestClose={() => onRequestClose(app.windowId)}
    >
      <iframe
        ref={frameRef}
        className="genapp-frame"
        title={app.name}
        srcDoc={app.html}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        allow=""
      />
    </DesktopWindow>
  );
}
