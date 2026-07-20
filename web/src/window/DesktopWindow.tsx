import type { CSSProperties, ReactNode } from "react";
import type { WindowState } from "./types";
import {
  isUnderDock,
  type ResizeEdge,
  type WindowManager,
} from "./useWindowManager";

const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export type WindowScrollMode = "auto" | "y" | "x" | "both" | "none";

export type DesktopWindowProps = {
  id: string;
  title: string;
  meta?: string;
  className?: string;
  manager: WindowManager;
  children: ReactNode;
  /**
   * 内容区滚动策略（默认 y）：
   * - auto/y: 纵向滚动（设置页等长内容）
   * - x/both: 横向 / 双向
   * - none: 不滚动，由内部子布局自己管理（如 Sir 聊天区）
   */
  scroll?: WindowScrollMode;
  /** 附加到可滚动内容壳上的 class */
  bodyClassName?: string;
  /** 红灯关闭拦截：提供时红灯只触发回调，由调用方决定何时真正 close（草稿安装场景） */
  onRequestClose?: () => void;
  /** @deprecated 使用 bodyClassName；保留兼容 */
  useDefaultBody?: boolean;
};

function scrollClass(mode: WindowScrollMode): string {
  switch (mode) {
    case "none":
      return "scroll-none";
    case "x":
      return "scroll-x";
    case "both":
      return "scroll-both";
    case "auto":
    case "y":
    default:
      return "scroll-y";
  }
}

/**
 * 可复用桌面窗口：
 * - 红/黄/绿（关闭 / 最小化+Genie / 最大化）
 * - 拖拽标题栏、聚焦层级
 * - 统一内容区滚动壳（WindowScroll），设置页等长内容可直接滚动
 *
 * 新页面：
 * ```tsx
 * <DesktopWindow id="files" title="Files" manager={wm} scroll="y">
 *   ...长内容...
 * </DesktopWindow>
 * ```
 */
export function DesktopWindow({
  id,
  title,
  meta,
  className = "",
  manager,
  children,
  scroll = "y",
  bodyClassName = "",
  onRequestClose,
}: DesktopWindowProps) {
  const win = manager.windows[id] as WindowState | undefined;
  if (!win || !win.open) return null;
  if (win.minimized && win.anim?.phase !== "in") return null;

  const focused = manager.focusedId === id;
  const underDock = isUnderDock(win, win.maximized);
  const showDesktop = manager.showDesktop;
  // show-desktop 散开方向：左 / 右 / 下 —— 选窗口中心距离最近的屏幕边
  const ASIDE_PEEK = 60;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
  const centerX = win.x + win.w / 2;
  const centerY = win.y + win.h / 2;
  const distLeft = centerX;
  const distRight = viewportW - centerX;
  const distBottom = viewportH - centerY;
  const edge =
    distBottom < distLeft && distBottom < distRight
      ? "bottom"
      : distLeft < distRight
        ? "left"
        : "right";
  // 位移量：露出部分与对应屏幕边缘固定 PEEK 距离
  let asideTx = 0;
  let asideTy = 0;
  if (edge === "left") {
    asideTx = -(win.x + win.w) + ASIDE_PEEK; // 右缘落在 x=PEEK
  } else if (edge === "right") {
    asideTx = viewportW - win.x - ASIDE_PEEK; // 左缘落在 viewport-PEEK
  } else {
    asideTy = viewportH - win.y - ASIDE_PEEK; // 上缘落在 viewportH-PEEK
  }
  const animClass =
    win.anim?.phase === "out"
      ? "shelf-out"
      : win.anim?.phase === "in"
        ? "shelf-in"
        : "";

  // 抽屉式吸入/飞出：位移+缩放到 Dock 缩略图位置（GPU 合成，避免卡顿）
  const target = win.anim?.target;
  const shelfVars = target
    ? ({
        "--shelf-tx": `${target.tx}px`,
        "--shelf-ty": `${target.ty}px`,
        "--shelf-scale": target.scale,
      } as CSSProperties)
    : ({
        "--shelf-tx": "0px",
        "--shelf-ty": "60vh",
        "--shelf-scale": 0.08,
      } as CSSProperties);

  const style: CSSProperties = {
    left: win.x,
    top: win.y,
    width: win.w,
    height: win.h,
    zIndex: win.anim ? 9999 : showDesktop ? 2 : win.z,
    ...(win.anim ? shelfVars : null),
    ...(showDesktop
      ? ({
          "--aside-tx": `${asideTx}px`,
          "--aside-ty": `${asideTy}px`,
        } as CSSProperties)
      : null),
  };

  return (
    <section
      className={`window ${win.maximized ? "maximized" : ""} ${focused ? "focused" : "unfocused"} ${underDock ? "under-dock" : ""} ${showDesktop ? `show-desktop-aside edge-${edge}` : ""} ${animClass} ${className}`.trim()}
      style={style}
      onMouseDownCapture={(event) => {
        if (win.anim) return;
        if (manager.focusedId === id && !win.minimized) return;
        // 点击背后窗口任意区域 → 置顶聚焦（capture 阶段先于内容处理）
        manager.focus(id);
        // 仿 macOS click-through 防护：首次点击只置顶，不误触内容；
        // 标题栏（可即拖）与表单控件（input/select 等需立即聚焦输入）除外
        const target = event.target as HTMLElement;
        if (
          !target.closest(
            ".window-title, .resize-handle, input, textarea, select, button, a, label",
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onMouseDown={() => {
        if (win.anim) return;
        // 显示桌面态下点窗口 = 还原并聚焦
        manager.focus(id);
      }}
      data-window-id={id}
      data-anim-token={win.anim?.token}
      data-edge={edge}
    >
      <div
        className="window-title"
        onMouseDown={(event) => {
          if (!win.anim) manager.beginDrag(id, event);
        }}
        onDoubleClick={(event) => {
          if (win.anim) return;
          event.preventDefault();
          manager.toggleMaximize(id);
        }}
      >
        <div className="traffic">
          <button
            type="button"
            className="red"
            title="Close"
            aria-label="Close"
            disabled={Boolean(win.anim)}
            onClick={(event) => {
              event.stopPropagation();
              if (onRequestClose) onRequestClose();
              else manager.close(id);
            }}
          />
          <button
            type="button"
            className="yellow"
            title="Minimize"
            aria-label="Minimize"
            disabled={Boolean(win.anim)}
            onClick={(event) => {
              event.stopPropagation();
              manager.minimize(id);
            }}
          />
          <button
            type="button"
            className="green"
            title={win.maximized ? "Restore" : "Zoom"}
            aria-label={win.maximized ? "Restore" : "Zoom"}
            disabled={Boolean(win.anim)}
            onClick={(event) => {
              event.stopPropagation();
              manager.toggleMaximize(id);
            }}
          />
        </div>
        <div className="window-title-label">{title}</div>
        <div className="window-title-meta">{meta ?? ""}</div>
      </div>

      <div
        className={`window-content ${scrollClass(scroll)} ${bodyClassName}`.trim()}
        data-window-content={id}
      >
        {children}
      </div>

      {/* macOS 式八向拉伸手柄（最大化/动画/显示桌面态不可拉伸） */}
      {!win.maximized && !win.anim && !showDesktop
        ? RESIZE_EDGES.map((edge) => (
            <div
              key={edge}
              className={`resize-handle rh-${edge}`}
              onMouseDown={(event) => manager.beginResize(id, edge, event)}
            />
          ))
        : null}
    </section>
  );
}

/**
 * 可选：在 scroll="none" 的窗口内再开一个局部滚动区。
 * 例如侧栏列表、聊天消息区。
 */
export function WindowScroll({
  children,
  className = "",
  axis = "y",
}: {
  children: ReactNode;
  className?: string;
  axis?: "y" | "x" | "both";
}) {
  const axisClass =
    axis === "x" ? "scroll-x" : axis === "both" ? "scroll-both" : "scroll-y";
  return (
    <div className={`window-scroll ${axisClass} ${className}`.trim()}>
      {children}
    </div>
  );
}
