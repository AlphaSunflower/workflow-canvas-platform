import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCanvasRenderPlanPressure,
  getCanvasImagePerformanceSnapshot,
  getCanvasImagePerformanceSummary,
  recordCanvasFileNodeRender,
  recordCanvasImageManagerEmit,
  recordCanvasMoveEndMetric,
  recordCanvasNodePatch,
  recordCanvasNodePatchQueueMetric,
  recordCanvasNodesReferenceChange,
  recordCanvasRasterMetric,
  recordCanvasRasterRebuild,
  recordCanvasRenderPlanMetric,
  resetCanvasImagePerformanceSnapshot,
  setCanvasImageDiagnosticsConfig,
  type CanvasImageCacheDebugSummary,
  type CanvasImageDragVisibilitySummarySnapshot,
  type CanvasImageFileNodeRenderSummarySnapshot,
  type CanvasImageLongTaskSummarySnapshot,
  type CanvasImageRuntimeSyncSummarySnapshot,
  type CanvasImageSessionSnapshot,
} from './canvas-image-performance';

function resetDiagnostics(enabled: boolean): void {
  resetCanvasImagePerformanceSnapshot();
  setCanvasImageDiagnosticsConfig({
    enabled,
    verbose: false,
    autoReport: false,
  });
}

function createSession(nodeCount: number): CanvasImageSessionSnapshot {
  return {
    nodeCount,
    imageNodeCount: Math.floor(nodeCount / 2),
    visibleNodeCount: Math.max(1, Math.floor(nodeCount * 0.12)),
    nearViewportNodeCount: Math.max(1, Math.floor(nodeCount * 0.2)),
    selectedNodeCount: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1440, height: 900 },
    recordedAt: 1,
  };
}

function createDragSummary(
  nodeCount: number,
  maxDurationMs = 8,
): CanvasImageDragVisibilitySummarySnapshot {
  return {
    totalComputations: 30,
    totalBatchCommits: 30,
    totalDurationMs: 120,
    maxDurationMs,
    averageDurationMs: 4,
    maxNodeCount: nodeCount,
  };
}

function createLongTaskSummary(maxDurationMs?: number): CanvasImageLongTaskSummarySnapshot {
  return {
    count: maxDurationMs ? 1 : 0,
    totalDurationMs: maxDurationMs ?? 0,
    maxDurationMs,
  };
}

function createRuntimeSyncSummary(maxDurationMs?: number): CanvasImageRuntimeSyncSummarySnapshot {
  return {
    totalWrites: 1,
    totalDurationMs: maxDurationMs ?? 0,
    maxDurationMs,
  };
}

function createFileRenderSummary(count: number): CanvasImageFileNodeRenderSummarySnapshot[] {
  return Array.from({ length: count }, (_, index) => ({
    nodeId: `node-${index}`,
    fileName: `node-${index}.png`,
    nodeType: 'image' as const,
    renderCount: 1,
    commitCount: 1,
    dragCommitCount: 0,
    totalCommitMs: 1,
    averageCommitMs: 1,
    maxCommitMs: 1,
    firstRecordedAt: 1,
    lastRecordedAt: 1,
  }));
}

function createCache(overrides: Partial<CanvasImageCacheDebugSummary> = {}): CanvasImageCacheDebugSummary {
  return {
    entryCount: 0,
    resourceEntryCount: 0,
    objectUrlEntryCount: 0,
    canvasResourceEntryCount: 0,
    originalEntryCount: 0,
    visibleEntryCount: 0,
    nearViewportEntryCount: 0,
    thumbnailEntryCount: 0,
    inflightRequestCount: 0,
    evictionCount: 0,
    revocationCount: 0,
    decodedReleaseCount: 0,
    ...overrides,
  };
}

test('evaluateCanvasRenderPlanPressure classifies 100, 500, and 1000 node scales', () => {
  const common = {
    fileNodeRenderSummary: createFileRenderSummary(10),
    longTaskSummary: createLongTaskSummary(),
    runtimeSyncSummary: createRuntimeSyncSummary(),
    cache: createCache(),
  };

  assert.equal(evaluateCanvasRenderPlanPressure({
    ...common,
    canvasSession: createSession(100),
    dragVisibilitySummary: createDragSummary(100),
  }).scale, 'medium');

  assert.equal(evaluateCanvasRenderPlanPressure({
    ...common,
    canvasSession: createSession(500),
    dragVisibilitySummary: createDragSummary(500),
  }).scale, 'large');

  assert.equal(evaluateCanvasRenderPlanPressure({
    ...common,
    canvasSession: createSession(1000),
    dragVisibilitySummary: createDragSummary(1000),
  }).scale, 'stress');
});

test('evaluateCanvasRenderPlanPressure reports pass, watch, and fail threshold states', () => {
  const pass = evaluateCanvasRenderPlanPressure({
    canvasSession: createSession(500),
    dragVisibilitySummary: createDragSummary(500, 10),
    fileNodeRenderSummary: createFileRenderSummary(20),
    longTaskSummary: createLongTaskSummary(),
    runtimeSyncSummary: createRuntimeSyncSummary(),
    cache: createCache({ thumbnailByteUsageRatio: 0.4 }),
  });

  assert.equal(pass.status, 'pass');
  assert.deepEqual(pass.watchReasons, []);

  const watch = evaluateCanvasRenderPlanPressure({
    canvasSession: createSession(500),
    dragVisibilitySummary: createDragSummary(500, 20),
    fileNodeRenderSummary: createFileRenderSummary(20),
    longTaskSummary: createLongTaskSummary(60),
    runtimeSyncSummary: createRuntimeSyncSummary(),
    cache: createCache({ thumbnailByteUsageRatio: 0.97 }),
  });

  assert.equal(watch.status, 'watch');
  assert.equal(watch.watchReasons.includes('long-task-over-50ms'), true);
  assert.equal(watch.watchReasons.includes('drag-visibility-over-16ms'), true);
  assert.equal(watch.watchReasons.includes('thumbnail-cache-over-95-percent'), true);

  const fail = evaluateCanvasRenderPlanPressure({
    canvasSession: createSession(1000),
    dragVisibilitySummary: createDragSummary(1000, 40),
    fileNodeRenderSummary: createFileRenderSummary(20),
    longTaskSummary: createLongTaskSummary(140),
    runtimeSyncSummary: createRuntimeSyncSummary(150),
    cache: createCache(),
  });

  assert.equal(fail.status, 'fail');
  assert.equal(fail.watchReasons.includes('long-task-over-120ms'), true);
  assert.equal(fail.watchReasons.includes('drag-visibility-over-32ms'), true);
  assert.equal(fail.watchReasons.includes('runtime-sync-over-120ms'), true);
});

test('canvas performance diagnostics are not recorded while disabled', () => {
  resetDiagnostics(false);

  recordCanvasRenderPlanMetric({
    nodeCount: 20,
    renderedNodeCount: 10,
    renderedEdgeCount: 3,
    fullNodeCount: 4,
    compactNodeCount: 3,
    minimalNodeCount: 3,
    proxyNodeCount: 1,
    placeholderNodeCount: 2,
    detachedNodeCount: 2,
    hiddenEdgeCount: 1,
    rasterEligibleNodeCount: 4,
    reusedNodeCount: 6,
    createdNodeCount: 4,
    durationMs: 5,
  });
  recordCanvasRasterMetric({
    reason: 'items-built',
    candidateNodeCount: 8,
    itemCount: 5,
    registeredNodeCount: 0,
    requestedNodeCount: 0,
    activeImageNodeCount: 1,
    readyItemCount: 2,
    loadingItemCount: 2,
    unavailableItemCount: 1,
    durationMs: 3,
  });
  recordCanvasMoveEndMetric({
    importing: true,
    totalDurationMs: 12,
    resumeSchedulingMs: 1,
    viewportSyncMs: 2,
    dragVisibilityFlushMs: 3,
    imageWorkFlushMs: 4,
    workflowSyncScheduleMs: 2,
    visibilityApplyMs: 1,
    resourceScheduleMs: 1,
    patchQueueFlushMs: 1,
    workflowViewportSyncMs: 1,
  });
  recordCanvasFileNodeRender({
    nodeId: 'node-1',
    nodeType: 'image',
    fileName: 'node-1.png',
    commitDurationMs: 7,
    dragging: true,
  });
  recordCanvasImageManagerEmit({
    nodeId: 'node-1',
    mode: 'canvas',
    recordedAt: 100,
  });
  recordCanvasRasterRebuild({
    reason: 'items-built',
    candidateNodeCount: 8,
    itemCount: 5,
    durationMs: 2,
    recordedAt: 101,
  });
  recordCanvasNodePatch({
    nodeId: 'node-1',
    reason: 'image-import-enhancement-apply',
    batchId: 'batch-1',
    sync: true,
    hasUpdated: true,
    recordedAt: 102,
  });
  recordCanvasNodesReferenceChange({
    nodeCount: 20,
    reason: 'canvas-nodes-state-reference',
    recordedAt: 103,
  });
  recordCanvasNodePatchQueueMetric({
    pendingCount: 4,
    enqueueCount: 4,
    recordedAt: 104,
  });

  const snapshot = getCanvasImagePerformanceSnapshot();
  assert.equal(snapshot.renderPlanMetrics.length, 0);
  assert.equal(snapshot.rasterMetrics.length, 0);
  assert.equal(snapshot.moveEndMetrics.length, 0);
  assert.equal(snapshot.fileNodeRenderSummary.length, 0);
  assert.equal(snapshot.imageManagerEmitSummary.totalEmits, 0);
  assert.equal(snapshot.rasterRebuildSummary.totalRebuilds, 0);
  assert.equal(snapshot.nodePatchSummary.totalAttempts, 0);
  assert.equal(snapshot.nodesReferenceSummary.totalChanges, 0);
  assert.equal(snapshot.nodePatchQueueSummary.enqueueCount, 0);
});

test('canvas performance diagnostics aggregate render raster move-end and FileNode metrics', () => {
  resetDiagnostics(true);

  recordCanvasRenderPlanMetric({
    nodeCount: 100,
    renderedNodeCount: 40,
    renderedEdgeCount: 12,
    fullNodeCount: 18,
    compactNodeCount: 10,
    minimalNodeCount: 12,
    proxyNodeCount: 10,
    placeholderNodeCount: 12,
    detachedNodeCount: 12,
    hiddenEdgeCount: 4,
    rasterEligibleNodeCount: 16,
    reusedNodeCount: 22,
    createdNodeCount: 18,
    durationMs: 6,
    recordedAt: 100,
  });
  recordCanvasRasterMetric({
    reason: 'items-built',
    candidateNodeCount: 16,
    itemCount: 14,
    registeredNodeCount: 0,
    requestedNodeCount: 0,
    activeImageNodeCount: 2,
    readyItemCount: 8,
    loadingItemCount: 4,
    unavailableItemCount: 2,
    durationMs: 5,
    recordedAt: 110,
  });
  recordCanvasRasterMetric({
    reason: 'resources-requested',
    candidateNodeCount: 16,
    itemCount: 14,
    registeredNodeCount: 16,
    requestedNodeCount: 16,
    activeImageNodeCount: 2,
    readyItemCount: 8,
    loadingItemCount: 4,
    unavailableItemCount: 2,
    durationMs: 9,
    recordedAt: 120,
  });
  recordCanvasMoveEndMetric({
    importing: false,
    totalDurationMs: 30,
    resumeSchedulingMs: 2,
    viewportSyncMs: 4,
    dragVisibilityFlushMs: 8,
    imageWorkFlushMs: 10,
    workflowSyncScheduleMs: 6,
    visibilityApplyMs: 7,
    resourceScheduleMs: 3,
    patchQueueFlushMs: 2,
    workflowViewportSyncMs: 5,
    recordedAt: 130,
  });
  recordCanvasFileNodeRender({
    nodeId: 'image-1',
    nodeType: 'image',
    fileName: 'image-1.png',
    commitDurationMs: 11,
    dragging: false,
    recordedAt: 140,
  });
  recordCanvasFileNodeRender({
    nodeId: 'image-1',
    nodeType: 'image',
    fileName: 'image-1.png',
    commitDurationMs: 13,
    dragging: true,
    recordedAt: 150,
  });
  recordCanvasImageManagerEmit({
    nodeId: 'image-1',
    mode: 'canvas',
    recordedAt: 160,
  });
  recordCanvasImageManagerEmit({
    nodeId: 'image-1',
    mode: 'original',
    recordedAt: 260,
  });
  recordCanvasImageManagerEmit({
    nodeId: 'image-2',
    mode: 'canvas',
    recordedAt: 360,
  });
  recordCanvasRasterRebuild({
    reason: 'items-built',
    candidateNodeCount: 16,
    itemCount: 14,
    durationMs: 4,
    recordedAt: 170,
  });
  recordCanvasRasterRebuild({
    reason: 'resource-subscription',
    candidateNodeCount: 16,
    itemCount: 14,
    recordedAt: 180,
  });
  recordCanvasNodePatch({
    nodeId: 'image-1',
    reason: 'image-import-enhancement-apply',
    batchId: 'batch-1',
    sync: true,
    hasUpdated: true,
    recordedAt: 190,
  });
  recordCanvasNodePatch({
    nodeId: 'image-1',
    reason: 'image-import-enhancement-apply',
    batchId: 'batch-1',
    sync: true,
    hasUpdated: false,
    recordedAt: 200,
  });
  recordCanvasNodePatch({
    nodeId: 'image-2',
    reason: 'thumbnail-apply',
    batchId: 'batch-1',
    sync: false,
    hasUpdated: true,
    recordedAt: 210,
  });
  recordCanvasNodesReferenceChange({
    nodeCount: 100,
    reason: 'canvas-nodes-state-reference',
    recordedAt: 220,
  });
  recordCanvasNodesReferenceChange({
    nodeCount: 101,
    reason: 'canvas-nodes-state-reference',
    recordedAt: 320,
  });
  recordCanvasNodePatchQueueMetric({
    pendingCount: 6,
    enqueueCount: 6,
    recordedAt: 230,
  });
  recordCanvasNodePatchQueueMetric({
    pendingCount: 2,
    flushCount: 1,
    flushDurationMs: 5,
    recordedAt: 240,
  });

  const snapshot = getCanvasImagePerformanceSnapshot();
  assert.equal(snapshot.renderPlanMetrics.length, 1);
  assert.equal(snapshot.renderPlanMetrics[0]?.nodeCount, 100);
  assert.equal(snapshot.renderPlanMetrics[0]?.reusedNodeCount, 22);
  assert.equal(snapshot.renderPlanMetrics[0]?.createdNodeCount, 18);
  assert.equal(snapshot.rasterMetrics.length, 2);
  assert.equal(snapshot.rasterMetrics[0]?.reason, 'resources-requested');
  assert.equal(snapshot.rasterMetrics[0]?.registeredNodeCount, 16);
  assert.equal(snapshot.moveEndMetrics.length, 1);
  assert.equal(snapshot.moveEndMetrics[0]?.imageWorkFlushMs, 10);
  assert.equal(snapshot.moveEndMetrics[0]?.visibilityApplyMs, 7);
  assert.equal(snapshot.moveEndMetrics[0]?.resourceScheduleMs, 3);
  assert.equal(snapshot.moveEndMetrics[0]?.patchQueueFlushMs, 2);
  assert.equal(snapshot.moveEndMetrics[0]?.workflowViewportSyncMs, 5);
  assert.equal(snapshot.fileNodeRenderSummary.length, 1);
  assert.equal(snapshot.fileNodeRenderSummary[0]?.commitCount, 2);
  assert.equal(snapshot.fileNodeRenderSummary[0]?.dragCommitCount, 1);
  assert.equal(snapshot.fileNodeRenderSummary[0]?.averageCommitMs, 12);
  assert.equal(snapshot.imageManagerEmitSummary.totalEmits, 3);
  assert.equal(snapshot.imageManagerEmitSummary.canvasEmits, 2);
  assert.equal(snapshot.imageManagerEmitSummary.originalEmits, 1);
  assert.equal(snapshot.imageManagerEmitSummary.uniqueNodeCount, 2);
  assert.equal(snapshot.rasterRebuildSummary.totalRebuilds, 2);
  assert.equal(snapshot.rasterRebuildSummary.byReason[0]?.key, 'items-built');
  assert.equal(snapshot.rasterRebuildSummary.byReason[1]?.key, 'resource-subscription');
  assert.equal(snapshot.nodePatchSummary.totalAttempts, 3);
  assert.equal(snapshot.nodePatchSummary.totalUpdated, 2);
  assert.equal(snapshot.nodePatchSummary.totalSkipped, 1);
  assert.equal(snapshot.nodePatchSummary.maxAttemptsPerNode, 2);
  assert.equal(snapshot.nodesReferenceSummary.totalChanges, 2);
  assert.equal(snapshot.nodesReferenceSummary.maxNodeCount, 101);
  assert.equal(snapshot.nodePatchQueueSummary.pendingCount, 2);
  assert.equal(snapshot.nodePatchQueueSummary.maxPendingCount, 6);
  assert.equal(snapshot.nodePatchQueueSummary.enqueueCount, 6);
  assert.equal(snapshot.nodePatchQueueSummary.flushCount, 1);
  assert.equal(snapshot.nodePatchQueueSummary.totalFlushDurationMs, 5);

  const summary = getCanvasImagePerformanceSummary();
  assert.equal(summary.renderPlanSummary.totalPlans, 1);
  assert.equal(summary.renderPlanSummary.lastFullNodeCount, 18);
  assert.equal(summary.renderPlanSummary.lastReusedNodeCount, 22);
  assert.equal(summary.rasterSummary.totalEvents, 2);
  assert.equal(summary.rasterSummary.lastReason, 'resources-requested');
  assert.equal(summary.rasterSummary.maxRequestedNodeCount, 16);
  assert.equal(summary.moveEndSummary.totalEvents, 1);
  assert.equal(summary.moveEndSummary.maxDragVisibilityFlushMs, 8);
  assert.equal(summary.moveEndSummary.maxVisibilityApplyMs, 7);
  assert.equal(summary.moveEndSummary.maxResourceScheduleMs, 3);
  assert.equal(summary.moveEndSummary.maxPatchQueueFlushMs, 2);
  assert.equal(summary.moveEndSummary.maxWorkflowViewportSyncMs, 5);
  assert.equal(summary.fileNodeRenderSummary[0]?.maxCommitMs, 13);
  assert.equal(summary.imageManagerEmitSummary.totalEmits, 3);
  assert.equal(summary.rasterRebuildSummary.totalRebuilds, 2);
  assert.equal(summary.nodePatchSummary.byReason.find((entry) => entry.key === 'image-import-enhancement-apply')?.count, 2);
  assert.equal(summary.nodePatchSummary.byBatchId.find((entry) => entry.key === 'batch-1')?.count, 3);
  assert.equal(summary.nodesReferenceSummary.totalChanges, 2);
  assert.equal(summary.nodePatchQueueSummary.flushCount, 1);

  resetDiagnostics(false);
});
