import test from 'node:test';
import assert from 'node:assert/strict';

import type { FilePreprocessResult } from '@/services/file/file-preprocess.types';
import {
  buildImportedImageAssets,
  applyImportedImageAssets,
  createLocalImageNodeDraft,
  hasRenderableImagePreview,
} from '@/services/image/image-node';
import { imageImportPreviewService } from '@/services/image/image-import-preview.service';
import { imageOriginalSourceRegistry } from '@/services/image/image-original-source-registry';
import { imageThumbnailRuntimeStore } from '@/services/image/image-thumbnail-runtime-store';
import type { FileNodeData } from '@/types';
import { createDefaultFileNodeData, createSequentialNodeId } from '@/utils';
import {
  mergeInstanceSnapshotNodes,
  patchNodeDataList,
  shouldApplyImportSessionResult,
  shouldBlockLocalCanvasSyncDuringHydration,
  shouldHydrateCanvasFromWorkflow,
  type CanvasSyncNodeLike,
} from './canvas-sync';
import type { FileImportSessionGuard } from '@/types';
import { createThumbnailApplyScheduler } from '@/services/image/thumbnail-apply-scheduler';
import {
  clearCanvasImageFirstPaint,
  clearCanvasImageFirstPaintState,
  hasCanvasImageFirstPainted,
  markCanvasImageFirstPainted,
} from './canvas-image-first-paint-store';
import {
  getCanvasImagePerformanceSummary,
  resetCanvasImagePerformanceSnapshot,
} from '@/utils/performance';

function createImportedImageResult(url = 'blob:thumb-1'): FilePreprocessResult {
  return {
    kind: 'image',
    metadata: {
      width: 1600,
      height: 900,
    },
    thumbnailBlob: new Blob(['thumb'], { type: 'image/jpeg' }),
    thumbnailUrl: url,
    thumbnailMimeType: 'image/jpeg',
    processingMode: 'worker',
  };
}

function createPlaceholderNode(nodeIdValue: number, position = { x: 0, y: 0 }): CanvasSyncNodeLike {
  const nodeId = createSequentialNodeId(nodeIdValue);
  const data = createDefaultFileNodeData(
    nodeId,
    position,
    'image',
    nodeId.value,
    `image-${nodeId.value}.png`,
    1024,
    'image/png',
  );

  data.status = 'processing';

  return {
    id: nodeId.value,
    position,
    data,
  };
}

function runScheduledFrame(task: (() => void) | null): void {
  if (typeof task === 'function') {
    task();
  }
}

test('mergeInstanceSnapshotNodes preserves node data while stale drag snapshots only move nodes', () => {
  imageThumbnailRuntimeStore.clearAll();
  const placeholderOne = createPlaceholderNode(1, { x: 0, y: 0 });
  const placeholderTwo = createPlaceholderNode(2, { x: 180, y: 0 });
  const importedImageAssets = buildImportedImageAssets(placeholderOne.id, createImportedImageResult(), {}, {
    fileId: (placeholderOne.data as FileNodeData).fileId,
  });
  imageImportPreviewService.resolve(placeholderOne.id, {
    sessionId: 'session-1',
    fileId: (placeholderOne.data as FileNodeData).fileId,
    blob: new Blob(['thumb'], { type: 'image/jpeg' }),
    objectUrl: 'blob:thumb-1',
    width: importedImageAssets.metadata?.width,
    height: importedImageAssets.metadata?.height,
    mimeType: 'image/jpeg',
  });
  const enrichedNodeOne: CanvasSyncNodeLike = {
    ...placeholderOne,
    data: applyImportedImageAssets(placeholderOne.data as FileNodeData, 'image', importedImageAssets),
  };

  const staleInstanceSnapshotNodes: CanvasSyncNodeLike[] = [
    {
      ...placeholderOne,
      position: { x: 24, y: 12 },
      data: {
        ...placeholderOne.data,
        position: { x: 24, y: 12 },
      },
    },
    {
      ...placeholderTwo,
      position: { x: 204, y: 12 },
      data: {
        ...placeholderTwo.data,
        position: { x: 204, y: 12 },
      },
    },
  ];

  const mergedNodes = mergeInstanceSnapshotNodes([enrichedNodeOne, placeholderTwo], staleInstanceSnapshotNodes);
  const mergedNodeOne = mergedNodes.find((node) => node.id === enrichedNodeOne.id);
  const mergedNodeOneData = mergedNodeOne?.data as FileNodeData | undefined;

  assert.equal(mergedNodeOne?.position.x, 24);
  assert.equal(mergedNodeOne?.position.y, 12);
  assert.equal(mergedNodeOneData?.thumbnailUrl, undefined);
  assert.equal(mergedNodeOneData?.previewUrl, undefined);
  assert.equal(imageThumbnailRuntimeStore.getUrl(placeholderOne.id), 'blob:thumb-1');
  imageThumbnailRuntimeStore.clearAll();
});

test('patchNodeDataList does not need thumbnail data patches when image enhancement is runtime-only', () => {
  const placeholderOne = createPlaceholderNode(1, { x: 0, y: 0 });
  const placeholderTwo = createPlaceholderNode(2, { x: 180, y: 0 });
  const importedImageAssets = buildImportedImageAssets(placeholderOne.id, createImportedImageResult(), {}, {
    fileId: (placeholderOne.data as FileNodeData).fileId,
  });
  imageImportPreviewService.resolve(placeholderOne.id, {
    sessionId: 'session-2',
    fileId: (placeholderOne.data as FileNodeData).fileId,
    blob: new Blob(['thumb'], { type: 'image/jpeg' }),
    objectUrl: 'blob:thumb-1',
    width: importedImageAssets.metadata?.width,
    height: importedImageAssets.metadata?.height,
    mimeType: 'image/jpeg',
  });

  const { nextNodes, hasUpdated } = patchNodeDataList(
    [placeholderOne, placeholderTwo],
    placeholderOne.id,
    (currentNode) => {
      const nextFileNode = applyImportedImageAssets(currentNode as FileNodeData, 'image', importedImageAssets);
      return {
        imageAsset: nextFileNode.imageAsset,
        metadata: nextFileNode.metadata,
        status: nextFileNode.status,
        timestamp: nextFileNode.timestamp,
      };
    },
  );

  const updatedNodeOne = nextNodes.find((node) => node.id === placeholderOne.id);
  const updatedNodeOneData = updatedNodeOne?.data as FileNodeData | undefined;

  assert.equal(hasUpdated, true);
  assert.equal(updatedNodeOneData?.thumbnailUrl, undefined);
  assert.equal(updatedNodeOneData?.previewUrl, undefined);
  assert.equal(imageThumbnailRuntimeStore.getUrl(placeholderOne.id), 'blob:thumb-1');
  imageThumbnailRuntimeStore.clearAll();
});

test('local import draft registers original file and leaves original object URL out of node data', () => {
  imageOriginalSourceRegistry.clear();
  imageThumbnailRuntimeStore.clearAll();
  const placeholderNode = createPlaceholderNode(1, { x: 0, y: 0 });
  const placeholderData = placeholderNode.data as FileNodeData;
  const file = new File(['image'], 'draft.png', { type: 'image/png' });
  const draft = createLocalImageNodeDraft(placeholderNode.id, file, placeholderData, {
    sessionId: 'session-3',
    fileId: placeholderData.fileId,
  });

  assert.equal(draft.imageAsset?.variants.original?.url, undefined);
  assert.equal(draft.imageAsset?.variants.thumbnail?.url, undefined);
  assert.equal(imageOriginalSourceRegistry.getFile(placeholderNode.id, placeholderData.fileId), file);
  assert.equal(imageThumbnailRuntimeStore.get(placeholderNode.id)?.status, 'loading');
  imageOriginalSourceRegistry.clear();
  imageThumbnailRuntimeStore.clearAll();
});

test('shouldHydrateCanvasFromWorkflow ignores runtime snapshot writes without an explicit hydration bump', () => {
  assert.equal(shouldHydrateCanvasFromWorkflow(7, 7), false);
  assert.equal(shouldHydrateCanvasFromWorkflow(7, 8), true);
});

test('forced canvas runtime flush bypasses external hydration sync guard so save-time reconciliation is not skipped', () => {
  assert.equal(shouldBlockLocalCanvasSyncDuringHydration({
    lastAppliedHydrationVersion: 7,
    nextHydrationVersion: 8,
    hydrationReason: 'external-output',
    pendingExternalHydrationVersion: 8,
    force: false,
  }), true);

  assert.equal(shouldBlockLocalCanvasSyncDuringHydration({
    lastAppliedHydrationVersion: 7,
    nextHydrationVersion: 8,
    hydrationReason: 'external-output',
    pendingExternalHydrationVersion: 8,
    force: true,
  }), false);
});

test('shouldApplyImportSessionResult drops stale import results after node removal or session replacement', () => {
  const placeholderNode = createPlaceholderNode(1, { x: 0, y: 0 });
  const activeSessionGuard: FileImportSessionGuard = {
    nodeId: placeholderNode.id,
    fileId: placeholderNode.id,
    sessionId: 'session-b',
  };

  assert.equal(shouldApplyImportSessionResult([], activeSessionGuard, activeSessionGuard), false);
  assert.equal(shouldApplyImportSessionResult([placeholderNode], {
    ...activeSessionGuard,
    sessionId: 'session-a',
  }, activeSessionGuard), false);
  assert.equal(shouldApplyImportSessionResult([placeholderNode], activeSessionGuard, activeSessionGuard), true);
});

test('local image import draft leaves node data without renderable preview until runtime thumbnail apply completes', () => {
  imageOriginalSourceRegistry.clear();
  imageThumbnailRuntimeStore.clearAll();

  try {
    const placeholderNode = createPlaceholderNode(3, { x: 0, y: 0 });
    const placeholderData = placeholderNode.data as FileNodeData;
    const file = new File(['image'], 'pending-preview.png', { type: 'image/png' });
    const draft = createLocalImageNodeDraft(placeholderNode.id, file, placeholderData, {
      sessionId: 'session-pending-preview',
      fileId: placeholderData.fileId,
    });
    const draftedNode = {
      ...placeholderData,
      ...draft,
    } as FileNodeData;

    assert.equal(hasRenderableImagePreview(draftedNode), false);
    assert.equal(imageThumbnailRuntimeStore.get(placeholderNode.id)?.status, 'loading');
    assert.equal(imageThumbnailRuntimeStore.getUrl(placeholderNode.id), undefined);
  } finally {
    imageOriginalSourceRegistry.clear();
    imageThumbnailRuntimeStore.clearAll();
  }
});

test('stale import session guards can reject an image enhancement result while a loading runtime thumbnail still exists', () => {
  imageThumbnailRuntimeStore.clearAll();

  const placeholderNode = createPlaceholderNode(4, { x: 0, y: 0 });
  const placeholderData = placeholderNode.data as FileNodeData;
  imageThumbnailRuntimeStore.upsert(placeholderNode.id, {
    sessionId: 'session-old',
    status: 'loading',
  });

  const staleGuard: FileImportSessionGuard = {
    nodeId: placeholderNode.id,
    fileId: placeholderData.fileId,
    sessionId: 'session-old',
  };
  const activeGuard: FileImportSessionGuard = {
    ...staleGuard,
    sessionId: 'session-new',
  };

  assert.equal(
    shouldApplyImportSessionResult([placeholderNode], staleGuard, activeGuard),
    false,
  );
  assert.equal(imageThumbnailRuntimeStore.get(placeholderNode.id)?.status, 'loading');
  assert.equal(imageThumbnailRuntimeStore.getUrl(placeholderNode.id), undefined);

  imageThumbnailRuntimeStore.clearAll();
});

test('buildImportedImageAssets can resolve a previously loading runtime thumbnail without writing preview urls into node data', () => {
  imageThumbnailRuntimeStore.clearAll();

  const placeholderNode = createPlaceholderNode(5, { x: 0, y: 0 });
  const placeholderData = placeholderNode.data as FileNodeData;
  imageThumbnailRuntimeStore.upsert(placeholderNode.id, {
    sessionId: 'session-ready',
    status: 'loading',
  });

  const importedImageAssets = buildImportedImageAssets(
    placeholderNode.id,
    createImportedImageResult('blob:thumb-ready'),
    {},
    {
      fileId: placeholderData.fileId,
    }
  );
  imageImportPreviewService.resolve(placeholderNode.id, {
    sessionId: 'session-ready',
    fileId: placeholderData.fileId,
    blob: new Blob(['thumb'], { type: 'image/jpeg' }),
    objectUrl: 'blob:thumb-ready',
    width: importedImageAssets.metadata?.width,
    height: importedImageAssets.metadata?.height,
    mimeType: 'image/jpeg',
  });
  const appliedNode = applyImportedImageAssets(placeholderData, 'image', importedImageAssets);

  assert.equal(importedImageAssets.thumbnailReady, true);
  assert.equal(appliedNode.thumbnailUrl, undefined);
  assert.equal(appliedNode.previewUrl, undefined);
  assert.equal(imageThumbnailRuntimeStore.get(placeholderNode.id)?.status, 'ready');
  assert.equal(imageThumbnailRuntimeStore.getUrl(placeholderNode.id), 'blob:thumb-ready');

  imageThumbnailRuntimeStore.clearAll();
});

test('batch image imports can resolve multiple runtime thumbnails without writing preview urls into node data', () => {
  imageThumbnailRuntimeStore.clearAll();

  const placeholderOne = createPlaceholderNode(6, { x: 0, y: 0 });
  const placeholderTwo = createPlaceholderNode(7, { x: 180, y: 0 });
  const fileNodeOne = placeholderOne.data as FileNodeData;
  const fileNodeTwo = placeholderTwo.data as FileNodeData;

  const importedOne = buildImportedImageAssets(
    placeholderOne.id,
    createImportedImageResult('blob:batch-thumb-1'),
    {},
    {
      fileId: fileNodeOne.fileId,
    },
  );
  const importedTwo = buildImportedImageAssets(
    placeholderTwo.id,
    createImportedImageResult('blob:batch-thumb-2'),
    {},
    {
      fileId: fileNodeTwo.fileId,
    },
  );
  imageImportPreviewService.resolve(placeholderOne.id, {
    sessionId: 'session-batch',
    fileId: fileNodeOne.fileId,
    blob: new Blob(['thumb-1'], { type: 'image/jpeg' }),
    objectUrl: 'blob:batch-thumb-1',
    width: importedOne.metadata?.width,
    height: importedOne.metadata?.height,
    mimeType: 'image/jpeg',
  });
  imageImportPreviewService.resolve(placeholderTwo.id, {
    sessionId: 'session-batch',
    fileId: fileNodeTwo.fileId,
    blob: new Blob(['thumb-2'], { type: 'image/jpeg' }),
    objectUrl: 'blob:batch-thumb-2',
    width: importedTwo.metadata?.width,
    height: importedTwo.metadata?.height,
    mimeType: 'image/jpeg',
  });

  const appliedOne = applyImportedImageAssets(fileNodeOne, 'image', importedOne);
  const appliedTwo = applyImportedImageAssets(fileNodeTwo, 'image', importedTwo);

  assert.equal(importedOne.thumbnailReady, true);
  assert.equal(importedTwo.thumbnailReady, true);
  assert.equal(appliedOne.thumbnailUrl, undefined);
  assert.equal(appliedTwo.thumbnailUrl, undefined);
  assert.equal(imageThumbnailRuntimeStore.getUrl(placeholderOne.id), 'blob:batch-thumb-1');
  assert.equal(imageThumbnailRuntimeStore.getUrl(placeholderTwo.id), 'blob:batch-thumb-2');

  imageThumbnailRuntimeStore.clearAll();
});

test('runtime preview can settle to ready while image node data still has no renderable preview payload for first static paint', () => {
  imageThumbnailRuntimeStore.clearAll();
  imageImportPreviewService.clearAll();

  try {
    const placeholderNode = createPlaceholderNode(11, { x: 0, y: 0 });
    const placeholderData = placeholderNode.data as FileNodeData;
    const file = new File(['image'], 'static-first-paint.png', { type: 'image/png' });
    createLocalImageNodeDraft(placeholderNode.id, file, placeholderData, {
      sessionId: 'session-static-first-paint',
      fileId: placeholderData.fileId,
    });
    const importedImageAssets = buildImportedImageAssets(
      placeholderNode.id,
      createImportedImageResult('blob:static-first-paint'),
      {},
      {
        fileId: placeholderData.fileId,
      },
    );

    imageImportPreviewService.resolve(placeholderNode.id, {
      sessionId: 'session-static-first-paint',
      fileId: placeholderData.fileId,
      blob: new Blob(['thumb'], { type: 'image/jpeg' }),
      objectUrl: 'blob:static-first-paint',
      width: importedImageAssets.metadata?.width,
      height: importedImageAssets.metadata?.height,
      mimeType: 'image/jpeg',
    });

    const appliedNode = applyImportedImageAssets(placeholderData, 'image', importedImageAssets);

    assert.equal(imageImportPreviewService.getSnapshot(placeholderNode.id).status, 'ready');
    assert.equal(imageImportPreviewService.getProcessingNodeIds().includes(placeholderNode.id), false);
    assert.equal(hasRenderableImagePreview(appliedNode), false);
    assert.equal(appliedNode.thumbnailUrl, undefined);
    assert.equal(appliedNode.previewUrl, undefined);
    assert.equal(imageThumbnailRuntimeStore.getUrl(placeholderNode.id), 'blob:static-first-paint');
  } finally {
    imageThumbnailRuntimeStore.clearAll();
    imageImportPreviewService.clearAll();
    imageOriginalSourceRegistry.clear();
  }
});

test('deleted nodes reject stale image enhancement results and keep runtime thumbnails from becoming renderable previews', () => {
  imageThumbnailRuntimeStore.clearAll();

  const placeholderNode = createPlaceholderNode(8, { x: 0, y: 0 });
  const placeholderData = placeholderNode.data as FileNodeData;
  imageThumbnailRuntimeStore.upsert(placeholderNode.id, {
    sessionId: 'session-delete',
    status: 'loading',
  });

  const importGuard: FileImportSessionGuard = {
    nodeId: placeholderNode.id,
    fileId: placeholderData.fileId,
    sessionId: 'session-delete',
  };

  assert.equal(
    shouldApplyImportSessionResult([], importGuard, importGuard),
    false,
  );
  assert.equal(imageThumbnailRuntimeStore.get(placeholderNode.id)?.status, 'loading');
  assert.equal(imageThumbnailRuntimeStore.getUrl(placeholderNode.id), undefined);

  imageThumbnailRuntimeStore.clearAll();
});

test('workflow hydration bump blocks stale local runtime import application until a new hydration version is explicitly applied', () => {
  assert.equal(shouldHydrateCanvasFromWorkflow(10, 11), true);
  assert.equal(shouldHydrateCanvasFromWorkflow(11, 11), false);
});

test('preview owner marks preprocessing failure as error so preview state does not remain permanently loading', () => {
  imageThumbnailRuntimeStore.clearAll();
  resetCanvasImagePerformanceSnapshot();

  const placeholderNode = createPlaceholderNode(9, { x: 0, y: 0 });
  const placeholderData = placeholderNode.data as FileNodeData;

  const importedImageAssets = buildImportedImageAssets(
    placeholderNode.id,
    undefined,
    {
      width: 640,
      height: 360,
    },
    {
      fileId: placeholderData.fileId,
    },
  );
  imageImportPreviewService.fail(placeholderNode.id, {
    sessionId: 'session-preprocess-failure',
    fileId: placeholderData.fileId,
    error: 'thumbnail-unavailable',
    failureCode: 'worker-timeout',
    message: 'Image thumbnail worker timed out',
    retryable: true,
    detail: {
      failureCode: 'worker-timeout',
      failureStage: 'worker-execute',
      retryable: true,
      message: 'Image thumbnail worker timed out',
      durationMs: 15_000,
      environment: {
        hasWorker: true,
        hasCreateImageBitmap: true,
        hasOffscreenCanvas: true,
      },
    },
    attemptCount: 1,
  });

  assert.equal(importedImageAssets.thumbnailReady, false);
  assert.equal(importedImageAssets.thumbnailUnavailable, true);
  assert.equal(importedImageAssets.needsNodePatch, false);
  assert.equal(imageThumbnailRuntimeStore.get(placeholderNode.id)?.status, 'error');
  assert.equal(imageThumbnailRuntimeStore.get(placeholderNode.id)?.error, 'thumbnail-unavailable');
  assert.equal(imageThumbnailRuntimeStore.get(placeholderNode.id)?.failureCode, 'worker-timeout');
  assert.equal(imageThumbnailRuntimeStore.get(placeholderNode.id)?.retryable, true);
  assert.equal(imageThumbnailRuntimeStore.get(placeholderNode.id)?.attemptCount, 1);
  assert.equal(imageThumbnailRuntimeStore.get(placeholderNode.id)?.failureDetail?.failureStage, 'worker-execute');
  if (import.meta.env?.DEV) {
    const summary = getCanvasImagePerformanceSummary();
    assert.equal(summary.thumbnailFailureSummary?.totalFailures, 1);
    assert.deepEqual(summary.thumbnailFailureSummary?.byFailureCode, [
      { key: 'worker-timeout', count: 1 },
    ]);
  }

  imageThumbnailRuntimeStore.clearAll();
  resetCanvasImagePerformanceSnapshot();
});

test('paused thumbnail apply no longer blocks runtime preview readiness before queued node patch flushes', () => {
  imageThumbnailRuntimeStore.clearAll();

  let scheduledFrame: (() => void) | null = null;
  const scheduler = createThumbnailApplyScheduler({
    maxPerFrame: 1,
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      scheduledFrame = () => callback(16);
      return 1;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      scheduledFrame = null;
    }) as typeof window.cancelAnimationFrame,
  });

  const placeholderNode = createPlaceholderNode(10, { x: 0, y: 0 });
  const placeholderData = placeholderNode.data as FileNodeData;
  const file = new File(['image'], 'paused-preview.png', { type: 'image/png' });
  createLocalImageNodeDraft(placeholderNode.id, file, placeholderData, {
    sessionId: 'session-paused-apply',
    fileId: placeholderData.fileId,
  });
  const importedImageAssets = buildImportedImageAssets(
    placeholderNode.id,
    createImportedImageResult('blob:paused-ready'),
    {},
    {
      fileId: placeholderData.fileId,
    },
  );

  imageImportPreviewService.resolve(placeholderNode.id, {
    sessionId: 'session-paused-apply',
    fileId: placeholderData.fileId,
    blob: new Blob(['thumb'], { type: 'image/jpeg' }),
    objectUrl: 'blob:paused-ready',
    width: importedImageAssets.metadata?.width,
    height: importedImageAssets.metadata?.height,
    mimeType: 'image/jpeg',
  });

  scheduler.pause();
  scheduler.enqueue(placeholderNode.id, {
    apply: () => {
      applyImportedImageAssets(placeholderData, 'image', importedImageAssets);
    },
  });

  assert.equal(scheduler.isPaused(), true);
  assert.equal(imageThumbnailRuntimeStore.get(placeholderNode.id)?.status, 'ready');
  assert.equal(imageThumbnailRuntimeStore.getUrl(placeholderNode.id), 'blob:paused-ready');

  scheduler.resume();
  scheduler.flush();
  runScheduledFrame(scheduledFrame);

  assert.equal(imageThumbnailRuntimeStore.get(placeholderNode.id)?.status, 'ready');
  assert.equal(imageThumbnailRuntimeStore.getUrl(placeholderNode.id), 'blob:paused-ready');

  scheduler.clear();
  imageThumbnailRuntimeStore.clearAll();
  imageOriginalSourceRegistry.clear();
});

test('disposing queued thumbnail apply should not reinterpret a successful image import as failed', () => {
  let settledSuccess: boolean | undefined;
  let disposed = false;
  let applied = false;

  const scheduler = createThumbnailApplyScheduler({
    maxPerFrame: 1,
    requestAnimationFrameImpl: (() => 1) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => undefined) as typeof window.cancelAnimationFrame,
  });

  const success = true;
  let hasSettled = false;
  const settleTask = (nextSuccess: boolean): void => {
    if (hasSettled) {
      return;
    }

    hasSettled = true;
    settledSuccess = nextSuccess;
  };

  scheduler.enqueue('node-disposed-thumbnail-apply', {
    apply: (): void => {
      applied = true;
      settleTask(success);
    },
    dispose: (): void => {
      disposed = true;
      settleTask(success);
    },
  });

  scheduler.clear();

  assert.equal(disposed, true);
  assert.equal(applied, false);
  assert.equal(settledSuccess, true);
});

test('thumbnail apply flush drains only the requested release-frame limit before rescheduling', () => {
  let scheduledFrame: (() => void) | null = null;
  let frameScheduleCount = 0;
  const applied: string[] = [];

  const scheduler = createThumbnailApplyScheduler({
    maxPerFrame: 1,
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameScheduleCount += 1;
      scheduledFrame = () => callback(16);
      return frameScheduleCount;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      scheduledFrame = null;
    }) as typeof window.cancelAnimationFrame,
  });

  scheduler.pause();
  scheduler.enqueue('node-1', {
    apply: () => {
      applied.push('node-1');
    },
  });
  scheduler.enqueue('node-2', {
    apply: () => {
      applied.push('node-2');
    },
  });
  scheduler.enqueue('node-3', {
    apply: () => {
      applied.push('node-3');
    },
  });

  scheduler.resume();
  scheduler.flush({ limit: 1 });

  assert.deepEqual(applied, ['node-1']);
  assert.equal(scheduler.getPendingCount(), 2);
  assert.equal(typeof scheduledFrame, 'function');

  runScheduledFrame(scheduledFrame);

  assert.deepEqual(applied, ['node-1', 'node-2']);
  assert.equal(scheduler.getPendingCount(), 1);

  scheduler.clear();
});

test('thumbnail apply scheduler uses dynamic per-frame pressure limit', () => {
  let scheduledFrame: (() => void) | null = null;
  let dynamicLimit = 1;
  let frameScheduleCount = 0;
  const applied: string[] = [];

  const scheduler = createThumbnailApplyScheduler({
    maxPerFrame: 3,
    getMaxPerFrame: () => dynamicLimit,
    requestAnimationFrameImpl: ((callback: FrameRequestCallback) => {
      frameScheduleCount += 1;
      scheduledFrame = () => callback(16);
      return frameScheduleCount;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrameImpl: (() => {
      scheduledFrame = null;
    }) as typeof window.cancelAnimationFrame,
  });

  scheduler.enqueue('node-1', {
    apply: () => {
      applied.push('node-1');
    },
  });
  scheduler.enqueue('node-2', {
    apply: () => {
      applied.push('node-2');
    },
  });
  scheduler.enqueue('node-3', {
    apply: () => {
      applied.push('node-3');
    },
  });

  runScheduledFrame(scheduledFrame);

  assert.deepEqual(applied, ['node-1']);
  assert.equal(scheduler.getPendingCount(), 2);

  dynamicLimit = 2;
  runScheduledFrame(scheduledFrame);

  assert.deepEqual(applied, ['node-1', 'node-2', 'node-3']);
  assert.equal(scheduler.getPendingCount(), 0);

  scheduler.clear();
});

test('preview owner processing set tracks queued image previews until settlement', () => {
  imageThumbnailRuntimeStore.clearAll();
  imageImportPreviewService.clearAll();

  try {
    imageImportPreviewService.begin('queued-node-1', {
      sessionId: 'session-queued',
      fileId: 'file-queued-1',
    });
    imageImportPreviewService.begin('queued-node-2', {
      sessionId: 'session-queued',
      fileId: 'file-queued-2',
    });

    const processingNodeIds = new Set(imageImportPreviewService.getProcessingNodeIds());
    assert.equal(processingNodeIds.has('queued-node-1'), true);
    assert.equal(processingNodeIds.has('queued-node-2'), true);

    imageImportPreviewService.fail('queued-node-1', {
      sessionId: 'session-queued',
      fileId: 'file-queued-1',
      error: 'thumbnail-unavailable',
    });
    imageImportPreviewService.clear('queued-node-2');

    const remainingNodeIds = new Set(imageImportPreviewService.getProcessingNodeIds());
    assert.equal(remainingNodeIds.has('queued-node-1'), false);
    assert.equal(remainingNodeIds.has('queued-node-2'), false);
  } finally {
    imageThumbnailRuntimeStore.clearAll();
    imageImportPreviewService.clearAll();
  }
});

test('preview owner processing set drains fully for 3 queued image previews instead of leaving later items stuck', () => {
  imageThumbnailRuntimeStore.clearAll();
  imageImportPreviewService.clearAll();

  try {
    const queuedEntries = [
      { nodeId: 'queued-node-3-1', fileId: 'file-queued-3-1' },
      { nodeId: 'queued-node-3-2', fileId: 'file-queued-3-2' },
      { nodeId: 'queued-node-3-3', fileId: 'file-queued-3-3' },
    ];

    queuedEntries.forEach((entry) => {
      imageImportPreviewService.begin(entry.nodeId, {
        sessionId: 'session-queued-3',
        fileId: entry.fileId,
      });
    });

    const processingNodeIds = new Set(imageImportPreviewService.getProcessingNodeIds());
    assert.equal(processingNodeIds.has('queued-node-3-1'), true);
    assert.equal(processingNodeIds.has('queued-node-3-2'), true);
    assert.equal(processingNodeIds.has('queued-node-3-3'), true);

    imageImportPreviewService.resolve('queued-node-3-1', {
      sessionId: 'session-queued-3',
      fileId: 'file-queued-3-1',
      blob: new Blob(['thumb-1'], { type: 'image/jpeg' }),
      objectUrl: 'blob:queued-3-1',
      width: 640,
      height: 360,
      mimeType: 'image/jpeg',
    });
    imageImportPreviewService.resolve('queued-node-3-2', {
      sessionId: 'session-queued-3',
      fileId: 'file-queued-3-2',
      blob: new Blob(['thumb-2'], { type: 'image/jpeg' }),
      objectUrl: 'blob:queued-3-2',
      width: 640,
      height: 360,
      mimeType: 'image/jpeg',
    });
    imageImportPreviewService.fail('queued-node-3-3', {
      sessionId: 'session-queued-3',
      fileId: 'file-queued-3-3',
      error: 'thumbnail-unavailable',
    });

    const remainingNodeIds = new Set(imageImportPreviewService.getProcessingNodeIds());
    assert.equal(remainingNodeIds.size, 0);
  } finally {
    imageThumbnailRuntimeStore.clearAll();
    imageImportPreviewService.clearAll();
  }
});

test('clearing a deleted image node runtime also clears first-paint state so node id reuse cannot inherit painted status', () => {
  clearCanvasImageFirstPaintState();

  markCanvasImageFirstPainted('reused-image-node', 'blob:deleted-node-thumb');
  assert.equal(hasCanvasImageFirstPainted('reused-image-node', 'blob:deleted-node-thumb'), true);

  clearCanvasImageFirstPaint('reused-image-node');

  assert.equal(hasCanvasImageFirstPainted('reused-image-node', 'blob:deleted-node-thumb'), false);
  clearCanvasImageFirstPaintState();
});

test('workflow-level first-paint reset clears painted state before a new import batch reuses the same node id', () => {
  clearCanvasImageFirstPaintState();

  markCanvasImageFirstPainted('batch-node-1', 'blob:old-workflow-thumb');
  assert.equal(hasCanvasImageFirstPainted('batch-node-1', 'blob:old-workflow-thumb'), true);

  clearCanvasImageFirstPaintState();

  assert.equal(hasCanvasImageFirstPainted('batch-node-1', 'blob:old-workflow-thumb'), false);
  assert.equal(hasCanvasImageFirstPainted('batch-node-1', 'blob:new-workflow-thumb'), false);
});
