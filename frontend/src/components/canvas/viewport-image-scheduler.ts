import { requestIdleCallback, cancelIdleCallback } from '@/utils/performance';
import type { Viewport } from '@/types';
import type { VisibleNodeMap } from '@/hooks/canvas/useVisibleNodes';

export type ViewportImagePhase = 'default' | 'post-drag' | 'post-drag-importing';

interface ViewportImageComputation {
  visibleNodes: VisibleNodeMap;
  durationMs: number;
}

interface ViewportImageApplyResult {
  durationMs: number;
}

export interface ViewportImageMetric {
  reason: 'scheduled' | 'flush';
  phase: ViewportImagePhase;
  viewport: Viewport;
  nodeCount: number;
  visibleNodeCount: number;
  nearViewportNodeCount: number;
  computeMs: number;
  applyMs: number;
  durationMs: number;
  recordedAt: number;
}

interface ViewportImageScheduleOptions {
  viewport: Viewport;
  compute: (viewport: Viewport) => ViewportImageComputation | Promise<ViewportImageComputation>;
  apply: (visibleNodes: VisibleNodeMap, viewport: Viewport) => ViewportImageApplyResult;
  record?: (metric: ViewportImageMetric) => void;
  onCommitted?: (metric: ViewportImageMetric) => void;
  phase?: ViewportImagePhase;
}

interface CreateViewportImageSchedulerOptions {
  requestAnimationFrameImpl?: typeof window.requestAnimationFrame;
  cancelAnimationFrameImpl?: typeof window.cancelAnimationFrame;
  requestIdleCallbackImpl?: typeof requestIdleCallback;
  cancelIdleCallbackImpl?: typeof cancelIdleCallback;
  setTimeoutImpl?: (callback: () => void, delay: number) => number;
  clearTimeoutImpl?: (timeoutId: number) => void;
  now?: () => number;
}

export interface ViewportImageScheduler {
  schedule: (options: ViewportImageScheduleOptions) => void;
  flush: (options?: ViewportImageScheduleOptions) => boolean;
  suspend: () => void;
  resume: () => void;
  isSuspended: () => boolean;
  cancel: () => void;
  isScheduled: () => boolean;
}

export function createViewportImageScheduler(
  options: CreateViewportImageSchedulerOptions = {}
): ViewportImageScheduler {
  const requestAnimationFrameImpl = options.requestAnimationFrameImpl ?? window.requestAnimationFrame.bind(window);
  const cancelAnimationFrameImpl = options.cancelAnimationFrameImpl ?? window.cancelAnimationFrame.bind(window);
  const requestIdleCallbackImpl = options.requestIdleCallbackImpl ?? requestIdleCallback;
  const cancelIdleCallbackImpl = options.cancelIdleCallbackImpl ?? cancelIdleCallback;
  const setTimeoutImpl = options.setTimeoutImpl ?? ((callback, delay) => (
    setTimeout(callback, delay) as unknown as number
  ));
  const clearTimeoutImpl = options.clearTimeoutImpl ?? ((nextTimeoutId) => {
    clearTimeout(nextTimeoutId);
  });
  const now = options.now ?? ((): number => (
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  ));

  let frameId: number | null = null;
  let idleId: number | null = null;
  let timeoutId: number | null = null;
  let pendingOptions: ViewportImageScheduleOptions | null = null;
  let scheduleSequence = 0;
  let suspended = false;

  const clearScheduledWork = (): void => {
    if (frameId !== null) {
      cancelAnimationFrameImpl(frameId);
      frameId = null;
    }

    if (idleId !== null) {
      cancelIdleCallbackImpl(idleId);
      idleId = null;
    }

    if (timeoutId !== null) {
      clearTimeoutImpl(timeoutId);
      timeoutId = null;
    }
  };

  const applyComputedVisibility = (
    reason: 'scheduled' | 'flush',
    nextOptions: ViewportImageScheduleOptions,
    computation: ViewportImageComputation,
    startedAt: number,
    commitId: number
  ): boolean => {
    if (commitId !== scheduleSequence || suspended) {
      return false;
    }

    const computedAt = now();
    const applied = nextOptions.apply(computation.visibleNodes, nextOptions.viewport);
    const completedAt = now();

    const metric: ViewportImageMetric = {
      reason,
      phase: nextOptions.phase ?? 'default',
      viewport: nextOptions.viewport,
      nodeCount: computation.visibleNodes.size,
      visibleNodeCount: countVisibleNodes(computation.visibleNodes, 'isVisible'),
      nearViewportNodeCount: countVisibleNodes(computation.visibleNodes, 'isNearViewport'),
      computeMs: computation.durationMs > 0 ? computation.durationMs : computedAt - startedAt,
      applyMs: applied.durationMs > 0 ? applied.durationMs : completedAt - computedAt,
      durationMs: completedAt - startedAt,
      recordedAt: completedAt,
    };

    nextOptions.record?.(metric);
    nextOptions.onCommitted?.(metric);

    return true;
  };

  const commit = (
    reason: 'scheduled' | 'flush',
    overrideOptions?: ViewportImageScheduleOptions
  ): boolean => {
    const nextOptions = overrideOptions ?? pendingOptions;
    pendingOptions = null;

    if (!nextOptions) {
      return false;
    }

    const currentCommitId = reason === 'flush'
      ? scheduleSequence + 1
      : scheduleSequence;
    if (reason === 'flush') {
      scheduleSequence = currentCommitId;
    }
    const startedAt = now();
    const computation = nextOptions.compute(nextOptions.viewport);
    if (isPromiseLike(computation)) {
      computation
        .then((resolvedComputation) => {
          applyComputedVisibility(reason, nextOptions, resolvedComputation, startedAt, currentCommitId);
        })
        .catch(() => {
          // The caller is responsible for providing main-thread fallback inside compute.
        });
      return true;
    }

    return applyComputedVisibility(reason, nextOptions, computation, startedAt, currentCommitId);
  };

  const scheduleIdleCommit = (): void => {
    if (idleId !== null) {
      return;
    }

    const timeout = pendingOptions?.phase === 'post-drag-importing' ? 160 : 80;
    idleId = requestIdleCallbackImpl(() => {
      idleId = null;
      commit('scheduled');
    }, { timeout });
  };

  const schedulePostDragCommit = (): void => {
    const phase = pendingOptions?.phase;
    if (phase !== 'post-drag' && phase !== 'post-drag-importing') {
      scheduleIdleCommit();
      return;
    }

    if (phase === 'post-drag') {
      scheduleIdleCommit();
      return;
    }

    if (timeoutId !== null) {
      return;
    }

    timeoutId = setTimeoutImpl(() => {
      timeoutId = null;
      scheduleIdleCommit();
    }, 48);
  };

  return {
    schedule(scheduleOptions: ViewportImageScheduleOptions): void {
      pendingOptions = scheduleOptions;
      scheduleSequence += 1;

      if (suspended) {
        clearScheduledWork();
        return;
      }

      if (frameId !== null || idleId !== null || timeoutId !== null) {
        return;
      }

      frameId = requestAnimationFrameImpl(() => {
        frameId = null;
        schedulePostDragCommit();
      });
    },
    flush(flushOptions?: ViewportImageScheduleOptions): boolean {
      if (flushOptions) {
        pendingOptions = flushOptions;
      }

      const hasWork = Boolean(pendingOptions);
      clearScheduledWork();
      commit('flush');
      return hasWork;
    },
    suspend(): void {
      suspended = true;
      scheduleSequence += 1;
      clearScheduledWork();
    },
    resume(): void {
      suspended = false;
    },
    isSuspended(): boolean {
      return suspended;
    },
    cancel(): void {
      clearScheduledWork();
      suspended = false;
      pendingOptions = null;
      scheduleSequence += 1;
    },
    isScheduled(): boolean {
      return frameId !== null || idleId !== null || timeoutId !== null;
    },
  };
}

function countVisibleNodes(
  visibleNodes: VisibleNodeMap,
  field: 'isVisible' | 'isNearViewport'
): number {
  let count = 0;
  visibleNodes.forEach((state) => {
    if (state[field]) {
      count += 1;
    }
  });
  return count;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as Promise<T>).then === 'function';
}
