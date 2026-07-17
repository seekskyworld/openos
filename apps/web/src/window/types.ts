export type WindowRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/** 飞向 Dock 抽屉的目标（相对窗口自身的位移与缩放） */
export type ShelfTarget = {
  tx: number;
  ty: number;
  scale: number;
};

export type MinimizeAnim = {
  /** genie out / reverse restore */
  phase: "out" | "in";
  /** animation token so React remounts keyframes */
  token: number;
  /** 吸入/飞出的抽屉目标点；缺省时退化为向下缩小 */
  target?: ShelfTarget;
};

export type WindowState = WindowRect & {
  id: string;
  open: boolean;
  /** Dock 最小化：窗口不可见但应用仍视为运行中 */
  minimized: boolean;
  maximized: boolean;
  z: number;
  /** 最大化前的几何，用于还原 */
  restore?: WindowRect;
  /** 最小化动画状态 */
  anim?: MinimizeAnim;
  /** 最小化到 Dock 的缩略图（CSS 主题 id 或数据 URL） */
  previewTheme?: string;
  title?: string;
};

export type WindowDefaults = WindowRect & {
  id: string;
  open?: boolean;
  z?: number;
  title?: string;
  previewTheme?: string;
};

export type WindowMeta = {
  id: string;
  title: string;
  /** Dock / 缩略图角标主题 */
  icon: "sir" | "settings" | "files" | "generic";
  previewTheme: string;
};
