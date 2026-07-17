import type { ImagePreprocessResult } from './file-preprocess.types';
import type {
  ImageThumbnailFailureCode,
  ImageThumbnailFailureDetail,
  ImageThumbnailFailureEnvironment,
  ImageThumbnailFailureStage,
} from './image-thumbnail-diagnostics.types';
import {
  recordCanvasImageThumbnailWorkerQueueEvent,
  shouldRecordCanvasImageThumbnailWorkerQueueDiagnostics,
} from '@/utils/performance';

interface ImageThumbnailWorkerRequest {
  id: string;
  file: File;
  thumbnail: {
    maxWidth: number;
    maxHeight: number;
  };
}

interface ImageThumbnailWorkerSuccess {
  id: string;
  success: true;
  result: {
    metadata: {
      width: number;
      height: number;
    };
    thumbnailBlob: Blob;
    mimeType: string;
  };
}

interface ImageThumbnailWorkerFailure {
  id: string;
  success: false;
  errorCode?: ImageThumbnailFailureCode;
  errorMessage?: string;
  error?: string;
}

type ImageThumbnailWorkerResponse = ImageThumbnailWorkerSuccess | ImageThumbnailWorkerFailure;

interface PendingTask {
  request: ImageThumbnailWorkerRequest;
  resolve: (value: ImagePreprocessResult) => void;
  reject: (reason?: unknown) => void;
  timeoutId?: number;
  cancelled: boolean;
  enqueuedAt: number;
  startedAt?: number;
}

type ImageThumbnailWorkerQueueEventKind =
  | 'task-enqueued'
  | 'task-started'
  | 'task-succeeded'
  | 'task-failed'
  | 'task-cancelled'
  | 'worker-timeout'
  | 'worker-error'
  | 'worker-restart';

export interface ImageThumbnailWorkerQueueSnapshot {
  activeTaskId: string | null;
  queuedTaskCount: number;
  activeTaskCount: 0 | 1;
  totalTaskCount: number;
  sequence: number;
  restartCount: number;
  timeoutCount: number;
  errorCount: number;
  lastEventAt?: number;
  lastTimeoutAt?: number;
  lastRestartAt?: number;
  lastQueueWaitMs?: number;
  lastExecuteMs?: number;
  lastTimeoutMs?: number;
}

export interface ImageThumbnailWorkerPipelineCapabilitySnapshot extends ImageThumbnailFailureEnvironment {
  supported: boolean;
}

export interface ImageThumbnailWorkerPipelineErrorDetail extends ImageThumbnailFailureDetail {
  queueWaitMs?: number;
  executeMs?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

let workerInstance: Worker | null = null;
let sequence = 0;
let activeTask: PendingTask | null = null;
const queuedTasks: PendingTask[] = [];
let restartCount = 0;
let timeoutCount = 0;
let errorCount = 0;
let lastEventAt: number | undefined;
let lastTimeoutAt: number | undefined;
let lastRestartAt: number | undefined;
let lastQueueWaitMs: number | undefined;
let lastExecuteMs: number | undefined;
let lastTimeoutMs: number | undefined;

export class ImageThumbnailWorkerPipelineError extends Error {
  readonly failureCode: ImageThumbnailFailureCode;
  readonly failureStage: ImageThumbnailFailureStage;
  readonly retryable: boolean;
  readonly durationMs?: number;
  readonly environment?: ImageThumbnailFailureEnvironment;
  readonly queueWaitMs?: number;
  readonly executeMs?: number;
  readonly timeoutMs?: number;

  constructor(detail: ImageThumbnailWorkerPipelineErrorDetail) {
    super(detail.message ?? detail.failureCode);
    this.name = 'ImageThumbnailWorkerPipelineError';
    this.failureCode = detail.failureCode;
    this.failureStage = detail.failureStage;
    this.retryable = detail.retryable;
    this.durationMs = detail.durationMs;
    this.environment = detail.environment;
    this.queueWaitMs = detail.queueWaitMs;
    this.executeMs = detail.executeMs;
    this.timeoutMs = detail.timeoutMs;
  }

  toFailureDetail(): ImageThumbnailFailureDetail {
    return {
      failureCode: this.failureCode,
      failureStage: this.failureStage,
      retryable: this.retryable,
      message: this.message,
      durationMs: this.durationMs,
      environment: this.environment,
    };
  }
}

export function isImageThumbnailWorkerPipelineError(error: unknown): error is ImageThumbnailWorkerPipelineError {
  return error instanceof ImageThumbnailWorkerPipelineError;
}

function getNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
}

function recordQueueEvent(
  eventKind: ImageThumbnailWorkerQueueEventKind,
  taskId?: string,
  detail?: Record<string, string | number | boolean | null | undefined>,
): void {
  const recordedAt = getNow();
  lastEventAt = recordedAt;
  if (typeof detail?.queueWaitMs === 'number') {
    lastQueueWaitMs = detail.queueWaitMs;
  }
  if (typeof detail?.executeMs === 'number') {
    lastExecuteMs = detail.executeMs;
  }
  if (typeof detail?.timeoutMs === 'number') {
    lastTimeoutMs = detail.timeoutMs;
  }
  if (eventKind === 'worker-timeout') {
    lastTimeoutAt = recordedAt;
  }
  if (eventKind === 'worker-restart') {
    lastRestartAt = recordedAt;
  }

  if (!shouldRecordCanvasImageThumbnailWorkerQueueDiagnostics()) {
    return;
  }

  recordCanvasImageThumbnailWorkerQueueEvent({
    eventKind,
    taskId,
    activeTaskId: activeTask?.request.id ?? null,
    queuedTaskCount: queuedTasks.filter((task) => !task.cancelled).length,
    activeTaskCount: activeTask ? 1 : 0,
    totalTaskCount: queuedTasks.filter((task) => !task.cancelled).length + (activeTask ? 1 : 0),
    restartCount,
    timeoutCount,
    errorCount,
    detail,
    recordedAt,
  });
}

export function getImageThumbnailWorkerPipelineCapabilities(): ImageThumbnailWorkerPipelineCapabilitySnapshot {
  const hasWorker = typeof Worker !== 'undefined';
  const hasCreateImageBitmap = typeof createImageBitmap === 'function';
  const hasOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';

  return {
    supported: hasWorker && hasCreateImageBitmap && hasOffscreenCanvas,
    hasWorker,
    hasCreateImageBitmap,
    hasOffscreenCanvas,
  };
}

function canUseWorkerPipeline(): ImageThumbnailWorkerPipelineCapabilitySnapshot {
  return getImageThumbnailWorkerPipelineCapabilities();
}

function getQueueWaitMs(task: PendingTask, now = getNow()): number {
  const anchor = task.startedAt ?? now;
  return Math.max(0, anchor - task.enqueuedAt);
}

function getExecuteMs(task: PendingTask, now = getNow()): number | undefined {
  if (typeof task.startedAt !== 'number') {
    return undefined;
  }

  return Math.max(0, now - task.startedAt);
}

function getTotalDurationMs(task: PendingTask, now = getNow()): number {
  return Math.max(0, now - task.enqueuedAt);
}

function buildTaskTimingDetail(task: PendingTask, now = getNow()): {
  queueWaitMs: number;
  executeMs?: number;
} {
  const executeMs = getExecuteMs(task, now);
  return {
    queueWaitMs: getQueueWaitMs(task, now),
    ...(typeof executeMs === 'number' ? { executeMs } : {}),
  };
}

function isRetryableFailureCode(failureCode: ImageThumbnailFailureCode): boolean {
  switch (failureCode) {
    case 'worker-timeout':
    case 'worker-crashed':
    case 'worker-message-failure':
      return true;
    default:
      return false;
  }
}

function createPipelineError(detail: ImageThumbnailWorkerPipelineErrorDetail): ImageThumbnailWorkerPipelineError {
  return new ImageThumbnailWorkerPipelineError(detail);
}

function getWorkerFailureMessage(message: ImageThumbnailWorkerFailure): string {
  return message.errorMessage ?? message.error ?? 'Image thumbnail generation failed';
}

function getWorker(): Worker {
  if (workerInstance) {
    return workerInstance;
  }

  workerInstance = new Worker(
    new URL('./image-thumbnail.worker.ts', import.meta.url),
    { type: 'module' },
  );
  workerInstance.addEventListener('message', handleWorkerMessage as EventListener);
  workerInstance.addEventListener('error', handleWorkerError as EventListener);
  return workerInstance;
}

function startNextTask(): void {
  if (activeTask) {
    return;
  }

  while (queuedTasks.length > 0) {
    const nextTask = queuedTasks.shift() as PendingTask;
    if (nextTask.cancelled) {
      continue;
    }

    activeTask = nextTask;
    nextTask.startedAt = getNow();
    recordQueueEvent('task-started', nextTask.request.id, buildTaskTimingDetail(nextTask, nextTask.startedAt));
    const worker = getWorker();
    nextTask.timeoutId = window.setTimeout(() => {
      if (activeTask !== nextTask) {
        return;
      }

      const timedOutAt = getNow();
      timeoutCount += 1;
      recordQueueEvent('worker-timeout', nextTask.request.id, {
        ...buildTaskTimingDetail(nextTask, timedOutAt),
        failureStage: 'worker-execute',
        retryable: true,
        durationMs: getTotalDurationMs(nextTask, timedOutAt),
        errorCode: 'worker-timeout',
        errorMessage: 'Image thumbnail worker timed out',
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      nextTask.reject(createPipelineError({
        failureCode: 'worker-timeout',
        failureStage: 'worker-execute',
        retryable: true,
        message: 'Image thumbnail worker timed out',
        durationMs: getTotalDurationMs(nextTask, timedOutAt),
        queueWaitMs: getQueueWaitMs(nextTask, timedOutAt),
        executeMs: getExecuteMs(nextTask, timedOutAt),
        timeoutMs: DEFAULT_TIMEOUT_MS,
      }));
      activeTask = null;
      restartWorker();
      startNextTask();
    }, DEFAULT_TIMEOUT_MS);
    try {
      worker.postMessage(nextTask.request);
    } catch (error) {
      const failureAt = getNow();
      settleActiveTask();
      errorCount += 1;
      recordQueueEvent('worker-error', nextTask.request.id, {
        ...buildTaskTimingDetail(nextTask, failureAt),
        hasActiveTask: true,
        reason: 'post-message-failure',
        failureStage: 'worker-execute',
        retryable: true,
        durationMs: getTotalDurationMs(nextTask, failureAt),
        errorCode: 'worker-crashed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      nextTask.reject(createPipelineError({
        failureCode: 'worker-crashed',
        failureStage: 'worker-execute',
        retryable: true,
        message: error instanceof Error ? error.message : 'Image thumbnail worker crashed',
        durationMs: getTotalDurationMs(nextTask, failureAt),
        queueWaitMs: getQueueWaitMs(nextTask, failureAt),
        executeMs: getExecuteMs(nextTask, failureAt),
      }));
      restartWorker();
      startNextTask();
    }
    return;
  }
}

function settleActiveTask(): PendingTask | null {
  const task = activeTask;
  activeTask = null;
  if (task?.timeoutId) {
    window.clearTimeout(task.timeoutId);
  }
  return task;
}

function handleWorkerMessage(event: MessageEvent<ImageThumbnailWorkerResponse>): void {
  const message = event.data;
  const task = activeTask;

  if (!task || task.request.id !== message.id) {
    return;
  }

  settleActiveTask();

  if (task.cancelled) {
    recordQueueEvent('task-cancelled', task.request.id, {
      reason: 'settled-while-cancelled',
    });
    startNextTask();
    return;
  }

  if (!message.success) {
    const failedAt = getNow();
    const errorCode = message.errorCode ?? 'worker-message-failure';
    const errorMessage = getWorkerFailureMessage(message);
    recordQueueEvent('task-failed', task.request.id, {
      reason: 'worker-message-failure',
      errorCode,
      errorMessage,
      failureStage: 'worker-execute',
      retryable: isRetryableFailureCode(errorCode),
      durationMs: getTotalDurationMs(task, failedAt),
      ...buildTaskTimingDetail(task, failedAt),
    });
    task.reject(createPipelineError({
      failureCode: errorCode,
      failureStage: 'worker-execute',
      retryable: isRetryableFailureCode(errorCode),
      message: errorMessage,
      durationMs: getTotalDurationMs(task, failedAt),
      queueWaitMs: getQueueWaitMs(task, failedAt),
      executeMs: getExecuteMs(task, failedAt),
    }));
    startNextTask();
    return;
  }

  const completedAt = getNow();
  recordQueueEvent('task-succeeded', task.request.id, buildTaskTimingDetail(task, completedAt));
  task.resolve({
    kind: 'image',
    metadata: message.result.metadata,
    thumbnailBlob: message.result.thumbnailBlob,
    thumbnailMimeType: message.result.mimeType,
    processingMode: 'worker',
  });
  startNextTask();
}

function handleWorkerError(): void {
  const failureAt = getNow();
  const task = settleActiveTask();
  errorCount += 1;
  recordQueueEvent('worker-error', task?.request.id, {
    hasActiveTask: Boolean(task),
    failureStage: 'worker-execute',
    retryable: true,
    errorCode: 'worker-crashed',
    errorMessage: 'Image thumbnail worker crashed',
    durationMs: task ? getTotalDurationMs(task, failureAt) : undefined,
    ...(task ? buildTaskTimingDetail(task, failureAt) : {}),
  });
  task?.reject(createPipelineError({
    failureCode: 'worker-crashed',
    failureStage: 'worker-execute',
    retryable: true,
    message: 'Image thumbnail worker crashed',
    durationMs: task ? getTotalDurationMs(task, failureAt) : undefined,
    queueWaitMs: task ? getQueueWaitMs(task, failureAt) : undefined,
    executeMs: task ? getExecuteMs(task, failureAt) : undefined,
  }));
  restartWorker();
  startNextTask();
}

function restartWorker(): void {
  restartCount += 1;
  recordQueueEvent('worker-restart', activeTask?.request.id);
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
}

export interface ImageThumbnailWorkerTaskHandle {
  cancel: () => void;
}

export function getImageThumbnailWorkerQueueSnapshot(): ImageThumbnailWorkerQueueSnapshot {
  const queuedTaskCount = queuedTasks.filter((task) => !task.cancelled).length;
  const activeTaskCount: 0 | 1 = activeTask ? 1 : 0;
  return {
    activeTaskId: activeTask?.request.id ?? null,
    queuedTaskCount,
    activeTaskCount,
    totalTaskCount: queuedTaskCount + activeTaskCount,
    sequence,
    restartCount,
    timeoutCount,
    errorCount,
    lastEventAt,
    lastTimeoutAt,
    lastRestartAt,
    lastQueueWaitMs,
    lastExecuteMs,
    lastTimeoutMs,
  };
}

export function resetImageThumbnailWorkerQueueForTests(): void {
  restartWorker();
  sequence = 0;
  activeTask = null;
  queuedTasks.length = 0;
  restartCount = 0;
  timeoutCount = 0;
  errorCount = 0;
  lastEventAt = undefined;
  lastTimeoutAt = undefined;
  lastRestartAt = undefined;
  lastQueueWaitMs = undefined;
  lastExecuteMs = undefined;
  lastTimeoutMs = undefined;
}

export function enqueueImageThumbnailTask(
  file: File,
  thumbnail: { maxWidth: number; maxHeight: number },
): { promise: Promise<ImagePreprocessResult>; handle: ImageThumbnailWorkerTaskHandle } | null {
  const capabilities = canUseWorkerPipeline();
  if (!capabilities.supported) {
    recordQueueEvent('task-failed', undefined, {
      reason: 'pipeline-unavailable',
      failureStage: 'pipeline-gate',
      retryable: false,
      errorCode: 'worker-unavailable',
      errorMessage: 'Image thumbnail worker pipeline is unavailable',
      hasWorker: capabilities.hasWorker,
      hasCreateImageBitmap: capabilities.hasCreateImageBitmap,
      hasOffscreenCanvas: capabilities.hasOffscreenCanvas,
    });
    return null;
  }

  const request: ImageThumbnailWorkerRequest = {
    id: `image-thumbnail-${sequence += 1}`,
    file,
    thumbnail,
  };

  let pendingTaskRef: PendingTask | null = null;
  const promise = new Promise<ImagePreprocessResult>((resolve, reject) => {
    const pendingTask: PendingTask = {
      request,
      resolve,
      reject,
      cancelled: false,
      enqueuedAt: getNow(),
    };
    pendingTaskRef = pendingTask;
    queuedTasks.push(pendingTask);
    recordQueueEvent('task-enqueued', pendingTask.request.id);
    startNextTask();
  });

  return {
    promise,
    handle: {
      cancel(): void {
        if (!pendingTaskRef) {
          return;
        }

        pendingTaskRef.cancelled = true;
        if (activeTask === pendingTaskRef) {
          recordQueueEvent('task-cancelled', pendingTaskRef.request.id, {
            reason: 'active-cancelled',
          });
          settleActiveTask();
          restartWorker();
          startNextTask();
        }
      },
    },
  };
}
