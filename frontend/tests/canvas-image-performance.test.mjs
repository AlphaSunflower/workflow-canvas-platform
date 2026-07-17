import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completeCanvasImportBatch,
  getCanvasImagePerformanceSnapshot,
  getCanvasImagePerformanceSummary,
  markCanvasImportEnhancementSettled,
  markCanvasImportEnhancementStarted,
  markCanvasImportPlaceholdersReady,
  recordCanvasImageManagerEmit,
  recordCanvasNodePatch,
  recordCanvasNodePatchQueueMetric,
  recordCanvasNodesReferenceChange,
  recordCanvasImagePreviewLifecycle,
  recordCanvasImageThumbnailWorkerQueueEvent,
  recordCanvasImportStage,
  recordCanvasRasterRebuild,
  recordCanvasRuntimeSync,
  recordCanvasFileNodeCommit,
  registerCanvasImportNodes,
  resetCanvasImagePerformanceSnapshot,
  setCanvasImageDiagnosticsConfig,
  startCanvasImportBatch,
} from '../dist-tests/src/utils/performance/canvas-image-performance.js';

test.beforeEach(() => {
  resetCanvasImagePerformanceSnapshot();
});

test.afterEach(() => {
  setCanvasImageDiagnosticsConfig({
    enabled: false,
    verbose: false,
    autoReport: false,
  });
  resetCanvasImagePerformanceSnapshot();
});

test('canvas image performance monitor exposes canvas performance pressure counters', () => {
  setCanvasImageDiagnosticsConfig({
    enabled: true,
    verbose: false,
    autoReport: false,
  });

  recordCanvasImageManagerEmit({
    nodeId: 'node-1',
    mode: 'canvas',
    recordedAt: 100,
  });
  recordCanvasImageManagerEmit({
    nodeId: 'node-1',
    mode: 'canvas',
    recordedAt: 200,
  });
  recordCanvasImageManagerEmit({
    nodeId: 'node-2',
    mode: 'original',
    recordedAt: 300,
  });
  recordCanvasRasterRebuild({
    reason: 'items-built',
    candidateNodeCount: 3,
    itemCount: 2,
    durationMs: 4,
    recordedAt: 110,
  });
  recordCanvasRasterRebuild({
    reason: 'resource-subscription',
    candidateNodeCount: 3,
    itemCount: 2,
    recordedAt: 120,
  });
  recordCanvasNodePatch({
    nodeId: 'node-1',
    reason: 'image-import-enhancement-apply',
    batchId: 'batch-1',
    sync: true,
    hasUpdated: true,
    recordedAt: 130,
  });
  recordCanvasNodePatch({
    nodeId: 'node-1',
    reason: 'image-import-enhancement-apply',
    batchId: 'batch-1',
    sync: true,
    hasUpdated: false,
    recordedAt: 140,
  });
  recordCanvasNodesReferenceChange({
    nodeCount: 20,
    reason: 'canvas-nodes-state-reference',
    recordedAt: 150,
  });
  recordCanvasNodePatchQueueMetric({
    pendingCount: 5,
    enqueueCount: 5,
    recordedAt: 160,
  });
  recordCanvasNodePatchQueueMetric({
    pendingCount: 1,
    flushCount: 1,
    flushDurationMs: 6,
    recordedAt: 170,
  });

  const summary = getCanvasImagePerformanceSummary();

  assert.equal(summary.imageManagerEmitSummary.totalEmits, 3);
  assert.equal(summary.imageManagerEmitSummary.canvasEmits, 2);
  assert.equal(summary.imageManagerEmitSummary.originalEmits, 1);
  assert.equal(summary.imageManagerEmitSummary.uniqueNodeCount, 2);
  assert.equal(summary.rasterRebuildSummary.totalRebuilds, 2);
  assert.equal(summary.rasterRebuildSummary.maxCandidateNodeCount, 3);
  assert.equal(summary.rasterRebuildSummary.byReason.find((entry) => entry.key === 'items-built')?.count, 1);
  assert.equal(summary.nodePatchSummary.totalAttempts, 2);
  assert.equal(summary.nodePatchSummary.totalUpdated, 1);
  assert.equal(summary.nodePatchSummary.totalSkipped, 1);
  assert.equal(summary.nodePatchSummary.maxAttemptsPerNode, 2);
  assert.equal(summary.nodesReferenceSummary.totalChanges, 1);
  assert.equal(summary.nodesReferenceSummary.lastNodeCount, 20);
  assert.equal(summary.nodePatchQueueSummary.pendingCount, 1);
  assert.equal(summary.nodePatchQueueSummary.maxPendingCount, 5);
  assert.equal(summary.nodePatchQueueSummary.flushCount, 1);
  assert.equal(summary.nodePatchQueueSummary.totalFlushDurationMs, 6);
});

test('canvas image performance monitor records import batch lifecycle metrics', () => {
  startCanvasImportBatch('batch-1', 3, 100);
  registerCanvasImportNodes({
    batchId: 'batch-1',
    nodes: [
      { nodeId: 'node-1', nodeType: 'image', fileName: 'alpha.png' },
      { nodeId: 'node-2', nodeType: 'image', fileName: 'beta.png' },
      { nodeId: 'node-3', nodeType: 'video', fileName: 'clip.mp4' },
    ],
  });
  recordCanvasImportStage({
    batchId: 'batch-1',
    stage: 'layout-probe',
    startedAt: 110,
    completedAt: 150,
    durationMs: 40,
    itemCount: 3,
  });
  recordCanvasImportStage({
    batchId: 'batch-1',
    stage: 'node-hydration',
    startedAt: 151,
    completedAt: 155,
    durationMs: 4,
    nodeId: 'node-1',
    nodeType: 'image',
    fileName: 'alpha.png',
  });
  markCanvasImportPlaceholdersReady('batch-1');
  markCanvasImportEnhancementStarted('batch-1');
  markCanvasImportEnhancementStarted('batch-1');
  markCanvasImportEnhancementSettled('batch-1');
  markCanvasImportEnhancementSettled('batch-1');
  recordCanvasRuntimeSync({
    batchId: 'batch-1',
    reason: 'import-placeholder-insert',
    nodeCount: 3,
    connectionCount: 0,
    durationMs: 12,
    snapshotBuildMs: 3,
    metadataNormalizeMs: 4,
    actionCommitMs: 5,
    recordedAt: 180,
  });
  recordCanvasRuntimeSync({
    batchId: 'batch-1',
    reason: 'import-enhancement-apply',
    nodeCount: 3,
    connectionCount: 0,
    durationMs: 15,
    recordedAt: 280,
  });
  recordCanvasFileNodeCommit({
    nodeId: 'node-1',
    nodeType: 'image',
    fileName: 'alpha.png',
    selected: false,
    dragging: false,
    status: 'idle',
    placeholder: 'ready',
    activeVariantKind: 'thumbnail',
    viewerStatus: 'ready',
    requestEventKind: 'load-succeeded',
    resourceStatus: 'ready',
  });
  recordCanvasFileNodeCommit({
    nodeId: 'node-2',
    nodeType: 'image',
    fileName: 'beta.png',
    selected: false,
    dragging: false,
    status: 'idle',
    placeholder: 'ready',
    activeVariantKind: 'thumbnail',
    viewerStatus: 'ready',
    requestEventKind: 'load-succeeded',
    resourceStatus: 'ready',
  });
  completeCanvasImportBatch('batch-1', 2, 1);

  const snapshot = getCanvasImagePerformanceSnapshot();
  assert.equal(snapshot.importBatches.length, 1);
  assert.equal(snapshot.importBatches[0]?.batchId, 'batch-1');
  assert.equal(snapshot.importBatches[0]?.total, 3);
  assert.equal(snapshot.importBatches[0]?.thumbnailReadyTargetCount, 2);
  assert.equal(snapshot.importBatches[0]?.completed, 2);
  assert.equal(snapshot.importBatches[0]?.failed, 1);
  assert.equal(snapshot.importBatches[0]?.pendingEnhancements, 0);
  assert.equal(snapshot.importBatches[0]?.enhancedNodes, 2);
  assert.equal(snapshot.importBatches[0]?.thumbnailReadyNodes, 2);
  assert.equal(typeof snapshot.importBatches[0]?.firstCanvasThumbnailReadyMs, 'number');
  assert.equal(typeof snapshot.importBatches[0]?.allCanvasThumbnailReadyMs, 'number');
  assert.equal(typeof snapshot.importBatches[0]?.responseMs, 'number');
  assert.equal(typeof snapshot.importBatches[0]?.totalMs, 'number');
  assert.equal(typeof snapshot.importBatches[0]?.enhancementMs, 'number');
  assert.equal(snapshot.importBatches[0]?.runtimeSyncCount, 2);
  assert.equal(snapshot.importBatches[0]?.runtimeSyncTotalMs, 27);
  assert.equal(snapshot.importBatches[0]?.runtimeSyncMaxMs, 15);
  assert.equal(snapshot.importBatches[0]?.stageSummary.find((entry) => entry.stage === 'layout-probe')?.count, 1);
  assert.equal(snapshot.importBatches[0]?.stageSummary.find((entry) => entry.stage === 'canvas-thumbnail-ready')?.count, 2);
  assert.equal(snapshot.runtimeSyncs.length, 2);
  assert.equal(snapshot.runtimeSyncSummary.totalWrites, 2);
  assert.equal(snapshot.runtimeSyncSummary.totalDurationMs, 27);
  assert.equal(snapshot.runtimeSyncSummary.lastBatchId, 'batch-1');
  assert.equal(snapshot.longTaskSummary.count, 0);
});

test('canvas image performance monitor records image thumbnail worker queue diagnostics separately from import batches', () => {
  recordCanvasImageThumbnailWorkerQueueEvent({
    eventKind: 'task-enqueued',
    taskId: 'image-thumbnail-1',
    activeTaskId: null,
    queuedTaskCount: 1,
    activeTaskCount: 0,
    totalTaskCount: 1,
    restartCount: 0,
    timeoutCount: 0,
    errorCount: 0,
    recordedAt: 100,
  });
  recordCanvasImageThumbnailWorkerQueueEvent({
    eventKind: 'task-started',
    taskId: 'image-thumbnail-1',
    activeTaskId: 'image-thumbnail-1',
    queuedTaskCount: 0,
    activeTaskCount: 1,
    totalTaskCount: 1,
    restartCount: 0,
    timeoutCount: 0,
    errorCount: 0,
    recordedAt: 110,
  });
  recordCanvasImageThumbnailWorkerQueueEvent({
    eventKind: 'worker-timeout',
    taskId: 'image-thumbnail-1',
    activeTaskId: 'image-thumbnail-1',
    queuedTaskCount: 2,
    activeTaskCount: 1,
    totalTaskCount: 3,
    restartCount: 0,
    timeoutCount: 1,
    errorCount: 0,
    detail: {
      timeoutMs: 15000,
      queueWaitMs: 10,
      executeMs: 15000,
      durationMs: 15010,
      failureStage: 'worker-execute',
      retryable: true,
      errorCode: 'worker-timeout',
      errorMessage: 'Image thumbnail worker timed out',
    },
    recordedAt: 120,
  });
  recordCanvasImageThumbnailWorkerQueueEvent({
    eventKind: 'worker-restart',
    taskId: 'image-thumbnail-1',
    activeTaskId: null,
    queuedTaskCount: 2,
    activeTaskCount: 0,
    totalTaskCount: 2,
    restartCount: 1,
    timeoutCount: 1,
    errorCount: 0,
    recordedAt: 121,
  });

  const snapshot = getCanvasImagePerformanceSnapshot();

  assert.equal(snapshot.importBatches.length, 0);
  if (import.meta.env?.DEV) {
    assert.equal(snapshot.imageThumbnailWorkerQueueEvents.length, 4);
    assert.equal(snapshot.imageThumbnailWorkerQueueEvents[0]?.eventKind, 'worker-restart');
    assert.equal(snapshot.imageThumbnailWorkerQueueSummary.lastEventKind, 'worker-restart');
    assert.equal(snapshot.imageThumbnailWorkerQueueSummary.restartCount, 1);
    assert.equal(snapshot.imageThumbnailWorkerQueueSummary.timeoutCount, 1);
    assert.equal(snapshot.imageThumbnailWorkerQueueSummary.totalTaskCount, 2);
  } else {
    assert.equal(snapshot.imageThumbnailWorkerQueueEvents.length, 0);
    assert.equal(snapshot.imageThumbnailWorkerQueueSummary.eventCount, 0);
  }
});

test('canvas image performance summary aggregates thumbnail failures from preview and worker diagnostics', () => {
  recordCanvasImagePreviewLifecycle({
    nodeId: 'node-preview-failed',
    fileName: 'preview-failed.png',
    fileId: 'file-preview-failed',
    sessionId: 'session-preview-failed',
    eventKind: 'preview-failed',
    error: 'thumbnail-unavailable',
    placeholder: 'unavailable',
    detail: {
      failureCode: 'decode-failed',
      failureStage: 'worker-execute',
      retryable: false,
      message: 'decode failed in worker',
      durationMs: 33,
      queueWaitMs: 3,
      executeMs: 30,
      fileName: 'preview-failed.png',
      fileSize: 2048,
      source: 'import',
    },
  });
  recordCanvasImageThumbnailWorkerQueueEvent({
    eventKind: 'worker-timeout',
    taskId: 'image-thumbnail-2',
    activeTaskId: 'image-thumbnail-2',
    queuedTaskCount: 0,
    activeTaskCount: 1,
    totalTaskCount: 1,
    restartCount: 0,
    timeoutCount: 1,
    errorCount: 0,
    detail: {
      timeoutMs: 15000,
      queueWaitMs: 9,
      executeMs: 15000,
      durationMs: 15009,
      failureStage: 'worker-execute',
      retryable: true,
      errorCode: 'worker-timeout',
      errorMessage: 'Image thumbnail worker timed out',
      fileName: 'timeout.png',
      fileSize: 4096,
      source: 'worker-queue',
    },
    recordedAt: 200,
  });

  const summary = getCanvasImagePerformanceSummary();

  if (import.meta.env?.DEV) {
    assert.equal(summary.thumbnailFailureSummary?.totalFailures, 2);
    assert.deepEqual(summary.thumbnailFailureSummary?.byFailureCode, [
      { key: 'decode-failed', count: 1 },
      { key: 'worker-timeout', count: 1 },
    ]);
    assert.deepEqual(summary.thumbnailFailureSummary?.byFailureStage, [
      { key: 'worker-execute', count: 2 },
    ]);
    assert.deepEqual(summary.thumbnailFailureSummary?.byRetryable, [
      { key: 'false', count: 1 },
      { key: 'true', count: 1 },
    ]);
  } else {
    assert.equal(summary.thumbnailFailureSummary?.totalFailures, 0);
  }
});

test('canvas image performance monitor accumulates file node commit counts by node id', () => {
  recordCanvasFileNodeCommit({
    nodeId: 'node-1',
    nodeType: 'image',
    fileName: 'alpha.png',
    selected: false,
    dragging: false,
    status: 'idle',
    placeholder: 'ready',
    activeVariantKind: 'thumbnail',
    viewerStatus: undefined,
  });
  recordCanvasFileNodeCommit({
    nodeId: 'node-1',
    nodeType: 'image',
    fileName: 'alpha.png',
    selected: true,
    dragging: false,
    status: 'idle',
    placeholder: 'ready',
    activeVariantKind: 'thumbnail',
    viewerStatus: 'ready',
  });
  recordCanvasFileNodeCommit({
    nodeId: 'node-2',
    nodeType: 'video',
    fileName: 'beta.mp4',
    selected: false,
    dragging: true,
    status: 'processing',
    placeholder: 'loading',
    activeVariantKind: undefined,
    viewerStatus: undefined,
  });

  const snapshot = getCanvasImagePerformanceSnapshot();
  const nodeOne = snapshot.fileNodeCommits.find((entry) => entry.nodeId === 'node-1');
  const nodeTwo = snapshot.fileNodeCommits.find((entry) => entry.nodeId === 'node-2');

  assert.equal(nodeOne?.commits, 2);
  assert.equal(nodeOne?.selected, true);
  assert.equal(nodeOne?.activeVariantKind, 'thumbnail');
  assert.equal(nodeOne?.viewerStatus, 'ready');
  assert.equal(nodeTwo?.commits, 1);
  assert.equal(nodeTwo?.dragging, true);
  assert.equal(nodeTwo?.placeholder, 'loading');
});
