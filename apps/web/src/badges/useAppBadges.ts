import { useCallback, useEffect, useState } from "react";

/**
 * 应用角标（数字提示）中心：
 * - 任意应用通过 setBadge/clearBadge 设置自己的数字
 * - localStorage 持久化，刷新后保留
 * - Dock 图标右上角渲染红色圆形角标（仿 macOS）
 */
const STORAGE_KEY = "openos.appBadges";

export type BadgeMap = Record<string, number>;

function loadBadges(): BadgeMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: BadgeMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) out[key] = Math.floor(n);
    }
    return out;
  } catch {
    return {};
  }
}

function saveBadges(map: BadgeMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 存储满/隐私模式时静默失败
  }
}

export function useAppBadges() {
  const [badges, setBadges] = useState<BadgeMap>(() => loadBadges());

  useEffect(() => {
    saveBadges(badges);
  }, [badges]);

  /** 设置角标；n<=0 视为清除 */
  const setBadge = useCallback((appId: string, n: number) => {
    setBadges((prev) => {
      const next = { ...prev };
      if (!Number.isFinite(n) || n <= 0) delete next[appId];
      else next[appId] = Math.floor(n);
      return next;
    });
  }, []);

  /** 在现有基础上累加（新消息 +1 场景） */
  const bumpBadge = useCallback((appId: string, delta = 1) => {
    setBadges((prev) => {
      const current = prev[appId] ?? 0;
      const value = current + delta;
      const next = { ...prev };
      if (value <= 0) delete next[appId];
      else next[appId] = value;
      return next;
    });
  }, []);

  const clearBadge = useCallback((appId: string) => {
    setBadges((prev) => {
      if (!(appId in prev)) return prev;
      const next = { ...prev };
      delete next[appId];
      return next;
    });
  }, []);

  const getBadge = useCallback((appId: string) => badges[appId] ?? 0, [badges]);

  return { badges, getBadge, setBadge, bumpBadge, clearBadge };
}

export type AppBadges = ReturnType<typeof useAppBadges>;
