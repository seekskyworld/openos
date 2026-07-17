import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { BootstrapInfo, ChatMessage, LlmSettingsPublic } from "@openos/shared";
import {
  appendThreadMessage,
  createThreadApi,
  deleteThreadApi,
  fetchBootstrap,
  fetchHealth,
  listThreadMessages,
  listThreads,
  renameThreadApi,
  sendChat,
} from "./api";
import { useI18n } from "./i18n";
import { NotificationCenter } from "./notifications/NotificationCenter";
import { useNotifications } from "./notifications/useNotifications";
import { AppBadge, useAppBadges } from "./badges";
import { LaunchpadIcon } from "./icons/LaunchpadIcon";
import { SettingsGearIcon } from "./icons/SettingsGearIcon";
import { GenAppRunner } from "./gen-apps/GenAppRunner";
import {
  useGenAppWorkspace,
  type RunningGenApp,
} from "./gen-apps/useGenAppWorkspace";
import { AppLauncher, type LauncherApp } from "./launcher/AppLauncher";
import { item, MenuBar, separator, type MenuDef } from "./menubar/MenuBar";
import { SettingsApp } from "./SettingsApp";
import { SirOrb } from "./SirOrb";
import {
  DesktopWindow,
  MinimizedShelf,
  WindowScroll,
  useWindowManager,
  type WindowDefaults,
  type WindowMeta,
} from "./window";

type UiMessage = ChatMessage & { id: string };
type AppId = "sir" | "settings";

type SirThread = {
  id: string;
  title: string;
  updatedAt: number;
  messages: UiMessage[];
};

const SUGGESTION_KEYS = [
  "sir.suggest.desktop",
  "sir.suggest.summarize",
  "sir.suggest.write",
  "sir.suggest.model",
];

function welcomeMessage(content: string): UiMessage {
  return { id: "welcome", role: "assistant", content };
}

const WINDOW_DEFAULTS: WindowDefaults[] = [
  {
    id: "sir",
    open: true,
    z: 2,
    x: 64,
    y: 28,
    w: 920,
    h: 600,
    title: "Sir",
    previewTheme: "sir",
  },
  {
    id: "settings",
    open: false,
    z: 1,
    x: 160,
    y: 56,
    w: 820,
    h: 600,
    title: "System Settings",
    previewTheme: "settings",
  },
];

// 窗口元数据的标题在组件内经 t() 本地化（见 windowMeta）

function formatMenubarClock(date: Date, locale: string) {
  if (locale.startsWith("zh")) {
    // 中文样式：7月17日 周五 21:28（同 macOS 中文菜单栏）
    const md = `${date.getMonth() + 1}月${date.getDate()}日`;
    const wd = date.toLocaleDateString("zh-CN", { weekday: "short" });
    const hm = date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${md} ${wd} ${hm}`;
  }
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function threadTitleFromMessages(messages: UiMessage[]) {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "New Chat";
  const text = firstUser.content.trim().replace(/\s+/g, " ");
  return text.length > 28 ? `${text.slice(0, 28)}…` : text;
}

export function App() {
  const { t, locale } = useI18n();
  const wm = useWindowManager(WINDOW_DEFAULTS);
  const appBadges = useAppBadges();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [notifCenterOpen, setNotifCenterOpen] = useState(false);
  // Gen Apps 工作区：搜索建议 / 生成 / 草稿安装 / 已装管理
  const genApps = useGenAppWorkspace({
    openWindow: (app: RunningGenApp) => {
      wm.openDynamic({
        id: app.windowId,
        x: 120 + Math.floor(Math.random() * 80),
        y: 60 + Math.floor(Math.random() * 60),
        w: 560,
        h: 520,
        title: app.name,
        previewTheme: "genapp",
      });
      setLauncherOpen(false);
    },
    closeWindow: (windowId: string) => {
      wm.close(windowId);
      wm.unregister(windowId);
    },
  });
  const notifications = useNotifications();
  const [bootstrap, setBootstrap] = useState<BootstrapInfo | null>(null);
  const [healthOk, setHealthOk] = useState(false);
  const [status, setStatus] = useState(() => "…");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [threads, setThreads] = useState<SirThread[]>(() => [
    {
      id: "t-welcome",
      title: "Welcome",
      updatedAt: Date.now(),
      messages: [welcomeMessage(t("sir.welcome"))],
    },
  ]);
  const [activeThreadId, setActiveThreadId] = useState("t-welcome");
  // 窗口元数据（标题本地化）
  const windowMeta: Record<string, WindowMeta> = {
    sir: {
      id: "sir",
      title: t("window.title.sir"),
      icon: "sir",
      previewTheme: "sir",
    },
    settings: {
      id: "settings",
      title: t("window.title.settings"),
      icon: "settings",
      previewTheme: "settings",
    },
  };
  /** 侧栏「⋯」小弹窗对应的会话 id（null=收起） */
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const activeThread = useMemo(
    () => threads.find((th) => th.id === activeThreadId) ?? threads[0],
    [threads, activeThreadId],
  );
  const messages = activeThread?.messages ?? [welcomeMessage(t("sir.welcome"))];
  const showEmptyHero =
    messages.length <= 1 &&
    (messages[0]?.id === "welcome" || messages[0]?.id.startsWith("welcome-"));

  const refreshBootstrap = useCallback(async () => {
    const [health, boot] = await Promise.all([fetchHealth(), fetchBootstrap()]);
    setHealthOk(health.ok);
    setBootstrap(boot);
    setStatus(
      health.ok
        ? `${boot.llm.provider}/${boot.llm.configured ? boot.llm.model : "mock"}`
        : t("status.offline"),
    );
    return boot;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshBootstrap();
      } catch (error) {
        if (cancelled) return;
        setHealthOk(false);
        setStatus(error instanceof Error ? error.message : t("status.connectionFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshBootstrap]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // 启动时从 SQLite 加载持久化会话与消息
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { threads: rows } = await listThreads();
        if (cancelled || rows.length === 0) return;
        const loaded: SirThread[] = await Promise.all(
          rows.map(async (row) => {
            const { messages: msgs } = await listThreadMessages(row.id);
            return {
              id: row.id,
              title: row.title,
              updatedAt: row.updatedAt,
              messages: msgs.length
                ? msgs.map((m) => ({ id: m.id, role: m.role, content: m.content }))
                : [welcomeMessage(t("sir.welcome"))],
            };
          }),
        );
        if (cancelled) return;
        setThreads(loaded);
        setActiveThreadId(loaded[0].id);
      } catch {
        // bridge 未起时保留本地默认会话
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 点击其他区域收起会话菜单
  useEffect(() => {
    if (!threadMenuId) return;
    function onDocDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest(".sir-thread-menu, .sir-thread-more")) {
        setThreadMenuId(null);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [threadMenuId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, activeThreadId]);

  const clockLabel = useMemo(() => formatMenubarClock(now, locale), [now, locale]);

  function openApp(id: AppId) {
    wm.open(id);
    // 打开应用即视为已读，清除角标
    appBadges.clearBadge(id);
  }

  function startNewChat() {
    const id = `t-${Date.now()}`;
    const thread: SirThread = {
      id,
      title: t("sir.newChat"),
      updatedAt: Date.now(),
      messages: [
        {
          id: `welcome-${id}`,
          role: "assistant",
          content: t("sir.newConversation"),
        },
      ],
    };
    setThreads((prev) => [thread, ...prev]);
    setActiveThreadId(id);
    setInput("");
    // 持久化新会话（失败静默，发消息时会自动补建）
    void createThreadApi({ id, title: thread.title }).catch(() => {});
  }

  function deleteThread(threadId: string) {
    setThreadMenuId(null);
    setThreads((prev) => {
      const next = prev.filter((th) => th.id !== threadId);
      if (next.length === 0) {
        const id = `t-${Date.now()}`;
        const fallback: SirThread = {
          id,
          title: t("sir.newChat"),
          updatedAt: Date.now(),
          messages: [
            {
              id: `welcome-${id}`,
              role: "assistant",
              content: t("sir.newConversation"),
            },
          ],
        };
        setActiveThreadId(id);
        void createThreadApi({ id, title: fallback.title }).catch(() => {});
        return [fallback];
      }
      setActiveThreadId((current) => (current === threadId ? next[0].id : current));
      return next;
    });
    void deleteThreadApi(threadId).catch(() => {});
  }

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !activeThread) return;

    const userMessage: UiMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    const nextMessages = [...activeThread.messages, userMessage];
    const threadId = activeThread.id;

    const defaultTitles = new Set([t("sir.newChat"), "New Chat", "Welcome"]);
    const isDefaultTitle = defaultTitles.has(activeThread.title);
    const nextTitle = isDefaultTitle
      ? threadTitleFromMessages(nextMessages)
      : activeThread.title;
    setThreads((prev) =>
      prev.map((th) =>
        th.id === threadId
          ? {
              ...th,
              title: nextTitle,
              updatedAt: Date.now(),
              messages: nextMessages,
            }
          : th,
      ),
    );
    setInput("");
    setBusy(true);

    // 持久化用户消息 + 标题（失败静默，不阻断聊天）
    void appendThreadMessage(threadId, {
      id: userMessage.id,
      role: "user",
      content: userMessage.content,
    }).catch(() => {});
    if (isDefaultTitle) {
      void renameThreadApi(threadId, nextTitle).catch(() => {});
    }

    try {
      const payload = nextMessages
        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
        .map(({ role, content }) => ({ role, content }));
      const result = await sendChat(payload);
      setThreads((prev) =>
        prev.map((th) =>
          th.id === threadId
            ? {
                ...th,
                updatedAt: Date.now(),
                messages: [
                  ...th.messages,
                  {
                    id: result.id,
                    role: "assistant",
                    content: result.content,
                  },
                ],
              }
            : th,
        ),
      );
      setStatus(`${result.provider}/${result.model}`);
      // 持久化助手回复
      void appendThreadMessage(threadId, {
        id: result.id,
        role: "assistant",
        content: result.content,
      }).catch(() => {});
      // Sir 窗口最小化/未聚焦时收到回复 → 角标 +1（打开即清）+ 通知中心投递
      const sirWin = wm.windows.sir;
      if (sirWin?.minimized || wm.focusedId !== "sir") {
        appBadges.bumpBadge("sir");
        notifications.post(
          "sir",
          t("nc.sir.replyTitle"),
          result.content.slice(0, 80),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setThreads((prev) =>
        prev.map((th) =>
          th.id === threadId
            ? {
                ...th,
                messages: [
                  ...th.messages,
                  {
                    id: `err-${Date.now()}`,
                    role: "assistant",
                    content: t("sir.callFailed", { message }),
                  },
                ],
              }
            : th,
        ),
      );
      setStatus(message);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await sendText(input);
  }

  async function onSettingsSaved(settings: LlmSettingsPublic) {
    setStatus(`${settings.provider}/${settings.model}`);
    try {
      await refreshBootstrap();
    } catch {
      // ignore bootstrap refresh failure after successful save
    }
  }

  const sirRunning = wm.isRunning("sir");
  const settingsRunning = wm.isRunning("settings");
  const showDesktop = wm.showDesktop;
  const focusedApp: AppId | null =
    wm.focusedId === "sir" || wm.focusedId === "settings" ? wm.focusedId : null;
  const appMenuTitle = showDesktop
    ? t("menubar.finder")
    : focusedApp === "settings"
      ? t("window.title.settings")
      : focusedApp === "sir"
        ? t("window.title.sir")
        : t("menubar.openos");

  function onWallpaperClick(event: ReactMouseEvent) {
    // Launcher / 通知中心打开时：点空白只收起浮层，不触发显示桌面
    if (launcherOpen) return;
    if (notifCenterOpen) return;
    // 仅空白壁纸/舞台：切换「显示桌面」
    const target = event.target as HTMLElement;
    if (target.closest(".window, .dock, .menubar, .launcher-overlay, button, a, input")) {
      return;
    }
    wm.toggleShowDesktop();
  }

  // ===== 启动台应用清单：内置 + 已安装 Gen Apps + AI 候选（混排） =====
  const launcherApps: LauncherApp[] = [
    // 已安装 Gen Apps（带 AI 角标）
    ...genApps.view.installed.map((app) => ({
      id: `gen-${app.id}`,
      name: app.name,
      category: t("launcher.category.ai"),
      icon: (
        <span className={`genapp-icon theme-${app.iconTheme}`}>
          {app.iconEmoji}
          <i className="genapp-ai-badge">AI</i>
        </span>
      ),
      onOpen: () => void genApps.activateInstalled(app.id),
      onRemove: () => void genApps.remove(app.id),
    })),
    {
      id: "sir",
      name: t("dock.sir"),
      category: t("launcher.category.ai"),
      icon: <SirOrb size={44} calm />,
      onOpen: () => openApp("sir"),
    },
    {
      id: "settings",
      name: t("dock.settings"),
      category: t("launcher.category.system"),
      icon: <SettingsGearIcon size={44} className="launcher-icon-svg" />,
      onOpen: () => openApp("settings"),
    },
    // 搜索候选（虚线框 + loading 态）
    ...genApps.view.suggestions.map((s) => ({
      id: `suggestion-${s.id}`,
      name: s.name,
      category: t("launcher.category.ai"),
      bypassSearch: true,
      keepOpenOnClick: true,
      icon: (
        <span
          className={`genapp-icon suggestion theme-${s.iconTheme} ${genApps.view.pendingSuggestionId === s.id ? "loading" : ""}`}
        >
          {genApps.view.pendingSuggestionId === s.id ? (
            <i className="genapp-spinner" />
          ) : (
            s.iconEmoji
          )}
          <i className="genapp-ai-badge">AI</i>
        </span>
      ),
      onOpen: () => void genApps.activateSuggestion(s),
    })),
  ];

  // ===== 菜单定义：系统菜单固定 + 应用菜单随聚焦窗口变化（仿 macOS） =====
  const focusedWin = focusedApp ? wm.windows[focusedApp] : undefined;

  const menus: MenuDef[] = [
    {
      id: "apple",
      title: "\uF8FF",
      isApple: true,
      entries: [
        item(t("menubar.aboutOpenOS"), () =>
          setStatus(t("menubar.about.version", { version: bootstrap?.version ?? "0.1.0", channel: bootstrap?.channel ?? "dev" })),
        ),
        separator,
        item(t("menubar.systemSettings"), () => openApp("settings")),
        separator,
        item(t("menubar.showDesktop"), () => wm.toggleShowDesktop(), { checked: showDesktop }),
        separator,
        item(t("menubar.lockScreen"), undefined, { disabled: true, shortcut: "\u2303\u2318Q" }),
        item(t("menubar.logOut"), undefined, { disabled: true }),
      ],
    },
    {
      id: "app",
      title: appMenuTitle,
      bold: true,
      entries:
        focusedApp === "sir"
          ? [
              item(t("menubar.aboutSir"), () => setStatus(t("menubar.aboutSir.status"))),
              separator,
              item(t("menubar.newChat"), startNewChat, { shortcut: "\u2318N" }),
              separator,
              item(t("menubar.hideSir"), () => wm.minimize("sir"), { shortcut: "\u2318H" }),
              item(t("menubar.quitSir"), () => wm.close("sir"), { shortcut: "\u2318Q" }),
            ]
          : focusedApp === "settings"
            ? [
                item(t("menubar.aboutSettings"), () =>
                  setStatus(t("menubar.aboutSettings.status")),
                ),
                separator,
                item(t("menubar.hideSettings"), () => wm.minimize("settings"), {
                  shortcut: "\u2318H",
                }),
                item(t("menubar.quitSettings"), () => wm.close("settings"), {
                  shortcut: "\u2318Q",
                }),
              ]
            : [
                item(t("menubar.aboutOpenOS"), () =>
                  setStatus(t("menubar.aboutOpenOS.status", { channel: bootstrap?.channel ?? "dev" })),
                ),
                separator,
                item(t("menubar.openSir"), () => openApp("sir")),
                item(t("menubar.systemSettings"), () => openApp("settings")),
              ],
    },
    {
      id: "file",
      title: t("menubar.file"),
      entries:
        focusedApp === "sir"
          ? [
              item(t("menubar.newChat"), startNewChat, { shortcut: "\u2318N" }),
              separator,
              item(t("menubar.closeWindow"), () => wm.close("sir"), { shortcut: "\u2318W" }),
            ]
          : focusedApp === "settings"
            ? [item(t("menubar.closeWindow"), () => wm.close("settings"), { shortcut: "\u2318W" })]
            : [
                item(t("menubar.newSirChat"), () => {
                  openApp("sir");
                  startNewChat();
                }),
              ],
    },
    {
      id: "edit",
      title: t("menubar.edit"),
      entries: [
        item(t("menubar.undo"), undefined, { disabled: true, shortcut: "\u2318Z" }),
        item(t("menubar.redo"), undefined, { disabled: true, shortcut: "\u21E7\u2318Z" }),
        separator,
        item(t("menubar.cut"), () => document.execCommand("cut"), { shortcut: "\u2318X" }),
        item(t("menubar.copy"), () => document.execCommand("copy"), { shortcut: "\u2318C" }),
        item(t("menubar.paste"), undefined, { disabled: true, shortcut: "\u2318V" }),
        item(t("menubar.selectAll"), () => document.execCommand("selectAll"), { shortcut: "\u2318A" }),
      ],
    },
    {
      id: "view",
      title: t("menubar.view"),
      entries: [
        item(t("menubar.showDesktop"), () => wm.toggleShowDesktop(), {
          checked: showDesktop,
          shortcut: "F11",
        }),
        separator,
        item(
          focusedWin?.maximized ? t("menubar.exitFullScreen") : t("menubar.enterFullScreen"),
          focusedApp ? () => wm.toggleMaximize(focusedApp) : undefined,
          { disabled: !focusedApp, shortcut: "\u2303\u2318F" },
        ),
      ],
    },
    {
      id: "window",
      title: t("menubar.window"),
      entries: [
        item(t("menubar.minimize"), focusedApp ? () => wm.minimize(focusedApp) : undefined, {
          disabled: !focusedApp || !focusedWin?.open,
          shortcut: "\u2318M",
        }),
        item(t("menubar.zoom"), focusedApp ? () => wm.toggleMaximize(focusedApp) : undefined, {
          disabled: !focusedApp,
          checked: Boolean(focusedWin?.maximized),
        }),
        separator,
        item(t("menubar.sir"), () => openApp("sir"), { checked: focusedApp === "sir" && sirRunning }),
        item(t("menubar.settingsWindow"), () => openApp("settings"), {
          checked: focusedApp === "settings" && settingsRunning,
        }),
      ],
    },
    {
      id: "help",
      title: t("menubar.help"),
      entries: [
        item(t("menubar.openosHelp"), () =>
          setStatus(t("menubar.openosHelp.status")),
        ),
        separator,
        item(t("menubar.readme"), () => setStatus(t("menubar.readme.status"))),
      ],
    },
  ];

  return (
    <div
      className={`desktop ${showDesktop ? "show-desktop-mode" : ""}`}
      onMouseDown={onWallpaperClick}
    >
      <div className="desktop-wallpaper" aria-hidden>
        <span className="wallpaper-ribbon r1" />
        <span className="wallpaper-ribbon r2" />
        <span className="wallpaper-ribbon r3" />
      </div>

      {/* 显示桌面时的边框/暗角特殊展示 */}
      <div className="desktop-reveal-frame" aria-hidden />
      <div className="desktop-reveal-vignette" aria-hidden />

      <MenuBar
        menus={menus}
        trailing={
          <>
            <div className="menubar-status" title={status}>
              <span className={`status-dot ${healthOk ? "ok" : ""}`} />
              <span>{bootstrap?.channel ?? "\u2026"}</span>
            </div>
            <button
              type="button"
              className={`menubar-status menubar-clock ${notifCenterOpen ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setNotifCenterOpen((v) => !v);
              }}
            >
              {clockLabel}
            </button>
          </>
        }
      />

      <main className="stage">
        <DesktopWindow
          id="sir"
          title={t("window.title.sir")}
          className="sir-window"
          manager={wm}
          scroll="none"
        >
          <div className="sir-shell">
            <aside className="sir-sidebar">
              <button type="button" className="sir-new-chat" onClick={startNewChat}>
                <span className="sir-new-plus">+</span>
                {t("sir.newChat")}
              </button>
              <div className="sir-sidebar-label">{t("sir.recents")}</div>
              <WindowScroll className="sir-thread-list" axis="y">
                {threads.map((thread) => (
                  <div
                    key={thread.id}
                    className={`sir-thread ${thread.id === activeThreadId ? "active" : ""}`}
                    onClick={() => setActiveThreadId(thread.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setActiveThreadId(thread.id);
                    }}
                  >
                    <span className="sir-thread-title">{thread.title}</span>
                    <button
                      type="button"
                      className="sir-thread-more"
                      title="More"
                      aria-label="Thread options"
                      onClick={(e) => {
                        e.stopPropagation();
                        setThreadMenuId((cur) => (cur === thread.id ? null : thread.id));
                      }}
                    >
                      ⋯
                    </button>
                    {threadMenuId === thread.id ? (
                      <div className="sir-thread-menu" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="sir-thread-menu-item danger"
                          onClick={() => deleteThread(thread.id)}
                        >
                          {t("sir.deleteChat")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </WindowScroll>
              <div className="sir-sidebar-footer">
                <div className="sir-model-pill" title={status}>
                  <span className={`status-dot ${healthOk ? "ok" : ""}`} />
                  <span>
                    {bootstrap?.llm.configured
                      ? bootstrap.llm.model
                      : bootstrap?.llm.provider
                        ? `${bootstrap.llm.provider} · mock`
                        : t("sir.connecting")}
                  </span>
                </div>
              </div>
            </aside>

            <div className="sir-main">
              <WindowScroll className="sir-chat" axis="y">
                {showEmptyHero ? (
                  <div className="sir-hero">
                    <SirOrb size="hero" active={!busy} />
                    <h1>{t("sir.title")}</h1>
                    <p>{t("sir.hero.subtitle")}</p>
                    <div className="sir-suggestions">
                      {SUGGESTION_KEYS.map((key) => {
                        const label = t(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            className="sir-chip"
                            disabled={busy}
                            onClick={() => void sendText(label)}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="sir-messages">
                    {messages.map((message) =>
                      message.role === "user" ? (
                        // 用户消息：气泡在左、头像在右，整体靠右
                        <div key={message.id} className="sir-msg user">
                          <div className="sir-bubble">
                            <p>{message.content}</p>
                          </div>
                          <div className="sir-avatar user" aria-hidden>
                            {t("sir.you")}
                          </div>
                        </div>
                      ) : (
                        <div
                          key={message.id}
                          className={`sir-msg ${message.role}`}
                        >
                          <div className="sir-avatar" aria-hidden>
                            <SirOrb size="avatar" calm />
                          </div>
                          <div className="sir-bubble">
                            <p>{message.content}</p>
                          </div>
                        </div>
                      ),
                    )}
                    {busy ? (
                      <div className="sir-msg assistant">
                        <div className="sir-avatar" aria-hidden>
                          <SirOrb size="avatar" active />
                        </div>
                        <div className="sir-bubble typing">
                          <span />
                          <span />
                          <span />
                        </div>
                      </div>
                    ) : null}
                    <div ref={chatEndRef} />
                  </div>
                )}
              </WindowScroll>

              <form className="sir-composer" onSubmit={onSubmit}>
                <div className="sir-composer-shell">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={t("sir.composer.placeholder")}
                    disabled={busy}
                    aria-label="Ask Sir"
                  />
                  <button
                    type="submit"
                    className="sir-send"
                    disabled={busy || !input.trim()}
                    aria-label="Send"
                  >
                    ↑
                  </button>
                </div>
                <div className="sir-composer-hint">
                  {t("sir.composer.hint")}
                </div>
              </form>
            </div>
          </div>
        </DesktopWindow>

        <DesktopWindow
          id="settings"
          title={t("window.title.settings")}
          className="settings-window"
          manager={wm}
          scroll="y"
          bodyClassName="settings-window-content"
        >
          <SettingsApp onSaved={onSettingsSaved} />
        </DesktopWindow>

        {/* Gen Apps 运行窗口（草稿关闭→安装；已装关闭→直接关） */}
        {genApps.view.running.map((app) => (
          <GenAppRunner
            key={app.windowId}
            app={app}
            manager={wm}
            onRequestClose={(windowId) => void genApps.requestClose(windowId)}
            meta={
              genApps.view.phase === "installing"
                ? t("genapps.installing")
                : app.mode === "draft"
                  ? t("genapps.draftHint")
                  : undefined
            }
          />
        ))}
      </main>

      <div className="dock-wrap">
        <footer className="dock" ref={wm.setDockAnchor}>
          <button
            type="button"
            className={`dock-item ${launcherOpen ? "active" : ""}`}
            onClick={() => setLauncherOpen((v) => !v)}
          >
            <span className="dock-tooltip">{t("dock.launchpad")}</span>
            <LaunchpadIcon size={48} className="dock-icon-svg" />
          </button>
          <button
            type="button"
            className={`dock-item ${sirRunning ? "active" : ""}`}
            onClick={() => openApp("sir")}
          >
            <span className="dock-tooltip">{t("dock.sir")}</span>
            <span className="dock-icon sir dock-icon-orb" aria-hidden>
              <SirOrb size="dock" active={sirRunning && !wm.windows.sir?.minimized} />
            </span>
            <AppBadge count={appBadges.getBadge("sir")} />
          </button>
          <button
            type="button"
            className={`dock-item ${settingsRunning ? "active" : ""}`}
            onClick={() => openApp("settings")}
          >
            <span className="dock-tooltip">{t("dock.settings")}</span>
            <SettingsGearIcon size={48} className="dock-icon-svg" />
            <AppBadge count={appBadges.getBadge("settings")} />
          </button>
          {/* macOS 风格：分隔线右侧为最小化窗口缩略图抽屉 */}
          <MinimizedShelf manager={wm} metaById={windowMeta} />
        </footer>
      </div>

      <AppLauncher
        open={launcherOpen}
        onClose={() => setLauncherOpen(false)}
        apps={launcherApps}
        title={t("launcher.title")}
        allLabel={t("launcher.all")}
        emptyLabel={t("launcher.empty")}
        searchPlaceholder={t("launcher.title")}
        viewAsLabel={t("launcher.viewAs")}
        gridLabel={t("launcher.view.grid")}
        listLabel={t("launcher.view.list")}
        onQueryChange={genApps.search}
        removeLabel={t("genapps.remove")}
        busy={
          genApps.view.phase === "suggesting" ||
          genApps.view.phase === "generating" ||
          genApps.view.phase === "installing"
        }
        busyAriaLabel={
          genApps.view.phase === "generating"
            ? genApps.view.agentPhase
              ? `${t("genapps.busy.generating")} (${genApps.view.agentPhase})`
              : t("genapps.busy.generating")
            : genApps.view.phase === "suggesting"
              ? t("genapps.busy.suggesting")
              : genApps.view.phase === "installing"
                ? t("genapps.installing")
                : undefined
        }
        errorText={
          genApps.view.phase === "error" && genApps.view.error
            ? `${t("genapps.error.prefix")}${genApps.view.error.message}`
            : ""
        }
      />

      <NotificationCenter
        open={notifCenterOpen}
        onClose={() => setNotifCenterOpen(false)}
        notifications={notifications}
        iconFor={(appId) =>
          appId === "sir" ? (
            <SirOrb size="badge" calm />
          ) : appId === "settings" ? (
            <SettingsGearIcon size={28} />
          ) : (
            "🔔"
          )
        }
      />
    </div>
  );
}
