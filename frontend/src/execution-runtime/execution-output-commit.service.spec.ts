import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowRuntimeSnapshot } from '@/contracts/workflow';
import { performanceTracker } from '@/utils/performance/PerformanceTracker';
import {
  createDefaultAINodeData,
  createDefaultFileNodeData,
  createSequentialNodeId,
} from '@/utils/node/create';
import type { AINodeData, FileInfo, Workflow } from '@/types';
import { createExecutionOutputCommitCache } from './execution-output-commit.cache';
import { createExecutionOutputCommitService } from './execution-output-commit.service';
import { createExecutionRuntimeStore } from './execution-runtime.store';
import {
  createLegacyGroupedExecutionOutputCommitInput,
  createPayloadExecutionOutputCommitInput,
  resolveWorkflowExecutionOutputCommitRequest,
} from '@/execution-runtime/execution-output-commit.workflow';
import type {
  ExecutionRuntimeGroupedNodeAdapter,
  ExecutionRuntimeNodeAdapterContext,
  ExecutionRuntimeNodeOutputAdapter,
} from './node-execution-adapter.types';
import type {
  ExecutionOutputCommitWorkflowInput,
  LegacyBackendExecutionTarget,
} from './execution-output-commit.types';
import type {
  ExecutionRuntimeGroupedNodeExecutionTarget,
  ExecutionRuntimeNodeExecutionPayload,
  ExecutionRuntimeSingleNodeExecutionTarget,
} from './node-execution.types';
import type {
  ExecutionRuntimeRunState,
  ExecutionRuntimeTaskState,
} from './execution-runtime.types';

performanceTracker.destroy();

function createTask(
  overrides: Partial<ExecutionRuntimeTaskState> = {},
): ExecutionRuntimeTaskState {
  const taskId = overrides.taskId ?? 'task-1';
  const runId = overrides.runId ?? 'run-1';
  const runNo = overrides.runNo ?? 'RUN-1';

  return {
    taskId,
    taskNo: overrides.taskNo ?? `TASK-${taskId}`,
    runId,
    runNo,
    nodeId: overrides.nodeId ?? '100',
    nodeType: overrides.nodeType ?? 'aiModelRenderTransfer',
    groupId: overrides.groupId ?? 'group-1',
    groupOrder: overrides.groupOrder ?? 0,
    status: overrides.status ?? 'completed',
    currentStep: overrides.currentStep ?? 'final',
    currentAttemptNo: overrides.currentAttemptNo ?? 1,
    retryCount: overrides.retryCount ?? 0,
    maxRetries: overrides.maxRetries ?? 2,
    maxAttempts: overrides.maxAttempts ?? 3,
    progress: overrides.progress ?? 100,
    message: overrides.message ?? '完成',
    output: overrides.output,
    error: overrides.error ?? null,
    errorCode: overrides.errorCode ?? null,
    lastErrorCode: overrides.lastErrorCode ?? null,
    resultFileId: overrides.resultFileId ?? 'result-1',
    resultFile: overrides.resultFile,
    resultFileInfo: overrides.resultFileInfo,
    resultCommitStatus: overrides.resultCommitStatus ?? 'ready',
    resultCommittedAt: overrides.resultCommittedAt ?? null,
    resultCommitError: overrides.resultCommitError ?? null,
    canCommitOutput: overrides.canCommitOutput ?? true,
    isTerminal: overrides.isTerminal ?? true,
    isOutputCommitted: overrides.isOutputCommitted ?? false,
  };
}

function createRun(
  overrides: Partial<ExecutionRuntimeRunState> = {},
): ExecutionRuntimeRunState {
  const runId = overrides.runId ?? 'run-1';
  const runNo = overrides.runNo ?? 'RUN-1';
  const tasks = overrides.tasks ?? [
    createTask({
      runId,
      runNo,
      nodeId: overrides.nodeId ?? '100',
    }),
  ];

  return {
    runId,
    runNo,
    workflowId: overrides.workflowId ?? 'workflow-1',
    nodeId: overrides.nodeId ?? '100',
    nodeType: overrides.nodeType ?? 'aiModelRenderTransfer',
    status: overrides.status ?? 'completed',
    totalTaskCount: overrides.totalTaskCount ?? tasks.length,
    completedTaskCount: overrides.completedTaskCount ?? tasks.length,
    failedTaskCount: overrides.failedTaskCount ?? 0,
    progress: overrides.progress ?? 100,
    message: overrides.message ?? '完成',
    createdAt: overrides.createdAt ?? 1,
    startedAt: overrides.startedAt ?? 2,
    completedAt: overrides.completedAt ?? 3,
    isTerminal: overrides.isTerminal ?? true,
    hasCommittableOutput: overrides.hasCommittableOutput ?? true,
    allOutputsCommitted: overrides.allOutputsCommitted ?? false,
    tasks,
  };
}

function createFileInfo(id: string, name: string): FileInfo {
  return {
    id,
    name,
    originalName: name,
    size: 1024,
    mimeType: 'image/png',
    format: 'png',
    fileType: 'image',
    status: 'ready',
    hash: `hash-${id}`,
    path: `/files/${id}`,
    metadata: {
      width: 1024,
      height: 768,
    },
    source: {
      type: 'node-output',
      producerNodeId: '100',
      producerNodeDisplayId: '#00100',
      producerNodeType: 'aiModelRenderTransfer',
      taskId: `task-${id}`,
      taskNo: `TASK-${id}`,
      taskCreatedAt: 1,
      taskStartedAt: 2,
      taskCompletedAt: 3,
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

function createVideoFileInfo(id: string, name: string): FileInfo {
  return {
    id,
    name,
    originalName: name,
    size: 2048,
    mimeType: 'video/mp4',
    format: 'mp4',
    fileType: 'video',
    status: 'ready',
    hash: `hash-${id}`,
    path: `/files/${id}/download`,
    metadata: {
      width: 1920,
      height: 1080,
      duration: 8,
    },
    source: {
      type: 'node-output',
      producerNodeId: '100',
      producerNodeDisplayId: '#00100',
      producerNodeType: 'aiVideoGen',
      taskId: `task-${id}`,
      taskNo: `TASK-${id}`,
      taskCreatedAt: 1,
      taskStartedAt: 2,
      taskCompletedAt: 3,
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

function createWorkflow(nodeId: string): Workflow {
  const sourceNode: AINodeData = {
    ...createDefaultAINodeData(
      createSequentialNodeId(Number(nodeId)),
      { x: 100, y: 200 },
      'aiModelRenderTransfer',
    ),
    outputs: [],
  };

  return {
    id: 'workflow-1',
    projectId: 'project-1',
    name: '测试画布',
    nodes: {
      [nodeId]: sourceNode,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: Number(nodeId),
      canvasSize: {
        width: 1920,
        height: 1080,
      },
      relatedTasks: [],
      usedNodeIds: [nodeId],
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

function createGroupedAdapter(): ExecutionRuntimeNodeOutputAdapter<
  unknown,
  ExecutionRuntimeGroupedNodeExecutionTarget
> {
  return {
    outputCommitMode: 'incremental',
    extractExecutionOutputs: (snapshot, context) => snapshot.tasks
      .filter((task) => task.status === 'completed' && task.resultFileId)
      .map((task) => {
        const groupTarget = context.payload.targets.find((target) => target.groupId === task.groupId);

        return {
          nodeId: context.payload.nodeId,
          runId: snapshot.runId,
          taskId: task.taskId,
          resultFileId: task.resultFileId as string,
          groupId: task.groupId,
          groupOrder: groupTarget?.groupOrder ?? task.groupOrder,
          sourceHandle: groupTarget?.outputHandle,
          resultFile: task.resultFileInfo ?? task.resultFile,
        };
      }),
  };
}

function createAdapterContext(nodeId: string): ExecutionRuntimeNodeAdapterContext {
  const workflow = createWorkflow(nodeId);

  return {
    workflowId: workflow.id,
    workflow,
    node: workflow.nodes[nodeId] as AINodeData,
    nodeTitle: '白模图迁移渲染',
    inputs: [],
    resolvedInputGroups: [],
    signal: undefined,
    services: {},
  };
}

function createGroupedPayload(
  nodeId: string,
): ExecutionRuntimeNodeExecutionPayload<unknown, ExecutionRuntimeGroupedNodeExecutionTarget> {
  return {
    nodeId,
    nodeType: 'aiModelRenderTransfer',
    nodeTitle: '白模图迁移渲染',
    taskType: 'model-render-transfer',
    executionKind: 'grouped',
    request: {},
    targets: [
      {
        kind: 'group',
        nodeId,
        nodeType: 'aiModelRenderTransfer',
        groupId: 'group-1',
        groupOrder: 0,
        groupLabel: 'Group 1',
        outputHandle: 'group-1:result',
      },
    ],
  };
}

function createWorkflowAccess(workflow: Workflow) {
  let currentWorkflow = workflow;

  return {
    getCurrentWorkflow: () => currentWorkflow,
    applyRuntimeSnapshot: (runtime: WorkflowRuntimeSnapshot) => {
      currentWorkflow = {
        ...currentWorkflow,
        nodes: runtime.nodes,
        connections: runtime.connections,
        viewport: runtime.viewport,
      };

      return currentWorkflow;
    },
    resolveFileUrl: (fileId: string) => `/files/${fileId}`,
    getSnapshot: () => currentWorkflow,
  };
}

function cloneWorkflow<T extends Workflow>(workflow: T): T {
  return {
    ...workflow,
    nodes: Object.fromEntries(
      Object.entries(workflow.nodes).map(([nodeId, node]) => [nodeId, { ...node }]),
    ) as T['nodes'],
    connections: workflow.connections.map((connection) => ({ ...connection })),
    viewport: { ...workflow.viewport },
    metadata: {
      ...workflow.metadata,
      relatedTasks: [...(workflow.metadata.relatedTasks ?? [])],
      usedNodeIds: [...(workflow.metadata.usedNodeIds ?? [])],
      releasedNodeIds: [...(workflow.metadata.releasedNodeIds ?? [])],
      canvasSize: { ...workflow.metadata.canvasSize },
    },
    timestamp: { ...workflow.timestamp },
  };
}

function resolveCommitInputForTest(
  params: {
    node: AINodeData;
    snapshot: ExecutionRuntimeRunState;
    input: ExecutionOutputCommitWorkflowInput;
    workflow: Workflow;
    adapterContext: ExecutionRuntimeNodeAdapterContext;
    groupedAdapter?: ExecutionRuntimeNodeOutputAdapter<undefined, ExecutionRuntimeGroupedNodeExecutionTarget>;
    nodeAdapter?: ExecutionRuntimeGroupedNodeAdapter<unknown>;
  },
) {
  const workflowAccess = createWorkflowAccess(params.workflow);
  const defaultNodeAdapter: ExecutionRuntimeGroupedNodeAdapter<unknown> = {
    ...createGroupedAdapter(),
    nodeType: 'aiModelRenderTransfer',
    executionKind: 'grouped',
    taskType: 'model-render-transfer',
    validateExecution: () => ({ valid: true }),
    createExecutionPayload: async () => createGroupedPayload(params.node.id.value),
    mapSnapshotToRuntimePatch: () => [],
  };

  return resolveWorkflowExecutionOutputCommitRequest({
    node: params.node,
    snapshot: params.snapshot,
    input: params.input,
    latestWorkflow: params.workflow,
    resolveNodeTitle: () => params.adapterContext.nodeTitle,
    buildAdapterContext: () => params.adapterContext,
    groupedAdapter: params.groupedAdapter ?? createGroupedAdapter(),
    getNodeAdapter: () => params.nodeAdapter ?? defaultNodeAdapter,
    workflowAccess,
  });
}

test('ExecutionOutputCommit input adapter preserves typed payload requests', () => {
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const node = workflow.nodes[nodeId] as AINodeData;
  const snapshot = createRun({ nodeId });
  const adapterContext = createAdapterContext(nodeId);
  const payload = createGroupedPayload(nodeId);
  const input = createPayloadExecutionOutputCommitInput(
    payload,
    adapterContext,
    'terminal-only',
  );

  assert.equal(input.kind, 'payload');

  const resolved = resolveCommitInputForTest({
    node,
    snapshot,
    input,
    workflow,
    adapterContext,
  });

  assert.ok(resolved);
  assert.equal(resolved?.kind, 'payload');
  assert.equal(resolved?.request.payload, payload);
  assert.equal(resolved?.request.adapterContext.node.id.value, adapterContext.node.id.value);
  assert.equal(resolved?.request.adapterContext.workflowId, adapterContext.workflowId);
  assert.equal(resolved?.request.adapterContext.nodeTitle, adapterContext.nodeTitle);
  assert.equal(resolved?.request.mode, 'terminal-only');
});

test('ExecutionOutputCommit input adapter converts legacy grouped targets to an explicit payload', () => {
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const node = workflow.nodes[nodeId] as AINodeData;
  const snapshot = createRun({ nodeId });
  const adapterContext = createAdapterContext(nodeId);
  const legacyTargets: LegacyBackendExecutionTarget[] = [
    {
      groupId: 'group-1',
      groupOrder: 3,
      groupLabel: 'Group 1',
      outputHandle: 'group-1:result',
    },
  ];
  const input = createLegacyGroupedExecutionOutputCommitInput(
    legacyTargets,
    'incremental',
  );

  assert.equal(input.kind, 'legacy-grouped-targets');

  const resolved = resolveCommitInputForTest({
    node,
    snapshot,
    input,
    workflow,
    adapterContext,
  });

  assert.ok(resolved);
  assert.equal(resolved?.kind, 'legacy-grouped-targets');
  if (!resolved || resolved.kind !== 'legacy-grouped-targets') {
    throw new Error('Expected legacy grouped resolved request');
  }

  assert.equal(resolved.request.payload.executionKind, 'grouped');
  assert.equal(resolved.request.payload.request, undefined);
  assert.equal(resolved.request.payload.targets[0]?.kind, 'group');
  assert.equal(resolved.request.payload.targets[0]?.groupId, 'group-1');
  assert.equal(resolved.request.payload.targets[0]?.groupOrder, 3);
  assert.equal(resolved.request.payload.targets[0]?.outputHandle, 'group-1:result');
  assert.equal(resolved.request.mode, 'incremental');
});

test('ExecutionOutputCommitService 同一结果文件不会重复写回', async () => {
  const store = createExecutionRuntimeStore();
  const cache = createExecutionOutputCommitCache();
  const service = createExecutionOutputCommitService({ store, cache });
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const adapter = createGroupedAdapter();
  const adapterContext = createAdapterContext(nodeId);
  const resultFile = createFileInfo('result-1', 'result-1.png');
  const snapshot = createRun({
    nodeId,
    tasks: [
      createTask({
        taskId: 'task-1',
        nodeId,
        groupId: 'group-1',
        groupOrder: 0,
        resultFileId: resultFile.id,
        resultFileInfo: resultFile,
        resultFile,
      }),
    ],
  });

  store.applyRunSnapshot(snapshot);

  const workflowAccess = createWorkflowAccess(workflow);
  const request = {
    workflowId: workflow.id,
    runId: snapshot.runId,
    node: workflow.nodes[nodeId] as AINodeData,
    snapshot,
    payload: createGroupedPayload(nodeId),
    adapter,
    adapterContext,
    workflowAccess,
  };

  const first = await service.commit(request);
  const second = await service.commit({
    ...request,
    snapshot: store.getRun(snapshot.runId) ?? snapshot,
  });

  assert.equal(first.changed, true);
  assert.equal(first.committedCount, 1);
  assert.equal(second.changed, false);
  assert.equal(second.committedCount, 0);
  assert.equal(workflowAccess.getSnapshot().connections.length, 1);
  assert.equal(store.getTask('task-1')?.resultCommitStatus, 'committed');
  assert.equal(store.getTask('task-1')?.isOutputCommitted, true);
});

test('ExecutionOutputCommitService 已存在 output-link 时不会重复 append', async () => {
  const store = createExecutionRuntimeStore();
  const cache = createExecutionOutputCommitCache();
  const service = createExecutionOutputCommitService({ store, cache });
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const resultFile = createFileInfo('result-2', 'result-2.png');

  workflow.nodes['101'] = createDefaultFileNodeData(
    createSequentialNodeId(101),
    { x: 920, y: 200 },
    'image',
    resultFile.id,
    resultFile.name,
    resultFile.size,
    resultFile.mimeType,
    resultFile.metadata,
    resultFile.source,
  );
  workflow.connections.push({
    id: 'output-link-1',
    type: 'output-link',
    sourceId: nodeId,
    targetId: '101',
    sourceHandle: 'group-1:result',
    order: 0,
  });
  workflow.metadata.nodeCount = 2;
  workflow.metadata.connectionCount = 1;
  workflow.metadata.lastNodeId = 101;

  const adapter = createGroupedAdapter();
  const adapterContext = createAdapterContext(nodeId);
  const snapshot = createRun({
    nodeId,
    tasks: [
      createTask({
        taskId: 'task-2',
        nodeId,
        groupId: 'group-1',
        groupOrder: 0,
        resultFileId: resultFile.id,
        resultFileInfo: resultFile,
        resultFile,
      }),
    ],
  });

  store.applyRunSnapshot(snapshot);

  const workflowAccess = createWorkflowAccess(workflow);
  const result = await service.commit({
    workflowId: workflow.id,
    runId: snapshot.runId,
    node: workflow.nodes[nodeId] as AINodeData,
    snapshot,
    payload: createGroupedPayload(nodeId),
    adapter,
    adapterContext,
    workflowAccess,
  });

  assert.equal(result.changed, true);
  assert.equal(result.committedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(workflowAccess.getSnapshot().connections.length, 1);
  assert.deepEqual((workflowAccess.getSnapshot().nodes[nodeId] as AINodeData).outputs, [resultFile.id]);
  assert.equal(store.getTask('task-2')?.resultCommitStatus, 'committed');
});

test('ExecutionOutputCommitService 兼容 single 节点 legacy targets 结构', async () => {
  const store = createExecutionRuntimeStore();
  const cache = createExecutionOutputCommitCache();
  const service = createExecutionOutputCommitService({ store, cache });
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const resultFile = createFileInfo('result-3', 'result-3.png');

  const snapshot = createRun({
    nodeId,
    tasks: [
      createTask({
        taskId: 'task-3',
        nodeId,
        groupId: 'single',
        groupOrder: 0,
        resultFileId: resultFile.id,
        resultFileInfo: resultFile,
        resultFile,
      }),
    ],
  });

  store.applyRunSnapshot(snapshot);

  const adapter: ExecutionRuntimeNodeOutputAdapter<
    unknown,
    ExecutionRuntimeSingleNodeExecutionTarget
  > = {
    outputCommitMode: 'terminal-only',
    extractExecutionOutputs: (runSnapshot, context) => runSnapshot.tasks
      .filter((task) => task.resultFileId)
      .map((task) => ({
        nodeId: context.payload.nodeId,
        runId: runSnapshot.runId,
        taskId: task.taskId,
        resultFileId: task.resultFileId as string,
        groupOrder: 0,
        sourceHandle: context.payload.targets[0]?.outputHandle,
        resultFile: task.resultFileInfo ?? task.resultFile,
      })),
  };

  const payload: ExecutionRuntimeNodeExecutionPayload<
    unknown,
    ExecutionRuntimeSingleNodeExecutionTarget
  > = {
    nodeId,
    nodeType: 'aiImageHd',
    nodeTitle: '高清放大',
    taskType: 'image-hd',
    executionKind: 'single',
    request: {},
    targets: [
      {
        kind: 'single',
        nodeId,
        nodeType: 'aiImageHd',
        outputHandle: 'result',
        order: 0,
      },
    ],
  };

  const workflowAccess = createWorkflowAccess(workflow);
  const result = await service.commit({
    workflowId: workflow.id,
    runId: snapshot.runId,
    node: workflow.nodes[nodeId] as AINodeData,
    snapshot,
    payload,
    adapter,
    adapterContext: createAdapterContext(nodeId),
    workflowAccess,
    mode: 'terminal-only',
  });

  assert.equal(result.changed, true);
  assert.equal(result.committedCount, 1);
  assert.equal(workflowAccess.getSnapshot().connections.length, 1);
  assert.equal(workflowAccess.getSnapshot().connections[0]?.sourceHandle, 'result');
});

test('ExecutionOutputCommitService 相同 resultFileId 在不同 grouped outputHandle 上允许分别回写', async () => {
  const store = createExecutionRuntimeStore();
  const cache = createExecutionOutputCommitCache();
  const service = createExecutionOutputCommitService({ store, cache });
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const adapter = createGroupedAdapter();
  const adapterContext = createAdapterContext(nodeId);
  const resultFile = createFileInfo('shared-result', 'shared-result.png');
  const snapshot = createRun({
    nodeId,
    totalTaskCount: 2,
    completedTaskCount: 2,
    tasks: [
      createTask({
        taskId: 'task-group-1',
        nodeId,
        groupId: 'group-1',
        groupOrder: 0,
        resultFileId: resultFile.id,
        resultFileInfo: resultFile,
        resultFile,
      }),
      createTask({
        taskId: 'task-group-2',
        nodeId,
        groupId: 'group-2',
        groupOrder: 1,
        resultFileId: resultFile.id,
        resultFileInfo: resultFile,
        resultFile,
      }),
    ],
  });

  store.applyRunSnapshot(snapshot);

  const workflowAccess = createWorkflowAccess(workflow);
  const payload: ExecutionRuntimeNodeExecutionPayload<
    unknown,
    ExecutionRuntimeGroupedNodeExecutionTarget
  > = {
    nodeId,
    nodeType: 'aiImageGen',
    nodeTitle: 'AI 生图',
    taskType: 'image-gen',
    executionKind: 'grouped',
    request: {},
    targets: [
      {
        kind: 'group',
        nodeId,
        nodeType: 'aiImageGen',
        groupId: 'group-1',
        groupOrder: 0,
        groupLabel: 'Group 1',
        outputHandle: 'group-1:result',
      },
      {
        kind: 'group',
        nodeId,
        nodeType: 'aiImageGen',
        groupId: 'group-2',
        groupOrder: 1,
        groupLabel: 'Group 2',
        outputHandle: 'group-2:result',
      },
    ],
  };

  const result = await service.commit({
    workflowId: workflow.id,
    runId: snapshot.runId,
    node: workflow.nodes[nodeId] as AINodeData,
    snapshot,
    payload,
    adapter,
    adapterContext,
    workflowAccess,
  });

  const committedWorkflow = workflowAccess.getSnapshot();
  const outputLinks = committedWorkflow.connections.filter((connection) => connection.type === 'output-link');

  assert.equal(result.changed, true);
  assert.equal(result.committedCount, 2);
  assert.equal(outputLinks.length, 2);
  assert.deepEqual(
    outputLinks.map((connection) => connection.sourceHandle).sort(),
    ['group-1:result', 'group-2:result'],
  );
  assert.equal(store.getTask('task-group-1')?.resultCommitStatus, 'committed');
  assert.equal(store.getTask('task-group-2')?.resultCommitStatus, 'committed');
});

test('ExecutionOutputCommitService video 结果会生成 video 节点并保留预览地址', async () => {
  const store = createExecutionRuntimeStore();
  const cache = createExecutionOutputCommitCache();
  const service = createExecutionOutputCommitService({ store, cache });
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const adapter = createGroupedAdapter();
  const adapterContext = createAdapterContext(nodeId);
  const resultFile = createVideoFileInfo('video-result-1', 'video-result-1');
  const snapshot = createRun({
    nodeId,
    nodeType: 'aiVideoGen',
    tasks: [
      createTask({
        taskId: 'task-video-1',
        nodeId,
        nodeType: 'aiVideoGen',
        groupId: 'group-1',
        groupOrder: 0,
        resultFileId: resultFile.id,
        resultFileInfo: resultFile,
        resultFile,
      }),
    ],
  });

  store.applyRunSnapshot(snapshot);

  const workflowAccess = createWorkflowAccess(workflow);
  const result = await service.commit({
    workflowId: workflow.id,
    runId: snapshot.runId,
    node: workflow.nodes[nodeId] as AINodeData,
    snapshot,
    payload: createGroupedPayload(nodeId),
    adapter,
    adapterContext,
    workflowAccess,
  });

  const committedWorkflow = workflowAccess.getSnapshot();
  const outputNode = Object.values(committedWorkflow.nodes).find((node) => (
    node.id.value !== nodeId && 'fileId' in node && node.fileId === resultFile.id
  ));

  assert.equal(result.changed, true);
  assert.ok(outputNode);
  assert.equal(outputNode?.type, 'video');
  assert.equal('previewUrl' in outputNode! ? outputNode.previewUrl : undefined, resultFile.path);
  assert.deepEqual(
    'metadata' in outputNode! ? outputNode.metadata : undefined,
    resultFile.metadata,
  );
});

test('ExecutionOutputCommitService replays a missing output-link without duplicating the file node', async () => {
  const store = createExecutionRuntimeStore();
  const cache = createExecutionOutputCommitCache();
  const service = createExecutionOutputCommitService({ store, cache });
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const adapter = createGroupedAdapter();
  const adapterContext = createAdapterContext(nodeId);
  const resultFile = createFileInfo('result-replay-1', 'result-replay-1.png');
  const existingNode = createDefaultFileNodeData(
    createSequentialNodeId(101),
    { x: 520, y: 200 },
    'image',
    resultFile.id,
    resultFile.name,
    resultFile.size,
    resultFile.mimeType,
    resultFile.metadata,
    resultFile.source,
  );

  workflow.nodes[existingNode.id.value] = existingNode;
  workflow.nodes[nodeId] = {
    ...(workflow.nodes[nodeId] as AINodeData),
    outputs: [resultFile.id],
  };
  workflow.metadata.nodeCount = 2;
  workflow.metadata.lastNodeId = 101;

  const snapshot = createRun({
    nodeId,
    tasks: [
      createTask({
        taskId: 'task-replay-1',
        nodeId,
        groupId: 'group-1',
        groupOrder: 0,
        resultFileId: resultFile.id,
        resultFileInfo: resultFile,
        resultFile,
        resultCommitStatus: 'committed',
        isOutputCommitted: true,
      }),
    ],
  });

  store.applyRunSnapshot(snapshot);

  const workflowAccess = createWorkflowAccess(workflow);
  const result = await service.commit({
    workflowId: workflow.id,
    runId: snapshot.runId,
    node: workflow.nodes[nodeId] as AINodeData,
    snapshot,
    payload: createGroupedPayload(nodeId),
    adapter,
    adapterContext,
    workflowAccess,
  });

  const committedWorkflow = workflowAccess.getSnapshot();
  const linkedNodes = Object.values(committedWorkflow.nodes)
    .filter((node) => 'fileId' in node && node.fileId === resultFile.id);
  const outputLinks = committedWorkflow.connections.filter((connection) => (
    connection.type === 'output-link'
    && connection.sourceId === nodeId
    && connection.sourceHandle === 'group-1:result'
  ));

  assert.equal(result.changed, true);
  assert.equal(result.committedCount, 1);
  assert.equal(linkedNodes.length, 1);
  assert.equal(outputLinks.length, 1);
  assert.equal(outputLinks[0]?.targetId, existingNode.id.value);
  assert.equal(store.getTask('task-replay-1')?.resultCommitStatus, 'committed');
  assert.equal(store.getTask('task-replay-1')?.isOutputCommitted, true);
});

test('ExecutionOutputCommitService treats a same-handle result file as committed when one of multiple same-handle output-links already matches it', async () => {
  const store = createExecutionRuntimeStore();
  const cache = createExecutionOutputCommitCache();
  const service = createExecutionOutputCommitService({ store, cache });
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const adapter = createGroupedAdapter();
  const adapterContext = createAdapterContext(nodeId);
  const previousResultFile = createVideoFileInfo('video-old-1', 'video-old-1.mp4');
  const committedResultFile = createVideoFileInfo('video-committed-1', 'video-committed-1.mp4');
  const previousNode = createDefaultFileNodeData(
    createSequentialNodeId(101),
    { x: 920, y: 200 },
    'video',
    previousResultFile.id,
    previousResultFile.name,
    previousResultFile.size,
    previousResultFile.mimeType,
    previousResultFile.metadata,
    previousResultFile.source,
  );
  const committedNode = createDefaultFileNodeData(
    createSequentialNodeId(102),
    { x: 1600, y: 200 },
    'video',
    committedResultFile.id,
    committedResultFile.name,
    committedResultFile.size,
    committedResultFile.mimeType,
    committedResultFile.metadata,
    committedResultFile.source,
  );

  workflow.nodes[previousNode.id.value] = {
    ...previousNode,
    previewUrl: previousResultFile.path,
  };
  workflow.nodes[committedNode.id.value] = {
    ...committedNode,
    previewUrl: committedResultFile.path,
  };
  workflow.nodes[nodeId] = {
    ...(workflow.nodes[nodeId] as AINodeData),
    outputs: [previousResultFile.id, committedResultFile.id],
  };
  workflow.connections.push({
    id: 'output-link-old',
    type: 'output-link',
    sourceId: nodeId,
    targetId: previousNode.id.value,
    sourceHandle: 'group-1:result',
    order: 0,
  });
  workflow.connections.push({
    id: 'output-link-committed',
    type: 'output-link',
    sourceId: nodeId,
    targetId: committedNode.id.value,
    sourceHandle: 'group-1:result',
    order: 0,
  });
  workflow.metadata.nodeCount = 3;
  workflow.metadata.connectionCount = 2;
  workflow.metadata.lastNodeId = 102;

  const snapshot = createRun({
    nodeId,
    nodeType: 'aiVideoGen',
    tasks: [
      createTask({
        taskId: 'task-video-committed-1',
        nodeId,
        nodeType: 'aiVideoGen',
        groupId: 'group-1',
        groupOrder: 0,
        resultFileId: committedResultFile.id,
        resultFileInfo: committedResultFile,
        resultFile: committedResultFile,
        resultCommitStatus: 'committed',
        isOutputCommitted: true,
      }),
    ],
  });

  store.applyRunSnapshot(snapshot);

  const workflowAccess = createWorkflowAccess(workflow);
  const result = await service.commit({
    workflowId: workflow.id,
    runId: snapshot.runId,
    node: workflow.nodes[nodeId] as AINodeData,
    snapshot,
    payload: createGroupedPayload(nodeId),
    adapter,
    adapterContext,
    workflowAccess,
  });

  const committedWorkflow = workflowAccess.getSnapshot();
  const outputLinks = committedWorkflow.connections.filter((connection) => (
    connection.type === 'output-link'
    && connection.sourceId === nodeId
    && connection.sourceHandle === 'group-1:result'
  ));
  const committedNodes = Object.values(committedWorkflow.nodes).filter((node) => (
    'fileId' in node && node.fileId === committedResultFile.id
  ));

  assert.equal(result.changed, false);
  assert.equal(result.committedCount, 0);
  assert.equal(outputLinks.length, 2);
  assert.equal(committedNodes.length, 1);
  assert.deepEqual(
    outputLinks
      .map((connection) => committedWorkflow.nodes[connection.targetId])
      .filter((candidate): candidate is typeof previousNode => Boolean(candidate && 'fileId' in candidate))
      .map((candidate) => [candidate.fileId, candidate.position]),
    [
      [previousResultFile.id, { x: 920, y: 200 }],
      [committedResultFile.id, { x: 1600, y: 200 }],
    ],
  );
  assert.deepEqual((committedWorkflow.nodes[nodeId] as AINodeData).outputs, [
    previousResultFile.id,
    committedResultFile.id,
  ]);
  assert.equal(store.getTask('task-video-committed-1')?.resultCommitStatus, 'committed');
  assert.equal(store.getTask('task-video-committed-1')?.isOutputCommitted, true);
});

test('ExecutionOutputCommitService appends a new grouped output node for a new result file on the same source handle', async () => {
  const store = createExecutionRuntimeStore();
  const cache = createExecutionOutputCommitCache();
  const service = createExecutionOutputCommitService({ store, cache });
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const adapter = createGroupedAdapter();
  const adapterContext = createAdapterContext(nodeId);
  const previousResultFile = createVideoFileInfo('video-old-1', 'video-old-1.mp4');
  const nextResultFile = createVideoFileInfo('video-new-1', 'video-new-1.mp4');
  const existingNode = createDefaultFileNodeData(
    createSequentialNodeId(101),
    { x: 920, y: 200 },
    'video',
    previousResultFile.id,
    previousResultFile.name,
    previousResultFile.size,
    previousResultFile.mimeType,
    previousResultFile.metadata,
    previousResultFile.source,
  );

  workflow.nodes[existingNode.id.value] = {
    ...existingNode,
    previewUrl: previousResultFile.path,
  };
  workflow.nodes[nodeId] = {
    ...(workflow.nodes[nodeId] as AINodeData),
    outputs: [previousResultFile.id],
  };
  workflow.connections.push({
    id: 'output-link-existing',
    type: 'output-link',
    sourceId: nodeId,
    targetId: existingNode.id.value,
    sourceHandle: 'group-1:result',
    order: 0,
  });
  workflow.metadata.nodeCount = 2;
  workflow.metadata.connectionCount = 1;
  workflow.metadata.lastNodeId = 101;

  const snapshot = createRun({
    nodeId,
    nodeType: 'aiVideoGen',
    tasks: [
      createTask({
        taskId: 'task-video-replace-1',
        nodeId,
        nodeType: 'aiVideoGen',
        groupId: 'group-1',
        groupOrder: 0,
        resultFileId: nextResultFile.id,
        resultFileInfo: nextResultFile,
        resultFile: nextResultFile,
      }),
    ],
  });

  store.applyRunSnapshot(snapshot);

  const workflowAccess = createWorkflowAccess(workflow);
  const result = await service.commit({
    workflowId: workflow.id,
    runId: snapshot.runId,
    node: workflow.nodes[nodeId] as AINodeData,
    snapshot,
    payload: createGroupedPayload(nodeId),
    adapter,
    adapterContext,
    workflowAccess,
  });

  const committedWorkflow = workflowAccess.getSnapshot();
  const sourceNode = committedWorkflow.nodes[nodeId] as AINodeData;
  const outputLinks = committedWorkflow.connections.filter((connection) => (
    connection.type === 'output-link'
    && connection.sourceId === nodeId
    && connection.sourceHandle === 'group-1:result'
  ));
  const outputNodes = Object.values(committedWorkflow.nodes).filter((node) => (
    'fileId' in node && (node.fileId === previousResultFile.id || node.fileId === nextResultFile.id)
  ));

  assert.equal(result.changed, true);
  assert.equal(result.committedCount, 1);
  assert.deepEqual(sourceNode.outputs, [previousResultFile.id, nextResultFile.id]);
  assert.equal(outputLinks.length, 2);
  assert.equal(outputLinks.some((connection) => connection.targetId === existingNode.id.value), true);
  assert.equal(outputNodes.length, 2);
  assert.equal(
    outputNodes.filter((node) => 'fileId' in node && node.fileId === previousResultFile.id).length,
    1,
  );
  const nextOutputNode = outputNodes.find((node) => 'fileId' in node && node.fileId === nextResultFile.id);
  assert.ok(nextOutputNode);
  if (!nextOutputNode || !('fileId' in nextOutputNode)) {
    throw new Error('Expected appended output node');
  }

  assert.equal(nextOutputNode.id.value === existingNode.id.value, false);
  assert.deepEqual(nextOutputNode.position, { x: 1600, y: 200 });
  assert.equal(nextOutputNode.previewUrl, nextResultFile.path);
});

test('ExecutionOutputCommitService keeps task replayable when workflow graph is not actually committed', async () => {
  const store = createExecutionRuntimeStore();
  const cache = createExecutionOutputCommitCache();
  const service = createExecutionOutputCommitService({ store, cache });
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const adapter = createGroupedAdapter();
  const adapterContext = createAdapterContext(nodeId);
  const resultFile = createFileInfo('result-broken-1', 'result-broken-1.png');
  const snapshot = createRun({
    nodeId,
    tasks: [
      createTask({
        taskId: 'task-broken-1',
        nodeId,
        groupId: 'group-1',
        groupOrder: 0,
        resultFileId: resultFile.id,
        resultFileInfo: resultFile,
        resultFile,
      }),
    ],
  });

  store.applyRunSnapshot(snapshot);

  const workflowAccess = {
    getCurrentWorkflow: () => workflow,
    applyRuntimeSnapshot: (_runtime: WorkflowRuntimeSnapshot) => workflow,
    resolveFileUrl: (fileId: string) => `/files/${fileId}`,
  };

  const result = await service.commit({
    workflowId: workflow.id,
    runId: snapshot.runId,
    node: workflow.nodes[nodeId] as AINodeData,
    snapshot,
    payload: createGroupedPayload(nodeId),
    adapter,
    adapterContext,
    workflowAccess,
  });

  assert.equal(result.changed, true);
  assert.equal(result.committedCount, 0);
  assert.equal(store.getTask('task-broken-1')?.resultCommitStatus, 'ready');
  assert.equal(store.getTask('task-broken-1')?.isOutputCommitted, false);

  const replaySnapshot = store.getRun(snapshot.runId) ?? snapshot;
  const replayResult = await service.commit({
    workflowId: workflow.id,
    runId: snapshot.runId,
    node: workflow.nodes[nodeId] as AINodeData,
    snapshot: replaySnapshot,
    payload: createGroupedPayload(nodeId),
    adapter,
    adapterContext,
    workflowAccess,
  });

  assert.equal(replayResult.changed, true);
  assert.equal(replayResult.committedCount, 0);
  assert.equal(store.getTask('task-broken-1')?.resultCommitStatus, 'ready');
});

test('ExecutionOutputCommitService uses adapter custom commit when provided', async () => {
  const store = createExecutionRuntimeStore();
  const cache = createExecutionOutputCommitCache();
  const service = createExecutionOutputCommitService({ store, cache });
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const resultFile = createFileInfo('storyboard-image-1', 'storyboard-image-1.png');
  const snapshot = createRun({
    nodeId,
    tasks: [
      createTask({
        taskId: 'task-storyboard-1',
        nodeId,
        groupId: 'group-1',
        groupOrder: 0,
        resultFileId: resultFile.id,
        resultFileInfo: resultFile,
        resultFile,
      }),
    ],
  });

  store.applyRunSnapshot(snapshot);

  let committedOutputIds: string[] = [];
  const adapter: ExecutionRuntimeNodeOutputAdapter<
    unknown,
    ExecutionRuntimeGroupedNodeExecutionTarget
  > = {
    outputCommitMode: 'incremental',
    extractExecutionOutputs: createGroupedAdapter().extractExecutionOutputs,
    isOutputCommitted: ({ workflow: currentWorkflow, output }) => (
      Array.isArray((currentWorkflow?.nodes[nodeId] as AINodeData | undefined)?.outputs)
      && ((currentWorkflow?.nodes[nodeId] as AINodeData).outputs.includes(output.resultFileId))
    ),
    commitExecutionOutputs: async ({ currentWorkflow, preparedOutputs, workflowAccess }) => {
      committedOutputIds = preparedOutputs.map((item) => item.output.resultFileId);
      const sourceNode = currentWorkflow.nodes[nodeId] as AINodeData;
      const runtime: WorkflowRuntimeSnapshot = {
        nodes: {
          ...currentWorkflow.nodes,
          [nodeId]: {
            ...sourceNode,
            outputs: Array.from(new Set([
              ...sourceNode.outputs,
              ...preparedOutputs.map((item) => item.output.resultFileId),
            ])),
          },
        },
        connections: currentWorkflow.connections,
        viewport: currentWorkflow.viewport,
        metadata: currentWorkflow.metadata,
      };
      workflowAccess.applyRuntimeSnapshot(runtime);
      return { changed: true };
    },
  };

  const workflowAccess = createWorkflowAccess(workflow);
  const result = await service.commit({
    workflowId: workflow.id,
    runId: snapshot.runId,
    node: workflow.nodes[nodeId] as AINodeData,
    snapshot,
    payload: createGroupedPayload(nodeId),
    adapter,
    adapterContext: createAdapterContext(nodeId),
    workflowAccess,
  });

  assert.equal(result.changed, true);
  assert.equal(result.committedCount, 1);
  assert.deepEqual(committedOutputIds, [resultFile.id]);
  assert.equal(workflowAccess.getSnapshot().connections.length, 0);
  assert.deepEqual((workflowAccess.getSnapshot().nodes[nodeId] as AINodeData).outputs, [resultFile.id]);
  assert.equal(store.getTask('task-storyboard-1')?.resultCommitStatus, 'committed');
  assert.equal(store.getTask('task-storyboard-1')?.isOutputCommitted, true);
});

test('ExecutionOutputCommitService appends outputs against the latest workflow node position and dimensions', async () => {
  const store = createExecutionRuntimeStore();
  const cache = createExecutionOutputCommitCache();
  const service = createExecutionOutputCommitService({ store, cache });
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const latestWorkflow = cloneWorkflow(workflow);
  const latestNode = latestWorkflow.nodes[nodeId] as AINodeData;
  latestWorkflow.nodes[nodeId] = {
    ...latestNode,
    position: { x: 480, y: 640 },
    dimensions: { width: 720, height: 520 },
    timestamp: {
      ...latestNode.timestamp,
      updated: latestNode.timestamp.updated + 10,
    },
  };
  const workflowAccess = createWorkflowAccess(latestWorkflow);

  const resultFile = createFileInfo('latest-base-result-1', 'latest-base-result-1.png');
  const snapshot = createRun({
    nodeId,
    tasks: [
      createTask({
        taskId: 'task-latest-base-1',
        nodeId,
        groupId: 'group-1',
        groupOrder: 0,
        resultFileId: resultFile.id,
        resultFileInfo: resultFile,
        resultFile,
      }),
    ],
  });
  store.applyRunSnapshot(snapshot);

  const result = await service.commit({
    workflowId: latestWorkflow.id,
    runId: snapshot.runId,
    node: workflow.nodes[nodeId] as AINodeData,
    snapshot,
    payload: createGroupedPayload(nodeId),
    adapter: createGroupedAdapter(),
    adapterContext: createAdapterContext(nodeId),
    workflowAccess,
  });

  assert.equal(result.changed, true);
  const committedWorkflow = workflowAccess.getSnapshot();
  const outputNode = Object.values(committedWorkflow.nodes).find((node) => (
    'fileId' in node && node.fileId === resultFile.id
  ));
  assert.ok(outputNode);
  if (!outputNode) {
    throw new Error('Expected output node to be created');
  }

  assert.deepEqual(outputNode.position, {
    x: 480 + 720 + 180,
    y: 640,
  });
});

test('ExecutionOutputCommitService commitResolved accepts normalized requests', async () => {
  const store = createExecutionRuntimeStore();
  const cache = createExecutionOutputCommitCache();
  const service = createExecutionOutputCommitService({ store, cache });
  const nodeId = '100';
  const workflow = createWorkflow(nodeId);
  const node = workflow.nodes[nodeId] as AINodeData;
  const resultFile = createFileInfo('result-commit-resolved-1', 'result-commit-resolved-1.png');
  const snapshot = createRun({
    nodeId,
    tasks: [
      createTask({
        taskId: 'task-commit-resolved-1',
        nodeId,
        groupId: 'group-1',
        groupOrder: 0,
        resultFileId: resultFile.id,
        resultFileInfo: resultFile,
        resultFile,
      }),
    ],
  });
  const adapterContext = createAdapterContext(nodeId);
  const input = createPayloadExecutionOutputCommitInput(
    createGroupedPayload(nodeId),
    adapterContext,
    'incremental',
  );
  const resolved = resolveCommitInputForTest({
    node,
    snapshot,
    input,
    workflow,
    adapterContext,
  });

  store.applyRunSnapshot(snapshot);

  if (!resolved || resolved.kind !== 'payload') {
    throw new Error('Expected payload resolved request');
  }

  const result = await service.commitResolved(resolved.request);

  assert.equal(result.changed, true);
  assert.equal(result.committedCount, 1);
});
