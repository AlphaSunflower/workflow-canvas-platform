import { createAsyncTaskQueue, type AsyncTaskQueueController } from '@/utils/performance';
import type { FileMetadata, NodeId } from '@/types';

export interface ImageImportCoordinatorTask {
  batchId: string;
  file: File;
  nodeId: NodeId;
  fileId: string;
  nodeType: 'image' | 'video' | 'ply';
  metadata: FileMetadata;
  sessionId: string;
}

interface CreateImageImportCoordinatorOptions {
  imageConcurrency?: number;
  videoConcurrency?: number;
  yieldBeforeNextTask?: () => Promise<void>;
  processImageTask: (task: ImageImportCoordinatorTask & { nodeType: 'image' }) => Promise<void>;
  processVideoTask: (task: ImageImportCoordinatorTask & { nodeType: 'video' }) => Promise<void>;
  onTaskError?: (error: unknown, task: ImageImportCoordinatorTask) => void;
  onBatchSettled?: (batchId: string) => void;
}

export interface ImageImportCoordinator {
  enqueue: (task: ImageImportCoordinatorTask) => void;
  whenIdle: () => Promise<void>;
  cancel: () => void;
  getStats: () => {
    image: ReturnType<AsyncTaskQueueController<ImageImportCoordinatorTask>['getStats']>;
    video: ReturnType<AsyncTaskQueueController<ImageImportCoordinatorTask>['getStats']>;
    pendingBatches: number;
  };
}

function normalizeConcurrency(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

export function createImageImportCoordinator(
  options: CreateImageImportCoordinatorOptions,
): ImageImportCoordinator {
  const batchPendingCounts = new Map<string, number>();
  let cancelled = false;

  const trackEnqueue = (batchId: string): void => {
    batchPendingCounts.set(batchId, (batchPendingCounts.get(batchId) ?? 0) + 1);
  };

  const settleTask = (batchId: string): void => {
    const nextCount = (batchPendingCounts.get(batchId) ?? 0) - 1;
    if (nextCount > 0) {
      batchPendingCounts.set(batchId, nextCount);
      return;
    }

    batchPendingCounts.delete(batchId);
    if (!cancelled) {
      options.onBatchSettled?.(batchId);
    }
  };

  const imageQueue = createAsyncTaskQueue<ImageImportCoordinatorTask>({
    concurrency: normalizeConcurrency(options.imageConcurrency, 2),
    worker: async (task) => {
      try {
        await options.processImageTask(task as ImageImportCoordinatorTask & { nodeType: 'image' });
      } finally {
        settleTask(task.batchId);
      }
    },
    onTaskError: (error, task) => {
      options.onTaskError?.(error, task);
    },
    yieldBeforeNextTask: options.yieldBeforeNextTask,
  });

  const videoQueue = createAsyncTaskQueue<ImageImportCoordinatorTask>({
    concurrency: normalizeConcurrency(options.videoConcurrency, 1),
    worker: async (task) => {
      try {
        await options.processVideoTask(task as ImageImportCoordinatorTask & { nodeType: 'video' });
      } finally {
        settleTask(task.batchId);
      }
    },
    onTaskError: (error, task) => {
      options.onTaskError?.(error, task);
    },
    yieldBeforeNextTask: options.yieldBeforeNextTask,
  });

  return {
    enqueue(task): void {
      if (cancelled) {
        return;
      }

      if (task.nodeType !== 'image' && task.nodeType !== 'video') {
        return;
      }

      trackEnqueue(task.batchId);
      if (task.nodeType === 'image') {
        imageQueue.enqueue(task);
        return;
      }

      videoQueue.enqueue(task);
    },
    whenIdle(): Promise<void> {
      return Promise.all([
        imageQueue.whenIdle(),
        videoQueue.whenIdle(),
      ]).then(() => undefined);
    },
    cancel(): void {
      cancelled = true;
      batchPendingCounts.clear();
      imageQueue.cancel();
      videoQueue.cancel();
    },
    getStats(): {
      image: ReturnType<typeof imageQueue.getStats>;
      video: ReturnType<typeof videoQueue.getStats>;
      pendingBatches: number;
    } {
      return {
        image: imageQueue.getStats(),
        video: videoQueue.getStats(),
        pendingBatches: batchPendingCounts.size,
      };
    },
  };
}
