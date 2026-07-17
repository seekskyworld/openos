/**
 * 通用防抖 + 节流（解耦工具，任意模块可复用）。
 *
 * debounce：停止触发 wait 毫秒后才执行（取最后一次参数）
 * throttle：连续触发期间至少每 interval 毫秒执行一次（取最新参数）
 * debounceWithThrottle：二者结合——
 *   常态走防抖（停顿才发），但连续输入超过 interval 仍强制发一次，
 *   避免用户持续打字时始终无响应。
 */

type AnyFn = (...args: never[]) => void;

export function debounce<F extends AnyFn>(
  fn: F,
  wait: number,
): F & { cancel: () => void } {
  let timer: number | null = null;
  const wrapped = ((...args: Parameters<F>) => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  }) as F & { cancel: () => void };
  wrapped.cancel = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

export function throttle<F extends AnyFn>(
  fn: F,
  interval: number,
): F & { cancel: () => void } {
  let last = 0;
  let timer: number | null = null;
  let pendingArgs: Parameters<F> | null = null;
  const wrapped = ((...args: Parameters<F>) => {
    const now = Date.now();
    pendingArgs = args;
    const remaining = interval - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
      pendingArgs = null;
    } else if (timer === null) {
      timer = window.setTimeout(() => {
        timer = null;
        last = Date.now();
        if (pendingArgs) fn(...pendingArgs);
        pendingArgs = null;
      }, remaining);
    }
  }) as F & { cancel: () => void };
  wrapped.cancel = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };
  return wrapped;
}

/**
 * 防抖为主 + 节流保底：
 * - 停顿 wait ms 后执行（防抖）
 * - 但从上次执行起连续输入超过 maxWait ms，强制执行一次（节流保底）
 */
export function debounceWithThrottle<F extends AnyFn>(
  fn: F,
  wait: number,
  maxWait: number,
): F & { cancel: () => void } {
  let timer: number | null = null;
  let lastInvoke = 0;
  const invoke = (...args: Parameters<F>) => {
    lastInvoke = Date.now();
    fn(...args);
  };
  const wrapped = ((...args: Parameters<F>) => {
    if (timer !== null) window.clearTimeout(timer);
    const now = Date.now();
    if (lastInvoke !== 0 && now - lastInvoke >= maxWait) {
      // 保底：持续输入超过 maxWait，立即执行
      invoke(...args);
      return;
    }
    if (lastInvoke === 0) lastInvoke = now;
    timer = window.setTimeout(() => {
      timer = null;
      invoke(...args);
    }, wait);
  }) as F & { cancel: () => void };
  wrapped.cancel = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    lastInvoke = 0;
  };
  return wrapped;
}
