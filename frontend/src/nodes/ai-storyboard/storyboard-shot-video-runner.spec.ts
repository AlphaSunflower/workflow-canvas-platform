import test from 'node:test';
import assert from 'node:assert/strict';

import type {
  AINodeData,
  AuthSuccessResponseData,
  FileInfo,
  FileNodeData,
  NodeTaskRef,
  StoryboardShotData,
  Workflow,
} from '@/types';
import type {
  BackendExecutionSummary,
  CreateAIVideoGenExecutionRequest,
  CreateBackendExecutionRequest,
} from '@/services/backendExecutionService';
import type { ExecutionOutputCommitWorkflowInput } from '@/execution-runtime/execution-output-commit.types';
import type { ExecutionRuntimeRunState } from '@/execution-runtime/execution-runtime.types';
import type { WorkflowNodeGroupExecutionState } from '@/contracts/execution';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import { AI_STORYBOARD_DEFAULT_SIZE } from './constants';
import { runStoryboardShotVideo } from './storyboard-shot-video-runner';

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
    id: 'workflow-storyboard-video',
    projectId: 'project-storyboard-video',
    name: 'Storyboard Video',
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

function createRunSnapshot(resultFileId: string): ExecutionRuntimeRunState {
  const resultFile: FileInfo = {
    id: resultFileId,
    name: `${resultFileId}.mp4`,
    originalName: `${resultFileId}.mp4`,
    size: 1024,
    mimeType: 'video/mp4',
    format: 'mp4',
    fileType: 'video',
    status: 'ready',
    hash: `hash-${resultFileId}`,
    path: `/files/${resultFileId}/download`,
    metadata: { duration: 8, width: 1920, height: 1080 },
    source: { type: 'node-output' },
    timestamp: { created: 1, updated: 1 },
  };

  return {
    runId: `run-${resultFileId}`,
    runNo: `RUN-${resultFileId}`,
    workflowId: 'workflow-storyboard-video',
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
      taskId: `task-${resultFileId}`,
      taskNo: `TASK-${resultFileId}`,
      runId: `run-${resultFileId}`,
      runNo: `RUN-${resultFileId}`,
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
      resultFileId,
      resultFileInfo: resultFile,
      resultCommitStatus: 'ready',
      resultCommittedAt: null,
      resultCommitError: null,
      canCommitOutput: true,
      isTerminal: true,
      isOutputCommitted: false,
    }],
  };
}

function createExecutionSummary(): BackendExecutionSummary {
  return {
    runId: 'run-video-success',
    runNo: 'RUN-video-success',
    status: 'queued',
    tasks: [{
      taskId: 'task-video-success',
      taskNo: 'TASK-video-success',
      groupId: 'shot-1',
      groupOrder: 1,
      status: 'queued',
    }],
  };
}

function assertVideoRequest(
  request: CreateBackendExecutionRequest | undefined,
): CreateAIVideoGenExecutionRequest {
  if (!request) {
    throw new Error('missing video request');
  }
  assert.equal(request.taskType, 'video-gen');
  return request as CreateAIVideoGenExecutionRequest;
}

function createNoopCommitInput(): ExecutionOutputCommitWorkflowInput {
  return {
    kind: 'legacy-grouped-targets',
    targets: [],
    mode: 'incremental',
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

test('runStoryboardShotVideo writes unavailable reason back to shot state when no confirmed backend reference exists', async () => {
  const shot = createShot({
    sourceNodeId: undefined,
    sourceFileId: 'local-source',
    sourceImageFileId: 'local-source',
    imageFileId: undefined,
  });
  const workflow = createWorkflow([shot]);
  const patches: StoryboardShotData[][] = [];
  const notifications = createNotifications();

  await runStoryboardShotVideo('100', 'shot-1', {
    auth: createAuth(),
    getNodeById: (nodeId) => workflow.nodes[nodeId] ?? null,
    getNodeNameById: () => 'AI Storyboard',
    getCurrentWorkflow: () => workflow,
    ensureWorkflowPersistedForExecution: async () => workflow,
    ensureBackendFileId: async () => null,
    patchStoryboardShotState: (_nodeId, _shotId, updater) => {
      const nextShots = updater([shot]);
      patches.push(nextShots);
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
    createOutputCommitInput: createNoopCommitInput,
    setStoryboardNodeExecutionState: () => undefined,
    setStoryboardGroupExecutionState: () => undefined,
    createGroupedExecution: async () => {
      throw new Error('should not create execution without valid references');
    },
    startExecutionPolling: async () => {
      throw new Error('should not start polling without valid references');
    },
    logWarn: () => undefined,
    notification: notifications.notification,
  });

  assert.equal(patches.length, 1);
  assert.equal(patches[0]?.[0]?.videoGenStatus, 'idle');
  assert.equal(typeof patches[0]?.[0]?.videoError, 'string');
  assert.equal(notifications.calls.some((item) => item.kind === 'warning'), true);
});

test('runStoryboardShotVideo retries timeout-like failures and accepts recovered committed output before resubmitting', async () => {
  const shot = createShot();
  const workflow = createWorkflow([shot]);
  const notifications = createNotifications();
  const createdRequests: CreateBackendExecutionRequest[] = [];
  const groupStates: WorkflowNodeGroupExecutionState[] = [];
  let attemptCount = 0;
  let committedRecovered = false;

  await runStoryboardShotVideo('100', 'shot-1', {
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
    getCommittedStoryboardGroupState: (_nodeId, _shotId, options) => {
      if (!committedRecovered || options?.fileType !== 'video') {
        return null;
      }
      return {
        workflowId: workflow.id,
        nodeId: '100',
        nodeType: 'aiStoryboard',
        groupId: 'shot-1',
        groupOrder: 1,
        taskRecordId: null,
        aiTaskId: null,
        status: 'completed',
        progress: 100,
        message: 'Recovered video output from reconcile',
        resultFileId: 'video-recovered',
        isOutputCommitted: true,
      };
    },
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
    createOutputCommitInput: createNoopCommitInput,
    setStoryboardNodeExecutionState: () => undefined,
    setStoryboardGroupExecutionState: (_nodeId, nextState) => {
      groupStates.push(nextState);
    },
    createGroupedExecution: async (request) => {
      createdRequests.push(request);
      attemptCount += 1;
      if (attemptCount === 1) {
        const error = new Error('timeout while waiting for provider');
        (error as Error & { code?: string }).code = 'TIMEOUT_ERROR';
        throw error;
      }
      return createExecutionSummary();
    },
    startExecutionPolling: async () => createRunSnapshot('video-success'),
    logWarn: () => undefined,
    sleepWithAbort: async () => {
      committedRecovered = true;
    },
    notification: notifications.notification,
  }, {
    signal: undefined,
    suppressNotifications: true,
  });

  assert.equal(createdRequests.length >= 1, true);
  assert.equal(createdRequests[0]?.executionMode, 'node-action-only');
  assert.equal(groupStates.some((state) => state.status === 'processing' && state.message?.includes('等待自动重试')), true);
});

test('runStoryboardShotVideo submits grouped execution and commits outputs through shared pipeline on success', async () => {
  const shot = createShot({ imageFileId: 'generated-image-file' });
  const workflow = createWorkflow([shot]);
  const notifications = createNotifications();
  const committedSnapshots: string[] = [];
  const syncedTaskRefs: NodeTaskRef[][] = [];
  const requests: CreateBackendExecutionRequest[] = [];

  await runStoryboardShotVideo('100', 'shot-1', {
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
    syncTaskRefsToWorkflow: (_nodeId, taskRefs) => {
      syncedTaskRefs.push(taskRefs);
    },
    commitBackendExecutionOutputs: async (_node, snapshot) => {
      committedSnapshots.push(snapshot.runId);
    },
    buildExecutionRuntimeAdapterContext: () => ({
      workflowId: workflow.id,
      workflow,
      node: workflow.nodes['100'] as AINodeData,
      nodeTitle: 'AI Storyboard',
      inputs: [],
      resolvedInputGroups: [],
      services: {},
    }),
    createOutputCommitInput: createNoopCommitInput,
    setStoryboardNodeExecutionState: () => undefined,
    setStoryboardGroupExecutionState: () => undefined,
    createGroupedExecution: async (request) => {
      requests.push(request);
      return createExecutionSummary();
    },
    startExecutionPolling: async (options) => {
      const snapshot = createRunSnapshot('video-success');
      options.onSnapshot(snapshot);
      return snapshot;
    },
    logWarn: () => undefined,
    notification: notifications.notification,
  });

  assert.equal(requests.length, 1);
  const request = assertVideoRequest(requests[0]);
  assert.equal(request.executionMode, 'node-action-only');
  assert.equal(request.model, 'veo-3.1-fast-generate-preview');
  assert.equal(request.aspectRatio, '16:9');
  assert.equal(request.resolution, '720p');
  assert.equal(request.size, '1280x720');
  assert.deepEqual(request.groups, [{ groupId: 'shot-1', referenceFileIds: ['generated-image-file', 'backend-source-ready'] }]);
  assert.equal(syncedTaskRefs.length, 1);
  assert.deepEqual(committedSnapshots, ['run-video-success', 'run-video-success']);
  const updatedShot = ((workflow.nodes['100'] as AINodeData).config.shots as StoryboardShotData[])[0];
  assert.equal(updatedShot?.videoGenStatus, 'completed');
  assert.equal(updatedShot?.videoProgress, 100);
  assert.equal(notifications.calls.some((item) => item.kind === 'success'), true);
});

test('runStoryboardShotVideo passes official model and selected video parameters', async () => {
  const shot = createShot({
    videoModel: 'veo-3.1-generate-preview',
    videoAspectRatio: '9:16',
    videoResolution: '1080p',
  });
  const workflow = createWorkflow([shot]);
  const requests: CreateBackendExecutionRequest[] = [];
  const notifications = createNotifications();

  await runStoryboardShotVideo('100', 'shot-1', {
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
    createOutputCommitInput: createNoopCommitInput,
    setStoryboardNodeExecutionState: () => undefined,
    setStoryboardGroupExecutionState: () => undefined,
    createGroupedExecution: async (request) => {
      requests.push(request);
      return createExecutionSummary();
    },
    startExecutionPolling: async (options) => {
      const snapshot = createRunSnapshot('video-selected-params');
      options.onSnapshot(snapshot);
      return snapshot;
    },
    logWarn: () => undefined,
    notification: notifications.notification,
  }, { suppressNotifications: true });

  assert.equal(requests.length, 1);
  const request = assertVideoRequest(requests[0]);
  assert.equal(request.model, 'veo-3.1-generate-preview');
  assert.equal(request.aspectRatio, '9:16');
  assert.equal(request.resolution, '1080p');
  assert.equal(request.size, '1080x1920');
});
