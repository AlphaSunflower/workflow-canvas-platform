interface MediaLayoutRuntimeSyncScheduleOptions {
  force?: boolean;
  reason?: string;
}

interface CreateMediaLayoutRuntimeSyncControllerOptions {
  requestAnimationFrameImpl?: typeof window.requestAnimationFrame;
  cancelAnimationFrameImpl?: typeof window.cancelAnimationFrame;
  onCommit: (options: {
    reason?: string;
    force?: boolean;
  }) => void;
}

export interface MediaLayoutRuntimeSyncController {
  schedule: (options?: MediaLayoutRuntimeSyncScheduleOptions) => void;
  flush: (options?: MediaLayoutRuntimeSyncScheduleOptions) => void;
  cancel: () => void;
  isScheduled: () => boolean;
}

type MediaLayoutRuntimeSyncDelegate = (options: {
  reason?: string;
  force?: boolean;
}) => void;

function canUseAnimationFrame(): boolean {
  return typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';
}

export function createMediaLayoutRuntimeSyncController(
  options: CreateMediaLayoutRuntimeSyncControllerOptions
): MediaLayoutRuntimeSyncController {
  const requestAnimationFrameImpl = options.requestAnimationFrameImpl ?? window.requestAnimationFrame.bind(window);
  const cancelAnimationFrameImpl = options.cancelAnimationFrameImpl ?? window.cancelAnimationFrame.bind(window);
  let frameId: number | null = null;
  let pendingOptions: MediaLayoutRuntimeSyncScheduleOptions | null = null;

  const mergeOptions = (
    current: MediaLayoutRuntimeSyncScheduleOptions | null,
    next: MediaLayoutRuntimeSyncScheduleOptions = {},
  ): MediaLayoutRuntimeSyncScheduleOptions => ({
    reason: next.reason ?? current?.reason,
    force: Boolean(current?.force || next.force),
  });

  const commit = (overrideOptions?: MediaLayoutRuntimeSyncScheduleOptions): void => {
    const nextOptions = mergeOptions(pendingOptions, overrideOptions);
    pendingOptions = null;
    options.onCommit({
      reason: nextOptions.reason,
      force: nextOptions.force,
    });
  };

  return {
    schedule(scheduleOptions: MediaLayoutRuntimeSyncScheduleOptions = {}): void {
      pendingOptions = mergeOptions(pendingOptions, scheduleOptions);

      if (scheduleOptions.force) {
        if (frameId !== null) {
          cancelAnimationFrameImpl(frameId);
          frameId = null;
        }
        commit(scheduleOptions);
        return;
      }

      if (frameId !== null) {
        return;
      }

      frameId = requestAnimationFrameImpl(() => {
        frameId = null;
        if (!pendingOptions) {
          return;
        }

        commit();
      });
    },
    flush(flushOptions: MediaLayoutRuntimeSyncScheduleOptions = {}): void {
      if (frameId !== null) {
        cancelAnimationFrameImpl(frameId);
        frameId = null;
      }

      if (!pendingOptions && !flushOptions.force) {
        return;
      }

      commit(flushOptions);
    },
    cancel(): void {
      if (frameId !== null) {
        cancelAnimationFrameImpl(frameId);
        frameId = null;
      }

      pendingOptions = null;
    },
    isScheduled(): boolean {
      return frameId !== null;
    },
  };
}

let mediaLayoutRuntimeSyncDelegate: MediaLayoutRuntimeSyncDelegate | null = null;
let mediaLayoutRuntimeSyncController: MediaLayoutRuntimeSyncController | null = null;

function ensureMediaLayoutRuntimeSyncController(): MediaLayoutRuntimeSyncController | null {
  if (!canUseAnimationFrame()) {
    return null;
  }

  if (mediaLayoutRuntimeSyncController) {
    return mediaLayoutRuntimeSyncController;
  }

  mediaLayoutRuntimeSyncController = createMediaLayoutRuntimeSyncController({
    onCommit: (options) => {
      mediaLayoutRuntimeSyncDelegate?.(options);
    },
  });

  return mediaLayoutRuntimeSyncController;
}

export function bindMediaLayoutRuntimeSyncDelegate(
  delegate: MediaLayoutRuntimeSyncDelegate | null
): () => void {
  mediaLayoutRuntimeSyncDelegate = delegate;
  if (delegate) {
    ensureMediaLayoutRuntimeSyncController();
  } else {
    mediaLayoutRuntimeSyncController?.cancel();
  }

  return () => {
    if (mediaLayoutRuntimeSyncDelegate === delegate) {
      mediaLayoutRuntimeSyncController?.cancel();
      mediaLayoutRuntimeSyncDelegate = null;
    }
  };
}

export function scheduleMediaLayoutRuntimeSync(
  options: MediaLayoutRuntimeSyncScheduleOptions = {}
): void {
  ensureMediaLayoutRuntimeSyncController()?.schedule(options);
}

export function flushMediaLayoutRuntimeSync(
  options: MediaLayoutRuntimeSyncScheduleOptions = {}
): void {
  ensureMediaLayoutRuntimeSyncController()?.flush(options);
}

export function cancelMediaLayoutRuntimeSync(): void {
  mediaLayoutRuntimeSyncController?.cancel();
}

export function isMediaLayoutRuntimeSyncScheduled(): boolean {
  return mediaLayoutRuntimeSyncController?.isScheduled() ?? false;
}
