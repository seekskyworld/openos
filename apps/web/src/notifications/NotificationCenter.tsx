import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import type { Notifications, OsNotification } from "./useNotifications";

type Props = {
  open: boolean;
  onClose: () => void;
  notifications: Notifications;
  /** appId → 图标渲染（由宿主注入，保持解耦） */
  iconFor?: (appId: string) => ReactNode;
};

/** 世界时钟组件城市（参考截图：库比提诺/东京/悉尼/巴黎） */
const WORLD_CLOCKS = [
  { key: "cupertino", tz: "America/Los_Angeles" },
  { key: "tokyo", tz: "Asia/Tokyo" },
  { key: "sydney", tz: "Australia/Sydney" },
  { key: "paris", tz: "Europe/Paris" },
];

function tzOffsetHours(tz: string, now: Date): number {
  // 与本地时差（小时，可为小数）
  const local = new Date(now.toLocaleString("en-US"));
  const remote = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  return Math.round(((remote.getTime() - local.getTime()) / 3_600_000) * 2) / 2;
}

function tzTimeParts(tz: string, now: Date): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { h: get("hour") % 12, m: get("minute"), s: get("second") };
}

function AnalogClock({ tz, now }: { tz: string; now: Date }) {
  const { h, m } = tzTimeParts(tz, now);
  const hourDeg = h * 30 + m * 0.5;
  const minDeg = m * 6;
  // 深色/浅色表盘：夜间(18-6点)黑盘白针，白天白盘黑针（同 macOS 世界时钟）
  const hour24 = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  const night = hour24 >= 18 || hour24 < 6;

  return (
    <svg viewBox="0 0 100 100" className={`nc-clock ${night ? "night" : "day"}`}>
      <circle cx="50" cy="50" r="48" className="nc-clock-face" />
      {Array.from({ length: 12 }, (_, i) => {
        const angle = ((i + 1) * 30 * Math.PI) / 180;
        const x = 50 + 38 * Math.sin(angle);
        const y = 50 - 38 * Math.cos(angle);
        return (
          <text key={i} x={x} y={y + 4} textAnchor="middle" className="nc-clock-num">
            {i + 1}
          </text>
        );
      })}
      <line
        x1="50"
        y1="50"
        x2={50 + 20 * Math.sin((hourDeg * Math.PI) / 180)}
        y2={50 - 20 * Math.cos((hourDeg * Math.PI) / 180)}
        className="nc-hand-hour"
      />
      <line
        x1="50"
        y1="50"
        x2={50 + 32 * Math.sin((minDeg * Math.PI) / 180)}
        y2={50 - 32 * Math.cos((minDeg * Math.PI) / 180)}
        className="nc-hand-min"
      />
      {/* 秒针（橙色，同截图） */}
      <line
        x1="50"
        y1="56"
        x2={50 + 36 * Math.sin((tzTimeParts(tz, now).s * 6 * Math.PI) / 180)}
        y2={50 - 36 * Math.cos((tzTimeParts(tz, now).s * 6 * Math.PI) / 180)}
        className="nc-hand-sec"
      />
      <circle cx="50" cy="50" r="2.4" className="nc-hand-cap" />
    </svg>
  );
}

function timeAgo(ts: number, t: (k: string, v?: Record<string, string | number>) => string) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t("nc.justNow");
  if (min < 60) return t("nc.minutesAgo", { n: min });
  const hours = Math.floor(min / 60);
  if (hours < 24) return t("nc.hoursAgo", { n: hours });
  return t("nc.daysAgo", { n: Math.floor(hours / 24) });
}

/**
 * 通知中心（1:1 参考截图）：
 * 点击菜单栏时间 → 右侧滑出面板：
 * 通知卡片（图标+标题+正文+时间）→「通知中心」标题 + ✕ → 深色世界时钟小组件 → 编辑小组件
 */
export function NotificationCenter({ open, onClose, notifications, iconFor }: Props) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement | null>(null);
  // 每秒走针（面板打开期间）
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onDown(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (
        !panelRef.current?.contains(event.target as Node) &&
        !target.closest(".menubar-clock")
      ) {
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const [latest, ...rest] = notifications.items;

  const renderCard = (n: OsNotification, stacked = false) => (
    <div key={n.id} className={`nc-card ${stacked ? "stacked" : ""}`}>
      <span className="nc-card-icon">{iconFor?.(n.appId) ?? "🔔"}</span>
      <div className="nc-card-text">
        <div className="nc-card-title-row">
          <strong>{n.title}</strong>
          <span className="nc-card-time">{timeAgo(n.createdAt, t)}</span>
        </div>
        <p>{n.body}</p>
      </div>
      <button
        type="button"
        className="nc-card-dismiss"
        aria-label={t("common.close")}
        onClick={() => notifications.dismiss(n.id)}
      >
        ×
      </button>
    </div>
  );

  return (
    <div className="nc-overlay">
      <aside className="nc-panel" ref={panelRef} role="dialog" aria-label={t("nc.title")}>
        {/* 顶部最新通知（独立浮卡，同截图第一张） */}
        {latest ? renderCard(latest) : null}

        {/* 「通知中心」标题 + 圆形 ✕ 清除全部 */}
        <div className="nc-section-head">
          <h3>{t("nc.title")}</h3>
          {rest.length > 0 || latest ? (
            <button
              type="button"
              className="nc-clear"
              title={t("nc.clearAll")}
              onClick={() => notifications.clearAll()}
            >
              ×
            </button>
          ) : null}
        </div>

        {/* 其余通知堆叠 */}
        {rest.length > 0 ? (
          <div className="nc-stack">{rest.map((n) => renderCard(n, true))}</div>
        ) : latest ? null : (
          <div className="nc-empty">{t("nc.empty")}</div>
        )}

        {/* 深色世界时钟小组件（同截图） */}
        <div className="nc-widget">
          {WORLD_CLOCKS.map((c) => {
            const offset = tzOffsetHours(c.tz, now);
            const label =
              offset === 0
                ? t("nc.today")
                : offset > 0
                  ? `+${offset}${t("nc.hoursSuffix")}`
                  : `${offset}${t("nc.hoursSuffix")}`;
            return (
              <div key={c.key} className="nc-widget-clock">
                <AnalogClock tz={c.tz} now={now} />
                <span className="nc-city">{t(`nc.city.${c.key}`)}</span>
                <span className="nc-city-sub">{t("nc.today")}</span>
                <span className="nc-city-sub">{label}</span>
              </div>
            );
          })}
        </div>

        {/* 底部：编辑小组件（占位）+ ✕ 收起 */}
        <div className="nc-footer">
          <button type="button" className="nc-edit-widgets" disabled>
            {t("nc.editWidgets")}
          </button>
          <button
            type="button"
            className="nc-footer-close"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </aside>
    </div>
  );
}
