import test from 'node:test';
import assert from 'node:assert/strict';

import type { AINodeData, Connection, Workflow } from '@/types';
import type { WorkflowRuntimeSnapshot } from '@/contracts/workflow';
import { __testOnly as workflowHookTestOnly, buildWorkflowWithRuntime, createEmptyWorkflow } from '@/hooks/workflow/useWorkflow';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import { createGroupedExecutionOutputAdapter } from '@/execution-runtime/execution-output-commit.adapters';
import { registerExecutionRuntimeNodeAdapter } from '@/execution-runtime/node-execution-adapter.registry';
import {
  __testOnly as workflowExecutionCoordinatorTestOnly,
  clearWorkflowExecutionReconcileState,
} from './coordinators/workflow-execution-coordinator';
import {
  getLocallyIncompleteReconcileExecutionNodeIds,
} from '@/execution-runtime/execution-output-reconcile.service';

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

function registerAiImageGenExecutionAdapter(): void {
  registerExecutionRuntimeNodeAdapter({
    nodeType: 'aiImageGen',
    executionKind: 'grouped',
    taskType: 'image-gen',
    validateExecution: () => ({ valid: true }),
    createExecutionPayload: () => ({
      nodeId: '100',
      nodeType: 'aiImageGen',
      nodeTitle: 'image',
      taskType: 'image-gen',
      executionKind: 'grouped',
      request: undefined,
      targets: [],
    }),
    mapSnapshotToRuntimePatch: () => [],
    ...createGroupedExecutionOutputAdapter(),
  }, { override: true });
}

function createWorkflowWithOutputs(): Workflow {
  const sourceNode = {
    ...createDefaultAINodeData(createSequentialNodeId(100), { x: 100, y: 100 }, 'aiImageGen'),
    outputs: ['file-result-1'],
  } as AINodeData;
  const resultNode = createDefaultFileNodeData(
    createSequentialNodeId(101),
    { x: 420, y: 120 },
    'image',
    'file-result-1',
    'result.png',
    1024,
    'image/png',
    { width: 1024, height: 768 },
    {
      type: 'node-output',
      producerNodeId: sourceNode.id.value,
      producerNodeDisplayId: sourceNode.id.display,
      producerNodeType: sourceNode.type,
    },
  );
  const connection: Connection = {
    id: 'connection-output-1',
    type: 'output-link',
    sourceId: sourceNode.id.value,
    targetId: resultNode.id.value,
    sourceHandle: 'group-1:result',
    order: 0,
  };

  return {
    ...createEmptyWorkflow('project-reconcile-safety', 'Reconcile Safety'),
    nodes: {
      [sourceNode.id.value]: sourceNode,
      [resultNode.id.value]: resultNode,
    },
    connections: [connection],
    metadata: {
      nodeCount: 2,
      connectionCount: 1,
      lastNodeId: 101,
      canvasSize: { width: 1920, height: 1080 },
      relatedTasks: [],
      usedNodeIds: ['100', '101'],
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1_777_000_000_000,
      updated: 1_777_000_000_100,
    },
  };
}

test('incremental output reconcile snapshots are rejected when they would shrink workflow nodes', () => {
  const currentWorkflow = createWorkflowWithOutputs();
  const runtime: WorkflowRuntimeSnapshot = {
    nodes: {
      '100': currentWorkflow.nodes['100']!,
    },
    connections: currentWorkflow.connections,
    viewport: currentWorkflow.viewport,
    metadata: {
      ...currentWorkflow.metadata,
      nodeCount: 1,
      connectionCount: 1,
    },
    snapshotMeta: {
      source: 'execution-reconcile',
      scope: 'output-reconcile',
      baseUpdatedAt: currentWorkflow.timestamp.updated,
      baseNodeCount: 2,
      baseConnectionCount: 1,
      sourceNodeId: '100',
      affectedNodeIds: ['100'],
      allowNodeShrink: false,
    },
  };

  assert.equal(workflowHookTestOnly.canApplyRuntimeSnapshot(currentWorkflow, runtime), false);

  const nextWorkflow = workflowHookTestOnly.canApplyRuntimeSnapshot(currentWorkflow, runtime)
    ? buildWorkflowWithRuntime(currentWorkflow, runtime)
    : currentWorkflow;

  assert.equal(Object.keys(nextWorkflow.nodes).length, 2);
  assert.equal(nextWorkflow.connections.length, 1);
});

test('incremental output reconcile snapshots are rejected when they would shrink workflow connections', () => {
  const currentWorkflow = createWorkflowWithOutputs();
  const runtime: WorkflowRuntimeSnapshot = {
    nodes: currentWorkflow.nodes,
    connections: [],
    viewport: currentWorkflow.viewport,
    metadata: {
      ...currentWorkflow.metadata,
      nodeCount: 2,
      connectionCount: 0,
    },
    snapshotMeta: {
      source: 'execution-reconcile',
      scope: 'output-reconcile',
      baseUpdatedAt: currentWorkflow.timestamp.updated,
      baseNodeCount: 2,
      baseConnectionCount: 1,
      sourceNodeId: '100',
      affectedNodeIds: ['100', '101'],
      allowNodeShrink: false,
    },
  };

  assert.equal(workflowHookTestOnly.canApplyRuntimeSnapshot(currentWorkflow, runtime), false);
});

test('canvas-sync snapshots are rejected when they would shrink workflow nodes without explicit allowNodeShrink', () => {
  const currentWorkflow = createWorkflowWithOutputs();
  const runtime: WorkflowRuntimeSnapshot = {
    nodes: {
      '100': currentWorkflow.nodes['100']!,
    },
    connections: [],
    viewport: currentWorkflow.viewport,
    metadata: {
      ...currentWorkflow.metadata,
      nodeCount: 1,
      connectionCount: 0,
    },
    snapshotMeta: {
      source: 'canvas-edit',
      scope: 'canvas-sync',
      baseUpdatedAt: currentWorkflow.timestamp.updated,
      baseNodeCount: 2,
      baseConnectionCount: 1,
      allowNodeShrink: false,
    },
  };

  assert.equal(workflowHookTestOnly.canApplyRuntimeSnapshot(currentWorkflow, runtime), false);
});

test('canvas-sync snapshots can shrink workflow nodes only when explicitly allowed', () => {
  const currentWorkflow = createWorkflowWithOutputs();
  const runtime: WorkflowRuntimeSnapshot = {
    nodes: {
      '100': currentWorkflow.nodes['100']!,
    },
    connections: currentWorkflow.connections,
    viewport: currentWorkflow.viewport,
    metadata: {
      ...currentWorkflow.metadata,
      nodeCount: 1,
      connectionCount: 1,
    },
    snapshotMeta: {
      source: 'canvas-edit',
      scope: 'canvas-sync',
      baseUpdatedAt: currentWorkflow.timestamp.updated,
      baseNodeCount: 2,
      baseConnectionCount: 1,
      allowNodeShrink: true,
    },
  };

  assert.equal(workflowHookTestOnly.canApplyRuntimeSnapshot(currentWorkflow, runtime), true);
});

test('canvas-sync snapshots tolerate stale base timestamps when structure counts still match', () => {
  const currentWorkflow = createWorkflowWithOutputs();
  const sourceNode = currentWorkflow.nodes['100'] as AINodeData;
  const runtime: WorkflowRuntimeSnapshot = {
    nodes: {
      ...currentWorkflow.nodes,
      '100': {
        ...sourceNode,
        position: {
          x: sourceNode.position.x + 24,
          y: sourceNode.position.y,
        },
      },
    },
    connections: currentWorkflow.connections,
    viewport: currentWorkflow.viewport,
    metadata: currentWorkflow.metadata,
    snapshotMeta: {
      source: 'canvas-edit',
      scope: 'canvas-sync',
      baseUpdatedAt: currentWorkflow.timestamp.updated - 1,
      baseNodeCount: 2,
      baseConnectionCount: 1,
      allowNodeShrink: false,
    },
  };

  assert.equal(workflowHookTestOnly.canApplyRuntimeSnapshot(currentWorkflow, runtime), true);
});

test('canvas structure sync preflight blocks unauthorized shrink before runtime snapshot emission', async () => {
  const canvasSource = await readCanvasSource();
  const syncBlock = canvasSource.slice(
    canvasSource.indexOf('const syncReactFlowStateToWorkflow = useCallback(('),
    canvasSource.indexOf('  const commitProvidedRuntimeSnapshot = useCallback((', canvasSource.indexOf('const syncReactFlowStateToWorkflow = useCallback(')),
  );

  assert.equal(syncBlock.includes('const wouldShrinkNodes = baseNodeCount > 0 && nextNodes.length < baseNodeCount;'), true);
  assert.equal(syncBlock.includes('if (options.allowNodeShrink !== true && wouldShrinkNodes) {'), true);
  assert.equal(syncBlock.includes('syncViewportOnlyToWorkflow(nextViewport, {'), true);
  assert.equal(syncBlock.includes('Skipped canvas runtime snapshot because it would shrink workflow nodes without explicit permission.'), true);
  assert.equal(syncBlock.includes('return;'), true);
  assert.equal(syncBlock.includes('createWorkflowRuntimeSnapshot(nextNodes, nextEdges, nextViewport)'), true);
});

test('canvas instance sync preserves hidden nodes before writing local refs', async () => {
  const canvasSource = await readCanvasSource();
  const syncBlock = canvasSource.slice(
    canvasSource.indexOf('const syncFromInstance = useCallback(('),
    canvasSource.indexOf('  useEffect(() => bindCanvasRuntimeSyncFlushDelegate(', canvasSource.indexOf('const syncFromInstance = useCallback(')),
  );

  assert.equal(syncBlock.includes('const currentNodesSnapshot = nodesRef.current;'), true);
  assert.equal(syncBlock.includes('const currentEdgesSnapshot = edgesRef.current;'), true);
  assert.equal(syncBlock.includes('const shouldPreserveMissingInstanceStructure = options.allowNodeShrink !== true;'), true);
  assert.equal(syncBlock.includes('preserveMissingCurrentNodes: shouldPreserveMissingInstanceStructure,'), true);
  assert.equal(syncBlock.includes('preserveMissingCurrentConnections: shouldPreserveMissingInstanceStructure,'), true);
  assert.equal(syncBlock.includes('if (shouldPreserveMissingInstanceStructure && nextNodes.length < currentNodesSnapshot.length) {'), true);
  assert.equal(syncBlock.indexOf('if (shouldPreserveMissingInstanceStructure && nextNodes.length < currentNodesSnapshot.length) {') < syncBlock.indexOf('nodesRef.current = nextNodes;'), true);
});

test('canvas instance sync carries render-plan detached and hidden-edge protection into workflow merge', async () => {
  const canvasSource = await readCanvasSource();
  const syncBlock = canvasSource.slice(
    canvasSource.indexOf('const syncFromInstance = useCallback(('),
    canvasSource.indexOf('  useEffect(() => bindCanvasRuntimeSyncFlushDelegate(', canvasSource.indexOf('const syncFromInstance = useCallback(')),
  );

  assert.equal(syncBlock.includes('const detachedNodes = nodesRef.current.filter((node) => ('), true);
  assert.equal(syncBlock.includes('detachedNodeIdsRef.current.has(node.id)'), true);
  assert.equal(syncBlock.includes('!instanceNodeIds.has(node.id)'), true);
  assert.equal(syncBlock.includes('detachedNodes.forEach((node) => {'), true);
  assert.equal(syncBlock.includes('preserveNodeIds.add(node.id);'), true);
  assert.equal(syncBlock.includes('transientNodeTypes: new Set([CANVAS_DOM_WINDOW_PLACEHOLDER_NODE_TYPE]),'), true);
  assert.equal(syncBlock.includes('const preserveConnectionIds = new Set(hiddenEdgeIdsRef.current);'), true);
  assert.equal(syncBlock.includes('preserveConnectionIds,'), true);
  assert.equal(
    syncBlock.indexOf('const detachedNodes = nodesRef.current.filter((node) => (') <
      syncBlock.indexOf('const nextNodes = mergeInstanceSnapshotNodes('),
    true,
  );
  assert.equal(
    syncBlock.indexOf('const preserveConnectionIds = new Set(hiddenEdgeIdsRef.current);') <
      syncBlock.indexOf('const nextConnections = mergeWorkflowConnections('),
    true,
  );
  assert.equal(
    syncBlock.indexOf('const nextConnections = mergeWorkflowConnections(') <
      syncBlock.indexOf('edgesRef.current = createReactFlowEdges(nextConnections);'),
    true,
  );
});

test('canvas sync blocks stale local structure writes during output hydration but allows viewport-only preservation', async () => {
  const canvasSource = await readCanvasSource();
  const viewportOnlyBlock = canvasSource.slice(
    canvasSource.indexOf('const syncViewportOnlyToWorkflow = useCallback(('),
    canvasSource.indexOf('  const syncReactFlowStateToWorkflow = useCallback((', canvasSource.indexOf('const syncViewportOnlyToWorkflow = useCallback(')),
  );
  const syncBlock = canvasSource.slice(
    canvasSource.indexOf('const syncReactFlowStateToWorkflow = useCallback(('),
    canvasSource.indexOf('  const commitProvidedRuntimeSnapshot = useCallback((', canvasSource.indexOf('const syncReactFlowStateToWorkflow = useCallback(')),
  );
  const onMoveEndBlock = canvasSource.slice(
    canvasSource.indexOf('const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {'),
    canvasSource.indexOf('  const onInit = useCallback(', canvasSource.indexOf('const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {')),
  );

  assert.equal(syncBlock.includes('if (!options.force && hasPendingExternalHydration()) {'), true);
  assert.equal(syncBlock.includes('return;'), true);
  assert.equal(viewportOnlyBlock.includes('nodes: activeWorkflow.nodes,'), true);
  assert.equal(viewportOnlyBlock.includes('connections: activeWorkflow.connections,'), true);
  assert.equal(viewportOnlyBlock.includes('viewport: nextViewport,'), true);
  assert.equal(onMoveEndBlock.includes('scheduleViewportSync(viewport);'), true);
  assert.equal(onMoveEndBlock.includes('scheduleWorkflowSync({'), true);
  assert.equal(onMoveEndBlock.includes('syncViewportOnlyToWorkflow(viewport, {'), false);
  assert.equal(
    onMoveEndBlock.includes("reason: importing ? 'viewport-drag-end-importing' : 'canvas-viewport-drag-end',"),
    true,
  );
  assert.equal(onMoveEndBlock.includes('syncReactFlowStateToWorkflow(nodesRef.current, edgesRef.current, viewport)'), false);
});

test('incremental output append snapshots are rejected when source and scope do not match', () => {
  const currentWorkflow = createWorkflowWithOutputs();
  const runtime: WorkflowRuntimeSnapshot = {
    nodes: currentWorkflow.nodes,
    connections: currentWorkflow.connections,
    viewport: currentWorkflow.viewport,
    metadata: currentWorkflow.metadata,
    snapshotMeta: {
      source: 'canvas-edit',
      scope: 'output-append',
      baseUpdatedAt: currentWorkflow.timestamp.updated,
      baseNodeCount: 2,
      baseConnectionCount: 1,
      sourceNodeId: '100',
      affectedNodeIds: ['100', '101'],
      allowNodeShrink: false,
    },
  };

  assert.equal(workflowHookTestOnly.canApplyRuntimeSnapshot(currentWorkflow, runtime), false);
});

test('incremental output append snapshots are rejected when structural changes lack affected node metadata', () => {
  const currentWorkflow = createWorkflowWithOutputs();
  const nextResultNode = createDefaultFileNodeData(
    createSequentialNodeId(102),
    { x: 640, y: 120 },
    'image',
    'file-result-2',
    'result-2.png',
    1024,
    'image/png',
    { width: 1024, height: 768 },
    {
      type: 'node-output',
      producerNodeId: '100',
      producerNodeDisplayId: '#00100',
      producerNodeType: 'aiImageGen',
    },
  );
  const runtime: WorkflowRuntimeSnapshot = {
    nodes: {
      ...currentWorkflow.nodes,
      [nextResultNode.id.value]: nextResultNode,
    },
    connections: [
      ...currentWorkflow.connections,
      {
        id: 'connection-output-2',
        type: 'output-link',
        sourceId: '100',
        targetId: nextResultNode.id.value,
        sourceHandle: 'group-2:result',
        order: 1,
      },
    ],
    viewport: currentWorkflow.viewport,
    metadata: {
      ...currentWorkflow.metadata,
      nodeCount: 3,
      connectionCount: 2,
    },
    snapshotMeta: {
      source: 'external-output',
      scope: 'output-append',
      baseUpdatedAt: currentWorkflow.timestamp.updated,
      baseNodeCount: 2,
      baseConnectionCount: 1,
      allowNodeShrink: false,
    },
  };

  assert.equal(workflowHookTestOnly.canApplyRuntimeSnapshot(currentWorkflow, runtime), false);
});

test('incremental output append snapshots are rejected when stale base connection count is detected', () => {
  const currentWorkflow = createWorkflowWithOutputs();
  const runtime: WorkflowRuntimeSnapshot = {
    nodes: currentWorkflow.nodes,
    connections: currentWorkflow.connections,
    viewport: currentWorkflow.viewport,
    metadata: currentWorkflow.metadata,
    snapshotMeta: {
      source: 'external-output',
      scope: 'output-append',
      baseUpdatedAt: currentWorkflow.timestamp.updated,
      baseNodeCount: 2,
      baseConnectionCount: 0,
      sourceNodeId: '100',
      affectedNodeIds: ['100', '101'],
      allowNodeShrink: false,
    },
  };

  assert.equal(workflowHookTestOnly.canApplyRuntimeSnapshot(currentWorkflow, runtime), false);
});

test('workflow execution reconcile session skips duplicated pending node requests and respects cooldown windows', () => {
  clearWorkflowExecutionReconcileState('workflow-1');

  assert.equal(workflowExecutionCoordinatorTestOnly.shouldSkipReconcileAttempt({
    workflowId: 'workflow-1',
    nodeId: 'node-1',
    workflowVersion: 101,
    now: 1_000,
  }), false);

  workflowExecutionCoordinatorTestOnly.markReconcileAttemptStarted({
    workflowId: 'workflow-1',
    nodeId: 'node-1',
    now: 1_000,
  });

  assert.equal(workflowExecutionCoordinatorTestOnly.shouldSkipReconcileAttempt({
    workflowId: 'workflow-1',
    nodeId: 'node-1',
    workflowVersion: 101,
    now: 1_001,
  }), true);

  workflowExecutionCoordinatorTestOnly.markReconcileAttemptFinished({
    workflowId: 'workflow-1',
    nodeId: 'node-1',
  });

  assert.equal(workflowExecutionCoordinatorTestOnly.shouldSkipReconcileAttempt({
    workflowId: 'workflow-1',
    nodeId: 'node-1',
    workflowVersion: 101,
    now: 10_000,
  }), true);

  workflowExecutionCoordinatorTestOnly.markReconcileAttemptFailed({
    workflowId: 'workflow-1',
    nodeId: 'node-1',
    now: 10_000,
  });

  assert.equal(workflowExecutionCoordinatorTestOnly.shouldSkipReconcileAttempt({
    workflowId: 'workflow-1',
    nodeId: 'node-1',
    workflowVersion: 101,
    now: 10_001,
  }), true);

  clearWorkflowExecutionReconcileState('workflow-1');
});

test('workflow execution reconcile treats missing historical runs as a quiet miss', () => {
  assert.equal(workflowExecutionCoordinatorTestOnly.isRecoverableExecutionReconcileMiss({
    code: 'RUN_NOT_FOUND',
    message: 'Execution run not found.',
    module: 'http-client',
    operation: 'get',
    timestamp: Date.now(),
  }), true);

  assert.equal(workflowExecutionCoordinatorTestOnly.isRecoverableExecutionReconcileMiss(
    new Error('Execution run not found.'),
  ), true);

  assert.equal(workflowExecutionCoordinatorTestOnly.isRecoverableExecutionReconcileMiss({
    code: 'NETWORK_ERROR',
    message: 'Network request failed',
    module: 'http-client',
    operation: 'get',
    timestamp: Date.now(),
  }), false);
});

test('reconcile candidate filtering skips nodes whose local outputs are already complete', () => {
  registerAiImageGenExecutionAdapter();
  const workflow = createWorkflowWithOutputs();
  const sourceNode = workflow.nodes['100'] as AINodeData;
  sourceNode.tasks = [{
    taskId: 'task-1',
    scope: 'group',
    groupId: 'group-1',
    outputHandle: 'group-1:result',
    status: 'completed',
    createdAt: 1_777_000_000_000,
  }];

  assert.deepEqual(getLocallyIncompleteReconcileExecutionNodeIds(workflow), []);
});

test('reconcile candidate filtering keeps nodes whose output-link handle is missing', () => {
  registerAiImageGenExecutionAdapter();
  const workflow = createWorkflowWithOutputs();
  const sourceNode = workflow.nodes['100'] as AINodeData;
  sourceNode.tasks = [{
    taskId: 'task-1',
    scope: 'group',
    groupId: 'group-1',
    outputHandle: 'group-1:result',
    status: 'completed',
    createdAt: 1_777_000_000_000,
  }];
  workflow.connections = [{
    ...workflow.connections[0]!,
    sourceHandle: 'group-2:result',
  }];

  assert.deepEqual(getLocallyIncompleteReconcileExecutionNodeIds(workflow), ['100']);
});
