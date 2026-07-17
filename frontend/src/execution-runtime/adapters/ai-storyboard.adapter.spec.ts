import test from 'node:test';
import assert from 'node:assert/strict';

import type { Workflow, AINodeData, FileInfo, FileNodeData, StoryboardShotData } from '@/types';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import type { ExecutionRuntimeRunState } from '../execution-runtime.types';
import { aiStoryboardExecutionRuntimeAdapter } from './ai-storyboard.adapter';
import {
  getAIStoryboardOutputHandle,
  getAIStoryboardShotOutputHandle,
} from '@/nodes/ai-storyboard/groups';
import { AI_STORYBOARD_DEFAULT_SIZE } from '@/nodes/ai-storyboard/constants';
import { createAIStoryboardNodeActionOnlyExecutionRequest } from '@/nodes/ai-storyboard/runtime';

function createShot(overrides: Partial<StoryboardShotData> = {}): StoryboardShotData {
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
    imageFileId: undefined,
    videoFileId: undefined,
    prompt: 'camera move',
    imageModel: 'gemini-3-pro-image-preview',
    imageAspectRatio: 'auto',
    imageSize: '1K',
    videoModel: 'veo-3.1-landscape-fast-fl',
    videoDuration: 8,
    videoAspectRatio: '16:9',
    videoResolution: '720P',
    imageGenStatus: 'idle',
    imageGenMessage: undefined,
    imageGenRunId: undefined,
    videoGenStatus: 'idle',
    videoProgress: undefined,
    videoError: undefined,
    videoRunId: undefined,
    ...overrides,
  };
}

function createStoryboardWorkflow(): Workflow {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiStoryboard',
  ) as AINodeData;

  node.outputs = [];
  node.dimensions = { ...AI_STORYBOARD_DEFAULT_SIZE };
  node.config = {
    ...node.config,
    shots: [createShot()],
    processedInputFileIds: ['file-source-1'],
    defaultImageModel: 'gemini-3-pro-image-preview',
    defaultImageAspectRatio: 'auto',
    defaultImageSize: '1K',
    batchVideoModel: 'veo-3.1-landscape-fast-fl',
    batchVideoDuration: 8,
    batchVideoAspectRatio: '16:9',
    batchVideoResolution: '720P',
  };
  node.tasks = [];

  return {
    id: 'workflow-storyboard-adapter',
    projectId: 'project-storyboard-adapter',
    name: 'Storyboard Adapter',
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

function createRunSnapshot(taskType: 'image' | 'video'): ExecutionRuntimeRunState {
  const resultFileInfo: FileInfo = taskType === 'image'
    ? {
      id: 'image-result-1',
      name: 'image-result-1.png',
      originalName: 'image-result-1.png',
      size: 1024,
      mimeType: 'image/png',
      format: 'png',
      fileType: 'image' as const,
      status: 'ready' as const,
      hash: 'hash-image-result-1',
      path: '/files/image-result-1/download',
      metadata: {
        width: 1024,
        height: 768,
      },
      source: { type: 'node-output' as const },
      timestamp: { created: 1, updated: 1 },
    }
    : {
      id: 'video-result-1',
      name: 'video-result-1.mp4',
      originalName: 'video-result-1.mp4',
      size: 2048,
      mimeType: 'video/mp4',
      format: 'mp4',
      fileType: 'video' as const,
      status: 'ready' as const,
      hash: 'hash-video-result-1',
      path: '/files/video-result-1/download',
      metadata: {
        width: 1920,
        height: 1080,
        duration: 8,
      },
      source: { type: 'node-output' as const },
      timestamp: { created: 1, updated: 1 },
    };

  return {
    runId: taskType === 'image' ? 'run-storyboard-image' : 'run-storyboard-video',
    runNo: taskType === 'image' ? 'RUN-STORYBOARD-IMAGE-001' : 'RUN-STORYBOARD-VIDEO-001',
    workflowId: 'workflow-storyboard-adapter',
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
      taskId: taskType === 'image' ? 'task-shot-image-1' : 'task-shot-video-1',
      taskNo: taskType === 'image' ? 'TASK-SHOT-IMAGE-1' : 'TASK-SHOT-VIDEO-1',
      runId: taskType === 'image' ? 'run-storyboard-image' : 'run-storyboard-video',
      runNo: taskType === 'image' ? 'RUN-STORYBOARD-IMAGE-001' : 'RUN-STORYBOARD-VIDEO-001',
      nodeId: '100',
      nodeType: 'aiStoryboard',
      groupId: 'shot-1',
      groupOrder: 1,
      status: 'completed',
      currentStep: 'final',
      currentAttemptNo: 1,
      retryCount: 0,
      maxRetries: 2,
      maxAttempts: 3,
      progress: 100,
      message: `${taskType} done`,
      error: null,
      errorCode: null,
      lastErrorCode: null,
      resultFileId: resultFileInfo.id,
      resultFileInfo,
      resultCommitStatus: 'ready',
      resultCommittedAt: null,
      resultCommitError: null,
      canCommitOutput: true,
      isTerminal: true,
      isOutputCommitted: false,
    }],
  };
}

function createPayload(taskType: 'image' | 'video') {
  return {
    nodeId: '100',
    nodeType: 'aiStoryboard',
    nodeTitle: 'AI Storyboard',
    taskType: taskType === 'image' ? 'image-gen' : 'video-gen',
    executionKind: 'grouped' as const,
    request: createAIStoryboardNodeActionOnlyExecutionRequest(),
    targets: [{
      kind: 'group' as const,
      nodeId: '100',
      nodeType: 'aiStoryboard',
      groupId: 'shot-1',
      groupOrder: 1,
      outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
    }],
  };
}

function createAdapterContext(workflow: Workflow) {
  return {
    workflowId: workflow.id,
    workflow,
    node: workflow.nodes['100'] as AINodeData,
    nodeTitle: 'AI Storyboard',
    inputs: [],
    resolvedInputGroups: [],
    services: {},
  };
}

test('aiStoryboard adapter exposes a node-action-only payload instead of throwing unsupported runtime errors', async () => {
  const workflow = createStoryboardWorkflow();
  const validation = aiStoryboardExecutionRuntimeAdapter.validateExecution(createAdapterContext(workflow));
  const payload = await aiStoryboardExecutionRuntimeAdapter.createExecutionPayload(createAdapterContext(workflow));

  assert.deepEqual(validation, { valid: true });
  assert.equal(payload.nodeType, 'aiStoryboard');
  assert.equal(payload.taskType, 'video-gen');
  assert.equal(payload.executionKind, 'grouped');
  assert.deepEqual(payload.targets, []);
  assert.deepEqual(payload.request, {
    boundary: 'node-action-only',
    actionIds: ['arrange', 'shot-image', 'shot-video', 'batch-video'],
    plan: {
      files: [],
      references: [],
      config: {},
    },
  });
});

test('aiStoryboard adapter extracts outputs onto the per-shot output handle', () => {
  const snapshot = createRunSnapshot('video');
  const outputs = aiStoryboardExecutionRuntimeAdapter.extractExecutionOutputs(snapshot, {
    workflowId: 'workflow-storyboard-adapter',
    nodeId: '100',
    payload: createPayload('video'),
    previousSnapshot: null,
  });

  assert.deepEqual(outputs, [{
    nodeId: '100',
    runId: 'run-storyboard-video',
    taskId: 'task-shot-video-1',
    taskType: 'video-gen',
    resultFileId: 'video-result-1',
    groupId: 'shot-1',
    groupOrder: 1,
    sourceHandle: getAIStoryboardShotOutputHandle('shot-1'),
    resultFile: snapshot.tasks[0]?.resultFileInfo,
  }]);
});

test('aiStoryboard adapter creates reconcile targets from legacy task refs missing output handle and task type', () => {
  const workflow = createStoryboardWorkflow();
  const node = workflow.nodes['100'] as AINodeData;
  const snapshot = createRunSnapshot('image');
  node.tasks = [{
    taskId: 'task-shot-image-1',
    taskNo: 'TASK-SHOT-IMAGE-1',
    runId: 'run-storyboard-image',
    runNo: 'RUN-STORYBOARD-IMAGE-001',
    scope: 'group',
    groupId: 'shot-1',
    groupLabel: 'Shot 1',
    groupOrder: 1,
    status: 'completed',
    createdAt: 1,
  }];

  const targets = aiStoryboardExecutionRuntimeAdapter.createReconcileTargets?.({
    workflow,
    node,
    snapshot,
    persistedTaskRefs: node.tasks,
  });
  const normalizedOutput = aiStoryboardExecutionRuntimeAdapter.normalizeReconcileOutput?.({
    workflow,
    node,
    snapshot,
    persistedTaskRefs: node.tasks,
    output: {
      nodeId: '100',
      runId: 'run-storyboard-image',
      taskId: 'task-shot-image-1',
      resultFileId: 'image-result-1',
      groupId: 'shot-1',
      groupOrder: 1,
      sourceHandle: 'shot-1:result',
      resultFile: snapshot.tasks[0]?.resultFileInfo,
    },
  });

  assert.deepEqual(targets, [{
    kind: 'group',
    nodeId: '100',
    nodeType: 'aiStoryboard',
    groupId: 'shot-1',
    groupOrder: 1,
    groupLabel: 'Shot 1',
    outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
  }]);
  assert.equal(normalizedOutput?.taskType, 'image-gen');
  assert.equal(normalizedOutput?.sourceHandle, getAIStoryboardShotOutputHandle('shot-1'));
  assert.equal(normalizedOutput?.groupOrder, 1);
});

test('aiStoryboard adapter keeps same-shot image and video task refs separated during reconcile lookup', () => {
  const workflow = createStoryboardWorkflow();
  const node = workflow.nodes['100'] as AINodeData;
  const snapshot = createRunSnapshot('video');
  node.tasks = [{
    taskId: 'task-shot-image-1',
    taskNo: 'TASK-SHOT-IMAGE-1',
    runId: 'run-storyboard-video',
    runNo: 'RUN-STORYBOARD-VIDEO-001',
    scope: 'group',
    taskType: 'image-gen',
    groupId: 'shot-1',
    groupLabel: 'Shot 1',
    groupOrder: 1,
    outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
    status: 'completed',
    createdAt: 1,
  }, {
    taskId: 'task-shot-video-1',
    taskNo: 'TASK-SHOT-VIDEO-1',
    runId: 'run-storyboard-video',
    runNo: 'RUN-STORYBOARD-VIDEO-001',
    scope: 'group',
    taskType: 'video-gen',
    groupId: 'shot-1',
    groupLabel: 'Shot 1',
    groupOrder: 1,
    outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
    status: 'completed',
    createdAt: 2,
  }];

  const normalizedOutput = aiStoryboardExecutionRuntimeAdapter.normalizeReconcileOutput?.({
    workflow,
    node,
    snapshot,
    persistedTaskRefs: node.tasks,
    output: {
      nodeId: '100',
      runId: 'run-storyboard-video',
      taskId: 'missing-task',
      resultFileId: 'video-result-1',
      groupId: 'shot-1',
      groupOrder: 1,
      sourceHandle: 'shot-1:result',
      resultFile: snapshot.tasks[0]?.resultFileInfo,
    },
  });

  assert.equal(normalizedOutput?.taskType, 'video-gen');
  assert.equal(normalizedOutput?.sourceHandle, getAIStoryboardShotOutputHandle('shot-1'));
});

test('aiStoryboard adapter treats the right-side output node as committed state', async () => {
  const workflow = createStoryboardWorkflow();
  const outputNode = createDefaultFileNodeData(
    createSequentialNodeId(101),
    { x: 520, y: 100 },
    'video',
    'video-result-1',
    'video-result-1.mp4',
    2048,
    'video/mp4',
    { width: 1920, height: 1080, duration: 8 },
    { type: 'node-output' },
  );

  workflow.nodes['101'] = outputNode;
  (workflow.nodes['100'] as AINodeData).outputs = ['video-result-1'];
  workflow.connections.push({
    id: 'output-link-1',
    type: 'output-link',
    sourceId: '100',
    targetId: '101',
    sourceHandle: getAIStoryboardShotOutputHandle('shot-1'),
    order: 0,
  });

  const committed = await aiStoryboardExecutionRuntimeAdapter.isOutputCommitted?.({
    workflow,
    node: workflow.nodes['100'] as AINodeData,
    snapshot: createRunSnapshot('video'),
    payload: createPayload('video'),
    output: {
      nodeId: '100',
      runId: 'run-storyboard-video',
      taskId: 'task-shot-video-1',
      taskType: 'video-gen',
      resultFileId: 'video-result-1',
      groupId: 'shot-1',
      groupOrder: 0,
      sourceHandle: getAIStoryboardShotOutputHandle('shot-1'),
      resultFile: createRunSnapshot('video').tasks[0]?.resultFileInfo,
    },
    adapterContext: {
      workflowId: workflow.id,
      workflow,
      node: workflow.nodes['100'] as AINodeData,
      nodeTitle: 'AI Storyboard',
      inputs: [],
      resolvedInputGroups: [],
      services: {},
    },
    workflowAccess: {
      getCurrentWorkflow: () => workflow,
      applyRuntimeSnapshot: () => workflow,
      resolveFileUrl: (fileId) => `/files/${fileId}/download`,
    },
  });

  assert.equal(committed, true);
});

test('aiStoryboard adapter treats legacy node-level output links as committed state', async () => {
  const workflow = createStoryboardWorkflow();
  const outputNode = createDefaultFileNodeData(
    createSequentialNodeId(101),
    { x: 520, y: 100 },
    'video',
    'video-result-1',
    'video-result-1.mp4',
    2048,
    'video/mp4',
    { width: 1920, height: 1080, duration: 8 },
    { type: 'node-output' },
  );

  workflow.nodes['101'] = outputNode;
  (workflow.nodes['100'] as AINodeData).outputs = ['video-result-1'];
  workflow.connections.push({
    id: 'output-link-legacy',
    type: 'output-link',
    sourceId: '100',
    targetId: '101',
    sourceHandle: getAIStoryboardOutputHandle('group-1'),
    order: 0,
  });

  const committed = await aiStoryboardExecutionRuntimeAdapter.isOutputCommitted?.({
    workflow,
    node: workflow.nodes['100'] as AINodeData,
    snapshot: createRunSnapshot('video'),
    payload: createPayload('video'),
    output: {
      nodeId: '100',
      runId: 'run-storyboard-video',
      taskId: 'task-shot-video-1',
      taskType: 'video-gen',
      resultFileId: 'video-result-1',
      groupId: 'shot-1',
      groupOrder: 0,
      sourceHandle: getAIStoryboardShotOutputHandle('shot-1'),
      resultFile: createRunSnapshot('video').tasks[0]?.resultFileInfo,
    },
    adapterContext: {
      workflowId: workflow.id,
      workflow,
      node: workflow.nodes['100'] as AINodeData,
      nodeTitle: 'AI Storyboard',
      inputs: [],
      resolvedInputGroups: [],
      services: {},
    },
    workflowAccess: {
      getCurrentWorkflow: () => workflow,
      applyRuntimeSnapshot: () => workflow,
      resolveFileUrl: (fileId) => `/files/${fileId}/download`,
    },
  });

  assert.equal(committed, true);
});

test('aiStoryboard adapter skips stale snapshots when a newer task already owns the shot output slot', async () => {
  const workflow = createStoryboardWorkflow();
  const storyboardNode = workflow.nodes['100'] as AINodeData;
  storyboardNode.tasks = [{
    taskId: 'task-shot-video-new',
    taskNo: 'TASK-SHOT-VIDEO-NEW',
    runId: 'run-storyboard-video-new',
    runNo: 'RUN-STORYBOARD-VIDEO-NEW',
    taskType: 'video-gen',
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
    taskId: 'task-shot-video-new',
    taskNo: 'TASK-SHOT-VIDEO-NEW',
    batchId: 'RUN-STORYBOARD-VIDEO-NEW',
    runId: 'run-storyboard-video-new',
    runNo: 'RUN-STORYBOARD-VIDEO-NEW',
    taskType: 'video-gen',
    nodeId: '100',
    nodeDisplayId: storyboardNode.id.display,
    nodeType: 'aiStoryboard',
    groupId: 'shot-1',
    groupLabel: 'Shot 1',
    groupOrder: 1,
    outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
  }];

  const committed = await aiStoryboardExecutionRuntimeAdapter.isOutputCommitted?.({
    workflow,
    node: storyboardNode,
    snapshot: createRunSnapshot('video'),
    payload: createPayload('video'),
    output: {
      nodeId: '100',
      runId: 'run-storyboard-video',
      taskId: 'task-shot-video-1',
      taskType: 'video-gen',
      resultFileId: 'video-result-1',
      groupId: 'shot-1',
      groupOrder: 0,
      sourceHandle: getAIStoryboardShotOutputHandle('shot-1'),
      resultFile: createRunSnapshot('video').tasks[0]?.resultFileInfo,
    },
    adapterContext: {
      workflowId: workflow.id,
      workflow,
      node: storyboardNode,
      nodeTitle: 'AI Storyboard',
      inputs: [],
      resolvedInputGroups: [],
      services: {},
    },
    workflowAccess: {
      getCurrentWorkflow: () => workflow,
      applyRuntimeSnapshot: () => workflow,
      resolveFileUrl: (fileId) => `/files/${fileId}/download`,
    },
  });

  assert.equal(committed, true);
});

test('aiStoryboard adapter appends a new right-side file node for each committed result', async () => {
  let workflow = createStoryboardWorkflow();
  const storyboardNode = workflow.nodes['100'] as AINodeData;
  storyboardNode.tasks = [
    {
      taskId: 'task-shot-video-1',
      taskNo: 'TASK-SHOT-VIDEO-1',
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
    },
    {
      taskId: 'task-shot-video-2',
      taskNo: 'TASK-SHOT-VIDEO-2',
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

  const firstSnapshot = createRunSnapshot('video');
  firstSnapshot.runId = 'run-storyboard-video-1';
  firstSnapshot.runNo = 'RUN-STORYBOARD-VIDEO-1';
  if (!firstSnapshot.tasks[0]) {
    throw new Error('Expected first storyboard task');
  }
  firstSnapshot.tasks[0].taskId = 'task-shot-video-1';
  firstSnapshot.tasks[0].taskNo = 'TASK-SHOT-VIDEO-1';
  firstSnapshot.tasks[0].runId = 'run-storyboard-video-1';
  firstSnapshot.tasks[0].runNo = 'RUN-STORYBOARD-VIDEO-1';
  firstSnapshot.tasks[0].groupId = 'shot-1';
  firstSnapshot.tasks[0].resultFileId = 'video-result-1';
  if (firstSnapshot.tasks[0].resultFileInfo) {
    firstSnapshot.tasks[0].resultFileInfo = {
      ...firstSnapshot.tasks[0].resultFileInfo,
      id: 'video-result-1',
      name: 'video-result-1.mp4',
      originalName: 'video-result-1.mp4',
      hash: 'hash-video-result-1',
      path: '/files/video-result-1/download',
    };
  }

  const secondSnapshot = createRunSnapshot('video');
  secondSnapshot.runId = 'run-storyboard-video-2';
  secondSnapshot.runNo = 'RUN-STORYBOARD-VIDEO-2';
  if (!secondSnapshot.tasks[0]) {
    throw new Error('Expected second storyboard task');
  }
  secondSnapshot.tasks[0].taskId = 'task-shot-video-2';
  secondSnapshot.tasks[0].taskNo = 'TASK-SHOT-VIDEO-2';
  secondSnapshot.tasks[0].runId = 'run-storyboard-video-2';
  secondSnapshot.tasks[0].runNo = 'RUN-STORYBOARD-VIDEO-2';
  secondSnapshot.tasks[0].groupId = 'shot-2';
  secondSnapshot.tasks[0].resultFileId = 'video-result-2';
  if (secondSnapshot.tasks[0].resultFileInfo) {
    secondSnapshot.tasks[0].resultFileInfo = {
      ...secondSnapshot.tasks[0].resultFileInfo,
      id: 'video-result-2',
      name: 'video-result-2.mp4',
      originalName: 'video-result-2.mp4',
      hash: 'hash-video-result-2',
      path: '/files/video-result-2/download',
    };
  }

  const payload = {
    ...createPayload('video'),
    targets: [
      {
        kind: 'group' as const,
        nodeId: '100',
        nodeType: 'aiStoryboard',
        groupId: 'shot-1',
        groupOrder: 1,
        outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
      },
      {
        kind: 'group' as const,
        nodeId: '100',
        nodeType: 'aiStoryboard',
        groupId: 'shot-2',
        groupOrder: 2,
        outputHandle: getAIStoryboardShotOutputHandle('shot-2'),
      },
    ],
  };

  const commitOnce = async (snapshot: ExecutionRuntimeRunState): Promise<void> => {
    const outputs = aiStoryboardExecutionRuntimeAdapter.extractExecutionOutputs(snapshot, {
      workflowId: workflow.id,
      nodeId: '100',
      payload,
      previousSnapshot: null,
    });
    const output = outputs[0];
    if (!output) {
      throw new Error('Expected extracted storyboard output');
    }

    await aiStoryboardExecutionRuntimeAdapter.commitExecutionOutputs?.({
      workflowId: workflow.id,
      runId: snapshot.runId,
      node: workflow.nodes['100'] as AINodeData,
      snapshot,
      payload,
      adapter: aiStoryboardExecutionRuntimeAdapter,
      adapterContext: {
        workflowId: workflow.id,
        workflow,
        node: workflow.nodes['100'] as AINodeData,
        nodeTitle: 'AI Storyboard',
        inputs: [],
        resolvedInputGroups: [],
        services: {},
      },
      workflowAccess: {
        getCurrentWorkflow: () => workflow,
        applyRuntimeSnapshot: (runtime) => {
          workflow = {
            ...workflow,
            nodes: runtime.nodes,
            connections: runtime.connections,
            viewport: runtime.viewport,
            metadata: {
              ...workflow.metadata,
              ...runtime.metadata,
            },
          };
          return workflow;
        },
        resolveFileUrl: (fileId) => `/files/${fileId}/download`,
      },
      currentWorkflow: workflow,
      preparedOutputs: [{
        output,
        fileInfo: output.resultFile,
        runtimeResource: null,
      }],
    });
  };

  await commitOnce(firstSnapshot);
  await commitOnce(secondSnapshot);

  const sourceNode = workflow.nodes['100'] as AINodeData;
  const outputNodes = Object.values(workflow.nodes).filter((node) => (
    'fileId' in node && (node.fileId === 'video-result-1' || node.fileId === 'video-result-2')
  ));
  const outputLinks = workflow.connections.filter((connection) => (
    connection.type === 'output-link'
    && connection.sourceId === '100'
    && (
      connection.sourceHandle === getAIStoryboardShotOutputHandle('shot-1')
      || connection.sourceHandle === getAIStoryboardShotOutputHandle('shot-2')
    )
  ));

  assert.deepEqual(sourceNode.outputs, ['video-result-1', 'video-result-2']);
  assert.equal(outputNodes.length, 2);
  assert.equal(new Set(outputNodes.map((node) => node.id.value)).size, 2);
  assert.equal(outputLinks.length, 2);
  assert.equal(outputNodes.every((node) => node.position.x > storyboardNode.position.x + storyboardNode.dimensions.width), true);
  assert.deepEqual(
    outputLinks.map((connection) => workflow.nodes[connection.targetId])
      .filter((node): node is FileNodeData => Boolean(node && 'fileId' in node))
      .map((node) => node.fileId)
      .sort(),
    ['video-result-1', 'video-result-2'],
  );
});
