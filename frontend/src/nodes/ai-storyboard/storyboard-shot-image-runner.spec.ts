import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  AINodeData,
  AuthSuccessResponseData,
  FileNodeData,
  StoryboardShotData,
  Workflow,
} from '@/types';
import type { CreateBackendExecutionRequest } from '@/services/backendExecutionService';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import { AI_STORYBOARD_DEFAULT_SIZE } from './constants';
import { runStoryboardShotImage } from './storyboard-shot-image-runner';

const AUTH_SUCCESS: AuthSuccessResponseData = {
  tokens: {
    accessToken: 'token',
    refreshToken: 'refresh',
    tokenType: 'Bearer',
    expiresIn: 3600,
  },
  user: {
    userId: 'user-1',
    email: 'user@example.com',
    displayName: 'User',
    role: 'member',
    status: 'enabled',
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
};

function createShot(overrides: Partial<StoryboardShotData> = {}): StoryboardShotData {
  return {
    id: 'shot-1',
    order: 1,
    row: 0,
    col: 0,
    originalIndex: 1,
    originalTotal: 1,
    sourceNodeId: '10',
    sourceFileId: 'source-file-1',
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

function createStoryboardNode(shots: StoryboardShotData[]): AINodeData {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 120 },
    'aiStoryboard',
  ) as AINodeData;

  node.dimensions = { ...AI_STORYBOARD_DEFAULT_SIZE };
  node.config = {
    ...node.config,
    shots,
    processedInputFileIds: ['source-file-1'],
  };

  return node;
}

function createImageNode(): FileNodeData {
  return createDefaultFileNodeData(
    createSequentialNodeId(10),
    { x: 0, y: 0 },
    'image',
    'source-file-1',
    'source.png',
    1024,
    'image/png',
    { width: 1024, height: 768 },
    {
      type: 'imported',
      sourceDisplayName: 'source.png',
      importedAt: 1,
    },
  );
}

function createWorkflow(shots: StoryboardShotData[]): Workflow {
  const storyboardNode = createStoryboardNode(shots);
  const sourceNode = createImageNode();

  return {
    id: 'workflow-storyboard-image',
    projectId: 'project-storyboard-image',
    name: 'Storyboard Image',
    nodes: {
      [storyboardNode.id.value]: storyboardNode,
      [sourceNode.id.value]: sourceNode,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 2,
      connectionCount: 0,
      lastNodeId: 100,
      canvasSize: { width: 1920, height: 1080 },
      relatedTasks: [],
      usedNodeIds: ['100', '10'],
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

function createAuth() {
  return {
    status: 'authenticated' as const,
    isAuthenticated: true,
    isBusy: false,
    user: null,
    error: null,
    login: async () => ({ success: true as const, data: AUTH_SUCCESS }),
    register: async () => ({ success: true as const, data: AUTH_SUCCESS }),
    logout: async () => ({ success: true as const, data: undefined }),
    clearSession: () => undefined,
    restoreSession: async () => ({ success: true as const, data: null }),
    refreshSession: async () => ({ success: true as const, data: null }),
    clearError: () => undefined,
  };
}

function createNotifications() {
  const calls: Array<{ kind: string; title: string; message: string }> = [];
  return {
    calls,
    notification: {
      showWarning: (title: string, message: string) => calls.push({ kind: 'warning', title, message }),
      showInfo: (title: string, message: string) => calls.push({ kind: 'info', title, message }),
      showSuccess: (title: string, message: string) => calls.push({ kind: 'success', title, message }),
      showError: (title: string, message: string) => calls.push({ kind: 'error', title, message }),
      showAuthFeedback: () => false,
    },
  };
}

test('runStoryboardShotImage submits storyboard requests with node-action-only execution mode', async () => {
  const shot = createShot();
  const workflow = createWorkflow([shot]);
  const notifications = createNotifications();
  const requests: CreateBackendExecutionRequest[] = [];

  await runStoryboardShotImage('100', 'shot-1', {
    auth: createAuth(),
    getNodeById: (nodeId) => workflow.nodes[nodeId] ?? null,
    getNodeNameById: () => 'AI Storyboard',
    getCurrentWorkflow: () => workflow,
    ensureWorkflowPersistedForExecution: async () => workflow,
    ensureBackendFileId: async () => 'backend-source-ready',
    patchStoryboardShotState: (_nodeId, _shotId, updater) => {
      const currentShots = (workflow.nodes['100'] as AINodeData).config.shots as StoryboardShotData[];
      (workflow.nodes['100'] as AINodeData).config.shots = updater(currentShots);
      return true;
    },
    getCommittedStoryboardGroupState: () => null,
    syncTaskRefsToWorkflow: () => undefined,
    commitBackendExecutionOutputs: async () => undefined,
    buildExecutionRuntimeAdapterContext: () => ({
      workflowId: workflow.id,
      workflow,
      node: workflow.nodes['100'] as AINodeData,
      nodeTitle: 'AI Storyboard',
      inputs: [],
      resolvedInputGroups: [],
      services: {},
    }),
    createOutputCommitInput: () => ({
      kind: 'legacy-grouped-targets',
      targets: [],
      mode: 'incremental',
    }),
    setStoryboardNodeExecutionState: () => undefined,
    setStoryboardGroupExecutionState: () => undefined,
    createGroupedExecution: async (request) => {
      requests.push(request);
      return {
        runId: 'run-image-success',
        runNo: 'RUN-image-success',
        status: 'completed',
        tasks: [{
          taskId: 'task-image-success',
          taskNo: 'TASK-image-success',
          groupId: 'shot-1',
          groupOrder: 1,
          status: 'completed',
        }],
      };
    },
    startExecutionPolling: async () => ({
      runId: 'run-image-success',
      runNo: 'RUN-image-success',
      workflowId: workflow.id,
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
        taskId: 'task-image-success',
        taskNo: 'TASK-image-success',
        runId: 'run-image-success',
        runNo: 'RUN-image-success',
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
        message: 'done',
        error: null,
        errorCode: null,
        lastErrorCode: null,
        resultFileId: 'image-success',
        resultCommitStatus: 'ready',
        resultCommittedAt: null,
        resultCommitError: null,
        canCommitOutput: true,
        isTerminal: true,
        isOutputCommitted: false,
      }],
    }),
    notification: notifications.notification,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.executionMode, 'node-action-only');
  const request = requests[0] as unknown as Record<string, unknown> | undefined;
  assert.equal(request?.model, 'gemini-3-pro-image-preview');
  assert.equal(request?.imageSize, '1K');
  assert.equal(request?.aspectRatio, 'auto');
  assert.deepEqual(requests[0]?.groups, [{ groupId: 'shot-1', referenceFileIds: ['backend-source-ready'] }]);
});

test('runStoryboardShotImage forwards GPT image model config without sending derived size', async () => {
  const shot = createShot({
    imageModel: 'gpt-image-2-vip',
    imageSize: '4K',
    imageAspectRatio: '16:9',
  });
  const workflow = createWorkflow([shot]);
  const requests: CreateBackendExecutionRequest[] = [];

  await runStoryboardShotImage('100', 'shot-1', {
    auth: createAuth(),
    getNodeById: (nodeId) => workflow.nodes[nodeId] ?? null,
    getNodeNameById: () => 'AI Storyboard',
    getCurrentWorkflow: () => workflow,
    ensureWorkflowPersistedForExecution: async () => workflow,
    ensureBackendFileId: async () => 'backend-source-ready',
    patchStoryboardShotState: (_nodeId, _shotId, updater) => {
      const currentShots = (workflow.nodes['100'] as AINodeData).config.shots as StoryboardShotData[];
      (workflow.nodes['100'] as AINodeData).config.shots = updater(currentShots);
      return true;
    },
    getCommittedStoryboardGroupState: () => null,
    syncTaskRefsToWorkflow: () => undefined,
    commitBackendExecutionOutputs: async () => undefined,
    buildExecutionRuntimeAdapterContext: () => ({
      workflowId: workflow.id,
      workflow,
      node: workflow.nodes['100'] as AINodeData,
      nodeTitle: 'AI Storyboard',
      inputs: [],
      resolvedInputGroups: [],
      services: {},
    }),
    createOutputCommitInput: () => ({
      kind: 'legacy-grouped-targets',
      targets: [],
      mode: 'incremental',
    }),
    setStoryboardNodeExecutionState: () => undefined,
    setStoryboardGroupExecutionState: () => undefined,
    createGroupedExecution: async (request) => {
      requests.push(request);
      return {
        runId: 'run-image-success',
        runNo: 'RUN-image-success',
        status: 'completed',
        tasks: [{
          taskId: 'task-image-success',
          taskNo: 'TASK-image-success',
          groupId: 'shot-1',
          groupOrder: 1,
          status: 'completed',
        }],
      };
    },
    startExecutionPolling: async () => ({
      runId: 'run-image-success',
      runNo: 'RUN-image-success',
      workflowId: workflow.id,
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
        taskId: 'task-image-success',
        taskNo: 'TASK-image-success',
        runId: 'run-image-success',
        runNo: 'RUN-image-success',
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
        message: 'done',
        error: null,
        errorCode: null,
        lastErrorCode: null,
        resultFileId: 'image-success',
        resultCommitStatus: 'ready',
        resultCommittedAt: null,
        resultCommitError: null,
        canCommitOutput: true,
        isTerminal: true,
        isOutputCommitted: false,
      }],
    }),
    notification: createNotifications().notification,
  });

  assert.equal(requests.length, 1);
  const request = requests[0] as unknown as Record<string, unknown> | undefined;
  assert.equal(request?.model, 'gpt-image-2-vip');
  assert.equal(request?.imageSize, '4K');
  assert.equal(request?.aspectRatio, '16:9');
  assert.equal(Object.prototype.hasOwnProperty.call(request ?? {}, 'size'), false);
});
