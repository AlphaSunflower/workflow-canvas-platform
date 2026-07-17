import type { ThrottledFunction } from '@/types';

export function throttle<T extends (...args: unknown[]) => unknown>(fn: T, limit: number): ThrottledFunction<T> {
  let inThrottle = false;
  let lastArgs: Parameters<T> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const throttled = (...args: Parameters<T>): void => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      timeoutId = setTimeout(() => {
        inThrottle = false;
        timeoutId = null;
        if (lastArgs) {
          throttled(...lastArgs);
          lastArgs = null;
        }
      }, limit);
    } else {
      lastArgs = args;
    }
  };

  throttled.cancel = (): void => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    inThrottle = false;
    lastArgs = null;
  };

  throttled.flush = (): void => {
    if (lastArgs) {
      fn(...lastArgs);
      lastArgs = null;
    }
  };

  return throttled;
}
