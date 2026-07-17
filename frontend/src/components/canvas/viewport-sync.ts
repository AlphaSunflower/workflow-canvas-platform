import type { Viewport } from '@/types';

interface CreateViewportSyncControllerOptions {
  delayMs: number;
  setTimeoutImpl?: typeof window.setTimeout;
  clearTimeoutImpl?: typeof window.clearTimeout;
  onCommit: (viewport: Viewport) => void;
}

export interface ViewportSyncController {
  schedule: (viewport: Viewport) => void;
  flush: (viewport?: Viewport) => boolean;
  suspend: () => void;
  resume: () => void;
  isSuspended: () => boolean;
  cancel: () => void;
}

export function createViewportSyncController(
  options: CreateViewportSyncControllerOptions
): ViewportSyncController {
  const setTimeoutImpl = options.setTimeoutImpl ?? window.setTimeout.bind(window);
  const clearTimeoutImpl = options.clearTimeoutImpl ?? window.clearTimeout.bind(window);
  let timerId: number | null = null;
  let pendingViewport: Viewport | null = null;
  let suspended = false;

  const commitPendingViewport = (): boolean => {
    if (!pendingViewport) {
      return false;
    }

    const nextViewport = pendingViewport;
    pendingViewport = null;
    options.onCommit(nextViewport);
    return true;
  };

  const flush = (viewport?: Viewport): boolean => {
    if (viewport) {
      pendingViewport = viewport;
    }

    if (timerId !== null) {
      clearTimeoutImpl(timerId);
      timerId = null;
    }

    return commitPendingViewport();
  };

  return {
    schedule(viewport: Viewport): void {
      pendingViewport = viewport;
      if (suspended) {
        return;
      }
      if (timerId !== null) {
        return;
      }

      timerId = setTimeoutImpl(() => {
        timerId = null;
        commitPendingViewport();
      }, options.delayMs);
    },
    flush,
    suspend(): void {
      suspended = true;
      if (timerId !== null) {
        clearTimeoutImpl(timerId);
        timerId = null;
      }
    },
    resume(): void {
      suspended = false;
    },
    isSuspended(): boolean {
      return suspended;
    },
    cancel(): void {
      if (timerId !== null) {
        clearTimeoutImpl(timerId);
        timerId = null;
      }
      suspended = false;
      pendingViewport = null;
    },
  };
}
