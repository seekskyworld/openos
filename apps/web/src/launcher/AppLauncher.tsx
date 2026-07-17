import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type LauncherApp = {
  id: string;
  name: string;
  /** 分类标签 */
  category: string;
  /** 图标节点（任意渲染） */
  icon: ReactNode;
  onOpen: () => void;
  /** 提供时条目出现「×」删除入口（Gen Apps） */
  onRemove?: () => void;
  /** AI 语义候选：按搜索词生成、名字不必含原词，跳过本地文本过滤 */
  bypassSearch?: boolean;
  /** 点击后保持弹窗打开（生成类条目：等进度完成由宿主关闭） */
  keepOpenOnClick?: boolean;
};

export type LauncherViewMode = "grid" | "list";

type Props = {
  open: boolean;
  onClose: () => void;
  apps: LauncherApp[];
  title?: string;
  /** 「全部」分类标签（i18n 注入） */
  allLabel?: string;
  /** 空分类提示（i18n 注入） */
  emptyLabel?: string;
  /** 搜索占位（i18n 注入） */
  searchPlaceholder?: string;
  /** 「显示内容为」标签（i18n 注入） */
  viewAsLabel?: string;
  /** 「网格」标签 */
  gridLabel?: string;
  /** 「列表」标签 */
  listLabel?: string;
  /** 搜索词变化上报（Gen Apps 建议由宿主处理；Launcher 保持纯展示） */
  onQueryChange?: (query: string) => void;
  /** 删除项文案 */
  removeLabel?: string;
  /** AI 请求进行中：顶部显示 macOS 光线进度条 */
  busy?: boolean;
  /** 无障碍：进度阶段描述（不显示文字，仅 aria） */
  busyAriaLabel?: string;
  /** 错误提示（生成/搜索失败时展示，避免静默无反应） */
  errorText?: string;
};

const VIEW_STORAGE_KEY = "openos.launcher.view";

function loadViewMode(): LauncherViewMode {
  if (typeof window === "undefined") return "grid";
  return window.localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "grid";
}

/**
 * 「应用程序」启动台弹窗（1:1 参考截图）：
 * - 顶部：A 标 + 大号内联搜索输入（无边框，placeholder 即标题）
 * - 右上「⋯」→「显示内容为：✓网格 / 列表」小弹窗
 * - 分类胶囊 + 网格/列表两种内容布局
 */
export function AppLauncher({
  open,
  onClose,
  apps,
  title = "Applications",
  allLabel = "All",
  emptyLabel = "No apps in this category",
  searchPlaceholder = "Applications",
  viewAsLabel = "View as",
  gridLabel = "Grid",
  listLabel = "List",
  onQueryChange,
  removeLabel = "Remove",
  busy = false,
  busyAriaLabel,
  errorText = "",
}: Props) {
  const [category, setCategory] = useState<string>(allLabel);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<LauncherViewMode>(() => loadViewMode());
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  // 最新回调走 ref：避免父组件重渲染改变回调身份导致 open 效果重跑清空输入
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;

  const categories = useMemo(() => {
    const set = new Set<string>([allLabel]);
    for (const app of apps) set.add(app.category);
    return [...set];
  }, [apps, allLabel]);

  const filtered = useMemo(() => {
    const byCategory =
      category === allLabel ? apps : apps.filter((a) => a.category === category);
    const q = query.trim().toLowerCase();
    if (!q) return byCategory;
    // bypassSearch（AI 语义候选）不做名称匹配——它们本就是按搜索词生成的
    return byCategory.filter(
      (a) => a.bypassSearch || a.name.toLowerCase().includes(q),
    );
  }, [apps, category, allLabel, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    onQueryChangeRef.current?.("");
    setViewMenuOpen(false);
    // 打开即聚焦搜索（参考 macOS 启动台）
    const timer = window.setTimeout(() => searchRef.current?.focus(), 60);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 点击面板其他区域收起视图菜单
  useEffect(() => {
    if (!viewMenuOpen) return;
    function onDocDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest(".launcher-view-menu, .launcher-more")) {
        setViewMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [viewMenuOpen]);

  function selectView(mode: LauncherViewMode) {
    setView(mode);
    setViewMenuOpen(false);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, mode);
    } catch {
      // 存储失败忽略
    }
  }

  if (!open) return null;

  return (
    <div
      className="launcher-overlay"
      onMouseDown={(event) => {
        if (!panelRef.current?.contains(event.target as Node)) onClose();
      }}
    >
      <div className="launcher-panel" ref={panelRef} role="dialog" aria-label={title}>
        <header className="launcher-header">
          {/* A 标（App Store 风格笔刷 A） */}
          <span className="launcher-mark" aria-hidden>
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <path
                d="M9 20.5 14.2 6.5c.5-1.3 2.3-1.3 2.8 0l1 2.7"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
              <path
                d="m20.5 20.5-3.4-9.2"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
              <path
                d="M6.4 15.8h10.4"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </svg>
          </span>

          {/* 大号内联搜索：placeholder 即「应用程序」，输入即过滤 */}
          <input
            ref={searchRef}
            className="launcher-inline-search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onQueryChange?.(e.target.value);
            }}
            placeholder={searchPlaceholder}
            aria-label={title}
          />

          <div className="launcher-more-wrap">
            <button
              type="button"
              className={`launcher-more ${viewMenuOpen ? "open" : ""}`}
              title={viewAsLabel}
              onClick={() => setViewMenuOpen((v) => !v)}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <circle cx="10" cy="10" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="6.2" cy="10" r="1.15" />
                <circle cx="10" cy="10" r="1.15" />
                <circle cx="13.8" cy="10" r="1.15" />
              </svg>
            </button>

            {viewMenuOpen ? (
              <div className="launcher-view-menu" role="menu">
                <div className="launcher-view-menu-title">{viewAsLabel}</div>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={view === "grid"}
                  className="launcher-view-menu-item"
                  onClick={() => selectView("grid")}
                >
                  <span className="launcher-view-check">{view === "grid" ? "✓" : ""}</span>
                  {gridLabel}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={view === "list"}
                  className="launcher-view-menu-item"
                  onClick={() => selectView("list")}
                >
                  <span className="launcher-view-check">{view === "list" ? "✓" : ""}</span>
                  {listLabel}
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {/* macOS 光线进度条：绝对定位细线，不占布局、无文字 */}
        {busy ? (
          <div
            className="launcher-progress"
            role="progressbar"
            aria-busy="true"
            aria-label={busyAriaLabel || title}
          >
            <div className="launcher-progress-glow" />
          </div>
        ) : null}

        {errorText ? (
          <div className="launcher-error" role="alert">
            {errorText}
          </div>
        ) : null}

        <div className="launcher-categories" role="tablist">
          {categories
            .filter((cat) => cat !== allLabel)
            .map((cat) => (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={category === cat}
                className={`launcher-cat ${category === cat ? "active" : ""}`}
                onClick={() =>
                  setCategory((cur) => (cur === cat ? allLabel : cat))
                }
              >
                {cat}
              </button>
            ))}
        </div>

        <div
          className={view === "grid" ? "launcher-grid" : "launcher-list"}
          role="list"
        >
          {filtered.map((app) => (
            <div
              key={app.id}
              role="listitem"
              className={`${view === "grid" ? "launcher-app" : "launcher-list-item"} launcher-item-wrap`}
              onClick={() => {
                if (!app.keepOpenOnClick) onClose();
                app.onOpen();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (!app.keepOpenOnClick) onClose();
                  app.onOpen();
                }
              }}
              tabIndex={0}
            >
              <span className="launcher-app-icon">{app.icon}</span>
              <span className="launcher-app-name">{app.name}</span>
              {view === "list" ? (
                <span className="launcher-list-category">{app.category}</span>
              ) : null}
              {app.onRemove ? (
                <button
                  type="button"
                  className="launcher-item-remove"
                  title={removeLabel}
                  aria-label={removeLabel}
                  onClick={(e) => {
                    e.stopPropagation();
                    app.onRemove?.();
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          {filtered.length === 0 ? (
            <div className="launcher-empty">{emptyLabel}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
