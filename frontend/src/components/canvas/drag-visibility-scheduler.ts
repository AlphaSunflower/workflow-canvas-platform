import type { VisibleNodeMap } from '@/hooks/canvas/useVisibleNodes';

export interface DragVisibilityCommitMetric {
  reason: 'frame' | 'flush';
  nodeCount: number;
  visibleNodeCount: number;
  nearViewportNodeCount: number;
  durationMs: number;
  computeMs: number;
  applyMs: number;
  recordedAt: number;
}

interface ScheduleOptions {
  compute: () => {
    visibleNodes: VisibleNodeMap;
    durationMs: number;
  } | Promise<{
    visibleNodes: VisibleNodeMap;
    durationMs: number;
  }>;
  apply: (visibleNodes: VisibleNodeMap) => {
    durationMs: number;
  };
  record?: (metric: DragVisibilityCommitMetric) => void;
}

interface CreateDragVisibilitySchedulerOptions {
  requestAnimationFrameImpl?: typeof window.requestAnimationFrame;
  cancelAnimationFrameImpl?: typeof window.cancelAnimationFrame;
  now?: () => number;
}

export interface DragVisibilityScheduler {
  schedule: (options: ScheduleOptions) => void;
  flush: (options?: ScheduleOptions) => boolean;
  suspend: () => void;
  resume: () => void;
  isSuspended: () => boolean;
  cancel: () => void;
  isScheduled: () => boolean;
}

export function createDragVisibilityScheduler(
  options: CreateDragVisibilitySchedulerOptions = {}
): DragVisibilityScheduler {
  const requestAnimationFrameImpl = options.requestAnimationFrameImpl ?? window.requestAnimationFrame.bind(window);
  const cancelAnimationFrameImpl = options.cancelAnimationFrameImpl ?? window.cancelAnimationFrame.bind(window);
  const now = options.now ?? ((): number => (
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  ));
  let frameId: number | null = null;
  let pendingOptions: ScheduleOptions | null = null;
  let scheduleSequence = 0;
  let suspended = false;

  const applyComputedVisibility = (
    reason: 'frame' | 'flush',
    nextOptions: ScheduleOptions,
    computation: {
      visibleNodes: VisibleNodeMap;
      durationMs: number;
    },
    startedAt: number,
    commitId: number
  ): boolean => {
    if (commitId !== scheduleSequence || suspended) {
      return false;
    }

    const computedAt = now();
    const applied = nextOptions.apply(computation.visibleNodes);
    const completedAt = now();

    const visibleNodeCount = countVisibleNodes(computation.visibleNodes, 'isVisible');
    const nearViewportNodeCount = countVisibleNodes(computation.visibleNodes, 'isNearViewport');

    nextOptions.record?.({
      reason,
      nodeCount: computation.visibleNodes.size,
      visibleNodeCount,
      nearViewportNodeCount,
      durationMs: completedAt - startedAt,
      computeMs: computation.durationMs > 0 ? computation.durationMs : computedAt - startedAt,
      applyMs: applied.durationMs > 0 ? applied.durationMs : completedAt - computedAt,
      recordedAt: completedAt,
    });

    return true;
  };

  const commit = (reason: 'frame' | 'flush', overrideOptions?: ScheduleOptions): boolean => {
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
    const computation = nextOptions.compute();

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

  return {
    schedule(scheduleOptions: ScheduleOptions): void {
      pendingOptions = scheduleOptions;
      scheduleSequence += 1;

      if (suspended) {
        if (frameId !== null) {
          cancelAnimationFrameImpl(frameId);
          frameId = null;
        }
        return;
      }

      if (frameId !== null) {
        return;
      }

      frameId = requestAnimationFrameImpl(() => {
        frameId = null;
        commit('frame');
      });
    },
    flush(flushOptions?: ScheduleOptions): boolean {
      if (frameId !== null) {
        cancelAnimationFrameImpl(frameId);
        frameId = null;
      }

      if (!flushOptions && !pendingOptions) {
        return false;
      }

      return commit('flush', flushOptions);
    },
    suspend(): void {
      suspended = true;
      scheduleSequence += 1;
      if (frameId !== null) {
        cancelAnimationFrameImpl(frameId);
        frameId = null;
      }
    },
    resume(): void {
      suspended = false;
    },
    isSuspended(): boolean {
      return suspended;
    },
    cancel(): void {
      if (frameId !== null) {
        cancelAnimationFrameImpl(frameId);
        frameId = null;
      }
      suspended = false;
      pendingOptions = null;
      scheduleSequence += 1;
    },
    isScheduled(): boolean {
      return frameId !== null;
    },
  };
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as Promise<T>).then === 'function';
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
