import { createModuleLogger } from '../logger';
import type {
  ImageThumbnailFailureCode,
  ImageThumbnailFailureDetail,
  ImageThumbnailFailureStage,
} from '@/services/file/image-thumbnail-diagnostics.types';
import {
  bindCanvasPerformanceTraceDiagnostics,
  recordCanvasTraceEvent,
} from './canvas-performance-trace-adapter';

type FileNodeMetricType = 'image' | 'video' | 'ply';
type FileNodePlaceholderState = 'hidden' | 'loading' | 'unavailable' | 'ready' | 'default';
type ImageLifecycleMode = 'canvas' | 'original';
type CanvasImageMetricDetailValue = string | number | boolean | null | undefined;
type CanvasImageMetricDetail = Record<string, CanvasImageMetricDetailValue>;

const log = createModuleLogger('canvas-image-performance');
export type CanvasImageImportStageName =
  | 'layout-probe'
  | 'layout-positioning'
  | 'placeholder-batch-build'
  | 'placeholder-insert'
  | 'node-hydration'
  | 'enhancement-preprocess'
  | 'canvas-thumbnail-ready';
type CanvasImageImportStageStatus = 'completed' | 'failed' | 'skipped';
type ImageLifecycleEventKind =
  | 'register'
  | 'request-queued'
  | 'request-started'
  | 'load-succeeded'
  | 'load-failed'
  | 'release'
  | 'visibility-updated'
  | 'cooldown-released'
  | 'retry-scheduled'
  | 'preview-begin'
  | 'preview-ready'
  | 'preview-failed'
  | 'preview-cleared';
type ImageLifecycleEventClassification = 'current' | 'stale';
type ImageThumbnailWorkerQueueEventKind =
  | 'task-enqueued'
  | 'task-started'
  | 'task-succeeded'
  | 'task-failed'
  | 'task-cancelled'
  | 'worker-timeout'
  | 'worker-error'
  | 'worker-restart';

export interface CanvasImageLongTaskSnapshot {
  name: string;
  startTime: number;
  duration: number;
}

export interface CanvasImageLongTaskSummarySnapshot {
  count: number;
  totalDurationMs: number;
  maxDurationMs?: number;
}

export interface CanvasImageImportStageSnapshot {
  stage: CanvasImageImportStageName;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  status: CanvasImageImportStageStatus;
  nodeId?: string;
  nodeType?: FileNodeMetricType;
  fileName?: string;
  itemCount?: number;
  detail?: CanvasImageMetricDetail;
}

export interface CanvasImageImportStageSummarySnapshot {
  stage: CanvasImageImportStageName;
  count: number;
  failed: number;
  totalMs: number;
  maxMs: number;
  minMs: number;
  averageMs: number;
  firstStartedAt: number;
  lastCompletedAt: number;
}

export interface CanvasImageRuntimeSyncSnapshot {
  syncId: number;
  batchId?: string;
  reason: string;
  nodeCount: number;
  connectionCount: number;
  durationMs: number;
  snapshotBuildMs?: number;
  metadataNormalizeMs?: number;
  actionCommitMs?: number;
  recordedAt: number;
}

export interface CanvasImageRuntimeSyncSummarySnapshot {
  totalWrites: number;
  totalDurationMs: number;
  maxDurationMs?: number;
  averageDurationMs?: number;
  writesPerSecond?: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
  lastBatchId?: string;
  lastNodeCount?: number;
  lastConnectionCount?: number;
}

export interface CanvasImageDragVisibilitySnapshot {
  commitId: number;
  reason: 'frame' | 'flush';
  nodeCount: number;
  visibleNodeCount: number;
  nearViewportNodeCount: number;
  durationMs: number;
  computeMs: number;
  applyMs: number;
  recordedAt: number;
}

export interface CanvasImageDragVisibilitySummarySnapshot {
  totalComputations: number;
  totalBatchCommits: number;
  totalDurationMs: number;
  maxDurationMs?: number;
  averageDurationMs?: number;
  computationsPerSecond?: number;
  batchCommitsPerSecond?: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
  maxNodeCount?: number;
}

export interface CanvasRenderPlanMetricSnapshot {
  metricId: number;
  nodeCount: number;
  renderedNodeCount: number;
  renderedEdgeCount: number;
  fullNodeCount: number;
  compactNodeCount: number;
  minimalNodeCount: number;
  proxyNodeCount: number;
  imageFullDomNodeCount?: number;
  imageShellNodeCount?: number;
  imageObjectLayerCount?: number;
  placeholderNodeCount: number;
  detachedNodeCount: number;
  hiddenEdgeCount: number;
  rasterEligibleNodeCount: number;
  reusedNodeCount?: number;
  createdNodeCount?: number;
  durationMs?: number;
  recordedAt: number;
}

export interface CanvasRenderPlanMetricSummarySnapshot {
  totalPlans: number;
  totalDurationMs: number;
  maxDurationMs?: number;
  averageDurationMs?: number;
  lastNodeCount?: number;
  lastRenderedNodeCount?: number;
  lastRenderedEdgeCount?: number;
  lastFullNodeCount?: number;
  lastCompactNodeCount?: number;
  lastMinimalNodeCount?: number;
  lastProxyNodeCount?: number;
  lastImageFullDomNodeCount?: number;
  lastImageShellNodeCount?: number;
  lastImageObjectLayerCount?: number;
  lastPlaceholderNodeCount?: number;
  lastRasterEligibleNodeCount?: number;
  lastReusedNodeCount?: number;
  lastCreatedNodeCount?: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
}

export interface CanvasRasterMetricSnapshot {
  metricId: number;
  reason: 'items-built' | 'resources-requested' | 'draw';
  candidateNodeCount: number;
  itemCount: number;
  registeredNodeCount: number;
  requestedNodeCount: number;
  activeImageNodeCount?: number;
  readyItemCount?: number;
  loadingItemCount?: number;
  unavailableItemCount?: number;
  drawnItemCount?: number;
  deferredItemCount?: number;
  lodSkippedItemCount?: number;
  budgetExhausted?: boolean;
  textureUploadCount?: number;
  textureEvictedCount?: number;
  textureRetainedCount?: number;
  textureByteEstimate?: number;
  activeSpriteCount?: number;
  spritePoolSize?: number;
  durationMs?: number;
  recordedAt: number;
}

export interface CanvasRasterMetricSummarySnapshot {
  totalEvents: number;
  totalDurationMs: number;
  maxDurationMs?: number;
  averageDurationMs?: number;
  lastReason?: CanvasRasterMetricSnapshot['reason'];
  lastCandidateNodeCount?: number;
  lastItemCount?: number;
  lastRegisteredNodeCount?: number;
  lastRequestedNodeCount?: number;
  maxCandidateNodeCount?: number;
  maxItemCount?: number;
  maxRegisteredNodeCount?: number;
  maxRequestedNodeCount?: number;
  lastTextureUploadCount?: number;
  lastTextureEvictedCount?: number;
  lastTextureRetainedCount?: number;
  lastTextureByteEstimate?: number;
  lastActiveSpriteCount?: number;
  lastSpritePoolSize?: number;
  maxTextureRetainedCount?: number;
  maxTextureByteEstimate?: number;
  maxActiveSpriteCount?: number;
  maxSpritePoolSize?: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
}

export interface CanvasImageMetricAggregateSnapshot {
  key: string;
  count: number;
}

export interface CanvasImageManagerEmitSummarySnapshot {
  totalEmits: number;
  canvasEmits: number;
  originalEmits: number;
  uniqueNodeCount: number;
  emitsPerSecond?: number;
  canvasEmitsPerSecond?: number;
  originalEmitsPerSecond?: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
  lastNodeId?: string;
  lastMode?: ImageLifecycleMode;
}

export type CanvasRasterRebuildReason =
  | 'items-built'
  | 'ready-store-snapshot'
  | 'resource-subscription'
  | 'runtime-thumbnail-subscription'
  | 'deferred-reuse';

export interface CanvasRasterRebuildSummarySnapshot {
  totalRebuilds: number;
  totalDurationMs: number;
  maxDurationMs?: number;
  averageDurationMs?: number;
  rebuildsPerSecond?: number;
  byReason: CanvasImageMetricAggregateSnapshot[];
  maxCandidateNodeCount?: number;
  maxItemCount?: number;
  lastReason?: CanvasRasterRebuildReason;
  lastCandidateNodeCount?: number;
  lastItemCount?: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
}

export interface CanvasNodePatchSummarySnapshot {
  totalAttempts: number;
  totalUpdated: number;
  totalSkipped: number;
  uniqueNodeCount: number;
  maxAttemptsPerNode: number;
  patchesPerSecond?: number;
  byReason: CanvasImageMetricAggregateSnapshot[];
  byBatchId: CanvasImageMetricAggregateSnapshot[];
  firstRecordedAt?: number;
  lastRecordedAt?: number;
  lastNodeId?: string;
  lastReason?: string;
  lastBatchId?: string;
}

export interface CanvasNodesReferenceSummarySnapshot {
  totalChanges: number;
  changesPerSecond?: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
  lastNodeCount?: number;
  maxNodeCount?: number;
  lastReason?: string;
}

export interface CanvasNodePatchQueueSummarySnapshot {
  pendingCount: number;
  maxPendingCount: number;
  enqueueCount: number;
  flushCount: number;
  totalFlushDurationMs: number;
  maxFlushDurationMs?: number;
  averageFlushDurationMs?: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
}

export interface CanvasMoveEndMetricSnapshot {
  metricId: number;
  importing: boolean;
  totalDurationMs: number;
  resumeSchedulingMs: number;
  viewportSyncMs: number;
  dragVisibilityFlushMs: number;
  imageWorkFlushMs: number;
  workflowSyncScheduleMs: number;
  visibilityApplyMs: number;
  resourceScheduleMs: number;
  patchQueueFlushMs: number;
  workflowViewportSyncMs: number;
  recordedAt: number;
}

export interface CanvasMoveEndMetricSummarySnapshot {
  totalEvents: number;
  totalDurationMs: number;
  maxDurationMs?: number;
  averageDurationMs?: number;
  importingEvents: number;
  maxDragVisibilityFlushMs?: number;
  maxImageWorkFlushMs?: number;
  maxVisibilityApplyMs?: number;
  maxResourceScheduleMs?: number;
  maxPatchQueueFlushMs?: number;
  maxWorkflowViewportSyncMs?: number;
  maxViewportSyncMs?: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
}

export interface CanvasImageDiagnosticsConfigSnapshot {
  enabled: boolean;
  verbose: boolean;
  autoReport: boolean;
  dragDetailSampleInterval: number;
  fileNodeCommitThrottleMs: number;
  sessionSnapshotThrottleMs: number;
  summaryReportThrottleMs: number;
}

export interface CanvasImagePerformanceSummarySnapshot {
  recordedAt: number;
  diagnostics: CanvasImageDiagnosticsConfigSnapshot;
  longTaskSummary: CanvasImageLongTaskSummarySnapshot;
  runtimeSyncSummary: CanvasImageRuntimeSyncSummarySnapshot;
  dragVisibilitySummary: CanvasImageDragVisibilitySummarySnapshot;
  latestDragVisibilityCommit?: CanvasImageDragVisibilitySnapshot;
  renderPlanSummary: CanvasRenderPlanMetricSummarySnapshot;
  latestRenderPlan?: CanvasRenderPlanMetricSnapshot;
  rasterSummary: CanvasRasterMetricSummarySnapshot;
  latestRasterMetric?: CanvasRasterMetricSnapshot;
  imageManagerEmitSummary: CanvasImageManagerEmitSummarySnapshot;
  rasterRebuildSummary: CanvasRasterRebuildSummarySnapshot;
  nodePatchSummary: CanvasNodePatchSummarySnapshot;
  nodesReferenceSummary: CanvasNodesReferenceSummarySnapshot;
  nodePatchQueueSummary: CanvasNodePatchQueueSummarySnapshot;
  moveEndSummary: CanvasMoveEndMetricSummarySnapshot;
  latestMoveEndMetric?: CanvasMoveEndMetricSnapshot;
  fileNodeRenderSummary: CanvasImageFileNodeRenderSummarySnapshot[];
  subscriptionSummary: CanvasImageSubscriptionSummarySnapshot;
  memorySummary: CanvasImageMemorySummarySnapshot;
  canvasSession?: CanvasImageSessionSnapshot;
  cache?: CanvasImageCacheDebugSummary;
  renderPlanPressure: CanvasRenderPlanPressureSnapshot;
  imageThumbnailWorkerQueue?: CanvasImageThumbnailWorkerQueueSummarySnapshot;
  thumbnailFailureSummary?: CanvasImageThumbnailFailureSummarySnapshot;
}

export type CanvasRenderPlanPressureScale = 'small' | 'medium' | 'large' | 'stress';
export type CanvasRenderPlanPressureStatus = 'pass' | 'watch' | 'fail';

export interface CanvasRenderPlanPressureSnapshot {
  scale: CanvasRenderPlanPressureScale;
  status: CanvasRenderPlanPressureStatus;
  nodeCount: number;
  visibleNodeCount: number;
  nearViewportNodeCount: number;
  dragMaxNodeCount: number;
  fileNodeRenderCount: number;
  imageCacheVisibleEntryCount: number;
  imageCacheNearViewportEntryCount: number;
  thumbnailByteUsageRatio?: number;
  longTaskMaxDurationMs?: number;
  dragVisibilityMaxDurationMs?: number;
  runtimeSyncMaxDurationMs?: number;
  watchReasons: string[];
}

export interface CanvasImageThumbnailFailureAggregateSnapshot {
  key: string;
  count: number;
}

export interface CanvasImageThumbnailFailureSummarySnapshot {
  totalFailures: number;
  byFailureCode: CanvasImageThumbnailFailureAggregateSnapshot[];
  byFailureStage: CanvasImageThumbnailFailureAggregateSnapshot[];
  byRetryable: CanvasImageThumbnailFailureAggregateSnapshot[];
}

export interface CanvasImageImportBatchSnapshot {
  batchId: string;
  total: number;
  thumbnailReadyTargetCount: number;
  completed: number;
  failed: number;
  startedAt: number;
  placeholdersReadyAt?: number;
  batchCompletedAt?: number;
  enhancementStartedAt?: number;
  enhancementSettledAt?: number;
  responseMs?: number;
  totalMs?: number;
  enhancementMs?: number;
  pendingEnhancements: number;
  enhancedNodes: number;
  thumbnailReadyNodes: number;
  firstCanvasThumbnailReadyAt?: number;
  allCanvasThumbnailReadyAt?: number;
  firstCanvasThumbnailReadyMs?: number;
  allCanvasThumbnailReadyMs?: number;
  stages: CanvasImageImportStageSnapshot[];
  stageSummary: CanvasImageImportStageSummarySnapshot[];
  longTaskCount: number;
  longTaskTotalMs: number;
  maxLongTaskMs?: number;
  runtimeSyncCount: number;
  runtimeSyncWritesPerSecond?: number;
  runtimeSyncTotalMs: number;
  runtimeSyncMaxMs?: number;
  lastRuntimeSyncAt?: number;
}

export interface CanvasImageFileNodeCommitSnapshot {
  nodeId: string;
  nodeType: FileNodeMetricType;
  fileName: string;
  commits: number;
  selected: boolean;
  dragging: boolean;
  status: string;
  placeholder: FileNodePlaceholderState;
  renderTier?: string;
  activeState?: string;
  activeVariantKind?: string;
  viewerStatus?: string;
  resourceStatus?: string;
  resourcePhase?: string;
  requestKey?: string;
  requestEventKind?: string;
  requestEventClassification?: ImageLifecycleEventClassification;
  requestEventReason?: string;
  requestSwitchReason?: string;
  attemptedUrl?: string;
  src?: string;
  isVisible?: boolean;
  isNearViewport?: boolean;
  displayWidth?: number;
  displayHeight?: number;
  lastCommittedAt: number;
}

export interface CanvasImageSessionSnapshot {
  nodeCount: number;
  imageNodeCount: number;
  visibleNodeCount: number;
  nearViewportNodeCount: number;
  selectedNodeCount: number;
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
  containerSize: {
    width: number;
    height: number;
  };
  workflowId?: string;
  recordedAt: number;
}

export interface CanvasImageLifecycleEventSnapshot {
  eventId: number;
  nodeId: string;
  mode: ImageLifecycleMode;
  fileName?: string;
  eventKind: ImageLifecycleEventKind;
  classification?: ImageLifecycleEventClassification;
  requestKey?: string;
  switchReason?: string;
  eventReason?: string;
  attemptedUrl?: string;
  src?: string;
  resourceStatus?: string;
  resourcePhase?: string;
  activeVariantKind?: string;
  placeholder?: FileNodePlaceholderState;
  isVisible?: boolean;
  isNearViewport?: boolean;
  detail?: CanvasImageMetricDetail;
  recordedAt: number;
}

export interface CanvasImageNodeLifecycleStats {
  nodeId: string;
  mode: ImageLifecycleMode;
  fileName?: string;
  totalEvents: number;
  registerCount: number;
  requestStartedCount: number;
  loadSucceededCount: number;
  releaseCount: number;
  loadFailedCount: number;
  currentRequestKey?: string;
  lastEventKind?: ImageLifecycleEventKind;
  lastRequestKey?: string;
  lastSwitchReason?: string;
  lastAttemptedUrl?: string;
  lastResourcePhase?: string;
  lastRecordedAt: number;
  requestAfterReleaseCount: number;
  readyReleaseRequestLoopCount: number;
}

export interface CanvasImageFlickerLoopSnapshot {
  nodeId: string;
  mode: ImageLifecycleMode;
  fileName?: string;
  loopCount: number;
  requestAfterReleaseCount: number;
  releaseCount: number;
  requestStartedCount: number;
  lastRequestKey?: string;
  lastSwitchReason?: string;
  lastAttemptedUrl?: string;
  lastResourcePhase?: string;
  lastRecordedAt: number;
}

export interface CanvasImageCacheDebugSummary {
  entryCount: number;
  resourceEntryCount: number;
  objectUrlEntryCount: number;
  canvasResourceEntryCount: number;
  originalEntryCount: number;
  visibleEntryCount: number;
  nearViewportEntryCount: number;
  thumbnailEntryCount: number;
  inflightRequestCount: number;
  subscriptionCount?: number;
  canvasSubscriptionCount?: number;
  originalSubscriptionCount?: number;
  nodesWithSubscribers?: number;
  evictionCount: number;
  revocationCount: number;
  decodedReleaseCount: number;
  thumbnailEntryLimit?: number;
  resourceEntryLimit?: number;
  originalEntryLimit?: number;
  thumbnailBytes?: number;
  canvasBytes?: number;
  originalBytes?: number;
  totalBytes?: number;
  maxCanvasBytes?: number;
  maxOriginalBytes?: number;
  maxThumbnailBytes?: number;
  canvasByteUsageRatio?: number;
  originalByteUsageRatio?: number;
  thumbnailByteUsageRatio?: number;
  hitCount?: number;
  missCount?: number;
  retryAttemptCount?: number;
  retrySuppressedCount?: number;
  retryRecoveredCount?: number;
  budgetScene?: string;
  budgetTier?: string;
  budgetDensity?: string;
  budgetImageNodeCount?: number;
  budgetImportingNodeCount?: number;
}

export interface CanvasImageFileNodeRenderSummarySnapshot {
  nodeId: string;
  fileName: string;
  nodeType: FileNodeMetricType;
  renderCount: number;
  commitCount: number;
  dragCommitCount: number;
  totalCommitMs: number;
  averageCommitMs: number;
  maxCommitMs: number;
  commitsPerSecond?: number;
  firstRecordedAt: number;
  lastRecordedAt: number;
}

export interface CanvasImageSubscriptionSummarySnapshot {
  totalSubscriptions: number;
  peakSubscriptions: number;
  canvasSubscriptions: number;
  originalSubscriptions: number;
  totalSubscribeCalls: number;
  totalUnsubscribeCalls: number;
  uniqueSubscribedNodes: number;
  activeNodesWithSubscriptions: number;
  canvasSubscribeCalls: number;
  originalSubscribeCalls: number;
  uploadSnapshotReadCount: number;
  uploadNodesObserved: number;
}

export interface CanvasImageMemorySampleSnapshot {
  sampledAt: number;
  usedJSHeapSize?: number;
  totalJSHeapSize?: number;
  jsHeapSizeLimit?: number;
  longTaskCountSinceLastSample: number;
  longTaskDurationSinceLastSample: number;
}

export interface CanvasImageMemorySummarySnapshot {
  sampleCount: number;
  latestSample?: CanvasImageMemorySampleSnapshot;
  maxUsedJSHeapSize?: number;
  averageUsedJSHeapSize?: number;
  maxLongTaskCountSinceLastSample?: number;
  maxLongTaskDurationSinceLastSample?: number;
}

export interface CanvasImageThumbnailWorkerQueueEventSnapshot {
  eventId: number;
  eventKind: ImageThumbnailWorkerQueueEventKind;
  taskId?: string;
  activeTaskId: string | null;
  queuedTaskCount: number;
  activeTaskCount: 0 | 1;
  totalTaskCount: number;
  restartCount: number;
  timeoutCount: number;
  errorCount: number;
  detail?: CanvasImageMetricDetail;
  recordedAt: number;
}

export interface CanvasImageThumbnailWorkerQueueSummarySnapshot {
  eventCount: number;
  lastEventKind?: ImageThumbnailWorkerQueueEventKind;
  activeTaskId: string | null;
  queuedTaskCount: number;
  activeTaskCount: 0 | 1;
  totalTaskCount: number;
  restartCount: number;
  timeoutCount: number;
  errorCount: number;
  lastRecordedAt?: number;
}

export interface CanvasImageFlickerDebugSnapshot {
  recordedAt: number;
  baseline: {
    name: string;
    expectedRemoteProtectedImageCount: number;
    maxThumbnailEntriesAtReportTime?: number;
  };
  session?: CanvasImageSessionSnapshot;
  cache?: CanvasImageCacheDebugSummary;
  lifecycleEvents: CanvasImageLifecycleEventSnapshot[];
  nodeLifecycleStats: CanvasImageNodeLifecycleStats[];
  suspectedLoops: CanvasImageFlickerLoopSnapshot[];
  performance: CanvasImagePerformanceSnapshot;
}

export interface CanvasImagePerformanceSnapshot {
  observerActive: boolean;
  recordedAt: number;
  diagnostics: CanvasImageDiagnosticsConfigSnapshot;
  longTasks: CanvasImageLongTaskSnapshot[];
  longTaskSummary: CanvasImageLongTaskSummarySnapshot;
  importBatches: CanvasImageImportBatchSnapshot[];
  runtimeSyncs: CanvasImageRuntimeSyncSnapshot[];
  runtimeSyncSummary: CanvasImageRuntimeSyncSummarySnapshot;
  dragVisibilityCommits: CanvasImageDragVisibilitySnapshot[];
  dragVisibilitySummary: CanvasImageDragVisibilitySummarySnapshot;
  renderPlanMetrics: CanvasRenderPlanMetricSnapshot[];
  renderPlanSummary: CanvasRenderPlanMetricSummarySnapshot;
  rasterMetrics: CanvasRasterMetricSnapshot[];
  rasterSummary: CanvasRasterMetricSummarySnapshot;
  imageManagerEmitSummary: CanvasImageManagerEmitSummarySnapshot;
  rasterRebuildSummary: CanvasRasterRebuildSummarySnapshot;
  nodePatchSummary: CanvasNodePatchSummarySnapshot;
  nodesReferenceSummary: CanvasNodesReferenceSummarySnapshot;
  nodePatchQueueSummary: CanvasNodePatchQueueSummarySnapshot;
  moveEndMetrics: CanvasMoveEndMetricSnapshot[];
  moveEndSummary: CanvasMoveEndMetricSummarySnapshot;
  fileNodeCommits: CanvasImageFileNodeCommitSnapshot[];
  fileNodeRenderSummary: CanvasImageFileNodeRenderSummarySnapshot[];
  subscriptionSummary: CanvasImageSubscriptionSummarySnapshot;
  memorySamples: CanvasImageMemorySampleSnapshot[];
  memorySummary: CanvasImageMemorySummarySnapshot;
  canvasSession?: CanvasImageSessionSnapshot;
  lifecycleEvents: CanvasImageLifecycleEventSnapshot[];
  nodeLifecycleStats: CanvasImageNodeLifecycleStats[];
  suspectedLoops: CanvasImageFlickerLoopSnapshot[];
  imageThumbnailWorkerQueueEvents: CanvasImageThumbnailWorkerQueueEventSnapshot[];
  imageThumbnailWorkerQueueSummary: CanvasImageThumbnailWorkerQueueSummarySnapshot;
}

interface ImportStageSummaryState extends CanvasImageImportStageSummarySnapshot {}

interface ImportBatchState {
  batchId: string;
  total: number;
  thumbnailReadyTargetCount: number;
  completed: number;
  failed: number;
  startedAt: number;
  placeholdersReadyAt?: number;
  batchCompletedAt?: number;
  enhancementStartedAt?: number;
  enhancementSettledAt?: number;
  responseMs?: number;
  totalMs?: number;
  enhancementMs?: number;
  pendingEnhancements: number;
  enhancedNodes: number;
  thumbnailReadyNodes: number;
  firstCanvasThumbnailReadyAt?: number;
  allCanvasThumbnailReadyAt?: number;
  firstCanvasThumbnailReadyMs?: number;
  allCanvasThumbnailReadyMs?: number;
  stages: CanvasImageImportStageSnapshot[];
  stageSummary: Map<CanvasImageImportStageName, ImportStageSummaryState>;
  thumbnailReadyNodeIds: Set<string>;
  runtimeSyncCount: number;
  runtimeSyncTotalMs: number;
  runtimeSyncMaxMs?: number;
  firstRuntimeSyncAt?: number;
  lastRuntimeSyncAt?: number;
}

interface FileNodeCommitMetric extends CanvasImageFileNodeCommitSnapshot {}

interface ImportedNodeMetricState {
  batchId: string;
  nodeId: string;
  nodeType: FileNodeMetricType;
  fileName: string;
}

interface LifecycleStatsState extends CanvasImageNodeLifecycleStats {
  eventSignature?: string;
  lastReadyAt?: number;
  lastReleaseAt?: number;
}

function toPublicLifecycleStats(stats: LifecycleStatsState): CanvasImageNodeLifecycleStats {
  return {
    nodeId: stats.nodeId,
    mode: stats.mode,
    fileName: stats.fileName,
    totalEvents: stats.totalEvents,
    registerCount: stats.registerCount,
    requestStartedCount: stats.requestStartedCount,
    loadSucceededCount: stats.loadSucceededCount,
    releaseCount: stats.releaseCount,
    loadFailedCount: stats.loadFailedCount,
    currentRequestKey: stats.currentRequestKey,
    lastEventKind: stats.lastEventKind,
    lastRequestKey: stats.lastRequestKey,
    lastSwitchReason: stats.lastSwitchReason,
    lastAttemptedUrl: stats.lastAttemptedUrl,
    lastResourcePhase: stats.lastResourcePhase,
    lastRecordedAt: stats.lastRecordedAt,
    requestAfterReleaseCount: stats.requestAfterReleaseCount,
    readyReleaseRequestLoopCount: stats.readyReleaseRequestLoopCount,
  };
}

interface DragVisibilityAggregateState {
  totalComputations: number;
  totalBatchCommits: number;
  totalDurationMs: number;
  maxDurationMs?: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
  maxNodeCount?: number;
}

interface ImageManagerEmitSummaryState {
  totalEmits: number;
  canvasEmits: number;
  originalEmits: number;
  uniqueNodeIds: Set<string>;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
  firstCanvasRecordedAt?: number;
  lastCanvasRecordedAt?: number;
  firstOriginalRecordedAt?: number;
  lastOriginalRecordedAt?: number;
  lastNodeId?: string;
  lastMode?: ImageLifecycleMode;
}

interface RasterRebuildSummaryState {
  totalRebuilds: number;
  totalDurationMs: number;
  durationSampleCount: number;
  byReason: Map<CanvasRasterRebuildReason, number>;
  maxDurationMs?: number;
  maxCandidateNodeCount?: number;
  maxItemCount?: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
  lastReason?: CanvasRasterRebuildReason;
  lastCandidateNodeCount?: number;
  lastItemCount?: number;
}

interface NodePatchSummaryState {
  totalAttempts: number;
  totalUpdated: number;
  totalSkipped: number;
  byReason: Map<string, number>;
  byBatchId: Map<string, number>;
  attemptsByNodeId: Map<string, number>;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
  lastNodeId?: string;
  lastReason?: string;
  lastBatchId?: string;
}

interface NodesReferenceSummaryState {
  totalChanges: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
  lastNodeCount?: number;
  maxNodeCount?: number;
  lastReason?: string;
}

interface NodePatchQueueSummaryState {
  pendingCount: number;
  maxPendingCount: number;
  enqueueCount: number;
  flushCount: number;
  totalFlushDurationMs: number;
  flushDurationSampleCount: number;
  maxFlushDurationMs?: number;
  firstRecordedAt?: number;
  lastRecordedAt?: number;
}

interface ImageManagerDebugSnapshotLike {
  cache?: {
    policy?: {
      maxResourceEntries?: number;
      maxOriginalEntries?: number;
      maxThumbnailEntries?: number;
      maxCanvasBytes?: number;
      maxOriginalBytes?: number;
      maxThumbnailBytes?: number;
    };
    stats?: Partial<CanvasImageCacheDebugSummary>;
    budget?: Partial<CanvasImageCacheDebugSummary>;
  };
  cacheBudget?: {
    profile?: {
      tier?: string;
      scene?: string;
      density?: string;
      imageNodeCount?: number;
      importingNodeCount?: number;
    };
  };
  subscriptions?: {
    total?: number;
    canvas?: number;
    original?: number;
    nodesWithSubscribers?: number;
  };
  inflightRequests?: unknown[];
}

interface FileNodeRenderMetricState extends CanvasImageFileNodeRenderSummarySnapshot {}

interface SubscriptionSummaryState {
  totalSubscriptions: number;
  peakSubscriptions: number;
  canvasSubscriptions: number;
  originalSubscriptions: number;
  totalSubscribeCalls: number;
  totalUnsubscribeCalls: number;
  uniqueSubscribedNodes: Set<string>;
  activeNodesWithSubscriptions: number;
  canvasSubscribeCalls: number;
  originalSubscribeCalls: number;
  uploadSnapshotReadCount: number;
  uploadNodesObserved: Set<string>;
}

const MAX_LONG_TASKS = 100;
const MAX_IMPORT_BATCHES = 20;
const MAX_IMPORT_STAGE_EVENTS_PER_BATCH = 600;
const MAX_FILE_NODE_METRICS = 400;
const MAX_FILE_NODE_RENDER_METRICS = 400;
const MAX_LIFECYCLE_EVENTS = 2_000;
const MAX_RUNTIME_SYNC_METRICS = 300;
const MAX_DRAG_VISIBILITY_METRICS = 300;
const MAX_RENDER_PLAN_METRICS = 300;
const MAX_RASTER_METRICS = 300;
const MAX_MOVE_END_METRICS = 200;
const MAX_MEMORY_SAMPLES = 120;
const MAX_IMAGE_THUMBNAIL_WORKER_QUEUE_EVENTS = 200;
const READY_RELEASE_REQUEST_WINDOW_MS = 10_000;
const REMOTE_PROTECTED_IMAGE_BASELINE_COUNT = 55;
const CANVAS_IMAGE_DIAGNOSTICS_STORAGE_KEY = 'canvas.image.performance.enabled';
const CANVAS_IMAGE_VERBOSE_STORAGE_KEY = 'canvas.image.performance.verbose';
const CANVAS_IMAGE_AUTO_REPORT_STORAGE_KEY = 'canvas.image.performance.autoReport';
const CANVAS_IMAGE_QUERY_KEYS = ['canvasImagePerf', 'canvasImageDebug'];
const CANVAS_IMAGE_VERBOSE_QUERY_KEYS = ['canvasImagePerfVerbose', 'canvasImageDebugVerbose'];
const CANVAS_IMAGE_AUTO_REPORT_QUERY_KEYS = ['canvasImagePerfReport', 'canvasImageDebugReport'];
const DRAG_VISIBILITY_DETAIL_SAMPLE_INTERVAL = 12;
const DRAG_VISIBILITY_SLOW_DETAIL_THRESHOLD_MS = 12;
const FILE_NODE_COMMIT_DIAGNOSTIC_THROTTLE_MS = 750;
const SESSION_SNAPSHOT_DIAGNOSTIC_THROTTLE_MS = 1000;
const SUMMARY_REPORT_THROTTLE_MS = 5000;

const fileNodeDiagnosticCommits = new Map<string, {
  signature: string;
  recordedAt: number;
}>();
let lastSessionSnapshotDiagnosticAt = 0;
let diagnosticsEnabledOverride: boolean | undefined;
let diagnosticsVerboseOverride: boolean | undefined;
let diagnosticsAutoReportOverride: boolean | undefined;

function isDevelopmentEnvironment(): boolean {
  if (import.meta.env?.DEV) {
    return true;
  }

  if (typeof window === 'undefined' && typeof diagnosticsEnabledOverride === 'boolean') {
    return true;
  }

  const processEnv = (globalThis as {
    process?: {
      env?: Record<string, string | undefined>;
    };
  }).process?.env;
  return processEnv?.NODE_ENV === 'test' || processEnv?.CANVAS_IMAGE_PERF_TEST === '1';
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
}

const IMAGE_THUMBNAIL_FAILURE_CODES: readonly ImageThumbnailFailureCode[] = [
  'worker-unavailable',
  'worker-timeout',
  'worker-crashed',
  'worker-message-failure',
  'bitmap-unsupported',
  'offscreen-unsupported',
  'decode-failed',
  'canvas-context-failed',
  'blob-convert-failed',
  'unknown',
];

const IMAGE_THUMBNAIL_FAILURE_STAGES: readonly ImageThumbnailFailureStage[] = [
  'pipeline-gate',
  'queue-wait',
  'worker-execute',
  'result-apply',
];

function isImageThumbnailFailureCodeValue(value: unknown): value is ImageThumbnailFailureCode {
  return typeof value === 'string' && IMAGE_THUMBNAIL_FAILURE_CODES.includes(value as ImageThumbnailFailureCode);
}

function isImageThumbnailFailureStageValue(value: unknown): value is ImageThumbnailFailureStage {
  return typeof value === 'string' && IMAGE_THUMBNAIL_FAILURE_STAGES.includes(value as ImageThumbnailFailureStage);
}

function buildThumbnailFailureAggregate(values: string[]): CanvasImageThumbnailFailureAggregateSnapshot[] {
  const counts = new Map<string, number>();

  values.forEach((value) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function parseBooleanFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  switch (value.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    case '0':
    case 'false':
    case 'no':
    case 'off':
      return false;
    default:
      return undefined;
  }
}

function readLocalStorageFlag(key: string): boolean | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return parseBooleanFlag(window.localStorage?.getItem(key));
  } catch {
    return undefined;
  }
}

function writeLocalStorageFlag(key: string, value: boolean | undefined): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (typeof value === 'boolean') {
      window.localStorage?.setItem(key, value ? '1' : '0');
    } else {
      window.localStorage?.removeItem(key);
    }
  } catch {
    // Ignore storage failures in private browsing or locked-down environments.
  }
}

function readQueryFlag(keys: string[]): boolean | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    for (const key of keys) {
      if (params.has(key)) {
        return parseBooleanFlag(params.get(key) ?? '1') ?? true;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function resolveCanvasImageDiagnosticsConfig(): CanvasImageDiagnosticsConfigSnapshot {
  if (!isDevelopmentEnvironment()) {
    return {
      enabled: false,
      verbose: false,
      autoReport: false,
      dragDetailSampleInterval: DRAG_VISIBILITY_DETAIL_SAMPLE_INTERVAL,
      fileNodeCommitThrottleMs: FILE_NODE_COMMIT_DIAGNOSTIC_THROTTLE_MS,
      sessionSnapshotThrottleMs: SESSION_SNAPSHOT_DIAGNOSTIC_THROTTLE_MS,
      summaryReportThrottleMs: SUMMARY_REPORT_THROTTLE_MS,
    };
  }

  const globalWindow = typeof window === 'undefined' ? undefined : window;
  const enabled = parseBooleanFlag(globalWindow?.__CANVAS_IMAGE_PERF_ENABLED__)
    ?? diagnosticsEnabledOverride
    ?? readQueryFlag(CANVAS_IMAGE_QUERY_KEYS)
    ?? readLocalStorageFlag(CANVAS_IMAGE_DIAGNOSTICS_STORAGE_KEY)
    ?? false;
  const verbose = enabled && Boolean(
    parseBooleanFlag(globalWindow?.__CANVAS_IMAGE_PERF_VERBOSE__)
      ?? diagnosticsVerboseOverride
      ?? readQueryFlag(CANVAS_IMAGE_VERBOSE_QUERY_KEYS)
      ?? readLocalStorageFlag(CANVAS_IMAGE_VERBOSE_STORAGE_KEY)
      ?? false
  );
  const autoReport = enabled && Boolean(
    parseBooleanFlag(globalWindow?.__CANVAS_IMAGE_PERF_AUTO_REPORT__)
      ?? diagnosticsAutoReportOverride
      ?? readQueryFlag(CANVAS_IMAGE_AUTO_REPORT_QUERY_KEYS)
      ?? readLocalStorageFlag(CANVAS_IMAGE_AUTO_REPORT_STORAGE_KEY)
      ?? false
  );

  return {
    enabled,
    verbose,
    autoReport,
    dragDetailSampleInterval: verbose ? 1 : DRAG_VISIBILITY_DETAIL_SAMPLE_INTERVAL,
    fileNodeCommitThrottleMs: verbose ? 0 : FILE_NODE_COMMIT_DIAGNOSTIC_THROTTLE_MS,
    sessionSnapshotThrottleMs: verbose ? 0 : SESSION_SNAPSHOT_DIAGNOSTIC_THROTTLE_MS,
    summaryReportThrottleMs: SUMMARY_REPORT_THROTTLE_MS,
  };
}

function normalizeLifecycleEventKind(value: string | undefined): ImageLifecycleEventKind | undefined {
  switch (value) {
    case 'register':
    case 'request-queued':
    case 'request-started':
    case 'load-succeeded':
    case 'load-failed':
    case 'release':
    case 'visibility-updated':
    case 'cooldown-released':
    case 'retry-scheduled':
      return value;
    default:
      return undefined;
  }
}

function resolveImageManagerDebugSnapshot(
  snapshot?: ImageManagerDebugSnapshotLike
): ImageManagerDebugSnapshotLike | undefined {
  if (snapshot) {
    return snapshot;
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.__IMAGE_MANAGER_DEBUG__?.();
}

function buildCacheDebugSummary(
  snapshot?: ImageManagerDebugSnapshotLike
): CanvasImageCacheDebugSummary | undefined {
  const stats = snapshot?.cache?.stats;
  if (!stats) {
    return undefined;
  }

  return {
    entryCount: stats.entryCount ?? 0,
    resourceEntryCount: stats.resourceEntryCount ?? 0,
    objectUrlEntryCount: stats.objectUrlEntryCount ?? 0,
    canvasResourceEntryCount: stats.canvasResourceEntryCount ?? 0,
    originalEntryCount: stats.originalEntryCount ?? 0,
    visibleEntryCount: stats.visibleEntryCount ?? 0,
    nearViewportEntryCount: stats.nearViewportEntryCount ?? 0,
    thumbnailEntryCount: stats.thumbnailEntryCount ?? 0,
    inflightRequestCount: snapshot?.inflightRequests?.length ?? 0,
    subscriptionCount: snapshot?.subscriptions?.total ?? 0,
    canvasSubscriptionCount: snapshot?.subscriptions?.canvas ?? 0,
    originalSubscriptionCount: snapshot?.subscriptions?.original ?? 0,
    nodesWithSubscribers: snapshot?.subscriptions?.nodesWithSubscribers ?? 0,
    evictionCount: stats.evictionCount ?? 0,
    revocationCount: stats.revocationCount ?? 0,
    decodedReleaseCount: stats.decodedReleaseCount ?? 0,
    hitCount: stats.hitCount,
    missCount: stats.missCount,
    retryAttemptCount: stats.retryAttemptCount,
    retrySuppressedCount: stats.retrySuppressedCount,
    retryRecoveredCount: stats.retryRecoveredCount,
    thumbnailEntryLimit: snapshot?.cache?.policy?.maxThumbnailEntries,
    resourceEntryLimit: snapshot?.cache?.policy?.maxResourceEntries,
    originalEntryLimit: snapshot?.cache?.policy?.maxOriginalEntries,
    thumbnailBytes: stats.thumbnailBytes,
    canvasBytes: stats.canvasBytes,
    originalBytes: stats.originalBytes,
    totalBytes: stats.totalBytes,
    maxCanvasBytes: snapshot?.cache?.policy?.maxCanvasBytes,
    maxOriginalBytes: snapshot?.cache?.policy?.maxOriginalBytes,
    maxThumbnailBytes: snapshot?.cache?.policy?.maxThumbnailBytes,
    canvasByteUsageRatio: snapshot?.cache?.budget?.canvasByteUsageRatio,
    originalByteUsageRatio: snapshot?.cache?.budget?.originalByteUsageRatio,
    thumbnailByteUsageRatio: snapshot?.cache?.budget?.thumbnailByteUsageRatio,
    budgetScene: snapshot?.cacheBudget?.profile?.scene,
    budgetTier: snapshot?.cacheBudget?.profile?.tier,
    budgetDensity: snapshot?.cacheBudget?.profile?.density,
    budgetImageNodeCount: snapshot?.cacheBudget?.profile?.imageNodeCount,
    budgetImportingNodeCount: snapshot?.cacheBudget?.profile?.importingNodeCount,
  };
}

export function evaluateCanvasRenderPlanPressure(input: {
  canvasSession?: CanvasImageSessionSnapshot;
  dragVisibilitySummary: CanvasImageDragVisibilitySummarySnapshot;
  fileNodeRenderSummary: readonly CanvasImageFileNodeRenderSummarySnapshot[];
  longTaskSummary: CanvasImageLongTaskSummarySnapshot;
  runtimeSyncSummary: CanvasImageRuntimeSyncSummarySnapshot;
  cache?: CanvasImageCacheDebugSummary;
}): CanvasRenderPlanPressureSnapshot {
  const nodeCount = Math.max(
    input.canvasSession?.nodeCount ?? 0,
    input.dragVisibilitySummary.maxNodeCount ?? 0,
  );
  const scale: CanvasRenderPlanPressureScale = nodeCount >= 1000
    ? 'stress'
    : nodeCount >= 500
      ? 'large'
      : nodeCount >= 100
        ? 'medium'
        : 'small';
  const longTaskMaxDurationMs = input.longTaskSummary.maxDurationMs;
  const dragVisibilityMaxDurationMs = input.dragVisibilitySummary.maxDurationMs;
  const runtimeSyncMaxDurationMs = input.runtimeSyncSummary.maxDurationMs;
  const thumbnailByteUsageRatio = input.cache?.thumbnailByteUsageRatio;
  const watchReasons: string[] = [];

  if ((longTaskMaxDurationMs ?? 0) > 120) {
    watchReasons.push('long-task-over-120ms');
  } else if ((longTaskMaxDurationMs ?? 0) > 50) {
    watchReasons.push('long-task-over-50ms');
  }

  if ((dragVisibilityMaxDurationMs ?? 0) > 32) {
    watchReasons.push('drag-visibility-over-32ms');
  } else if ((dragVisibilityMaxDurationMs ?? 0) > 16) {
    watchReasons.push('drag-visibility-over-16ms');
  }

  if ((runtimeSyncMaxDurationMs ?? 0) > 120) {
    watchReasons.push('runtime-sync-over-120ms');
  }

  if ((thumbnailByteUsageRatio ?? 0) > 0.95) {
    watchReasons.push('thumbnail-cache-over-95-percent');
  }

  if (scale === 'stress' && (input.dragVisibilitySummary.totalComputations ?? 0) === 0) {
    watchReasons.push('missing-drag-visibility-samples');
  }

  const status: CanvasRenderPlanPressureStatus = watchReasons.some((reason) => (
    reason === 'long-task-over-120ms'
    || reason === 'drag-visibility-over-32ms'
    || reason === 'runtime-sync-over-120ms'
  ))
    ? 'fail'
    : watchReasons.length > 0
      ? 'watch'
      : 'pass';

  return {
    scale,
    status,
    nodeCount,
    visibleNodeCount: input.canvasSession?.visibleNodeCount ?? 0,
    nearViewportNodeCount: input.canvasSession?.nearViewportNodeCount ?? 0,
    dragMaxNodeCount: input.dragVisibilitySummary.maxNodeCount ?? 0,
    fileNodeRenderCount: input.fileNodeRenderSummary.length,
    imageCacheVisibleEntryCount: input.cache?.visibleEntryCount ?? 0,
    imageCacheNearViewportEntryCount: input.cache?.nearViewportEntryCount ?? 0,
    thumbnailByteUsageRatio,
    longTaskMaxDurationMs,
    dragVisibilityMaxDurationMs,
    runtimeSyncMaxDurationMs,
    watchReasons,
  };
}

class CanvasImagePerformanceMonitor {
  private readonly longTasks: CanvasImageLongTaskSnapshot[] = [];
  private readonly importBatches = new Map<string, ImportBatchState>();
  private readonly importBatchOrder: string[] = [];
  private readonly importedNodes = new Map<string, ImportedNodeMetricState>();
  private readonly runtimeSyncs: CanvasImageRuntimeSyncSnapshot[] = [];
  private readonly dragVisibilityCommits: CanvasImageDragVisibilitySnapshot[] = [];
  private readonly renderPlanMetrics: CanvasRenderPlanMetricSnapshot[] = [];
  private readonly rasterMetrics: CanvasRasterMetricSnapshot[] = [];
  private readonly imageManagerEmitSummaryState: ImageManagerEmitSummaryState = {
    totalEmits: 0,
    canvasEmits: 0,
    originalEmits: 0,
    uniqueNodeIds: new Set(),
  };
  private readonly rasterRebuildSummaryState: RasterRebuildSummaryState = {
    totalRebuilds: 0,
    totalDurationMs: 0,
    durationSampleCount: 0,
    byReason: new Map(),
  };
  private readonly nodePatchSummaryState: NodePatchSummaryState = {
    totalAttempts: 0,
    totalUpdated: 0,
    totalSkipped: 0,
    byReason: new Map(),
    byBatchId: new Map(),
    attemptsByNodeId: new Map(),
  };
  private readonly nodesReferenceSummaryState: NodesReferenceSummaryState = {
    totalChanges: 0,
  };
  private readonly nodePatchQueueSummaryState: NodePatchQueueSummaryState = {
    pendingCount: 0,
    maxPendingCount: 0,
    enqueueCount: 0,
    flushCount: 0,
    totalFlushDurationMs: 0,
    flushDurationSampleCount: 0,
  };
  private readonly moveEndMetrics: CanvasMoveEndMetricSnapshot[] = [];
  private readonly fileNodeCommits = new Map<string, FileNodeCommitMetric>();
  private readonly fileNodeRenderMetrics = new Map<string, FileNodeRenderMetricState>();
  private readonly lifecycleEvents: CanvasImageLifecycleEventSnapshot[] = [];
  private readonly lifecycleStats = new Map<string, LifecycleStatsState>();
  private readonly memorySamples: CanvasImageMemorySampleSnapshot[] = [];
  private readonly imageThumbnailWorkerQueueEvents: CanvasImageThumbnailWorkerQueueEventSnapshot[] = [];
  private dragVisibilityAggregate: DragVisibilityAggregateState = {
    totalComputations: 0,
    totalBatchCommits: 0,
    totalDurationMs: 0,
  };
  private readonly subscriptionSummaryState: SubscriptionSummaryState = {
    totalSubscriptions: 0,
    peakSubscriptions: 0,
    canvasSubscriptions: 0,
    originalSubscriptions: 0,
    totalSubscribeCalls: 0,
    totalUnsubscribeCalls: 0,
    uniqueSubscribedNodes: new Set(),
    activeNodesWithSubscriptions: 0,
    canvasSubscribeCalls: 0,
    originalSubscribeCalls: 0,
    uploadSnapshotReadCount: 0,
    uploadNodesObserved: new Set(),
  };
  private sessionSnapshot?: CanvasImageSessionSnapshot;
  private observer?: PerformanceObserver;
  private observerActive = false;
  private lifecycleEventSequence = 0;
  private runtimeSyncSequence = 0;
  private dragVisibilitySequence = 0;
  private renderPlanMetricSequence = 0;
  private rasterMetricSequence = 0;
  private moveEndMetricSequence = 0;
  private imageThumbnailWorkerQueueEventSequence = 0;
  private lastSummaryReportAt = 0;
  private lastLongTaskCountAtMemorySample = 0;
  private lastLongTaskDurationAtMemorySample = 0;
  private memorySampleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.ensureLongTaskObserver();
    this.ensureMemorySampler();
  }

  startImportBatch(batchId: string, total: number, startedAt: number = this.now()): void {
    this.importBatches.set(batchId, {
      batchId,
      total,
      thumbnailReadyTargetCount: 0,
      completed: 0,
      failed: 0,
      startedAt,
      pendingEnhancements: 0,
      enhancedNodes: 0,
      thumbnailReadyNodes: 0,
      stages: [],
      stageSummary: new Map(),
      thumbnailReadyNodeIds: new Set(),
      runtimeSyncCount: 0,
      runtimeSyncTotalMs: 0,
    });
    this.touchImportBatch(batchId);
  }

  registerImportNodes(batchId: string, nodes: ImportedNodeMetricState[]): void {
    if (!this.importBatches.has(batchId)) {
      return;
    }

    nodes.forEach((node) => {
      if (node.nodeType === 'image') {
        const batch = this.importBatches.get(batchId);
        if (batch) {
          batch.thumbnailReadyTargetCount += 1;
        }
      }
      this.importedNodes.set(node.nodeId, {
        ...node,
        batchId,
      });
    });
    this.touchImportBatch(batchId);
  }

  recordImportStage(payload: {
    batchId: string;
    stage: CanvasImageImportStageName;
    startedAt: number;
    completedAt?: number;
    durationMs?: number;
    status?: CanvasImageImportStageStatus;
    nodeId?: string;
    nodeType?: FileNodeMetricType;
    fileName?: string;
    itemCount?: number;
    detail?: CanvasImageMetricDetail;
  }): void {
    const batch = this.importBatches.get(payload.batchId);
    if (!batch) {
      return;
    }

    const completedAt = payload.completedAt ?? this.now();
    const durationMs = Math.max(0, payload.durationMs ?? completedAt - payload.startedAt);
    const stage: CanvasImageImportStageSnapshot = {
      stage: payload.stage,
      startedAt: payload.startedAt,
      completedAt,
      durationMs,
      status: payload.status ?? 'completed',
      nodeId: payload.nodeId,
      nodeType: payload.nodeType,
      fileName: payload.fileName,
      itemCount: payload.itemCount,
      detail: payload.detail,
    };

    batch.stages.push(stage);
    if (batch.stages.length > MAX_IMPORT_STAGE_EVENTS_PER_BATCH) {
      batch.stages.splice(0, batch.stages.length - MAX_IMPORT_STAGE_EVENTS_PER_BATCH);
    }
    this.reduceImportStageSummary(batch, stage);
    this.touchImportBatch(payload.batchId);
  }

  markImportPlaceholdersReady(batchId: string): void {
    const batch = this.importBatches.get(batchId);
    if (!batch || batch.placeholdersReadyAt) {
      return;
    }

    batch.placeholdersReadyAt = this.now();
    batch.responseMs = batch.placeholdersReadyAt - batch.startedAt;
    this.touchImportBatch(batchId);
  }

  markImportEnhancementStarted(batchId: string): void {
    const batch = this.importBatches.get(batchId);
    if (!batch) {
      return;
    }

    batch.pendingEnhancements += 1;
    if (!batch.enhancementStartedAt) {
      batch.enhancementStartedAt = this.now();
    }
    this.touchImportBatch(batchId);
  }

  markImportEnhancementSettled(batchId: string): void {
    const batch = this.importBatches.get(batchId);
    if (!batch) {
      return;
    }

    batch.pendingEnhancements = Math.max(0, batch.pendingEnhancements - 1);
    batch.enhancedNodes += 1;
    if (batch.pendingEnhancements === 0) {
      batch.enhancementSettledAt = this.now();
      if (batch.enhancementStartedAt) {
        batch.enhancementMs = batch.enhancementSettledAt - batch.enhancementStartedAt;
      }
    }
    this.touchImportBatch(batchId);
  }

  completeImportBatch(batchId: string, completed: number, failed: number): void {
    const batch = this.importBatches.get(batchId);
    if (!batch) {
      return;
    }

    batch.completed = completed;
    batch.failed = failed;
    batch.batchCompletedAt = this.now();
    batch.totalMs = batch.batchCompletedAt - batch.startedAt;
    this.touchImportBatch(batchId);
  }

  recordRuntimeSync(payload: {
    batchId?: string;
    reason?: string;
    nodeCount: number;
    connectionCount: number;
    durationMs: number;
    snapshotBuildMs?: number;
    metadataNormalizeMs?: number;
    actionCommitMs?: number;
    recordedAt?: number;
  }): void {
    const recordedAt = payload.recordedAt ?? this.now();
    const sync: CanvasImageRuntimeSyncSnapshot = {
      syncId: this.runtimeSyncSequence + 1,
      batchId: payload.batchId,
      reason: payload.reason ?? 'canvas-sync',
      nodeCount: payload.nodeCount,
      connectionCount: payload.connectionCount,
      durationMs: Math.max(0, payload.durationMs),
      snapshotBuildMs: payload.snapshotBuildMs,
      metadataNormalizeMs: payload.metadataNormalizeMs,
      actionCommitMs: payload.actionCommitMs,
      recordedAt,
    };

    this.runtimeSyncSequence = sync.syncId;
    this.runtimeSyncs.push(sync);
    if (this.runtimeSyncs.length > MAX_RUNTIME_SYNC_METRICS) {
      this.runtimeSyncs.splice(0, this.runtimeSyncs.length - MAX_RUNTIME_SYNC_METRICS);
    }

    if (payload.batchId) {
      const batch = this.importBatches.get(payload.batchId);
      if (batch) {
        batch.runtimeSyncCount += 1;
        batch.runtimeSyncTotalMs += sync.durationMs;
        batch.runtimeSyncMaxMs = Math.max(batch.runtimeSyncMaxMs ?? 0, sync.durationMs);
        batch.firstRuntimeSyncAt = batch.firstRuntimeSyncAt ?? recordedAt;
        batch.lastRuntimeSyncAt = recordedAt;
        this.touchImportBatch(payload.batchId);
      }
    }
  }

  recordDragVisibility(payload: {
    reason?: 'frame' | 'flush';
    nodeCount: number;
    visibleNodeCount: number;
    nearViewportNodeCount: number;
    durationMs: number;
    computeMs: number;
    applyMs: number;
    recordedAt?: number;
  }): void {
    const recordedAt = payload.recordedAt ?? this.now();
    const metric: CanvasImageDragVisibilitySnapshot = {
      commitId: this.dragVisibilitySequence + 1,
      reason: payload.reason ?? 'frame',
      nodeCount: payload.nodeCount,
      visibleNodeCount: payload.visibleNodeCount,
      nearViewportNodeCount: payload.nearViewportNodeCount,
      durationMs: Math.max(0, payload.durationMs),
      computeMs: Math.max(0, payload.computeMs),
      applyMs: Math.max(0, payload.applyMs),
      recordedAt,
    };

    this.dragVisibilitySequence = metric.commitId;
    this.reduceDragVisibilityAggregate(metric);

    const config = this.getDiagnosticsConfig();
    if (this.shouldStoreDragVisibilityDetail(metric, config)) {
      this.dragVisibilityCommits.push(metric);
      if (this.dragVisibilityCommits.length > MAX_DRAG_VISIBILITY_METRICS) {
        this.dragVisibilityCommits.splice(0, this.dragVisibilityCommits.length - MAX_DRAG_VISIBILITY_METRICS);
      }
    }

    this.maybeReportSummary(config, metric.recordedAt);
  }

  recordRenderPlan(payload: Omit<CanvasRenderPlanMetricSnapshot, 'metricId' | 'recordedAt'> & {
    recordedAt?: number;
  }): void {
    if (!this.getDiagnosticsConfig().enabled) {
      return;
    }

    const metric: CanvasRenderPlanMetricSnapshot = {
      metricId: this.renderPlanMetricSequence + 1,
      nodeCount: Math.max(0, payload.nodeCount),
      renderedNodeCount: Math.max(0, payload.renderedNodeCount),
      renderedEdgeCount: Math.max(0, payload.renderedEdgeCount),
      fullNodeCount: Math.max(0, payload.fullNodeCount),
      compactNodeCount: Math.max(0, payload.compactNodeCount),
      minimalNodeCount: Math.max(0, payload.minimalNodeCount),
      proxyNodeCount: Math.max(0, payload.proxyNodeCount),
      imageFullDomNodeCount: typeof payload.imageFullDomNodeCount === 'number' ? Math.max(0, payload.imageFullDomNodeCount) : undefined,
      imageShellNodeCount: typeof payload.imageShellNodeCount === 'number' ? Math.max(0, payload.imageShellNodeCount) : undefined,
      imageObjectLayerCount: typeof payload.imageObjectLayerCount === 'number' ? Math.max(0, payload.imageObjectLayerCount) : undefined,
      placeholderNodeCount: Math.max(0, payload.placeholderNodeCount),
      detachedNodeCount: Math.max(0, payload.detachedNodeCount),
      hiddenEdgeCount: Math.max(0, payload.hiddenEdgeCount),
      rasterEligibleNodeCount: Math.max(0, payload.rasterEligibleNodeCount),
      reusedNodeCount: typeof payload.reusedNodeCount === 'number' ? Math.max(0, payload.reusedNodeCount) : undefined,
      createdNodeCount: typeof payload.createdNodeCount === 'number' ? Math.max(0, payload.createdNodeCount) : undefined,
      durationMs: typeof payload.durationMs === 'number' ? Math.max(0, payload.durationMs) : undefined,
      recordedAt: payload.recordedAt ?? this.now(),
    };

    this.renderPlanMetricSequence = metric.metricId;
    this.renderPlanMetrics.push(metric);
    if (this.renderPlanMetrics.length > MAX_RENDER_PLAN_METRICS) {
      this.renderPlanMetrics.splice(0, this.renderPlanMetrics.length - MAX_RENDER_PLAN_METRICS);
    }
  }

  recordRasterMetric(payload: Omit<CanvasRasterMetricSnapshot, 'metricId' | 'recordedAt'> & {
    recordedAt?: number;
  }): void {
    if (!this.getDiagnosticsConfig().enabled) {
      return;
    }

    const metric: CanvasRasterMetricSnapshot = {
      metricId: this.rasterMetricSequence + 1,
      reason: payload.reason,
      candidateNodeCount: Math.max(0, payload.candidateNodeCount),
      itemCount: Math.max(0, payload.itemCount),
      registeredNodeCount: Math.max(0, payload.registeredNodeCount),
      requestedNodeCount: Math.max(0, payload.requestedNodeCount),
      activeImageNodeCount: typeof payload.activeImageNodeCount === 'number' ? Math.max(0, payload.activeImageNodeCount) : undefined,
      readyItemCount: typeof payload.readyItemCount === 'number' ? Math.max(0, payload.readyItemCount) : undefined,
      loadingItemCount: typeof payload.loadingItemCount === 'number' ? Math.max(0, payload.loadingItemCount) : undefined,
      unavailableItemCount: typeof payload.unavailableItemCount === 'number' ? Math.max(0, payload.unavailableItemCount) : undefined,
      drawnItemCount: typeof payload.drawnItemCount === 'number' ? Math.max(0, payload.drawnItemCount) : undefined,
      deferredItemCount: typeof payload.deferredItemCount === 'number' ? Math.max(0, payload.deferredItemCount) : undefined,
      lodSkippedItemCount: typeof payload.lodSkippedItemCount === 'number' ? Math.max(0, payload.lodSkippedItemCount) : undefined,
      budgetExhausted: payload.budgetExhausted,
      textureUploadCount: typeof payload.textureUploadCount === 'number' ? Math.max(0, payload.textureUploadCount) : undefined,
      textureEvictedCount: typeof payload.textureEvictedCount === 'number' ? Math.max(0, payload.textureEvictedCount) : undefined,
      textureRetainedCount: typeof payload.textureRetainedCount === 'number' ? Math.max(0, payload.textureRetainedCount) : undefined,
      textureByteEstimate: typeof payload.textureByteEstimate === 'number' ? Math.max(0, payload.textureByteEstimate) : undefined,
      activeSpriteCount: typeof payload.activeSpriteCount === 'number' ? Math.max(0, payload.activeSpriteCount) : undefined,
      spritePoolSize: typeof payload.spritePoolSize === 'number' ? Math.max(0, payload.spritePoolSize) : undefined,
      durationMs: typeof payload.durationMs === 'number' ? Math.max(0, payload.durationMs) : undefined,
      recordedAt: payload.recordedAt ?? this.now(),
    };

    this.rasterMetricSequence = metric.metricId;
    this.rasterMetrics.push(metric);
    if (this.rasterMetrics.length > MAX_RASTER_METRICS) {
      this.rasterMetrics.splice(0, this.rasterMetrics.length - MAX_RASTER_METRICS);
    }
  }

  recordImageManagerEmit(payload: {
    nodeId: string;
    mode: ImageLifecycleMode;
    recordedAt?: number;
  }): void {
    if (!this.getDiagnosticsConfig().enabled) {
      return;
    }

    const recordedAt = payload.recordedAt ?? this.now();
    const summary = this.imageManagerEmitSummaryState;
    summary.totalEmits += 1;
    summary.uniqueNodeIds.add(payload.nodeId);
    summary.firstRecordedAt = summary.firstRecordedAt ?? recordedAt;
    summary.lastRecordedAt = recordedAt;
    summary.lastNodeId = payload.nodeId;
    summary.lastMode = payload.mode;

    if (payload.mode === 'canvas') {
      summary.canvasEmits += 1;
      summary.firstCanvasRecordedAt = summary.firstCanvasRecordedAt ?? recordedAt;
      summary.lastCanvasRecordedAt = recordedAt;
    } else {
      summary.originalEmits += 1;
      summary.firstOriginalRecordedAt = summary.firstOriginalRecordedAt ?? recordedAt;
      summary.lastOriginalRecordedAt = recordedAt;
    }
  }

  recordRasterRebuild(payload: {
    reason: CanvasRasterRebuildReason;
    candidateNodeCount: number;
    itemCount: number;
    durationMs?: number;
    recordedAt?: number;
  }): void {
    if (!this.getDiagnosticsConfig().enabled) {
      return;
    }

    const recordedAt = payload.recordedAt ?? this.now();
    const summary = this.rasterRebuildSummaryState;
    const candidateNodeCount = Math.max(0, payload.candidateNodeCount);
    const itemCount = Math.max(0, payload.itemCount);
    summary.totalRebuilds += 1;
    summary.byReason.set(payload.reason, (summary.byReason.get(payload.reason) ?? 0) + 1);
    summary.maxCandidateNodeCount = Math.max(summary.maxCandidateNodeCount ?? 0, candidateNodeCount);
    summary.maxItemCount = Math.max(summary.maxItemCount ?? 0, itemCount);
    summary.firstRecordedAt = summary.firstRecordedAt ?? recordedAt;
    summary.lastRecordedAt = recordedAt;
    summary.lastReason = payload.reason;
    summary.lastCandidateNodeCount = candidateNodeCount;
    summary.lastItemCount = itemCount;

    if (typeof payload.durationMs === 'number') {
      const durationMs = Math.max(0, payload.durationMs);
      summary.totalDurationMs += durationMs;
      summary.durationSampleCount += 1;
      summary.maxDurationMs = Math.max(summary.maxDurationMs ?? 0, durationMs);
    }
  }

  recordNodePatch(payload: {
    nodeId: string;
    reason?: string;
    batchId?: string;
    sync?: boolean;
    force?: boolean;
    hasUpdated: boolean;
    recordedAt?: number;
  }): void {
    if (!this.getDiagnosticsConfig().enabled) {
      return;
    }

    const recordedAt = payload.recordedAt ?? this.now();
    const summary = this.nodePatchSummaryState;
    const reason = payload.reason ?? 'unspecified';
    const batchId = payload.batchId ?? 'none';
    summary.totalAttempts += 1;
    if (payload.hasUpdated) {
      summary.totalUpdated += 1;
    } else {
      summary.totalSkipped += 1;
    }
    summary.byReason.set(reason, (summary.byReason.get(reason) ?? 0) + 1);
    summary.byBatchId.set(batchId, (summary.byBatchId.get(batchId) ?? 0) + 1);
    summary.attemptsByNodeId.set(payload.nodeId, (summary.attemptsByNodeId.get(payload.nodeId) ?? 0) + 1);
    summary.firstRecordedAt = summary.firstRecordedAt ?? recordedAt;
    summary.lastRecordedAt = recordedAt;
    summary.lastNodeId = payload.nodeId;
    summary.lastReason = reason;
    summary.lastBatchId = payload.batchId;
  }

  recordNodesReferenceChange(payload: {
    nodeCount: number;
    reason?: string;
    recordedAt?: number;
  }): void {
    if (!this.getDiagnosticsConfig().enabled) {
      return;
    }

    const recordedAt = payload.recordedAt ?? this.now();
    const nodeCount = Math.max(0, payload.nodeCount);
    const summary = this.nodesReferenceSummaryState;
    summary.totalChanges += 1;
    summary.firstRecordedAt = summary.firstRecordedAt ?? recordedAt;
    summary.lastRecordedAt = recordedAt;
    summary.lastNodeCount = nodeCount;
    summary.maxNodeCount = Math.max(summary.maxNodeCount ?? 0, nodeCount);
    summary.lastReason = payload.reason;
  }

  recordNodePatchQueueMetric(payload: {
    pendingCount?: number;
    enqueueCount?: number;
    flushCount?: number;
    flushDurationMs?: number;
    recordedAt?: number;
  }): void {
    if (!this.getDiagnosticsConfig().enabled) {
      return;
    }

    const recordedAt = payload.recordedAt ?? this.now();
    const summary = this.nodePatchQueueSummaryState;
    if (typeof payload.pendingCount === 'number') {
      summary.pendingCount = Math.max(0, payload.pendingCount);
      summary.maxPendingCount = Math.max(summary.maxPendingCount, summary.pendingCount);
    }
    if (typeof payload.enqueueCount === 'number') {
      summary.enqueueCount += Math.max(0, payload.enqueueCount);
    }
    if (typeof payload.flushCount === 'number') {
      summary.flushCount += Math.max(0, payload.flushCount);
    }
    if (typeof payload.flushDurationMs === 'number') {
      const flushDurationMs = Math.max(0, payload.flushDurationMs);
      summary.totalFlushDurationMs += flushDurationMs;
      summary.flushDurationSampleCount += 1;
      summary.maxFlushDurationMs = Math.max(summary.maxFlushDurationMs ?? 0, flushDurationMs);
    }
    summary.firstRecordedAt = summary.firstRecordedAt ?? recordedAt;
    summary.lastRecordedAt = recordedAt;
  }

  recordMoveEndMetric(payload: Omit<CanvasMoveEndMetricSnapshot, 'metricId' | 'recordedAt'> & {
    recordedAt?: number;
  }): void {
    if (!this.getDiagnosticsConfig().enabled) {
      return;
    }

    const metric: CanvasMoveEndMetricSnapshot = {
      metricId: this.moveEndMetricSequence + 1,
      importing: payload.importing,
      totalDurationMs: Math.max(0, payload.totalDurationMs),
      resumeSchedulingMs: Math.max(0, payload.resumeSchedulingMs),
      viewportSyncMs: Math.max(0, payload.viewportSyncMs),
      dragVisibilityFlushMs: Math.max(0, payload.dragVisibilityFlushMs),
      imageWorkFlushMs: Math.max(0, payload.imageWorkFlushMs),
      workflowSyncScheduleMs: Math.max(0, payload.workflowSyncScheduleMs),
      visibilityApplyMs: Math.max(0, payload.visibilityApplyMs),
      resourceScheduleMs: Math.max(0, payload.resourceScheduleMs),
      patchQueueFlushMs: Math.max(0, payload.patchQueueFlushMs),
      workflowViewportSyncMs: Math.max(0, payload.workflowViewportSyncMs),
      recordedAt: payload.recordedAt ?? this.now(),
    };

    this.moveEndMetricSequence = metric.metricId;
    this.moveEndMetrics.push(metric);
    if (this.moveEndMetrics.length > MAX_MOVE_END_METRICS) {
      this.moveEndMetrics.splice(0, this.moveEndMetrics.length - MAX_MOVE_END_METRICS);
    }
  }

  recordCanvasSession(payload: Omit<CanvasImageSessionSnapshot, 'recordedAt'>): void {
    this.sessionSnapshot = {
      ...payload,
      recordedAt: this.now(),
    };
  }

  recordFileNodeCommit(payload: {
    nodeId: string;
    nodeType: FileNodeMetricType;
    fileName: string;
    selected: boolean;
    dragging: boolean;
    status: string;
    placeholder: FileNodePlaceholderState;
    activeVariantKind?: string;
    viewerStatus?: string;
    resourceStatus?: string;
    resourcePhase?: string;
    requestKey?: string;
    requestEventKind?: string;
    requestEventClassification?: ImageLifecycleEventClassification;
    requestEventReason?: string;
    requestSwitchReason?: string;
    attemptedUrl?: string;
    src?: string;
    isVisible?: boolean;
    isNearViewport?: boolean;
    displayWidth?: number;
    displayHeight?: number;
  }): void {
    const committedAt = this.now();
    const current = this.fileNodeCommits.get(payload.nodeId);
    const next: FileNodeCommitMetric = {
      nodeId: payload.nodeId,
      nodeType: payload.nodeType,
      fileName: payload.fileName,
      commits: (current?.commits ?? 0) + 1,
      selected: payload.selected,
      dragging: payload.dragging,
      status: payload.status,
      placeholder: payload.placeholder,
      activeVariantKind: payload.activeVariantKind,
      viewerStatus: payload.viewerStatus,
      resourceStatus: payload.resourceStatus,
      resourcePhase: payload.resourcePhase,
      requestKey: payload.requestKey,
      requestEventKind: payload.requestEventKind,
      requestEventClassification: payload.requestEventClassification,
      requestEventReason: payload.requestEventReason,
      requestSwitchReason: payload.requestSwitchReason,
      attemptedUrl: payload.attemptedUrl,
      src: payload.src,
      isVisible: payload.isVisible,
      isNearViewport: payload.isNearViewport,
      displayWidth: payload.displayWidth,
      displayHeight: payload.displayHeight,
      lastCommittedAt: committedAt,
    };

    this.fileNodeCommits.set(payload.nodeId, next);
    this.recordImportPreviewReadyFromCommit(next, committedAt);
    this.recordLifecycleEventFromCommit(next, committedAt);
    this.pruneFileNodeMetrics();
  }

  recordPreviewLifecycle(payload: {
    nodeId: string;
    fileName?: string;
    eventKind: Extract<ImageLifecycleEventKind, 'preview-begin' | 'preview-ready' | 'preview-failed' | 'preview-cleared'>;
    sessionId?: string;
    fileId?: string;
    error?: string;
    placeholder?: FileNodePlaceholderState;
    detail?: CanvasImageMetricDetail;
  }): void {
    if (!import.meta.env?.DEV) {
      return;
    }

    const recordedAt = this.now();
    const event: CanvasImageLifecycleEventSnapshot = {
      eventId: this.lifecycleEventSequence + 1,
      nodeId: payload.nodeId,
      mode: 'canvas',
      fileName: payload.fileName ?? payload.fileId ?? payload.nodeId,
      eventKind: payload.eventKind,
      eventReason: payload.error ?? payload.sessionId,
      requestKey: payload.sessionId,
      attemptedUrl: payload.fileId,
      placeholder: payload.placeholder,
      detail: payload.detail ? { ...payload.detail } : undefined,
      recordedAt,
    };

    this.lifecycleEventSequence = event.eventId;
    this.lifecycleEvents.push(event);
    if (this.lifecycleEvents.length > MAX_LIFECYCLE_EVENTS) {
      this.lifecycleEvents.splice(0, this.lifecycleEvents.length - MAX_LIFECYCLE_EVENTS);
    }
  }

  recordImageThumbnailWorkerQueueEvent(payload: {
    eventKind: ImageThumbnailWorkerQueueEventKind;
    taskId?: string;
    activeTaskId: string | null;
    queuedTaskCount: number;
    activeTaskCount: 0 | 1;
    totalTaskCount: number;
    restartCount: number;
    timeoutCount: number;
    errorCount: number;
    detail?: CanvasImageMetricDetail;
    recordedAt?: number;
  }): void {
    if (!import.meta.env?.DEV) {
      return;
    }

    const event: CanvasImageThumbnailWorkerQueueEventSnapshot = {
      eventId: this.imageThumbnailWorkerQueueEventSequence + 1,
      eventKind: payload.eventKind,
      taskId: payload.taskId,
      activeTaskId: payload.activeTaskId,
      queuedTaskCount: Math.max(0, payload.queuedTaskCount),
      activeTaskCount: payload.activeTaskCount,
      totalTaskCount: Math.max(0, payload.totalTaskCount),
      restartCount: Math.max(0, payload.restartCount),
      timeoutCount: Math.max(0, payload.timeoutCount),
      errorCount: Math.max(0, payload.errorCount),
      detail: payload.detail,
      recordedAt: payload.recordedAt ?? this.now(),
    };

    this.imageThumbnailWorkerQueueEventSequence = event.eventId;
    this.imageThumbnailWorkerQueueEvents.push(event);
    if (this.imageThumbnailWorkerQueueEvents.length > MAX_IMAGE_THUMBNAIL_WORKER_QUEUE_EVENTS) {
      this.imageThumbnailWorkerQueueEvents.splice(
        0,
        this.imageThumbnailWorkerQueueEvents.length - MAX_IMAGE_THUMBNAIL_WORKER_QUEUE_EVENTS,
      );
    }
  }

  recordFileNodeRender(payload: {
    nodeId: string;
    fileName: string;
    nodeType: FileNodeMetricType;
    commitDurationMs: number;
    dragging: boolean;
    recordedAt?: number;
  }): void {
    if (!this.getDiagnosticsConfig().enabled) {
      return;
    }

    const recordedAt = payload.recordedAt ?? this.now();
    const current = this.fileNodeRenderMetrics.get(payload.nodeId);
    const next: FileNodeRenderMetricState = current
      ? { ...current }
      : {
        nodeId: payload.nodeId,
        fileName: payload.fileName,
        nodeType: payload.nodeType,
        renderCount: 0,
        commitCount: 0,
        dragCommitCount: 0,
        totalCommitMs: 0,
        averageCommitMs: 0,
        maxCommitMs: 0,
        firstRecordedAt: recordedAt,
        lastRecordedAt: recordedAt,
      };

    next.fileName = payload.fileName;
    next.nodeType = payload.nodeType;
    next.renderCount += 1;
    next.commitCount += 1;
    next.totalCommitMs += Math.max(0, payload.commitDurationMs);
    next.averageCommitMs = next.totalCommitMs / Math.max(1, next.commitCount);
    next.maxCommitMs = Math.max(next.maxCommitMs, payload.commitDurationMs);
    next.lastRecordedAt = recordedAt;
    if (payload.dragging) {
      next.dragCommitCount += 1;
    }
    next.commitsPerSecond = this.calculateFrequencyPerSecond(
      next.commitCount,
      next.firstRecordedAt,
      next.lastRecordedAt
    );

    this.fileNodeRenderMetrics.set(payload.nodeId, next);
    this.pruneFileNodeRenderMetrics();
  }

  recordImageResourceSubscription(payload: {
    nodeId: string;
    mode: ImageLifecycleMode;
    phase: 'subscribe' | 'unsubscribe';
    activeSubscriptions: number;
    activeNodesWithSubscriptions: number;
  }): void {
    const summary = this.subscriptionSummaryState;
    const delta = payload.phase === 'subscribe' ? 1 : -1;
    summary.totalSubscriptions = Math.max(0, summary.totalSubscriptions + delta);
    summary.peakSubscriptions = Math.max(summary.peakSubscriptions, summary.totalSubscriptions);
    if (payload.mode === 'canvas') {
      summary.canvasSubscriptions = Math.max(0, summary.canvasSubscriptions + delta);
      if (payload.phase === 'subscribe') {
        summary.canvasSubscribeCalls += 1;
      }
    } else {
      summary.originalSubscriptions = Math.max(0, summary.originalSubscriptions + delta);
      if (payload.phase === 'subscribe') {
        summary.originalSubscribeCalls += 1;
      }
    }

    if (payload.phase === 'subscribe') {
      summary.totalSubscribeCalls += 1;
      summary.uniqueSubscribedNodes.add(payload.nodeId);
    } else {
      summary.totalUnsubscribeCalls += 1;
    }

    summary.activeNodesWithSubscriptions = Math.max(0, payload.activeNodesWithSubscriptions);
  }

  recordUploadSnapshotRead(nodeId: string): void {
    const summary = this.subscriptionSummaryState;
    summary.uploadSnapshotReadCount += 1;
    summary.uploadNodesObserved.add(nodeId);
  }

  getSnapshot(): CanvasImagePerformanceSnapshot {
    const recordedAt = this.now();
    const imageThumbnailWorkerQueueEvents = this.imageThumbnailWorkerQueueEvents
      .slice()
      .sort((left, right) => right.eventId - left.eventId)
      .map((event) => ({ ...event }));
    return {
      observerActive: this.observerActive,
      recordedAt,
      diagnostics: this.getDiagnosticsConfig(),
      longTasks: [...this.longTasks],
      longTaskSummary: this.buildLongTaskSummary(this.longTasks),
      importBatches: this.importBatchOrder
        .map((batchId) => this.importBatches.get(batchId))
        .filter((batch): batch is ImportBatchState => Boolean(batch))
        .map((batch) => this.buildImportBatchSnapshot(batch, recordedAt)),
      runtimeSyncs: this.runtimeSyncs
        .slice()
        .sort((left, right) => right.syncId - left.syncId)
        .map((sync) => ({ ...sync })),
      runtimeSyncSummary: this.buildRuntimeSyncSummary(),
      dragVisibilityCommits: this.dragVisibilityCommits
        .slice()
        .sort((left, right) => right.commitId - left.commitId)
        .map((metric) => ({ ...metric })),
      dragVisibilitySummary: this.buildDragVisibilitySummary(),
      renderPlanMetrics: this.renderPlanMetrics
        .slice()
        .sort((left, right) => right.metricId - left.metricId)
        .map((metric) => ({ ...metric })),
      renderPlanSummary: this.buildRenderPlanSummary(),
      rasterMetrics: this.rasterMetrics
        .slice()
        .sort((left, right) => right.metricId - left.metricId)
        .map((metric) => ({ ...metric })),
      rasterSummary: this.buildRasterSummary(),
      imageManagerEmitSummary: this.buildImageManagerEmitSummary(),
      rasterRebuildSummary: this.buildRasterRebuildSummary(),
      nodePatchSummary: this.buildNodePatchSummary(),
      nodesReferenceSummary: this.buildNodesReferenceSummary(),
      nodePatchQueueSummary: this.buildNodePatchQueueSummary(),
      moveEndMetrics: this.moveEndMetrics
        .slice()
        .sort((left, right) => right.metricId - left.metricId)
        .map((metric) => ({ ...metric })),
      moveEndSummary: this.buildMoveEndSummary(),
      fileNodeCommits: Array.from(this.fileNodeCommits.values())
        .sort((left, right) => right.lastCommittedAt - left.lastCommittedAt)
        .map((metric) => ({ ...metric })),
      fileNodeRenderSummary: this.getFileNodeRenderSummary(),
      subscriptionSummary: this.getSubscriptionSummary(),
      memorySamples: this.memorySamples.slice().sort((left, right) => right.sampledAt - left.sampledAt),
      memorySummary: this.buildMemorySummary(),
      canvasSession: this.sessionSnapshot ? { ...this.sessionSnapshot } : undefined,
      lifecycleEvents: this.getLifecycleEvents(),
      nodeLifecycleStats: this.getNodeLifecycleStats(),
      suspectedLoops: this.getSuspectedLoops(),
      imageThumbnailWorkerQueueEvents,
      imageThumbnailWorkerQueueSummary: this.buildImageThumbnailWorkerQueueSummary(imageThumbnailWorkerQueueEvents),
    };
  }

  getSummary(
    imageManagerSnapshot?: ImageManagerDebugSnapshotLike
  ): CanvasImagePerformanceSummarySnapshot {
    const resolvedImageManagerSnapshot = resolveImageManagerDebugSnapshot(imageManagerSnapshot);
    const snapshot = this.getSnapshot();
    const latestDragVisibilityCommit = snapshot.dragVisibilityCommits[0];
    const latestRenderPlan = snapshot.renderPlanMetrics[0];
    const latestRasterMetric = snapshot.rasterMetrics[0];
    const latestMoveEndMetric = snapshot.moveEndMetrics[0];
    const cache = buildCacheDebugSummary(resolvedImageManagerSnapshot);

    return {
      recordedAt: snapshot.recordedAt,
      diagnostics: snapshot.diagnostics,
      longTaskSummary: snapshot.longTaskSummary,
      runtimeSyncSummary: snapshot.runtimeSyncSummary,
      dragVisibilitySummary: snapshot.dragVisibilitySummary,
      latestDragVisibilityCommit,
      renderPlanSummary: snapshot.renderPlanSummary,
      latestRenderPlan,
      rasterSummary: snapshot.rasterSummary,
      latestRasterMetric,
      imageManagerEmitSummary: snapshot.imageManagerEmitSummary,
      rasterRebuildSummary: snapshot.rasterRebuildSummary,
      nodePatchSummary: snapshot.nodePatchSummary,
      nodesReferenceSummary: snapshot.nodesReferenceSummary,
      nodePatchQueueSummary: snapshot.nodePatchQueueSummary,
      moveEndSummary: snapshot.moveEndSummary,
      latestMoveEndMetric,
      fileNodeRenderSummary: snapshot.fileNodeRenderSummary,
      subscriptionSummary: snapshot.subscriptionSummary,
      memorySummary: snapshot.memorySummary,
      canvasSession: snapshot.canvasSession,
      cache,
      renderPlanPressure: evaluateCanvasRenderPlanPressure({
        canvasSession: snapshot.canvasSession,
        dragVisibilitySummary: snapshot.dragVisibilitySummary,
        fileNodeRenderSummary: snapshot.fileNodeRenderSummary,
        longTaskSummary: snapshot.longTaskSummary,
        runtimeSyncSummary: snapshot.runtimeSyncSummary,
        cache,
      }),
      imageThumbnailWorkerQueue: snapshot.imageThumbnailWorkerQueueSummary,
      thumbnailFailureSummary: this.buildThumbnailFailureSummary(snapshot),
    };
  }

  getFlickerDebugSnapshot(
    imageManagerSnapshot?: ImageManagerDebugSnapshotLike
  ): CanvasImageFlickerDebugSnapshot {
    const resolvedImageManagerSnapshot = resolveImageManagerDebugSnapshot(imageManagerSnapshot);
    const performanceSnapshot = this.getSnapshot();
    const cache = buildCacheDebugSummary(resolvedImageManagerSnapshot);

    return {
      recordedAt: this.now(),
      baseline: {
        name: '55 remote protected image workflow',
        expectedRemoteProtectedImageCount: REMOTE_PROTECTED_IMAGE_BASELINE_COUNT,
        maxThumbnailEntriesAtReportTime: cache?.thumbnailEntryLimit,
      },
      session: this.sessionSnapshot ? { ...this.sessionSnapshot } : undefined,
      cache,
      lifecycleEvents: performanceSnapshot.lifecycleEvents,
      nodeLifecycleStats: performanceSnapshot.nodeLifecycleStats,
      suspectedLoops: performanceSnapshot.suspectedLoops,
      performance: performanceSnapshot,
    };
  }

  reset(): void {
    this.longTasks.length = 0;
    this.importBatches.clear();
    this.importBatchOrder.length = 0;
    this.importedNodes.clear();
    this.runtimeSyncs.length = 0;
    this.dragVisibilityCommits.length = 0;
    this.renderPlanMetrics.length = 0;
    this.rasterMetrics.length = 0;
    this.imageManagerEmitSummaryState.totalEmits = 0;
    this.imageManagerEmitSummaryState.canvasEmits = 0;
    this.imageManagerEmitSummaryState.originalEmits = 0;
    this.imageManagerEmitSummaryState.uniqueNodeIds.clear();
    this.imageManagerEmitSummaryState.firstRecordedAt = undefined;
    this.imageManagerEmitSummaryState.lastRecordedAt = undefined;
    this.imageManagerEmitSummaryState.firstCanvasRecordedAt = undefined;
    this.imageManagerEmitSummaryState.lastCanvasRecordedAt = undefined;
    this.imageManagerEmitSummaryState.firstOriginalRecordedAt = undefined;
    this.imageManagerEmitSummaryState.lastOriginalRecordedAt = undefined;
    this.imageManagerEmitSummaryState.lastNodeId = undefined;
    this.imageManagerEmitSummaryState.lastMode = undefined;
    this.rasterRebuildSummaryState.totalRebuilds = 0;
    this.rasterRebuildSummaryState.totalDurationMs = 0;
    this.rasterRebuildSummaryState.durationSampleCount = 0;
    this.rasterRebuildSummaryState.byReason.clear();
    this.rasterRebuildSummaryState.maxDurationMs = undefined;
    this.rasterRebuildSummaryState.maxCandidateNodeCount = undefined;
    this.rasterRebuildSummaryState.maxItemCount = undefined;
    this.rasterRebuildSummaryState.firstRecordedAt = undefined;
    this.rasterRebuildSummaryState.lastRecordedAt = undefined;
    this.rasterRebuildSummaryState.lastReason = undefined;
    this.rasterRebuildSummaryState.lastCandidateNodeCount = undefined;
    this.rasterRebuildSummaryState.lastItemCount = undefined;
    this.nodePatchSummaryState.totalAttempts = 0;
    this.nodePatchSummaryState.totalUpdated = 0;
    this.nodePatchSummaryState.totalSkipped = 0;
    this.nodePatchSummaryState.byReason.clear();
    this.nodePatchSummaryState.byBatchId.clear();
    this.nodePatchSummaryState.attemptsByNodeId.clear();
    this.nodePatchSummaryState.firstRecordedAt = undefined;
    this.nodePatchSummaryState.lastRecordedAt = undefined;
    this.nodePatchSummaryState.lastNodeId = undefined;
    this.nodePatchSummaryState.lastReason = undefined;
    this.nodePatchSummaryState.lastBatchId = undefined;
    this.nodesReferenceSummaryState.totalChanges = 0;
    this.nodesReferenceSummaryState.firstRecordedAt = undefined;
    this.nodesReferenceSummaryState.lastRecordedAt = undefined;
    this.nodesReferenceSummaryState.lastNodeCount = undefined;
    this.nodesReferenceSummaryState.maxNodeCount = undefined;
    this.nodesReferenceSummaryState.lastReason = undefined;
    this.nodePatchQueueSummaryState.pendingCount = 0;
    this.nodePatchQueueSummaryState.maxPendingCount = 0;
    this.nodePatchQueueSummaryState.enqueueCount = 0;
    this.nodePatchQueueSummaryState.flushCount = 0;
    this.nodePatchQueueSummaryState.totalFlushDurationMs = 0;
    this.nodePatchQueueSummaryState.flushDurationSampleCount = 0;
    this.nodePatchQueueSummaryState.maxFlushDurationMs = undefined;
    this.nodePatchQueueSummaryState.firstRecordedAt = undefined;
    this.nodePatchQueueSummaryState.lastRecordedAt = undefined;
    this.moveEndMetrics.length = 0;
    this.fileNodeCommits.clear();
    this.fileNodeRenderMetrics.clear();
    this.lifecycleEvents.length = 0;
    this.lifecycleStats.clear();
    this.memorySamples.length = 0;
    this.imageThumbnailWorkerQueueEvents.length = 0;
    this.dragVisibilityAggregate = {
      totalComputations: 0,
      totalBatchCommits: 0,
      totalDurationMs: 0,
    };
    this.subscriptionSummaryState.totalSubscriptions = 0;
    this.subscriptionSummaryState.peakSubscriptions = 0;
    this.subscriptionSummaryState.canvasSubscriptions = 0;
    this.subscriptionSummaryState.originalSubscriptions = 0;
    this.subscriptionSummaryState.totalSubscribeCalls = 0;
    this.subscriptionSummaryState.totalUnsubscribeCalls = 0;
    this.subscriptionSummaryState.uniqueSubscribedNodes.clear();
    this.subscriptionSummaryState.activeNodesWithSubscriptions = 0;
    this.subscriptionSummaryState.canvasSubscribeCalls = 0;
    this.subscriptionSummaryState.originalSubscribeCalls = 0;
    this.subscriptionSummaryState.uploadSnapshotReadCount = 0;
    this.subscriptionSummaryState.uploadNodesObserved.clear();
    this.sessionSnapshot = undefined;
    this.lifecycleEventSequence = 0;
    this.runtimeSyncSequence = 0;
    this.dragVisibilitySequence = 0;
    this.renderPlanMetricSequence = 0;
    this.rasterMetricSequence = 0;
    this.moveEndMetricSequence = 0;
    this.imageThumbnailWorkerQueueEventSequence = 0;
    this.lastSummaryReportAt = 0;
    this.lastLongTaskCountAtMemorySample = 0;
    this.lastLongTaskDurationAtMemorySample = 0;
    fileNodeDiagnosticCommits.clear();
    lastSessionSnapshotDiagnosticAt = 0;
  }

  private reduceImportStageSummary(
    batch: ImportBatchState,
    stage: CanvasImageImportStageSnapshot
  ): void {
    const current = batch.stageSummary.get(stage.stage);
    if (!current) {
      batch.stageSummary.set(stage.stage, {
        stage: stage.stage,
        count: 1,
        failed: stage.status === 'failed' ? 1 : 0,
        totalMs: stage.durationMs,
        maxMs: stage.durationMs,
        minMs: stage.durationMs,
        averageMs: stage.durationMs,
        firstStartedAt: stage.startedAt,
        lastCompletedAt: stage.completedAt,
      });
      return;
    }

    current.count += 1;
    current.failed += stage.status === 'failed' ? 1 : 0;
    current.totalMs += stage.durationMs;
    current.maxMs = Math.max(current.maxMs, stage.durationMs);
    current.minMs = Math.min(current.minMs, stage.durationMs);
    current.averageMs = current.totalMs / current.count;
    current.firstStartedAt = Math.min(current.firstStartedAt, stage.startedAt);
    current.lastCompletedAt = Math.max(current.lastCompletedAt, stage.completedAt);
  }

  private recordImportPreviewReadyFromCommit(
    commit: FileNodeCommitMetric,
    committedAt: number
  ): void {
    const importedNode = this.importedNodes.get(commit.nodeId);
    if (!importedNode || importedNode.nodeType !== 'image') {
      return;
    }

    const batch = this.importBatches.get(importedNode.batchId);
    if (!batch || batch.thumbnailReadyNodeIds.has(commit.nodeId)) {
      return;
    }

    const isPreviewReady = commit.requestEventKind === 'load-succeeded'
      || commit.placeholder === 'ready'
      || commit.resourceStatus === 'ready'
      || commit.viewerStatus === 'ready';

    if (!isPreviewReady) {
      return;
    }

    batch.thumbnailReadyNodeIds.add(commit.nodeId);
    batch.thumbnailReadyNodes = batch.thumbnailReadyNodeIds.size;
    batch.firstCanvasThumbnailReadyAt = batch.firstCanvasThumbnailReadyAt ?? committedAt;
    batch.firstCanvasThumbnailReadyMs = batch.firstCanvasThumbnailReadyAt - batch.startedAt;
    if (batch.thumbnailReadyTargetCount > 0 && batch.thumbnailReadyNodes >= batch.thumbnailReadyTargetCount) {
      batch.allCanvasThumbnailReadyAt = committedAt;
      batch.allCanvasThumbnailReadyMs = committedAt - batch.startedAt;
    }

    this.recordImportStage({
      batchId: importedNode.batchId,
      stage: 'canvas-thumbnail-ready',
      startedAt: batch.startedAt,
      completedAt: committedAt,
      durationMs: committedAt - batch.startedAt,
      nodeId: commit.nodeId,
      nodeType: importedNode.nodeType,
      fileName: importedNode.fileName,
      detail: {
        requestEventKind: commit.requestEventKind,
        resourceStatus: commit.resourceStatus,
        placeholder: commit.placeholder,
      },
    });
  }

  private buildImportBatchSnapshot(
    batch: ImportBatchState,
    recordedAt: number
  ): CanvasImageImportBatchSnapshot {
    const longTaskSummary = this.buildLongTaskSummary(this.getLongTasksForBatch(batch, recordedAt));
    const runtimeSyncWritesPerSecond = this.calculateFrequencyPerSecond(
      batch.runtimeSyncCount,
      batch.firstRuntimeSyncAt,
      batch.lastRuntimeSyncAt,
    );

    return {
      batchId: batch.batchId,
      total: batch.total,
      thumbnailReadyTargetCount: batch.thumbnailReadyTargetCount,
      completed: batch.completed,
      failed: batch.failed,
      startedAt: batch.startedAt,
      placeholdersReadyAt: batch.placeholdersReadyAt,
      batchCompletedAt: batch.batchCompletedAt,
      enhancementStartedAt: batch.enhancementStartedAt,
      enhancementSettledAt: batch.enhancementSettledAt,
      responseMs: batch.responseMs,
      totalMs: batch.totalMs,
      enhancementMs: batch.enhancementMs,
      pendingEnhancements: batch.pendingEnhancements,
      enhancedNodes: batch.enhancedNodes,
      thumbnailReadyNodes: batch.thumbnailReadyNodes,
      firstCanvasThumbnailReadyAt: batch.firstCanvasThumbnailReadyAt,
      allCanvasThumbnailReadyAt: batch.allCanvasThumbnailReadyAt,
      firstCanvasThumbnailReadyMs: batch.firstCanvasThumbnailReadyMs,
      allCanvasThumbnailReadyMs: batch.allCanvasThumbnailReadyMs,
      stages: batch.stages.map((stage) => ({ ...stage, detail: stage.detail ? { ...stage.detail } : undefined })),
      stageSummary: Array.from(batch.stageSummary.values())
        .sort((left, right) => left.firstStartedAt - right.firstStartedAt)
        .map((summary) => ({ ...summary })),
      longTaskCount: longTaskSummary.count,
      longTaskTotalMs: longTaskSummary.totalDurationMs,
      maxLongTaskMs: longTaskSummary.maxDurationMs,
      runtimeSyncCount: batch.runtimeSyncCount,
      runtimeSyncWritesPerSecond,
      runtimeSyncTotalMs: batch.runtimeSyncTotalMs,
      runtimeSyncMaxMs: batch.runtimeSyncMaxMs,
      lastRuntimeSyncAt: batch.lastRuntimeSyncAt,
    };
  }

  private getLongTasksForBatch(
    batch: ImportBatchState,
    recordedAt: number
  ): CanvasImageLongTaskSnapshot[] {
    const batchEnd = batch.allCanvasThumbnailReadyAt
      ?? batch.enhancementSettledAt
      ?? batch.batchCompletedAt
      ?? recordedAt;

    return this.longTasks.filter((task) => {
      const taskEnd = task.startTime + task.duration;
      return task.startTime <= batchEnd && taskEnd >= batch.startedAt;
    });
  }

  private buildLongTaskSummary(
    longTasks: CanvasImageLongTaskSnapshot[]
  ): CanvasImageLongTaskSummarySnapshot {
    if (longTasks.length === 0) {
      return {
        count: 0,
        totalDurationMs: 0,
      };
    }

    const durations = longTasks.map((task) => task.duration);
    return {
      count: longTasks.length,
      totalDurationMs: durations.reduce((sum, duration) => sum + duration, 0),
      maxDurationMs: Math.max(...durations),
    };
  }

  private buildRuntimeSyncSummary(): CanvasImageRuntimeSyncSummarySnapshot {
    if (this.runtimeSyncs.length === 0) {
      return {
        totalWrites: 0,
        totalDurationMs: 0,
      };
    }

    const sorted = this.runtimeSyncs.slice().sort((left, right) => left.recordedAt - right.recordedAt);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalDurationMs = sorted.reduce((sum, sync) => sum + sync.durationMs, 0);

    return {
      totalWrites: sorted.length,
      totalDurationMs,
      maxDurationMs: Math.max(...sorted.map((sync) => sync.durationMs)),
      averageDurationMs: totalDurationMs / sorted.length,
      writesPerSecond: this.calculateFrequencyPerSecond(
        sorted.length,
        first.recordedAt,
        last.recordedAt,
      ),
      firstRecordedAt: first.recordedAt,
      lastRecordedAt: last.recordedAt,
      lastBatchId: last.batchId,
      lastNodeCount: last.nodeCount,
      lastConnectionCount: last.connectionCount,
    };
  }

  private buildDragVisibilitySummary(): CanvasImageDragVisibilitySummarySnapshot {
    if (this.dragVisibilityAggregate.totalComputations === 0) {
      return {
        totalComputations: 0,
        totalBatchCommits: 0,
        totalDurationMs: 0,
      };
    }

    const aggregate = this.dragVisibilityAggregate;

    return {
      totalComputations: aggregate.totalComputations,
      totalBatchCommits: aggregate.totalBatchCommits,
      totalDurationMs: aggregate.totalDurationMs,
      maxDurationMs: aggregate.maxDurationMs,
      averageDurationMs: aggregate.totalDurationMs / aggregate.totalComputations,
      computationsPerSecond: this.calculateFrequencyPerSecond(
        aggregate.totalComputations,
        aggregate.firstRecordedAt,
        aggregate.lastRecordedAt,
      ),
      batchCommitsPerSecond: this.calculateFrequencyPerSecond(
        aggregate.totalBatchCommits,
        aggregate.firstRecordedAt,
        aggregate.lastRecordedAt,
      ),
      firstRecordedAt: aggregate.firstRecordedAt,
      lastRecordedAt: aggregate.lastRecordedAt,
      maxNodeCount: aggregate.maxNodeCount,
    };
  }

  private buildRenderPlanSummary(): CanvasRenderPlanMetricSummarySnapshot {
    if (this.renderPlanMetrics.length === 0) {
      return {
        totalPlans: 0,
        totalDurationMs: 0,
      };
    }

    const sorted = this.renderPlanMetrics.slice().sort((left, right) => left.recordedAt - right.recordedAt);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const durations = sorted
      .map((metric) => metric.durationMs)
      .filter((duration): duration is number => typeof duration === 'number');
    const totalDurationMs = durations.reduce((sum, duration) => sum + duration, 0);

    return {
      totalPlans: sorted.length,
      totalDurationMs,
      maxDurationMs: durations.length > 0 ? Math.max(...durations) : undefined,
      averageDurationMs: durations.length > 0 ? totalDurationMs / durations.length : undefined,
      lastNodeCount: last.nodeCount,
      lastRenderedNodeCount: last.renderedNodeCount,
      lastRenderedEdgeCount: last.renderedEdgeCount,
      lastFullNodeCount: last.fullNodeCount,
      lastCompactNodeCount: last.compactNodeCount,
      lastMinimalNodeCount: last.minimalNodeCount,
      lastProxyNodeCount: last.proxyNodeCount,
      lastImageFullDomNodeCount: last.imageFullDomNodeCount,
      lastImageShellNodeCount: last.imageShellNodeCount,
      lastImageObjectLayerCount: last.imageObjectLayerCount,
      lastPlaceholderNodeCount: last.placeholderNodeCount,
      lastRasterEligibleNodeCount: last.rasterEligibleNodeCount,
      lastReusedNodeCount: last.reusedNodeCount,
      lastCreatedNodeCount: last.createdNodeCount,
      firstRecordedAt: first.recordedAt,
      lastRecordedAt: last.recordedAt,
    };
  }

  private buildRasterSummary(): CanvasRasterMetricSummarySnapshot {
    if (this.rasterMetrics.length === 0) {
      return {
        totalEvents: 0,
        totalDurationMs: 0,
      };
    }

    const sorted = this.rasterMetrics.slice().sort((left, right) => left.recordedAt - right.recordedAt);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const durations = sorted
      .map((metric) => metric.durationMs)
      .filter((duration): duration is number => typeof duration === 'number');
    const totalDurationMs = durations.reduce((sum, duration) => sum + duration, 0);

    return {
      totalEvents: sorted.length,
      totalDurationMs,
      maxDurationMs: durations.length > 0 ? Math.max(...durations) : undefined,
      averageDurationMs: durations.length > 0 ? totalDurationMs / durations.length : undefined,
      lastReason: last.reason,
      lastCandidateNodeCount: last.candidateNodeCount,
      lastItemCount: last.itemCount,
      lastRegisteredNodeCount: last.registeredNodeCount,
      lastRequestedNodeCount: last.requestedNodeCount,
      maxCandidateNodeCount: Math.max(...sorted.map((metric) => metric.candidateNodeCount)),
      maxItemCount: Math.max(...sorted.map((metric) => metric.itemCount)),
      maxRegisteredNodeCount: Math.max(...sorted.map((metric) => metric.registeredNodeCount)),
      maxRequestedNodeCount: Math.max(...sorted.map((metric) => metric.requestedNodeCount)),
      lastTextureUploadCount: last.textureUploadCount,
      lastTextureEvictedCount: last.textureEvictedCount,
      lastTextureRetainedCount: last.textureRetainedCount,
      lastTextureByteEstimate: last.textureByteEstimate,
      lastActiveSpriteCount: last.activeSpriteCount,
      lastSpritePoolSize: last.spritePoolSize,
      maxTextureRetainedCount: Math.max(0, ...sorted.map((metric) => metric.textureRetainedCount ?? 0)),
      maxTextureByteEstimate: Math.max(0, ...sorted.map((metric) => metric.textureByteEstimate ?? 0)),
      maxActiveSpriteCount: Math.max(0, ...sorted.map((metric) => metric.activeSpriteCount ?? 0)),
      maxSpritePoolSize: Math.max(0, ...sorted.map((metric) => metric.spritePoolSize ?? 0)),
      firstRecordedAt: first.recordedAt,
      lastRecordedAt: last.recordedAt,
    };
  }

  private buildImageManagerEmitSummary(): CanvasImageManagerEmitSummarySnapshot {
    const summary = this.imageManagerEmitSummaryState;
    if (summary.totalEmits === 0) {
      return {
        totalEmits: 0,
        canvasEmits: 0,
        originalEmits: 0,
        uniqueNodeCount: 0,
      };
    }

    return {
      totalEmits: summary.totalEmits,
      canvasEmits: summary.canvasEmits,
      originalEmits: summary.originalEmits,
      uniqueNodeCount: summary.uniqueNodeIds.size,
      emitsPerSecond: this.calculateFrequencyPerSecond(
        summary.totalEmits,
        summary.firstRecordedAt,
        summary.lastRecordedAt,
      ),
      canvasEmitsPerSecond: this.calculateFrequencyPerSecond(
        summary.canvasEmits,
        summary.firstCanvasRecordedAt,
        summary.lastCanvasRecordedAt,
      ),
      originalEmitsPerSecond: this.calculateFrequencyPerSecond(
        summary.originalEmits,
        summary.firstOriginalRecordedAt,
        summary.lastOriginalRecordedAt,
      ),
      firstRecordedAt: summary.firstRecordedAt,
      lastRecordedAt: summary.lastRecordedAt,
      lastNodeId: summary.lastNodeId,
      lastMode: summary.lastMode,
    };
  }

  private buildRasterRebuildSummary(): CanvasRasterRebuildSummarySnapshot {
    const summary = this.rasterRebuildSummaryState;
    if (summary.totalRebuilds === 0) {
      return {
        totalRebuilds: 0,
        totalDurationMs: 0,
        byReason: [],
      };
    }

    return {
      totalRebuilds: summary.totalRebuilds,
      totalDurationMs: summary.totalDurationMs,
      maxDurationMs: summary.maxDurationMs,
      averageDurationMs: summary.durationSampleCount > 0
        ? summary.totalDurationMs / summary.durationSampleCount
        : undefined,
      rebuildsPerSecond: this.calculateFrequencyPerSecond(
        summary.totalRebuilds,
        summary.firstRecordedAt,
        summary.lastRecordedAt,
      ),
      byReason: this.buildMetricAggregate(summary.byReason),
      maxCandidateNodeCount: summary.maxCandidateNodeCount,
      maxItemCount: summary.maxItemCount,
      lastReason: summary.lastReason,
      lastCandidateNodeCount: summary.lastCandidateNodeCount,
      lastItemCount: summary.lastItemCount,
      firstRecordedAt: summary.firstRecordedAt,
      lastRecordedAt: summary.lastRecordedAt,
    };
  }

  private buildNodePatchSummary(): CanvasNodePatchSummarySnapshot {
    const summary = this.nodePatchSummaryState;
    if (summary.totalAttempts === 0) {
      return {
        totalAttempts: 0,
        totalUpdated: 0,
        totalSkipped: 0,
        uniqueNodeCount: 0,
        maxAttemptsPerNode: 0,
        byReason: [],
        byBatchId: [],
      };
    }

    const attemptsPerNode = Array.from(summary.attemptsByNodeId.values());

    return {
      totalAttempts: summary.totalAttempts,
      totalUpdated: summary.totalUpdated,
      totalSkipped: summary.totalSkipped,
      uniqueNodeCount: summary.attemptsByNodeId.size,
      maxAttemptsPerNode: attemptsPerNode.length > 0 ? Math.max(...attemptsPerNode) : 0,
      patchesPerSecond: this.calculateFrequencyPerSecond(
        summary.totalAttempts,
        summary.firstRecordedAt,
        summary.lastRecordedAt,
      ),
      byReason: this.buildMetricAggregate(summary.byReason),
      byBatchId: this.buildMetricAggregate(summary.byBatchId),
      firstRecordedAt: summary.firstRecordedAt,
      lastRecordedAt: summary.lastRecordedAt,
      lastNodeId: summary.lastNodeId,
      lastReason: summary.lastReason,
      lastBatchId: summary.lastBatchId,
    };
  }

  private buildNodesReferenceSummary(): CanvasNodesReferenceSummarySnapshot {
    const summary = this.nodesReferenceSummaryState;
    if (summary.totalChanges === 0) {
      return {
        totalChanges: 0,
      };
    }

    return {
      totalChanges: summary.totalChanges,
      changesPerSecond: this.calculateFrequencyPerSecond(
        summary.totalChanges,
        summary.firstRecordedAt,
        summary.lastRecordedAt,
      ),
      firstRecordedAt: summary.firstRecordedAt,
      lastRecordedAt: summary.lastRecordedAt,
      lastNodeCount: summary.lastNodeCount,
      maxNodeCount: summary.maxNodeCount,
      lastReason: summary.lastReason,
    };
  }

  private buildNodePatchQueueSummary(): CanvasNodePatchQueueSummarySnapshot {
    const summary = this.nodePatchQueueSummaryState;
    return {
      pendingCount: summary.pendingCount,
      maxPendingCount: summary.maxPendingCount,
      enqueueCount: summary.enqueueCount,
      flushCount: summary.flushCount,
      totalFlushDurationMs: summary.totalFlushDurationMs,
      maxFlushDurationMs: summary.maxFlushDurationMs,
      averageFlushDurationMs: summary.flushDurationSampleCount > 0
        ? summary.totalFlushDurationMs / summary.flushDurationSampleCount
        : undefined,
      firstRecordedAt: summary.firstRecordedAt,
      lastRecordedAt: summary.lastRecordedAt,
    };
  }

  private buildMoveEndSummary(): CanvasMoveEndMetricSummarySnapshot {
    if (this.moveEndMetrics.length === 0) {
      return {
        totalEvents: 0,
        totalDurationMs: 0,
        importingEvents: 0,
      };
    }

    const sorted = this.moveEndMetrics.slice().sort((left, right) => left.recordedAt - right.recordedAt);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalDurationMs = sorted.reduce((sum, metric) => sum + metric.totalDurationMs, 0);

    return {
      totalEvents: sorted.length,
      totalDurationMs,
      maxDurationMs: Math.max(...sorted.map((metric) => metric.totalDurationMs)),
      averageDurationMs: totalDurationMs / sorted.length,
      importingEvents: sorted.filter((metric) => metric.importing).length,
      maxDragVisibilityFlushMs: Math.max(...sorted.map((metric) => metric.dragVisibilityFlushMs)),
      maxImageWorkFlushMs: Math.max(...sorted.map((metric) => metric.imageWorkFlushMs)),
      maxVisibilityApplyMs: Math.max(...sorted.map((metric) => metric.visibilityApplyMs)),
      maxResourceScheduleMs: Math.max(...sorted.map((metric) => metric.resourceScheduleMs)),
      maxPatchQueueFlushMs: Math.max(...sorted.map((metric) => metric.patchQueueFlushMs)),
      maxWorkflowViewportSyncMs: Math.max(...sorted.map((metric) => metric.workflowViewportSyncMs)),
      maxViewportSyncMs: Math.max(...sorted.map((metric) => metric.viewportSyncMs)),
      firstRecordedAt: first.recordedAt,
      lastRecordedAt: last.recordedAt,
    };
  }

  private getFileNodeRenderSummary(): CanvasImageFileNodeRenderSummarySnapshot[] {
    return Array.from(this.fileNodeRenderMetrics.values())
      .sort((left, right) => right.lastRecordedAt - left.lastRecordedAt)
      .map((metric) => ({ ...metric }));
  }

  private getSubscriptionSummary(): CanvasImageSubscriptionSummarySnapshot {
    const summary = this.subscriptionSummaryState;
    return {
      totalSubscriptions: summary.totalSubscriptions,
      peakSubscriptions: summary.peakSubscriptions,
      canvasSubscriptions: summary.canvasSubscriptions,
      originalSubscriptions: summary.originalSubscriptions,
      totalSubscribeCalls: summary.totalSubscribeCalls,
      totalUnsubscribeCalls: summary.totalUnsubscribeCalls,
      uniqueSubscribedNodes: summary.uniqueSubscribedNodes.size,
      activeNodesWithSubscriptions: summary.activeNodesWithSubscriptions,
      canvasSubscribeCalls: summary.canvasSubscribeCalls,
      originalSubscribeCalls: summary.originalSubscribeCalls,
      uploadSnapshotReadCount: summary.uploadSnapshotReadCount,
      uploadNodesObserved: summary.uploadNodesObserved.size,
    };
  }

  private buildMetricAggregate(
    counts: ReadonlyMap<string, number>
  ): CanvasImageMetricAggregateSnapshot[] {
    return Array.from(counts.entries())
      .map(([key, count]) => ({ key, count }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
  }

  private buildMemorySummary(): CanvasImageMemorySummarySnapshot {
    if (this.memorySamples.length === 0) {
      return {
        sampleCount: 0,
      };
    }

    const usedHeapSamples = this.memorySamples
      .map((sample) => sample.usedJSHeapSize)
      .filter((value): value is number => typeof value === 'number');
    const latestSample = this.memorySamples[this.memorySamples.length - 1];

    return {
      sampleCount: this.memorySamples.length,
      latestSample: latestSample ? { ...latestSample } : undefined,
      maxUsedJSHeapSize: usedHeapSamples.length > 0 ? Math.max(...usedHeapSamples) : undefined,
      averageUsedJSHeapSize: usedHeapSamples.length > 0
        ? usedHeapSamples.reduce((sum, value) => sum + value, 0) / usedHeapSamples.length
        : undefined,
      maxLongTaskCountSinceLastSample: Math.max(...this.memorySamples.map((sample) => sample.longTaskCountSinceLastSample)),
      maxLongTaskDurationSinceLastSample: Math.max(...this.memorySamples.map((sample) => sample.longTaskDurationSinceLastSample)),
    };
  }

  private buildImageThumbnailWorkerQueueSummary(
    events: CanvasImageThumbnailWorkerQueueEventSnapshot[],
  ): CanvasImageThumbnailWorkerQueueSummarySnapshot {
    const latest = events[0];
    return {
      eventCount: events.length,
      lastEventKind: latest?.eventKind,
      activeTaskId: latest?.activeTaskId ?? null,
      queuedTaskCount: latest?.queuedTaskCount ?? 0,
      activeTaskCount: latest?.activeTaskCount ?? 0,
      totalTaskCount: latest?.totalTaskCount ?? 0,
      restartCount: latest?.restartCount ?? 0,
      timeoutCount: latest?.timeoutCount ?? 0,
      errorCount: latest?.errorCount ?? 0,
      lastRecordedAt: latest?.recordedAt,
    };
  }

  private buildThumbnailFailureSummary(
    snapshot: CanvasImagePerformanceSnapshot,
  ): CanvasImageThumbnailFailureSummarySnapshot {
    const failures: ImageThumbnailFailureDetail[] = [];

    snapshot.lifecycleEvents.forEach((event) => {
      if (event.eventKind !== 'preview-failed' || !event.detail) {
        return;
      }

      const failureCode = event.detail.failureCode;
      const failureStage = event.detail.failureStage;
      const retryable = event.detail.retryable;

      if (
        !isImageThumbnailFailureCodeValue(failureCode) ||
        !isImageThumbnailFailureStageValue(failureStage) ||
        typeof retryable !== 'boolean'
      ) {
        return;
      }

      failures.push({
        failureCode,
        failureStage,
        retryable,
        message: typeof event.detail.message === 'string' ? event.detail.message : undefined,
        durationMs: typeof event.detail.durationMs === 'number' ? event.detail.durationMs : undefined,
        queueWaitMs: typeof event.detail.queueWaitMs === 'number' ? event.detail.queueWaitMs : undefined,
        executeMs: typeof event.detail.executeMs === 'number' ? event.detail.executeMs : undefined,
        timeoutMs: typeof event.detail.timeoutMs === 'number' ? event.detail.timeoutMs : undefined,
      });
    });

    snapshot.imageThumbnailWorkerQueueEvents.forEach((event) => {
      if (!event.detail) {
        return;
      }

      const failureCode = event.detail.errorCode;
      const failureStage = event.detail.failureStage;
      const retryable = event.detail.retryable;

      if (
        !isImageThumbnailFailureCodeValue(failureCode) ||
        !isImageThumbnailFailureStageValue(failureStage) ||
        typeof retryable !== 'boolean'
      ) {
        return;
      }

      failures.push({
        failureCode,
        failureStage,
        retryable,
        message: typeof event.detail.errorMessage === 'string'
          ? event.detail.errorMessage
          : (typeof event.detail.message === 'string' ? event.detail.message : undefined),
        durationMs: typeof event.detail.durationMs === 'number' ? event.detail.durationMs : undefined,
        queueWaitMs: typeof event.detail.queueWaitMs === 'number' ? event.detail.queueWaitMs : undefined,
        executeMs: typeof event.detail.executeMs === 'number' ? event.detail.executeMs : undefined,
        timeoutMs: typeof event.detail.timeoutMs === 'number' ? event.detail.timeoutMs : undefined,
      });
    });

    return {
      totalFailures: failures.length,
      byFailureCode: buildThumbnailFailureAggregate(failures.map((failure) => failure.failureCode)),
      byFailureStage: buildThumbnailFailureAggregate(failures.map((failure) => failure.failureStage)),
      byRetryable: buildThumbnailFailureAggregate(failures.map((failure) => String(failure.retryable))),
    };
  }

  private reduceDragVisibilityAggregate(metric: CanvasImageDragVisibilitySnapshot): void {
    const aggregate = this.dragVisibilityAggregate;
    aggregate.totalComputations += 1;
    aggregate.totalBatchCommits += 1;
    aggregate.totalDurationMs += metric.durationMs;
    aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs ?? 0, metric.durationMs);
    aggregate.firstRecordedAt = aggregate.firstRecordedAt ?? metric.recordedAt;
    aggregate.lastRecordedAt = metric.recordedAt;
    aggregate.maxNodeCount = Math.max(aggregate.maxNodeCount ?? 0, metric.nodeCount);
  }

  private shouldStoreDragVisibilityDetail(
    metric: CanvasImageDragVisibilitySnapshot,
    config: CanvasImageDiagnosticsConfigSnapshot
  ): boolean {
    if (metric.reason === 'flush') {
      return true;
    }

    if (metric.durationMs >= DRAG_VISIBILITY_SLOW_DETAIL_THRESHOLD_MS) {
      return true;
    }

    if (!config.enabled) {
      return false;
    }

    return metric.commitId % Math.max(1, config.dragDetailSampleInterval) === 0;
  }

  private maybeReportSummary(
    config: CanvasImageDiagnosticsConfigSnapshot,
    recordedAt: number
  ): void {
    if (!config.autoReport) {
      return;
    }

    if (recordedAt - this.lastSummaryReportAt < config.summaryReportThrottleMs) {
      return;
    }

    this.lastSummaryReportAt = recordedAt;
    log.info('auto-report-summary', 'Canvas image performance summary', {
      summary: this.getSummary(),
    });
  }

  private getDiagnosticsConfig(): CanvasImageDiagnosticsConfigSnapshot {
    return resolveCanvasImageDiagnosticsConfig();
  }

  private calculateFrequencyPerSecond(
    count: number,
    startedAt: number | undefined,
    completedAt: number | undefined
  ): number | undefined {
    if (count <= 1 || typeof startedAt !== 'number' || typeof completedAt !== 'number') {
      return undefined;
    }

    const elapsedSeconds = Math.max((completedAt - startedAt) / 1000, 0.001);
    return count / elapsedSeconds;
  }

  private sampleMemoryUsage(): void {
    if (typeof window === 'undefined' || !import.meta.env?.DEV) {
      return;
    }

    const memory = (performance as Performance & {
      memory?: {
        usedJSHeapSize?: number;
        totalJSHeapSize?: number;
        jsHeapSizeLimit?: number;
      };
    }).memory;
    const totalLongTaskDuration = this.longTasks.reduce((sum, task) => sum + task.duration, 0);
    const sample: CanvasImageMemorySampleSnapshot = {
      sampledAt: this.now(),
      usedJSHeapSize: memory?.usedJSHeapSize,
      totalJSHeapSize: memory?.totalJSHeapSize,
      jsHeapSizeLimit: memory?.jsHeapSizeLimit,
      longTaskCountSinceLastSample: Math.max(0, this.longTasks.length - this.lastLongTaskCountAtMemorySample),
      longTaskDurationSinceLastSample: Math.max(0, totalLongTaskDuration - this.lastLongTaskDurationAtMemorySample),
    };

    this.lastLongTaskCountAtMemorySample = this.longTasks.length;
    this.lastLongTaskDurationAtMemorySample = totalLongTaskDuration;
    this.memorySamples.push(sample);
    if (this.memorySamples.length > MAX_MEMORY_SAMPLES) {
      this.memorySamples.splice(0, this.memorySamples.length - MAX_MEMORY_SAMPLES);
    }
  }

  private ensureMemorySampler(): void {
    if (typeof window === 'undefined' || !import.meta.env?.DEV) {
      return;
    }

    if (this.memorySampleTimer) {
      return;
    }

    const tick = (): void => {
      this.sampleMemoryUsage();
      this.memorySampleTimer = window.setTimeout(tick, 2000);
    };

    tick();
  }

  private recordLifecycleEventFromCommit(
    commit: FileNodeCommitMetric,
    committedAt: number
  ): void {
    if (commit.nodeType !== 'image') {
      return;
    }

    const eventKind = normalizeLifecycleEventKind(commit.requestEventKind);
    if (!eventKind) {
      return;
    }

    const mode: ImageLifecycleMode = 'canvas';
    const statsKey = `${commit.nodeId}:${mode}`;
    const previous = this.lifecycleStats.get(statsKey);
    const eventSignature = [
      eventKind,
      commit.requestEventClassification ?? '',
      commit.requestKey ?? '',
      commit.attemptedUrl ?? '',
      commit.src ?? '',
      commit.requestSwitchReason ?? '',
      commit.resourceStatus ?? '',
      commit.resourcePhase ?? '',
    ].join('|');

    if (previous?.eventSignature === eventSignature) {
      this.lifecycleStats.set(statsKey, {
        ...previous,
        fileName: commit.fileName,
        currentRequestKey: commit.requestKey,
        lastResourcePhase: commit.resourcePhase,
        lastRecordedAt: committedAt,
      });
      return;
    }

    const event: CanvasImageLifecycleEventSnapshot = {
      eventId: this.lifecycleEventSequence + 1,
      nodeId: commit.nodeId,
      mode,
      fileName: commit.fileName,
      eventKind,
      classification: commit.requestEventClassification,
      requestKey: commit.requestKey,
      switchReason: commit.requestSwitchReason,
      eventReason: commit.requestEventReason,
      attemptedUrl: commit.attemptedUrl,
      src: commit.src,
      resourceStatus: commit.resourceStatus,
      resourcePhase: commit.resourcePhase,
      activeVariantKind: commit.activeVariantKind,
      placeholder: commit.placeholder,
      isVisible: commit.isVisible,
      isNearViewport: commit.isNearViewport,
      recordedAt: committedAt,
    };

    this.lifecycleEventSequence = event.eventId;
    this.lifecycleEvents.push(event);
    if (this.lifecycleEvents.length > MAX_LIFECYCLE_EVENTS) {
      this.lifecycleEvents.splice(0, this.lifecycleEvents.length - MAX_LIFECYCLE_EVENTS);
    }

    this.lifecycleStats.set(statsKey, this.reduceLifecycleStats(previous, event, eventSignature));
  }

  private reduceLifecycleStats(
    previous: LifecycleStatsState | undefined,
    event: CanvasImageLifecycleEventSnapshot,
    eventSignature: string
  ): LifecycleStatsState {
    const next: LifecycleStatsState = previous
      ? { ...previous }
      : {
        nodeId: event.nodeId,
        mode: event.mode,
        fileName: event.fileName,
        totalEvents: 0,
        registerCount: 0,
        requestStartedCount: 0,
        loadSucceededCount: 0,
        releaseCount: 0,
        loadFailedCount: 0,
        lastRecordedAt: event.recordedAt,
        requestAfterReleaseCount: 0,
        readyReleaseRequestLoopCount: 0,
      };

    next.fileName = event.fileName ?? next.fileName;
    next.totalEvents += 1;
    next.currentRequestKey = event.requestKey;
    next.lastEventKind = event.eventKind;
    next.lastRequestKey = event.requestKey;
    next.lastSwitchReason = event.switchReason;
    next.lastAttemptedUrl = event.attemptedUrl;
    next.lastResourcePhase = event.resourcePhase;
    next.lastRecordedAt = event.recordedAt;
    next.eventSignature = eventSignature;

    if (event.eventKind === 'register') {
      next.registerCount += 1;
    }

    if (event.eventKind === 'request-started') {
      next.requestStartedCount += 1;
      if (next.lastReleaseAt && event.recordedAt - next.lastReleaseAt <= READY_RELEASE_REQUEST_WINDOW_MS) {
        next.requestAfterReleaseCount += 1;
        if (next.lastReadyAt && next.lastReleaseAt >= next.lastReadyAt) {
          next.readyReleaseRequestLoopCount += 1;
        }
      }
    }

    if (event.eventKind === 'load-succeeded') {
      next.loadSucceededCount += 1;
      next.lastReadyAt = event.recordedAt;
    }

    if (event.eventKind === 'release') {
      next.releaseCount += 1;
      next.lastReleaseAt = event.recordedAt;
    }

    if (event.eventKind === 'load-failed') {
      next.loadFailedCount += 1;
    }

    return next;
  }

  private getLifecycleEvents(): CanvasImageLifecycleEventSnapshot[] {
    return this.lifecycleEvents
      .slice()
      .sort((left, right) => right.eventId - left.eventId)
      .map((event) => ({ ...event }));
  }

  private getNodeLifecycleStats(): CanvasImageNodeLifecycleStats[] {
    return Array.from(this.lifecycleStats.values())
      .sort((left, right) => right.lastRecordedAt - left.lastRecordedAt)
      .map((stats) => toPublicLifecycleStats(stats));
  }

  private getSuspectedLoops(): CanvasImageFlickerLoopSnapshot[] {
    return Array.from(this.lifecycleStats.values())
      .filter((stats) => stats.readyReleaseRequestLoopCount > 0 || stats.requestAfterReleaseCount > 1)
      .sort((left, right) => {
        const loopDelta = right.readyReleaseRequestLoopCount - left.readyReleaseRequestLoopCount;
        if (loopDelta !== 0) {
          return loopDelta;
        }

        return right.requestAfterReleaseCount - left.requestAfterReleaseCount;
      })
      .map((stats) => ({
        nodeId: stats.nodeId,
        mode: stats.mode,
        fileName: stats.fileName,
        loopCount: stats.readyReleaseRequestLoopCount,
        requestAfterReleaseCount: stats.requestAfterReleaseCount,
        releaseCount: stats.releaseCount,
        requestStartedCount: stats.requestStartedCount,
        lastRequestKey: stats.lastRequestKey,
        lastSwitchReason: stats.lastSwitchReason,
        lastAttemptedUrl: stats.lastAttemptedUrl,
        lastResourcePhase: stats.lastResourcePhase,
        lastRecordedAt: stats.lastRecordedAt,
      }));
  }

  private ensureLongTaskObserver(): void {
    if (typeof window === 'undefined' || !import.meta.env?.DEV) {
      return;
    }

    if (typeof PerformanceObserver === 'undefined') {
      return;
    }

    const supportedEntryTypes = PerformanceObserver.supportedEntryTypes ?? [];
    if (!supportedEntryTypes.includes('longtask')) {
      return;
    }

    if (this.observer) {
      return;
    }

    this.observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        this.longTasks.push({
          name: entry.name,
          startTime: entry.startTime,
          duration: entry.duration,
        });
      });

      if (this.longTasks.length > MAX_LONG_TASKS) {
        this.longTasks.splice(0, this.longTasks.length - MAX_LONG_TASKS);
      }
    });

    this.observer.observe({
      type: 'longtask',
      buffered: true,
    });
    this.observerActive = true;
  }

  private pruneFileNodeMetrics(): void {
    if (this.fileNodeCommits.size <= MAX_FILE_NODE_METRICS) {
      return;
    }

    const overflow = this.fileNodeCommits.size - MAX_FILE_NODE_METRICS;
    const staleNodes = Array.from(this.fileNodeCommits.values())
      .sort((left, right) => left.lastCommittedAt - right.lastCommittedAt)
      .slice(0, overflow);

    staleNodes.forEach((metric) => {
      this.fileNodeCommits.delete(metric.nodeId);
    });
  }

  private pruneFileNodeRenderMetrics(): void {
    if (this.fileNodeRenderMetrics.size <= MAX_FILE_NODE_RENDER_METRICS) {
      return;
    }

    const overflow = this.fileNodeRenderMetrics.size - MAX_FILE_NODE_RENDER_METRICS;
    const staleNodes = Array.from(this.fileNodeRenderMetrics.values())
      .sort((left, right) => left.lastRecordedAt - right.lastRecordedAt)
      .slice(0, overflow);

    staleNodes.forEach((metric) => {
      this.fileNodeRenderMetrics.delete(metric.nodeId);
    });
  }

  private touchImportBatch(batchId: string): void {
    const index = this.importBatchOrder.indexOf(batchId);
    if (index >= 0) {
      this.importBatchOrder.splice(index, 1);
    }

    this.importBatchOrder.push(batchId);
    if (this.importBatchOrder.length > MAX_IMPORT_BATCHES) {
      const removedBatchId = this.importBatchOrder.shift();
      if (removedBatchId) {
        this.importBatches.delete(removedBatchId);
        this.clearImportedNodesForBatch(removedBatchId);
      }
    }
  }

  private clearImportedNodesForBatch(batchId: string): void {
    this.importedNodes.forEach((node, nodeId) => {
      if (node.batchId === batchId) {
        this.importedNodes.delete(nodeId);
      }
    });
  }

  private now(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }

    return Date.now();
  }
}

export const canvasImagePerformanceMonitor = new CanvasImagePerformanceMonitor();

export function startCanvasImportBatch(batchId: string, total: number, startedAt?: number): void {
  canvasImagePerformanceMonitor.startImportBatch(batchId, total, startedAt);
}

export function registerCanvasImportNodes(payload: {
  batchId: string;
  nodes: Array<{
    nodeId: string;
    nodeType: FileNodeMetricType;
    fileName: string;
  }>;
}): void {
  canvasImagePerformanceMonitor.registerImportNodes(payload.batchId, payload.nodes.map((node) => ({
    batchId: payload.batchId,
    nodeId: node.nodeId,
    nodeType: node.nodeType,
    fileName: node.fileName,
  })));
}

export function recordCanvasImportStage(payload: {
  batchId: string;
  stage: CanvasImageImportStageName;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  status?: CanvasImageImportStageStatus;
  nodeId?: string;
  nodeType?: FileNodeMetricType;
  fileName?: string;
  itemCount?: number;
  detail?: CanvasImageMetricDetail;
}): void {
  canvasImagePerformanceMonitor.recordImportStage(payload);
  recordCanvasTraceEvent({
    type: 'operation.import',
    phase: payload.completedAt === undefined ? 'start' : 'end',
    opId: payload.batchId,
    durationMs: payload.durationMs,
    data: {
      stage: payload.stage,
      status: payload.status,
      nodeType: payload.nodeType,
      itemCount: payload.itemCount,
      nodeId: payload.nodeId,
    },
    ts: payload.completedAt ?? payload.startedAt,
  });
}

export function markCanvasImportPlaceholdersReady(batchId: string): void {
  canvasImagePerformanceMonitor.markImportPlaceholdersReady(batchId);
}

export function markCanvasImportEnhancementStarted(batchId: string): void {
  canvasImagePerformanceMonitor.markImportEnhancementStarted(batchId);
}

export function markCanvasImportEnhancementSettled(batchId: string): void {
  canvasImagePerformanceMonitor.markImportEnhancementSettled(batchId);
}

export function completeCanvasImportBatch(batchId: string, completed: number, failed: number): void {
  canvasImagePerformanceMonitor.completeImportBatch(batchId, completed, failed);
}

export function recordCanvasRuntimeSync(payload: {
  batchId?: string;
  reason?: string;
  nodeCount: number;
  connectionCount: number;
  durationMs: number;
  snapshotBuildMs?: number;
  metadataNormalizeMs?: number;
  actionCommitMs?: number;
  recordedAt?: number;
}): void {
  canvasImagePerformanceMonitor.recordRuntimeSync(payload);
}

export function recordCanvasDragVisibility(payload: {
  reason?: 'frame' | 'flush';
  nodeCount: number;
  visibleNodeCount: number;
  nearViewportNodeCount: number;
  durationMs: number;
  computeMs: number;
  applyMs: number;
  recordedAt?: number;
}): void {
  canvasImagePerformanceMonitor.recordDragVisibility(payload);
  recordCanvasTraceEvent({
    type: 'visibility.flush',
    phase: 'end',
    durationMs: payload.durationMs,
    data: {
      reason: payload.reason,
      nodeCount: payload.nodeCount,
      visibleNodeCount: payload.visibleNodeCount,
      nearViewportNodeCount: payload.nearViewportNodeCount,
      computeMs: payload.computeMs,
      applyMs: payload.applyMs,
    },
    ts: payload.recordedAt,
  });
}

export function recordCanvasRenderPlanMetric(
  payload: Omit<CanvasRenderPlanMetricSnapshot, 'metricId' | 'recordedAt'> & {
    recordedAt?: number;
  }
): void {
  canvasImagePerformanceMonitor.recordRenderPlan(payload);
  recordCanvasTraceEvent({
    type: 'renderPlan.build',
    phase: 'end',
    durationMs: payload.durationMs,
    data: {
      nodeCount: payload.nodeCount,
      renderedNodeCount: payload.renderedNodeCount,
      fullNodeCount: payload.fullNodeCount,
      proxyNodeCount: payload.proxyNodeCount,
      imageFullDomNodeCount: payload.imageFullDomNodeCount,
      imageShellNodeCount: payload.imageShellNodeCount,
      imageObjectLayerCount: payload.imageObjectLayerCount,
      placeholderNodeCount: payload.placeholderNodeCount,
      rasterEligibleNodeCount: payload.rasterEligibleNodeCount,
      reusedNodeCount: payload.reusedNodeCount,
      createdNodeCount: payload.createdNodeCount,
    },
    ts: payload.recordedAt,
  });
}

export function recordCanvasRasterMetric(
  payload: Omit<CanvasRasterMetricSnapshot, 'metricId' | 'recordedAt'> & {
    recordedAt?: number;
  }
): void {
  canvasImagePerformanceMonitor.recordRasterMetric(payload);
  recordCanvasTraceEvent({
    type: payload.reason === 'draw' ? 'raster.draw' : 'resource.batch',
    phase: 'end',
    durationMs: payload.durationMs,
    data: {
      reason: payload.reason,
      candidateNodeCount: payload.candidateNodeCount,
      itemCount: payload.itemCount,
      registeredNodeCount: payload.registeredNodeCount,
      requestedNodeCount: payload.requestedNodeCount,
      readyItemCount: payload.readyItemCount,
      loadingItemCount: payload.loadingItemCount,
      unavailableItemCount: payload.unavailableItemCount,
      drawnItemCount: payload.drawnItemCount,
      deferredItemCount: payload.deferredItemCount,
      lodSkippedItemCount: payload.lodSkippedItemCount,
      budgetExhausted: payload.budgetExhausted,
      textureUploadCount: payload.textureUploadCount,
      textureEvictedCount: payload.textureEvictedCount,
      textureRetainedCount: payload.textureRetainedCount,
      textureByteEstimate: payload.textureByteEstimate,
      activeSpriteCount: payload.activeSpriteCount,
      spritePoolSize: payload.spritePoolSize,
    },
    ts: payload.recordedAt,
  });
}

export function recordCanvasImageManagerEmit(payload: {
  nodeId: string;
  mode: ImageLifecycleMode;
  recordedAt?: number;
}): void {
  canvasImagePerformanceMonitor.recordImageManagerEmit(payload);
}

export function recordCanvasRasterRebuild(payload: {
  reason: CanvasRasterRebuildReason;
  candidateNodeCount: number;
  itemCount: number;
  durationMs?: number;
  recordedAt?: number;
}): void {
  canvasImagePerformanceMonitor.recordRasterRebuild(payload);
  recordCanvasTraceEvent({
    type: 'raster.rebuild',
    phase: 'instant',
    durationMs: payload.durationMs,
    data: {
      reason: payload.reason,
      candidateNodeCount: payload.candidateNodeCount,
      itemCount: payload.itemCount,
    },
    ts: payload.recordedAt,
  });
}

export function recordCanvasNodePatch(payload: {
  nodeId: string;
  reason?: string;
  batchId?: string;
  sync?: boolean;
  force?: boolean;
  hasUpdated: boolean;
  recordedAt?: number;
}): void {
  canvasImagePerformanceMonitor.recordNodePatch(payload);
}

export function recordCanvasNodesReferenceChange(payload: {
  nodeCount: number;
  reason?: string;
  batchId?: string;
  addedNodeCount?: number;
  sync?: boolean;
  nodesVersion?: number;
  recordedAt?: number;
}): void {
  canvasImagePerformanceMonitor.recordNodesReferenceChange(payload);
  recordCanvasTraceEvent({
    type: 'reactFlow.nodesRefChange',
    phase: 'instant',
    data: {
      nodeCount: payload.nodeCount,
      reason: payload.reason,
      batchId: payload.batchId,
      addedNodeCount: payload.addedNodeCount,
      sync: payload.sync,
      nodesVersion: payload.nodesVersion,
    },
    ts: payload.recordedAt,
  });
}

export function recordCanvasNodePatchQueueMetric(payload: {
  pendingCount?: number;
  enqueueCount?: number;
  flushCount?: number;
  flushDurationMs?: number;
  recordedAt?: number;
}): void {
  canvasImagePerformanceMonitor.recordNodePatchQueueMetric(payload);
  if (payload.flushCount || payload.enqueueCount) {
    recordCanvasTraceEvent({
      type: payload.flushCount ? 'nodePatch.flush' : 'nodePatch.enqueue',
      phase: payload.flushCount ? 'end' : 'instant',
      durationMs: payload.flushDurationMs,
      data: {
        pendingCount: payload.pendingCount,
        enqueueCount: payload.enqueueCount,
        flushCount: payload.flushCount,
      },
      ts: payload.recordedAt,
    });
  }
}

export function recordCanvasMoveEndMetric(
  payload: Omit<CanvasMoveEndMetricSnapshot, 'metricId' | 'recordedAt'> & {
    recordedAt?: number;
  }
): void {
  canvasImagePerformanceMonitor.recordMoveEndMetric(payload);
  recordCanvasTraceEvent({
    type: 'operation.pan',
    phase: 'end',
    durationMs: payload.totalDurationMs,
    data: {
      importing: payload.importing,
      visibilityApplyMs: payload.visibilityApplyMs,
      resourceScheduleMs: payload.resourceScheduleMs,
      patchQueueFlushMs: payload.patchQueueFlushMs,
      workflowViewportSyncMs: payload.workflowViewportSyncMs,
    },
    ts: payload.recordedAt,
  });
}

export function recordCanvasImageSessionSnapshot(
  payload: Omit<CanvasImageSessionSnapshot, 'recordedAt'>
): void {
  canvasImagePerformanceMonitor.recordCanvasSession(payload);
}

export function shouldRecordCanvasImageSessionDiagnostics(force = false): boolean {
  const config = resolveCanvasImageDiagnosticsConfig();
  if (!config.enabled) {
    return false;
  }

  if (force || config.sessionSnapshotThrottleMs <= 0) {
    lastSessionSnapshotDiagnosticAt = nowMs();
    return true;
  }

  const now = nowMs();
  if (now - lastSessionSnapshotDiagnosticAt < config.sessionSnapshotThrottleMs) {
    return false;
  }

  lastSessionSnapshotDiagnosticAt = now;
  return true;
}

export function shouldRecordCanvasFileNodeDiagnostics(payload: {
  nodeId: string;
  signature: string;
  force?: boolean;
}): boolean {
  const config = resolveCanvasImageDiagnosticsConfig();
  if (!config.enabled) {
    return false;
  }

  const now = nowMs();
  const current = fileNodeDiagnosticCommits.get(payload.nodeId);
  const signatureChanged = current?.signature !== payload.signature;
  const throttleElapsed = !current || now - current.recordedAt >= config.fileNodeCommitThrottleMs;
  if (!payload.force && !signatureChanged && !throttleElapsed) {
    return false;
  }

  fileNodeDiagnosticCommits.set(payload.nodeId, {
    signature: payload.signature,
    recordedAt: now,
  });
  return true;
}

export function recordCanvasFileNodeCommit(payload: {
  nodeId: string;
  nodeType: FileNodeMetricType;
  fileName: string;
  selected: boolean;
  dragging: boolean;
  status: string;
  placeholder: FileNodePlaceholderState;
  renderTier?: string;
  activeState?: string;
  activeVariantKind?: string;
  viewerStatus?: string;
  resourceStatus?: string;
  resourcePhase?: string;
  requestKey?: string;
  requestEventKind?: string;
  requestEventClassification?: ImageLifecycleEventClassification;
  requestEventReason?: string;
  requestSwitchReason?: string;
  attemptedUrl?: string;
  src?: string;
  isVisible?: boolean;
  isNearViewport?: boolean;
  displayWidth?: number;
  displayHeight?: number;
}): void {
  canvasImagePerformanceMonitor.recordFileNodeCommit(payload);
}

export function recordCanvasImagePreviewLifecycle(payload: {
  nodeId: string;
  fileName?: string;
  eventKind: 'preview-begin' | 'preview-ready' | 'preview-failed' | 'preview-cleared';
  sessionId?: string;
  fileId?: string;
  error?: string;
  placeholder?: FileNodePlaceholderState;
  detail?: CanvasImageMetricDetail;
}): void {
  canvasImagePerformanceMonitor.recordPreviewLifecycle(payload);
}

export function shouldRecordCanvasImageThumbnailWorkerQueueDiagnostics(): boolean {
  return resolveCanvasImageDiagnosticsConfig().enabled;
}

export function recordCanvasImageThumbnailWorkerQueueEvent(payload: {
  eventKind: ImageThumbnailWorkerQueueEventKind;
  taskId?: string;
  activeTaskId: string | null;
  queuedTaskCount: number;
  activeTaskCount: 0 | 1;
  totalTaskCount: number;
  restartCount: number;
  timeoutCount: number;
  errorCount: number;
  detail?: CanvasImageMetricDetail;
  recordedAt?: number;
}): void {
  canvasImagePerformanceMonitor.recordImageThumbnailWorkerQueueEvent(payload);
  const eventType = payload.eventKind === 'task-started'
    ? 'thumbnail.start'
    : payload.eventKind === 'task-succeeded'
      ? 'thumbnail.done'
      : payload.eventKind === 'task-failed' || payload.eventKind === 'worker-error' || payload.eventKind === 'worker-timeout'
        ? 'thumbnail.error'
        : 'thumbnail.queue';
  recordCanvasTraceEvent({
    type: eventType,
    phase: 'instant',
    data: {
      eventKind: payload.eventKind,
      taskId: payload.taskId,
      activeTaskId: payload.activeTaskId,
      queuedTaskCount: payload.queuedTaskCount,
      activeTaskCount: payload.activeTaskCount,
      totalTaskCount: payload.totalTaskCount,
      restartCount: payload.restartCount,
      timeoutCount: payload.timeoutCount,
      errorCount: payload.errorCount,
      queueWaitMs: payload.detail?.queueWaitMs,
      executeMs: payload.detail?.executeMs,
    },
    ts: payload.recordedAt,
  });
}

export function recordCanvasFileNodeRender(payload: {
  nodeId: string;
  nodeType: FileNodeMetricType;
  fileName: string;
  commitDurationMs: number;
  dragging: boolean;
  recordedAt?: number;
}): void {
  canvasImagePerformanceMonitor.recordFileNodeRender(payload);
}

export function recordCanvasImageResourceSubscription(payload: {
  nodeId: string;
  mode: ImageLifecycleMode;
  phase: 'subscribe' | 'unsubscribe';
  activeSubscriptions: number;
  activeNodesWithSubscriptions: number;
}): void {
  canvasImagePerformanceMonitor.recordImageResourceSubscription(payload);
}

export function recordCanvasUploadSnapshotRead(nodeId: string): void {
  canvasImagePerformanceMonitor.recordUploadSnapshotRead(nodeId);
}

export function getCanvasImagePerformanceSnapshot(): CanvasImagePerformanceSnapshot {
  return canvasImagePerformanceMonitor.getSnapshot();
}

export function getCanvasImagePerformanceSummary(
  imageManagerSnapshot?: ImageManagerDebugSnapshotLike
): CanvasImagePerformanceSummarySnapshot {
  return canvasImagePerformanceMonitor.getSummary(imageManagerSnapshot);
}

export function getCanvasImageFlickerDebugSnapshot(
  imageManagerSnapshot?: ImageManagerDebugSnapshotLike
): CanvasImageFlickerDebugSnapshot {
  return canvasImagePerformanceMonitor.getFlickerDebugSnapshot(imageManagerSnapshot);
}

bindCanvasPerformanceTraceDiagnostics({
  isDiagnosticsEnabled: () => resolveCanvasImageDiagnosticsConfig().enabled,
  getPerformanceSummary: () => getCanvasImagePerformanceSummary(),
});

export function resetCanvasImagePerformanceSnapshot(): void {
  canvasImagePerformanceMonitor.reset();
}

export function getCanvasImageDiagnosticsConfig(): CanvasImageDiagnosticsConfigSnapshot {
  return resolveCanvasImageDiagnosticsConfig();
}

export function setCanvasImageDiagnosticsConfig(options: {
  enabled?: boolean;
  verbose?: boolean;
  autoReport?: boolean;
}): CanvasImageDiagnosticsConfigSnapshot {
  if (typeof options.enabled === 'boolean') {
    diagnosticsEnabledOverride = options.enabled;
    writeLocalStorageFlag(CANVAS_IMAGE_DIAGNOSTICS_STORAGE_KEY, options.enabled);
    if (typeof window !== 'undefined') {
      window.__CANVAS_IMAGE_PERF_ENABLED__ = options.enabled;
    }
  }

  if (typeof options.verbose === 'boolean') {
    diagnosticsVerboseOverride = options.verbose;
    writeLocalStorageFlag(CANVAS_IMAGE_VERBOSE_STORAGE_KEY, options.verbose);
    if (typeof window !== 'undefined') {
      window.__CANVAS_IMAGE_PERF_VERBOSE__ = options.verbose;
    }
  }

  if (typeof options.autoReport === 'boolean') {
    diagnosticsAutoReportOverride = options.autoReport;
    writeLocalStorageFlag(CANVAS_IMAGE_AUTO_REPORT_STORAGE_KEY, options.autoReport);
    if (typeof window !== 'undefined') {
      window.__CANVAS_IMAGE_PERF_AUTO_REPORT__ = options.autoReport;
    }
  }

  return resolveCanvasImageDiagnosticsConfig();
}

export function reportCanvasImagePerformanceSummary(
  imageManagerSnapshot?: ImageManagerDebugSnapshotLike
): CanvasImagePerformanceSummarySnapshot {
  const summary = canvasImagePerformanceMonitor.getSummary(imageManagerSnapshot);
  log.info('report-summary', 'Canvas image performance summary', {
    summary,
  });
  return summary;
}

declare global {
  interface Window {
    __CANVAS_IMAGE_PERF__?: CanvasImagePerformanceMonitor;
    __CANVAS_IMAGE_PERF_DEBUG__?: () => CanvasImagePerformanceSnapshot;
    __CANVAS_IMAGE_PERF_SUMMARY__?: () => CanvasImagePerformanceSummarySnapshot;
    __CANVAS_IMAGE_PERF_REPORT__?: () => CanvasImagePerformanceSummarySnapshot;
    __CANVAS_IMAGE_FLICKER_DEBUG__?: () => CanvasImageFlickerDebugSnapshot;
    __CANVAS_IMAGE_PERF_RESET__?: () => void;
    __CANVAS_IMAGE_PERF_CONFIG__?: typeof getCanvasImageDiagnosticsConfig;
    __CANVAS_IMAGE_PERF_ENABLE__?: (options?: { verbose?: boolean; autoReport?: boolean }) => CanvasImageDiagnosticsConfigSnapshot;
    __CANVAS_IMAGE_PERF_DISABLE__?: () => CanvasImageDiagnosticsConfigSnapshot;
    __CANVAS_IMAGE_PERF_ENABLED__?: boolean | string;
    __CANVAS_IMAGE_PERF_VERBOSE__?: boolean | string;
    __CANVAS_IMAGE_PERF_AUTO_REPORT__?: boolean | string;
    __IMAGE_MANAGER_DEBUG__?: () => ImageManagerDebugSnapshotLike;
  }
}

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__CANVAS_IMAGE_PERF__ = canvasImagePerformanceMonitor;
  window.__CANVAS_IMAGE_PERF_DEBUG__ = (): CanvasImagePerformanceSnapshot => canvasImagePerformanceMonitor.getSnapshot();
  window.__CANVAS_IMAGE_PERF_SUMMARY__ = (): CanvasImagePerformanceSummarySnapshot => canvasImagePerformanceMonitor.getSummary();
  window.__CANVAS_IMAGE_PERF_REPORT__ = (): CanvasImagePerformanceSummarySnapshot => reportCanvasImagePerformanceSummary();
  window.__CANVAS_IMAGE_FLICKER_DEBUG__ = (): CanvasImageFlickerDebugSnapshot => canvasImagePerformanceMonitor.getFlickerDebugSnapshot();
  window.__CANVAS_IMAGE_PERF_RESET__ = (): void => canvasImagePerformanceMonitor.reset();
  window.__CANVAS_IMAGE_PERF_CONFIG__ = getCanvasImageDiagnosticsConfig;
  window.__CANVAS_IMAGE_PERF_ENABLE__ = (options = {}): CanvasImageDiagnosticsConfigSnapshot => setCanvasImageDiagnosticsConfig({
    enabled: true,
    ...options,
  });
  window.__CANVAS_IMAGE_PERF_DISABLE__ = (): CanvasImageDiagnosticsConfigSnapshot => setCanvasImageDiagnosticsConfig({
    enabled: false,
    verbose: false,
    autoReport: false,
  });
}
