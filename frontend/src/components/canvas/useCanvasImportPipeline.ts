import { useCallback, useEffect, useRef } from 'react';
import {
  createImageImportCoordinator,
  type ImageImportCoordinator,
  type ImageImportCoordinatorTask,
} from '@/services/image/image-import-coordinator';
import {
  createThumbnailApplyScheduler,
  type ThumbnailApplyScheduler,
  type ThumbnailApplyEntry,
} from '@/services/image/thumbnail-apply-scheduler';

interface UseCanvasImportPipelineOptions {
  imageConcurrency: number;
  videoConcurrency: number;
  thumbnailMaxPerFrame?: number;
  getImageConcurrencyLimit?: () => number;
  getThumbnailMaxPerFrame?: () => number;
  yieldBeforeNextTask: () => Promise<void>;
  processImageTask: (
    task: ImageImportCoordinatorTask & { nodeType: 'image' },
  ) => Promise<{
    success: boolean;
    applyEntry?: ThumbnailApplyEntry | null;
  } | null | void>;
  processVideoTask: (task: ImageImportCoordinatorTask & { nodeType: 'video' }) => Promise<{
    success: boolean;
  } | null | void>;
  onTaskError?: (error: unknown, task: ImageImportCoordinatorTask) => void;
  onTaskSettled?: (task: ImageImportCoordinatorTask, success: boolean) => void;
  onBatchSettled?: (batchId: string) => void;
}

export interface UseCanvasImportPipelineResult {
  enqueueImportTask: (task: ImageImportCoordinatorTask) => void;
  resetImportCoordinator: () => void;
  removeThumbnailApply: (key: string) => void;
  pauseThumbnailApply: () => void;
  resumeThumbnailApply: () => void;
  flushThumbnailApply: (options?: { limit?: number }) => void;
  clearThumbnailApply: () => void;
  cancelImportPipeline: () => void;
}

export function useCanvasImportPipeline(
  options: UseCanvasImportPipelineOptions,
): UseCanvasImportPipelineResult {
  const {
    imageConcurrency,
    videoConcurrency,
    thumbnailMaxPerFrame = 6,
    getImageConcurrencyLimit,
    getThumbnailMaxPerFrame,
    yieldBeforeNextTask,
    processImageTask,
    processVideoTask,
    onTaskError,
    onTaskSettled,
    onBatchSettled,
  } = options;
  const importCoordinatorRef = useRef<ImageImportCoordinator | null>(null);
  const thumbnailSchedulerRef = useRef<ThumbnailApplyScheduler | null>(null);
  const activeImageEnhancementCountRef = useRef(0);
  const generationRef = useRef(0);
  const thumbnailMaxPerFrameRef = useRef(thumbnailMaxPerFrame);
  const getImageConcurrencyLimitRef = useRef(getImageConcurrencyLimit);
  const getThumbnailMaxPerFrameRef = useRef(getThumbnailMaxPerFrame);
  const yieldBeforeNextTaskRef = useRef(yieldBeforeNextTask);
  const processImageTaskRef = useRef(processImageTask);
  const processVideoTaskRef = useRef(processVideoTask);
  const onTaskErrorRef = useRef(onTaskError);
  const onTaskSettledRef = useRef(onTaskSettled);
  const onBatchSettledRef = useRef(onBatchSettled);

  thumbnailMaxPerFrameRef.current = thumbnailMaxPerFrame;
  getImageConcurrencyLimitRef.current = getImageConcurrencyLimit;
  getThumbnailMaxPerFrameRef.current = getThumbnailMaxPerFrame;
  yieldBeforeNextTaskRef.current = yieldBeforeNextTask;
  processImageTaskRef.current = processImageTask;
  processVideoTaskRef.current = processVideoTask;
  onTaskErrorRef.current = onTaskError;
  onTaskSettledRef.current = onTaskSettled;
  onBatchSettledRef.current = onBatchSettled;

  if (thumbnailSchedulerRef.current === null) {
    thumbnailSchedulerRef.current = createThumbnailApplyScheduler({
      maxPerFrame: thumbnailMaxPerFrame,
      getMaxPerFrame: () => (
        getThumbnailMaxPerFrameRef.current?.() ?? thumbnailMaxPerFrameRef.current
      ),
    });
  }

  const acquireImageEnhancementPermit = useCallback(async (): Promise<() => void> => {
    const generation = generationRef.current;
    while (activeImageEnhancementCountRef.current >= Math.max(
      1,
      Math.min(imageConcurrency, Math.floor(getImageConcurrencyLimitRef.current?.() ?? imageConcurrency)),
    )) {
      await yieldBeforeNextTaskRef.current();
      if (generation !== generationRef.current) {
        return () => undefined;
      }
    }

    if (generation !== generationRef.current) {
      return () => undefined;
    }

    activeImageEnhancementCountRef.current += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }

      released = true;
      activeImageEnhancementCountRef.current = Math.max(0, activeImageEnhancementCountRef.current - 1);
    };
  }, [imageConcurrency]);

  const createImportCoordinatorInstance = useCallback((): ImageImportCoordinator => (
    createImageImportCoordinator({
      imageConcurrency,
      videoConcurrency,
      yieldBeforeNextTask: () => yieldBeforeNextTaskRef.current(),
      processImageTask: async (task): Promise<void> => {
        const generation = generationRef.current;
        const releasePermit = await acquireImageEnhancementPermit();
        if (generation !== generationRef.current) {
          releasePermit();
          return;
        }

        let taskResult: Awaited<ReturnType<typeof processImageTask>> | null | void;
        try {
          taskResult = await processImageTaskRef.current(task);
        } finally {
          releasePermit();
        }
        const success = taskResult?.success ?? false;
        const thumbnailApplyEntry = taskResult?.applyEntry;

        if (!thumbnailApplyEntry) {
          onTaskSettledRef.current?.(task, success);
          return;
        }

        let hasSettled = false;
        const settleTask = (settledSuccess: boolean): void => {
          if (hasSettled) {
            return;
          }

          hasSettled = true;
          onTaskSettledRef.current?.(task, settledSuccess);
        };

        thumbnailSchedulerRef.current?.enqueue(task.nodeId.value, {
          apply: (): void => {
            thumbnailApplyEntry.apply();
            settleTask(success);
          },
          dispose: (): void => {
            thumbnailApplyEntry.dispose?.();
            settleTask(success);
          },
        });
      },
      processVideoTask: async (task): Promise<void> => {
        const taskResult = await processVideoTaskRef.current(task);
        onTaskSettledRef.current?.(task, taskResult?.success ?? false);
      },
      onTaskError: (error, task) => {
        onTaskErrorRef.current?.(error, task);
      },
      onBatchSettled: (batchId) => {
        onBatchSettledRef.current?.(batchId);
      },
    })
  ), [
    acquireImageEnhancementPermit,
    imageConcurrency,
    videoConcurrency,
  ]);

  const getImportCoordinator = useCallback((): ImageImportCoordinator => {
    if (!importCoordinatorRef.current) {
      importCoordinatorRef.current = createImportCoordinatorInstance();
    }

    return importCoordinatorRef.current;
  }, [createImportCoordinatorInstance]);

  const resetImportCoordinator = useCallback((): void => {
    generationRef.current += 1;
    importCoordinatorRef.current?.cancel();
    activeImageEnhancementCountRef.current = 0;
    importCoordinatorRef.current = createImportCoordinatorInstance();
  }, [createImportCoordinatorInstance]);

  const enqueueImportTask = useCallback((task: ImageImportCoordinatorTask): void => {
    getImportCoordinator().enqueue(task);
  }, [getImportCoordinator]);

  useEffect(() => {
    const importCoordinator = createImportCoordinatorInstance();
    importCoordinatorRef.current = importCoordinator;

    return (): void => {
      generationRef.current += 1;
      importCoordinator.cancel();
      if (importCoordinatorRef.current === importCoordinator) {
        importCoordinatorRef.current = null;
      }
      thumbnailSchedulerRef.current?.clear();
      activeImageEnhancementCountRef.current = 0;
    };
  }, [createImportCoordinatorInstance]);

  const removeThumbnailApply = useCallback((key: string): void => {
    thumbnailSchedulerRef.current?.remove(key);
  }, []);

  const pauseThumbnailApply = useCallback((): void => {
    thumbnailSchedulerRef.current?.pause();
  }, []);

  const resumeThumbnailApply = useCallback((): void => {
    thumbnailSchedulerRef.current?.resume();
  }, []);

  const flushThumbnailApply = useCallback((options?: { limit?: number }): void => {
    thumbnailSchedulerRef.current?.flush(options);
  }, []);

  const clearThumbnailApply = useCallback((): void => {
    thumbnailSchedulerRef.current?.clear();
  }, []);

  const cancelImportPipeline = useCallback((): void => {
    generationRef.current += 1;
    importCoordinatorRef.current?.cancel();
    thumbnailSchedulerRef.current?.clear();
    activeImageEnhancementCountRef.current = 0;
  }, []);

  return {
    enqueueImportTask,
    resetImportCoordinator,
    removeThumbnailApply,
    pauseThumbnailApply,
    resumeThumbnailApply,
    flushThumbnailApply,
    clearThumbnailApply,
    cancelImportPipeline,
  };
}
