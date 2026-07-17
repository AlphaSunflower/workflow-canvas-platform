// ==============================================
// 🔒 LOCKED: 性能工具统一导出
// @module utils/performance
// 最后锁定时间：2026-03-25
// 说明：聚合导出所有性能相关工具
// 子模块：PerformanceTracker, debounce, throttle, memoize, idle-callback, batch
// ==============================================

// 类型从 types 层重新导出
export type {
  PerformanceMetric,
  PerformanceTrackerConfig,
  DebouncedFunction,
  ThrottledFunction,
  MemoizedFunction,
  MemoizeOptions,
} from '@/types';

// 性能追踪器
export { 
  PerformanceTracker, 
  performanceTracker,
} from './PerformanceTracker';

// 防抖
export { debounce } from './debounce';

// 节流
export { throttle } from './throttle';

// 记忆化
export { memoize } from './memoize';

// 空闲回调
export { 
  requestIdleCallback, 
  cancelIdleCallback,
} from './idle-callback';

// 批量处理
export { 
  chunkArray, 
  processInBatches,
} from './batch';

export {
  createAsyncTaskQueue,
  runWithConcurrency,
} from './async-pool';

export type {
  AsyncTaskQueueController,
  AsyncTaskQueueStats,
} from './async-pool';

export {
  canvasImagePerformanceMonitor,
  completeCanvasImportBatch,
  getCanvasImageFlickerDebugSnapshot,
  getCanvasImageDiagnosticsConfig,
  getCanvasImagePerformanceSnapshot,
  getCanvasImagePerformanceSummary,
  recordCanvasDragVisibility,
  recordCanvasMoveEndMetric,
  recordCanvasRasterMetric,
  recordCanvasRenderPlanMetric,
  recordCanvasImportStage,
  recordCanvasRuntimeSync,
  registerCanvasImportNodes,
  markCanvasImportEnhancementSettled,
  markCanvasImportEnhancementStarted,
  markCanvasImportPlaceholdersReady,
  recordCanvasImageSessionSnapshot,
  recordCanvasImagePreviewLifecycle,
  recordCanvasImageThumbnailWorkerQueueEvent,
  recordCanvasFileNodeCommit,
  recordCanvasFileNodeRender,
  recordCanvasImageManagerEmit,
  recordCanvasNodePatch,
  recordCanvasNodePatchQueueMetric,
  recordCanvasNodesReferenceChange,
  recordCanvasRasterRebuild,
  reportCanvasImagePerformanceSummary,
  recordCanvasImageResourceSubscription,
  resetCanvasImagePerformanceSnapshot,
  recordCanvasUploadSnapshotRead,
  setCanvasImageDiagnosticsConfig,
  shouldRecordCanvasFileNodeDiagnostics,
  shouldRecordCanvasImageSessionDiagnostics,
  shouldRecordCanvasImageThumbnailWorkerQueueDiagnostics,
  startCanvasImportBatch,
} from './canvas-image-performance';

export {
  clearCanvasPerformanceTrace,
  bindCanvasPerformanceTraceDiagnostics,
  copyCanvasPerformanceTraceSummary,
  downloadCanvasPerformanceTraceJson,
  exportCanvasPerformanceTrace,
  exportCanvasPerformanceTraceJson,
  getCanvasPerformanceTraceStatus,
  isCanvasPerformanceTraceEnabled,
  recordCanvasTraceEvent,
  setCanvasPerformanceTraceEnabled,
  startCanvasPerformanceTrace,
  stopCanvasPerformanceTrace,
} from './canvas-performance-trace-adapter';

export type {
  CanvasImageCacheDebugSummary,
  CanvasImageDiagnosticsConfigSnapshot,
  CanvasImageDragVisibilitySnapshot,
  CanvasImageDragVisibilitySummarySnapshot,
  CanvasImageFileNodeCommitSnapshot,
  CanvasImageFileNodeRenderSummarySnapshot,
  CanvasImageFlickerDebugSnapshot,
  CanvasImageFlickerLoopSnapshot,
  CanvasImageManagerEmitSummarySnapshot,
  CanvasImageMetricAggregateSnapshot,
  CanvasImageImportBatchSnapshot,
  CanvasImageImportStageName,
  CanvasImageImportStageSnapshot,
  CanvasImageImportStageSummarySnapshot,
  CanvasImageLifecycleEventSnapshot,
  CanvasImageLongTaskSnapshot,
  CanvasImageLongTaskSummarySnapshot,
  CanvasImageMemorySampleSnapshot,
  CanvasImageMemorySummarySnapshot,
  CanvasImageNodeLifecycleStats,
  CanvasImagePerformanceSnapshot,
  CanvasImagePerformanceSummarySnapshot,
  CanvasImageRuntimeSyncSnapshot,
  CanvasImageRuntimeSyncSummarySnapshot,
  CanvasNodePatchQueueSummarySnapshot,
  CanvasNodePatchSummarySnapshot,
  CanvasNodesReferenceSummarySnapshot,
  CanvasMoveEndMetricSnapshot,
  CanvasMoveEndMetricSummarySnapshot,
  CanvasRasterMetricSnapshot,
  CanvasRasterMetricSummarySnapshot,
  CanvasRasterRebuildReason,
  CanvasRasterRebuildSummarySnapshot,
  CanvasRenderPlanMetricSnapshot,
  CanvasRenderPlanMetricSummarySnapshot,
  CanvasImageSessionSnapshot,
  CanvasImageSubscriptionSummarySnapshot,
  CanvasImageThumbnailFailureAggregateSnapshot,
  CanvasImageThumbnailFailureSummarySnapshot,
  CanvasImageThumbnailWorkerQueueEventSnapshot,
  CanvasImageThumbnailWorkerQueueSummarySnapshot,
} from './canvas-image-performance';
