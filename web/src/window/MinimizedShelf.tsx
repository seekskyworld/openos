import { SirOrb } from "../SirOrb";
import type { WindowMeta, WindowState } from "./types";
import type { WindowManager } from "./useWindowManager";

type Props = {
  manager: WindowManager;
  metaById: Record<string, WindowMeta>;
};

/**
 * macOS Dock 右侧最小化区：窗口缩略图 + 右下角应用图标角标。
 * 参考：最小化窗口以 miniature 形式出现在 Dock 分隔线右侧。
 */
export function MinimizedShelf({ manager, metaById }: Props) {
  const items = manager.minimizedWindows;
  if (!items.length) return null;

  return (
    <>
      <div className="dock-sep dock-sep-shelf" aria-hidden />
      <div className="dock-minimized-shelf" role="list" aria-label="Minimized windows">
        {items.map((win) => {
          const meta = metaById[win.id];
          return (
            <MinimizedThumb
              key={win.id}
              win={win}
              meta={meta}
              onRestore={() => manager.open(win.id)}
            />
          );
        })}
      </div>
    </>
  );
}

function MinimizedThumb({
  win,
  meta,
  onRestore,
}: {
  win: WindowState;
  meta?: WindowMeta;
  onRestore: () => void;
}) {
  const title = meta?.title ?? win.title ?? win.id;
  const theme = meta?.previewTheme ?? win.previewTheme ?? win.id;
  const icon = meta?.icon ?? "generic";

  return (
    <button
      type="button"
      className="dock-min-thumb"
      role="listitem"
      title={title}
      data-min-thumb={win.id}
      onClick={onRestore}
    >
      <span className="dock-tooltip">{title}</span>
      <span className={`dock-min-preview theme-${theme}`} aria-hidden>
        <span className="dock-min-preview-chrome">
          <i />
          <i />
          <i />
        </span>
        <span className="dock-min-preview-body" />
      </span>
      <span className={`dock-min-app-badge icon-${icon}`} aria-hidden>
        {icon === "sir" ? <SirOrb size="badge" calm /> : null}
        {icon === "settings" ? <span className="settings-glyph tiny" /> : null}
        {icon === "files" ? "Fi" : null}
        {icon === "generic" ? "•" : null}
      </span>
    </button>
  );
}
