import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShelfTarget, WindowDefaults, WindowRect, WindowState } from "./types";

export const MENUBAR_H = 28;
/** Dock 占用视口底部高度（与 CSS --dock-h 对齐） */
export const DOCK_H = 78;
const STAGE_PAD = 8;
/** 拖到 Dock 下方时至少露出标题栏高度，避免窗口完全丢失 */
const MIN_VISIBLE_TITLE = 40;
/** 左右越界时保留一段标题栏，确保窗口始终能被拖回。 */
const MIN_VISIBLE_SIDE = 64;
/** 抽屉最小化动画时长，需与 CSS --shelf-ms 一致 */
export const MINIMIZE_ANIM_MS = 380;

/**
 * 舞台坐标系：菜单栏下方整块区域（含 Dock 叠层区域）。
 * 窗口可拖入 Dock 下方；最大化仍避开 Dock。
 */
function stageBounds() {
  if (typeof window === "undefined") {
    return { width: 1280, height: 800, dockTop: 722 };
  }
  const width = window.innerWidth;
  const height = Math.max(320, window.innerHeight - MENUBAR_H);
  return {
    width,
    height,
    /** 相对 stage 顶部，Dock 开始遮挡的 y */
    dockTop: Math.max(0, height - DOCK_H),
  };
}

function clampRect(rect: WindowRect, stage = stageBounds()): WindowRect {
  const minW = 360;
  const minH = 240;
  const w = Math.min(Math.max(rect.w, minW), Math.max(minW, stage.width - STAGE_PAD * 2));
  // 高度可接近整屏（含 Dock 区），最大化另算
  const h = Math.min(Math.max(rect.h, minH), Math.max(minH, stage.height - STAGE_PAD));
  // 横向允许大部分窗口移出屏幕，但两侧都必须保留可拖回的标题栏区域。
  const minX = Math.min(STAGE_PAD, MIN_VISIBLE_SIDE - w);
  const maxX = Math.max(STAGE_PAD, stage.width - MIN_VISIBLE_SIDE);
  // 允许拖入 Dock 下方，但至少保留标题栏可见
  const maxY = Math.max(STAGE_PAD, stage.height - MIN_VISIBLE_TITLE);
  return {
    x: Math.min(Math.max(minX, rect.x), maxX),
    y: Math.min(Math.max(STAGE_PAD, rect.y), maxY),
    w,
    h,
  };
}

/** 八向拉伸边：n/s/e/w + 四角 */
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const RESIZE_CURSORS: Record<ResizeEdge, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

/** 按拉伸边计算新矩形：拖左/上时对边保持不动（macOS 行为） */
function resizeRect(
  orig: WindowRect,
  edge: ResizeEdge,
  dx: number,
  dy: number,
  stage = stageBounds(),
): WindowRect {
  const minW = 360;
  const minH = 240;
  let { x, y, w, h } = orig;
  if (edge.includes("e")) w = orig.w + dx;
  if (edge.includes("w")) {
    w = orig.w - dx;
    x = orig.x + dx;
  }
  if (edge.includes("s")) h = orig.h + dy;
  if (edge.includes("n")) {
    h = orig.h - dy;
    y = orig.y + dy;
  }
  if (w < minW) {
    if (edge.includes("w")) x = orig.x + orig.w - minW;
    w = minW;
  }
  if (h < minH) {
    if (edge.includes("n")) y = orig.y + orig.h - minH;
    h = minH;
  }
  // 舞台边界：越界收边而不是平移
  if (x < STAGE_PAD) {
    w -= STAGE_PAD - x;
    x = STAGE_PAD;
  }
  if (y < STAGE_PAD) {
    h -= STAGE_PAD - y;
    y = STAGE_PAD;
  }
  w = Math.min(w, stage.width - STAGE_PAD - x);
  h = Math.min(h, stage.height - STAGE_PAD - y);
  return { x, y, w: Math.max(minW, w), h: Math.max(minH, h) };
}

function maximizedRect(stage = stageBounds()): WindowRect {
  // 最大化仍停在 Dock 上方，不被图标栏挡住
  const usableH = Math.max(240, stage.dockTop - STAGE_PAD * 2);
  return {
    x: STAGE_PAD,
    y: STAGE_PAD,
    w: Math.max(360, stage.width - STAGE_PAD * 2),
    h: usableH,
  };
}

/** 窗口底部是否进入 Dock 遮挡带（相对 stage 坐标） */
export function isUnderDock(rect: Pick<WindowRect, "y" | "h">, maximized = false): boolean {
  if (maximized) return false;
  const stage = stageBounds();
  const bottom = rect.y + rect.h;
  // 略微提前进入毛玻璃，避免贴边才突变
  return bottom > stage.dockTop + 6;
}

function createInitialState(defs: WindowDefaults[]): Record<string, WindowState> {
  const out: Record<string, WindowState> = {};
  for (const def of defs) {
    const rect = clampRect({ x: def.x, y: def.y, w: def.w, h: def.h });
    out[def.id] = {
      id: def.id,
      open: def.open ?? false,
      minimized: false,
      maximized: false,
      z: def.z ?? 1,
      title: def.title,
      previewTheme: def.previewTheme ?? def.id,
      ...rect,
    };
  }
  return out;
}

function pickNextFocus(map: Record<string, WindowState>, excludeId: string): string | null {
  const candidates = Object.values(map)
    .filter((w) => w.id !== excludeId && w.open && !w.minimized && !w.anim)
    .sort((a, b) => b.z - a.z);
  return candidates[0]?.id ?? null;
}

export function useWindowManager(defaults: WindowDefaults[]) {
  const [windows, setWindows] = useState(() => createInitialState(defaults));
  /**
   * macOS「Click wallpaper to reveal desktop」：
   * 窗口飞到屏幕边缘，露出桌面图标/壁纸特殊展示。
   */
  const [showDesktop, setShowDesktop] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(() => {
    const opened = defaults
      .filter((d) => d.open)
      .sort((a, b) => (b.z ?? 0) - (a.z ?? 0));
    return opened[0]?.id ?? defaults[0]?.id ?? null;
  });
  const topZRef = useRef(Math.max(1, ...defaults.map((d) => d.z ?? 1)));
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const animTimers = useRef<Record<string, number>>({});
  /** Dock 容器锚点：最小化吸入 / 还原飞出的目标 */
  const dockAnchorRef = useRef<HTMLElement | null>(null);
  /** 记录每个窗口最小化时的抽屉目标，restore 反向复用 */
  const shelfTargets = useRef<Record<string, ShelfTarget>>({});

  const setDockAnchor = useCallback((el: HTMLElement | null) => {
    dockAnchorRef.current = el;
  }, []);

  /** 计算窗口中心 → Dock 抽屉的位移/缩放（视口坐标） */
  const computeShelfTarget = useCallback((id: string): ShelfTarget | undefined => {
    const win = windowsRef.current[id];
    if (!win) return undefined;
    // 优先用已渲染的缩略图；否则退到 Dock 右端
    const thumb = document.querySelector(`[data-min-thumb="${id}"]`);
    const anchor = thumb ?? dockAnchorRef.current;
    if (!anchor) return undefined;
    const ar = (anchor as HTMLElement).getBoundingClientRect();
    // 无缩略图时目标取 Dock 右端内侧
    const acx = thumb ? ar.left + ar.width / 2 : ar.right - 36;
    const acy = ar.top + ar.height / 2;
    const wcx = win.x + win.w / 2;
    const wcy = win.y + MENUBAR_H + win.h / 2;
    return {
      tx: acx - wcx,
      ty: acy - wcy,
      scale: Math.max(0.05, Math.min(56 / win.w, 0.12)),
    };
  }, []);

  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const resizeRef = useRef<{
    id: string;
    edge: ResizeEdge;
    startX: number;
    startY: number;
    orig: WindowRect;
  } | null>(null);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(animTimers.current)) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const resizeStage = useCallback(() => {
    const stage = stageBounds();
    setWindows((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        const win = next[id];
        if (win.maximized) {
          next[id] = { ...win, ...maximizedRect(stage) };
        } else if (!win.minimized) {
          next[id] = { ...win, ...clampRect(win, stage) };
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    window.addEventListener("resize", resizeStage);
    return () => window.removeEventListener("resize", resizeStage);
  }, [resizeStage]);

  useEffect(() => {
    function onMove(event: MouseEvent) {
      const resize = resizeRef.current;
      if (resize) {
        const dx = event.clientX - resize.startX;
        const dy = event.clientY - resize.startY;
        setWindows((prev) => {
          const win = prev[resize.id];
          if (!win || win.maximized || win.minimized || win.anim) return prev;
          return {
            ...prev,
            [resize.id]: {
              ...win,
              ...resizeRect(resize.orig, resize.edge, dx, dy),
            },
          };
        });
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      setWindows((prev) => {
        const win = prev[drag.id];
        if (!win || win.maximized || win.minimized || win.anim) return prev;
        const nextRect = clampRect({
          x: drag.origX + dx,
          y: drag.origY + dy,
          w: win.w,
          h: win.h,
        });
        return {
          ...prev,
          [drag.id]: { ...win, ...nextRect },
        };
      });
    }

    function onUp() {
      dragRef.current = null;
      if (resizeRef.current) {
        resizeRef.current = null;
        document.body.style.cursor = "";
      }
      document.body.classList.remove("wm-interacting");
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const clearAnimTimer = useCallback((id: string) => {
    const timer = animTimers.current[id];
    if (timer) {
      window.clearTimeout(timer);
      delete animTimers.current[id];
    }
  }, []);

  const exitShowDesktop = useCallback(() => {
    setShowDesktop(false);
  }, []);

  const toggleShowDesktop = useCallback(() => {
    setShowDesktop((v) => !v);
    if (!showDesktop) {
      setFocusedId(null);
    }
  }, [showDesktop]);

  const revealDesktop = useCallback(() => {
    setShowDesktop(true);
    setFocusedId(null);
  }, []);

  const focus = useCallback((id: string) => {
    setShowDesktop(false);
    setFocusedId(id);
    topZRef.current += 1;
    const z = topZRef.current;
    setWindows((prev) => {
      const win = prev[id];
      if (!win) return prev;
      return {
        ...prev,
        [id]: {
          ...win,
          open: true,
          minimized: false,
          anim: undefined,
          z,
        },
      };
    });
  }, []);

  /** 动态注册并打开窗口（Gen Apps 等运行时应用）。已存在同 id 时仅聚焦。 */
  const openDynamic = useCallback((definition: WindowDefaults) => {
    setWindows((prev) => {
      if (prev[definition.id]) return prev;
      const created = createInitialState([{ ...definition, open: false }]);
      return { ...prev, ...created };
    });
    // focus 会置 open=true 并提升 z
    focus(definition.id);
  }, [focus]);

  /** 注销动态窗口（删除运行中的应用时用） */
  const unregister = useCallback((id: string) => {
    clearAnimTimer(id);
    setWindows((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      setFocusedId((current) => (current === id ? pickNextFocus(next, id) : current));
      return next;
    });
  }, [clearAnimTimer]);

  const open = useCallback(
    (id: string) => {
      setShowDesktop(false);
      const win = windowsRef.current[id];
      if (win?.minimized) {
        // restore：从抽屉缩略图位置反向飞回
        clearAnimTimer(id);
        topZRef.current += 1;
        const z = topZRef.current;
        const token = Date.now();
        const target = computeShelfTarget(id) ?? shelfTargets.current[id];
        setFocusedId(id);
        setWindows((prev) => {
          const current = prev[id];
          if (!current) return prev;
          return {
            ...prev,
            [id]: {
              ...current,
              open: true,
              minimized: false,
              z,
              anim: { phase: "in", token, target },
            },
          };
        });
        animTimers.current[id] = window.setTimeout(() => {
          setWindows((prev) => {
            const current = prev[id];
            if (!current) return prev;
            return {
              ...prev,
              [id]: { ...current, anim: undefined },
            };
          });
          delete animTimers.current[id];
        }, MINIMIZE_ANIM_MS);
        return;
      }
      focus(id);
    },
    [clearAnimTimer, computeShelfTarget, focus],
  );

  const close = useCallback(
    (id: string) => {
      clearAnimTimer(id);
      setWindows((prev) => {
        const win = prev[id];
        if (!win) return prev;
        const next = {
          ...prev,
          [id]: {
            ...win,
            open: false,
            minimized: false,
            anim: undefined,
          },
        };
        setFocusedId((current) => (current === id ? pickNextFocus(next, id) : current));
        return next;
      });
    },
    [clearAnimTimer],
  );

  const minimize = useCallback(
    (id: string) => {
      const win = windowsRef.current[id];
      if (!win || !win.open || win.minimized || win.anim?.phase === "out") return;

      clearAnimTimer(id);
      const token = Date.now();
      const target = computeShelfTarget(id);
      if (target) shelfTargets.current[id] = target;

      setWindows((prev) => {
        const current = prev[id];
        if (!current) return prev;
        return {
          ...prev,
          [id]: {
            ...current,
            anim: { phase: "out", token, target },
          },
        };
      });
      setFocusedId((current) =>
        current === id ? pickNextFocus(windowsRef.current, id) : current,
      );

      animTimers.current[id] = window.setTimeout(() => {
        setWindows((prev) => {
          const current = prev[id];
          if (!current) return prev;
          const next = {
            ...prev,
            [id]: {
              ...current,
              minimized: true,
              anim: undefined,
            },
          };
          return next;
        });
        delete animTimers.current[id];
      }, MINIMIZE_ANIM_MS);
    },
    [clearAnimTimer, computeShelfTarget],
  );

  const toggleMaximize = useCallback(
    (id: string) => {
      setWindows((prev) => {
        const win = prev[id];
        if (!win || win.anim) return prev;
        if (win.maximized) {
          const restore = win.restore ?? {
            x: win.x,
            y: win.y,
            w: win.w,
            h: win.h,
          };
          return {
            ...prev,
            [id]: {
              ...win,
              open: true,
              minimized: false,
              maximized: false,
              restore: undefined,
              ...clampRect(restore),
            },
          };
        }
        const restore: WindowRect = {
          x: win.x,
          y: win.y,
          w: win.w,
          h: win.h,
        };
        return {
          ...prev,
          [id]: {
            ...win,
            open: true,
            minimized: false,
            maximized: true,
            restore,
            ...maximizedRect(),
          },
        };
      });
      focus(id);
    },
    [focus],
  );

  const beginDrag = useCallback(
    (id: string, event: React.MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("button, input, select, a, textarea, .traffic")) return;
      const win = windowsRef.current[id];
      if (!win || win.maximized || win.anim) {
        focus(id);
        return;
      }
      event.preventDefault();
      focus(id);
      dragRef.current = {
        id,
        startX: event.clientX,
        startY: event.clientY,
        origX: win.x,
        origY: win.y,
      };
      // 拖拽/拉伸期间禁用 iframe 指针事件，防止滑入 Runner 内容吞掉 mousemove
      document.body.classList.add("wm-interacting");
    },
    [focus],
  );

  const beginResize = useCallback(
    (id: string, edge: ResizeEdge, event: React.MouseEvent) => {
      if (event.button !== 0) return;
      const win = windowsRef.current[id];
      if (!win || win.maximized || win.minimized || win.anim) return;
      event.preventDefault();
      event.stopPropagation();
      focus(id);
      resizeRef.current = {
        id,
        edge,
        startX: event.clientX,
        startY: event.clientY,
        orig: { x: win.x, y: win.y, w: win.w, h: win.h },
      };
      // 拉伸期间指针可能滑出手柄区域——用 body 光标锁定形状
      document.body.style.cursor = RESIZE_CURSORS[edge];
      document.body.classList.add("wm-interacting");
    },
    [focus],
  );

  const isVisible = useCallback((id: string) => {
    const win = windows[id];
    // 动画中的 out 仍可见；minimized 且无动画则隐藏
    if (!win?.open) return false;
    if (win.minimized && win.anim?.phase !== "in") return false;
    return true;
  }, [windows]);

  const isRunning = useCallback((id: string) => Boolean(windows[id]?.open), [windows]);

  const minimizedWindows = useMemo(
    () =>
      Object.values(windows)
        .filter((w) => w.open && w.minimized && !w.anim)
        .sort((a, b) => a.z - b.z),
    [windows],
  );

  const visibleWindows = useMemo(
    () =>
      Object.values(windows)
        .filter((w) => w.open && (!w.minimized || w.anim))
        .sort((a, b) => a.z - b.z),
    [windows],
  );

  return {
    windows,
    focusedId,
    visibleWindows,
    minimizedWindows,
    showDesktop,
    focus,
    open,
    close,
    minimize,
    toggleMaximize,
    beginDrag,
    beginResize,
    isVisible,
    isRunning,
    revealDesktop,
    exitShowDesktop,
    toggleShowDesktop,
    setDockAnchor,
    openDynamic,
    unregister,
  };
}

export type WindowManager = ReturnType<typeof useWindowManager>;
