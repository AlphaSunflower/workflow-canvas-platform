import test from 'node:test';
import assert from 'node:assert/strict';

import type { WorkflowRuntimeSnapshot } from '@/contracts/workflow';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import type { AINodeData, FileInfo, FileNodeData, StoryboardShotData, Workflow } from '@/types';
import type { BackendExecutionRunSnapshot } from '@/services/backendExecutionService';
import { getAIStoryboardShotOutputHandle } from '@/nodes/ai-storyboard/groups';
import { AI_STORYBOARD_DEFAULT_SIZE } from '@/nodes/ai-storyboard/constants';
import { aiStoryboardExecutionRuntimeAdapter } from './adapters/ai-storyboard.adapter';
import {
  canReconcileWorkflowExecutions,
  getLocallyIncompleteReconcileExecutionNodeIds,
  getReconcileExecutionNodeIds,
  getReconciliableExecutionNodes,
  reconcileExecutionOutputs,
  shouldReconcileNodeOutputs,
} from './execution-output-reconcile.service';
import {
  createExecutionRuntimeNodeAdapterRegistry,
  executionRuntimeNodeAdapterRegistry,
  registerExecutionRuntimeNodeAdapter,
  setExecutionRuntimeNodeAdapterRegistry,
} from './node-execution-adapter.registry';
import { createGroupedExecutionOutputAdapter } from './execution-output-commit.adapters';
import {
  createExecutionOutputCommitService,
  executionOutputCommitService,
  setExecutionOutputCommitService,
} from './execution-output-commit.service';
import {
  createExecutionOutputCommitCache,
  executionOutputCommitCache,
  setExecutionOutputCommitCache,
} from './execution-output-commit.cache';
import {
  createExecutionRuntimeStore,
  executionRuntimeStore,
  setExecutionRuntimeStore,
} from './execution-runtime.store';

function createWorkflow(): Workflow {
  const node = {
    ...createDefaultAINodeData(createSequentialNodeId(100), { x: 100, y: 120 }, 'aiVideoGen'),
    outputs: [],
  } as AINodeData;

  return {
    id: 'workflow-reconcile-1',
    projectId: 'project-1',
    name: 'reconcile',
    nodes: {
      [node.id.value]: node,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 100,
      canvasSize: { width: 1920, height: 1080 },
      relatedTasks: [],
      usedNodeIds: ['100'],
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

function createRunSnapshot(): BackendExecutionRunSnapshot {
  return {
    runId: 'run-reconcile-1',
    runNo: 'RUN-1',
    workflowId: 'workflow-reconcile-1',
    nodeId: '100',
    nodeType: 'aiVideoGen',
    status: 'completed',
    totalTaskCount: 1,
    completedTaskCount: 1,
    failedTaskCount: 0,
    progress: 100,
    message: 'done',
    createdAt: 1,
    startedAt: 2,
    completedAt: 3,
    isTerminal: true,
    hasCommittableOutput: true,
    allOutputsCommitted: false,
    tasks: [{
      taskId: 'task-reconcile-1',
      taskNo: 'TASK-1',
      runId: 'run-reconcile-1',
      runNo: 'RUN-1',
      nodeId: '100',
      nodeType: 'aiVideoGen',
      groupId: 'group-1',
      groupOrder: 0,
      status: 'completed',
      currentStep: 'final',
      currentAttemptNo: 1,
      retryCount: 0,
      maxRetries: 2,
      maxAttempts: 3,
      progress: 100,
      message: 'done',
      error: null,
      errorCode: null,
      lastErrorCode: null,
      resultFileId: 'file-result-1',
      resultCommitStatus: 'ready',
      resultCommittedAt: null,
      resultCommitError: null,
      canCommitOutput: true,
      isTerminal: true,
      isOutputCommitted: false,
      resultFile: {
        id: 'file-result-1',
        name: 'video.mp4',
        originalName: 'video.mp4',
        size: 1024,
        mimeType: 'video/mp4',
        format: 'mp4',
        fileType: 'video',
        status: 'ready',
        hash: 'hash-1',
        path: '/files/file-result-1/download',
        metadata: {
          width: 1280,
          height: 720,
          duration: 8,
        },
        source: { type: 'node-output' },
        timestamp: {
          created: 1,
          updated: 1,
        },
      },
      resultFileInfo: {
        id: 'file-result-1',
        name: 'video.mp4',
        originalName: 'video.mp4',
        size: 1024,
        mimeType: 'video/mp4',
        format: 'mp4',
        fileType: 'video',
        status: 'ready',
        hash: 'hash-1',
        path: '/files/file-result-1/download',
        metadata: {
          width: 1280,
          height: 720,
          duration: 8,
        },
        source: { type: 'node-output' },
        timestamp: {
          created: 1,
          updated: 1,
        },
      },
    }],
  };
}

function createProducedSource(taskId: string, taskNo: string) {
  return {
    type: 'node-output' as const,
    producerNodeId: '100',
    producerNodeDisplayId: '#00100',
    producerNodeType: 'aiVideoGen' as const,
    taskId,
    taskNo,
    taskCreatedAt: 1,
    taskStartedAt: 2,
    taskCompletedAt: 3,
  };
}

test('shouldReconcileNodeOutputs detects missing output graph', async () => {
  const workflow = createWorkflow();
  const node = workflow.nodes['100'] as AINodeData;
  const snapshot = createRunSnapshot();

  assert.equal(await shouldReconcileNodeOutputs(workflow, node, snapshot), true);
});

test('shouldReconcileNodeOutputs returns false when output id and link both exist', async () => {
  const workflow = createWorkflow();
  const node = workflow.nodes['100'] as AINodeData;
  const outputNode = createDefaultFileNodeData(
    createSequentialNodeId(101),
    { x: 420, y: 120 },
    'video',
    'file-result-1',
    'video.mp4',
    1024,
    'video/mp4',
    { width: 1280, height: 720, duration: 8 },
    { type: 'node-output' },
  );

  workflow.nodes['101'] = outputNode;
  workflow.nodes['100'] = {
    ...node,
    outputs: ['file-result-1'],
  };
  workflow.connections.push({
    id: 'link-1',
    type: 'output-link',
    sourceId: '100',
    targetId: '101',
    sourceHandle: 'group-1:result',
    order: 0,
  });

  assert.equal(
    await shouldReconcileNodeOutputs(workflow, workflow.nodes['100'] as AINodeData, createRunSnapshot()),
    false,
  );
});

test('getReconciliableExecutionNodes only returns AI nodes with execution adapters', () => {
  registerExecutionRuntimeNodeAdapter({
    nodeType: 'aiVideoGen',
    executionKind: 'grouped',
    taskType: 'video-gen',
    validateExecution: () => ({ valid: true }),
    createExecutionPayload: () => ({
      nodeId: '100',
      nodeType: 'aiVideoGen',
      nodeTitle: 'video',
      taskType: 'video-gen',
      executionKind: 'grouped',
      request: undefined,
      targets: [],
    }),
    mapSnapshotToRuntimePatch: () => [],
    ...createGroupedExecutionOutputAdapter(),
  }, { override: true });

  const workflow = createWorkflow();
  workflow.nodes['100'] = {
    ...(workflow.nodes['100'] as AINodeData),
    tasks: [{
      taskId: 'task-1',
      scope: 'node',
      status: 'completed',
      createdAt: 1,
    }],
  };
  assert.deepEqual(getReconciliableExecutionNodes(workflow).map((node) => node.id.value), ['100']);
});

test('canReconcileWorkflowExecutions only allows persisted workflows', () => {
  const localWorkflow = createWorkflow();
  assert.equal(canReconcileWorkflowExecutions(localWorkflow), false);

  const persistedWorkflow: Workflow = {
    ...localWorkflow,
    version: 3,
    ownerUserId: 'user-1',
  };
  assert.equal(canReconcileWorkflowExecutions(persistedWorkflow), true);
});

test('getReconcileExecutionNodeIds returns a stable sorted key source', () => {
  const workflow = createWorkflow();
  workflow.nodes['100'] = {
    ...(workflow.nodes['100'] as AINodeData),
    tasks: [{
      taskId: 'task-100',
      scope: 'node',
      status: 'completed',
      createdAt: 1,
    }],
  };
  workflow.nodes['120'] = {
    ...createDefaultAINodeData(createSequentialNodeId(120), { x: 300, y: 160 }, 'aiImageGen'),
    outputs: [],
    tasks: [{
      taskId: 'task-120',
      scope: 'node',
      status: 'completed',
      createdAt: 1,
    }],
  } as AINodeData;

  registerExecutionRuntimeNodeAdapter({
    nodeType: 'aiImageGen',
    executionKind: 'grouped',
    taskType: 'image-gen',
    validateExecution: () => ({ valid: true }),
    createExecutionPayload: () => ({
      nodeId: '120',
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

  assert.deepEqual(getReconcileExecutionNodeIds(workflow), ['100', '120']);
});

test('getLocallyIncompleteReconcileExecutionNodeIds skips nodes whose local output graph is already complete', () => {
  const workflow = createWorkflow();
  const outputNode = createDefaultFileNodeData(
    createSequentialNodeId(101),
    { x: 420, y: 120 },
    'video',
    'file-result-1',
    'video.mp4',
    1024,
    'video/mp4',
    { width: 1280, height: 720, duration: 8 },
    createProducedSource('task-1', 'TASK-1'),
  );

  workflow.nodes['101'] = outputNode;
  workflow.nodes['100'] = {
    ...(workflow.nodes['100'] as AINodeData),
    outputs: ['file-result-1'],
    tasks: [{
      taskId: 'task-1',
      scope: 'group',
      groupId: 'group-1',
      outputHandle: 'group-1:result',
      status: 'completed',
      createdAt: 1,
    }],
  };
  workflow.connections.push({
    id: 'link-1',
    type: 'output-link',
    sourceId: '100',
    targetId: '101',
    sourceHandle: 'group-1:result',
    order: 0,
  });

  assert.deepEqual(getLocallyIncompleteReconcileExecutionNodeIds(workflow), []);
});

test('getLocallyIncompleteReconcileExecutionNodeIds keeps nodes whose expected output handle is missing locally', () => {
  const workflow = createWorkflow();
  const outputNode = createDefaultFileNodeData(
    createSequentialNodeId(101),
    { x: 420, y: 120 },
    'video',
    'file-result-1',
    'video.mp4',
    1024,
    'video/mp4',
    { width: 1280, height: 720, duration: 8 },
    createProducedSource('task-1', 'TASK-1'),
  );

  workflow.nodes['101'] = outputNode;
  workflow.nodes['100'] = {
    ...(workflow.nodes['100'] as AINodeData),
    outputs: ['file-result-1'],
    tasks: [{
      taskId: 'task-1',
      scope: 'group',
      groupId: 'group-1',
      outputHandle: 'group-1:result',
      status: 'completed',
      createdAt: 1,
    }],
  };
  workflow.connections.push({
    id: 'link-1',
    type: 'output-link',
    sourceId: '100',
    targetId: '101',
    sourceHandle: 'group-2:result',
    order: 0,
  });

  assert.deepEqual(getLocallyIncompleteReconcileExecutionNodeIds(workflow), ['100']);
});

test('getReconciliableExecutionNodes skips AI nodes without historical task refs', () => {
  registerExecutionRuntimeNodeAdapter({
    nodeType: 'aiVideoGen',
    executionKind: 'grouped',
    taskType: 'video-gen',
    validateExecution: () => ({ valid: true }),
    createExecutionPayload: () => ({
      nodeId: '100',
      nodeType: 'aiVideoGen',
      nodeTitle: 'video',
      taskType: 'video-gen',
      executionKind: 'grouped',
      request: undefined,
      targets: [],
    }),
    mapSnapshotToRuntimePatch: () => [],
    ...createGroupedExecutionOutputAdapter(),
  }, { override: true });

  const workflow = createWorkflow();
  assert.deepEqual(getReconciliableExecutionNodes(workflow), []);
});

test('reconcileExecutionOutputs rebuilds missing result node, output-link, and source outputs', async () => {
  const previousRegistry = executionRuntimeNodeAdapterRegistry;
  const previousStore = executionRuntimeStore;
  const previousCache = executionOutputCommitCache;
  const previousCommitService = executionOutputCommitService;
  const isolatedRegistry = createExecutionRuntimeNodeAdapterRegistry();
  const isolatedStore = createExecutionRuntimeStore();
  const isolatedCache = createExecutionOutputCommitCache();
  const isolatedCommitService = createExecutionOutputCommitService({
    store: isolatedStore,
    cache: isolatedCache,
  });

  setExecutionRuntimeNodeAdapterRegistry(isolatedRegistry);
  setExecutionRuntimeStore(isolatedStore);
  setExecutionOutputCommitCache(isolatedCache);
  setExecutionOutputCommitService(isolatedCommitService);

  try {
    registerExecutionRuntimeNodeAdapter({
      nodeType: 'aiVideoGen',
      executionKind: 'grouped',
      taskType: 'video-gen',
      validateExecution: () => ({ valid: true }),
      createExecutionPayload: () => ({
        nodeId: '100',
        nodeType: 'aiVideoGen',
        nodeTitle: 'video',
        taskType: 'video-gen',
        executionKind: 'grouped',
        request: undefined,
        targets: [{
          kind: 'group',
          nodeId: '100',
          nodeType: 'aiVideoGen',
          groupId: 'group-1',
          groupOrder: 0,
          outputHandle: 'group-1:result',
        }],
      }),
      mapSnapshotToRuntimePatch: () => [],
      ...createGroupedExecutionOutputAdapter(),
    }, { override: true });

    const workflow = createWorkflow();
    const snapshot = createRunSnapshot();
    isolatedStore.applyRunSnapshot(snapshot);

    let currentWorkflow = workflow;
    const changed = await reconcileExecutionOutputs({
      workflow: currentWorkflow,
      node: currentWorkflow.nodes['100'] as AINodeData,
      snapshot,
      resolveFileUrl: (fileId) => `/api/v1/files/${fileId}/download`,
      applyRuntimeSnapshot: (runtime) => {
        currentWorkflow = {
          ...currentWorkflow,
          nodes: runtime.nodes,
          connections: runtime.connections,
          viewport: runtime.viewport,
          metadata: {
            ...currentWorkflow.metadata,
            ...runtime.metadata,
          },
          timestamp: {
            ...currentWorkflow.timestamp,
            updated: currentWorkflow.timestamp.updated + 1,
          },
        };

        return currentWorkflow;
      },
    });

    assert.equal(changed, true);
    const sourceNode = currentWorkflow.nodes['100'] as AINodeData;
    assert.deepEqual(sourceNode.outputs, ['file-result-1']);

    const outputNodes = Object.values(currentWorkflow.nodes).filter((node) => (
      'fileId' in node && node.fileId === 'file-result-1'
    ));
    assert.equal(outputNodes.length, 1);
    const outputNode = outputNodes[0];
    assert.ok(outputNode);
    if (!outputNode || !('mimeType' in outputNode)) {
      throw new Error('Expected reconciled file node');
    }

    assert.equal(outputNode.type, 'video');
    assert.equal(outputNode.previewUrl, '/files/file-result-1/download');

    const outputLinks = currentWorkflow.connections.filter((connection) => connection.type === 'output-link');
    assert.equal(outputLinks.length, 1);
    assert.equal(outputLinks[0]?.sourceId, '100');
    assert.equal(outputLinks[0]?.targetId, outputNode.id.value);
    assert.equal(outputLinks[0]?.sourceHandle, 'group-1:result');

    assert.equal(
      await shouldReconcileNodeOutputs(currentWorkflow, currentWorkflow.nodes['100'] as AINodeData, snapshot),
      false,
    );
  } finally {
    setExecutionRuntimeNodeAdapterRegistry(previousRegistry);
    setExecutionRuntimeStore(previousStore);
    setExecutionOutputCommitCache(previousCache);
    setExecutionOutputCommitService(previousCommitService);
  }
});

test('reconcileExecutionOutputs appends a new result node when the same source handle receives a different file', async () => {
  const previousRegistry = executionRuntimeNodeAdapterRegistry;
  const previousStore = executionRuntimeStore;
  const previousCache = executionOutputCommitCache;
  const previousCommitService = executionOutputCommitService;
  const isolatedRegistry = createExecutionRuntimeNodeAdapterRegistry();
  const isolatedStore = createExecutionRuntimeStore();
  const isolatedCache = createExecutionOutputCommitCache();
  const isolatedCommitService = createExecutionOutputCommitService({
    store: isolatedStore,
    cache: isolatedCache,
  });

  setExecutionRuntimeNodeAdapterRegistry(isolatedRegistry);
  setExecutionRuntimeStore(isolatedStore);
  setExecutionOutputCommitCache(isolatedCache);
  setExecutionOutputCommitService(isolatedCommitService);

  try {
    registerExecutionRuntimeNodeAdapter({
      nodeType: 'aiVideoGen',
      executionKind: 'grouped',
      taskType: 'video-gen',
      validateExecution: () => ({ valid: true }),
      createExecutionPayload: () => ({
        nodeId: '100',
        nodeType: 'aiVideoGen',
        nodeTitle: 'video',
        taskType: 'video-gen',
        executionKind: 'grouped',
        request: undefined,
        targets: [{
          kind: 'group',
          nodeId: '100',
          nodeType: 'aiVideoGen',
          groupId: 'group-1',
          groupOrder: 0,
          outputHandle: 'group-1:result',
        }],
      }),
      mapSnapshotToRuntimePatch: () => [],
      ...createGroupedExecutionOutputAdapter(),
    }, { override: true });

    let currentWorkflow = createWorkflow();
    const sourceNode = currentWorkflow.nodes['100'] as AINodeData;
    const existingOutputNode = createDefaultFileNodeData(
      createSequentialNodeId(101),
      { x: 920, y: 120 },
      'video',
      'file-result-1',
      'video.mp4',
      1024,
      'video/mp4',
      { width: 1280, height: 720, duration: 8 },
      { type: 'node-output' },
    );

    currentWorkflow.nodes['101'] = {
      ...existingOutputNode,
      previewUrl: '/files/file-result-1/download',
    };
    currentWorkflow.nodes['100'] = {
      ...sourceNode,
      outputs: ['file-result-1'],
    };
    currentWorkflow.connections.push({
      id: 'link-existing',
      type: 'output-link',
      sourceId: '100',
      targetId: '101',
      sourceHandle: 'group-1:result',
      order: 0,
    });
    currentWorkflow.metadata.nodeCount = 2;
    currentWorkflow.metadata.connectionCount = 1;
    currentWorkflow.metadata.lastNodeId = 101;

    const snapshot = createRunSnapshot();
    snapshot.runId = 'run-reconcile-append-1';
    snapshot.runNo = 'RUN-APPEND-1';
    snapshot.tasks = [{
      ...snapshot.tasks[0]!,
      taskId: 'task-reconcile-append-1',
      taskNo: 'TASK-APPEND-1',
      runId: 'run-reconcile-append-1',
      runNo: 'RUN-APPEND-1',
      resultFileId: 'file-result-2',
      resultFile: {
        ...snapshot.tasks[0]!.resultFile!,
        id: 'file-result-2',
        name: 'video-2.mp4',
        originalName: 'video-2.mp4',
        hash: 'hash-2',
        path: '/files/file-result-2/download',
      },
      resultFileInfo: {
        ...snapshot.tasks[0]!.resultFileInfo!,
        id: 'file-result-2',
        name: 'video-2.mp4',
        originalName: 'video-2.mp4',
        hash: 'hash-2',
        path: '/files/file-result-2/download',
      },
    }];
    isolatedStore.applyRunSnapshot(snapshot);

    const changed = await reconcileExecutionOutputs({
      workflow: currentWorkflow,
      node: currentWorkflow.nodes['100'] as AINodeData,
      snapshot,
      resolveFileUrl: (fileId) => `/api/v1/files/${fileId}/download`,
      applyRuntimeSnapshot: (runtime) => {
        currentWorkflow = {
          ...currentWorkflow,
          nodes: runtime.nodes,
          connections: runtime.connections,
          viewport: runtime.viewport,
          metadata: {
            ...currentWorkflow.metadata,
            ...runtime.metadata,
          },
          timestamp: {
            ...currentWorkflow.timestamp,
            updated: currentWorkflow.timestamp.updated + 1,
          },
        };

        return currentWorkflow;
      },
    });

    assert.equal(changed, true);
    const nextSourceNode = currentWorkflow.nodes['100'] as AINodeData;
    assert.deepEqual(nextSourceNode.outputs, ['file-result-1', 'file-result-2']);

    const outputNodes = Object.values(currentWorkflow.nodes).filter((node) => (
      'fileId' in node && (node.fileId === 'file-result-1' || node.fileId === 'file-result-2')
    ));
    const outputLinks = currentWorkflow.connections.filter((connection) => (
      connection.type === 'output-link'
      && connection.sourceId === '100'
      && connection.sourceHandle === 'group-1:result'
    ));

    assert.equal(outputNodes.length, 2);
    assert.equal(outputLinks.length, 2);
    assert.equal(outputNodes.some((node) => node.id.value === '101'), true);
    const appendedNode = outputNodes.find((node) => 'fileId' in node && node.fileId === 'file-result-2');
    assert.ok(appendedNode);
    if (!appendedNode || !('previewUrl' in appendedNode)) {
      throw new Error('Expected appended reconciled output node');
    }

    assert.equal(appendedNode.id.value === '101', false);
    assert.deepEqual(appendedNode.position, { x: 1600, y: 120 });
    assert.equal(appendedNode.previewUrl, '/files/file-result-2/download');
  } finally {
    setExecutionRuntimeNodeAdapterRegistry(previousRegistry);
    setExecutionRuntimeStore(previousStore);
    setExecutionOutputCommitCache(previousCache);
    setExecutionOutputCommitService(previousCommitService);
  }
});

test('reconcileExecutionOutputs restores a missing same-handle output-link without duplicating an existing file node', async () => {
  const previousRegistry = executionRuntimeNodeAdapterRegistry;
  const previousStore = executionRuntimeStore;
  const previousCache = executionOutputCommitCache;
  const previousCommitService = executionOutputCommitService;
  const isolatedRegistry = createExecutionRuntimeNodeAdapterRegistry();
  const isolatedStore = createExecutionRuntimeStore();
  const isolatedCache = createExecutionOutputCommitCache();
  const isolatedCommitService = createExecutionOutputCommitService({
    store: isolatedStore,
    cache: isolatedCache,
  });

  setExecutionRuntimeNodeAdapterRegistry(isolatedRegistry);
  setExecutionRuntimeStore(isolatedStore);
  setExecutionOutputCommitCache(isolatedCache);
  setExecutionOutputCommitService(isolatedCommitService);

  try {
    registerExecutionRuntimeNodeAdapter({
      nodeType: 'aiVideoGen',
      executionKind: 'grouped',
      taskType: 'video-gen',
      validateExecution: () => ({ valid: true }),
      createExecutionPayload: () => ({
        nodeId: '100',
        nodeType: 'aiVideoGen',
        nodeTitle: 'video',
        taskType: 'video-gen',
        executionKind: 'grouped',
        request: undefined,
        targets: [{
          kind: 'group',
          nodeId: '100',
          nodeType: 'aiVideoGen',
          groupId: 'group-1',
          groupOrder: 0,
          outputHandle: 'group-1:result',
        }],
      }),
      mapSnapshotToRuntimePatch: () => [],
      ...createGroupedExecutionOutputAdapter(),
    }, { override: true });

    let currentWorkflow = createWorkflow();
    const sourceNode = currentWorkflow.nodes['100'] as AINodeData;
    const existingOutputNode = createDefaultFileNodeData(
      createSequentialNodeId(101),
      { x: 920, y: 120 },
      'video',
      'file-result-1',
      'video-1.mp4',
      1024,
      'video/mp4',
      { width: 1280, height: 720, duration: 8 },
      createProducedSource('task-reconcile-legacy-1', 'TASK-LEGACY-1'),
    );
    const secondOutputNode = createDefaultFileNodeData(
      createSequentialNodeId(102),
      { x: 1600, y: 120 },
      'video',
      'file-result-2',
      'video-2.mp4',
      1024,
      'video/mp4',
      { width: 1280, height: 720, duration: 8 },
      createProducedSource('task-reconcile-link-restore-1', 'TASK-LINK-RESTORE-1'),
    );

    currentWorkflow.nodes['101'] = {
      ...existingOutputNode,
      previewUrl: '/files/file-result-1/download',
    };
    currentWorkflow.nodes['102'] = {
      ...secondOutputNode,
      previewUrl: '/files/file-result-2/download',
    };
    currentWorkflow.nodes['100'] = {
      ...sourceNode,
      outputs: ['file-result-1', 'file-result-2'],
    };
    currentWorkflow.connections.push({
      id: 'link-existing-1',
      type: 'output-link',
      sourceId: '100',
      targetId: '101',
      sourceHandle: 'group-1:result',
      order: 0,
    });
    currentWorkflow.metadata.nodeCount = 3;
    currentWorkflow.metadata.connectionCount = 1;
    currentWorkflow.metadata.lastNodeId = 102;

    const snapshot = createRunSnapshot();
    snapshot.runId = 'run-reconcile-link-restore-1';
    snapshot.runNo = 'RUN-LINK-RESTORE-1';
    snapshot.tasks = [
      {
        ...snapshot.tasks[0]!,
        taskId: 'task-reconcile-link-restore-1',
        taskNo: 'TASK-LINK-RESTORE-1',
        runId: 'run-reconcile-link-restore-1',
        runNo: 'RUN-LINK-RESTORE-1',
        resultFileId: 'file-result-2',
        resultFile: {
          ...snapshot.tasks[0]!.resultFile!,
          id: 'file-result-2',
          name: 'video-2.mp4',
          originalName: 'video-2.mp4',
          hash: 'hash-2',
          path: '/files/file-result-2/download',
        },
        resultFileInfo: {
          ...snapshot.tasks[0]!.resultFileInfo!,
          id: 'file-result-2',
          name: 'video-2.mp4',
          originalName: 'video-2.mp4',
          hash: 'hash-2',
          path: '/files/file-result-2/download',
        },
      },
    ];
    isolatedStore.applyRunSnapshot(snapshot);

    const changed = await reconcileExecutionOutputs({
      workflow: currentWorkflow,
      node: currentWorkflow.nodes['100'] as AINodeData,
      snapshot,
      resolveFileUrl: (fileId) => `/api/v1/files/${fileId}/download`,
      applyRuntimeSnapshot: (runtime) => {
        currentWorkflow = {
          ...currentWorkflow,
          nodes: runtime.nodes,
          connections: runtime.connections,
          viewport: runtime.viewport,
          metadata: {
            ...currentWorkflow.metadata,
            ...runtime.metadata,
          },
          timestamp: {
            ...currentWorkflow.timestamp,
            updated: currentWorkflow.timestamp.updated + 1,
          },
        };

        return currentWorkflow;
      },
    });

    assert.equal(changed, true);
    const source = currentWorkflow.nodes['100'] as AINodeData;
    const outputNodes = Object.values(currentWorkflow.nodes).filter((node) => (
      'fileId' in node && (node.fileId === 'file-result-1' || node.fileId === 'file-result-2')
    ));
    const outputLinks = currentWorkflow.connections.filter((connection) => (
      connection.type === 'output-link'
      && connection.sourceId === '100'
      && connection.sourceHandle === 'group-1:result'
    ));

    assert.deepEqual(source.outputs, ['file-result-1', 'file-result-2']);
    assert.equal(outputNodes.length, 2);
    assert.equal(outputNodes.filter((node) => 'fileId' in node && node.fileId === 'file-result-2').length, 1);
    assert.equal(outputLinks.length, 2);
    assert.equal(outputLinks.some((connection) => connection.targetId === '101'), true);
    assert.equal(outputLinks.some((connection) => connection.targetId === '102'), true);
    assert.deepEqual(
      outputLinks
      .map((connection) => currentWorkflow.nodes[connection.targetId])
      .filter((candidate): candidate is FileNodeData => Boolean(candidate && 'fileId' in candidate))
      .map((candidate) => [candidate.fileId, candidate.position]),
      [
        ['file-result-1', { x: 920, y: 120 }],
        ['file-result-2', { x: 1600, y: 120 }],
      ],
    );
  } finally {
    setExecutionRuntimeNodeAdapterRegistry(previousRegistry);
    setExecutionRuntimeStore(previousStore);
    setExecutionOutputCommitCache(previousCache);
    setExecutionOutputCommitService(previousCommitService);
  }
});

test('reconcileExecutionOutputs preserves unrelated connections and viewport while repairing missing output results', async () => {
  const previousRegistry = executionRuntimeNodeAdapterRegistry;
  const previousStore = executionRuntimeStore;
  const previousCache = executionOutputCommitCache;
  const previousCommitService = executionOutputCommitService;
  const isolatedRegistry = createExecutionRuntimeNodeAdapterRegistry();
  const isolatedStore = createExecutionRuntimeStore();
  const isolatedCache = createExecutionOutputCommitCache();
  const isolatedCommitService = createExecutionOutputCommitService({
    store: isolatedStore,
    cache: isolatedCache,
  });

  setExecutionRuntimeNodeAdapterRegistry(isolatedRegistry);
  setExecutionRuntimeStore(isolatedStore);
  setExecutionOutputCommitCache(isolatedCache);
  setExecutionOutputCommitService(isolatedCommitService);

  try {
    registerExecutionRuntimeNodeAdapter({
      nodeType: 'aiVideoGen',
      executionKind: 'grouped',
      taskType: 'video-gen',
      validateExecution: () => ({ valid: true }),
      createExecutionPayload: () => ({
        nodeId: '100',
        nodeType: 'aiVideoGen',
        nodeTitle: 'video',
        taskType: 'video-gen',
        executionKind: 'grouped',
        request: undefined,
        targets: [{
          kind: 'group',
          nodeId: '100',
          nodeType: 'aiVideoGen',
          groupId: 'group-1',
          groupOrder: 0,
          outputHandle: 'group-1:result',
        }],
      }),
      mapSnapshotToRuntimePatch: () => [],
      ...createGroupedExecutionOutputAdapter(),
    }, { override: true });

    let currentWorkflow = createWorkflow();
    const unrelatedNode = createDefaultAINodeData(
      createSequentialNodeId(130),
      { x: 1500, y: 320 },
      'aiImageGen',
    ) as AINodeData;
    currentWorkflow.nodes['130'] = unrelatedNode;
    currentWorkflow.connections.push({
      id: 'unrelated-link-1',
      type: 'file-reference',
      sourceId: '130',
      targetId: '100',
      sourceHandle: 'result',
      targetHandle: 'input',
    });
    currentWorkflow.viewport = { x: 320, y: 480, zoom: 1.4 };
    currentWorkflow.metadata.nodeCount = 2;
    currentWorkflow.metadata.connectionCount = 1;
    currentWorkflow.metadata.lastNodeId = 130;

    const snapshot = createRunSnapshot();
    isolatedStore.applyRunSnapshot(snapshot);

    const changed = await reconcileExecutionOutputs({
      workflow: currentWorkflow,
      node: currentWorkflow.nodes['100'] as AINodeData,
      snapshot,
      resolveFileUrl: (fileId) => `/api/v1/files/${fileId}/download`,
      getCurrentWorkflow: () => currentWorkflow,
      applyRuntimeSnapshot: (runtime) => {
        currentWorkflow = {
          ...currentWorkflow,
          nodes: runtime.nodes,
          connections: runtime.connections,
          viewport: runtime.viewport,
          metadata: {
            ...currentWorkflow.metadata,
            ...runtime.metadata,
          },
          timestamp: {
            ...currentWorkflow.timestamp,
            updated: currentWorkflow.timestamp.updated + 1,
          },
        };

        return currentWorkflow;
      },
    });

    assert.equal(changed, true);
    assert.deepEqual(currentWorkflow.viewport, { x: 320, y: 480, zoom: 1.4 });
    assert.equal(
      currentWorkflow.connections.some((connection) => connection.id === 'unrelated-link-1'),
      true,
    );
    assert.equal(
      currentWorkflow.connections.some((connection) => (
        connection.type === 'output-link'
        && connection.sourceId === '100'
        && connection.sourceHandle === 'group-1:result'
      )),
      true,
    );
  } finally {
    setExecutionRuntimeNodeAdapterRegistry(previousRegistry);
    setExecutionRuntimeStore(previousStore);
    setExecutionOutputCommitCache(previousCache);
    setExecutionOutputCommitService(previousCommitService);
  }
});

function createStoryboardShot(overrides: Partial<StoryboardShotData> = {}): StoryboardShotData {
  return {
    id: 'shot-1',
    order: 1,
    row: 0,
    col: 0,
    originalIndex: 1,
    originalTotal: 1,
    sourceNodeId: '10',
    sourceFileId: 'file-source-1',
    sourceImageFileId: 'backend-source-1',
    prompt: 'camera move',
    imageModel: 'gemini-3-pro-image-preview',
    imageAspectRatio: 'auto',
    imageSize: '1K',
    videoModel: 'veo-3.1-landscape-fast-fl',
    videoDuration: 8,
    videoAspectRatio: '16:9',
    videoResolution: '720P',
    imageGenStatus: 'idle',
    videoGenStatus: 'idle',
    ...overrides,
  };
}

function createStoryboardWorkflow(): Workflow {
  const node = {
    ...createDefaultAINodeData(createSequentialNodeId(100), { x: 100, y: 120 }, 'aiStoryboard'),
    outputs: [],
  } as AINodeData;
  node.dimensions = { ...AI_STORYBOARD_DEFAULT_SIZE };
  node.config = {
    ...node.config,
    shots: [createStoryboardShot()],
    processedInputFileIds: ['file-source-1'],
    defaultImageModel: 'gemini-3-pro-image-preview',
    defaultImageAspectRatio: 'auto',
    defaultImageSize: '1K',
    batchVideoModel: 'veo-3.1-landscape-fast-fl',
    batchVideoDuration: 8,
    batchVideoAspectRatio: '16:9',
    batchVideoResolution: '720P',
  };
  node.tasks = [{
    taskId: 'task-storyboard-video-1',
    taskNo: 'TASK-STORYBOARD-VIDEO-1',
    batchId: 'RUN-STORYBOARD-VIDEO-1',
    runId: 'run-storyboard-video-1',
    runNo: 'RUN-STORYBOARD-VIDEO-1',
    taskType: 'video-gen',
    scope: 'group',
    groupId: 'shot-1',
    groupLabel: 'Shot 1',
    groupOrder: 1,
    outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
    status: 'completed',
    createdAt: 1,
    startedAt: 1,
    completedAt: 2,
  }];

  return {
    id: 'workflow-storyboard-reconcile-1',
    projectId: 'project-1',
    name: 'storyboard-reconcile',
    nodes: {
      [node.id.value]: node,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 100,
      canvasSize: { width: 1920, height: 1080 },
      relatedTasks: [{
        taskId: 'task-storyboard-video-1',
        taskNo: 'TASK-STORYBOARD-VIDEO-1',
        batchId: 'RUN-STORYBOARD-VIDEO-1',
        runId: 'run-storyboard-video-1',
        runNo: 'RUN-STORYBOARD-VIDEO-1',
        taskType: 'video-gen',
        nodeId: '100',
        nodeDisplayId: node.id.display,
        nodeType: 'aiStoryboard',
        groupId: 'shot-1',
        groupLabel: 'Shot 1',
        groupOrder: 1,
        outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
      }],
      usedNodeIds: ['100'],
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

function createStoryboardRunSnapshot(options: {
  taskType: 'image' | 'video';
  groupId?: string;
  groupOrder?: number;
  runId?: string;
  runNo?: string;
  taskId?: string;
  taskNo?: string;
  resultFileId?: string;
}): BackendExecutionRunSnapshot {
  const defaultResultFileId = options.taskType === 'image'
    ? 'storyboard-image-result-1'
    : 'storyboard-video-result-1';
  const resultFileId = options.resultFileId ?? defaultResultFileId;
  const resultFileInfo: FileInfo = options.taskType === 'image'
    ? {
      id: resultFileId,
      name: `${resultFileId}.png`,
      originalName: `${resultFileId}.png`,
      size: 1024,
      mimeType: 'image/png',
      format: 'png',
      fileType: 'image' as const,
      status: 'ready' as const,
      hash: `hash-${resultFileId}`,
      path: `/files/${resultFileId}/download`,
      metadata: {
        width: 1024,
        height: 768,
      },
      source: { type: 'node-output' as const },
      timestamp: {
        created: 1,
        updated: 1,
      },
    }
    : {
      id: resultFileId,
      name: `${resultFileId}.mp4`,
      originalName: `${resultFileId}.mp4`,
      size: 2048,
      mimeType: 'video/mp4',
      format: 'mp4',
      fileType: 'video' as const,
      status: 'ready' as const,
      hash: `hash-${resultFileId}`,
      path: `/files/${resultFileId}/download`,
      metadata: {
        width: 1920,
        height: 1080,
        duration: 8,
      },
      source: { type: 'node-output' as const },
      timestamp: {
        created: 1,
        updated: 1,
      },
    };
  const runId = options.runId ?? (options.taskType === 'image' ? 'run-storyboard-image-1' : 'run-storyboard-video-1');
  const runNo = options.runNo ?? (options.taskType === 'image' ? 'RUN-STORYBOARD-IMAGE-1' : 'RUN-STORYBOARD-VIDEO-1');
  const taskId = options.taskId ?? (options.taskType === 'image' ? 'task-storyboard-image-1' : 'task-storyboard-video-1');
  const taskNo = options.taskNo ?? (options.taskType === 'image' ? 'TASK-STORYBOARD-IMAGE-1' : 'TASK-STORYBOARD-VIDEO-1');

  return {
    runId,
    runNo,
    workflowId: 'workflow-storyboard-reconcile-1',
    nodeId: '100',
    nodeType: 'aiStoryboard',
    status: 'completed',
    totalTaskCount: 1,
    completedTaskCount: 1,
    failedTaskCount: 0,
    progress: 100,
    message: 'done',
    createdAt: 1,
    startedAt: 2,
    completedAt: 3,
    isTerminal: true,
    hasCommittableOutput: true,
    allOutputsCommitted: false,
    tasks: [{
      taskId,
      taskNo,
      runId,
      runNo,
      nodeId: '100',
      nodeType: 'aiStoryboard',
      groupId: options.groupId ?? 'shot-1',
      groupOrder: options.groupOrder ?? 0,
      status: 'completed',
      currentStep: 'final',
      currentAttemptNo: 1,
      retryCount: 0,
      maxRetries: 2,
      maxAttempts: 3,
      progress: 100,
      message: options.taskType === 'image' ? 'image done' : 'video done',
      error: null,
      errorCode: null,
      lastErrorCode: null,
      resultFileId: resultFileInfo.id,
      resultCommitStatus: 'ready',
      resultCommittedAt: null,
      resultCommitError: null,
      canCommitOutput: true,
      isTerminal: true,
      isOutputCommitted: false,
      resultFile: resultFileInfo,
      resultFileInfo,
    }],
  };
}

function setStoryboardTaskRef(
  workflow: Workflow,
  options: {
    taskType: 'image' | 'video';
    runId?: string;
    taskId?: string;
  },
): void {
  const node = workflow.nodes['100'] as AINodeData;
  const taskId = options.taskId ?? (options.taskType === 'image' ? 'task-storyboard-image-1' : 'task-storyboard-video-1');
  const runId = options.runId ?? (options.taskType === 'image' ? 'run-storyboard-image-1' : 'run-storyboard-video-1');
  const runNo = options.taskType === 'image' ? 'RUN-STORYBOARD-IMAGE-1' : 'RUN-STORYBOARD-VIDEO-1';
  const taskNo = options.taskType === 'image' ? 'TASK-STORYBOARD-IMAGE-1' : 'TASK-STORYBOARD-VIDEO-1';
  const taskType = options.taskType === 'image' ? 'image-gen' : 'video-gen';

  node.tasks = [{
    taskId,
    taskNo,
    batchId: runNo,
    runId,
    runNo,
    taskType,
    scope: 'group',
    groupId: 'shot-1',
    groupLabel: 'Shot 1',
    groupOrder: 1,
    outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
    status: 'completed',
    createdAt: 1,
    startedAt: 1,
    completedAt: 2,
  }];

  workflow.metadata.relatedTasks = [{
    taskId,
    taskNo,
    batchId: runNo,
    runId,
    runNo,
    taskType,
    nodeId: '100',
    nodeDisplayId: node.id.display,
    nodeType: 'aiStoryboard',
    groupId: 'shot-1',
    groupLabel: 'Shot 1',
    groupOrder: 1,
    outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
  }];
}

test('shouldReconcileNodeOutputs respects adapter custom committed-state check', async () => {
  const previousRegistry = executionRuntimeNodeAdapterRegistry;
  const isolatedRegistry = createExecutionRuntimeNodeAdapterRegistry();

  setExecutionRuntimeNodeAdapterRegistry(isolatedRegistry);

  try {
    registerExecutionRuntimeNodeAdapter({
      nodeType: 'aiVideoGen',
      executionKind: 'grouped',
      taskType: 'video-gen',
      validateExecution: () => ({ valid: true }),
      createExecutionPayload: () => ({
        nodeId: '100',
        nodeType: 'aiVideoGen',
        nodeTitle: 'video',
        taskType: 'video-gen',
        executionKind: 'grouped',
        request: undefined,
        targets: [],
      }),
      mapSnapshotToRuntimePatch: () => [],
      ...createGroupedExecutionOutputAdapter(),
      isOutputCommitted: ({ output }) => output.resultFileId === 'file-result-1',
    }, { override: true });

    const workflow = createWorkflow();
    const snapshot = createRunSnapshot();

    assert.equal(await shouldReconcileNodeOutputs(workflow, workflow.nodes['100'] as AINodeData, snapshot), false);
  } finally {
    setExecutionRuntimeNodeAdapterRegistry(previousRegistry);
  }
});

test('getReconciliableExecutionNodes includes aiStoryboard with historical task refs', () => {
  const previousRegistry = executionRuntimeNodeAdapterRegistry;
  const isolatedRegistry = createExecutionRuntimeNodeAdapterRegistry();
  setExecutionRuntimeNodeAdapterRegistry(isolatedRegistry);

  try {
    registerExecutionRuntimeNodeAdapter(aiStoryboardExecutionRuntimeAdapter, { override: true });
    const workflow = createStoryboardWorkflow();
    assert.deepEqual(getReconciliableExecutionNodes(workflow).map((node) => node.id.value), ['100']);
  } finally {
    setExecutionRuntimeNodeAdapterRegistry(previousRegistry);
  }
});

test('getReconciliableExecutionNodes skips aiStoryboard without persisted historical task refs', () => {
  const previousRegistry = executionRuntimeNodeAdapterRegistry;
  const isolatedRegistry = createExecutionRuntimeNodeAdapterRegistry();
  setExecutionRuntimeNodeAdapterRegistry(isolatedRegistry);

  try {
    registerExecutionRuntimeNodeAdapter(aiStoryboardExecutionRuntimeAdapter, { override: true });
    const workflow = createStoryboardWorkflow();
    (workflow.nodes['100'] as AINodeData).tasks = [];
    workflow.metadata.relatedTasks = [];

    assert.deepEqual(getReconciliableExecutionNodes(workflow), []);
  } finally {
    setExecutionRuntimeNodeAdapterRegistry(previousRegistry);
  }
});

test('reconcileExecutionOutputs writes storyboard image result to the shot output handle', async () => {
  const previousRegistry = executionRuntimeNodeAdapterRegistry;
  const previousStore = executionRuntimeStore;
  const previousCache = executionOutputCommitCache;
  const previousCommitService = executionOutputCommitService;
  const isolatedRegistry = createExecutionRuntimeNodeAdapterRegistry();
  const isolatedStore = createExecutionRuntimeStore();
  const isolatedCache = createExecutionOutputCommitCache();
  const isolatedCommitService = createExecutionOutputCommitService({
    store: isolatedStore,
    cache: isolatedCache,
  });

  setExecutionRuntimeNodeAdapterRegistry(isolatedRegistry);
  setExecutionRuntimeStore(isolatedStore);
  setExecutionOutputCommitCache(isolatedCache);
  setExecutionOutputCommitService(isolatedCommitService);

  try {
    registerExecutionRuntimeNodeAdapter(aiStoryboardExecutionRuntimeAdapter, { override: true });
    const snapshot = createStoryboardRunSnapshot({ taskType: 'image' });
    isolatedStore.applyRunSnapshot(snapshot);

    let currentWorkflow = createStoryboardWorkflow();
    setStoryboardTaskRef(currentWorkflow, { taskType: 'image' });
    const changed = await reconcileExecutionOutputs({
      workflow: currentWorkflow,
      node: currentWorkflow.nodes['100'] as AINodeData,
      snapshot,
      resolveFileUrl: (fileId) => `/api/v1/files/${fileId}/download`,
      applyRuntimeSnapshot: (runtime) => {
        currentWorkflow = {
          ...currentWorkflow,
          nodes: runtime.nodes,
          connections: runtime.connections,
          viewport: runtime.viewport,
          metadata: {
            ...currentWorkflow.metadata,
            ...runtime.metadata,
          },
          timestamp: {
            ...currentWorkflow.timestamp,
            updated: currentWorkflow.timestamp.updated + 1,
          },
        };
        return currentWorkflow;
      },
    });

    assert.equal(changed, true);
    assert.deepEqual((currentWorkflow.nodes['100'] as AINodeData).outputs, ['storyboard-image-result-1']);
    const outputNodes = Object.values(currentWorkflow.nodes).filter((node) => (
      'fileId' in node && node.fileId === 'storyboard-image-result-1'
    ));
    assert.equal(outputNodes.length, 1);
    const outputNode = outputNodes[0];
    assert.ok(outputNode);
    if (!outputNode || !('mimeType' in outputNode)) {
      throw new Error('Expected reconciled storyboard image file node');
    }

    assert.equal(outputNode.type, 'image');
    const outputLinks = currentWorkflow.connections.filter((connection) => connection.type === 'output-link');
    assert.equal(outputLinks.length, 1);
    assert.equal(outputLinks[0]?.sourceId, '100');
    assert.equal(outputLinks[0]?.targetId, outputNode.id.value);
    assert.equal(outputLinks[0]?.sourceHandle, getAIStoryboardShotOutputHandle('shot-1'));
    assert.equal(
      await shouldReconcileNodeOutputs(currentWorkflow, currentWorkflow.nodes['100'] as AINodeData, snapshot),
      false,
    );
  } finally {
    setExecutionRuntimeNodeAdapterRegistry(previousRegistry);
    setExecutionRuntimeStore(previousStore);
    setExecutionOutputCommitCache(previousCache);
    setExecutionOutputCommitService(previousCommitService);
  }
});

test('reconcileExecutionOutputs writes storyboard video result to the shot output handle', async () => {
  const previousRegistry = executionRuntimeNodeAdapterRegistry;
  const previousStore = executionRuntimeStore;
  const previousCache = executionOutputCommitCache;
  const previousCommitService = executionOutputCommitService;
  const isolatedRegistry = createExecutionRuntimeNodeAdapterRegistry();
  const isolatedStore = createExecutionRuntimeStore();
  const isolatedCache = createExecutionOutputCommitCache();
  const isolatedCommitService = createExecutionOutputCommitService({
    store: isolatedStore,
    cache: isolatedCache,
  });

  setExecutionRuntimeNodeAdapterRegistry(isolatedRegistry);
  setExecutionRuntimeStore(isolatedStore);
  setExecutionOutputCommitCache(isolatedCache);
  setExecutionOutputCommitService(isolatedCommitService);

  try {
    registerExecutionRuntimeNodeAdapter(aiStoryboardExecutionRuntimeAdapter, { override: true });
    const snapshot = createStoryboardRunSnapshot({ taskType: 'video' });
    isolatedStore.applyRunSnapshot(snapshot);

    let currentWorkflow = createStoryboardWorkflow();
    setStoryboardTaskRef(currentWorkflow, { taskType: 'video' });
    const changed = await reconcileExecutionOutputs({
      workflow: currentWorkflow,
      node: currentWorkflow.nodes['100'] as AINodeData,
      snapshot,
      resolveFileUrl: (fileId) => `/api/v1/files/${fileId}/download`,
      applyRuntimeSnapshot: (runtime) => {
        currentWorkflow = {
          ...currentWorkflow,
          nodes: runtime.nodes,
          connections: runtime.connections,
          viewport: runtime.viewport,
          metadata: {
            ...currentWorkflow.metadata,
            ...runtime.metadata,
          },
          timestamp: {
            ...currentWorkflow.timestamp,
            updated: currentWorkflow.timestamp.updated + 1,
          },
        };
        return currentWorkflow;
      },
    });

    assert.equal(changed, true);
    assert.deepEqual((currentWorkflow.nodes['100'] as AINodeData).outputs, ['storyboard-video-result-1']);
    const outputNodes = Object.values(currentWorkflow.nodes).filter((node) => (
      'fileId' in node && node.fileId === 'storyboard-video-result-1'
    ));
    assert.equal(outputNodes.length, 1);
    const outputNode = outputNodes[0];
    assert.ok(outputNode);
    if (!outputNode || !('mimeType' in outputNode)) {
      throw new Error('Expected reconciled storyboard video file node');
    }

    assert.equal(outputNode.type, 'video');
    const outputLinks = currentWorkflow.connections.filter((connection) => connection.type === 'output-link');
    assert.equal(outputLinks.length, 1);
    assert.equal(outputLinks[0]?.sourceId, '100');
    assert.equal(outputLinks[0]?.targetId, outputNode.id.value);
    assert.equal(outputLinks[0]?.sourceHandle, getAIStoryboardShotOutputHandle('shot-1'));
    assert.equal(
      await shouldReconcileNodeOutputs(currentWorkflow, currentWorkflow.nodes['100'] as AINodeData, snapshot),
      false,
    );
  } finally {
    setExecutionRuntimeNodeAdapterRegistry(previousRegistry);
    setExecutionRuntimeStore(previousStore);
    setExecutionOutputCommitCache(previousCache);
    setExecutionOutputCommitService(previousCommitService);
  }
});

test('reconcileExecutionOutputs appends each storyboard video result as a separate right-side output node', async () => {
  const previousRegistry = executionRuntimeNodeAdapterRegistry;
  const previousStore = executionRuntimeStore;
  const previousCache = executionOutputCommitCache;
  const previousCommitService = executionOutputCommitService;
  const isolatedRegistry = createExecutionRuntimeNodeAdapterRegistry();
  const isolatedStore = createExecutionRuntimeStore();
  const isolatedCache = createExecutionOutputCommitCache();
  const isolatedCommitService = createExecutionOutputCommitService({
    store: isolatedStore,
    cache: isolatedCache,
  });

  setExecutionRuntimeNodeAdapterRegistry(isolatedRegistry);
  setExecutionRuntimeStore(isolatedStore);
  setExecutionOutputCommitCache(isolatedCache);
  setExecutionOutputCommitService(isolatedCommitService);

  try {
    registerExecutionRuntimeNodeAdapter(aiStoryboardExecutionRuntimeAdapter, { override: true });
    const firstSnapshot = createStoryboardRunSnapshot({
      taskType: 'video',
      groupId: 'shot-1',
      groupOrder: 0,
      runId: 'run-storyboard-video-1',
      runNo: 'RUN-STORYBOARD-VIDEO-1',
      taskId: 'task-storyboard-video-1',
      taskNo: 'TASK-STORYBOARD-VIDEO-1',
      resultFileId: 'storyboard-video-result-1',
    });
    const secondSnapshot = createStoryboardRunSnapshot({
      taskType: 'video',
      groupId: 'shot-2',
      groupOrder: 1,
      runId: 'run-storyboard-video-2',
      runNo: 'RUN-STORYBOARD-VIDEO-2',
      taskId: 'task-storyboard-video-2',
      taskNo: 'TASK-STORYBOARD-VIDEO-2',
      resultFileId: 'storyboard-video-result-2',
    });
    isolatedStore.applyRunSnapshot(firstSnapshot);
    isolatedStore.applyRunSnapshot(secondSnapshot);

    let currentWorkflow = createStoryboardWorkflow();
    setStoryboardTaskRef(currentWorkflow, {
      taskType: 'video',
      runId: 'run-storyboard-video-1',
      taskId: 'task-storyboard-video-1',
    });
    const storyboardNode = currentWorkflow.nodes['100'] as AINodeData;
    storyboardNode.tasks = [
      ...storyboardNode.tasks,
      {
        taskId: 'task-storyboard-video-2',
        taskNo: 'TASK-STORYBOARD-VIDEO-2',
        batchId: 'RUN-STORYBOARD-VIDEO-2',
        runId: 'run-storyboard-video-2',
        runNo: 'RUN-STORYBOARD-VIDEO-2',
        taskType: 'video-gen',
        scope: 'group',
        groupId: 'shot-2',
        groupLabel: 'Shot 2',
        groupOrder: 2,
        outputHandle: getAIStoryboardShotOutputHandle('shot-2'),
        status: 'completed',
        createdAt: 2,
        startedAt: 2,
        completedAt: 3,
      },
    ];
    currentWorkflow.metadata.relatedTasks = [
      ...(currentWorkflow.metadata.relatedTasks ?? []),
      {
        taskId: 'task-storyboard-video-2',
        taskNo: 'TASK-STORYBOARD-VIDEO-2',
        batchId: 'RUN-STORYBOARD-VIDEO-2',
        runId: 'run-storyboard-video-2',
        runNo: 'RUN-STORYBOARD-VIDEO-2',
        taskType: 'video-gen',
        nodeId: '100',
        nodeDisplayId: storyboardNode.id.display,
        nodeType: 'aiStoryboard',
        groupId: 'shot-2',
        groupLabel: 'Shot 2',
        groupOrder: 2,
        outputHandle: getAIStoryboardShotOutputHandle('shot-2'),
      },
    ];

    const applyRuntimeSnapshot = (runtime: WorkflowRuntimeSnapshot) => {
      currentWorkflow = {
        ...currentWorkflow,
        nodes: runtime.nodes,
        connections: runtime.connections,
        viewport: runtime.viewport,
        metadata: {
          ...currentWorkflow.metadata,
          ...runtime.metadata,
        },
        timestamp: {
          ...currentWorkflow.timestamp,
          updated: currentWorkflow.timestamp.updated + 1,
        },
      };
      return currentWorkflow;
    };

    assert.equal(await reconcileExecutionOutputs({
      workflow: currentWorkflow,
      node: currentWorkflow.nodes['100'] as AINodeData,
      snapshot: firstSnapshot,
      resolveFileUrl: (fileId) => `/api/v1/files/${fileId}/download`,
      applyRuntimeSnapshot,
    }), true);
    assert.equal(await reconcileExecutionOutputs({
      workflow: currentWorkflow,
      node: currentWorkflow.nodes['100'] as AINodeData,
      snapshot: secondSnapshot,
      resolveFileUrl: (fileId) => `/api/v1/files/${fileId}/download`,
      applyRuntimeSnapshot,
    }), true);

    const sourceNode = currentWorkflow.nodes['100'] as AINodeData;
    assert.deepEqual(sourceNode.outputs, ['storyboard-video-result-1', 'storyboard-video-result-2']);

    const outputNodes = Object.values(currentWorkflow.nodes).filter((node) => (
      'fileId' in node
      && (node.fileId === 'storyboard-video-result-1' || node.fileId === 'storyboard-video-result-2')
    ));
    const outputLinks = currentWorkflow.connections.filter((connection) => (
      connection.type === 'output-link'
      && connection.sourceId === '100'
      && (
        connection.sourceHandle === getAIStoryboardShotOutputHandle('shot-1')
        || connection.sourceHandle === getAIStoryboardShotOutputHandle('shot-2')
      )
    ));

    assert.equal(outputNodes.length, 2);
    assert.equal(new Set(outputNodes.map((node) => node.id.value)).size, 2);
    assert.equal(outputLinks.length, 2);
    assert.equal(
      outputNodes.every((node) => node.position.x > sourceNode.position.x + sourceNode.dimensions.width),
      true,
    );
    const orderedOutputNodes = outputNodes
      .slice()
      .sort((left, right) => left.position.y - right.position.y || left.position.x - right.position.x);
    assert.equal(
      orderedOutputNodes.every((node) => node.position.x === orderedOutputNodes[0]?.position.x),
      true,
    );
    assert.equal(
      orderedOutputNodes[0]?.position.x,
      sourceNode.position.x + Math.max(sourceNode.dimensions.width, AI_STORYBOARD_DEFAULT_SIZE.width) + 180,
    );
    assert.equal(orderedOutputNodes[0]?.position.y, sourceNode.position.y);
    assert.equal(orderedOutputNodes[1]?.position.y > orderedOutputNodes[0]?.position.y, true);
    assert.deepEqual(
      outputLinks.map((connection) => currentWorkflow.nodes[connection.targetId])
        .filter((node): node is FileNodeData => Boolean(node && 'fileId' in node))
        .map((node) => node.fileId)
        .sort(),
      ['storyboard-video-result-1', 'storyboard-video-result-2'],
    );

    assert.equal(
      await shouldReconcileNodeOutputs(currentWorkflow, currentWorkflow.nodes['100'] as AINodeData, firstSnapshot),
      false,
    );
    assert.equal(
      await shouldReconcileNodeOutputs(currentWorkflow, currentWorkflow.nodes['100'] as AINodeData, secondSnapshot),
      false,
    );
  } finally {
    setExecutionRuntimeNodeAdapterRegistry(previousRegistry);
    setExecutionRuntimeStore(previousStore);
    setExecutionOutputCommitCache(previousCache);
    setExecutionOutputCommitService(previousCommitService);
  }
});

test('shouldReconcileNodeOutputs skips stale storyboard image snapshots when a newer task ref already owns the shot output slot', async () => {
  const previousRegistry = executionRuntimeNodeAdapterRegistry;
  const isolatedRegistry = createExecutionRuntimeNodeAdapterRegistry();
  setExecutionRuntimeNodeAdapterRegistry(isolatedRegistry);

  try {
    registerExecutionRuntimeNodeAdapter(aiStoryboardExecutionRuntimeAdapter, { override: true });
    const workflow = createStoryboardWorkflow();
    const node = workflow.nodes['100'] as AINodeData;
    node.tasks = [{
      taskId: 'task-storyboard-image-new',
      taskNo: 'TASK-STORYBOARD-IMAGE-NEW',
      batchId: 'RUN-STORYBOARD-IMAGE-NEW',
      runId: 'run-storyboard-image-new',
      runNo: 'RUN-STORYBOARD-IMAGE-NEW',
      taskType: 'image-gen',
      scope: 'group',
      groupId: 'shot-1',
      groupLabel: 'Shot 1',
      groupOrder: 1,
      outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
      status: 'completed',
      createdAt: 2,
      startedAt: 2,
      completedAt: 3,
    }];
    workflow.metadata.relatedTasks = [{
      taskId: 'task-storyboard-image-new',
      taskNo: 'TASK-STORYBOARD-IMAGE-NEW',
      batchId: 'RUN-STORYBOARD-IMAGE-NEW',
      runId: 'run-storyboard-image-new',
      runNo: 'RUN-STORYBOARD-IMAGE-NEW',
      taskType: 'image-gen',
      nodeId: '100',
      nodeDisplayId: node.id.display,
      nodeType: 'aiStoryboard',
      groupId: 'shot-1',
      groupLabel: 'Shot 1',
      groupOrder: 1,
      outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
    }];

    const staleSnapshot = createStoryboardRunSnapshot({ taskType: 'image' });

    assert.equal(await shouldReconcileNodeOutputs(workflow, node, staleSnapshot), false);
  } finally {
    setExecutionRuntimeNodeAdapterRegistry(previousRegistry);
  }
});

test('reconcileExecutionOutputs restores storyboard outputs from legacy task refs without output handle or task type', async () => {
  const previousRegistry = executionRuntimeNodeAdapterRegistry;
  const previousStore = executionRuntimeStore;
  const previousCache = executionOutputCommitCache;
  const previousCommitService = executionOutputCommitService;
  const isolatedRegistry = createExecutionRuntimeNodeAdapterRegistry();
  const isolatedStore = createExecutionRuntimeStore();
  const isolatedCache = createExecutionOutputCommitCache();
  const isolatedCommitService = createExecutionOutputCommitService({
    store: isolatedStore,
    cache: isolatedCache,
  });

  setExecutionRuntimeNodeAdapterRegistry(isolatedRegistry);
  setExecutionRuntimeStore(isolatedStore);
  setExecutionOutputCommitCache(isolatedCache);
  setExecutionOutputCommitService(isolatedCommitService);

  try {
    registerExecutionRuntimeNodeAdapter(aiStoryboardExecutionRuntimeAdapter, { override: true });
    const snapshot = createStoryboardRunSnapshot({ taskType: 'image' });
    isolatedStore.applyRunSnapshot(snapshot);

    let currentWorkflow = createStoryboardWorkflow();
    const storyboardNode = currentWorkflow.nodes['100'] as AINodeData;
    storyboardNode.tasks = [{
      taskId: 'task-storyboard-image-1',
      taskNo: 'TASK-STORYBOARD-IMAGE-1',
      batchId: 'RUN-STORYBOARD-IMAGE-1',
      runId: 'run-storyboard-image-1',
      runNo: 'RUN-STORYBOARD-IMAGE-1',
      scope: 'group',
      groupId: 'shot-1',
      groupLabel: 'Shot 1',
      groupOrder: 1,
      status: 'completed',
      createdAt: 1,
      startedAt: 1,
      completedAt: 2,
    }];
    currentWorkflow.metadata.relatedTasks = [{
      taskId: 'task-storyboard-image-1',
      taskNo: 'TASK-STORYBOARD-IMAGE-1',
      batchId: 'RUN-STORYBOARD-IMAGE-1',
      runId: 'run-storyboard-image-1',
      runNo: 'RUN-STORYBOARD-IMAGE-1',
      nodeId: '100',
      nodeDisplayId: storyboardNode.id.display,
      nodeType: 'aiStoryboard',
      groupId: 'shot-1',
      groupLabel: 'Shot 1',
      groupOrder: 1,
    }];

    const changed = await reconcileExecutionOutputs({
      workflow: currentWorkflow,
      node: currentWorkflow.nodes['100'] as AINodeData,
      snapshot,
      resolveFileUrl: (fileId) => `/api/v1/files/${fileId}/download`,
      applyRuntimeSnapshot: (runtime) => {
        currentWorkflow = {
          ...currentWorkflow,
          nodes: runtime.nodes,
          connections: runtime.connections,
          viewport: runtime.viewport,
          metadata: {
            ...currentWorkflow.metadata,
            ...runtime.metadata,
          },
          timestamp: {
            ...currentWorkflow.timestamp,
            updated: currentWorkflow.timestamp.updated + 1,
          },
        };
        return currentWorkflow;
      },
    });

    assert.equal(changed, true);
    assert.deepEqual((currentWorkflow.nodes['100'] as AINodeData).outputs, ['storyboard-image-result-1']);
    const outputLink = currentWorkflow.connections.find((connection) => connection.type === 'output-link');
    assert.ok(outputLink);
    assert.equal(outputLink?.sourceHandle, getAIStoryboardShotOutputHandle('shot-1'));
    assert.equal(
      await shouldReconcileNodeOutputs(currentWorkflow, currentWorkflow.nodes['100'] as AINodeData, snapshot),
      false,
    );
  } finally {
    setExecutionRuntimeNodeAdapterRegistry(previousRegistry);
    setExecutionRuntimeStore(previousStore);
    setExecutionOutputCommitCache(previousCache);
    setExecutionOutputCommitService(previousCommitService);
  }
});
