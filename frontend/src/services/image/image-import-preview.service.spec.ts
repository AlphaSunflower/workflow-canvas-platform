import test from 'node:test';
import assert from 'node:assert/strict';

import { imageImportPreviewService } from './image-import-preview.service';
import { imageOriginalSourceRegistry } from './image-original-source-registry';
import { imageThumbnailRuntimeStore } from './image-thumbnail-runtime-store';
import {
  getCanvasImagePerformanceSnapshot,
  getCanvasImagePerformanceSummary,
  resetCanvasImagePerformanceSnapshot,
} from '@/utils/performance';

test('imageImportPreviewService begin registers processing preview ownership and local file source', () => {
  imageImportPreviewService.clearAll();
  imageOriginalSourceRegistry.clear();

  try {
    const file = new File(['image'], 'draft.png', { type: 'image/png' });
    const snapshot = imageImportPreviewService.begin('node-preview-begin', {
      sessionId: 'session-preview-begin',
      fileId: 'file-preview-begin',
      file,
    });

    assert.equal(snapshot.status, 'processing');
    assert.equal(snapshot.runtimeEntry?.status, 'loading');
    assert.equal(snapshot.runtimeEntry?.sessionId, 'session-preview-begin');
    assert.equal(
      imageOriginalSourceRegistry.getFile('node-preview-begin', 'file-preview-begin'),
      file,
    );
  } finally {
    imageImportPreviewService.clearAll();
    imageOriginalSourceRegistry.clear();
  }
});

test('imageImportPreviewService resolve updates preview to ready and preserves current session ownership', () => {
  imageImportPreviewService.clearAll();

  try {
    imageImportPreviewService.begin('node-preview-ready', {
      sessionId: 'session-preview-ready',
      fileId: 'file-preview-ready',
    });

    const snapshot = imageImportPreviewService.resolve('node-preview-ready', {
      sessionId: 'session-preview-ready',
      fileId: 'file-preview-ready',
      blob: new Blob(['thumb'], { type: 'image/jpeg' }),
      objectUrl: 'blob:preview-ready',
      width: 320,
      height: 200,
      mimeType: 'image/jpeg',
    });

    assert.equal(snapshot.status, 'ready');
    assert.equal(snapshot.runtimeEntry?.status, 'ready');
    assert.equal(snapshot.runtimeEntry?.objectUrl, 'blob:preview-ready');
    assert.equal(imageThumbnailRuntimeStore.getUrl('node-preview-ready'), 'blob:preview-ready');
  } finally {
    imageImportPreviewService.clearAll();
  }
});

test('imageImportPreviewService fail updates preview to error', () => {
  imageImportPreviewService.clearAll();

  try {
    imageImportPreviewService.begin('node-preview-error', {
      sessionId: 'session-preview-error',
      fileId: 'file-preview-error',
    });

    const snapshot = imageImportPreviewService.fail('node-preview-error', {
      sessionId: 'session-preview-error',
      fileId: 'file-preview-error',
      error: 'thumbnail-unavailable',
      failureCode: 'decode-failed',
      message: 'decode failed in worker',
      retryable: false,
      detail: {
        failureCode: 'decode-failed',
        failureStage: 'worker-execute',
        retryable: false,
        message: 'decode failed in worker',
        durationMs: 23,
        environment: {
          hasWorker: true,
          hasCreateImageBitmap: true,
          hasOffscreenCanvas: true,
        },
      },
      attemptCount: 1,
    });

    assert.equal(snapshot.status, 'error');
    assert.equal(snapshot.runtimeEntry?.status, 'error');
    assert.equal(snapshot.runtimeEntry?.error, 'thumbnail-unavailable');
    assert.equal(snapshot.runtimeEntry?.failureCode, 'decode-failed');
    assert.equal(snapshot.runtimeEntry?.failureMessage, 'decode failed in worker');
    assert.equal(snapshot.runtimeEntry?.retryable, false);
    assert.equal(snapshot.runtimeEntry?.lastFailureCode, 'decode-failed');
    assert.equal(snapshot.runtimeEntry?.attemptCount, 1);
    assert.equal(snapshot.runtimeEntry?.failureDetail?.failureStage, 'worker-execute');
  } finally {
    imageImportPreviewService.clearAll();
  }
});

test('imageImportPreviewService clear removes preview runtime state for a node', () => {
  imageImportPreviewService.clearAll();

  imageImportPreviewService.begin('node-preview-clear', {
    sessionId: 'session-preview-clear',
    fileId: 'file-preview-clear',
  });

  imageImportPreviewService.clear('node-preview-clear');

  assert.equal(imageImportPreviewService.getSnapshot('node-preview-clear').status, 'cleared');
  assert.equal(imageThumbnailRuntimeStore.get('node-preview-clear'), null);
  imageImportPreviewService.clearAll();
});

test('imageImportPreviewService exposes processing node ids from preview owner lifecycle', () => {
  imageImportPreviewService.clearAll();

  try {
    const notifications: string[][] = [];
    const unsubscribe = imageImportPreviewService.subscribeProcessingNodeIds(() => {
      notifications.push(Array.from(imageImportPreviewService.getProcessingNodeIds()));
    });

    imageImportPreviewService.begin('node-processing-a', {
      sessionId: 'session-processing-a',
      fileId: 'file-processing-a',
    });
    imageImportPreviewService.begin('node-processing-b', {
      sessionId: 'session-processing-b',
      fileId: 'file-processing-b',
    });
    imageImportPreviewService.resolve('node-processing-a', {
      sessionId: 'session-processing-a',
      fileId: 'file-processing-a',
      objectUrl: 'blob:processing-a',
    });

    const processingNodeIds = new Set(imageImportPreviewService.getProcessingNodeIds());
    assert.equal(processingNodeIds.has('node-processing-a'), false);
    assert.equal(processingNodeIds.has('node-processing-b'), true);

    assert.equal(notifications.length, 3);
    assert.equal(new Set(notifications[0]).has('node-processing-a'), true);
    assert.equal(new Set(notifications[1]).has('node-processing-a'), true);
    assert.equal(new Set(notifications[1]).has('node-processing-b'), true);
    assert.equal(new Set(notifications[2]).has('node-processing-a'), false);
    assert.equal(new Set(notifications[2]).has('node-processing-b'), true);

    unsubscribe();
  } finally {
    imageImportPreviewService.clearAll();
  }
});

test('imageImportPreviewService clearAll also clears processing node ids', () => {
  imageImportPreviewService.clearAll();

  try {
    imageImportPreviewService.begin('node-processing-clear-all-a', {
      sessionId: 'session-processing-clear-all',
      fileId: 'file-processing-clear-all-a',
    });
    imageImportPreviewService.begin('node-processing-clear-all-b', {
      sessionId: 'session-processing-clear-all',
      fileId: 'file-processing-clear-all-b',
    });

    assert.equal(imageImportPreviewService.getProcessingNodeIds().length, 2);

    imageImportPreviewService.clearAll();

    assert.equal(imageImportPreviewService.getProcessingNodeIds().length, 0);
  } finally {
    imageImportPreviewService.clearAll();
  }
});

test('imageImportPreviewService records minimal preview lifecycle diagnostics in dev mode', () => {
  imageImportPreviewService.clearAll();
  resetCanvasImagePerformanceSnapshot();

  try {
    imageImportPreviewService.begin('node-preview-metric', {
      sessionId: 'session-preview-metric',
      fileId: 'file-preview-metric',
    });
    imageImportPreviewService.resolve('node-preview-metric', {
      sessionId: 'session-preview-metric',
      fileId: 'file-preview-metric',
      blob: new Blob(['thumb'], { type: 'image/jpeg' }),
      objectUrl: 'blob:preview-metric',
      width: 240,
      height: 160,
      mimeType: 'image/jpeg',
    });
    imageImportPreviewService.clear('node-preview-metric');

    const lifecycleEvents = getCanvasImagePerformanceSnapshot().lifecycleEvents
      .filter((event) => event.nodeId === 'node-preview-metric')
      .map((event) => event.eventKind);

    if (import.meta.env?.DEV) {
      assert.ok(lifecycleEvents.includes('preview-begin'));
      assert.ok(lifecycleEvents.includes('preview-ready'));
      assert.ok(lifecycleEvents.includes('preview-cleared'));
    } else {
      assert.deepEqual(lifecycleEvents, []);
    }
  } finally {
    imageImportPreviewService.clearAll();
    resetCanvasImagePerformanceSnapshot();
  }
});

test('imageImportPreviewService records structured thumbnail failure detail into diagnostics summary', () => {
  imageImportPreviewService.clearAll();
  resetCanvasImagePerformanceSnapshot();

  try {
    imageImportPreviewService.begin('node-preview-summary-fail', {
      sessionId: 'session-preview-summary-fail',
      fileId: 'file-preview-summary-fail',
    });
    imageImportPreviewService.fail('node-preview-summary-fail', {
      sessionId: 'session-preview-summary-fail',
      fileId: 'file-preview-summary-fail',
      fileName: 'preview-summary-fail.png',
      fileSize: 4096,
      source: 'import',
      error: 'thumbnail-unavailable',
      failureCode: 'decode-failed',
      message: 'decode failed in worker',
      retryable: false,
      detail: {
        failureCode: 'decode-failed',
        failureStage: 'worker-execute',
        retryable: false,
        message: 'decode failed in worker',
        durationMs: 40,
        queueWaitMs: 4,
        executeMs: 36,
        environment: {
          hasWorker: true,
          hasCreateImageBitmap: true,
          hasOffscreenCanvas: true,
        },
      },
      attemptCount: 1,
    });

    const lifecycleEvent = getCanvasImagePerformanceSnapshot().lifecycleEvents.find(
      (event) => event.nodeId === 'node-preview-summary-fail' && event.eventKind === 'preview-failed',
    );
    const summary = getCanvasImagePerformanceSummary();

    if (import.meta.env?.DEV) {
      assert.equal(lifecycleEvent?.detail?.failureCode, 'decode-failed');
      assert.equal(lifecycleEvent?.detail?.failureStage, 'worker-execute');
      assert.equal(lifecycleEvent?.detail?.retryable, false);
      assert.equal(lifecycleEvent?.detail?.fileName, 'preview-summary-fail.png');
      assert.equal(lifecycleEvent?.detail?.fileSize, 4096);
      assert.equal(lifecycleEvent?.detail?.source, 'import');
      assert.equal(summary.thumbnailFailureSummary?.totalFailures, 1);
      assert.deepEqual(summary.thumbnailFailureSummary?.byFailureCode, [
        { key: 'decode-failed', count: 1 },
      ]);
    } else {
      assert.equal(lifecycleEvent, undefined);
      assert.equal(summary.thumbnailFailureSummary?.totalFailures, 0);
    }
  } finally {
    imageImportPreviewService.clearAll();
    resetCanvasImagePerformanceSnapshot();
  }
});
