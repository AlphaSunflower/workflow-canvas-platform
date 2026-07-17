import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  MiniMap,
  Node,
  Edge,
  SelectionMode,
  useNodesState,
  useEdgesState,
  OnConnect,
  OnNodesChange,
  OnEdgesChange,
  ReactFlowInstance,
  Connection,
  NodeChange,
  EdgeChange,
} from 'reactflow';
import { useSyncExternalStore } from 'react';
import 'reactflow/dist/style.css';
import './CanvasTaskHistoryPanel.css';
import './TaskHistoryDetailModal.css';
import {
  createModuleLogger,
  createNodeIdAllocatorFromWorkflowMetadata,
  createReactFlowEdge,
  createReactFlowEdges,
  createReactFlowNode,
  createReactFlowNodes,
  createWorkflowRuntimeSnapshot,
  createDefaultAINodeData,
  buildFileNodeMediaLayoutPatch,
  generateUUID,
  getFileTypeFromName,
  getMimeType,
  isAINodeData,
  isFileNodeData,
  shouldIgnoreGlobalKeyboardShortcut,
  normalizeWorkflowNodeIdMetadata,
  WORKFLOW_CONNECTION_LINE_STYLE,
  WORKFLOW_CONNECTION_LINE_TYPE,
} from '../../utils';
import type { CSSProperties, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import {
  completeCanvasImportBatch,
  markCanvasImportEnhancementSettled,
  markCanvasImportEnhancementStarted,
  markCanvasImportPlaceholdersReady,
  recordCanvasDragVisibility,
  recordCanvasImportStage,
  recordCanvasImageSessionSnapshot,
  recordCanvasMoveEndMetric,
  recordCanvasNodePatch,
  recordCanvasNodesReferenceChange,
  recordCanvasRenderPlanMetric,
  recordCanvasRuntimeSync,
  recordCanvasTraceEvent,
  registerCanvasImportNodes,
  getCanvasImageDiagnosticsConfig,
  shouldRecordCanvasImageSessionDiagnostics,
  startCanvasImportBatch,
} from '../../utils/performance';
import type {
  AnyNodeData,
  FileNodeData,
  FileMetadata,
  FileImportSessionGuard,
  NodeId,
  NodeType,
  Position,
  Viewport,
  Workflow,
  Connection as WorkflowConnection,
} from '../../types';
import { ContextMenu } from '../ui/ContextMenu';
import type { ContextMenuItem } from '../ui/ContextMenu';
import { NotificationContainer } from '../ui/primitives';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { CANVAS_DEFAULTS } from '../../constants';
import { backendFileService } from '../../services/backendFileService';
import { fileService } from '../../services/file/file-service';
import {
  createLocalFileSourceReferenceId,
  createLocalFileSourceStoreRecord,
  localFileSourceStore,
} from '../../services/local-file-source-store';
import {
  registerLocalArchiveFile,
  unregisterLocalArchiveFile,
} from '../../services/local-workflow-assets';
import { useWorkflowContext } from '../context/useWorkflowContext';
import { CanvasActionHints } from './CanvasActionHints';
import { CanvasPerformanceTracePanel } from './CanvasPerformanceTracePanel';
import { CanvasTaskHistoryPanel } from './CanvasTaskHistoryPanel';
import {
  createFileNodeFromTaskHistoryArtifact,
  hasTaskHistoryArtifactDragPayload,
  readTaskHistoryArtifactDragPayload,
} from './task-history-artifact-dnd';
import {
  applyImportedImageAssets,
  buildImportedImageAssets,
  clearAllImageResources,
  clearNodeImageResources,
  imageImportPreviewService,
  pauseImageVisibilityUpdates,
  registerLocalImageImportRuntime,
  markImageNodeImportError,
  resumeImageVisibilityUpdates,
  syncImageNodeIds,
  updateImageCacheBudgetContext,
  updateImageNodeVisibility,
} from '../../services/image';
import {
  areVisibleNodeSnapshotsEqual,
  areVisibleNodeMapsEqual,
  computeVisibleNodes,
  diffVisibleNodes,
  hasUsableVisibleNodeContainerSize,
  isVisibleNodeSnapshotFresh,
  resolveRetainedVisibilityCandidateIds,
  useVisibleNodes,
  type VisibleNodeMap,
  type VisibleNodeSnapshot,
} from '../../hooks/canvas/useVisibleNodes';
import { computeVisibleNodesWithWorker } from '../../hooks/canvas/visibility-worker-client';
import {
  hasViewportZoomChanged,
  shouldScheduleIntermediateZoomVisibility,
} from '../../hooks/canvas/visibility-buckets';
import {
  clearNodeRenderTierSnapshot,
  syncNodeRenderTierSnapshot,
} from '../../hooks/canvas/node-render-tier';
import {
  clearCanvasActiveNodeStateSnapshot,
  resolveCanvasActiveNodeState,
  syncCanvasActiveNodeStateSnapshot,
  type CanvasActiveNodeStateSnapshot,
} from './canvas-active-node-state';
import {
  clearCanvasRuntimeVisualStateSnapshot,
  syncCanvasRuntimeVisualStateSnapshot,
  useCanvasRuntimeVisualLocalRevision,
} from './canvas-runtime-visual-state';
import {
  clearCanvasImageFirstPaint,
  clearCanvasImageFirstPaintState,
} from './canvas-image-first-paint-store';
import { getNodeDefinition } from '../../nodes/registry';
import {
  CanvasNodeRuntimeBindingsProvider,
} from './node-runtime-bindings';
import {
  CANVAS_DOM_WINDOW_PLACEHOLDER_NODE_TYPE,
  nodeTypes,
} from './node-renderers';
import { createDefinitionNodeData } from '../../nodes/shared/runtime';
import { removeCanvasEdge } from '../../nodes/shared/grouped-input-edit';
import { getNextConnectionOrder } from '../../nodes/shared/connection';
import {
  getAIImageInpaintInputHandle,
  getAIImageInpaintOutputHandle,
} from '../../nodes/ai-image-inpaint/groups';
import {
  createDropTargetContext,
  isCustomNodeDropCapability,
} from '../../nodes/shared/drop';
import { FileNodePropertyDialog } from '../node/file/FileNodePropertyDialog';
import { ImageGridSplitDialog } from './ImageGridSplitDialog';
import {
  bindMediaLayoutRuntimeSyncDelegate,
  cancelMediaLayoutRuntimeSync,
  scheduleMediaLayoutRuntimeSync,
} from '../node/file/media-layout-runtime-sync';
import {
  clearFileNodeLayoutRuntimeSnapshot,
  clearFileNodeLayoutRuntimeSnapshots,
  consumeFileNodeLayoutRuntimeSnapshots,
} from '../node/file/file-node-layout-runtime-store';
import {
  mergeInstanceSnapshotNodes,
  mergeWorkflowConnections,
  patchNodeDataList,
  shouldBlockLocalCanvasSyncDuringHydration,
  shouldApplyImportSessionResult,
  shouldHydrateCanvasFromWorkflow,
} from './canvas-sync';
import {
  createCanvasNodePatchQueue,
  type CanvasNodePatchQueue,
  type CanvasNodePatchQueuePatcher,
} from './canvas-node-patch-queue';
import {
  buildPositionedImportFiles,
  createImportTaskSessionGuard,
  createPlaceholderImportBatch,
  probeImportFilesForLayout,
} from './import-batch';
import { createCanvasNodeSpatialIndex } from './canvas-node-spatial-index';
import { CanvasImageRasterLayer } from './CanvasImageRasterLayer';
import { resolveCanvasDropTarget } from './canvas-hit-test';
import {
  buildCanvasRenderPlan,
  type CanvasRenderPlanCache,
} from './canvas-render-plan';
import { resolveForcedOffscreenImportNodeIds } from './canvas-forced-offscreen-visibility';
import { useCanvasReactFlowState } from './useCanvasReactFlowState';
import { useCanvasViewportSync } from './useCanvasViewportSync';
import {
  useCanvasImageScheduling,
  type DragVisibilityCommitMetric,
  type ViewportImageMetric,
} from './useCanvasImageScheduling';
import { useCanvasImportPipeline } from './useCanvasImportPipeline';
import { useCanvasMinimapState } from './useCanvasMinimapState';
import { useCanvasBoxSelection } from './useCanvasBoxSelection';
import { useCanvasContextInteractions } from './useCanvasContextInteractions';
import { useCanvasFileInteractions } from './useCanvasFileInteractions';
import {
  buildCompletedImportProgress,
  buildRunningImportProgressMessage,
  getCanvasImportProgressPercent,
  getCanvasImportProgressProcessed,
  type CanvasImportProgressState,
} from './canvas-import-progress';
import {
  bindCanvasRuntimeSyncFlushDelegate,
  type CanvasRuntimeSyncFlushRequest,
  type CanvasRuntimeSyncMetricOptions,
} from './canvas-runtime-sync-flush';
import type { WorkflowRuntimeSnapshot } from '@/contracts/workflow';
import type {
  EligibleImportFile,
  FileImportTask,
  PositionedImportFile,
  ProbedImportFile,
} from './import-batch';

const log = createModuleLogger('canvas');

const FILE_IMPORT_HYDRATION_CONCURRENCY = 2;
const FILE_IMPORT_ENHANCEMENT_IMAGE_CONCURRENCY = 2;
const FILE_IMPORT_PRESSURE_VISIBLE_IMAGE_THRESHOLD = 8;
const FILE_IMPORT_PRESSURE_IMPORTING_IMAGE_THRESHOLD = 16;
const FILE_IMPORT_PRESSURE_THUMBNAIL_MAX_PER_FRAME = 1;
const FILE_IMPORT_HYDRATION_PRESSURE_BATCH_SIZE = 2;
const FILE_IMPORT_ENHANCEMENT_VIDEO_CONCURRENCY = 1;
const FILE_IMPORT_ENHANCEMENT_YIELD_DELAY_MS = 8;
const CANVAS_NODE_PATCH_QUEUE_MAX_PER_FRAME = 8;
const IMPORT_PROGRESS_HIDE_DELAY = 3000;
const IMPORT_PROGRESS_UPDATE_THROTTLE_MS = 80;
const FILE_DETAILS_READY_TIMEOUT = 12000;
const VIEWPORT_SYNC_THROTTLE_MS = 48;
const IMAGE_INTERACTION_PRIORITY_WINDOW_MS = 4_000;
const IMAGE_VISIBILITY_OVERSCAN = 360;
const IMAGE_VISIBILITY_CANDIDATE_RETENTION_MS = 6_000;
const IMAGE_VISIBILITY_IMPORTING_CANDIDATE_RETENTION_MS = 1_200;
const IMAGE_CACHE_BUDGET_IDLE_DELAY_MS = 1200;
const THUMBNAIL_APPLY_MAX_PER_FRAME = 2;
const DRAG_END_THUMBNAIL_FLUSH_LIMIT = 2;
const TASK_HISTORY_PANEL_EXPANDED_WIDTH = 372;
const RUNTIME_SHRINK_PREFLIGHT_LOG_THROTTLE_MS = 3_000;
const REACT_FLOW_DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };
const REACT_FLOW_PAN_ON_DRAG = [1, 2];
const REACT_FLOW_PRO_OPTIONS = { hideAttribution: true };
const REACT_FLOW_STYLE: CSSProperties = { backgroundColor: 'var(--color-bg-primary)' };

interface CanvasProps {
  projectId: string;
  showToolbar?: boolean;
  showHints?: boolean;
  showMinimap?: boolean;
  showTaskHistory?: boolean;
}

type CreatableNodeType = Exclude<NodeType, 'image' | 'video' | 'ply'>;
type FlowNode = Node<AnyNodeData>;

function isViewportRuntimeSyncReason(reason: string | undefined): boolean {
  return typeof reason === 'string' && reason.includes('viewport');
}

interface FileHydrationResult {
  success: boolean;
  renderable: boolean;
  enhancementQueued: boolean;
}

interface ImportBatchProgressSummary {
  completed: number;
  failed: number;
  total: number;
  hydrationFinished: boolean;
}

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeoutId: number | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
};

interface DragPreviewItem {
  id: string;
  position: Position;
  width: number;
  height: number;
}

interface DragPreviewState {
  anchorId: string;
  anchorStart: Position;
  nodeIds: string[];
  offset: Position;
  bounds: {
    minX: number;
    minY: number;
    width: number;
    height: number;
  };
  items: DragPreviewItem[];
}

const CanvasInner = memo(({
  projectId: _projectId,
  showToolbar = true,
  showHints = true,
  showMinimap = true,
  showTaskHistory = false,
}: CanvasProps) => {
  const { state: workflowState, actions, runtime, selectors } = useWorkflowContext();
  const { contextMenu, notification } = runtime;

  const [nodes, setNodes, onNodesChangeInternal] = useNodesState<AnyNodeData>([]);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState([]);
  const [importProgress, setImportProgress] = useState<CanvasImportProgressState | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [recentImageInteractionRevision, setRecentImageInteractionRevision] = useState(0);
  const [scheduledVisibleNodes, setScheduledVisibleNodes] = useState<VisibleNodeSnapshot | undefined>(undefined);
  const [spatialIndexVersion, setSpatialIndexVersion] = useState(0);
  const [dragRasterAnchorViewport, setDragRasterAnchorViewport] = useState<Viewport | null>(null);

  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const reactFlowInstance = useRef<ReactFlowInstance<AnyNodeData> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nodesRef = useRef<FlowNode[]>([]);
  const nodeVersionNodesRef = useRef<FlowNode[] | null>(null);
  const edgesRef = useRef<Edge[]>([]);
  const dragPreviewRef = useRef<DragPreviewState | null>(null);
  const hydratedWorkflowRef = useRef<Workflow | null>(null);
  const runtimeResourceWorkflowIdRef = useRef<string | null>(workflowState.workflow?.id ?? null);
  const lastAppliedHydrationVersionRef = useRef<number>(workflowState.hydrationVersion);
  const latestWorkflowHydrationVersionRef = useRef<number>(workflowState.hydrationVersion);
  const latestWorkflowHydrationReasonRef = useRef(workflowState.hydrationState.reason);
  const pendingExternalHydrationVersionRef = useRef<number | null>(null);
  const importSessionGuardRef = useRef<Map<string, FileImportSessionGuard>>(new Map());
  const activeImportBatchIdsRef = useRef<Set<string>>(new Set());
  const importBatchProgressSummariesRef = useRef<Map<string, ImportBatchProgressSummary>>(new Map());
  const settledImportBatchIdsRef = useRef<Set<string>>(new Set());
  const syncFrameRef = useRef<number | null>(null);
  const nodePatchQueueRef = useRef<CanvasNodePatchQueue<FlowNode> | null>(null);
  const enqueueNodeDataPatchRef = useRef<(
    nodeId: string,
    patcher: CanvasNodePatchQueuePatcher,
    sync?: boolean,
    options?: CanvasRuntimeSyncMetricOptions,
  ) => void>(() => undefined);
  const dragPreviewFrameRef = useRef<number | null>(null);
  const importProgressTimerRef = useRef<number | null>(null);
  const importProgressUpdateTimerRef = useRef<number | null>(null);
  const importProgressRef = useRef<CanvasImportProgressState | null>(null);
  const pendingImportProgressRef = useRef<CanvasImportProgressState | null>(null);
  const lastImportProgressCommitAtRef = useRef(0);
  const pendingDragOffsetRef = useRef<Position | null>(null);
  const activeAIDropzoneRef = useRef<HTMLElement | null>(null);
  const recentImageInteractionsRef = useRef<Map<string, number>>(new Map());
  const selectedNodeIdsRef = useRef<string[]>([]);
  const lastRuntimeShrinkPreflightLogAtRef = useRef(0);
  const isViewportDraggingRef = useRef(false);
  const lastMoveViewportRef = useRef<Viewport | null>(null);
  const lastZoomVisibilityViewportRef = useRef<Viewport | null>(null);
  const lastZoomVisibilityScheduledAtRef = useRef(0);
  const lastAppliedVisibleNodesRef = useRef<VisibleNodeMap>(new Map());
  const latestVisibleNodesRef = useRef<VisibleNodeMap>(new Map());
  const nodesVersionRef = useRef(0);
  const pendingNodesReferenceChangeReasonRef = useRef<{
    reason: string;
    batchId?: string;
    addedNodeCount?: number;
    sync?: boolean;
  } | null>(null);
  const retainedVisibilityCandidateIdsRef = useRef<Map<string, number>>(new Map());
  const deferVisibilityApplyRef = useRef(false);
  const loadSheddingPausedRef = useRef(false);
  const importPressureRef = useRef({
    visibleImportingImageNodeCount: 0,
    importingImageNodeCount: 0,
    isViewportDragging: false,
  });
  const spatialIndexRef = useRef(createCanvasNodeSpatialIndex());
  const detachedNodeIdsRef = useRef<Set<string>>(new Set());
  const hiddenEdgeIdsRef = useRef<Set<string>>(new Set());
  const renderPlanCacheRef = useRef<CanvasRenderPlanCache | undefined>(undefined);
  if (nodeVersionNodesRef.current !== nodes) {
    nodeVersionNodesRef.current = nodes;
    nodesVersionRef.current += 1;
    const pendingNodesReferenceChangeReason = pendingNodesReferenceChangeReasonRef.current;
    pendingNodesReferenceChangeReasonRef.current = null;
    recordCanvasNodesReferenceChange({
      nodeCount: nodes.length,
      reason: pendingNodesReferenceChangeReason?.reason ?? 'canvas-nodes-state-reference',
      batchId: pendingNodesReferenceChangeReason?.batchId,
      addedNodeCount: pendingNodesReferenceChangeReason?.addedNodeCount,
      sync: pendingNodesReferenceChangeReason?.sync,
      nodesVersion: nodesVersionRef.current,
    });
  }
  const nodesVersion = nodesVersionRef.current;

  const {
    currentViewport,
    canvasViewportSize,
    commitViewportForVisibility,
  } = useCanvasReactFlowState({
    initialViewport: workflowState.viewport ?? { x: 0, y: 0, zoom: 1 },
    containerRef: canvasContainerRef,
  });
  const {
    schedule: scheduleViewportSync,
    suspend: suspendViewportSync,
    resume: resumeViewportSync,
    cancel: cancelViewportSync,
  } = useCanvasViewportSync({
    delayMs: VIEWPORT_SYNC_THROTTLE_MS,
    onCommit: commitViewportForVisibility,
  });
  const {
    scheduleDragVisibility,
    cancelDragVisibility,
    scheduleViewportImageWork: scheduleViewportImageWorkByScheduler,
    suspendViewportImageWork,
    resumeViewportImageWork,
    cancel: cancelImageScheduling,
  } = useCanvasImageScheduling();
  const {
    isBoxSelecting,
    handleBoxSelectionStart,
    handleBoxSelectionEnd,
  } = useCanvasBoxSelection();
  const processImageImportEnhancement = useCallback(async (
    task: FileImportTask & { nodeType: 'image' },
  ): Promise<{
    success: boolean;
    applyEntry?: {
      apply: () => void;
      dispose: () => void;
    } | null;
  }> => {
    const { batchId, file, fileId, nodeId, nodeType, sessionId } = task;
    const { imageAssets, preprocessResult } = await preprocessImportedNodeDetailsRef.current(task);
    const shouldApplyTaskResult = (): boolean => shouldApplyImportSessionResult(
      nodesRef.current,
      createImportTaskSessionGuard(task),
      importSessionGuardRef.current.get(nodeId.value),
    );
    const revokeStaleThumbnailUrl = (): void => {
      if (preprocessResult?.kind === 'image' && preprocessResult.thumbnailUrl) {
        URL.revokeObjectURL(preprocessResult.thumbnailUrl);
      }
    };

    if (!shouldApplyTaskResult()) {
      revokeStaleThumbnailUrl();
      return {
        success: false,
        applyEntry: null,
      };
    }

    if (preprocessResult?.kind === 'image' && preprocessResult.thumbnailBlob && preprocessResult.thumbnailUrl) {
      imageImportPreviewService.resolve(nodeId.value, {
        sessionId,
        fileId,
        blob: preprocessResult.thumbnailBlob,
        objectUrl: preprocessResult.thumbnailUrl,
        width: imageAssets.metadata?.width,
        height: imageAssets.metadata?.height,
        mimeType: preprocessResult.thumbnailMimeType,
      });
    } else {
      imageImportPreviewService.fail(nodeId.value, {
        sessionId,
        fileId,
        fileName: file.name,
        fileSize: file.size,
        source: 'import',
        error: 'thumbnail-unavailable',
        failureCode: preprocessResult?.kind === 'image' ? preprocessResult.thumbnailFailure?.failureCode : undefined,
        message: preprocessResult?.kind === 'image' ? preprocessResult.thumbnailFailure?.message : undefined,
        retryable: preprocessResult?.kind === 'image' ? preprocessResult.thumbnailFailure?.retryable : undefined,
        detail: preprocessResult?.kind === 'image' ? preprocessResult.thumbnailFailure : undefined,
      });
    }

    return {
      // Image import itself has already succeeded once the node is hydrated and bound
      // to the local file. Thumbnail/preprocess failure should not be counted as an
      // import failure in the progress summary.
      success: true,
      applyEntry: {
        apply: (): void => {
          if (!shouldApplyTaskResult()) {
            return;
          }

          enqueueNodeDataPatchRef.current(nodeId.value, (currentNode) => {
            if (!shouldApplyTaskResult()) {
              return null;
            }

            const fileNode = currentNode as FileNodeData;
            const nextFileNode = applyImportedImageAssets(fileNode, nodeType, imageAssets);
            return {
              imageAsset: nextFileNode.imageAsset,
              metadata: nextFileNode.metadata,
              status: nextFileNode.status,
              timestamp: nextFileNode.timestamp,
            };
          }, false, {
            batchId,
            reason: 'image-import-enhancement-apply',
          });
        },
        dispose: (): void => {},
      },
    };
  }, []);
  const processVideoImportEnhancement = useCallback(async (
    task: FileImportTask & { nodeType: 'video' },
  ): Promise<{
    success: boolean;
  }> => {
    await preprocessImportedNodeDetailsRef.current(task);
    return {
      // Video import itself has already succeeded once hydration completes.
      success: true,
    };
  }, []);
  const {
    enqueueImportTask,
    resetImportCoordinator,
    removeThumbnailApply,
    pauseThumbnailApply,
    resumeThumbnailApply,
    flushThumbnailApply,
    clearThumbnailApply,
    cancelImportPipeline,
  } = useCanvasImportPipeline({
    imageConcurrency: FILE_IMPORT_ENHANCEMENT_IMAGE_CONCURRENCY,
    videoConcurrency: FILE_IMPORT_ENHANCEMENT_VIDEO_CONCURRENCY,
    thumbnailMaxPerFrame: THUMBNAIL_APPLY_MAX_PER_FRAME,
    getImageConcurrencyLimit: useCallback(() => {
      const pressure = importPressureRef.current;
      return pressure.isViewportDragging ||
        pressure.visibleImportingImageNodeCount >= FILE_IMPORT_PRESSURE_VISIBLE_IMAGE_THRESHOLD ||
        pressure.importingImageNodeCount >= FILE_IMPORT_PRESSURE_IMPORTING_IMAGE_THRESHOLD
        ? 1
        : FILE_IMPORT_ENHANCEMENT_IMAGE_CONCURRENCY;
    }, []),
    getThumbnailMaxPerFrame: useCallback(() => {
      const pressure = importPressureRef.current;
      return pressure.isViewportDragging ||
        pressure.visibleImportingImageNodeCount >= FILE_IMPORT_PRESSURE_VISIBLE_IMAGE_THRESHOLD
        ? FILE_IMPORT_PRESSURE_THUMBNAIL_MAX_PER_FRAME
        : THUMBNAIL_APPLY_MAX_PER_FRAME;
    }, []),
    yieldBeforeNextTask: useCallback((): Promise<void> => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => resolve(), FILE_IMPORT_ENHANCEMENT_YIELD_DELAY_MS);
      });
    }), []),
    processImageTask: processImageImportEnhancement,
    processVideoTask: processVideoImportEnhancement,
    onTaskError: (error, task) => {
      log.warn('importEnhancement', `Failed to enhance imported ${task.nodeType}: ${task.file.name}`, (
        error instanceof Error
          ? { errorMessage: error.message, nodeId: task.nodeId.value }
          : { nodeId: task.nodeId.value }
      ));
    },
    onTaskSettled: (task, success) => {
      if (!activeImportBatchIdsRef.current.has(task.batchId)) {
        return;
      }

      const currentSummary = importBatchProgressSummariesRef.current.get(task.batchId);
      if (!currentSummary) {
        return;
      }

      const nextSummary: ImportBatchProgressSummary = {
        ...currentSummary,
        completed: currentSummary.completed + (success ? 1 : 0),
        failed: currentSummary.failed + (success ? 0 : 1),
      };
      importBatchProgressSummariesRef.current.set(task.batchId, nextSummary);

      updateImportProgress(task.batchId, (current) => {
        const processed = Math.min(nextSummary.completed + nextSummary.failed, current.total);
        return {
          ...current,
          completed: nextSummary.completed,
          failed: nextSummary.failed,
          message: buildRunningImportProgressMessage(processed, current.total),
        };
      });

      if (nextSummary.hydrationFinished && nextSummary.completed + nextSummary.failed >= nextSummary.total) {
        completeImportBatch(task.batchId, nextSummary.completed, nextSummary.failed);
      }
    },
    onBatchSettled: (batchId) => {
      settledImportBatchIdsRef.current.add(batchId);
      const summary = importBatchProgressSummariesRef.current.get(batchId);
      if (!summary || !activeImportBatchIdsRef.current.has(batchId)) {
        return;
      }

      if (summary.hydrationFinished && summary.completed + summary.failed >= summary.total) {
        completeImportBatch(batchId, summary.completed, summary.failed);
      }
    },
  });
  const {
    isMinimapCollapsed,
    isMinimapDragging,
    isMinimapResizing,
    minimapPosition,
    minimapSize,
    reactFlowMinimapStyle,
    toggleReactFlowMinimapVisibility,
    handleReactFlowMinimapNodeClick,
    handleMinimapCollapsedClick,
    stopMinimapControlPointerDown,
    handleMinimapDragStart,
    handleMinimapResizeStart,
  } = useCanvasMinimapState({
    containerRef: canvasContainerRef,
    reactFlowInstanceRef: reactFlowInstance,
  });

  useEffect(() => {
    nodesRef.current = nodes;
    spatialIndexRef.current.rebuild(nodes);
    selectedNodeIdsRef.current = nodes
      .filter((node) => node.selected)
      .map((node) => node.id);
    setSpatialIndexVersion((version) => version + 1);
    const activeNodeIds = new Set(nodes.map((node) => node.id));
    const nextVisibleCache: VisibleNodeMap = new Map();
    lastAppliedVisibleNodesRef.current.forEach((state, nodeId) => {
      if (activeNodeIds.has(nodeId)) {
        nextVisibleCache.set(nodeId, state);
      }
    });
    lastAppliedVisibleNodesRef.current = nextVisibleCache;
    retainedVisibilityCandidateIdsRef.current.forEach((_expiresAt, nodeId) => {
      if (!activeNodeIds.has(nodeId)) {
        retainedVisibilityCandidateIdsRef.current.delete(nodeId);
      }
    });
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    dragPreviewRef.current = dragPreview;
  }, [dragPreview]);

  useEffect(() => {
    importProgressRef.current = importProgress;
  }, [importProgress]);

  React.useLayoutEffect(() => {
    hydratedWorkflowRef.current = workflowState.workflow;
    latestWorkflowHydrationVersionRef.current = workflowState.hydrationVersion;
    latestWorkflowHydrationReasonRef.current = workflowState.hydrationState.reason;
    const hasPendingWorkflowHydration = shouldHydrateCanvasFromWorkflow(
      lastAppliedHydrationVersionRef.current,
      workflowState.hydrationVersion,
    );
    pendingExternalHydrationVersionRef.current = (
      hasPendingWorkflowHydration && workflowState.hydrationState.reason === 'external-output'
    )
      ? workflowState.hydrationVersion
      : null;
  }, [workflowState.hydrationState.reason, workflowState.hydrationVersion, workflowState.workflow]);

  const syncManagedPreviewUrls = useCallback((nextNodes: FlowNode[]): void => {
    const activeNodeIds = new Set(nextNodes.map((node) => node.id));
    syncImageNodeIds(activeNodeIds);
  }, []);

  const hasPendingExternalHydration = useCallback((force = false): boolean => (
    shouldBlockLocalCanvasSyncDuringHydration({
      lastAppliedHydrationVersion: lastAppliedHydrationVersionRef.current,
      nextHydrationVersion: latestWorkflowHydrationVersionRef.current,
      hydrationReason: latestWorkflowHydrationReasonRef.current,
      pendingExternalHydrationVersion: pendingExternalHydrationVersionRef.current,
      force,
    })
  ), []);

  useEffect((): (() => void) => () => {
    if (syncFrameRef.current !== null) {
      cancelAnimationFrame(syncFrameRef.current);
    }
    if (dragPreviewFrameRef.current !== null) {
      cancelAnimationFrame(dragPreviewFrameRef.current);
    }
    if (importProgressTimerRef.current !== null) {
      window.clearTimeout(importProgressTimerRef.current);
    }
    if (importProgressUpdateTimerRef.current !== null) {
      window.clearTimeout(importProgressUpdateTimerRef.current);
      importProgressUpdateTimerRef.current = null;
    }
    nodePatchQueueRef.current?.dispose();
    nodePatchQueueRef.current = null;
    importProgressRef.current = null;
    pendingImportProgressRef.current = null;
    lastImportProgressCommitAtRef.current = 0;
    activeImportBatchIdsRef.current.clear();
    importBatchProgressSummariesRef.current.clear();
    settledImportBatchIdsRef.current.clear();
    cancelImportPipeline();
    cancelImageScheduling();
    cancelViewportSync();
    deferVisibilityApplyRef.current = false;
    loadSheddingPausedRef.current = false;
    cancelMediaLayoutRuntimeSync();
    clearFileNodeLayoutRuntimeSnapshots();
    lastAppliedVisibleNodesRef.current = new Map();
    clearNodeRenderTierSnapshot();
    clearCanvasActiveNodeStateSnapshot();
    clearCanvasRuntimeVisualStateSnapshot();
    clearCanvasImageFirstPaintState();
    updateImageCacheBudgetContext({
      imageNodeCount: 0,
      importingNodeCount: 0,
      isDragging: false,
      isImporting: false,
      isIdle: false,
    });
    clearAllImageResources({
      workflowId: runtimeResourceWorkflowIdRef.current,
    });
  }, [cancelImageScheduling, cancelImportPipeline, cancelViewportSync]);

  const applyImageVisibilityMap = useCallback((visibleMap: VisibleNodeMap): number => {
    const startedAt = performance.now();
    const diffMap = diffVisibleNodes(lastAppliedVisibleNodesRef.current, visibleMap);

    diffMap.forEach((visibility, nodeId) => {
      updateImageNodeVisibility(nodeId, visibility);
    });

    lastAppliedVisibleNodesRef.current = visibleMap;

    return performance.now() - startedAt;
  }, []);

  const createVisibleNodeSnapshot = useCallback((
    visibleNodes: VisibleNodeMap,
    viewport: Viewport,
  ): VisibleNodeSnapshot => ({
    visibleNodes,
    viewport,
    nodesVersion: nodesVersionRef.current,
    containerSize: canvasViewportSize,
    computedAt: performance.now(),
  }), [canvasViewportSize]);

  const commitScheduledVisibleNodes = useCallback((
    visibleNodes: VisibleNodeMap,
    viewport: Viewport,
  ): { durationMs: number } => {
    if (!hasUsableVisibleNodeContainerSize(canvasViewportSize)) {
      return {
        durationMs: 0,
      };
    }

    if (deferVisibilityApplyRef.current) {
      latestVisibleNodesRef.current = visibleNodes;
      return {
        durationMs: 0,
      };
    }

    const startedAt = performance.now();
    const snapshot = createVisibleNodeSnapshot(visibleNodes, viewport);
    latestVisibleNodesRef.current = visibleNodes;
    setScheduledVisibleNodes((current) => (
      current && areVisibleNodeSnapshotsEqual(current, snapshot)
        ? current
        : snapshot
    ));

    if (areVisibleNodeMapsEqual(lastAppliedVisibleNodesRef.current, visibleNodes)) {
      return {
        durationMs: performance.now() - startedAt,
      };
    }

    const applyDurationMs = applyImageVisibilityMap(visibleNodes);
    return {
      durationMs: Math.max(applyDurationMs, performance.now() - startedAt),
    };
  }, [applyImageVisibilityMap, canvasViewportSize, createVisibleNodeSnapshot]);

  const getVisibleCandidateNodeIds = useCallback((viewport: Viewport, _spatialIndexVersion?: number): string[] => {
    const now = Date.now();
    return resolveRetainedVisibilityCandidateIds({
      baseCandidateNodeIds: spatialIndexRef.current.queryViewport(
        viewport,
        canvasViewportSize,
        IMAGE_VISIBILITY_OVERSCAN,
      ),
      retainedCandidateExpirations: retainedVisibilityCandidateIdsRef.current,
      lastAppliedVisibleNodes: lastAppliedVisibleNodesRef.current,
      selectedNodeIds: selectedNodeIdsRef.current,
      recentlyInteractedNodeIds: recentInteractedImageNodeIdsRef.current,
      importingNodeIds: importingImageNodeIdsRef.current,
      now,
      retention: {
        defaultRetentionMs: IMAGE_VISIBILITY_CANDIDATE_RETENTION_MS,
        importingRetentionMs: IMAGE_VISIBILITY_IMPORTING_CANDIDATE_RETENTION_MS,
      },
    });
  }, [canvasViewportSize]);

  const computeVisibleNodeMapForViewportAsync = useCallback((viewport: Viewport): Promise<VisibleNodeMap> => (
    (() => {
      const candidateNodeIds = getVisibleCandidateNodeIds(viewport);
      return computeVisibleNodesWithWorker({
        nodes: nodesRef.current,
        candidateNodeIds,
        forcedOffscreenNodeIds: resolveForcedOffscreenImportNodeIds({
          candidateNodeIds,
          importingNodeIds: importingImageNodeIdsRef.current,
          lastAppliedVisibleNodes: lastAppliedVisibleNodesRef.current,
        }),
        viewport,
        containerSize: canvasViewportSize,
        overscan: IMAGE_VISIBILITY_OVERSCAN,
        recentlyInteractedNodeIds: recentInteractedImageNodeIdsRef.current,
        importingNodeIds: importingImageNodeIdsRef.current,
      });
    })()
  ), [canvasViewportSize, getVisibleCandidateNodeIds]);

  const scheduleViewportImageWork = useCallback((
    viewport: Viewport,
    options: {
      phase?: 'default' | 'post-drag' | 'post-drag-importing';
      onCommitted?: (metric: ViewportImageMetric) => void;
    } = {},
  ): void => {
    scheduleViewportImageWorkByScheduler({
      viewport,
      phase: options.phase,
      compute: async (nextViewport) => {
        const startedAt = performance.now();
        const visibleNodes = await computeVisibleNodeMapForViewportAsync(nextViewport);
        return {
          visibleNodes,
          durationMs: performance.now() - startedAt,
        };
      },
      apply: commitScheduledVisibleNodes,
      onCommitted: options.onCommitted,
    });
  }, [commitScheduledVisibleNodes, computeVisibleNodeMapForViewportAsync, scheduleViewportImageWorkByScheduler]);

  const buildDragVisibilityScheduleOptions = useCallback((
    viewport: Viewport,
    reason: 'frame' | 'flush'
  ) => ({
    compute: (): {
      visibleNodes: VisibleNodeMap;
      durationMs: number;
    } => {
      const startedAt = performance.now();
      const candidateNodeIds = getVisibleCandidateNodeIds(viewport);
      const visibleMap = computeVisibleNodes({
        nodes: nodesRef.current,
        candidateNodeIds,
        forcedOffscreenNodeIds: resolveForcedOffscreenImportNodeIds({
          candidateNodeIds,
          importingNodeIds: importingImageNodeIdsRef.current,
          lastAppliedVisibleNodes: lastAppliedVisibleNodesRef.current,
        }),
        viewport,
        containerSize: canvasViewportSize,
        overscan: IMAGE_VISIBILITY_OVERSCAN,
        recentlyInteractedNodeIds: recentInteractedImageNodeIdsRef.current,
        importingNodeIds: importingImageNodeIdsRef.current,
      });

      return {
        visibleNodes: visibleMap,
        durationMs: performance.now() - startedAt,
      };
    },
    apply: (visibleMap: VisibleNodeMap): { durationMs: number } => {
      return commitScheduledVisibleNodes(visibleMap, viewport);
    },
    record: (metric: DragVisibilityCommitMetric): void => {
      recordCanvasDragVisibility({
        ...metric,
        reason,
      });
    },
  }), [canvasViewportSize, commitScheduledVisibleNodes, getVisibleCandidateNodeIds]);

  const markRecentImageInteraction = useCallback((nodeId?: string | null): void => {
    if (!nodeId) {
      return;
    }

    const node = nodesRef.current.find((item) => item.id === nodeId);
    if (!node || !isFileNodeData(node.data) || node.data.type !== 'image') {
      return;
    }

    recentImageInteractionsRef.current.set(nodeId, Date.now());
    setRecentImageInteractionRevision((revision) => revision + 1);
  }, []);

  const getRecentlyInteractedImageNodeIds = useCallback((_revision?: number): string[] => {
    const now = Date.now();
    const recentIds: string[] = [];

    recentImageInteractionsRef.current.forEach((timestamp, nodeId) => {
      if (now - timestamp <= IMAGE_INTERACTION_PRIORITY_WINDOW_MS) {
        recentIds.push(nodeId);
      } else {
        recentImageInteractionsRef.current.delete(nodeId);
      }
    });

    return recentIds;
  }, []);

  const recentInteractedImageNodeIds = useMemo(
    () => getRecentlyInteractedImageNodeIds(recentImageInteractionRevision),
    [getRecentlyInteractedImageNodeIds, recentImageInteractionRevision],
  );

  const recentInteractedImageNodeIdsRef = useRef<string[]>(recentInteractedImageNodeIds);
  const [isViewportDragging, setIsViewportDragging] = useState(false);

  useEffect(() => {
    recentInteractedImageNodeIdsRef.current = recentInteractedImageNodeIds;
  }, [recentInteractedImageNodeIds]);

  const importingImageNodeIds = useSyncExternalStore(
    (listener) => imageImportPreviewService.subscribeProcessingNodeIds(listener),
    () => imageImportPreviewService.getProcessingNodeIds(),
    () => [],
  );
  const importingImageNodeIdSet = useMemo(() => new Set(importingImageNodeIds), [importingImageNodeIds]);

  const importingImageNodeIdsRef = useRef<readonly string[]>(importingImageNodeIds);
  const importingImageNodeIdSetRef = useRef<Set<string>>(importingImageNodeIdSet);

  useEffect(() => {
    importingImageNodeIdsRef.current = importingImageNodeIds;
  }, [importingImageNodeIds]);

  useEffect(() => {
    importingImageNodeIdSetRef.current = importingImageNodeIdSet;
  }, [importingImageNodeIdSet]);

  const visibilityViewport = useMemo(() => {
    if (
      scheduledVisibleNodes &&
      scheduledVisibleNodes.nodesVersion === nodesVersion &&
      hasUsableVisibleNodeContainerSize(scheduledVisibleNodes.containerSize) &&
      scheduledVisibleNodes.containerSize.width === canvasViewportSize.width &&
      scheduledVisibleNodes.containerSize.height === canvasViewportSize.height
    ) {
      return scheduledVisibleNodes.viewport;
    }

    return currentViewport;
  }, [canvasViewportSize.height, canvasViewportSize.width, currentViewport, nodesVersion, scheduledVisibleNodes]);

  const visibleCandidateNodeIds = useMemo(
    () => getVisibleCandidateNodeIds(visibilityViewport, spatialIndexVersion),
    [getVisibleCandidateNodeIds, spatialIndexVersion, visibilityViewport],
  );
  const forcedOffscreenImportNodeIds = useMemo(
    () => resolveForcedOffscreenImportNodeIds({
      candidateNodeIds: visibleCandidateNodeIds,
      importingNodeIds: importingImageNodeIds,
      lastAppliedVisibleNodes: lastAppliedVisibleNodesRef.current,
    }),
    [importingImageNodeIds, visibleCandidateNodeIds],
  );

  const imageNodeCount = useMemo(() => (
    nodes.reduce((count, node) => (
      isFileNodeData(node.data) && node.data.type === 'image'
        ? count + 1
        : count
    ), 0)
  ), [nodes]);
  const isImportingActive = activeImportBatchIdsRef.current.size > 0 || importProgress?.status === 'running';
  const isDragLoadSheddingActive = isImportingActive && (Boolean(dragPreview) || isViewportDragging);

  useEffect(() => {
    const memory = typeof performance === 'undefined'
      ? undefined
      : (performance as Performance & {
        memory?: {
          totalJSHeapSize?: number;
          jsHeapSizeLimit?: number;
        };
      }).memory;
    const navigatorSnapshot = typeof navigator === 'undefined'
      ? undefined
      : navigator as Navigator & {
        deviceMemory?: number;
      };
    const isDragging = Boolean(dragPreview) || isViewportDragging;
    const isImporting = importingImageNodeIds.length > 0 || importProgress?.status === 'running';
    const timerId = window.setTimeout(() => {
      updateImageCacheBudgetContext({
        imageNodeCount,
        importingNodeCount: importingImageNodeIds.length,
        isDragging,
        isImporting,
        isIdle: !isDragging && !isImporting,
        device: {
          deviceMemoryGb: navigatorSnapshot?.deviceMemory,
          hardwareConcurrency: navigatorSnapshot?.hardwareConcurrency,
          jsHeapSizeLimit: memory?.jsHeapSizeLimit,
          totalJSHeapSize: memory?.totalJSHeapSize,
        },
      });
    }, isDragging || isImporting ? 0 : IMAGE_CACHE_BUDGET_IDLE_DELAY_MS);

    return (): void => {
      window.clearTimeout(timerId);
    };
  }, [dragPreview, imageNodeCount, importingImageNodeIds.length, importProgress?.status, isViewportDragging]);

  useEffect(() => {
    const activeWorkflow = hydratedWorkflowRef.current;
    if (!shouldHydrateCanvasFromWorkflow(
      lastAppliedHydrationVersionRef.current,
      workflowState.hydrationVersion,
    )) {
      return;
    }

    lastAppliedHydrationVersionRef.current = workflowState.hydrationVersion;
    pendingExternalHydrationVersionRef.current = null;
    cancelMediaLayoutRuntimeSync();
    clearFileNodeLayoutRuntimeSnapshots();
    const shouldResetWorkflowRuntimeResources = latestWorkflowHydrationReasonRef.current !== 'external-output';
    if (shouldResetWorkflowRuntimeResources) {
      clearCanvasImageFirstPaintState();
      clearAllImageResources({
        workflowId: runtimeResourceWorkflowIdRef.current,
      });
      runtimeResourceWorkflowIdRef.current = activeWorkflow?.id ?? null;
    }

    if (!activeWorkflow) {
      activeImportBatchIdsRef.current.clear();
      importBatchProgressSummariesRef.current.clear();
      settledImportBatchIdsRef.current.clear();
      nodePatchQueueRef.current?.cancel();
      resetImportCoordinator();
      clearThumbnailApply();
      importSessionGuardRef.current.clear();
      if (importProgressTimerRef.current !== null) {
        window.clearTimeout(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }
      if (importProgressUpdateTimerRef.current !== null) {
        window.clearTimeout(importProgressUpdateTimerRef.current);
        importProgressUpdateTimerRef.current = null;
      }
      importProgressRef.current = null;
      pendingImportProgressRef.current = null;
      lastImportProgressCommitAtRef.current = 0;
      setImportProgress(null);
      setNodes([]);
      setEdges([]);
      nodesRef.current = [];
      edgesRef.current = [];
      syncManagedPreviewUrls([]);
      return;
    }

    if (!shouldResetWorkflowRuntimeResources) {
      runtimeResourceWorkflowIdRef.current = activeWorkflow.id;
    }

    const flowNodes = createReactFlowNodes(activeWorkflow.nodes);
    const flowEdges = createReactFlowEdges(activeWorkflow.connections);
    const savedViewport = activeWorkflow.viewport;

    if (shouldResetWorkflowRuntimeResources) {
      importSessionGuardRef.current.clear();
      activeImportBatchIdsRef.current.clear();
      importBatchProgressSummariesRef.current.clear();
      settledImportBatchIdsRef.current.clear();
      nodePatchQueueRef.current?.cancel();
      resetImportCoordinator();
      clearThumbnailApply();
      if (importProgressTimerRef.current !== null) {
        window.clearTimeout(importProgressTimerRef.current);
        importProgressTimerRef.current = null;
      }
      if (importProgressUpdateTimerRef.current !== null) {
        window.clearTimeout(importProgressUpdateTimerRef.current);
        importProgressUpdateTimerRef.current = null;
      }
      importProgressRef.current = null;
      pendingImportProgressRef.current = null;
      lastImportProgressCommitAtRef.current = 0;
      setImportProgress(null);
    }
    setNodes(flowNodes);
    setEdges(flowEdges);
    nodesRef.current = flowNodes;
    edgesRef.current = flowEdges;
    syncManagedPreviewUrls(flowNodes);

    if (savedViewport && reactFlowInstance.current) {
      commitViewportForVisibility(savedViewport);
      void reactFlowInstance.current.setViewport(savedViewport);
      log.info('hydrateWorkflow', 'Canvas hydrated with saved viewport', {
        viewport: savedViewport,
      });
    }
  }, [
    clearThumbnailApply,
    commitViewportForVisibility,
    resetImportCoordinator,
    setEdges,
    setNodes,
    syncManagedPreviewUrls,
    workflowState.hydrationVersion,
  ]);

  const getCurrentViewport = useCallback((): Viewport => {
    if (reactFlowInstance.current) {
      return reactFlowInstance.current.getViewport();
    }

    return workflowState.viewport ?? { x: 0, y: 0, zoom: 1 };
  }, [workflowState.viewport]);

  const resolveRuntimeSyncBatchId = useCallback((preferredBatchId?: string): string | undefined => {
    if (preferredBatchId) {
      return preferredBatchId;
    }

    if (activeImportBatchIdsRef.current.size !== 1) {
      return undefined;
    }

    return Array.from(activeImportBatchIdsRef.current)[0];
  }, []);

  const syncViewportOnlyToWorkflow = useCallback((
    nextViewport: Viewport,
    options: CanvasRuntimeSyncMetricOptions = {},
  ): void => {
    if (!options.force && hasPendingExternalHydration()) {
      return;
    }

    const activeWorkflow = hydratedWorkflowRef.current ?? workflowState.workflow;
    if (!activeWorkflow) {
      return;
    }

    const syncStartedAt = performance.now();
    const resolvedBatchId = resolveRuntimeSyncBatchId(options.batchId);
    const currentNodeCount = Object.keys(activeWorkflow.nodes).length;
    const currentConnectionCount = activeWorkflow.connections.length;

    actions.updateRuntimeSnapshot({
      nodes: activeWorkflow.nodes,
      connections: activeWorkflow.connections,
      viewport: nextViewport,
      metadata: activeWorkflow.metadata,
      snapshotMeta: {
        source: 'canvas-edit',
        scope: 'canvas-sync',
        baseUpdatedAt: activeWorkflow.timestamp.updated,
        baseNodeCount: currentNodeCount,
        baseConnectionCount: currentConnectionCount,
        allowNodeShrink: false,
      },
    });
    const syncCompletedAt = performance.now();

    recordCanvasRuntimeSync({
      batchId: resolvedBatchId,
      reason: options.reason ?? 'canvas-viewport-sync',
      nodeCount: currentNodeCount,
      connectionCount: currentConnectionCount,
      durationMs: syncCompletedAt - syncStartedAt,
      snapshotBuildMs: 0,
      metadataNormalizeMs: 0,
      actionCommitMs: syncCompletedAt - syncStartedAt,
      recordedAt: syncCompletedAt,
    });
  }, [actions, hasPendingExternalHydration, resolveRuntimeSyncBatchId, workflowState.workflow]);

  const syncReactFlowStateToWorkflow = useCallback((
    nextNodes: FlowNode[] = nodesRef.current,
    nextEdges: Edge[] = edgesRef.current,
    nextViewport: Viewport = getCurrentViewport(),
    options: CanvasRuntimeSyncMetricOptions = {}
  ): void => {
    if (!options.force && hasPendingExternalHydration()) {
      return;
    }

    const baseWorkflow = hydratedWorkflowRef.current ?? workflowState.workflow;
    const baseNodeCount = Object.keys(baseWorkflow?.nodes ?? {}).length;
    const baseConnectionCount = baseWorkflow?.connections.length ?? 0;
    const wouldShrinkNodes = baseNodeCount > 0 && nextNodes.length < baseNodeCount;
    if (options.allowNodeShrink !== true && wouldShrinkNodes) {
      const reason = options.reason ?? 'canvas-sync';
      if (isViewportRuntimeSyncReason(reason)) {
        syncViewportOnlyToWorkflow(nextViewport, {
          ...options,
          reason,
        });
        return;
      }

      const now = performance.now();
      if (now - lastRuntimeShrinkPreflightLogAtRef.current >= RUNTIME_SHRINK_PREFLIGHT_LOG_THROTTLE_MS) {
        lastRuntimeShrinkPreflightLogAtRef.current = now;
        log.warn('syncReactFlowStateToWorkflow', 'Skipped canvas runtime snapshot because it would shrink workflow nodes without explicit permission.', {
          reason,
          baseNodeCount,
          runtimeNodeCount: nextNodes.length,
          baseConnectionCount,
          runtimeConnectionCount: nextEdges.length,
        });
      }
      return;
    }

    const syncStartedAt = performance.now();
    const resolvedBatchId = resolveRuntimeSyncBatchId(options.batchId);
    const runtimeSnapshot = createWorkflowRuntimeSnapshot(nextNodes, nextEdges, nextViewport);
    const snapshotBuiltAt = performance.now();
    const normalizedMetadata = normalizeWorkflowNodeIdMetadata(
      {
        ...(workflowState.metadata ?? {
          nodeCount: 0,
          connectionCount: 0,
          lastNodeId: 0,
          canvasSize: {
            width: CANVAS_DEFAULTS.width,
            height: CANVAS_DEFAULTS.height,
          },
          relatedTasks: [],
          usedNodeIds: [],
          releasedNodeIds: [],
        }),
        nodeCount: nextNodes.length,
        connectionCount: nextEdges.length,
      },
      runtimeSnapshot.nodes,
    );
    const metadataNormalizedAt = performance.now();

    actions.updateRuntimeSnapshot({
      ...runtimeSnapshot,
      metadata: normalizedMetadata,
      snapshotMeta: {
        source: 'canvas-edit',
        scope: 'canvas-sync',
        baseUpdatedAt: baseWorkflow?.timestamp.updated,
        baseNodeCount,
        baseConnectionCount,
        allowNodeShrink: options.allowNodeShrink === true,
      },
    });
    const syncCompletedAt = performance.now();

    recordCanvasRuntimeSync({
      batchId: resolvedBatchId,
      reason: options.reason ?? 'canvas-sync',
      nodeCount: nextNodes.length,
      connectionCount: nextEdges.length,
      durationMs: syncCompletedAt - syncStartedAt,
      snapshotBuildMs: snapshotBuiltAt - syncStartedAt,
      metadataNormalizeMs: metadataNormalizedAt - snapshotBuiltAt,
      actionCommitMs: syncCompletedAt - metadataNormalizedAt,
      recordedAt: syncCompletedAt,
    });
  }, [actions, getCurrentViewport, hasPendingExternalHydration, resolveRuntimeSyncBatchId, syncViewportOnlyToWorkflow, workflowState.metadata, workflowState.workflow]);

  const commitProvidedRuntimeSnapshot = useCallback((
    runtimeSnapshot: WorkflowRuntimeSnapshot,
    runtimeSyncOptions?: Parameters<typeof actions.updateRuntimeSnapshot>[1],
  ): Workflow | null => {
    const normalizedMetadata = normalizeWorkflowNodeIdMetadata(
      {
        ...(workflowState.metadata ?? {
          nodeCount: 0,
          connectionCount: 0,
          lastNodeId: 0,
          canvasSize: {
            width: CANVAS_DEFAULTS.width,
            height: CANVAS_DEFAULTS.height,
          },
          relatedTasks: [],
          usedNodeIds: [],
          releasedNodeIds: [],
        }),
        ...(runtimeSnapshot.metadata ?? {}),
        nodeCount: Object.keys(runtimeSnapshot.nodes).length,
        connectionCount: runtimeSnapshot.connections.length,
      },
      runtimeSnapshot.nodes,
    );

    const nextRuntimeSnapshot: WorkflowRuntimeSnapshot = {
      ...runtimeSnapshot,
      metadata: normalizedMetadata,
    };
    const nextNodes = createReactFlowNodes(nextRuntimeSnapshot.nodes);
    const nextEdges = createReactFlowEdges(nextRuntimeSnapshot.connections);

    setNodes(nextNodes);
    setEdges(nextEdges);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;

    return actions.updateRuntimeSnapshot(nextRuntimeSnapshot, runtimeSyncOptions);
  }, [actions, setEdges, setNodes, workflowState.metadata]);

  const scheduleWorkflowSync = useCallback((options: CanvasRuntimeSyncMetricOptions = {}): void => {
    if (hasPendingExternalHydration(options.force)) {
      return;
    }

    if (syncFrameRef.current !== null) {
      return;
    }

    syncFrameRef.current = requestAnimationFrame(() => {
      syncFrameRef.current = null;
      syncReactFlowStateToWorkflow(nodesRef.current, edgesRef.current, undefined, options);
    });
  }, [hasPendingExternalHydration, syncReactFlowStateToWorkflow]);

  const updateEdgesLocally = useCallback((nextEdges: Edge[], sync = true): void => {
    setEdges(nextEdges);
    edgesRef.current = nextEdges;

    if (sync) {
      syncReactFlowStateToWorkflow(nodesRef.current, nextEdges);
    }
  }, [setEdges, syncReactFlowStateToWorkflow]);

  const applyCanvasEdgeRemoval = useCallback((edgeIds: readonly string[]): void => {
    if (edgeIds.length === 0) {
      return;
    }

    let nextNodes = nodesRef.current;
    let nextEdges = edgesRef.current;

    edgeIds.forEach((edgeId) => {
      const removalResult = removeCanvasEdge(nextNodes, nextEdges, edgeId);
      nextNodes = removalResult.nextNodes;
      nextEdges = removalResult.nextEdges;
    });

    setNodes(nextNodes);
    setEdges(nextEdges);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    syncReactFlowStateToWorkflow(nextNodes, nextEdges);
  }, [setEdges, setNodes, syncReactFlowStateToWorkflow]);

  const syncFromInstance = useCallback((options: CanvasRuntimeSyncMetricOptions = {}): void => {
    if (hasPendingExternalHydration()) {
      return;
    }

    if (!reactFlowInstance.current) {
      syncReactFlowStateToWorkflow(undefined, undefined, undefined, options);
      return;
    }

    const flowObject = reactFlowInstance.current.toObject();
    const currentNodesSnapshot = nodesRef.current;
    const currentEdgesSnapshot = edgesRef.current;
    const shouldPreserveMissingInstanceStructure = options.allowNodeShrink !== true;
    const activeWorkflow = hydratedWorkflowRef.current;
    const hasPendingWorkflowHydration = shouldHydrateCanvasFromWorkflow(
      lastAppliedHydrationVersionRef.current,
      latestWorkflowHydrationVersionRef.current,
    );
    const instanceNodeIds = new Set(flowObject.nodes.map((node) => node.id));
    const workflowNodeIds = new Set(hasPendingWorkflowHydration ? Object.keys(activeWorkflow?.nodes ?? {}) : []);
    const preserveNodeIds = new Set<string>();
    const preserveNodeDataIds = new Set<string>();
    const workflowFlowNodesById = hasPendingWorkflowHydration && activeWorkflow
      ? new Map(
        createReactFlowNodes(activeWorkflow.nodes).map((node) => [node.id, node] as const),
      )
      : undefined;
    const detachedNodes = nodesRef.current.filter((node) => (
      detachedNodeIdsRef.current.has(node.id) &&
      !instanceNodeIds.has(node.id)
    ));
    workflowNodeIds.forEach((nodeId) => {
      if (!instanceNodeIds.has(nodeId)) {
        preserveNodeIds.add(nodeId);
      }
    });
    detachedNodes.forEach((node) => {
      preserveNodeIds.add(node.id);
    });
    flowObject.nodes.forEach((instanceNode) => {
      const workflowNode = workflowFlowNodesById?.get(instanceNode.id);
      if (!workflowNode) {
        return;
      }

      const workflowNodeData = workflowNode.data;
      const instanceNodeData = instanceNode.data;

      if (
        isAINodeData(workflowNodeData) &&
        isAINodeData(instanceNodeData) &&
        (
          workflowNodeData.outputs.length !== instanceNodeData.outputs.length ||
          workflowNodeData.outputs.some((outputId, index) => {
            const instanceOutputs = instanceNodeData.outputs;
            return instanceOutputs[index] !== outputId;
          })
        )
      ) {
        preserveNodeDataIds.add(instanceNode.id);
      }
    });
    const nextNodes = mergeInstanceSnapshotNodes(
      currentNodesSnapshot,
      flowObject.nodes,
      preserveNodeIds.size > 0
        || preserveNodeDataIds.size > 0
        || detachedNodes.length > 0
        || shouldPreserveMissingInstanceStructure
        ? {
          preserveNodeIds,
          preserveNodeDataIds,
          preserveMissingCurrentNodes: shouldPreserveMissingInstanceStructure,
          transientNodeTypes: new Set([CANVAS_DOM_WINDOW_PLACEHOLDER_NODE_TYPE]),
          workflowNodesById: workflowFlowNodesById,
        }
        : undefined,
    );
    const instanceConnections = createWorkflowRuntimeSnapshot(nextNodes, flowObject.edges, flowObject.viewport).connections;
    const preserveConnectionIds = new Set(hiddenEdgeIdsRef.current);
    if (hasPendingWorkflowHydration) {
      activeWorkflow?.connections.forEach((connection) => {
        if (connection.type === 'output-link' && !instanceConnections.some((item) => item.id === connection.id)) {
          preserveConnectionIds.add(connection.id);
        }
      });
    }
    const currentCanvasConnections = currentEdgesSnapshot.map((edge) => ({
      id: edge.id,
      type: (edge.data as { connectionType?: WorkflowConnection['type'] } | undefined)?.connectionType ?? 'file-reference',
      sourceId: edge.source,
      targetId: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      order: (edge.data as { order?: number } | undefined)?.order,
    }));
    const nextConnections = mergeWorkflowConnections(
      activeWorkflow?.connections ?? currentCanvasConnections,
      instanceConnections,
      preserveConnectionIds.size > 0 || shouldPreserveMissingInstanceStructure
        ? {
          preserveConnectionIds,
          preserveMissingCurrentConnections: shouldPreserveMissingInstanceStructure,
        }
        : undefined,
    );
    if (shouldPreserveMissingInstanceStructure && nextNodes.length < currentNodesSnapshot.length) {
      syncReactFlowStateToWorkflow(currentNodesSnapshot, currentEdgesSnapshot, flowObject.viewport, {
        ...options,
        reason: options.reason ?? 'canvas-instance-sync-shrink-guard',
      });
      return;
    }

    nodesRef.current = nextNodes;
    edgesRef.current = createReactFlowEdges(nextConnections);
    syncReactFlowStateToWorkflow(nodesRef.current, edgesRef.current, flowObject.viewport, options);
  }, [hasPendingExternalHydration, syncReactFlowStateToWorkflow]);

  useEffect(() => bindCanvasRuntimeSyncFlushDelegate((request?: CanvasRuntimeSyncFlushRequest) => {
    if (request?.runtimeSnapshot) {
      return commitProvidedRuntimeSnapshot(
        request.runtimeSnapshot,
        request.runtimeSyncOptions,
      );
    }

    syncFromInstance({
      reason: request?.reason ?? 'canvas-runtime-flush',
      force: request?.force ?? true,
      batchId: request?.batchId,
      allowNodeShrink: request?.allowNodeShrink,
    });
    return workflowState.workflow;
  }), [commitProvidedRuntimeSnapshot, syncFromInstance, workflowState.workflow]);

  const getNextNodeIds = useCallback((count: number): NodeId[] => {
    const activeWorkflow = hydratedWorkflowRef.current;
    const normalizedMetadata = normalizeWorkflowNodeIdMetadata(
      activeWorkflow?.metadata ?? workflowState.metadata ?? {
        nodeCount: nodesRef.current.length,
        connectionCount: edgesRef.current.length,
        lastNodeId: 0,
        canvasSize: {
          width: CANVAS_DEFAULTS.width,
          height: CANVAS_DEFAULTS.height,
        },
        relatedTasks: [],
        usedNodeIds: [],
        releasedNodeIds: [],
      },
      activeWorkflow?.nodes ?? Object.fromEntries(
        nodesRef.current.map((node) => [node.id, node.data] as const),
      ),
    );
    const allocator = createNodeIdAllocatorFromWorkflowMetadata(
      normalizedMetadata,
      activeWorkflow?.nodes ?? Object.fromEntries(
        nodesRef.current.map((node) => [node.id, node.data] as const),
      ),
    );
    const allocation = allocator.nextBatch(count);

    if (!allocation.success || !allocation.nodeIds) {
      throw new Error(allocation.error ?? 'Node ID allocation failed.');
    }

    return allocation.nodeIds;
  }, [workflowState.metadata]);

  const getNextNodeId = useCallback((): NodeId => getNextNodeIds(1)[0], [getNextNodeIds]);

  const getFlowPositionFromClient = useCallback((clientX: number, clientY: number): Position => {
    if (!reactFlowInstance.current) {
      return { x: 0, y: 0 };
    }

    return reactFlowInstance.current.screenToFlowPosition({ x: clientX, y: clientY });
  }, []);

  const appendNodes = useCallback((
    nodeDataList: AnyNodeData[],
    options: CanvasRuntimeSyncMetricOptions = {}
  ): void => {
    if (nodeDataList.length === 0) {
      return;
    }

    const nextNodes = [
      ...nodesRef.current,
      ...nodeDataList.map((nodeData) => createReactFlowNode(nodeData)),
    ];

    pendingNodesReferenceChangeReasonRef.current = {
      reason: options.reason ?? 'append-nodes',
      batchId: options.batchId,
      addedNodeCount: nodeDataList.length,
    };
    setNodes(nextNodes);
    nodesRef.current = nextNodes;
    syncReactFlowStateToWorkflow(nextNodes, edgesRef.current, undefined, options);
  }, [setNodes, syncReactFlowStateToWorkflow]);

  const replaceNodes = useCallback((
    nextNodes: FlowNode[],
    sync = true,
    options: CanvasRuntimeSyncMetricOptions = {}
  ): void => {
    pendingNodesReferenceChangeReasonRef.current = {
      reason: options.reason ?? 'replace-nodes',
      batchId: options.batchId,
      sync,
    };
    setNodes(nextNodes);
    nodesRef.current = nextNodes;

    if (sync) {
      scheduleWorkflowSync(options);
    }
  }, [scheduleWorkflowSync, setNodes]);

  const getCanvasNodePatchQueue = useCallback((): CanvasNodePatchQueue<FlowNode> => {
    if (!nodePatchQueueRef.current) {
      nodePatchQueueRef.current = createCanvasNodePatchQueue<FlowNode>({
        getNodes: () => nodesRef.current,
        commit: (nextNodes, meta) => {
          replaceNodes(nextNodes, meta.sync, {
            batchId: meta.batchId,
            reason: meta.reason,
            force: meta.force,
            allowNodeShrink: meta.allowNodeShrink,
          });
        },
        maxFlushPerFrame: CANVAS_NODE_PATCH_QUEUE_MAX_PER_FRAME,
      });
    }

    return nodePatchQueueRef.current;
  }, [replaceNodes]);

  const cancelCanvasNodePatchQueue = useCallback((nodeId?: string): void => {
    nodePatchQueueRef.current?.cancel(nodeId);
  }, []);

  const clearCanvasNodePatchQueue = useCallback((): void => {
    nodePatchQueueRef.current?.cancel();
  }, []);

  const flushCanvasNodePatchQueue = useCallback((): number => (
    nodePatchQueueRef.current?.flush() ?? 0
  ), []);

  const enqueueNodeDataPatch = useCallback((
    nodeId: string,
    patcher: CanvasNodePatchQueuePatcher,
    sync = true,
    options: CanvasRuntimeSyncMetricOptions = {}
  ): void => {
    getCanvasNodePatchQueue().enqueue(nodeId, patcher, {
      batchId: options.batchId,
      reason: options.reason,
      sync,
      force: options.force,
      allowNodeShrink: options.allowNodeShrink,
    });
  }, [getCanvasNodePatchQueue]);

  useEffect(() => {
    enqueueNodeDataPatchRef.current = enqueueNodeDataPatch;
  }, [enqueueNodeDataPatch]);

  useEffect(() => bindMediaLayoutRuntimeSyncDelegate(({ reason, force }) => {
    if (hasPendingExternalHydration(force)) {
      return;
    }

    const snapshots = consumeFileNodeLayoutRuntimeSnapshots();
    if (snapshots.length === 0) {
      return;
    }

    const patchReason = reason ?? 'media-layout-runtime-batch';
    snapshots.forEach((snapshot) => {
      enqueueNodeDataPatch(snapshot.nodeId, (currentNode) => {
        if (!isFileNodeData(currentNode)) {
          return null;
        }
        if (currentNode.fileId !== snapshot.fileId || currentNode.type !== snapshot.nodeType) {
          return null;
        }

        const layoutPatch = buildFileNodeMediaLayoutPatch(
          currentNode,
          snapshot.width,
          snapshot.height,
          snapshot.duration,
        );
        if (!layoutPatch) {
          return null;
        }

        return {
          ...layoutPatch,
          timestamp: {
            ...currentNode.timestamp,
            updated: Date.now(),
          },
        };
      }, true, {
        reason: snapshot.reason ?? patchReason,
        force,
      });
    });

    if (force) {
      flushCanvasNodePatchQueue();
    }
  }), [enqueueNodeDataPatch, flushCanvasNodePatchQueue, hasPendingExternalHydration]);

  const replaceNode = useCallback((
    nextNode: FlowNode,
    sync = true,
    options: CanvasRuntimeSyncMetricOptions = {}
  ): void => {
    let hasUpdated = false;
    const nextNodes = nodesRef.current.map((node) => {
      if (node.id !== nextNode.id) {
        return node;
      }

      hasUpdated = true;
      return nextNode;
    });

    if (!hasUpdated) {
      return;
    }

    replaceNodes(nextNodes, sync, options);
  }, [replaceNodes]);

  const patchNodeDataLocally = useCallback((
    nodeId: string,
    patcher: Partial<AnyNodeData> | ((node: AnyNodeData) => Partial<AnyNodeData> | null | undefined),
    sync = true,
    options: CanvasRuntimeSyncMetricOptions = {}
  ): void => {
    const { nextNodes, hasUpdated } = patchNodeDataList(nodesRef.current, nodeId, patcher);
    recordCanvasNodePatch({
      nodeId,
      reason: options.reason,
      batchId: options.batchId,
      sync,
      force: options.force,
      hasUpdated,
    });
    if (!hasUpdated) {
      return;
    }

    replaceNodes(nextNodes, sync, options);
  }, [replaceNodes]);
  const findDropTarget = useCallback((
    clientX: number,
    clientY: number,
    excludedNodeIds?: ReadonlySet<string>
  ) => {
    const viewport = reactFlowInstance.current?.getViewport() ?? currentViewport;
    return resolveCanvasDropTarget({
      clientPosition: { x: clientX, y: clientY },
      viewport,
      nodes: nodesRef.current,
      spatialIndex: spatialIndexRef.current,
      containerBounds: canvasContainerRef.current?.getBoundingClientRect(),
      documentLike: typeof document === 'undefined'
        ? undefined
        : document,
      canvasRoot: canvasContainerRef.current,
      excludedNodeIds,
    });
  }, [currentViewport]);

  const clearNodeDropzoneHighlight = useCallback((): void => {
    const activeDropzone = activeAIDropzoneRef.current;
    if (!activeDropzone) {
      return;
    }

    delete activeDropzone.dataset.dropHover;
    delete activeDropzone.dataset.dropValid;
    activeAIDropzoneRef.current = null;
  }, []);

  const updateNodeDropzoneHighlight = useCallback((
    clientPosition: { x: number; y: number },
    draggedNodes: FlowNode[],
    keyboardState?: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
  ): void => {
    const excludedNodeIds = new Set(draggedNodes.map((node) => node.id));
    const resolution = findDropTarget(clientPosition.x, clientPosition.y, excludedNodeIds);
    if (!resolution) {
      clearNodeDropzoneHighlight();
      return;
    }
    const { dropTarget, dropzone } = resolution;

    if (activeAIDropzoneRef.current && activeAIDropzoneRef.current !== dropzone) {
      clearNodeDropzoneHighlight();
    }

    const targetNode = nodesRef.current.find((node) => node.id === dropTarget.nodeId);
    if (!targetNode || !isAINodeData(targetNode.data)) {
      clearNodeDropzoneHighlight();
      return;
    }

    const definition = getNodeDefinition(targetNode.data.type);
    const dropAdapter = definition?.drop;
    if (!definition || !isCustomNodeDropCapability(dropAdapter)) {
      clearNodeDropzoneHighlight();
      return;
    }

    const draggedNodeData = draggedNodes.map((node) => node.data);
    if (!dropAdapter.acceptDraggedNodes(draggedNodeData)) {
      clearNodeDropzoneHighlight();
      return;
    }

    const activeWorkflow = workflowState.workflow;
    if (!activeWorkflow) {
      clearNodeDropzoneHighlight();
      return;
    }

    const validation = dropAdapter.validateTarget(createDropTargetContext(
      activeWorkflow,
      dropTarget,
      draggedNodeData,
      keyboardState
    ));

    dropzone.dataset.dropHover = 'true';
    dropzone.dataset.dropValid = validation.valid ? 'true' : 'false';
    activeAIDropzoneRef.current = dropzone;
  }, [clearNodeDropzoneHighlight, findDropTarget, workflowState.workflow]);

  const removeNodeLocally = useCallback((nodeId: string): void => {
    cancelCanvasNodePatchQueue(nodeId);
    clearFileNodeLayoutRuntimeSnapshot(nodeId);
    removeThumbnailApply(nodeId);
    const removedNode = nodesRef.current.find((node) => node.id === nodeId);
    const nextNodes = nodesRef.current.filter((node) => node.id !== nodeId);
    const nextEdges = edgesRef.current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);

    if (removedNode && isFileNodeData(removedNode.data)) {
      unregisterLocalArchiveFile(nodeId, removedNode.data.fileId, {
        workflowId: workflowState.workflow?.id ?? runtimeResourceWorkflowIdRef.current,
      });
      backendFileService.forceDeleteNodeResource(nodeId, removedNode.data.fileId, {
        workflowId: workflowState.workflow?.id ?? runtimeResourceWorkflowIdRef.current,
      });
    }

    importSessionGuardRef.current.delete(nodeId);
    clearCanvasImageFirstPaint(nodeId);
    clearNodeImageResources(nodeId);
    setNodes(nextNodes);
    setEdges(nextEdges);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    syncManagedPreviewUrls(nextNodes);
    syncReactFlowStateToWorkflow(nextNodes, nextEdges, undefined, {
      reason: 'canvas-node-remove',
      allowNodeShrink: true,
    });
  }, [cancelCanvasNodePatchQueue, removeThumbnailApply, setEdges, setNodes, syncManagedPreviewUrls, syncReactFlowStateToWorkflow, workflowState.workflow?.id]);

  const deleteSelectedElements = useCallback((): void => {
    const selectedEdgeIds = edgesRef.current
      .filter((edge) => edge.selected)
      .map((edge) => edge.id);
    const selectedNodeIds = new Set(selectedNodeIdsRef.current);
    if (selectedNodeIds.size === 0) {
      if (selectedEdgeIds.length > 0) {
        applyCanvasEdgeRemoval(selectedEdgeIds);
      }
      return;
    }

    const nextNodes = nodesRef.current.filter((node) => !selectedNodeIds.has(node.id));
    const nextEdges = edgesRef.current.filter((edge) => (
      !selectedNodeIds.has(edge.source)
      && !selectedNodeIds.has(edge.target)
      && !edge.selected
    ));

    nodesRef.current
      .filter((node) => selectedNodeIds.has(node.id))
      .forEach((node) => {
        if (!isFileNodeData(node.data)) {
          return;
        }

        unregisterLocalArchiveFile(node.id, node.data.fileId, {
          workflowId: workflowState.workflow?.id ?? runtimeResourceWorkflowIdRef.current,
        });
        backendFileService.forceDeleteNodeResource(node.id, node.data.fileId, {
          workflowId: workflowState.workflow?.id ?? runtimeResourceWorkflowIdRef.current,
        });
        clearCanvasImageFirstPaint(node.id);
        clearNodeImageResources(node.id);
        importSessionGuardRef.current.delete(node.id);
        cancelCanvasNodePatchQueue(node.id);
        clearFileNodeLayoutRuntimeSnapshot(node.id);
      });

    setNodes(nextNodes);
    setEdges(nextEdges);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    syncManagedPreviewUrls(nextNodes);
    syncReactFlowStateToWorkflow(nextNodes, nextEdges, undefined, {
      reason: 'canvas-node-remove',
      allowNodeShrink: true,
    });
  }, [applyCanvasEdgeRemoval, cancelCanvasNodePatchQueue, setEdges, setNodes, syncManagedPreviewUrls, syncReactFlowStateToWorkflow, workflowState.workflow?.id]);

  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent): void => {
      if (shouldIgnoreGlobalKeyboardShortcut(event)) {
        return;
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      event.preventDefault();
      deleteSelectedElements();
    };

    document.addEventListener('keydown', handleGlobalKeyDown);

    return (): void => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [deleteSelectedElements]);

  const createNodeAt = useCallback((type: CreatableNodeType, position: Position): AnyNodeData => {
    const nodeId = getNextNodeId();

    if (type === 'aiImageGen') {
      return createDefaultAINodeData(nodeId, position, type);
    }

    const definition = getNodeDefinition(type);
    if (definition) {
      return createDefinitionNodeData(definition, nodeId, position);
    }

    return createDefaultAINodeData(nodeId, position, 'aiImageGen');
  }, [getNextNodeId]);

  const clearImportProgressTimer = useCallback((): void => {
    if (importProgressTimerRef.current !== null) {
      window.clearTimeout(importProgressTimerRef.current);
      importProgressTimerRef.current = null;
    }
  }, []);

  const resetImportProgressStateRefs = useCallback((
    options: {
      clearHideTimer?: boolean;
      clearUpdateTimer?: boolean;
    } = {},
  ): void => {
    const {
      clearHideTimer = true,
      clearUpdateTimer = true,
    } = options;

    if (clearHideTimer) {
      clearImportProgressTimer();
    }

    if (clearUpdateTimer && importProgressUpdateTimerRef.current !== null) {
      window.clearTimeout(importProgressUpdateTimerRef.current);
      importProgressUpdateTimerRef.current = null;
    }

    importProgressRef.current = null;
    pendingImportProgressRef.current = null;
    lastImportProgressCommitAtRef.current = 0;
  }, [clearImportProgressTimer]);

  const clearImportProgressState = useCallback((
    options: {
      clearHideTimer?: boolean;
      clearUpdateTimer?: boolean;
    } = {},
  ): void => {
    resetImportProgressStateRefs(options);
    setImportProgress(null);
  }, [resetImportProgressStateRefs]);

  const dismissImportProgress = useCallback((batchId?: string): void => {
    clearImportProgressState();
    if (batchId) {
      activeImportBatchIdsRef.current.delete(batchId);
      importBatchProgressSummariesRef.current.delete(batchId);
      settledImportBatchIdsRef.current.delete(batchId);
    }
  }, [clearImportProgressState]);

  const scheduleImportProgressHide = useCallback((batchId: string): void => {
    clearImportProgressTimer();
    importProgressTimerRef.current = window.setTimeout(() => {
      importProgressRef.current = null;
      pendingImportProgressRef.current = null;
      setImportProgress((current) => (current?.batchId === batchId ? null : current));
      importProgressTimerRef.current = null;
    }, IMPORT_PROGRESS_HIDE_DELAY);
  }, [clearImportProgressTimer]);

  const flushPendingImportProgress = useCallback((): void => {
    if (importProgressUpdateTimerRef.current !== null) {
      window.clearTimeout(importProgressUpdateTimerRef.current);
      importProgressUpdateTimerRef.current = null;
    }

    const nextProgress = pendingImportProgressRef.current;
    if (!nextProgress) {
      return;
    }

    pendingImportProgressRef.current = null;
    lastImportProgressCommitAtRef.current = performance.now();
    importProgressRef.current = nextProgress;
    setImportProgress(nextProgress);
  }, []);

  const commitImportProgress = useCallback((nextProgress: CanvasImportProgressState, force = false): void => {
    pendingImportProgressRef.current = nextProgress;

    if (force) {
      flushPendingImportProgress();
      return;
    }

    if (importProgressUpdateTimerRef.current !== null) {
      return;
    }

    const now = performance.now();
    const elapsed = now - lastImportProgressCommitAtRef.current;
    const isDragging = isViewportDraggingRef.current || Boolean(dragPreviewRef.current);
    const delayMs = isDragging
      ? IMPORT_PROGRESS_UPDATE_THROTTLE_MS
      : Math.max(0, IMPORT_PROGRESS_UPDATE_THROTTLE_MS - elapsed);
    const shouldDefer = isDragging || delayMs > 0;

    if (!shouldDefer) {
      flushPendingImportProgress();
      return;
    }

    importProgressUpdateTimerRef.current = window.setTimeout(() => {
      importProgressUpdateTimerRef.current = null;
      flushPendingImportProgress();
    }, delayMs);
  }, [flushPendingImportProgress]);

  const updateImportProgress = useCallback((
    batchId: string,
    updater: (current: CanvasImportProgressState) => CanvasImportProgressState
  ): void => {
    const currentProgress = pendingImportProgressRef.current ?? importProgressRef.current;
    if (!currentProgress || currentProgress.batchId !== batchId) {
      return;
    }

    if (currentProgress.status === 'completed') {
      return;
    }

    commitImportProgress(updater(currentProgress));
  }, [commitImportProgress]);

  const finalizeImportProgress = useCallback((batchId: string, completed: number, failed: number): void => {
    clearImportProgressTimer();
    flushPendingImportProgress();
    const currentProgress = importProgressRef.current;
    if (!currentProgress || currentProgress.batchId !== batchId) {
      return;
    }

    const nextProgress = buildCompletedImportProgress(currentProgress, completed, failed);

    pendingImportProgressRef.current = null;
    importProgressRef.current = nextProgress;
    setImportProgress(nextProgress);
    lastImportProgressCommitAtRef.current = performance.now();

    scheduleImportProgressHide(batchId);
  }, [clearImportProgressTimer, flushPendingImportProgress, scheduleImportProgressHide]);

  const completeImportBatch = useCallback((batchId: string, completed: number, failed: number): void => {
    recordCanvasTraceEvent({
      type: 'operation.import',
      phase: 'end',
      opId: batchId,
      data: {
        completed,
        failed,
        nodeCount: nodesRef.current.length,
      },
    });
    finalizeImportProgress(batchId, completed, failed);
    completeCanvasImportBatch(batchId, completed, failed);
    activeImportBatchIdsRef.current.delete(batchId);
    importBatchProgressSummariesRef.current.delete(batchId);
    settledImportBatchIdsRef.current.delete(batchId);
    scheduleMediaLayoutRuntimeSync({
      reason: 'media-layout-import-complete',
    });

    if (failed > 0) {
      notification.showWarning('导入完成', `成功 ${completed} 个，失败 ${failed} 个`);
    } else if (completed > 0) {
      notification.showSuccess('导入完成', `已导入 ${completed} 个文件到画布`);
    }
  }, [finalizeImportProgress, notification]);

  useEffect(() => {
    if (!importProgress || importProgress.status !== 'completed') {
      clearImportProgressTimer();
      return;
    }

    if (importProgressTimerRef.current === null) {
      scheduleImportProgressHide(importProgress.batchId);
    }
  }, [
    clearImportProgressTimer,
    importProgress,
    scheduleImportProgressHide,
  ]);

  const filterEligibleImportSelections = useCallback((files: Array<{
    file: File;
    localSourceHandle?: EligibleImportFile['localSourceHandle'];
  }>): EligibleImportFile[] => (
    files.flatMap(({ file, localSourceHandle }) => {
      const fileType = getFileTypeFromName(file.name);
      if (!fileType) {
        notification.showWarning('导入跳过', `不支持的文件格式：${file.name}`);
        return [];
      }

      return [{
        file,
        nodeType: fileType === 'model3d' ? 'ply' : fileType,
        mimeType: file.type || getMimeType(file.name),
        ...(localSourceHandle ? { localSourceHandle } : {}),
      }];
    })
  ), [notification]);

  const probeImportFileMetadata = useCallback(async (file: EligibleImportFile): Promise<FileMetadata> => {
    if (file.nodeType === 'ply') {
      return {};
    }

    if (file.nodeType === 'image') {
      const metadata = await fileService.extractImageMetadata(file.file);
      return {
        width: metadata.width > 0 ? metadata.width : undefined,
        height: metadata.height > 0 ? metadata.height : undefined,
      };
    }

    const metadata = await fileService.extractVideoMetadata(file.file);
    return {
      width: metadata.width > 0 ? metadata.width : undefined,
      height: metadata.height > 0 ? metadata.height : undefined,
      duration: metadata.duration > 0 ? metadata.duration : undefined,
    };
  }, []);

  const probeImportFilesForLayoutWithFallback = useCallback(async (
    files: EligibleImportFile[]
  ): Promise<ProbedImportFile[]> => probeImportFilesForLayout(
    files,
    probeImportFileMetadata,
    (entry, error) => {
      log.warn(
        'probeImportFilesForLayout',
        `Failed to probe import layout metadata: ${entry.file.name}`,
        error instanceof Error ? { errorMessage: error.message } : undefined
      );
    },
  ), [probeImportFileMetadata]);

  const buildPositionedImportFilesWithNodeIds = useCallback((
    files: ProbedImportFile[],
    position: Position
  ): PositionedImportFile[] => buildPositionedImportFiles(
    files,
    position,
    getNextNodeIds,
  ), [getNextNodeIds]);

  const createPlaceholderImportBatchWithSession = useCallback((
    batchId: string,
    files: PositionedImportFile[],
  ): { tasks: FileImportTask[]; nodes: AnyNodeData[] } => createPlaceholderImportBatch(
    batchId,
    files,
    generateUUID,
  ), []);

  const preprocessImportedNodeDetails = useCallback(async (
    task: FileImportTask,
  ): Promise<{
    imageAssets: ReturnType<typeof buildImportedImageAssets>;
    preprocessResult: Awaited<ReturnType<typeof fileService.preprocessImportFile>> | undefined;
  }> => {
    const { batchId, file, fileId, nodeId, nodeType, sessionId, metadata } = task;
    let preprocessResult: Awaited<ReturnType<typeof fileService.preprocessImportFile>> | undefined;
    let imageAssets: ReturnType<typeof buildImportedImageAssets> = {};
    const shouldTrackEnhancement = nodeType === 'image' || nodeType === 'video';
    const enhancementStartedAt = performance.now();
    const isImportSessionActive = (): boolean => {
      const expectedGuard: FileImportSessionGuard = {
        nodeId: nodeId.value,
        fileId: task.fileId,
        sessionId,
      };
      return shouldApplyImportSessionResult(
        nodesRef.current,
        expectedGuard,
        importSessionGuardRef.current.get(nodeId.value),
      );
    };

    if (shouldTrackEnhancement) {
      markCanvasImportEnhancementStarted(batchId);
    }

    try {
      if (nodeType === 'image') {
        preprocessResult = await fileService.preprocessImportFile({
          file,
          kind: 'image',
          thumbnail: {
            maxWidth: 512,
            maxHeight: 512,
          },
        }).catch((error) => {
          log.warn('preprocessImportedNodeDetails', `Failed to preprocess imported image: ${file.name}`, error instanceof Error ? { errorMessage: error.message } : undefined);
          return undefined;
        });
      } else if (nodeType === 'video') {
        preprocessResult = await withTimeout(
          fileService.preprocessImportFile({
            file,
            kind: 'video',
            thumbnail: {
              maxWidth: 200,
              maxHeight: 200,
            },
          }),
          FILE_DETAILS_READY_TIMEOUT,
          `Timed out while preprocessing video import: ${file.name}`
        ).catch((error) => {
          log.warn('preprocessImportedNodeDetails', `Failed to preprocess imported video: ${file.name}`, error instanceof Error ? { errorMessage: error.message } : undefined);
          return undefined;
        });
      }

      if (!isImportSessionActive()) {
        if (preprocessResult?.kind === 'image' && preprocessResult.thumbnailUrl) {
          URL.revokeObjectURL(preprocessResult.thumbnailUrl);
        }
        return {
          imageAssets,
          preprocessResult,
        };
      }

      imageAssets = buildImportedImageAssets(
        nodeId.value,
        preprocessResult,
        metadata,
        nodeType === 'image'
          ? {
            fileId,
          }
          : {}
      );

      if (nodeType === 'video' && !imageAssets.thumbnailUrl) {
        log.warn('preprocessImportedNodeDetails', `No renderable preview assets generated for import: ${file.name}`, {
          nodeId: nodeId.value,
          nodeType,
        });

        enqueueNodeDataPatch(nodeId.value, (currentNode) => {
          if (!isImportSessionActive()) {
            return null;
          }

          const fileNode = currentNode as FileNodeData;

          return {
            status: 'error',
            timestamp: {
              ...fileNode.timestamp,
              updated: Date.now(),
            },
          };
        }, true, {
          batchId,
          reason: 'import-enhancement-error',
        });
        return {
          imageAssets,
          preprocessResult,
        };
      }

      if (nodeType === 'video' && imageAssets.needsNodePatch) {
        enqueueNodeDataPatch(nodeId.value, (currentNode) => {
          if (!isImportSessionActive()) {
            return null;
          }

          const fileNode = currentNode as FileNodeData;
          const nextFileNode = applyImportedImageAssets(fileNode, nodeType, imageAssets);
          return {
            thumbnailUrl: nextFileNode.thumbnailUrl,
            previewUrl: nextFileNode.previewUrl,
            metadata: nextFileNode.metadata,
            status: nextFileNode.status,
            timestamp: nextFileNode.timestamp,
          };
        }, false, {
          batchId,
          reason: 'video-import-enhancement-apply',
        });
      }
    } finally {
      if (shouldTrackEnhancement) {
        const completedAt = performance.now();
        const status = nodeType === 'image' || imageAssets.thumbnailUrl ? 'completed' : 'failed';
        recordCanvasImportStage({
          batchId,
          stage: 'enhancement-preprocess',
          startedAt: enhancementStartedAt,
          completedAt,
          durationMs: completedAt - enhancementStartedAt,
          status,
          nodeId: nodeId.value,
          nodeType,
          fileName: file.name,
          detail: {
            hasThumbnailUrl: nodeType === 'image'
              ? Boolean(imageAssets.thumbnailReady)
              : Boolean(imageAssets.thumbnailUrl),
            thumbnailUnavailable: Boolean(imageAssets.thumbnailUnavailable),
          },
        });
      }
      if (shouldTrackEnhancement) {
        markCanvasImportEnhancementSettled(batchId);
      }
    }

    return {
      imageAssets,
      preprocessResult,
    };
  }, [enqueueNodeDataPatch]);
  const preprocessImportedNodeDetailsRef = useRef(preprocessImportedNodeDetails);

  useEffect(() => {
    preprocessImportedNodeDetailsRef.current = preprocessImportedNodeDetails;
  }, [preprocessImportedNodeDetails]);

  const hydrateImportedNode = useCallback(async (task: FileImportTask): Promise<FileHydrationResult> => {
    const { file, fileId, nodeId, nodeType, sessionId, localSourceHandle } = task;
    const hydrationStartedAt = performance.now();
    const startedAt = Date.now();
    const sessionGuard = createImportTaskSessionGuard(task);
    const isImportSessionActive = (): boolean => {
      return shouldApplyImportSessionResult(
        nodesRef.current,
        sessionGuard,
        importSessionGuardRef.current.get(nodeId.value),
      );
    };

    importSessionGuardRef.current.set(nodeId.value, sessionGuard);
    registerLocalArchiveFile(nodeId.value, fileId, file, {
      workflowId: workflowState.workflow?.id ?? runtimeResourceWorkflowIdRef.current,
    });
    backendFileService.registerRuntimeNodeFileSource(nodeId.value, fileId, file, {
      workflowId: workflowState.workflow?.id ?? runtimeResourceWorkflowIdRef.current,
    });

    const localSourceReferenceId = localSourceHandle
      ? createLocalFileSourceReferenceId(nodeId.value, fileId)
      : undefined;

    if (localSourceHandle && localSourceReferenceId) {
      try {
        await localFileSourceStore.save(
          createLocalFileSourceStoreRecord(localSourceReferenceId, localSourceHandle, file),
        );
        enqueueNodeDataPatch(nodeId.value, (currentNode) => {
          if (!isImportSessionActive()) {
            return null;
          }

          const fileNode = currentNode as FileNodeData;
          if (fileNode.source.type !== 'imported') {
            return null;
          }

          return {
            source: {
              ...fileNode.source,
              importMethod: 'local',
              sourceDisplayName: fileNode.source.sourceDisplayName || file.name,
              localSource: {
                ...fileNode.source.localSource,
                status: 'available',
                referenceId: localSourceReferenceId,
                kind: 'file-system-access',
                permissionState: 'granted',
                lastResolvedAt: Date.now(),
              },
            },
            timestamp: {
              ...fileNode.timestamp,
              updated: Date.now(),
            },
          };
        }, true, {
          batchId: task.batchId,
          reason: 'import-node-local-source-linked',
        });
      } catch (error) {
        log.warn('hydrateImportedNode', 'Failed to persist local file handle during import', {
          nodeId: nodeId.value,
          fileName: file.name,
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    if (!isImportSessionActive()) {
      return {
        success: false,
        renderable: false,
        enhancementQueued: false,
      };
    }

    if (nodeType === 'image') {
      registerLocalImageImportRuntime(nodeId.value, file, {
        sessionId,
        fileId,
        workflowId: workflowState.workflow?.id ?? runtimeResourceWorkflowIdRef.current,
      });
    } else {
      enqueueNodeDataPatch(nodeId.value, (currentNode) => {
        if (!isImportSessionActive()) {
          return null;
        }

        const fileNode = currentNode as FileNodeData;
        return {
          previewUrl: fileNode.previewUrl,
          thumbnailUrl: fileNode.thumbnailUrl,
          status: 'idle',
          timestamp: {
            ...fileNode.timestamp,
            updated: startedAt,
          },
        };
      }, false, {
        batchId: task.batchId,
        reason: 'import-node-hydration-local',
      });
    }

    try {
      if (nodeType === 'image' || nodeType === 'video') {
        enqueueImportTask(task);
      }

      const hydrationCompletedAt = performance.now();
      recordCanvasImportStage({
        batchId: task.batchId,
        stage: 'node-hydration',
        startedAt: hydrationStartedAt,
        completedAt: hydrationCompletedAt,
        durationMs: hydrationCompletedAt - hydrationStartedAt,
        nodeId: nodeId.value,
        nodeType,
        fileName: file.name,
        detail: {
          renderable: true,
          enhancementQueued: nodeType === 'image' || nodeType === 'video',
        },
      });

      return {
        success: true,
        renderable: true,
        enhancementQueued: nodeType === 'image' || nodeType === 'video',
      };
    } catch (error) {
      log.warn('hydrateImportedNode', `Failed to hydrate imported file: ${file.name}`, error instanceof Error ? { errorMessage: error.message } : undefined);
      if (!isImportSessionActive()) {
        return {
          success: false,
          renderable: false,
          enhancementQueued: false,
        };
      }
      enqueueNodeDataPatch(nodeId.value, (currentNode) => {
        if (!isImportSessionActive()) {
          return null;
        }

        const fileNode = currentNode as FileNodeData;
        if (nodeType === 'image') {
          const nextFileNode = markImageNodeImportError(fileNode);
          return {
            imageAsset: nextFileNode.imageAsset,
            thumbnailUrl: nextFileNode.thumbnailUrl,
            status: nextFileNode.status,
            timestamp: nextFileNode.timestamp,
          };
        }

        return {
          previewUrl: undefined,
          thumbnailUrl: undefined,
          status: 'error',
          timestamp: {
            ...fileNode.timestamp,
            updated: Date.now(),
          },
        };
      }, true, {
        batchId: task.batchId,
        reason: 'import-node-hydration-error',
      });

      if (nodeType === 'video' || nodeType === 'image') {
        removeThumbnailApply(nodeId.value);
        clearCanvasImageFirstPaint(nodeId.value);
        clearNodeImageResources(nodeId.value);
      }

      const hydrationCompletedAt = performance.now();
      recordCanvasImportStage({
        batchId: task.batchId,
        stage: 'node-hydration',
        startedAt: hydrationStartedAt,
        completedAt: hydrationCompletedAt,
        durationMs: hydrationCompletedAt - hydrationStartedAt,
        status: 'failed',
        nodeId: nodeId.value,
        nodeType,
        fileName: file.name,
        detail: {
          renderable: false,
          enhancementQueued: false,
        },
      });

      return {
        success: false,
        renderable: false,
        enhancementQueued: false,
      };
    }
  }, [enqueueImportTask, enqueueNodeDataPatch, removeThumbnailApply, workflowState.workflow?.id]);

  const processImportBatch = useCallback(async (batchId: string, tasks: FileImportTask[]): Promise<void> => {
    let cursor = 0;

    const shouldYieldAfterHydrationPatch = (): boolean => {
      const pressure = importPressureRef.current;
      return pressure.visibleImportingImageNodeCount >= FILE_IMPORT_PRESSURE_VISIBLE_IMAGE_THRESHOLD ||
        pressure.importingImageNodeCount >= FILE_IMPORT_PRESSURE_IMPORTING_IMAGE_THRESHOLD ||
        pressure.isViewportDragging;
    };

    const yieldAfterHydrationPatch = async (hydratedInSlice: number): Promise<number> => {
      if (hydratedInSlice < FILE_IMPORT_HYDRATION_PRESSURE_BATCH_SIZE && !shouldYieldAfterHydrationPatch()) {
        return hydratedInSlice;
      }

      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.setTimeout(() => resolve(), FILE_IMPORT_ENHANCEMENT_YIELD_DELAY_MS);
        });
      });
      return 0;
    };

    const runWorker = async (): Promise<void> => {
      let hydratedInSlice = 0;
      while (cursor < tasks.length) {
        const currentIndex = cursor;
        cursor += 1;

        const result = await hydrateImportedNode(tasks[currentIndex]);
        hydratedInSlice += 1;
        if (!activeImportBatchIdsRef.current.has(batchId)) {
          return;
        }

        if (!result.enhancementQueued) {
          const currentSummary = importBatchProgressSummariesRef.current.get(batchId);
          if (!currentSummary) {
            continue;
          }

          const nextSummary: ImportBatchProgressSummary = {
            ...currentSummary,
            completed: currentSummary.completed + (result.success && result.renderable ? 1 : 0),
            failed: currentSummary.failed + (result.success && result.renderable ? 0 : 1),
          };
          importBatchProgressSummariesRef.current.set(batchId, nextSummary);

          updateImportProgress(batchId, (current) => {
            const processed = Math.min(nextSummary.completed + nextSummary.failed, current.total);
            return {
              ...current,
              completed: nextSummary.completed,
              failed: nextSummary.failed,
              message: buildRunningImportProgressMessage(processed, current.total),
            };
          });
        }

        hydratedInSlice = await yieldAfterHydrationPatch(hydratedInSlice);
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(FILE_IMPORT_HYDRATION_CONCURRENCY, tasks.length) },
        () => runWorker()
      )
    );

    if (!activeImportBatchIdsRef.current.has(batchId)) {
      importBatchProgressSummariesRef.current.delete(batchId);
      settledImportBatchIdsRef.current.delete(batchId);
      return;
    }

    const currentSummary = importBatchProgressSummariesRef.current.get(batchId);
    if (!currentSummary) {
      return;
    }

    const nextSummary: ImportBatchProgressSummary = {
      ...currentSummary,
      hydrationFinished: true,
    };
    importBatchProgressSummariesRef.current.set(batchId, nextSummary);

    if (nextSummary.completed + nextSummary.failed >= nextSummary.total) {
      completeImportBatch(batchId, nextSummary.completed, nextSummary.failed);
      return;
    }

    if (
      settledImportBatchIdsRef.current.has(batchId) &&
      nextSummary.completed + nextSummary.failed >= nextSummary.total
    ) {
      completeImportBatch(batchId, nextSummary.completed, nextSummary.failed);
    }
  }, [completeImportBatch, hydrateImportedNode, updateImportProgress]);

  const hasRunningImportSession = useCallback((): boolean => (
    activeImportBatchIdsRef.current.size > 0 ||
    pendingImportProgressRef.current?.status === 'running' ||
    importProgressRef.current?.status === 'running'
  ), []);

  const pauseImportDragLoadShedding = useCallback((): void => {
    if (!hasRunningImportSession()) {
      return;
    }

    deferVisibilityApplyRef.current = true;
    loadSheddingPausedRef.current = true;
    pauseImageVisibilityUpdates();
    pauseThumbnailApply();
  }, [hasRunningImportSession, pauseThumbnailApply]);

  const resumeImportDragLoadShedding = useCallback((flushMode: 'all' | 'limited' = 'limited'): void => {
    const wasPaused = loadSheddingPausedRef.current;
    if (wasPaused) {
      deferVisibilityApplyRef.current = false;
      loadSheddingPausedRef.current = false;
      resumeImageVisibilityUpdates({
        flush: flushMode === 'all',
      });
      resumeThumbnailApply();
      if (flushMode === 'all') {
        flushThumbnailApply();
      } else {
        flushThumbnailApply({
          limit: DRAG_END_THUMBNAIL_FLUSH_LIMIT,
        });
      }
    }
    flushPendingImportProgress();
  }, [flushPendingImportProgress, flushThumbnailApply, resumeThumbnailApply]);

  const importFilesToCanvas = useCallback(async (
    files: Array<{
      file: File;
      localSourceHandle?: EligibleImportFile['localSourceHandle'];
    }>,
    position: Position,
  ): Promise<void> => {
    if (files.length === 0) {
      return;
    }

    try {
      const batchId = generateUUID();
      const importStartedAt = performance.now();
      const eligibleFiles = filterEligibleImportSelections(files);

      if (eligibleFiles.length === 0) {
        return;
      }

      recordCanvasTraceEvent({
        type: 'operation.import',
        phase: 'start',
        opId: batchId,
        data: {
          inputCount: files.length,
          eligibleCount: eligibleFiles.length,
          nodeCount: nodesRef.current.length,
        },
      });
      activeImportBatchIdsRef.current.add(batchId);
      startCanvasImportBatch(batchId, eligibleFiles.length, importStartedAt);

      const layoutProbeStartedAt = performance.now();
      const probedFiles = await probeImportFilesForLayoutWithFallback(eligibleFiles);
      const layoutProbeCompletedAt = performance.now();
      recordCanvasImportStage({
        batchId,
        stage: 'layout-probe',
        startedAt: layoutProbeStartedAt,
        completedAt: layoutProbeCompletedAt,
        durationMs: layoutProbeCompletedAt - layoutProbeStartedAt,
        itemCount: eligibleFiles.length,
        detail: {
          probedCount: probedFiles.length,
        },
      });
      if (probedFiles.length === 0) {
        activeImportBatchIdsRef.current.delete(batchId);
        settledImportBatchIdsRef.current.delete(batchId);
        return;
      }

      const layoutPositioningStartedAt = performance.now();
      const positionedFiles = buildPositionedImportFilesWithNodeIds(probedFiles, position);
      const layoutPositioningCompletedAt = performance.now();
      recordCanvasImportStage({
        batchId,
        stage: 'layout-positioning',
        startedAt: layoutPositioningStartedAt,
        completedAt: layoutPositioningCompletedAt,
        durationMs: layoutPositioningCompletedAt - layoutPositioningStartedAt,
        itemCount: positionedFiles.length,
      });
      if (positionedFiles.length === 0) {
        activeImportBatchIdsRef.current.delete(batchId);
        settledImportBatchIdsRef.current.delete(batchId);
        return;
      }

      const placeholderBuildStartedAt = performance.now();
      const placeholderBatch = createPlaceholderImportBatchWithSession(batchId, positionedFiles);
      const placeholderBuildCompletedAt = performance.now();
      recordCanvasImportStage({
        batchId,
        stage: 'placeholder-batch-build',
        startedAt: placeholderBuildStartedAt,
        completedAt: placeholderBuildCompletedAt,
        durationMs: placeholderBuildCompletedAt - placeholderBuildStartedAt,
        itemCount: placeholderBatch.tasks.length,
      });

      if (placeholderBatch.tasks.length === 0) {
        activeImportBatchIdsRef.current.delete(batchId);
        settledImportBatchIdsRef.current.delete(batchId);
        return;
      }

      await actions.ensureMaterializedWorkflow();

      registerCanvasImportNodes({
        batchId,
        nodes: placeholderBatch.tasks.map((task) => ({
          nodeId: task.nodeId.value,
          nodeType: task.nodeType,
          fileName: task.file.name,
        })),
      });

      clearImportProgressTimer();
      const placeholderInsertStartedAt = performance.now();
      appendNodes(placeholderBatch.nodes, {
        batchId,
        reason: 'import-placeholder-insert',
      });
      const placeholderInsertCompletedAt = performance.now();
      recordCanvasImportStage({
        batchId,
        stage: 'placeholder-insert',
        startedAt: placeholderInsertStartedAt,
        completedAt: placeholderInsertCompletedAt,
        durationMs: placeholderInsertCompletedAt - placeholderInsertStartedAt,
        itemCount: placeholderBatch.nodes.length,
      });
      markCanvasImportPlaceholdersReady(batchId);

      const initialProgress: CanvasImportProgressState = {
        batchId,
        total: placeholderBatch.tasks.length,
        completed: 0,
        failed: 0,
        status: 'running',
        message: buildRunningImportProgressMessage(0, placeholderBatch.tasks.length),
      };
      importBatchProgressSummariesRef.current.set(batchId, {
        completed: 0,
        failed: 0,
        total: placeholderBatch.tasks.length,
        hydrationFinished: false,
      });
      pendingImportProgressRef.current = null;
      importProgressRef.current = initialProgress;
      lastImportProgressCommitAtRef.current = performance.now();
      setImportProgress(initialProgress);

      void processImportBatch(batchId, placeholderBatch.tasks);
    } catch (error) {
      recordCanvasTraceEvent({
        type: 'operation.import',
        phase: 'end',
        data: {
          failed: true,
        },
      });
      activeImportBatchIdsRef.current.clear();
      importBatchProgressSummariesRef.current.clear();
      settledImportBatchIdsRef.current.clear();
      clearCanvasNodePatchQueue();
      clearImportProgressState();
      const message = error instanceof Error ? error.message : '批量导入初始化失败';
      notification.showError('导入失败', message);
      log.error('importFilesToCanvas', 'Failed to initialize import batch', error instanceof Error ? error : undefined);
    }
  }, [
    actions,
    appendNodes,
    buildPositionedImportFilesWithNodeIds,
    clearImportProgressTimer,
    clearImportProgressState,
    clearCanvasNodePatchQueue,
    createPlaceholderImportBatchWithSession,
    filterEligibleImportSelections,
    notification,
    probeImportFilesForLayoutWithFallback,
    processImportBatch,
  ]);

  const appendCreatedNode = useCallback((
    type: CreatableNodeType,
    position: Position,
  ): void => {
    appendNodes([createNodeAt(type, position)]);
  }, [appendNodes, createNodeAt]);

  const patchReboundFileNode = useCallback((
    nodeId: string,
    reboundNode: FileNodeData,
  ): void => {
    patchNodeDataLocally(nodeId, reboundNode, true, {
      reason: 'file-node-local-rebind',
      force: true,
    });
  }, [patchNodeDataLocally]);

  const {
    propertyDialogNode,
    imageGridSplitDialogNode,
    isSplittingImageGrid,
    closePropertyDialog,
    closeImageGridSplitDialog,
    confirmCustomImageGridSplit,
    handleRebindPropertyDialogFile,
    handleFileInputChange,
    buildContextMenuActions,
  } = useCanvasFileInteractions({
    fileInputRef,
    nodes,
    workflowId: workflowState.workflow?.id ?? runtimeResourceWorkflowIdRef.current,
    actions,
    notification,
    importFilesToCanvas,
    appendCreatedNode,
    removeNodeLocally,
    patchReboundFileNode,
  });
  const {
    hoveredNodeId,
    onNodeContextMenu,
    onNodeClick,
    onNodeDoubleClick,
    onNodeMouseEnter,
    onNodeMouseLeave,
    onPaneClick,
    onPaneContextMenu,
    onCanvasContainerDoubleClickCapture,
  } = useCanvasContextInteractions({
    currentViewport,
    nodesRef,
    spatialIndexRef,
    reactFlowInstanceRef: reactFlowInstance,
    canvasContainerRef,
    setNodes,
    markRecentImageInteraction,
    getFlowPositionFromClient,
    buildContextMenuActions,
    contextMenu,
  });

  const buildWorkflowConnectionEdge = useCallback((connection: WorkflowConnection): Edge => {
    return createReactFlowEdge(connection);
  }, []);

  const onConnect: OnConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }

    const sourceNode = nodesRef.current.find((node) => node.id === connection.source);
    const targetNode = nodesRef.current.find((node) => node.id === connection.target);
    if (!sourceNode || !targetNode) {
      return;
    }

    const definition = isAINodeData(targetNode.data)
      ? getNodeDefinition(targetNode.data.type)
      : null;
    const existingInputs = isAINodeData(targetNode.data)
      ? selectors
        .getNodeInputSummary(targetNode.id)
        .filter((item) => item.targetNode.id.value === targetNode.id)
      : [];

    if (isAINodeData(targetNode.data)) {
      if (!definition) {
        notification.showWarning('连接失败', '目标节点未注册。');
        return;
      }

      const validation = definition.validateConnection({
        sourceNode: sourceNode.data,
        targetNode: targetNode.data,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        existingInputs,
      });

      if (!validation.valid) {
        notification.showWarning('连接失败', validation.reason ?? '连接不合法。');
        return;
      }
    }

    const targetGroups = isAINodeData(targetNode.data)
      ? (definition?.resolveInputGroups?.(targetNode.data) ?? [])
      : [];

    const workflowConnection: WorkflowConnection = {
      id: generateUUID(),
      type: 'file-reference',
      sourceId: connection.source,
      targetId: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      order: isAINodeData(targetNode.data) && definition
        ? getNextConnectionOrder({
          sourceNode: sourceNode.data,
          targetNode: targetNode.data,
          sourceHandle: connection.sourceHandle ?? undefined,
          targetHandle: connection.targetHandle ?? undefined,
          existingInputs,
          existingConnections: workflowState.connections,
        }, targetGroups)
        : edgesRef.current.length,
    };

    const shouldReplaceAIImageInpaintInput =
      isAINodeData(targetNode.data) &&
      targetNode.data.type === 'aiImageInpaint' &&
      workflowConnection.type === 'file-reference' &&
      workflowConnection.targetHandle === getAIImageInpaintInputHandle();
    const baseEdges = shouldReplaceAIImageInpaintInput
      ? edgesRef.current.filter((edge) => {
        const connectionType = (
          edge.data as { connectionType?: WorkflowConnection['type'] } | undefined
        )?.connectionType ?? 'file-reference';

        if (
          connectionType === 'file-reference' &&
          edge.target === workflowConnection.targetId &&
          edge.targetHandle === workflowConnection.targetHandle
        ) {
          return false;
        }

        if (
          connectionType === 'output-link' &&
          edge.source === workflowConnection.targetId &&
          edge.sourceHandle === getAIImageInpaintOutputHandle()
        ) {
          return false;
        }

        return true;
      })
      : edgesRef.current;
    const nextEdges = [...baseEdges, buildWorkflowConnectionEdge(workflowConnection)];
    if (shouldReplaceAIImageInpaintInput) {
      const nextNodes = nodesRef.current.map((node) => {
        if (node.id !== workflowConnection.targetId || !isAINodeData(node.data)) {
          return node;
        }

        const nextData = {
          ...node.data,
          config: {
            ...node.data.config,
            hasMaskMarks: false,
          },
          outputs: [],
          timestamp: {
            ...node.data.timestamp,
            updated: Date.now(),
          },
        };

        return {
          ...node,
          data: nextData,
          position: nextData.position,
        };
      });

      setNodes(nextNodes);
      nodesRef.current = nextNodes;
      updateEdgesLocally(nextEdges, false);
      syncReactFlowStateToWorkflow(nextNodes, nextEdges);
    } else {
      updateEdgesLocally(nextEdges);
    }
    markRecentImageInteraction(connection.source);
    markRecentImageInteraction(connection.target);
  }, [
    buildWorkflowConnectionEdge,
    markRecentImageInteraction,
    notification,
    selectors,
    setNodes,
    syncReactFlowStateToWorkflow,
    updateEdgesLocally,
    workflowState.connections,
  ]);

  const onMove = useCallback((_: unknown, viewport: Viewport) => {
    const previousViewport = lastMoveViewportRef.current;
    const isZoomMove = hasViewportZoomChanged(previousViewport, viewport);
    lastMoveViewportRef.current = { ...viewport };
    if (!isViewportDraggingRef.current) {
      suspendViewportSync();
      suspendViewportImageWork();
      pauseImportDragLoadShedding();
      isViewportDraggingRef.current = true;
      setIsViewportDragging(true);
      setDragRasterAnchorViewport(viewport);
    }

    if (isZoomMove && !shouldScheduleIntermediateZoomVisibility({
      lastScheduledViewport: lastZoomVisibilityViewportRef.current,
      nextViewport: viewport,
      lastScheduledAt: lastZoomVisibilityScheduledAtRef.current,
      now: performance.now(),
    })) {
      return;
    }

    if (isZoomMove) {
      lastZoomVisibilityViewportRef.current = { ...viewport };
      lastZoomVisibilityScheduledAtRef.current = performance.now();
    }

    scheduleDragVisibility(buildDragVisibilityScheduleOptions(viewport, 'frame'));
  }, [
    buildDragVisibilityScheduleOptions,
    pauseImportDragLoadShedding,
    scheduleDragVisibility,
    suspendViewportImageWork,
    suspendViewportSync,
  ]);

  const onMoveStart = useCallback((_: MouseEvent | TouchEvent, viewport: Viewport) => {
    lastMoveViewportRef.current = { ...viewport };
    lastZoomVisibilityViewportRef.current = { ...viewport };
    lastZoomVisibilityScheduledAtRef.current = performance.now();
    if (!isViewportDraggingRef.current) {
      recordCanvasTraceEvent({
        type: 'operation.pan',
        phase: 'start',
        data: {
          viewportX: viewport.x,
          viewportY: viewport.y,
          viewportZoom: viewport.zoom,
          nodeCount: nodesRef.current.length,
          importing: activeImportBatchIdsRef.current.size > 0 || importProgressRef.current?.status === 'running',
        },
      });
      suspendViewportSync();
      suspendViewportImageWork();
      pauseImportDragLoadShedding();
      isViewportDraggingRef.current = true;
      setIsViewportDragging(true);
      setDragRasterAnchorViewport(viewport);
    }
    scheduleDragVisibility(buildDragVisibilityScheduleOptions(viewport, 'frame'));
  }, [
    buildDragVisibilityScheduleOptions,
    pauseImportDragLoadShedding,
    scheduleDragVisibility,
    suspendViewportImageWork,
    suspendViewportSync,
  ]);

  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    const moveEndStartedAt = performance.now();
    lastMoveViewportRef.current = null;
    lastZoomVisibilityViewportRef.current = null;
    lastZoomVisibilityScheduledAtRef.current = 0;
    const importing = activeImportBatchIdsRef.current.size > 0 || importProgress?.status === 'running';
    resumeViewportSync();
    resumeViewportImageWork();
    if (isViewportDraggingRef.current) {
      isViewportDraggingRef.current = false;
      setIsViewportDragging(false);
    }
    setDragRasterAnchorViewport(null);
    resumeImportDragLoadShedding('limited');
    const resumeCompletedAt = performance.now();
    cancelDragVisibility();
    const dragVisibilityCompletedAt = performance.now();
    const workflowSyncStartedAt = performance.now();
    scheduleViewportSync(viewport);
    scheduleWorkflowSync({
      reason: importing ? 'viewport-drag-end-importing' : 'canvas-viewport-drag-end',
    });
    const workflowSyncCompletedAt = performance.now();
    const recordMoveEndAfterImageWork = (metric: ViewportImageMetric): void => {
      const imageWorkCompletedAt = performance.now();
      recordCanvasTraceEvent({
        type: 'operation.pan',
        phase: 'end',
        durationMs: imageWorkCompletedAt - moveEndStartedAt,
        data: {
          importing,
          viewportX: viewport.x,
          viewportY: viewport.y,
          viewportZoom: viewport.zoom,
          visibilityApplyMs: metric.applyMs,
          visibleNodeCount: metric.visibleNodeCount,
          nearViewportNodeCount: metric.nearViewportNodeCount,
        },
      });
      recordCanvasMoveEndMetric({
        importing,
        totalDurationMs: imageWorkCompletedAt - moveEndStartedAt,
        resumeSchedulingMs: resumeCompletedAt - moveEndStartedAt,
        viewportSyncMs: 0,
        dragVisibilityFlushMs: dragVisibilityCompletedAt - resumeCompletedAt,
        imageWorkFlushMs: 0,
        workflowSyncScheduleMs: workflowSyncCompletedAt - workflowSyncStartedAt,
        visibilityApplyMs: metric.applyMs,
        resourceScheduleMs: imageWorkCompletedAt - metric.recordedAt,
        patchQueueFlushMs: 0,
        workflowViewportSyncMs: 0,
      });
    };

    scheduleViewportImageWork(viewport, {
      phase: importing ? 'post-drag-importing' : 'post-drag',
      onCommitted: recordMoveEndAfterImageWork,
    });
  }, [
    cancelDragVisibility,
    importProgress?.status,
    resumeImportDragLoadShedding,
    resumeViewportImageWork,
    resumeViewportSync,
    scheduleViewportSync,
    scheduleViewportImageWork,
    scheduleWorkflowSync,
  ]);

  const onInit = useCallback((instance: ReactFlowInstance<AnyNodeData>): void => {
    reactFlowInstance.current = instance;

    const savedViewport = workflowState.viewport;
    if (savedViewport) {
      commitViewportForVisibility(savedViewport);
      instance.setViewport(savedViewport);
      log.info('onInit', 'Canvas initialized with saved viewport', {
        viewport: savedViewport,
      });
      return;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const centerX = CANVAS_DEFAULTS.width / 2;
    const centerY = CANVAS_DEFAULTS.height / 2;
    const defaultViewport = {
      x: -centerX + viewportWidth / 2,
      y: -centerY + viewportHeight / 2,
      zoom: 1,
    };

    commitViewportForVisibility(defaultViewport);
    instance.setViewport(defaultViewport);

    log.info('onInit', 'Canvas initialized and centered', {
      viewport: defaultViewport,
    });
  }, [commitViewportForVisibility, workflowState.viewport]);

  const visibleNodes = useVisibleNodes({
    nodes,
    nodesVersion,
    candidateNodeIds: visibleCandidateNodeIds,
    forcedOffscreenNodeIds: forcedOffscreenImportNodeIds,
    viewport: visibilityViewport,
    containerSize: canvasViewportSize,
    precomputedVisibility: scheduledVisibleNodes,
    recentlyInteractedNodeIds: recentInteractedImageNodeIds,
    importingNodeIds: importingImageNodeIds,
    freezeComputedVisibility: isDragLoadSheddingActive,
  });
  useEffect(() => {
    let visibleImportingImageNodeCount = 0;
    importingImageNodeIds.forEach((nodeId) => {
      const visibility = visibleNodes.get(nodeId);
      if (visibility?.isVisible || visibility?.isNearViewport) {
        visibleImportingImageNodeCount += 1;
      }
    });

    importPressureRef.current = {
      visibleImportingImageNodeCount,
      importingImageNodeCount: importingImageNodeIds.length,
      isViewportDragging,
    };
  }, [importingImageNodeIds, isViewportDragging, visibleNodes]);
  const contextTargetNodeId = useMemo(() => (
    contextMenu.isVisible && (
      contextMenu.context &&
      typeof contextMenu.context === 'object' &&
      'type' in contextMenu.context &&
      'nodeId' in contextMenu.context &&
      (contextMenu.context as { type?: unknown }).type === 'node' &&
      typeof (contextMenu.context as { nodeId?: unknown }).nodeId === 'string'
    )
      ? (contextMenu.context as { nodeId: string }).nodeId
      : null
  ), [contextMenu.context, contextMenu.isVisible]);

  const draggingNodeIds = useMemo(() => new Set(dragPreview?.nodeIds ?? []), [dragPreview]);
  const canvasFileNodes = useMemo(
    () => nodes.filter((node): node is FlowNode & { data: FileNodeData } => isFileNodeData(node.data)),
    [nodes],
  );
  const canvasActiveEntries = useMemo(
    () => nodes.map((node): readonly [string, CanvasActiveNodeStateSnapshot] => {
      const isImageNode = isFileNodeData(node.data) && node.data.type === 'image';
      return [
        node.id,
        resolveCanvasActiveNodeState({
          selected: !isImageNode && node.selected,
          hovered: hoveredNodeId === node.id,
          dragging: draggingNodeIds.has(node.id),
          contextMenuTarget: contextTargetNodeId === node.id,
          importError: isFileNodeData(node.data) && node.data.status === 'error',
        }),
      ];
    }),
    [contextTargetNodeId, draggingNodeIds, hoveredNodeId, nodes],
  );
  const canvasActiveEntriesByNodeId = useMemo(
    () => new Map(canvasActiveEntries),
    [canvasActiveEntries],
  );
  const localVisualRevision = useCanvasRuntimeVisualLocalRevision();
  const isDomWindowingVisibilityFresh = useMemo(() => (
    isVisibleNodeSnapshotFresh(scheduledVisibleNodes, {
      viewport: visibilityViewport,
      nodesVersion,
      containerSize: canvasViewportSize,
    }) &&
    areVisibleNodeMapsEqual(scheduledVisibleNodes.visibleNodes, visibleNodes)
  ), [canvasViewportSize, nodesVersion, scheduledVisibleNodes, visibilityViewport, visibleNodes]);
  // CanvasRenderPlan is the single owner for full/proxy/placeholder nodes,
  // hidden edges, and raster eligibility. React Flow only receives the plan.
  const renderPlan = useMemo(() => {
    const nextRenderPlan = buildCanvasRenderPlan({
      nodes,
      edges,
      visibleNodes,
      activeNodeStates: canvasActiveEntriesByNodeId,
      visibilityFresh: isDomWindowingVisibilityFresh,
      runtimeVisualRevision: localVisualRevision,
      placeholderNodeType: CANVAS_DOM_WINDOW_PLACEHOLDER_NODE_TYPE,
      previousCache: renderPlanCacheRef.current,
    });
    renderPlanCacheRef.current = nextRenderPlan.cache;
    return nextRenderPlan;
  }, [canvasActiveEntriesByNodeId, edges, isDomWindowingVisibilityFresh, localVisualRevision, nodes, visibleNodes]);
  useEffect(() => {
    if (!getCanvasImageDiagnosticsConfig().enabled) {
      return;
    }

    recordCanvasRenderPlanMetric(renderPlan.diagnostics);
  }, [renderPlan.diagnostics]);
  useEffect(() => {
    detachedNodeIdsRef.current = renderPlan.detachedNodeIds;
    hiddenEdgeIdsRef.current = renderPlan.hiddenEdgeIds;
  }, [renderPlan.detachedNodeIds, renderPlan.hiddenEdgeIds]);
  const renderedNodes = renderPlan.renderedNodes;
  const renderedEdges = renderPlan.renderedEdges;

  useEffect(() => {
    if (isViewportDraggingRef.current) {
      return;
    }

    scheduleViewportImageWork(currentViewport);
  }, [
    canvasViewportSize,
    currentViewport,
    importingImageNodeIds,
    nodes,
    recentInteractedImageNodeIds,
    scheduleViewportImageWork,
  ]);

  useEffect(() => {
    if (!shouldRecordCanvasImageSessionDiagnostics()) {
      return;
    }

    let imageNodeCount = 0;
    let visibleNodeCount = 0;
    let nearViewportNodeCount = 0;

    nodes.forEach((node) => {
      if (isFileNodeData(node.data) && node.data.type === 'image') {
        imageNodeCount += 1;
      }

      const visibility = visibleNodes.get(node.id);
      if (!visibility) {
        return;
      }

      if (visibility.isVisible) {
        visibleNodeCount += 1;
      }

      if (visibility.isNearViewport) {
        nearViewportNodeCount += 1;
      }
    });

    recordCanvasImageSessionSnapshot({
      nodeCount: nodes.length,
      imageNodeCount,
      visibleNodeCount,
      nearViewportNodeCount,
      selectedNodeCount: nodes.filter((node) => node.selected).length,
      viewport: currentViewport,
      containerSize: canvasViewportSize,
      workflowId: workflowState.workflow?.id,
    });
  }, [canvasViewportSize, currentViewport, nodes, visibleNodes, workflowState.workflow?.id]);

  const activeImageNodeIdSet = useMemo(() => {
    const nextActiveImageNodeIds = new Set<string>();

    canvasFileNodes.forEach((node) => {
      if (node.data.type !== 'image') {
        return;
      }

      const isActive =
        hoveredNodeId === node.id ||
        draggingNodeIds.has(node.id) ||
        contextTargetNodeId === node.id;

      if (isActive) {
        nextActiveImageNodeIds.add(node.id);
      }
    });

    return nextActiveImageNodeIds;
  }, [canvasFileNodes, contextTargetNodeId, draggingNodeIds, hoveredNodeId]);

  useEffect(() => {
    const nextRenderTiers = new Map<string, 'full' | 'compact' | 'minimal'>();
    const nextRuntimeVisualEntries = new Map<string, {
      scheduledRenderTier: 'full' | 'compact' | 'minimal';
      canvasState: CanvasActiveNodeStateSnapshot;
    }>();
    canvasFileNodes.forEach((node) => {
      const scheduledRenderTier = renderPlan.nodeRenderTiers.get(node.id) ?? 'full';
      nextRenderTiers.set(node.id, scheduledRenderTier);
      const canvasState = canvasActiveEntriesByNodeId.get(node.id);
      if (canvasState) {
        nextRuntimeVisualEntries.set(node.id, {
          scheduledRenderTier,
          canvasState,
        });
      }
    });

    syncNodeRenderTierSnapshot(nextRenderTiers.entries());
    syncCanvasActiveNodeStateSnapshot(canvasActiveEntries);
    syncCanvasRuntimeVisualStateSnapshot(nextRuntimeVisualEntries.entries());
  }, [canvasActiveEntries, canvasActiveEntriesByNodeId, canvasFileNodes, renderPlan.nodeRenderTiers]);

  const onDragOver = useCallback((event: React.DragEvent): void => {
    event.preventDefault();
    if (hasTaskHistoryArtifactDragPayload(event.dataTransfer) || event.dataTransfer.types.includes('Files')) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onDrop = useCallback((event: React.DragEvent): void => {
    event.preventDefault();
    contextMenu.hide();

    const artifactPayload = readTaskHistoryArtifactDragPayload(event.dataTransfer);
    if (artifactPayload) {
      const flowPosition = getFlowPositionFromClient(event.clientX, event.clientY);
      const nextNode = createFileNodeFromTaskHistoryArtifact(
        artifactPayload,
        getNextNodeId(),
        flowPosition,
      );
      appendNodes([nextNode], {
        reason: 'task-history-artifact-drop',
      });
      return;
    }

    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0) {
      return;
    }

    const flowPosition = getFlowPositionFromClient(event.clientX, event.clientY);
    void importFilesToCanvas(files.map((file) => ({ file })), flowPosition);
  }, [appendNodes, contextMenu, getFlowPositionFromClient, getNextNodeId, importFilesToCanvas]);

  const scheduleSyncFromInstance = useCallback((options: CanvasRuntimeSyncMetricOptions = {}) => {
    if (hasPendingExternalHydration(options.force)) {
      return;
    }

    requestAnimationFrame(() => {
      if (hasPendingExternalHydration(options.force)) {
        return;
      }

      syncFromInstance(options);
    });
  }, [hasPendingExternalHydration, syncFromInstance]);

  const queueDragPreviewOffset = useCallback((offset: Position): void => {
    pendingDragOffsetRef.current = offset;

    if (dragPreviewFrameRef.current !== null) {
      return;
    }

    dragPreviewFrameRef.current = requestAnimationFrame(() => {
      dragPreviewFrameRef.current = null;
      const nextOffset = pendingDragOffsetRef.current;
      pendingDragOffsetRef.current = null;

      if (!nextOffset) {
        return;
      }

      setDragPreview((current) => {
        if (!current) {
          return current;
        }

        if (current.offset.x === nextOffset.x && current.offset.y === nextOffset.y) {
          return current;
        }

        return {
          ...current,
          offset: nextOffset,
        };
      });
    });
  }, []);

  const createDragPreviewState = useCallback((anchorId: string, draggedNodes: Node[]): DragPreviewState | null => {
    const draggedNodeIds = draggedNodes.map((node) => node.id);
    if (draggedNodeIds.length === 0) {
      return null;
    }

    const nodeMap = new Map(nodesRef.current.map((node) => [node.id, node]));
    const sourceNodes = draggedNodeIds
      .map((nodeId) => nodeMap.get(nodeId))
      .filter((node): node is FlowNode => Boolean(node));

    if (sourceNodes.length === 0) {
      return null;
    }

    const getDragPreviewDimensions = (node: FlowNode): { width: number; height: number } => {
      const fallbackWidth = Math.max(1, node.width ?? node.data.dimensions.width);
      const fallbackHeight = Math.max(1, node.height ?? node.data.dimensions.height);

      if (!reactFlowInstance.current || !canvasContainerRef.current) {
        return {
          width: fallbackWidth,
          height: fallbackHeight,
        };
      }

      const escapedNodeId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(node.id)
        : node.id.replace(/"/g, '\\"');
      const nodeElement = canvasContainerRef.current.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${escapedNodeId}"]`
      );

      if (!nodeElement) {
        return {
          width: fallbackWidth,
          height: fallbackHeight,
        };
      }

      const rect = nodeElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return {
          width: fallbackWidth,
          height: fallbackHeight,
        };
      }

      const zoom = reactFlowInstance.current.getZoom();
      return {
        width: Math.max(1, rect.width / zoom),
        height: Math.max(1, rect.height / zoom),
      };
    };

    const previewItems = sourceNodes.map((node) => {
      const dimensions = getDragPreviewDimensions(node);
      return {
        id: node.id,
        position: { ...node.position },
        width: dimensions.width,
        height: dimensions.height,
      };
    });

    const anchorNode = sourceNodes.find((node) => node.id === anchorId) ?? sourceNodes[0];
    const positions = previewItems.map((item) => ({
      x: item.position.x,
      y: item.position.y,
      width: item.width,
      height: item.height,
    }));

    const minX = Math.min(...positions.map((item) => item.x));
    const minY = Math.min(...positions.map((item) => item.y));
    const maxX = Math.max(...positions.map((item) => item.x + item.width));
    const maxY = Math.max(...positions.map((item) => item.y + item.height));

    return {
      anchorId: anchorNode.id,
      anchorStart: { ...anchorNode.position },
      nodeIds: sourceNodes.map((node) => node.id),
      offset: { x: 0, y: 0 },
      bounds: {
        minX,
        minY,
        width: Math.max(1, maxX - minX),
        height: Math.max(1, maxY - minY),
      },
      items: previewItems,
    };
  }, []);

  const handleDragPreviewStart = useCallback((anchorId: string, draggedNodes: Node[]): void => {
    const nextPreview = createDragPreviewState(anchorId, draggedNodes);
    if (!nextPreview) {
      return;
    }

    if (isImportingActive) {
      pauseImportDragLoadShedding();
    }
    setDragPreview(nextPreview);
  }, [createDragPreviewState, isImportingActive, pauseImportDragLoadShedding]);

  const handleDragPreviewMove = useCallback((anchorId: string, currentPosition: Position): void => {
    const currentPreview = dragPreviewRef.current;

    if (!currentPreview || currentPreview.anchorId !== anchorId) {
      return;
    }

    queueDragPreviewOffset({
      x: currentPosition.x - currentPreview.anchorStart.x,
      y: currentPosition.y - currentPreview.anchorStart.y,
    });
  }, [queueDragPreviewOffset]);

  const commitDragPreview = useCallback((clientPosition?: { x: number; y: number }, keyboardState?: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void => {
    const currentPreview = dragPreviewRef.current;

    if (!currentPreview) {
      scheduleSyncFromInstance();
      return;
    }

    if (dragPreviewFrameRef.current !== null) {
      cancelAnimationFrame(dragPreviewFrameRef.current);
      dragPreviewFrameRef.current = null;
    }

    pendingDragOffsetRef.current = null;

    const draggedNodes = currentPreview.nodeIds
      .map((nodeId) => nodesRef.current.find((node) => node.id === nodeId))
      .filter((node): node is FlowNode => Boolean(node));
    const draggedNodeIds = new Set(currentPreview.nodeIds);

    if (clientPosition) {
      const resolution = findDropTarget(clientPosition.x, clientPosition.y, draggedNodeIds);
      const dropTarget = resolution?.dropTarget;

      if (dropTarget && workflowState.workflow) {
        const targetNode = nodesRef.current.find((node) => node.id === dropTarget.nodeId);
        const definition = targetNode && isAINodeData(targetNode.data)
          ? getNodeDefinition(targetNode.data.type)
          : null;
        const draggedNodeData = draggedNodes.map((node) => node.data);
        const dropAdapter = definition?.drop;
        const customDropAdapter = isCustomNodeDropCapability(dropAdapter)
          ? dropAdapter
          : null;
        const canHandleDrop = Boolean(customDropAdapter?.acceptDraggedNodes(draggedNodeData));
        if (canHandleDrop && customDropAdapter) {
          const dropContext = createDropTargetContext(
            workflowState.workflow,
            dropTarget,
            draggedNodeData,
            keyboardState
          );
          const dropPlan = customDropAdapter.buildPlan(dropContext);
          const validation = customDropAdapter.validateTarget(dropContext);

        setDragPreview(null);

        if (dropPlan) {
          const nextNode: FlowNode = {
            ...targetNode!,
            data: dropPlan.nextTargetNode,
            position: dropPlan.nextTargetNode.position,
          };
          const nextEdges = dropPlan.nextConnections.map((item) => createReactFlowEdge(item));
          replaceNode(nextNode, false);
          updateEdgesLocally(nextEdges, false);
          syncReactFlowStateToWorkflow(nodesRef.current, nextEdges);
        } else if (validation && !validation.valid) {
          notification.showWarning('挂载失败', validation.reason ?? '无法完成当前挂载操作。');
        } else {
          syncReactFlowStateToWorkflow(nodesRef.current, edgesRef.current);
        }
        return;
        }
      }
    }

    const nodeOffsetMap = new Map(
      currentPreview.items.map((item) => [item.id, item.position])
    );
    const nextNodes = nodesRef.current.map((node) => {
      const initialPosition = nodeOffsetMap.get(node.id);
      if (!initialPosition) {
        return node;
      }

      const nextPosition = {
        x: initialPosition.x + currentPreview.offset.x,
        y: initialPosition.y + currentPreview.offset.y,
      };

      return {
        ...node,
        position: nextPosition,
        data: {
          ...node.data,
          position: nextPosition,
          timestamp: {
            ...node.data.timestamp,
            updated: Date.now(),
          },
        },
      };
    });

    setDragPreview(null);
    replaceNodes(nextNodes, false);
    syncReactFlowStateToWorkflow(nextNodes, edgesRef.current);
  }, [findDropTarget, notification, replaceNode, replaceNodes, scheduleSyncFromInstance, syncReactFlowStateToWorkflow, updateEdgesLocally, workflowState.workflow]);

  const handleNodesChange = useCallback<OnNodesChange>((changes: NodeChange[]) => {
    const currentPreview = dragPreviewRef.current;
    const filteredChanges = currentPreview
      ? changes.filter((change) => !(change.type === 'position' && currentPreview.nodeIds.includes(change.id)))
      : changes;

    onNodesChangeInternal(filteredChanges);

    const shouldSync = !currentPreview && changes.some((change) =>
      change.type === 'remove' ||
      (change.type === 'position' && change.dragging === false)
    );

    if (shouldSync) {
      scheduleSyncFromInstance({
        reason: changes.some((change) => change.type === 'remove')
          ? 'canvas-node-remove'
          : 'canvas-node-position-commit',
        allowNodeShrink: changes.some((change) => change.type === 'remove'),
      });
    }
  }, [onNodesChangeInternal, scheduleSyncFromInstance]);

  const handleEdgesChange = useCallback<OnEdgesChange>((changes: EdgeChange[]) => {
    const removedEdgeIds = changes
      .filter((change): change is EdgeChange & { id: string; type: 'remove' } => change.type === 'remove')
      .map((change) => change.id);

    if (removedEdgeIds.length > 0) {
      applyCanvasEdgeRemoval(removedEdgeIds);
      return;
    }

    onEdgesChangeInternal(changes);
  }, [applyCanvasEdgeRemoval, onEdgesChangeInternal]);

  const handleNodeDragStop = useCallback((event?: ReactMouseEvent | ReactTouchEvent) => {
    const clientPosition = event && 'clientX' in event && 'clientY' in event
      ? { x: event.clientX, y: event.clientY }
      : undefined;
    const keyboardState = event && 'shiftKey' in event
      ? { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey }
      : undefined;

    commitDragPreview(clientPosition, keyboardState);
    clearNodeDropzoneHighlight();
    dragPreviewRef.current?.nodeIds.forEach((nodeId) => markRecentImageInteraction(nodeId));
    if (isImportingActive) {
      resumeImportDragLoadShedding('limited');
    } else {
      flushPendingImportProgress();
    }
  }, [
    clearNodeDropzoneHighlight,
    commitDragPreview,
    flushPendingImportProgress,
    isImportingActive,
    markRecentImageInteraction,
    resumeImportDragLoadShedding,
  ]);

  const getReactFlowMinimapNodeColor = useCallback((node: Node): string => {
    const typeColors: Record<string, string> = {
      image: '#3b82f6',
      video: '#8b5cf6',
      ply: '#10b981',
      aiImageGen: '#ec4899',
      aiVideoGen: '#06b6d4',
      aiImageToPly: '#14b8a6',
      aiMultiViewRestore: '#7c3aed',
      aiModelRenderTransfer: '#f59e0b',
      aiImageHd: '#0ea5e9',
    };
    const sourceType = isFileNodeData(node.data) || isAINodeData(node.data)
      ? node.data.type
      : node.type;
    return typeColors[sourceType || ''] || '#3b82f6';
  }, []);

  const dragPreviewStyle = useMemo<CSSProperties | null>(() => {
    if (!dragPreview || !reactFlowInstance.current || !canvasContainerRef.current) {
      return null;
    }

    const zoom = reactFlowInstance.current.getZoom();
    const containerRect = canvasContainerRef.current.getBoundingClientRect();
    const screenPosition = reactFlowInstance.current.flowToScreenPosition({
      x: dragPreview.bounds.minX + dragPreview.offset.x,
      y: dragPreview.bounds.minY + dragPreview.offset.y,
    });

    return {
      width: dragPreview.bounds.width,
      height: dragPreview.bounds.height,
      transform: `translate(${screenPosition.x - containerRect.left}px, ${screenPosition.y - containerRect.top}px) scale(${zoom})`,
      transformOrigin: 'top left',
    };
  }, [dragPreview]);

  const importProgressProcessed = getCanvasImportProgressProcessed(importProgress);
  const importProgressPercent = getCanvasImportProgressPercent(importProgress);
  const taskHistoryPanelWidth = showTaskHistory ? TASK_HISTORY_PANEL_EXPANDED_WIDTH : 0;
  const topRightStackStyle = useMemo<CSSProperties>(() => ({
    top: showToolbar ? 84 : 20,
    right: taskHistoryPanelWidth + 16,
  }), [showToolbar, taskHistoryPanelWidth]);
  const bottomLeftStackStyle = useMemo<CSSProperties>(() => ({
    left: 72,
  }), []);
  const taskHistoryTopOffset = showToolbar ? 84 : 20;
  const selectedNodeCount = useMemo(
    () => nodes.filter((node) => node.selected).length,
    [nodes]
  );
  const canvasHintMode = useMemo(() => {
    if (importProgress?.status === 'running') {
      return 'drag-import';
    }

    if (isConnecting) {
      return 'connecting';
    }

    if (dragPreview) {
      return dragPreview.items.length > 1 ? 'multi-select' : 'selection';
    }

    if (selectedNodeCount > 1) {
      return 'multi-select';
    }

    if (selectedNodeCount === 1) {
      return 'selection';
    }

    return 'idle';
  }, [dragPreview, importProgress?.status, isConnecting, selectedNodeCount]);
  const nodeRuntimeBindings = useMemo(() => ({
    workflowId: workflowState.workflow?.id ?? null,
    actions,
    selectors,
    runtime: {
      notification,
    },
  }), [actions, notification, selectors, workflowState.workflow?.id]);

  return (
    <div
      ref={canvasContainerRef}
      className={[
        'canvas-container',
        isBoxSelecting ? 'canvas-container--box-selecting' : '',
      ].filter(Boolean).join(' ')}
      data-box-selecting={isBoxSelecting ? 'true' : 'false'}
      onDoubleClickCapture={onCanvasContainerDoubleClickCapture}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <input ref={fileInputRef} type="file" hidden multiple onChange={handleFileInputChange} />

      <CanvasNodeRuntimeBindingsProvider value={nodeRuntimeBindings}>
        <ReactFlow
          nodes={renderedNodes}
          edges={renderedEdges}
          // Keep React Flow's internal clipping disabled; CanvasRenderPlan owns visibility.
          onlyRenderVisibleElements={false}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onNodeDragStart={(_, node, draggingNodes) => handleDragPreviewStart(node.id, draggingNodes)}
          onNodeDrag={(event, node) => {
            handleDragPreviewMove(node.id, node.position);

            const clientPosition = 'clientX' in event && 'clientY' in event
              ? { x: event.clientX, y: event.clientY }
              : undefined;

            if (!clientPosition) {
              clearNodeDropzoneHighlight();
              return;
            }

            const draggedNodes = dragPreviewRef.current?.nodeIds
              .map((nodeId) => nodesRef.current.find((item) => item.id === nodeId))
              .filter((item): item is FlowNode => Boolean(item)) ?? [];

            const shouldAttemptHighlight = draggedNodes.length > 0 && draggedNodes.every(
              (draggedNode) => isFileNodeData(draggedNode.data) && draggedNode.data.type === 'image'
            );

            if (!shouldAttemptHighlight) {
              clearNodeDropzoneHighlight();
              return;
            }

            updateNodeDropzoneHighlight(clientPosition, draggedNodes, {
              shiftKey: event.shiftKey,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
            });
          }}
          onNodeDragStop={handleNodeDragStop}
          onSelectionDragStart={(_, draggingNodes) => {
            const anchorNode = draggingNodes[0];
            if (anchorNode) {
              handleDragPreviewStart(anchorNode.id, draggingNodes);
            }
          }}
          onSelectionDrag={(event, draggingNodes) => {
            const currentPreview = dragPreviewRef.current;
            if (!currentPreview) {
              return;
            }

            const anchorNode = draggingNodes.find((node) => node.id === currentPreview.anchorId) ?? draggingNodes[0];
            if (anchorNode) {
              handleDragPreviewMove(anchorNode.id, anchorNode.position);
            }

            const clientPosition = 'clientX' in event && 'clientY' in event
              ? { x: event.clientX, y: event.clientY }
              : undefined;
            const draggedFlowNodes = draggingNodes
              .map((node) => nodesRef.current.find((item) => item.id === node.id))
              .filter((item): item is FlowNode => Boolean(item));
            const shouldAttemptHighlight = draggedFlowNodes.length > 0 && draggedFlowNodes.every(
              (draggedNode) => isFileNodeData(draggedNode.data) && draggedNode.data.type === 'image'
            );

            if (!clientPosition || !shouldAttemptHighlight) {
              clearNodeDropzoneHighlight();
              return;
            }

            updateNodeDropzoneHighlight(clientPosition, draggedFlowNodes, {
              shiftKey: event.shiftKey,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
            });
          }}
          onSelectionDragStop={handleNodeDragStop}
          onSelectionStart={handleBoxSelectionStart}
          onSelectionEnd={handleBoxSelectionEnd}
          onConnect={onConnect}
          onConnectStart={() => setIsConnecting(true)}
          onConnectEnd={() => setIsConnecting(false)}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeContextMenu={onNodeContextMenu}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onPaneClick={onPaneClick}
          onPaneContextMenu={onPaneContextMenu}
          onMoveStart={onMoveStart}
          onMove={onMove}
          onMoveEnd={onMoveEnd}
          onInit={onInit}
          nodeTypes={nodeTypes}
          connectionLineType={WORKFLOW_CONNECTION_LINE_TYPE}
          connectionLineStyle={WORKFLOW_CONNECTION_LINE_STYLE}
          minZoom={CANVAS_DEFAULTS.minZoom}
          maxZoom={CANVAS_DEFAULTS.maxZoom}
          defaultViewport={REACT_FLOW_DEFAULT_VIEWPORT}
          fitView={false}
          deleteKeyCode={null}
          zoomOnScroll
          zoomOnPinch
          zoomActivationKeyCode="Control"
          zoomOnDoubleClick={false}
          panOnScroll={false}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={REACT_FLOW_PAN_ON_DRAG}
          selectNodesOnDrag={false}
          proOptions={REACT_FLOW_PRO_OPTIONS}
          style={REACT_FLOW_STYLE}
        >
        <Background variant={BackgroundVariant.Cross} gap={50} size={2} color="#3f3f46" />
        <CanvasImageRasterLayer
          renderPlan={renderPlan}
          visibleNodes={visibleNodes}
          activeImageNodeIdSet={activeImageNodeIdSet}
          canvasSize={canvasViewportSize}
          dragRenderState={{
            isDragging: isViewportDragging,
            anchorViewport: dragRasterAnchorViewport,
          }}
        />

        {showMinimap && !isMinimapCollapsed && (
          <div
            className={[
              'minimap-wrapper',
              isMinimapDragging ? 'minimap-wrapper--dragging' : '',
              isMinimapResizing ? 'minimap-wrapper--resizing' : '',
            ].filter(Boolean).join(' ')}
            style={{
              position: 'absolute',
              bottom: minimapPosition.bottom,
              right: minimapPosition.right,
              width: minimapSize.width,
              height: minimapSize.height,
            }}
          >
            <div
              className="minimap-handle"
              onPointerDown={handleMinimapDragStart}
              title="拖拽导航图"
            >
              <span className="minimap-handle__dot" />
              <span className="minimap-handle__dot" />
              <span className="minimap-handle__dot" />
              <span className="minimap-handle__dot" />
            </div>
            <button
              className="minimap-control-btn minimap-control-btn--collapse"
              onPointerDown={stopMinimapControlPointerDown}
              onClick={toggleReactFlowMinimapVisibility}
              title="折叠导航图"
              type="button"
            >
              {'-'}
            </button>
            <MiniMap
              position="top-left"
              className="minimap-panel"
              nodeColor={getReactFlowMinimapNodeColor}
              nodeStrokeWidth={3}
              zoomable
              pannable
              style={reactFlowMinimapStyle}
              maskColor="rgba(0, 0, 0, 0.7)"
              onNodeClick={handleReactFlowMinimapNodeClick}
            />
            <div
              className="minimap-resize-handle"
              onPointerDown={handleMinimapResizeStart}
              title="缩放导航图"
            >
              <span className="minimap-resize-handle__corner" />
            </div>
          </div>
        )}

        {showMinimap && isMinimapCollapsed && (
          <button
            className={[
              'minimap-toggle-btn',
              isMinimapDragging ? 'minimap-toggle-btn--dragging' : '',
            ].filter(Boolean).join(' ')}
            style={{ bottom: minimapPosition.bottom, right: minimapPosition.right }}
            onClick={handleMinimapCollapsedClick}
            onPointerDown={(event) => {
              stopMinimapControlPointerDown(event);
              handleMinimapDragStart(event);
            }}
            title="显示导航图"
            type="button"
          >
            {'M'}
          </button>
        )}
        </ReactFlow>
      </CanvasNodeRuntimeBindingsProvider>

      {dragPreview && dragPreviewStyle && (
        <div className="canvas-drag-preview-layer">
          <div className="canvas-drag-preview" style={dragPreviewStyle}>
            {dragPreview.items.map((item) => (
              <div
                key={item.id}
                className="canvas-drag-preview__item"
                style={{
                  left: item.position.x - dragPreview.bounds.minX,
                  top: item.position.y - dragPreview.bounds.minY,
                  width: item.width,
                  height: item.height,
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="canvas-bottom-left-stack" style={bottomLeftStackStyle}>
        <CanvasPerformanceTracePanel />
        {runtime.notification.visibleNotifications.length > 0 && (
          <NotificationContainer
            className="notification-container--canvas-stack"
            notifications={runtime.notification.visibleNotifications}
            onHide={runtime.notification.hide}
          />
        )}
        {showHints && <CanvasActionHints mode={canvasHintMode} />}
      </div>

      {showTaskHistory && (
        <CanvasTaskHistoryPanel
          workflowId={workflowState.workflow?.id ?? null}
          items={workflowState.taskHistory}
          topOffset={taskHistoryTopOffset}
          isCollapsed={false}
          showToggle={false}
        />
      )}

      {importProgress && (
        <div className="canvas-top-right-stack" style={topRightStackStyle}>
          {importProgress && (
            <div className={`canvas-import-progress canvas-import-progress--${importProgress.status}`}>
              <div className="canvas-import-progress__header">
                <div className="canvas-import-progress__title">
                  {importProgress.status === 'running' ? '正在导入文件' : '导入完成'}
                </div>
                <button
                  type="button"
                  className="canvas-import-progress__close"
                  aria-label="关闭导入提示"
                  title="关闭"
                  onClick={() => {
                    dismissImportProgress(importProgress.batchId);
                  }}
                >
                  ×
                </button>
              </div>
              <div className="canvas-import-progress__meta">
                <span>{importProgress.message}</span>
                <span>{importProgressProcessed} / {importProgress.total}</span>
              </div>
              <div className="canvas-import-progress__bar">
                <div
                  className="canvas-import-progress__bar-fill"
                  style={{ width: `${importProgressPercent}%` }}
                />
              </div>
              <div className="canvas-import-progress__summary">
                成功 {importProgress.completed}
                {importProgress.failed > 0 ? ` · 失败 ${importProgress.failed}` : ''}
              </div>
            </div>
          )}
        </div>
      )}

      {runtime.contextMenu.isVisible && (
        <ContextMenu
          x={runtime.contextMenu.position.x}
          y={runtime.contextMenu.position.y}
          items={runtime.contextMenu.actions as ContextMenuItem[]}
          onClose={runtime.contextMenu.hide}
        />
      )}

      <FileNodePropertyDialog
        node={propertyDialogNode}
        isOpen={propertyDialogNode !== null}
        onClose={closePropertyDialog}
        onRebindLocalFile={handleRebindPropertyDialogFile}
      />
      <ImageGridSplitDialog
        isOpen={imageGridSplitDialogNode !== null}
        fileName={imageGridSplitDialogNode?.fileName}
        isProcessing={isSplittingImageGrid}
        onClose={closeImageGridSplitDialog}
        onConfirm={confirmCustomImageGridSplit}
      />
    </div>
  );
});

CanvasInner.displayName = 'CanvasInner';

export const Canvas = (props: CanvasProps): JSX.Element => {
  return (
    <ErrorBoundary moduleName="canvas">
      <CanvasInner {...props} />
    </ErrorBoundary>
  );
};

Canvas.displayName = 'Canvas';

