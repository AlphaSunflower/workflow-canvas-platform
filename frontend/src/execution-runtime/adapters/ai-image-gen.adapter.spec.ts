import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import type { Workflow, AINodeData } from '@/types';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import type { ExecutionRuntimeNodeAdapterContext } from '../node-execution-adapter.types';
import type { ExecutionRuntimeRunState } from '../execution-runtime.types';
import { aiImageGenExecutionRuntimeAdapter } from './ai-image-gen.adapter';
import {
  AI_IMAGE_INPUT_PORT_ID,
  getAIImageGenGroupInputHandle,
  getAIImageGenGroupOutputHandle,
} from '@/nodes/ai-image-gen/groups';

function createImageNode(sequence: number, fileId: string, fileName: string) {
  return createDefaultFileNodeData(
    createSequentialNodeId(sequence),
    { x: sequence * 10, y: sequence * 10 },
    'image',
    fileId,
    fileName,
    1024,
    'image/png',
    {
      width: 1024,
      height: 768,
    },
  );
}

function createWorkflow(node: AINodeData, fileNodes: ReturnType<typeof createImageNode>[]): Workflow {
  const nodes: Workflow['nodes'] = {
    [node.id.value]: node,
  };

  fileNodes.forEach((fileNode) => {
    nodes[fileNode.id.value] = fileNode;
  });

  return {
    id: 'workflow-ai-image-gen',
    projectId: 'project-ai-image-gen',
    name: 'AI 生图测试画布',
    nodes,
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: Object.keys(nodes).length,
      connectionCount: 0,
      lastNodeId: Math.max(...Object.keys(nodes).map((value) => Number.parseInt(value, 10))),
      canvasSize: {
        width: 1920,
        height: 1080,
      },
      relatedTasks: [],
      usedNodeIds: Object.keys(nodes),
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

function createResolvedGroup(
  groupId: string,
  order: number,
  inputNodes: ReturnType<typeof createImageNode>[],
): WorkflowResolvedNodeGroupState {
  return {
    group: {
      id: groupId,
      label: `Group ${order + 1}`,
      order,
    },
    ports: [{
      portId: AI_IMAGE_INPUT_PORT_ID,
      label: '图片序列',
      handle: getAIImageGenGroupInputHandle(groupId),
      inputs: inputNodes.map((sourceNode, index) => ({
        groupId,
        portId: AI_IMAGE_INPUT_PORT_ID,
        handle: getAIImageGenGroupInputHandle(groupId),
        connection: {
          id: `connection-${groupId}-${index + 1}`,
          type: 'file-reference',
          sourceId: sourceNode.id.value,
          targetId: '100',
          targetHandle: getAIImageGenGroupInputHandle(groupId),
          order: index,
        },
        sourceNode,
      })),
    }],
  };
}

function createContext(options: {
  prompt?: string;
  model?: string;
  imageSize?: string;
  aspectRatio?: string;
  quality?: string;
  groups: WorkflowResolvedNodeGroupState[];
  services?: ExecutionRuntimeNodeAdapterContext['services'];
}): ExecutionRuntimeNodeAdapterContext {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiImageGen',
  );

  node.config = {
    ...node.config,
    prompt: options.prompt ?? '共享提示词',
    model: options.model ?? 'gpt-image-2-vip',
    imageSize: options.imageSize ?? '2K',
    aspectRatio: options.aspectRatio ?? '16:9',
    ...(typeof options.quality === 'string' ? { quality: options.quality } : {}),
  };

  const fileNodes = options.groups.flatMap((group) => group.ports.flatMap((port) => port.inputs.map((input) => input.sourceNode)));

  return {
    workflowId: 'workflow-ai-image-gen',
    workflow: createWorkflow(node, fileNodes),
    node,
    nodeTitle: 'AI 生图',
    inputs: [],
    resolvedInputGroups: options.groups,
    signal: undefined,
    services: options.services,
  };
}

function createRunSnapshot(): ExecutionRuntimeRunState {
  return {
    runId: 'run-ai-image-gen',
    runNo: 'RUN-AI-IMAGE-GEN-001',
    workflowId: 'workflow-ai-image-gen',
    nodeId: '100',
    nodeType: 'aiImageGen',
    status: 'processing',
    totalTaskCount: 2,
    completedTaskCount: 1,
    failedTaskCount: 0,
    progress: 50,
    message: '处理中',
    createdAt: 1,
    startedAt: 2,
    completedAt: null,
    isTerminal: false,
    hasCommittableOutput: true,
    allOutputsCommitted: false,
    tasks: [
      {
        taskId: 'task-group-1',
        taskNo: 'TASK-AI-001',
        runId: 'run-ai-image-gen',
        runNo: 'RUN-AI-IMAGE-GEN-001',
        nodeId: '100',
        nodeType: 'aiImageGen',
        groupId: 'group-1',
        groupOrder: 0,
        status: 'completed',
        currentStep: 'final',
        currentAttemptNo: 1,
        retryCount: 0,
        maxRetries: 2,
        maxAttempts: 3,
        progress: 100,
        message: '完成',
        error: null,
        errorCode: null,
        lastErrorCode: null,
        resultFileId: 'result-file-1',
        resultFileInfo: {
          id: 'result-file-1',
          name: 'result-file-1.png',
          originalName: 'result-file-1.png',
          size: 1024,
          mimeType: 'image/png',
          format: 'png',
          fileType: 'image',
          status: 'ready',
          hash: 'hash-result-file-1',
          path: '/files/result-file-1',
          metadata: {
            width: 1024,
            height: 768,
          },
          source: {
            type: 'node-output',
            producerNodeId: '100',
            producerNodeDisplayId: '#00100',
            producerNodeType: 'aiImageGen',
            taskId: 'task-group-1',
            taskNo: 'TASK-AI-001',
            taskCreatedAt: 1,
            taskStartedAt: 2,
            taskCompletedAt: 3,
          },
          timestamp: {
            created: 1,
            updated: 1,
          },
        },
        resultCommitStatus: 'ready',
        resultCommittedAt: null,
        resultCommitError: null,
        canCommitOutput: true,
        isTerminal: true,
        isOutputCommitted: false,
      },
      {
        taskId: 'task-group-2',
        taskNo: 'TASK-AI-002',
        runId: 'run-ai-image-gen',
        runNo: 'RUN-AI-IMAGE-GEN-001',
        nodeId: '100',
        nodeType: 'aiImageGen',
        groupId: 'group-2',
        groupOrder: 1,
        status: 'processing',
        currentStep: 'final',
        currentAttemptNo: 1,
        retryCount: 0,
        maxRetries: 2,
        maxAttempts: 3,
        progress: 0,
        message: '处理中',
        error: null,
        errorCode: null,
        lastErrorCode: null,
        resultFileId: null,
        resultCommitStatus: 'idle',
        resultCommittedAt: null,
        resultCommitError: null,
        canCommitOutput: false,
        isTerminal: false,
        isOutputCommitted: false,
      },
    ],
  };
}

test('AI 生图适配器在缺少 Prompt 时返回明确校验错误', () => {
  const context = createContext({
    prompt: '   ',
    groups: [createResolvedGroup('group-1', 0, [createImageNode(1, 'file-1', 'image-1.png')])],
  });

  const result = aiImageGenExecutionRuntimeAdapter.validateExecution(context);

  assert.deepEqual(result, {
    valid: false,
    reason: 'AI 生图节点的 Prompt 不能为空。',
  });
});

test('AI 生图适配器会拦截单组超过 5 张图的输入', () => {
  const groupInputs = [
    createImageNode(1, 'file-1', 'image-1.png'),
    createImageNode(2, 'file-2', 'image-2.png'),
    createImageNode(3, 'file-3', 'image-3.png'),
    createImageNode(4, 'file-4', 'image-4.png'),
    createImageNode(5, 'file-5', 'image-5.png'),
    createImageNode(6, 'file-6', 'image-6.png'),
  ];
  const context = createContext({
    groups: [createResolvedGroup('group-1', 0, groupInputs)],
  });

  const result = aiImageGenExecutionRuntimeAdapter.validateExecution(context);

  assert.deepEqual(result, {
    valid: false,
    reason: '组 Group 1 的输入数量不能超过 5 张。',
  });
});

test('AI 生图适配器允许无图片输入并创建纯文本出图载荷', async () => {
  const context = createContext({
    prompt: '纯文本出图提示词',
    model: 'gpt-image-2-vip',
    imageSize: '2K',
    aspectRatio: '1:1',
    groups: [createResolvedGroup('group-1', 0, [])],
  });

  const validation = aiImageGenExecutionRuntimeAdapter.validateExecution(context);
  const payload = await aiImageGenExecutionRuntimeAdapter.createExecutionPayload(context);
  const request = payload.request as Record<string, unknown>;

  assert.equal(validation.valid, true);
  assert.deepEqual(request.groups, [
    {
      groupId: 'group-1',
      referenceFileIds: [],
    },
  ]);
  assert.deepEqual(payload.targets, [
    {
      kind: 'group',
      nodeId: '100',
      nodeType: 'aiImageGen',
      groupId: 'group-1',
      groupOrder: 0,
      groupLabel: 'Group 1',
      outputHandle: getAIImageGenGroupOutputHandle('group-1'),
    },
  ]);
});

test('AI 生图适配器创建执行载荷时会保持组顺序和组内图片顺序', async () => {
  const group1Image2 = createImageNode(2, 'file-2', 'image-2.png');
  const group1Image1 = createImageNode(1, 'file-1', 'image-1.png');
  const group2Image1 = createImageNode(3, 'file-3', 'image-3.png');
  const ensureCalls: string[] = [];

  const context = createContext({
    prompt: '共享提示词',
    model: 'gpt-image-2-vip',
    imageSize: '4K',
    aspectRatio: '9:16',
    groups: [
      createResolvedGroup('group-1', 0, [group1Image2, group1Image1]),
      createResolvedGroup('group-2', 1, [group2Image1]),
    ],
    services: {
      ensureBackendFileId: async (node) => {
        ensureCalls.push(node.fileId);
        return `${node.fileId}-backend`;
      },
    },
  });

  const payload = await aiImageGenExecutionRuntimeAdapter.createExecutionPayload(context);

  assert.equal(payload.nodeType, 'aiImageGen');
  assert.equal(payload.taskType, 'image-gen');
  assert.equal(payload.executionKind, 'grouped');
  assert.deepEqual(ensureCalls, ['file-2', 'file-1', 'file-3']);
  assert.deepEqual(payload.request, {
    nodeType: 'aiImageGen',
    taskType: 'image-gen',
    executionMode: 'legacy-grouped-task',
    nodeId: '100',
    nodeTitle: 'AI 生图',
    prompt: '共享提示词',
    model: 'gpt-image-2-vip',
    imageSize: '4K',
    aspectRatio: '9:16',
    groups: [
      {
        groupId: 'group-1',
        referenceFileIds: ['file-2-backend', 'file-1-backend'],
      },
      {
        groupId: 'group-2',
        referenceFileIds: ['file-3-backend'],
      },
    ],
  });
  assert.deepEqual(payload.targets, [
    {
      kind: 'group',
      nodeId: '100',
      nodeType: 'aiImageGen',
      groupId: 'group-1',
      groupOrder: 0,
      groupLabel: 'Group 1',
      outputHandle: getAIImageGenGroupOutputHandle('group-1'),
    },
    {
      kind: 'group',
      nodeId: '100',
      nodeType: 'aiImageGen',
      groupId: 'group-2',
      groupOrder: 1,
      groupLabel: 'Group 2',
      outputHandle: getAIImageGenGroupOutputHandle('group-2'),
    },
  ]);
});

test('AI 生图适配器提取输出时只返回已完成 group，并保持 outputHandle 映射', () => {
  const snapshot = createRunSnapshot();
  const outputs = aiImageGenExecutionRuntimeAdapter.extractExecutionOutputs(snapshot, {
    workflowId: 'workflow-ai-image-gen',
    nodeId: '100',
    previousSnapshot: null,
    payload: {
      nodeId: '100',
      nodeType: 'aiImageGen',
      nodeTitle: 'AI 生图',
      taskType: 'image-gen',
      executionKind: 'grouped',
      request: {},
      targets: [
        {
          kind: 'group',
          nodeId: '100',
          nodeType: 'aiImageGen',
          groupId: 'group-1',
          groupOrder: 0,
          groupLabel: 'Group 1',
          outputHandle: getAIImageGenGroupOutputHandle('group-1'),
        },
        {
          kind: 'group',
          nodeId: '100',
          nodeType: 'aiImageGen',
          groupId: 'group-2',
          groupOrder: 1,
          groupLabel: 'Group 2',
          outputHandle: getAIImageGenGroupOutputHandle('group-2'),
        },
      ],
    },
  });

  assert.equal(outputs.length, 1);
  assert.deepEqual(outputs[0], {
    nodeId: '100',
    runId: 'run-ai-image-gen',
    taskId: 'task-group-1',
    resultFileId: 'result-file-1',
    groupId: 'group-1',
    groupOrder: 0,
    sourceHandle: getAIImageGenGroupOutputHandle('group-1'),
    resultFile: snapshot.tasks[0]?.resultFileInfo,
  });
});

test('AI image gen adapter forwards default model and does not send derived size', async () => {
  const context = createContext({
    model: 'gpt-image-2-vip',
    groups: [createResolvedGroup('group-1', 0, [createImageNode(1, 'file-1', 'image-1.png')])],
    services: {
      ensureBackendFileId: async (node) => `${node.fileId}-backend`,
    },
  });

  const payload = await aiImageGenExecutionRuntimeAdapter.createExecutionPayload(context);
  const request = payload.request as Record<string, unknown>;

  assert.equal(request.model, 'gpt-image-2-vip');
  assert.equal(request.imageSize, '2K');
  assert.equal(request.aspectRatio, '16:9');
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'size'), false);
});

test('AI image gen adapter rejects empty ensured reference backend file id', async () => {
  const context = createContext({
    prompt: 'Generate with reference',
    model: 'gpt-image-2-vip',
    groups: [createResolvedGroup('group-1', 0, [createImageNode(1, 'file-empty', 'empty.png')])],
    services: {
      ensureBackendFileId: async () => '   ',
    },
  });

  await assert.rejects(
    Promise.resolve(aiImageGenExecutionRuntimeAdapter.createExecutionPayload(context)),
    (error: unknown) => {
      assert.equal(typeof error, 'object');
      assert.ok(error !== null);
      assert.equal((error as { code?: string }).code, 'FILE_REGISTER_FAILED');
      assert.equal((error as { context?: { fieldName?: string } }).context?.fieldName, 'referenceFileId');
      return true;
    },
  );
});

test('AI image gen adapter omits image parameters for GPT Image 2 default model', async () => {
  const context = createContext({
    model: 'gpt-image-2',
    imageSize: '4K',
    aspectRatio: '16:9',
    groups: [createResolvedGroup('group-1', 0, [])],
  });

  const validation = aiImageGenExecutionRuntimeAdapter.validateExecution(context);
  const payload = await aiImageGenExecutionRuntimeAdapter.createExecutionPayload(context);
  const request = payload.request as Record<string, unknown>;

  assert.equal(validation.valid, true);
  assert.equal(request.model, 'gpt-image-2');
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'imageSize'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'aspectRatio'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'size'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'quality'), false);
});

test('AI image gen adapter forwards official quality and auto aspect ratio', async () => {
  const context = createContext({
    model: 'gpt-image-2-official',
    imageSize: '2K',
    aspectRatio: 'auto',
    quality: 'high',
    groups: [createResolvedGroup('group-1', 0, [])],
  });

  const validation = aiImageGenExecutionRuntimeAdapter.validateExecution(context);
  const payload = await aiImageGenExecutionRuntimeAdapter.createExecutionPayload(context);
  const request = payload.request as Record<string, unknown>;

  assert.equal(validation.valid, true);
  assert.equal(request.model, 'gpt-image-2-official');
  assert.equal(request.imageSize, '2K');
  assert.equal(request.aspectRatio, 'auto');
  assert.equal(request.quality, 'high');
  assert.deepEqual(request.groups, [
    {
      groupId: 'group-1',
      referenceFileIds: [],
    },
  ]);
});

test('AI image gen adapter does not forward quality for non-official models', async () => {
  const context = createContext({
    model: 'gpt-image-2-vip',
    imageSize: '2K',
    aspectRatio: '16:9',
    quality: 'high',
    groups: [createResolvedGroup('group-1', 0, [createImageNode(1, 'file-1', 'image-1.png')])],
    services: {
      ensureBackendFileId: async (node) => `${node.fileId}-backend`,
    },
  });

  const payload = await aiImageGenExecutionRuntimeAdapter.createExecutionPayload(context);
  const request = payload.request as Record<string, unknown>;

  assert.equal(request.model, 'gpt-image-2-vip');
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'quality'), false);
});

test('AI image gen adapter rejects official model when reference images are connected', async () => {
  const context = createContext({
    model: 'gpt-image-2-official',
    imageSize: '2K',
    aspectRatio: '16:9',
    quality: 'medium',
    groups: [createResolvedGroup('group-1', 0, [createImageNode(1, 'file-1', 'image-1.png')])],
    services: {
      ensureBackendFileId: async (node) => `${node.fileId}-backend`,
    },
  });

  const validation = aiImageGenExecutionRuntimeAdapter.validateExecution(context);

  assert.equal(validation.valid, false);
  assert.equal((validation as { reason?: string }).reason?.includes('text-to-image only'), true);
  await assert.rejects(
    async () => aiImageGenExecutionRuntimeAdapter.createExecutionPayload(context),
    /text-to-image only/,
  );
});
