export interface ThumbnailApplyEntry {
  apply: () => void;
  dispose?: () => void;
}

export interface ThumbnailApplyScheduler {
  enqueue: (key: string, entry: ThumbnailApplyEntry) => void;
  remove: (key: string) => void;
  flush: (options?: { limit?: number }) => void;
  pause: () => void;
  resume: () => void;
  clear: () => void;
  isPaused: () => boolean;
  getPendingCount: () => number;
}

interface CreateThumbnailApplySchedulerOptions {
  maxPerFrame?: number;
  getMaxPerFrame?: () => number;
  requestAnimationFrameImpl?: typeof window.requestAnimationFrame;
  cancelAnimationFrameImpl?: typeof window.cancelAnimationFrame;
}

function normalizeMaxPerFrame(value: number | undefined, fallback = 4): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

export function createThumbnailApplyScheduler(
  options: CreateThumbnailApplySchedulerOptions = {},
): ThumbnailApplyScheduler {
  const requestAnimationFrameImpl = options.requestAnimationFrameImpl ?? window.requestAnimationFrame.bind(window);
  const cancelAnimationFrameImpl = options.cancelAnimationFrameImpl ?? window.cancelAnimationFrame.bind(window);
  const maxPerFrame = normalizeMaxPerFrame(options.maxPerFrame);
  const pending = new Map<string, ThumbnailApplyEntry>();
  let frameId: number | null = null;
  let paused = false;

  const resolveMaxPerFrame = (): number => normalizeMaxPerFrame(
    options.getMaxPerFrame?.() ?? maxPerFrame,
    maxPerFrame,
  );

  const cancelFrame = (): void => {
    if (frameId === null) {
      return;
    }

    cancelAnimationFrameImpl(frameId);
    frameId = null;
  };

  const drain = (limit: number): void => {
    const entries = Array.from(pending.entries()).slice(0, limit);
    entries.forEach(([key, entry]) => {
      pending.delete(key);
      entry.apply();
    });
  };

  const schedule = (): void => {
    if (paused || frameId !== null || pending.size === 0) {
      return;
    }

    frameId = requestAnimationFrameImpl(() => {
      frameId = null;
      if (paused || pending.size === 0) {
        return;
      }

      drain(resolveMaxPerFrame());
      if (pending.size > 0) {
        schedule();
      }
    });
  };

  const disposeEntry = (entry: ThumbnailApplyEntry | undefined): void => {
    entry?.dispose?.();
  };

  return {
    enqueue(key, entry): void {
      disposeEntry(pending.get(key));
      pending.set(key, entry);
      schedule();
    },
    remove(key): void {
      disposeEntry(pending.get(key));
      pending.delete(key);
      if (pending.size === 0) {
        cancelFrame();
      }
    },
    flush(options: { limit?: number } = {}): void {
      if (paused || pending.size === 0) {
        return;
      }

      cancelFrame();
      drain(typeof options.limit === 'number' ? Math.max(1, Math.floor(options.limit)) : resolveMaxPerFrame());
      if (pending.size > 0) {
        schedule();
      }
    },
    pause(): void {
      paused = true;
      cancelFrame();
    },
    resume(): void {
      if (!paused) {
        return;
      }

      paused = false;
      schedule();
    },
    clear(): void {
      cancelFrame();
      Array.from(pending.values()).forEach((entry) => disposeEntry(entry));
      pending.clear();
    },
    isPaused(): boolean {
      return paused;
    },
    getPendingCount(): number {
      return pending.size;
    },
  };
}
