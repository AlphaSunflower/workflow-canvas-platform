import type { MemoizedFunction, MemoizeOptions } from '@/types';
import { safeStringify } from '../common';

export function memoize<T extends (...args: unknown[]) => unknown>(fn: T, keyGenerator?: (...args: Parameters<T>) => string, options?: MemoizeOptions): MemoizedFunction<T> {
  const maxSize = options?.maxCacheSize ?? 100;
  const cache = new Map<string, { value: ReturnType<T>; timestamp: number }>();
  const accessOrder: string[] = [];

  const evictLRU = (): void => {
    if (accessOrder.length > 0) {
      const oldestKey = accessOrder.shift();
      if (oldestKey) {
        cache.delete(oldestKey);
      }
    }
  };

  const updateAccessOrder = (key: string): void => {
    const index = accessOrder.indexOf(key);
    if (index !== -1) {
      accessOrder.splice(index, 1);
    }
    accessOrder.push(key);
  };

  const memoized = (...args: Parameters<T>): ReturnType<T> => {
    let key: string;
    try {
      key = keyGenerator ? keyGenerator(...args) : safeStringify(args);
    } catch {
      return fn(...args) as ReturnType<T>;
    }

    const cached = cache.get(key);
    if (cached) {
      updateAccessOrder(key);
      return cached.value;
    }

    const result = fn(...args) as ReturnType<T>;
    if (cache.size >= maxSize) {
      evictLRU();
    }

    cache.set(key, { value: result, timestamp: Date.now() });
    accessOrder.push(key);
    return result;
  };

  memoized.clearCache = (): void => {
    cache.clear();
    accessOrder.length = 0;
  };

  return memoized;
}
