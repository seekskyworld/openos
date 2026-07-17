import { DesktopWindow, type WindowManager } from "../window";
import type { RunningGenApp } from "./useGenAppWorkspace.js";

type Props = {
  app: RunningGenApp;
  manager: WindowManager;
  /** 红灯关闭请求：draft 会先安装成功再真正关闭 */
  onRequestClose: (windowId: string) => void;
  /** 安装中等状态提示 */
  meta?: string;
};

/**
 * GenAppRunner：统一沙箱运行窗口。
 * - 内容为服务端编译过的制品（CSP 已注入）
 * - sandbox 仅 allow-scripts：无同源、无表单、无弹窗、无下载、无顶层导航
 * - 关闭走 onRequestClose（草稿在此拦截安装）
 */
export function GenAppRunner({ app, manager, onRequestClose, meta }: Props) {
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
