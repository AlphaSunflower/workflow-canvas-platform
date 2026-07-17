import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ImageThumbnailWorkerPipelineError,
  resetImageThumbnailWorkerQueueForTests,
} from './image-thumbnail-worker-pipeline';

function resetModuleState(): void {
  resetImageThumbnailWorkerQueueForTests();
}

test('preprocessImportFile returns structured thumbnailFailure when worker pipeline is unavailable', async () => {
  resetModuleState();
  const previousWorker = globalThis.Worker;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;

  try {
    // @ts-expect-error test intentionally disables worker availability.
    globalThis.Worker = undefined;
    // @ts-expect-error test intentionally disables worker availability.
    globalThis.createImageBitmap = undefined;
    // @ts-expect-error test intentionally disables worker availability.
    globalThis.OffscreenCanvas = undefined;

    const { preprocessImportFile } = await import('./file-service.js');
    const result = await preprocessImportFile({
      file: new File(['image'], 'image.png', { type: 'image/png' }),
      kind: 'image',
      thumbnail: {
        maxWidth: 256,
        maxHeight: 256,
      },
    });

    assert.equal(result.kind, 'image');
    if (result.kind !== 'image') {
      throw new Error('Expected image preprocess result.');
    }
    assert.equal(result.processingMode, 'unavailable');
    assert.equal(result.thumbnailBlob, undefined);
    assert.equal(result.thumbnailUrl, undefined);
    assert.deepEqual(result.thumbnailFailure, {
      failureCode: 'worker-unavailable',
      failureStage: 'pipeline-gate',
      retryable: false,
      message: 'Image thumbnail worker pipeline is unavailable',
      environment: {
        hasWorker: false,
        hasCreateImageBitmap: false,
        hasOffscreenCanvas: false,
      },
    });
  } finally {
    resetModuleState();
    globalThis.Worker = previousWorker;
    globalThis.createImageBitmap = previousCreateImageBitmap;
    globalThis.OffscreenCanvas = previousOffscreenCanvas;
  }
});

test('preprocessImportFile preserves structured worker failure details', async () => {
  resetModuleState();
  const previousWorker = globalThis.Worker;
  const previousCreateImageBitmap = globalThis.createImageBitmap;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  const previousWindow = globalThis.window;

  class MockWorker {
    private messageListener: ((event: MessageEvent<unknown>) => void) | null = null;

    addEventListener(type: string, listener: EventListener): void {
      if (type === 'message') {
        this.messageListener = listener as (event: MessageEvent<unknown>) => void;
      }
    }

    postMessage(request: { id: string }): void {
      queueMicrotask(() => {
        this.messageListener?.({
          data: {
            id: request.id,
            success: false,
            errorCode: 'decode-failed',
            errorMessage: 'decode failed in worker',
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

    const { preprocessImportFile } = await import('./file-service.js');
    const result = await preprocessImportFile({
      file: new File(['image'], 'image.png', { type: 'image/png' }),
      kind: 'image',
      thumbnail: {
        maxWidth: 256,
        maxHeight: 256,
      },
    });

    assert.equal(result.kind, 'image');
    if (result.kind !== 'image') {
      throw new Error('Expected image preprocess result.');
    }
    assert.equal(result.processingMode, 'unavailable');
    assert.equal(result.thumbnailBlob, undefined);
    assert.equal(result.thumbnailUrl, undefined);
    assert.deepEqual(result.thumbnailFailure, {
      failureCode: 'decode-failed',
      failureStage: 'worker-execute',
      retryable: false,
      message: 'decode failed in worker',
      durationMs: result.thumbnailFailure?.durationMs,
      environment: {
        hasWorker: true,
        hasCreateImageBitmap: true,
        hasOffscreenCanvas: true,
      },
    });
    assert.equal(typeof result.thumbnailFailure?.durationMs, 'number');
  } finally {
    resetModuleState();
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

test('ImageThumbnailWorkerPipelineError can still expose failure detail payloads', () => {
  const error = new ImageThumbnailWorkerPipelineError({
    failureCode: 'worker-timeout',
    failureStage: 'worker-execute',
    retryable: true,
    message: 'timeout',
    durationMs: 123,
    queueWaitMs: 12,
    executeMs: 111,
    timeoutMs: 15_000,
  });

  assert.deepEqual(error.toFailureDetail(), {
    failureCode: 'worker-timeout',
    failureStage: 'worker-execute',
    retryable: true,
    message: 'timeout',
    durationMs: 123,
    environment: undefined,
  });
});
