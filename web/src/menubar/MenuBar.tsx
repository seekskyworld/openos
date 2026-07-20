import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type MenuAction = () => void;

export type MenuEntry =
  | { kind: "item"; label: string; shortcut?: string; disabled?: boolean; checked?: boolean; action?: MenuAction }
  | { kind: "separator" };

export type MenuDef = {
  id: string;
  /** 菜单标题；apple 菜单用  */
  title: ReactNode;
  bold?: boolean;
  isApple?: boolean;
  entries: MenuEntry[];
};

type Props = {
  menus: MenuDef[];
  /** 右侧状态区 */
  trailing?: ReactNode;
};

export function item(
  label: string,
  action?: MenuAction,
  opts: { shortcut?: string; disabled?: boolean; checked?: boolean } = {},
): MenuEntry {
  return { kind: "item", label, action, ...opts };
}

export const separator: MenuEntry = { kind: "separator" };

/**
 * macOS 风格菜单栏：
 * - 点击标题展开下拉；展开后悬停其他标题即切换（macOS 行为）
 * - 点击条目执行 action 并收起；Esc / 点击外部收起
 * - 菜单内容由调用方按聚焦应用动态传入
 */
export function MenuBar({ menus, trailing }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);

  const closeAll = useCallback(() => setOpenId(null), []);

  useEffect(() => {
    if (!openId) return;
    function onDocDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closeAll();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeAll();
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId, closeAll]);

  return (
    <header className="menubar" ref={rootRef}>
      <div className="menubar-left">
        {menus.map((menu) => {
          const opened = openId === menu.id;
          return (
            <div key={menu.id} className="menubar-menu">
              <button
                type="button"
                className={[
                  "menubar-item",
                  menu.bold ? "bold" : "",
                  menu.isApple ? "menubar-apple" : "",
                  opened ? "open" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setOpenId(opened ? null : menu.id);
                }}
                onMouseEnter={() => {
                  // macOS：已有菜单展开时，滑过即切换
                  if (openId && openId !== menu.id) setOpenId(menu.id);
                }}
              >
                {menu.title}
              </button>

              {opened ? (
                <div className="menubar-dropdown" role="menu">
                  {menu.entries.map((entry, index) =>
                    entry.kind === "separator" ? (
                      <div key={`sep-${index}`} className="menubar-dropdown-sep" />
                    ) : (
                      <button
                        key={entry.label}
                        type="button"
                        role="menuitem"
                        className="menubar-dropdown-item"
                        disabled={entry.disabled}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          if (entry.disabled) return;
                          closeAll();
                          entry.action?.();
                        }}
                      >
                        <span className="menubar-dropdown-check">
                          {entry.checked ? "✓" : ""}
                        </span>
                        <span className="menubar-dropdown-label">{entry.label}</span>
                        {entry.shortcut ? (
                          <span className="menubar-dropdown-shortcut">{entry.shortcut}</span>
                        ) : null}
                      </button>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="menubar-right">{trailing}</div>
    </header>
  );
}
