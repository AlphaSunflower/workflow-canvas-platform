import test from 'node:test';
import assert from 'node:assert/strict';

import type { Workflow } from '@/types';
import type { WorkflowRuntimeSnapshot } from '@/contracts/workflow';
import {
  bindCanvasRuntimeSyncFlushDelegate,
  type CanvasRuntimeSyncFlushRequest,
} from './canvas-runtime-sync-flush';
import { createWorkflowProviderActionSource } from '@/components/context/workflow-provider-sources';

function createWorkflow(): Workflow {
  const now = 1_778_000_000_000;
  return {
    id: 'workflow-structure-sync-1',
    projectId: 'project-1',
    name: 'structure-sync',
    nodes: {},
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 0,
      connectionCount: 0,
      lastNodeId: 0,
      canvasSize: {
        width: 1920,
        height: 1080,
      },
      relatedTasks: [],
      usedNodeIds: [],
      releasedNodeIds: [],
    },
    timestamp: {
      created: now,
      updated: now,
    },
    persistenceState: 'draft',
    hasMaterializedCanvas: true,
    groupId: null,
    workflowGroupId: null,
    isAutoNamed: false,
  };
}

function createRuntimeSnapshot(): WorkflowRuntimeSnapshot {
  return {
    nodes: {},
    connections: [],
    viewport: { x: 24, y: 32, zoom: 0.85 },
    metadata: {
      nodeCount: 0,
      connectionCount: 0,
      relatedTasks: [],
    },
  };
}

test('workflow provider syncRuntimeSnapshot delegates structural writes through the canvas flush channel', () => {
  const currentWorkflow = createWorkflow();
  const runtimeSnapshot = createRuntimeSnapshot();
  const flushedWorkflow = {
    ...currentWorkflow,
    viewport: runtimeSnapshot.viewport,
    timestamp: {
      ...currentWorkflow.timestamp,
      updated: currentWorkflow.timestamp.updated + 1,
    },
  };
  const flushCalls: CanvasRuntimeSyncFlushRequest[] = [];
  const unbind = bindCanvasRuntimeSyncFlushDelegate((request) => {
    flushCalls.push(request ?? {});
    return flushedWorkflow;
  });

  try {
    const actions = createWorkflowProviderActionSource({
      lifecycleActions: {
        createWorkflow: () => currentWorkflow,
        loadWorkflow: () => undefined,
        refreshWorkflow: async () => undefined,
      },
      workflowActions: {
        patchCurrentWorkflow: () => currentWorkflow,
        resetWorkflow: () => undefined,
        markDirty: () => undefined,
        markClean: () => undefined,
        getCurrentWorkflow: () => currentWorkflow,
        applyRuntimeSnapshot: () => currentWorkflow,
      },
      persistenceActions: {
        confirmBeforeWorkflowSwitch: async () => true,
        ensureMaterializedWorkflow: async () => currentWorkflow,
        saveWorkflow: async () => undefined,
      },
      fileActions: {
        exportLocalArchive: async () => undefined,
        importLocalArchive: async () => undefined,
        exportFileNode: async () => undefined,
        rebindLocalFileNodeSource: async () => null,
      },
      executionActions: {
        optimizeAIImageGenPrompt: async () => undefined,
        runNodeAction: async () => undefined,
        patchNodeConfig: () => currentWorkflow,
        runAINode: async () => undefined,
        cancelAINodeRun: async () => undefined,
      },
    });

    const nextWorkflow = actions.syncRuntimeSnapshot(runtimeSnapshot, {
      hydrateCanvas: true,
      runtimeSnapshotMeta: {
        source: 'canvas-edit',
        scope: 'canvas-sync',
        baseUpdatedAt: currentWorkflow.timestamp.updated,
        baseNodeCount: 0,
        baseConnectionCount: 0,
        allowNodeShrink: false,
      },
    });

    assert.equal(nextWorkflow, flushedWorkflow);
    assert.equal(flushCalls.length, 1);
    assert.equal(flushCalls[0]?.runtimeSnapshot, runtimeSnapshot);
    assert.equal(flushCalls[0]?.reason, 'canvas-sync');
    assert.equal(flushCalls[0]?.force, true);
    assert.equal(flushCalls[0]?.allowNodeShrink, false);
    assert.equal(flushCalls[0]?.runtimeSyncOptions?.runtimeSnapshotMeta?.source, 'canvas-edit');
  } finally {
    unbind();
  }
});

test('workflow provider syncRuntimeSnapshot falls back to current workflow when no canvas flush delegate is bound', () => {
  const currentWorkflow = createWorkflow();
  const actions = createWorkflowProviderActionSource({
    lifecycleActions: {
      createWorkflow: () => currentWorkflow,
      loadWorkflow: () => undefined,
      refreshWorkflow: async () => undefined,
    },
    workflowActions: {
      patchCurrentWorkflow: () => currentWorkflow,
      resetWorkflow: () => undefined,
      markDirty: () => undefined,
      markClean: () => undefined,
      getCurrentWorkflow: () => currentWorkflow,
      applyRuntimeSnapshot: () => currentWorkflow,
    },
    persistenceActions: {
      confirmBeforeWorkflowSwitch: async () => true,
      ensureMaterializedWorkflow: async () => currentWorkflow,
      saveWorkflow: async () => undefined,
    },
    fileActions: {
      exportLocalArchive: async () => undefined,
      importLocalArchive: async () => undefined,
      exportFileNode: async () => undefined,
      rebindLocalFileNodeSource: async () => null,
    },
    executionActions: {
      optimizeAIImageGenPrompt: async () => undefined,
      runNodeAction: async () => undefined,
      patchNodeConfig: () => currentWorkflow,
      runAINode: async () => undefined,
      cancelAINodeRun: async () => undefined,
    },
  });

  const nextWorkflow = actions.syncRuntimeSnapshot(createRuntimeSnapshot(), {
    runtimeSnapshotMeta: {
      source: 'canvas-edit',
      scope: 'canvas-sync',
    },
  });

  assert.equal(nextWorkflow, currentWorkflow);
});

async function readCanvasSource(): Promise<string> {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);

  return readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/Canvas.tsx`,
    'utf8',
  );
}

async function readNodeRenderersSource(): Promise<string> {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);

  return readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/node-renderers.tsx`,
    'utf8',
  );
}

async function readCanvasImportPipelineSource(): Promise<string> {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);

  return readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/useCanvasImportPipeline.ts`,
    'utf8',
  );
}

async function readManualCheckSource(fileName: string): Promise<string> {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);

  return readFileSync(
    `${processLike.process?.cwd() ?? '.'}/tests/manual/${fileName}`,
    'utf8',
  );
}

async function readArchitectureRulesSource(): Promise<string> {
  const fsSpecifier = 'node:fs';
  const pathSpecifier = 'node:path';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const path = await import(pathSpecifier);

  return readFileSync(
    path.resolve(processLike.process?.cwd() ?? '.', '../docs/architecture-layer-rules.md'),
    'utf8',
  );
}

test('canvas viewport drag end schedules viewport workflow sync outside import runs', async () => {
  const canvasSource = await readCanvasSource();
  const onMoveEndBlock = canvasSource.slice(
    canvasSource.indexOf('const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {'),
    canvasSource.indexOf('  const onInit = useCallback(', canvasSource.indexOf('const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {')),
  );

  assert.equal(onMoveEndBlock.includes('scheduleViewportSync(viewport);'), true);
  assert.equal(onMoveEndBlock.includes("reason: importing ? 'viewport-drag-end-importing' : 'canvas-viewport-drag-end',"), true);
  assert.equal(onMoveEndBlock.includes('scheduleWorkflowSync({'), true);
  assert.equal(onMoveEndBlock.includes('syncViewportOnlyToWorkflow(viewport, {'), false);
  assert.equal(onMoveEndBlock.includes('syncReactFlowStateToWorkflow(nodesRef.current, edgesRef.current, viewport)'), false);
  assert.equal(onMoveEndBlock.includes("reason: 'viewport-drag-end-importing',"), false);
  assert.equal(onMoveEndBlock.includes('flushViewportImageWork(viewport);'), false);
  assert.equal(onMoveEndBlock.includes("phase: importing ? 'post-drag-importing' : 'post-drag',"), true);
  assert.equal(onMoveEndBlock.includes('onCommitted: recordMoveEndAfterImageWork'), true);
  assert.equal(onMoveEndBlock.includes('flushViewportSync(viewport);'), false);
  assert.ok(
    onMoveEndBlock.indexOf('cancelDragVisibility();') <
      onMoveEndBlock.indexOf('scheduleViewportSync(viewport);'),
  );
  assert.ok(
    onMoveEndBlock.indexOf('cancelDragVisibility();') <
      onMoveEndBlock.indexOf('scheduleViewportImageWork(viewport, {'),
  );
});

test('canvas drag release defers image work and workflow sync into staged commits', async () => {
  const canvasSource = await readCanvasSource();
  const onMoveEndBlock = canvasSource.slice(
    canvasSource.indexOf('const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {'),
    canvasSource.indexOf('  const onInit = useCallback(', canvasSource.indexOf('const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {')),
  );

  assert.equal(onMoveEndBlock.includes('flushViewportSync(viewport);'), false);
  assert.equal(onMoveEndBlock.includes('flushDragVisibility(buildDragVisibilityScheduleOptions(viewport, \'flush\'));'), false);
  assert.equal(onMoveEndBlock.includes('cancelDragVisibility();'), true);
  assert.equal(onMoveEndBlock.includes('flushViewportImageWork('), false);
  assert.equal(onMoveEndBlock.includes("phase: importing ? 'post-drag-importing' : 'post-drag',"), true);
  assert.equal(onMoveEndBlock.includes('onCommitted: recordMoveEndAfterImageWork'), true);
  assert.equal(onMoveEndBlock.includes('flushCanvasNodePatchQueue();'), false);
  assert.equal(onMoveEndBlock.includes('patchQueueFlushMs: 0,'), true);
  assert.equal(onMoveEndBlock.includes('viewportSyncMs: 0,'), true);
  assert.equal(onMoveEndBlock.includes('workflowViewportSyncMs: 0,'), true);
  assert.ok(
    onMoveEndBlock.indexOf('cancelDragVisibility();') <
      onMoveEndBlock.indexOf("phase: importing ? 'post-drag-importing' : 'post-drag',"),
  );
  assert.ok(
    onMoveEndBlock.indexOf('scheduleWorkflowSync({') <
      onMoveEndBlock.indexOf("phase: importing ? 'post-drag-importing' : 'post-drag',"),
  );
});

test('canvas viewport-only workflow sync preserves authoritative structure', async () => {
  const canvasSource = await readCanvasSource();
  const syncViewportOnlyBlock = canvasSource.slice(
    canvasSource.indexOf('const syncViewportOnlyToWorkflow = useCallback(('),
    canvasSource.indexOf('  const syncReactFlowStateToWorkflow = useCallback((', canvasSource.indexOf('const syncViewportOnlyToWorkflow = useCallback((')),
  );

  assert.equal(syncViewportOnlyBlock.includes('const activeWorkflow = hydratedWorkflowRef.current ?? workflowState.workflow;'), true);
  assert.equal(syncViewportOnlyBlock.includes('nodes: activeWorkflow.nodes,'), true);
  assert.equal(syncViewportOnlyBlock.includes('connections: activeWorkflow.connections,'), true);
  assert.equal(syncViewportOnlyBlock.includes('viewport: nextViewport,'), true);
  assert.equal(syncViewportOnlyBlock.includes("reason: options.reason ?? 'canvas-viewport-sync',"), true);
  assert.equal(syncViewportOnlyBlock.includes('createWorkflowRuntimeSnapshot('), false);
});

test('canvas delegates visible-element clipping to render plan instead of ReactFlow', async () => {
  const canvasSource = await readCanvasSource();
  const reactFlowBlock = canvasSource.slice(
    canvasSource.indexOf('<ReactFlow'),
    canvasSource.indexOf('<Background', canvasSource.indexOf('<ReactFlow')),
  );
  const renderPlanBlock = canvasSource.slice(
    canvasSource.indexOf('const renderPlan = useMemo(() => {'),
    canvasSource.indexOf('  useEffect(() => {', canvasSource.indexOf('const renderPlan = useMemo(() => {')),
  );

  assert.equal(reactFlowBlock.includes('nodes={renderedNodes}'), true);
  assert.equal(reactFlowBlock.includes('edges={renderedEdges}'), true);
  assert.equal(reactFlowBlock.includes('onlyRenderVisibleElements={false}'), true);
  assert.equal(/onlyRenderVisibleElements=\{(?!false\})/.test(reactFlowBlock), false);
  assert.equal(
    canvasSource.includes('onlyRenderVisibleElements={!hasFloatingInpaintEditorNodes && !hasConnectedDynamicHandleNodes}'),
    false,
  );
  assert.equal(canvasSource.includes('hasFloatingInpaintEditorNodes'), false);
  assert.equal(canvasSource.includes('hasConnectedDynamicHandleNodes'), false);
  assert.equal(renderPlanBlock.includes('buildCanvasRenderPlan({'), true);
  assert.equal(renderPlanBlock.includes('visibleNodes,'), true);
  assert.equal(renderPlanBlock.includes('activeNodeStates: canvasActiveEntriesByNodeId,'), true);
  assert.equal(renderPlanBlock.includes('placeholderNodeType: CANVAS_DOM_WINDOW_PLACEHOLDER_NODE_TYPE,'), true);
  assert.equal(renderPlanBlock.includes('previousCache: renderPlanCacheRef.current,'), true);
  assert.equal(renderPlanBlock.includes('renderPlanCacheRef.current = nextRenderPlan.cache;'), true);
  assert.equal(canvasSource.includes('CanvasRenderPlan is the single owner'), true);
  assert.equal(canvasSource.includes('React Flow only receives the plan'), true);
  assert.equal(canvasSource.includes("React Flow's internal clipping disabled"), true);
  assert.equal(canvasSource.includes('const renderedNodes = renderPlan.renderedNodes;'), true);
  assert.equal(canvasSource.includes('const renderedEdges = renderPlan.renderedEdges;'), true);
  assert.equal(canvasSource.includes('detachedNodeIdsRef.current = renderPlan.detachedNodeIds;'), true);
  assert.equal(canvasSource.includes('renderPlan={renderPlan}'), true);
  assert.equal(canvasSource.includes('rasterEligibleImageNodes={renderPlan.rasterEligibleImageNodes}'), false);
  assert.equal(canvasSource.includes('imageNodeIds={renderPlan.imageNodeIds}'), false);
  assert.equal(canvasSource.includes('rasterEligibleNodeIds={renderPlan.rasterEligibleNodeIds}'), false);
  assert.equal(canvasSource.includes('nodes={nodes}'), false);
  assert.equal(canvasSource.includes('hidden: true,'), false);
});

test('canvas preserves render-plan hidden edges during instance sync', async () => {
  const canvasSource = await readCanvasSource();
  const syncFromInstanceBlock = canvasSource.slice(
    canvasSource.indexOf('  const syncFromInstance = useCallback((options: CanvasRuntimeSyncMetricOptions = {}): void => {'),
    canvasSource.indexOf('  useEffect(() => bindCanvasRuntimeSyncFlushDelegate', canvasSource.indexOf('  const syncFromInstance = useCallback((options: CanvasRuntimeSyncMetricOptions = {}): void => {')),
  );
  const reactFlowBlock = canvasSource.slice(
    canvasSource.indexOf('<ReactFlow'),
    canvasSource.indexOf('<Background', canvasSource.indexOf('<ReactFlow')),
  );

  assert.equal(reactFlowBlock.includes('edges={renderedEdges}'), true);
  assert.equal(canvasSource.includes('const renderedEdges = renderPlan.renderedEdges;'), true);
  assert.equal(syncFromInstanceBlock.includes('const preserveConnectionIds = new Set(hiddenEdgeIdsRef.current);'), true);
  assert.equal(syncFromInstanceBlock.includes('mergeWorkflowConnections('), true);
  assert.equal(syncFromInstanceBlock.includes('preserveConnectionIds,'), true);
  assert.equal(canvasSource.includes('hiddenEdgeIdsRef.current = renderPlan.hiddenEdgeIds;'), true);
  assert.equal(syncFromInstanceBlock.includes('hidden: true,'), false);
});

test('canvas syncs node render tiers from render plan instead of visible nodes', async () => {
  const canvasSource = await readCanvasSource();
  const runtimeVisualSyncBlock = canvasSource.slice(
    canvasSource.indexOf('  useEffect(() => {\n    const nextRenderTiers = new Map<string,'),
    canvasSource.indexOf('  const onDragOver = useCallback(', canvasSource.indexOf('  useEffect(() => {\n    const nextRenderTiers = new Map<string,')),
  );

  assert.equal(runtimeVisualSyncBlock.includes('const scheduledRenderTier = renderPlan.nodeRenderTiers.get(node.id) ?? \'full\';'), true);
  assert.equal(runtimeVisualSyncBlock.includes('const visibility = visibleNodes.get(node.id);'), false);
  assert.equal(runtimeVisualSyncBlock.includes('visibleNodes.get(node.id)?.renderTier'), false);
  assert.equal(runtimeVisualSyncBlock.includes('syncNodeRenderTierSnapshot(nextRenderTiers.entries());'), true);
  assert.equal(runtimeVisualSyncBlock.includes('syncCanvasRuntimeVisualStateSnapshot(nextRuntimeVisualEntries.entries());'), true);
});

test('image node renderer executes render plan tier instead of recomputing proxy routing', async () => {
  const rendererSource = await readNodeRenderersSource();
  const imageRouteBlock = rendererSource.slice(
    rendererSource.indexOf('const ImageNodeRoute = memo((props: FileNodeProps) => {'),
    rendererSource.indexOf('ImageNodeRoute.displayName =', rendererSource.indexOf('const ImageNodeRoute = memo((props: FileNodeProps) => {')),
  );

  assert.equal(imageRouteBlock.includes("const plannedRenderTier = props.data.renderTier ?? 'full';"), true);
  assert.equal(imageRouteBlock.includes("props.data.activeState === 'active'"), true);
  assert.equal(imageRouteBlock.includes('useCanvasRasterReadyNodeSrc(props.data.id.value)'), true);
  assert.equal(imageRouteBlock.includes('useCanvasImageFirstPainted(props.data.id.value, rasterReadySrc)'), true);
  assert.equal(imageRouteBlock.includes('const canUseRasterProxy = !requiresRasterReadyProxy || hasRasterFirstPainted;'), true);
  assert.equal(imageRouteBlock.includes('useCanvasRasterReadyNode(props.data.id.value)'), false);
  assert.equal(imageRouteBlock.includes("imageResourceOwner: 'dom'"), true);
  assert.equal(imageRouteBlock.includes('createElement(FileNodeProxy'), true);
  assert.equal(imageRouteBlock.includes('resolveImageNodeProxyRouting'), false);
  assert.equal(imageRouteBlock.includes('useCanvasRuntimeVisualState'), false);
});

test('canvas uses fresh scheduled visibility before viewport-only sync on drag end', async () => {
  const canvasSource = await readCanvasSource();
  const onMoveEndBlock = canvasSource.slice(
    canvasSource.indexOf('const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {'),
    canvasSource.indexOf('  const onInit = useCallback(', canvasSource.indexOf('const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {')),
  );

  assert.equal(onMoveEndBlock.includes('flushDragVisibility(buildDragVisibilityScheduleOptions(viewport, \'flush\'));'), false);
  assert.equal(onMoveEndBlock.includes('cancelDragVisibility();'), true);
  assert.equal(onMoveEndBlock.includes('flushViewportImageWork(viewport);'), false);
  assert.equal(onMoveEndBlock.includes('const recordMoveEndAfterImageWork = (metric: ViewportImageMetric): void => {'), true);
  assert.equal(onMoveEndBlock.includes('visibilityApplyMs: metric.applyMs,'), true);
  assert.equal(onMoveEndBlock.includes('resourceScheduleMs: imageWorkCompletedAt - metric.recordedAt,'), true);
  assert.equal(onMoveEndBlock.includes('patchQueueFlushMs: 0,'), true);
  assert.equal(onMoveEndBlock.includes('workflowViewportSyncMs: 0,'), true);
  assert.ok(
    onMoveEndBlock.indexOf('cancelDragVisibility();') <
      onMoveEndBlock.indexOf('scheduleViewportImageWork(viewport, {'),
  );
  assert.ok(
    onMoveEndBlock.indexOf('scheduleWorkflowSync({') <
      onMoveEndBlock.indexOf('const recordMoveEndAfterImageWork = (metric: ViewportImageMetric): void => {'),
  );
});

test('canvas schedules drag visibility during viewport moves without workflow sync', async () => {
  const canvasSource = await readCanvasSource();
  const onMoveBlock = canvasSource.slice(
    canvasSource.indexOf('const onMove = useCallback((_: unknown, viewport: Viewport) => {'),
    canvasSource.indexOf('  const onMoveStart = useCallback(', canvasSource.indexOf('const onMove = useCallback((_: unknown, viewport: Viewport) => {')),
  );
  const onMoveStartBlock = canvasSource.slice(
    canvasSource.indexOf('const onMoveStart = useCallback((_: MouseEvent | TouchEvent, viewport: Viewport) => {'),
    canvasSource.indexOf('  const onMoveEnd = useCallback(', canvasSource.indexOf('const onMoveStart = useCallback((_: MouseEvent | TouchEvent, viewport: Viewport) => {')),
  );

  assert.equal(onMoveBlock.includes('scheduleDragVisibility(buildDragVisibilityScheduleOptions(viewport, \'frame\'));'), true);
  assert.equal(onMoveBlock.includes('syncViewportOnlyToWorkflow('), false);
  assert.equal(onMoveBlock.includes('scheduleWorkflowSync({'), false);
  assert.equal(onMoveBlock.includes('flushViewportImageWork(viewport)'), false);
  assert.equal(onMoveBlock.includes('suspendViewportImageWork();'), true);
  assert.equal(onMoveBlock.includes('suspendImageScheduling();'), false);
  assert.equal(onMoveBlock.includes('hasViewportZoomChanged(previousViewport, viewport)'), true);
  assert.equal(onMoveBlock.includes('shouldScheduleIntermediateZoomVisibility({'), true);
  assert.equal(onMoveStartBlock.includes('setIsViewportDragging(true);'), true);
  assert.equal(onMoveStartBlock.includes('setDragRasterAnchorViewport(viewport);'), true);
  assert.equal(onMoveStartBlock.includes('scheduleDragVisibility(buildDragVisibilityScheduleOptions(viewport, \'frame\'));'), true);
  assert.equal(onMoveStartBlock.includes('lastZoomVisibilityViewportRef.current = { ...viewport };'), true);
  assert.equal(onMoveStartBlock.includes('suspendViewportImageWork();'), true);
  assert.equal(onMoveStartBlock.includes('suspendImageScheduling();'), false);
});

test('canvas render plan consumes the viewport used by scheduled visibility', async () => {
  const canvasSource = await readCanvasSource();
  const visibilityViewportBlock = canvasSource.slice(
    canvasSource.indexOf('const visibilityViewport = useMemo(() => {'),
    canvasSource.indexOf('const visibleCandidateNodeIds = useMemo(', canvasSource.indexOf('const visibilityViewport = useMemo(() => {')),
  );
  const visibleNodesBlock = canvasSource.slice(
    canvasSource.indexOf('const visibleNodes = useVisibleNodes({'),
    canvasSource.indexOf('  useEffect(() => {\n    let visibleImportingImageNodeCount', canvasSource.indexOf('const visibleNodes = useVisibleNodes({')),
  );
  const domFreshBlock = canvasSource.slice(
    canvasSource.indexOf('const isDomWindowingVisibilityFresh = useMemo(() => ('),
    canvasSource.indexOf('  // CanvasRenderPlan is the single owner', canvasSource.indexOf('const isDomWindowingVisibilityFresh = useMemo(() => (')),
  );

  assert.equal(visibilityViewportBlock.includes('scheduledVisibleNodes.viewport'), true);
  assert.equal(visibilityViewportBlock.includes('return currentViewport;'), true);
  assert.equal(visibleNodesBlock.includes('viewport: visibilityViewport,'), true);
  assert.equal(visibleNodesBlock.includes('viewport: currentViewport,'), false);
  assert.equal(domFreshBlock.includes('viewport: visibilityViewport,'), true);
  assert.equal(domFreshBlock.includes('viewport: currentViewport,'), false);
});

test('canvas batch import pipeline applies pressure-based load shedding', async () => {
  const canvasSource = await readCanvasSource();
  const importPipelineBlock = canvasSource.slice(
    canvasSource.indexOf('} = useCanvasImportPipeline({'),
    canvasSource.indexOf('  const {', canvasSource.indexOf('} = useCanvasImportPipeline({') + 1),
  );
  const processImportBatchBlock = canvasSource.slice(
    canvasSource.indexOf('const processImportBatch = useCallback(async (batchId: string, tasks: FileImportTask[]): Promise<void> => {'),
    canvasSource.indexOf('  const hasRunningImportSession = useCallback(', canvasSource.indexOf('const processImportBatch = useCallback(async (batchId: string, tasks: FileImportTask[]): Promise<void> => {')),
  );

  assert.equal(canvasSource.includes('FILE_IMPORT_PRESSURE_VISIBLE_IMAGE_THRESHOLD'), true);
  assert.equal(canvasSource.includes('FILE_IMPORT_PRESSURE_IMPORTING_IMAGE_THRESHOLD'), true);
  assert.equal(canvasSource.includes('FILE_IMPORT_PRESSURE_THUMBNAIL_MAX_PER_FRAME'), true);
  assert.equal(canvasSource.includes('importPressureRef'), true);
  assert.equal(importPipelineBlock.includes('getImageConcurrencyLimit:'), true);
  assert.equal(importPipelineBlock.includes('getThumbnailMaxPerFrame:'), true);
  assert.equal(importPipelineBlock.includes('? 1'), true);
  assert.equal(importPipelineBlock.includes('FILE_IMPORT_PRESSURE_THUMBNAIL_MAX_PER_FRAME'), true);
  assert.equal(processImportBatchBlock.includes('yieldAfterHydrationPatch'), true);
  assert.equal(processImportBatchBlock.includes('FILE_IMPORT_HYDRATION_PRESSURE_BATCH_SIZE'), true);
  assert.equal(processImportBatchBlock.includes('window.requestAnimationFrame'), true);
});

test('canvas import pipeline keeps coordinator stable across render callback changes', async () => {
  const pipelineSource = await readCanvasImportPipelineSource();
  const createCoordinatorBlock = pipelineSource.slice(
    pipelineSource.indexOf('const createImportCoordinatorInstance = useCallback((): ImageImportCoordinator => ('),
    pipelineSource.indexOf('const getImportCoordinator = useCallback', pipelineSource.indexOf('const createImportCoordinatorInstance = useCallback((): ImageImportCoordinator => (')),
  );
  const createCoordinatorDeps = createCoordinatorBlock.slice(
    createCoordinatorBlock.lastIndexOf('), ['),
    createCoordinatorBlock.lastIndexOf(']);') + 3,
  );

  assert.equal(pipelineSource.includes('const processImageTaskRef = useRef(processImageTask);'), true);
  assert.equal(pipelineSource.includes('const processVideoTaskRef = useRef(processVideoTask);'), true);
  assert.equal(pipelineSource.includes('const onTaskSettledRef = useRef(onTaskSettled);'), true);
  assert.equal(pipelineSource.includes('const onBatchSettledRef = useRef(onBatchSettled);'), true);
  assert.equal(createCoordinatorBlock.includes('processImageTaskRef.current(task)'), true);
  assert.equal(createCoordinatorBlock.includes('processVideoTaskRef.current(task)'), true);
  assert.equal(createCoordinatorBlock.includes('onTaskSettledRef.current?.(task'), true);
  assert.equal(createCoordinatorBlock.includes('onBatchSettledRef.current?.(batchId)'), true);
  assert.equal(createCoordinatorDeps.includes('processImageTask'), false);
  assert.equal(createCoordinatorDeps.includes('processVideoTask'), false);
  assert.equal(createCoordinatorDeps.includes('onTaskSettled'), false);
  assert.equal(createCoordinatorDeps.includes('onBatchSettled'), false);
  assert.equal(createCoordinatorDeps.includes('onTaskError'), false);
  assert.equal(createCoordinatorDeps.includes('yieldBeforeNextTask'), false);
  assert.equal(createCoordinatorDeps.includes('getImageConcurrencyLimit'), false);
  assert.equal(createCoordinatorDeps.includes('getThumbnailMaxPerFrame'), false);
});

test('canvas import node data patches flow through CanvasNodePatchQueue', async () => {
  const canvasSource = await readCanvasSource();
  const processImageImportEnhancementBlock = canvasSource.slice(
    canvasSource.indexOf('const processImageImportEnhancement = useCallback(async ('),
    canvasSource.indexOf('  const processVideoImportEnhancement = useCallback(async (', canvasSource.indexOf('const processImageImportEnhancement = useCallback(async (')),
  );
  const preprocessImportedNodeDetailsBlock = canvasSource.slice(
    canvasSource.indexOf('const preprocessImportedNodeDetails = useCallback(async ('),
    canvasSource.indexOf('  const preprocessImportedNodeDetailsRef = useRef(preprocessImportedNodeDetails);', canvasSource.indexOf('const preprocessImportedNodeDetails = useCallback(async (')),
  );
  const hydrateImportedNodeBlock = canvasSource.slice(
    canvasSource.indexOf('const hydrateImportedNode = useCallback(async (task: FileImportTask): Promise<FileHydrationResult> => {'),
    canvasSource.indexOf('  const processImportBatch = useCallback(async (batchId: string, tasks: FileImportTask[]): Promise<void> => {', canvasSource.indexOf('const hydrateImportedNode = useCallback(async (task: FileImportTask): Promise<FileHydrationResult> => {')),
  );
  const removeNodeLocallyBlock = canvasSource.slice(
    canvasSource.indexOf('const removeNodeLocally = useCallback((nodeId: string): void => {'),
    canvasSource.indexOf('  const deleteSelectedElements = useCallback((): void => {', canvasSource.indexOf('const removeNodeLocally = useCallback((nodeId: string): void => {')),
  );
  const importFilesToCanvasBlock = canvasSource.slice(
    canvasSource.indexOf('const importFilesToCanvas = useCallback(async ('),
    canvasSource.indexOf('  const appendCreatedNode = useCallback((', canvasSource.indexOf('const importFilesToCanvas = useCallback(async (')),
  );

  assert.equal(canvasSource.includes('createCanvasNodePatchQueue<FlowNode>({'), true);
  assert.equal(canvasSource.includes('const enqueueNodeDataPatch = useCallback(('), true);
  assert.equal(processImageImportEnhancementBlock.includes('imageImportPreviewService.resolve'), true);
  assert.equal(processImageImportEnhancementBlock.includes('enqueueNodeDataPatchRef.current(nodeId.value'), true);
  assert.equal(processImageImportEnhancementBlock.includes("reason: 'image-import-enhancement-apply'"), true);
  assert.equal(processImageImportEnhancementBlock.includes('patchNodeDataLocally'), false);
  assert.equal(preprocessImportedNodeDetailsBlock.includes("reason: 'import-enhancement-error'"), true);
  assert.equal(preprocessImportedNodeDetailsBlock.includes("reason: 'video-import-enhancement-apply'"), true);
  assert.equal(preprocessImportedNodeDetailsBlock.includes('enqueueNodeDataPatch(nodeId.value'), true);
  assert.equal(preprocessImportedNodeDetailsBlock.includes('patchNodeDataLocally'), false);
  assert.equal(hydrateImportedNodeBlock.includes("reason: 'import-node-local-source-linked'"), true);
  assert.equal(hydrateImportedNodeBlock.includes("reason: 'import-node-hydration-local'"), true);
  assert.equal(hydrateImportedNodeBlock.includes("reason: 'import-node-hydration-error'"), true);
  assert.equal(hydrateImportedNodeBlock.includes('enqueueNodeDataPatch(nodeId.value'), true);
  assert.equal(hydrateImportedNodeBlock.includes('patchNodeDataLocally'), false);
  assert.equal(removeNodeLocallyBlock.includes('cancelCanvasNodePatchQueue(nodeId);'), true);
  assert.equal(importFilesToCanvasBlock.includes('appendNodes(placeholderBatch.nodes, {'), true);
  assert.equal(importFilesToCanvasBlock.includes("reason: 'import-placeholder-insert'"), true);
});

test('canvas media layout runtime snapshots flow through CanvasNodePatchQueue', async () => {
  const canvasSource = await readCanvasSource();
  const delegateStart = canvasSource.indexOf('useEffect(() => bindMediaLayoutRuntimeSyncDelegate(({ reason, force }) => {');
  assert.ok(delegateStart >= 0);
  const mediaLayoutDelegateBlock = canvasSource.slice(
    delegateStart,
    canvasSource.indexOf('  const replaceNode = useCallback((', delegateStart),
  );
  const removeNodeStart = canvasSource.indexOf('const removeNodeLocally = useCallback((nodeId: string): void => {');
  assert.ok(removeNodeStart >= 0);
  const removeNodeLocallyBlock = canvasSource.slice(
    removeNodeStart,
    canvasSource.indexOf('  const deleteSelectedElements = useCallback((): void => {', removeNodeStart),
  );

  assert.equal(canvasSource.includes('file-node-layout-runtime-store'), true);
  assert.equal(canvasSource.includes('clearFileNodeLayoutRuntimeSnapshot,'), true);
  assert.equal(canvasSource.includes('clearFileNodeLayoutRuntimeSnapshots,'), true);
  assert.equal(canvasSource.includes('consumeFileNodeLayoutRuntimeSnapshots,'), true);
  assert.equal(mediaLayoutDelegateBlock.includes('const snapshots = consumeFileNodeLayoutRuntimeSnapshots();'), true);
  assert.equal(mediaLayoutDelegateBlock.includes('enqueueNodeDataPatch(snapshot.nodeId'), true);
  assert.equal(mediaLayoutDelegateBlock.includes('buildFileNodeMediaLayoutPatch('), true);
  assert.equal(mediaLayoutDelegateBlock.includes('flushCanvasNodePatchQueue();'), true);
  assert.equal(mediaLayoutDelegateBlock.includes('syncFromInstance({'), false);
  assert.equal(removeNodeLocallyBlock.includes('clearFileNodeLayoutRuntimeSnapshot(nodeId);'), true);
  assert.equal(canvasSource.includes('clearFileNodeLayoutRuntimeSnapshots();'), true);
});

test('canvas manual visibility checklist covers viewport return and raster DOM regression paths', async () => {
  const visibilityChecklist = await readManualCheckSource('canvas-visibility-render-plan-checklist.md');
  const dragChecklist = await readManualCheckSource('canvas-drag-regression-checklist.md');
  const renderPerformanceGuide = await readManualCheckSource('canvas-node-render-performance.md');
  const imageCacheGuide = await readManualCheckSource('canvas-image-cache-budget.md');
  const importVisibilityGuide = await readManualCheckSource('canvas-import-visibility-performance.md');
  const architectureRules = await readArchitectureRulesSource();

  assert.equal(visibilityChecklist.includes('离开视口再返回'), true);
  assert.equal(visibilityChecklist.includes('普通文件节点'), true);
  assert.equal(visibilityChecklist.includes('图片节点'), true);
  assert.equal(visibilityChecklist.includes('AI 节点'), true);
  assert.equal(visibilityChecklist.includes('dynamic-handle'), true);
  assert.equal(visibilityChecklist.includes('任务输出节点'), true);
  assert.equal(visibilityChecklist.includes('raster/DOM'), true);
  assert.equal(visibilityChecklist.includes('image is visible but the node cannot be clicked'), true);
  assert.equal(visibilityChecklist.includes('output hydration'), true);
  assert.equal(visibilityChecklist.includes('CanvasRenderPlan` is the only source'), true);
  assert.equal(visibilityChecklist.includes('onlyRenderVisibleElements={false}'), true);
  assert.equal(dragChecklist.includes('Pan a mixed cluster fully out of the viewport and back 20 times'), true);
  assert.equal(dragChecklist.includes('Task completion or output hydration is not required to restore a returned node.'), true);
  assert.equal(renderPerformanceGuide.includes('dragVisibilitySummary.totalComputations'), true);
  assert.equal(renderPerformanceGuide.includes('viewportImageScheduleSummary.totalFlushes'), true);
  assert.equal(imageCacheGuide.includes('raster/DOM position remains consistent after drag end'), true);
  assert.equal(imageCacheGuide.includes('clickable/selectable node'), true);
  const renderPlanPerformanceGuide = await readManualCheckSource('canvas-render-plan-performance.md');
  assert.equal(renderPlanPerformanceGuide.includes('Continuous Zoom Check'), true);
  assert.equal(renderPlanPerformanceGuide.includes('image requests resume only after zoom settles'), true);
  assert.equal(renderPlanPerformanceGuide.includes('Visibility diff count should be visibly lower'), true);
  assert.equal(importVisibilityGuide.includes('20 / 50 / 100 Image Import Matrix'), true);
  assert.equal(importVisibilityGuide.includes('100 / 500 / 1000 Node Visibility Matrix'), true);
  assert.equal(importVisibilityGuide.includes('ordinary file node'), true);
  assert.equal(importVisibilityGuide.includes('dynamic handle AI node'), true);
  assert.equal(importVisibilityGuide.includes('onlyRenderVisibleElements={false}'), true);
  assert.equal(architectureRules.includes('Canvas visibility ownership:'), true);
  assert.equal(architectureRules.includes('CanvasRenderPlan` is the only source'), true);
  assert.equal(architectureRules.includes('onlyRenderVisibleElements={false}'), true);
  assert.equal(architectureRules.includes('Dynamic-handle keepalive belongs in render plan / DOM windowing rules'), true);
});

test('canvas derives forced offscreen imports instead of forcing all importing nodes', async () => {
  const canvasSource = await readCanvasSource();
  const visibilityInputBlock = canvasSource.slice(
    canvasSource.indexOf('const computeVisibleNodeMapForViewportAsync = useCallback('),
    canvasSource.indexOf('  const imageNodeCount = useMemo(', canvasSource.indexOf('const computeVisibleNodeMapForViewportAsync = useCallback(')),
  );
  const useVisibleNodesBlock = canvasSource.slice(
    canvasSource.indexOf('  const visibleNodes = useVisibleNodes({'),
    canvasSource.indexOf('  useEffect(() => {', canvasSource.indexOf('  const visibleNodes = useVisibleNodes({')),
  );

  assert.equal(canvasSource.includes('resolveForcedOffscreenImportNodeIds'), true);
  assert.equal(canvasSource.includes('canvas-forced-offscreen-visibility'), true);
  assert.equal(visibilityInputBlock.includes('resolveForcedOffscreenImportNodeIds({'), true);
  assert.equal(visibilityInputBlock.includes('lastAppliedVisibleNodes: lastAppliedVisibleNodesRef.current,'), true);
  assert.equal(visibilityInputBlock.includes('forcedOffscreenNodeIds: importingImageNodeIdsRef.current'), false);
  assert.equal(visibilityInputBlock.includes('forcedOffscreenNodeIds: importingImageNodeIds,'), false);
  assert.equal(visibilityInputBlock.includes('const forcedOffscreenImportNodeIds = useMemo('), true);
  assert.equal(useVisibleNodesBlock.includes('forcedOffscreenNodeIds: forcedOffscreenImportNodeIds,'), true);
});
