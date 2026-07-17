// ==============================================
// 🔒 LOCKED: 性能工具统一导出
// @module utils/performance
// 最后锁定时间：2026-03-25
// 说明：聚合导出所有性能相关工具
// 子模块：PerformanceTracker, debounce, throttle, memoize, idle-callback, batch
// ==============================================
// 性能追踪器
export { PerformanceTracker, performanceTracker, } from './PerformanceTracker';
// 防抖
export { debounce } from './debounce';
// 节流
export { throttle } from './throttle';
// 记忆化
export { memoize } from './memoize';
// 空闲回调
export { requestIdleCallback, cancelIdleCallback, } from './idle-callback';
// 批量处理
export { chunkArray, processInBatches, } from './batch';
export { createAsyncTaskQueue, runWithConcurrency, } from './async-pool';
export { canvasImagePerformanceMonitor, completeCanvasImportBatch, getCanvasImageFlickerDebugSnapshot, getCanvasImageDiagnosticsConfig, getCanvasImagePerformanceSnapshot, getCanvasImagePerformanceSummary, recordCanvasDragVisibility, recordCanvasImportStage, recordCanvasRuntimeSync, registerCanvasImportNodes, markCanvasImportEnhancementSettled, markCanvasImportEnhancementStarted, markCanvasImportPlaceholdersReady, recordCanvasImageSessionSnapshot, recordCanvasImagePreviewLifecycle, recordCanvasImageThumbnailWorkerQueueEvent, recordCanvasFileNodeCommit, recordCanvasFileNodeRender, reportCanvasImagePerformanceSummary, recordCanvasImageResourceSubscription, resetCanvasImagePerformanceSnapshot, recordCanvasUploadSnapshotRead, setCanvasImageDiagnosticsConfig, shouldRecordCanvasFileNodeDiagnostics, shouldRecordCanvasImageSessionDiagnostics, shouldRecordCanvasImageThumbnailWorkerQueueDiagnostics, startCanvasImportBatch, } from './canvas-image-performance';
