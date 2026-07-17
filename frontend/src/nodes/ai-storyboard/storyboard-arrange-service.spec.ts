import test from 'node:test';
import assert from 'node:assert/strict';

import type { AINodeData, FileNodeData, Workflow } from '@/types';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import { AI_STORYBOARD_DEFAULT_SIZE } from './constants';
import type { AuthSuccessResponseData, StoryboardShotData } from '@/types';
import {
  applyStoryboardArrangeToWorkflow,
  runStoryboardArrange,
} from './storyboard-arrange-service';

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

function createStoryboardShot(overrides: Partial<StoryboardShotData> = {}): StoryboardShotData {
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

function createStoryboardNode(): AINodeData {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 120 },
    'aiStoryboard',
  ) as AINodeData;

  node.dimensions = { ...AI_STORYBOARD_DEFAULT_SIZE };
  node.config = {
    ...node.config,
    shots: [
      createStoryboardShot({ id: 'shot-a', order: 1, imageFileId: 'generated-a', prompt: 'old A' }),
      createStoryboardShot({ id: 'shot-b', order: 2, imageFileId: 'generated-b', prompt: 'old B' }),
      createStoryboardShot({ id: 'shot-c', order: 3, prompt: 'old C', sourceNodeId: undefined, sourceImageFileId: undefined, sourceFileId: undefined }),
    ],
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

function createWorkflow(): Workflow {
  const storyboardNode = createStoryboardNode();
  const sourceNode = createImageNode();

  return {
    id: 'workflow-storyboard-arrange',
    projectId: 'project-storyboard-arrange',
    name: 'Storyboard Arrange',
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

test('applyStoryboardArrangeToWorkflow rewrites only arranged shots and normalizes final order', () => {
  const workflow = createWorkflow();
  const nextWorkflow = applyStoryboardArrangeToWorkflow(workflow, '100', [
    { shotId: 'shot-b', order: 1, prompt: 'new B' },
    { shotId: 'shot-a', order: 2, prompt: 'new A' },
  ]);

  assert.ok(nextWorkflow);
  const nextNode = nextWorkflow?.nodes['100'] as AINodeData;
  const nextShots = nextNode.config.shots as StoryboardShotData[];
  assert.deepEqual(nextShots.map((shot) => shot.id), ['shot-b', 'shot-a', 'shot-c']);
  assert.deepEqual(nextShots.map((shot) => shot.order), [1, 2, 3]);
  assert.deepEqual(nextShots.map((shot) => shot.prompt), ['new B', 'new A', 'old C']);
});

test('runStoryboardArrange resolves arrangeable shots and applies returned order through callback', async () => {
  const workflow = createWorkflow();
  const notifications: Array<{ kind: string; title: string; message: string }> = [];
  const requests: Array<{
    workflowId: string;
    nodeId: string;
    nodeType: 'aiStoryboard';
    shots: Array<{ shotId: string; order: number; imageFileId: string }>;
  }> = [];
  let appliedResult: Array<{ shotId: string; order: number; prompt: string }> | null = null;

  await runStoryboardArrange('100', {
    auth: {
      status: 'authenticated',
      isAuthenticated: true,
      isBusy: false,
      user: null,
      error: null,
      login: async () => ({ success: true, data: AUTH_SUCCESS }),
      register: async () => ({ success: true, data: AUTH_SUCCESS }),
      logout: async () => ({ success: true, data: undefined }),
      clearSession: () => undefined,
      restoreSession: async () => ({ success: true, data: null }),
      refreshSession: async () => ({ success: true, data: null }),
      clearError: () => undefined,
    },
    getNodeNameById: () => 'AI Storyboard',
    getNodeById: (nodeId) => workflow.nodes[nodeId] ?? null,
    getCurrentWorkflow: () => workflow,
    applyStoryboardArrangeResult: (_nodeId, arranged) => {
      appliedResult = arranged;
      return true;
    },
    arrangeStoryboardShots: async (request) => {
      requests.push(request);
      return {
        success: true,
        data: {
          shots: [
            { shotId: 'shot-b', order: 1, prompt: 'new B' },
            { shotId: 'shot-a', order: 2, prompt: 'new A' },
          ],
          model: 'gemini',
          referenceCount: 2,
          promptVersion: 'v1',
        },
      };
    },
    getBackendFileInfo: async (fileId) => ({
      status: fileId.startsWith('generated-') ? 'ready' : 'missing',
    }),
    ensureBackendFileId: async () => 'backend-source-ready',
    notification: {
      showWarning: (title, message) => notifications.push({ kind: 'warning', title, message }),
      showInfo: (title, message) => notifications.push({ kind: 'info', title, message }),
      showSuccess: (title, message) => notifications.push({ kind: 'success', title, message }),
      showError: (title, message) => notifications.push({ kind: 'error', title, message }),
      showAuthFeedback: () => false,
    },
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]?.shots, [
    { shotId: 'shot-a', order: 1, imageFileId: 'generated-a' },
    { shotId: 'shot-b', order: 2, imageFileId: 'generated-b' },
  ]);
  assert.deepEqual(appliedResult, [
    { shotId: 'shot-b', order: 1, prompt: 'new B' },
    { shotId: 'shot-a', order: 2, prompt: 'new A' },
  ]);
  assert.equal(notifications.some((item) => item.kind === 'success'), true);
});
