import test from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueueImageThumbnailTask,
  getImageThumbnailWorkerPipelineCapabilities,
  getImageThumbnailWorkerQueueSnapshot,
  isImageThumbnailWorkerPipelineError,
  resetImageThumbnailWorkerQueueForTests,
} from './image-thumbnail-worker-pipeline';
import {
  getCanvasImagePerformanceSnapshot,
  resetCanvasImagePerformanceSnapshot,
  setCanvasImageDiagnosticsConfig,
} from '@/utils/performance';

type WorkerListener = (event: MessageEvent<unknown>) => void;

function resetTestState(): void {
  resetImageThumbnailWorkerQueueForTests();
  resetCanvasImagePerformanceSnapshot();
  setCanvasImageDiagnosticsConfig({
    enabled: false,
    verbose: false,
    autoReport: false,
  });
}

test('enqueueImageThumbnailTask returns null when worker thumbnail prerequisites are unavailable', async () => {
  resetTestState();
  const previousWorker = globalThis.Worker;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;

  try {
    // @ts-expect-error intentionally disables worker availability for the fallback branch.
    globalThis.Worker = undefined;
    // @ts-expect-error intentionally disables worker availability for the fallback branch.
    globalThis.createImageBitmap = undefined;
    // @ts-expect-error intentionally disables worker availability for the fallback branch.
    globalThis.OffscreenCanvas = undefined;

    const capabilities = getImageThumbnailWorkerPipelineCapabilities();
    assert.deepEqual(capabilities, {
      supported: false,
      hasWorker: false,
      hasCreateImageBitmap: false,
      hasOffscreenCanvas: false,
    });

    assert.equal(enqueueImageThumbnailTask(new File(['image'], 'image.png'), {
      maxWidth: 256,
      maxHeight: 256,
    }), null);
  } finally {
    resetTestState();
    globalThis.Worker = previousWorker;
    globalThis.createImageBitmap = previousCreateImageBitmap;
    globalThis.OffscreenCanvas = previousOffscreenCanvas;
  }
});

test('enqueueImageThumbnailTask resolves Blob thumbnail results without data URLs', async () => {
  resetTestState();
  const previousWorker = globalThis.Worker;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  const previousWindow = globalThis.window;
  const postedRequests: Array<{ id: string; file: File }> = [];

  class MockWorker {
    private listener: WorkerListener | null = null;

    addEventListener(type: string, listener: EventListener): void {
      if (type === 'message') {
        this.listener = listener as WorkerListener;
      }
    }

    postMessage(request: { id: string; file: File }): void {
      postedRequests.push(request);
      queueMicrotask(() => {
        this.listener?.({
          data: {
            id: request.id,
            success: true,
            result: {
              metadata: {
                width: 640,
                height: 360,
              },
              thumbnailBlob: new Blob(['thumb'], { type: 'image/jpeg' }),
              mimeType: 'image/jpeg',
            },
          },
        } as MessageEvent<unknown>);
      });
    }

    terminate(): void {
      return undefined;
    }
  }

  try {
    globalThis.Worker = MockWorker as unknown as typeof Worker;
    globalThis.createImageBitmap = (async () => ({} as ImageBitmap)) as typeof createImageBitmap;
    globalThis.OffscreenCanvas = class {} as unknown as typeof OffscreenCanvas;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setTimeout,
        clearTimeout,
      },
    });

    const task = enqueueImageThumbnailTask(new File(['image'], 'image.png'), {
      maxWidth: 256,
      maxHeight: 256,
    });

    assert.ok(task);
    if (!task) {
      throw new Error('Expected worker task handle.');
    }
    const result = await task.promise;

    assert.equal(postedRequests.length, 1);
    assert.equal(result.kind, 'image');
    assert.equal(result.thumbnailBlob instanceof Blob, true);
    assert.equal(result.thumbnailUrl, undefined);
    assert.equal(result.thumbnailMimeType, 'image/jpeg');
    assert.equal(result.processingMode, 'worker');
  } finally {
    resetTestState();
    globalThis.Worker = previousWorker;
    globalThis.createImageBitmap = previousCreateImageBitmap;
    globalThis.OffscreenCanvas = previousOffscreenCanvas;
    if (previousWindow === undefined) {
      // @ts-expect-error restore optional global
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});

test('enqueueImageThumbnailTask drains a serial queue for 3 image tasks without stopping after the first two', async () => {
  resetTestState();
  const previousWorker = globalThis.Worker;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  const previousWindow = globalThis.window;
  const postedRequestIds: string[] = [];

  class MockWorker {
    private listener: WorkerListener | null = null;

    addEventListener(type: string, listener: EventListener): void {
      if (type === 'message') {
        this.listener = listener as WorkerListener;
      }
    }

    postMessage(request: { id: string }): void {
      postedRequestIds.push(request.id);
      queueMicrotask(() => {
        this.listener?.({
          data: {
            id: request.id,
            success: true,
            result: {
              metadata: {
                width: 640,
                height: 360,
              },
              thumbnailBlob: new Blob([request.id], { type: 'image/jpeg' }),
              mimeType: 'image/jpeg',
            },
          },
        } as MessageEvent<unknown>);
      });
    }

    terminate(): void {
      return undefined;
    }
  }

  try {
    globalThis.Worker = MockWorker as unknown as typeof Worker;
    globalThis.createImageBitmap = (async () => ({} as ImageBitmap)) as typeof createImageBitmap;
    globalThis.OffscreenCanvas = class {} as unknown as typeof OffscreenCanvas;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setTimeout,
        clearTimeout,
      },
    });

    const tasks = [1, 2, 3].map((index) => enqueueImageThumbnailTask(
      new File([`image-${index}`], `image-${index}.png`),
      {
        maxWidth: 256,
        maxHeight: 256,
      },
    ));

    assert.equal(tasks.every(Boolean), true);
    const results = await Promise.all(tasks.map((task) => task?.promise));
    const snapshot = getImageThumbnailWorkerQueueSnapshot();

    assert.deepEqual(postedRequestIds, [
      'image-thumbnail-1',
      'image-thumbnail-2',
      'image-thumbnail-3',
    ]);
    assert.equal(results.length, 3);
    assert.equal(results.every((result) => result?.kind === 'image'), true);
    assert.equal(snapshot.activeTaskId, null);
    assert.equal(snapshot.queuedTaskCount, 0);
    assert.equal(snapshot.activeTaskCount, 0);
    assert.equal(snapshot.totalTaskCount, 0);
    assert.equal(snapshot.timeoutCount, 0);
    assert.equal(snapshot.errorCount, 0);
  } finally {
    resetTestState();
    globalThis.Worker = previousWorker;
    globalThis.createImageBitmap = previousCreateImageBitmap;
    globalThis.OffscreenCanvas = previousOffscreenCanvas;
    if (previousWindow === undefined) {
      // @ts-expect-error restore optional global
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});

test('enqueueImageThumbnailTask resumes draining queued tasks after worker timeout restart', async () => {
  resetTestState();
  const previousWorker = globalThis.Worker;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  const previousWindow = globalThis.window;
  const recordedTimeoutCallbacks: Array<() => void> = [];
  let postCount = 0;

  class MockWorker {
    private listener: WorkerListener | null = null;

    addEventListener(type: string, listener: EventListener): void {
      if (type === 'message') {
        this.listener = listener as WorkerListener;
      }
    }

    postMessage(request: { id: string }): void {
      postCount += 1;
      if (postCount === 1) {
        return;
      }

      queueMicrotask(() => {
        this.listener?.({
          data: {
            id: request.id,
            success: true,
            result: {
              metadata: {
                width: 800,
                height: 600,
              },
              thumbnailBlob: new Blob([request.id], { type: 'image/jpeg' }),
              mimeType: 'image/jpeg',
            },
          },
        } as MessageEvent<unknown>);
      });
    }

    terminate(): void {
      return undefined;
    }
  }

  try {
    globalThis.Worker = MockWorker as unknown as typeof Worker;
    globalThis.createImageBitmap = (async () => ({} as ImageBitmap)) as typeof createImageBitmap;
    globalThis.OffscreenCanvas = class {} as unknown as typeof OffscreenCanvas;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setTimeout: ((callback: () => void) => {
          recordedTimeoutCallbacks.push(callback);
          return recordedTimeoutCallbacks.length;
        }) as typeof setTimeout,
        clearTimeout: (() => undefined) as typeof clearTimeout,
      },
    });

    const firstTask = enqueueImageThumbnailTask(new File(['first'], 'first.png'), {
      maxWidth: 256,
      maxHeight: 256,
    });
    const secondTask = enqueueImageThumbnailTask(new File(['second'], 'second.png'), {
      maxWidth: 256,
      maxHeight: 256,
    });
    const thirdTask = enqueueImageThumbnailTask(new File(['third'], 'third.png'), {
      maxWidth: 256,
      maxHeight: 256,
    });

    assert.ok(firstTask);
    assert.ok(secondTask);
    assert.ok(thirdTask);
    assert.equal(recordedTimeoutCallbacks.length > 0, true);

    const firstFailurePromise = firstTask!.promise.then(
      () => ({ kind: 'resolved' as const }),
      (error) => ({
        kind: 'rejected' as const,
        error,
      }),
    );

    recordedTimeoutCallbacks[0]?.();

    const [firstFailure, secondResult, thirdResult] = await Promise.all([
      firstFailurePromise,
      secondTask!.promise,
      thirdTask!.promise,
    ]);
    const snapshot = getImageThumbnailWorkerQueueSnapshot();

    assert.equal(firstFailure.kind, 'rejected');
    if (firstFailure.kind !== 'rejected') {
      throw new Error('Expected first task to reject.');
    }
    assert.equal(isImageThumbnailWorkerPipelineError(firstFailure.error), true);
    if (isImageThumbnailWorkerPipelineError(firstFailure.error)) {
      assert.equal(firstFailure.error.message, 'Image thumbnail worker timed out');
      assert.equal(firstFailure.error.failureCode, 'worker-timeout');
      assert.equal(firstFailure.error.failureStage, 'worker-execute');
      assert.equal(firstFailure.error.retryable, true);
      assert.equal(firstFailure.error.timeoutMs, 15_000);
    }
    assert.equal(secondResult.kind, 'image');
    assert.equal(thirdResult.kind, 'image');
    assert.equal(snapshot.timeoutCount, 1);
    assert.equal(snapshot.restartCount >= 1, true);
    assert.equal(snapshot.queuedTaskCount, 0);
    assert.equal(snapshot.activeTaskId, null);
    assert.equal(typeof snapshot.lastQueueWaitMs, 'number');
    assert.equal(typeof snapshot.lastExecuteMs, 'number');
    assert.equal(snapshot.lastTimeoutMs, 15_000);
  } finally {
    resetTestState();
    globalThis.Worker = previousWorker;
    globalThis.createImageBitmap = previousCreateImageBitmap;
    globalThis.OffscreenCanvas = previousOffscreenCanvas;
    if (previousWindow === undefined) {
      // @ts-expect-error restore optional global
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});

test('worker queue diagnostics distinguish queue stalls from import batch lifecycle state', async () => {
  resetTestState();
  const previousWorker = globalThis.Worker;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  const previousWindow = globalThis.window;
  const recordedTimeoutCallbacks: Array<() => void> = [];

  class MockWorker {
    addEventListener(): void {
      return undefined;
    }

    postMessage(): void {
      return undefined;
    }

    terminate(): void {
      return undefined;
    }
  }

  try {
    setCanvasImageDiagnosticsConfig({
      enabled: true,
      verbose: false,
      autoReport: false,
    });
    globalThis.Worker = MockWorker as unknown as typeof Worker;
    globalThis.createImageBitmap = (async () => ({} as ImageBitmap)) as typeof createImageBitmap;
    globalThis.OffscreenCanvas = class {} as unknown as typeof OffscreenCanvas;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setTimeout: ((callback: () => void) => {
          recordedTimeoutCallbacks.push(callback);
          return recordedTimeoutCallbacks.length;
        }) as typeof setTimeout,
        clearTimeout: (() => undefined) as typeof clearTimeout,
        localStorage: {
          getItem: () => '1',
          setItem: () => undefined,
          removeItem: () => undefined,
        },
        location: {
          search: '',
        },
      },
    });

    const task = enqueueImageThumbnailTask(new File(['stalled'], 'stalled.png'), {
      maxWidth: 256,
      maxHeight: 256,
    });
    assert.ok(task);

    recordedTimeoutCallbacks[0]?.();
    await task!.promise.catch(() => undefined);

    const snapshot = getCanvasImagePerformanceSnapshot();
    const queueEvents = snapshot.imageThumbnailWorkerQueueEvents;
    const queueSummary = snapshot.imageThumbnailWorkerQueueSummary;

    if (import.meta.env?.DEV) {
      assert.equal(queueEvents.some((event) => event.eventKind === 'task-enqueued'), true);
      assert.equal(queueEvents.some((event) => event.eventKind === 'task-started'), true);
      assert.equal(queueEvents.some((event) => event.eventKind === 'worker-timeout'), true);
      assert.equal(queueEvents.some((event) => event.eventKind === 'worker-restart'), true);
      const timeoutEvent = queueEvents.find((event) => event.eventKind === 'worker-timeout');
      assert.equal(timeoutEvent?.detail?.errorCode, 'worker-timeout');
      assert.equal(timeoutEvent?.detail?.failureStage, 'worker-execute');
      assert.equal(timeoutEvent?.detail?.retryable, true);
      assert.equal(typeof timeoutEvent?.detail?.queueWaitMs, 'number');
      assert.equal(typeof timeoutEvent?.detail?.executeMs, 'number');
      assert.equal(timeoutEvent?.detail?.timeoutMs, 15000);
      assert.equal(queueSummary.timeoutCount, 1);
      assert.equal(queueSummary.restartCount >= 1, true);
    } else {
      assert.equal(queueEvents.length, 0);
      assert.equal(queueSummary.eventCount, 0);
    }

    assert.equal(snapshot.importBatches.length, 0);
  } finally {
    resetTestState();
    globalThis.Worker = previousWorker;
    globalThis.createImageBitmap = previousCreateImageBitmap;
    globalThis.OffscreenCanvas = previousOffscreenCanvas;
    if (previousWindow === undefined) {
      // @ts-expect-error restore optional global
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});

test('worker queue diagnostics record pipeline gate failures with structured detail', async () => {
  resetTestState();
  const previousWorker = globalThis.Worker;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  const previousWindow = globalThis.window;

  try {
    setCanvasImageDiagnosticsConfig({
      enabled: true,
      verbose: false,
      autoReport: false,
    });
    // @ts-expect-error test intentionally disables worker availability.
    globalThis.Worker = undefined;
    // @ts-expect-error test intentionally disables createImageBitmap availability.
    globalThis.createImageBitmap = undefined;
    // @ts-expect-error test intentionally disables OffscreenCanvas availability.
    globalThis.OffscreenCanvas = undefined;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        setTimeout,
        clearTimeout,
        localStorage: {
          getItem: () => '1',
          setItem: () => undefined,
          removeItem: () => undefined,
        },
        location: {
          search: '',
        },
      },
    });

    const task = enqueueImageThumbnailTask(new File(['missing-worker'], 'missing-worker.png'), {
      maxWidth: 256,
      maxHeight: 256,
    });

    assert.equal(task, null);
    const snapshot = getCanvasImagePerformanceSnapshot();

    if (import.meta.env?.DEV) {
      const failedEvent = snapshot.imageThumbnailWorkerQueueEvents.find((event) => event.eventKind === 'task-failed');
      assert.equal(failedEvent?.detail?.errorCode, 'worker-unavailable');
      assert.equal(failedEvent?.detail?.failureStage, 'pipeline-gate');
      assert.equal(failedEvent?.detail?.retryable, false);
      assert.equal(failedEvent?.detail?.hasWorker, false);
      assert.equal(failedEvent?.detail?.hasCreateImageBitmap, false);
      assert.equal(failedEvent?.detail?.hasOffscreenCanvas, false);
    } else {
      assert.equal(snapshot.imageThumbnailWorkerQueueEvents.length, 0);
    }
  } finally {
    resetTestState();
    globalThis.Worker = previousWorker;
    globalThis.createImageBitmap = previousCreateImageBitmap;
    globalThis.OffscreenCanvas = previousOffscreenCanvas;
    if (previousWindow === undefined) {
      // @ts-expect-error restore optional global
      delete globalThis.window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    }
  }
});
