import { useCallback, useEffect, useState } from "react";

/**
 * 通知中心数据层（解耦模块）：
 * 任意应用 post() 投递通知，NotificationCenter 渲染；localStorage 持久化。
 */
export type OsNotification = {
  id: string;
  /** 应用标识：决定图标（sir / settings / system…） */
  appId: string;
  title: string;
  body: string;
  createdAt: number;
};

const STORAGE_KEY = "openos.notifications";
const MAX_KEEP = 50;

function load(): OsNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as OsNotification[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_KEEP) : [];
  } catch {
    return [];
  }
}

export function useNotifications() {
  const [items, setItems] = useState<OsNotification[]>(() => load());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_KEEP)));
    } catch {
      // 存储失败忽略
    }
  }, [items]);

  const post = useCallback(
    (appId: string, title: string, body: string) => {
      setItems((prev) => [
        {
          id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          appId,
          title,
          body,
          createdAt: Date.now(),
        },
        ...prev,
      ].slice(0, MAX_KEEP));
    },
    [],
  );

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const clearAll = useCallback(() => setItems([]), []);

  return { items, post, dismiss, clearAll };
}

export type Notifications = ReturnType<typeof useNotifications>;
