import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkflowResolvedNodeGroupState } from '@/contracts/workflow';
import type { Workflow, AINodeData } from '@/types';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import type { ExecutionRuntimeNodeAdapterContext } from '../node-execution-adapter.types';
import type { ExecutionRuntimeRunState } from '../execution-runtime.types';
import { aiVideoGenExecutionRuntimeAdapter } from './ai-video-gen.adapter';
import {
  AI_VIDEO_GEN_INPUT_PORT_ID,
  getAIVideoGenGroupInputHandle,
  getAIVideoGenGroupOutputHandle,
} from '@/nodes/ai-video-gen/groups';

function assertInvalid(
  result: { valid: true } | { valid: false; reason: string },
  pattern?: RegExp,
): string {
  assert.equal(result.valid, false);
  if (result.valid) {
    throw new Error('expected invalid result');
  }

  if (pattern) {
    assert.ok(pattern.test(result.reason), `expected "${result.reason}" to match ${String(pattern)}`);
  }

  return result.reason;
}

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
    id: 'workflow-ai-video-gen',
    projectId: 'project-ai-video-gen',
    name: 'AI Video Gen Workflow',
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
      portId: AI_VIDEO_GEN_INPUT_PORT_ID,
      label: 'Reference images',
      handle: getAIVideoGenGroupInputHandle(groupId),
      inputs: inputNodes.map((sourceNode, index) => ({
        groupId,
        portId: AI_VIDEO_GEN_INPUT_PORT_ID,
        handle: getAIVideoGenGroupInputHandle(groupId),
        connection: {
          id: `connection-${groupId}-${index + 1}`,
          type: 'file-reference',
          sourceId: sourceNode.id.value,
          targetId: '100',
          targetHandle: getAIVideoGenGroupInputHandle(groupId),
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
  duration?: number;
  groups: WorkflowResolvedNodeGroupState[];
  services?: ExecutionRuntimeNodeAdapterContext['services'];
}): ExecutionRuntimeNodeAdapterContext {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiVideoGen',
  );

  node.config = {
    ...node.config,
    prompt: options.prompt ?? 'Create a smooth product demo video',
    model: options.model ?? 'veo-3.1-landscape-fast-fl',
    duration: options.duration ?? 8,
    aspectRatio: '9:16',
    resolutionPreset: '1080p',
  };

  const fileNodes = options.groups.flatMap((group) => group.ports.flatMap((port) => port.inputs.map((input) => input.sourceNode)));

  return {
    workflowId: 'workflow-ai-video-gen',
    workflow: createWorkflow(node, fileNodes),
    node,
    nodeTitle: 'AI Video Gen',
    inputs: [],
    resolvedInputGroups: options.groups,
    signal: undefined,
    services: options.services,
  };
}

function createRunSnapshot(): ExecutionRuntimeRunState {
  return {
    runId: 'run-ai-video-gen',
    runNo: 'RUN-AI-VIDEO-GEN-001',
    workflowId: 'workflow-ai-video-gen',
    nodeId: '100',
    nodeType: 'aiVideoGen',
    status: 'processing',
    totalTaskCount: 2,
    completedTaskCount: 1,
    failedTaskCount: 0,
    progress: 50,
    message: 'Processing',
    createdAt: 1,
    startedAt: 2,
    completedAt: null,
    isTerminal: false,
    hasCommittableOutput: true,
    allOutputsCommitted: false,
    tasks: [
      {
        taskId: 'task-group-1',
        taskNo: 'TASK-VIDEO-001',
        runId: 'run-ai-video-gen',
        runNo: 'RUN-AI-VIDEO-GEN-001',
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
        message: 'Completed',
        error: null,
        errorCode: null,
        lastErrorCode: null,
        resultFileId: 'video-result-1',
        resultFileInfo: {
          id: 'video-result-1',
          name: 'video-result-1',
          originalName: 'video-result-1.mp4',
          size: 2048,
          mimeType: 'video/mp4',
          format: 'mp4',
          fileType: 'video',
          status: 'ready',
          hash: 'hash-video-result-1',
          path: '/files/video-result-1/download',
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
            taskId: 'task-group-1',
            taskNo: 'TASK-VIDEO-001',
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
        taskNo: 'TASK-VIDEO-002',
        runId: 'run-ai-video-gen',
        runNo: 'RUN-AI-VIDEO-GEN-001',
        nodeId: '100',
        nodeType: 'aiVideoGen',
        groupId: 'group-2',
        groupOrder: 1,
        status: 'processing',
        currentStep: 'final',
        currentAttemptNo: 1,
        retryCount: 0,
        maxRetries: 2,
        maxAttempts: 3,
        progress: 0,
        message: 'Processing',
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

test('aiVideoGen adapter validates prompt and group input count', () => {
  const invalidPromptContext = createContext({
    prompt: '   ',
    groups: [createResolvedGroup('group-1', 0, [createImageNode(1, 'file-1', 'image-1.png')])],
  });

  const invalidPromptResult = aiVideoGenExecutionRuntimeAdapter.validateExecution(invalidPromptContext);
  assert.ok(assertInvalid(invalidPromptResult).length > 0);

  const invalidCountContext = createContext({
    groups: [createResolvedGroup('group-1', 0, [
      createImageNode(1, 'file-1', 'image-1.png'),
      createImageNode(2, 'file-2', 'image-2.png'),
      createImageNode(3, 'file-3', 'image-3.png'),
    ])],
  });

  const invalidCountResult = aiVideoGenExecutionRuntimeAdapter.validateExecution(invalidCountContext);
  assertInvalid(invalidCountResult, /Group 1/);
});

test('aiVideoGen adapter builds grouped execution payload in group and image order', async () => {
  const group1Image2 = createImageNode(2, 'file-2', 'image-2.png');
  const group1Image1 = createImageNode(1, 'file-1', 'image-1.png');
  const group2Image1 = createImageNode(3, 'file-3', 'image-3.png');
  const ensureCalls: string[] = [];

  const context = createContext({
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

  const payload = await aiVideoGenExecutionRuntimeAdapter.createExecutionPayload(context);

  assert.deepEqual(ensureCalls, ['file-2', 'file-1', 'file-3']);
  assert.deepEqual(payload.request, {
    nodeType: 'aiVideoGen',
    taskType: 'video-gen',
    executionMode: 'legacy-grouped-task',
    nodeId: '100',
    nodeTitle: 'AI Video Gen',
    prompt: 'Create a smooth product demo video',
    model: 'veo-3.1-fast-generate-preview',
    duration: 8,
    aspectRatio: '9:16',
    resolution: '1080p',
    size: '1080x1920',
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
      nodeType: 'aiVideoGen',
      groupId: 'group-1',
      groupOrder: 0,
      groupLabel: 'Group 1',
      outputHandle: getAIVideoGenGroupOutputHandle('group-1'),
    },
    {
      kind: 'group',
      nodeId: '100',
      nodeType: 'aiVideoGen',
      groupId: 'group-2',
      groupOrder: 1,
      groupLabel: 'Group 2',
      outputHandle: getAIVideoGenGroupOutputHandle('group-2'),
    },
  ]);
});

test('aiVideoGen adapter rejects empty ensured backend file id', async () => {
  const context = createContext({
    groups: [createResolvedGroup('group-1', 0, [createImageNode(1, 'file-1', 'image-1.png')])],
    services: {
      ensureBackendFileId: async () => '   ',
    },
  });

  await assert.rejects(
    Promise.resolve(aiVideoGenExecutionRuntimeAdapter.createExecutionPayload(context)),
    (error: unknown) => {
      assert.equal(typeof error, 'object');
      assert.ok(error !== null);
      assert.equal((error as { code?: string }).code, 'FILE_REGISTER_FAILED');
      return true;
    },
  );
});

test('aiVideoGen adapter extracts only completed grouped outputs with matching result handle', () => {
  const snapshot = createRunSnapshot();
  const outputs = aiVideoGenExecutionRuntimeAdapter.extractExecutionOutputs(snapshot, {
    workflowId: 'workflow-ai-video-gen',
    nodeId: '100',
    previousSnapshot: null,
    payload: {
      nodeId: '100',
      nodeType: 'aiVideoGen',
      nodeTitle: 'AI Video Gen',
      taskType: 'video-gen',
      executionKind: 'grouped',
      request: {},
      targets: [
        {
          kind: 'group',
          nodeId: '100',
          nodeType: 'aiVideoGen',
          groupId: 'group-1',
          groupOrder: 0,
          groupLabel: 'Group 1',
          outputHandle: getAIVideoGenGroupOutputHandle('group-1'),
        },
        {
          kind: 'group',
          nodeId: '100',
          nodeType: 'aiVideoGen',
          groupId: 'group-2',
          groupOrder: 1,
          groupLabel: 'Group 2',
          outputHandle: getAIVideoGenGroupOutputHandle('group-2'),
        },
      ],
    },
  });

  assert.equal(outputs.length, 1);
  assert.deepEqual(outputs[0], {
    nodeId: '100',
    runId: 'run-ai-video-gen',
    taskId: 'task-group-1',
    resultFileId: 'video-result-1',
    groupId: 'group-1',
    groupOrder: 0,
    sourceHandle: getAIVideoGenGroupOutputHandle('group-1'),
    resultFile: snapshot.tasks[0]?.resultFileInfo,
  });
});
