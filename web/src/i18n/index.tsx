import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { zhCN } from "./locales/zh-CN";
import { enUS } from "./locales/en-US";

/**
 * 轻量 i18n（对齐 OpenCode 的 useLanguage().t 模式）：
 * - t(key, params)：{name} 占位符插值
 * - 缺失键回退 zh-CN，再回退 key 本身
 * - 语言持久化 localStorage，切换即时生效
 * 新增语言：locales/ 下加词典 + 注册进 LOCALES。
 */
export type LocaleId = "zh-CN" | "en-US";

const LOCALES: Record<LocaleId, Record<string, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

export const LOCALE_OPTIONS: Array<{ id: LocaleId; label: string }> = [
  { id: "zh-CN", label: "简体中文" },
  { id: "en-US", label: "English" },
];

const STORAGE_KEY = "openos.locale";
const DEFAULT_LOCALE: LocaleId = "zh-CN";

function loadLocale(): LocaleId {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && saved in LOCALES) return saved as LocaleId;
  } catch {
    // ignore
  }
  return DEFAULT_LOCALE;
}

export type TFunc = (
  key: string,
  params?: Record<string, string | number>,
) => string;

type I18nValue = {
  locale: LocaleId;
  setLocale: (locale: LocaleId) => void;
  t: TFunc;
};

const I18nContext = createContext<I18nValue | null>(null);

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] !== undefined ? String(params[name]) : `{${name}}`,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleId>(() => loadLocale());

  const setLocale = useCallback((next: LocaleId) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback<TFunc>(
    (key, params) => {
      const dict = LOCALES[locale];
      const template = dict[key] ?? LOCALES[DEFAULT_LOCALE][key] ?? key;
      return interpolate(template, params);
    },
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within <I18nProvider>");
  }
  return ctx;
}
