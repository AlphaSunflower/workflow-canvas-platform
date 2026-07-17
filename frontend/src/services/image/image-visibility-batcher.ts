import type { ImageVisibilityReconcileEntry } from './image-resource.types';

interface CreateImageVisibilityBatcherOptions {
  onFlush: (entries: ImageVisibilityReconcileEntry[]) => void;
  scheduleMicrotaskImpl?: (callback: () => void) => void;
  scheduleFrameImpl?: (callback: () => void) => number;
  cancelFrameImpl?: (frameId: number) => void;
}

export interface ImageVisibilityBatcher {
  schedule: (entry: ImageVisibilityReconcileEntry) => void;
  flush: () => boolean;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
  isPaused: () => boolean;
  isScheduled: () => boolean;
}

export function createImageVisibilityBatcher(
  options: CreateImageVisibilityBatcherOptions
): ImageVisibilityBatcher {
  const scheduleFrameImpl = options.scheduleFrameImpl
    ?? (
      typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : undefined
    );
  const cancelFrameImpl = options.cancelFrameImpl
    ?? (
      typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function'
        ? window.cancelAnimationFrame.bind(window)
        : undefined
    );
  const scheduleDeferred = (callback: () => void): number | undefined => {
    if (scheduleFrameImpl) {
      return scheduleFrameImpl(callback);
    }

    const scheduleMicrotaskImpl = options.scheduleMicrotaskImpl ?? queueMicrotask;
    scheduleMicrotaskImpl(callback);
    return undefined;
  };
  const pendingEntries = new Map<string, ImageVisibilityReconcileEntry>();
  let scheduled = false;
  let scheduleToken = 0;
  let paused = false;
  let scheduledFrameId: number | undefined;

  const commit = (): boolean => {
    if (pendingEntries.size === 0) {
      return false;
    }

    const entries = Array.from(pendingEntries.values());
    pendingEntries.clear();
    options.onFlush(entries);
    return true;
  };

  const cancelScheduledFrame = (): void => {
    if (typeof scheduledFrameId !== 'number') {
      return;
    }

    cancelFrameImpl?.(scheduledFrameId);
    scheduledFrameId = undefined;
  };

  const scheduleCommit = (): void => {
    scheduled = true;
    const token = ++scheduleToken;
    scheduledFrameId = scheduleDeferred(() => {
      if (token !== scheduleToken) {
        return;
      }
      scheduledFrameId = undefined;
      scheduled = false;
      if (paused) {
        return;
      }
      commit();
    });
  };

  return {
    schedule(entry: ImageVisibilityReconcileEntry): void {
      const existing = pendingEntries.get(entry.stateKey);
      pendingEntries.set(entry.stateKey, existing
        ? {
          ...existing,
          next: entry.next,
        }
        : entry);

      if (scheduled) {
        return;
      }

      if (paused) {
        return;
      }

      scheduleCommit();
    },
    flush(): boolean {
      scheduled = false;
      scheduleToken += 1;
      cancelScheduledFrame();
      return commit();
    },
    cancel(): void {
      scheduled = false;
      scheduleToken += 1;
      cancelScheduledFrame();
      pendingEntries.clear();
    },
    pause(): void {
      paused = true;
      scheduled = false;
      scheduleToken += 1;
      cancelScheduledFrame();
    },
    resume(): void {
      if (!paused) {
        return;
      }

      paused = false;
      if (pendingEntries.size === 0 || scheduled) {
        return;
      }

      scheduleCommit();
    },
    isPaused(): boolean {
      return paused;
    },
    isScheduled(): boolean {
      return scheduled;
    },
  };
}
