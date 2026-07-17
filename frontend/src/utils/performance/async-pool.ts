export interface AsyncTaskQueueStats {
  queued: number;
  active: number;
  concurrency: number;
}

interface CreateAsyncTaskQueueOptions<T> {
  concurrency: number;
  worker: (item: T) => Promise<void>;
  onTaskError?: (error: unknown, item: T) => void;
  onIdle?: () => void;
  yieldBeforeNextTask?: () => Promise<void>;
}

export interface AsyncTaskQueueController<T> {
  enqueue: (item: T) => void;
  whenIdle: () => Promise<void>;
  getStats: () => AsyncTaskQueueStats;
  cancel: () => void;
}

function normalizeConcurrency(concurrency: number): number {
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor(concurrency));
}

export async function runWithConcurrency<T, TResult>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.min(normalizeConcurrency(concurrency), items.length);
  const results = new Array<TResult>(items.length);
  let cursor = 0;
  const claimNextIndex = (): number => {
    const index = cursor;
    cursor += 1;
    return index;
  };

  const runWorker = async (): Promise<void> => {
    for (let index = claimNextIndex(); index < items.length; index = claimNextIndex()) {
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: limit }, () => runWorker()),
  );

  return results;
}

export function createAsyncTaskQueue<T>(
  options: CreateAsyncTaskQueueOptions<T>,
): AsyncTaskQueueController<T> {
  const concurrency = normalizeConcurrency(options.concurrency);
  const queue: T[] = [];
  const idleResolvers = new Set<() => void>();
  let activeCount = 0;
  let cancelled = false;

  const resolveIdleIfSettled = (triggerOnIdle = true): void => {
    if (queue.length > 0 || activeCount > 0) {
      return;
    }

    idleResolvers.forEach((resolve) => resolve());
    idleResolvers.clear();
    if (triggerOnIdle) {
      options.onIdle?.();
    }
  };

  const schedule = (): void => {
    if (cancelled) {
      resolveIdleIfSettled(false);
      return;
    }

    while (activeCount < concurrency && queue.length > 0) {
      const nextItem = queue.shift() as T;

      activeCount += 1;
      void (async (): Promise<void> => {
        try {
          await options.worker(nextItem);
        } catch (error) {
          options.onTaskError?.(error, nextItem);
        } finally {
          activeCount = Math.max(0, activeCount - 1);

          if (!cancelled && options.yieldBeforeNextTask) {
            try {
              await options.yieldBeforeNextTask();
            } catch {
              // Ignore scheduling yield failures and continue draining the queue.
            }
          }

          schedule();
        }
      })();
    }

    resolveIdleIfSettled();
  };

  return {
    enqueue(item: T): void {
      if (cancelled) {
        return;
      }

      queue.push(item);
      schedule();
    },
    whenIdle(): Promise<void> {
      if (queue.length === 0 && activeCount === 0) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        idleResolvers.add(resolve);
      });
    },
    getStats(): AsyncTaskQueueStats {
      return {
        queued: queue.length,
        active: activeCount,
        concurrency,
      };
    },
    cancel(): void {
      cancelled = true;
      queue.length = 0;
      resolveIdleIfSettled(false);
    },
  };
}
