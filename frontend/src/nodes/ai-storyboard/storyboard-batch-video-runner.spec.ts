import test from 'node:test';
import assert from 'node:assert/strict';

import type { AINodeData, StoryboardShotData, Workflow } from '@/types';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import { AI_STORYBOARD_DEFAULT_SIZE } from './constants';
import { runStoryboardBatchVideo } from './storyboard-batch-video-runner';

function createShot(overrides: Partial<StoryboardShotData> = {}): StoryboardShotData {
  return {
    id: 'shot-1',
    order: 1,
    row: 0,
    col: 0,
    originalIndex: 1,
    originalTotal: 1,
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

function createWorkflow(shots: StoryboardShotData[]): Workflow {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 120 },
    'aiStoryboard',
  ) as AINodeData;

  node.dimensions = { ...AI_STORYBOARD_DEFAULT_SIZE };
  node.config = {
    ...node.config,
    shots,
    processedInputFileIds: [],
  };

  return {
    id: 'workflow-storyboard-batch-video',
    projectId: 'project-storyboard-batch-video',
    name: 'Storyboard Batch Video',
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

function createNotifications() {
  const calls: Array<{ kind: string; title: string; message: string }> = [];
  return {
    calls,
    notification: {
      showWarning: (title: string, message: string) => calls.push({ kind: 'warning', title, message }),
      showInfo: (title: string, message: string) => calls.push({ kind: 'info', title, message }),
      showSuccess: (title: string, message: string) => calls.push({ kind: 'success', title, message }),
    },
  };
}

test('runStoryboardBatchVideo dispatches all non-generating shots concurrently and suppresses nested notifications', async () => {
  const workflow = createWorkflow([
    createShot({ id: 'shot-a', order: 1, videoGenStatus: 'idle' }),
    createShot({ id: 'shot-b', order: 2, videoGenStatus: 'generating' }),
    createShot({ id: 'shot-c', order: 3, videoGenStatus: 'failed' }),
  ]);
  const notifications = createNotifications();
  const calls: Array<{ shotId: string; suppressNotifications: boolean | undefined }> = [];

  await runStoryboardBatchVideo('100', {
    getNodeById: (nodeId) => workflow.nodes[nodeId] ?? null,
    getNodeNameById: () => 'AI Storyboard',
    getCurrentWorkflow: () => workflow,
    generateStoryboardShotVideo: async (_nodeId, shotId, options) => {
      calls.push({ shotId, suppressNotifications: options?.suppressNotifications });
      const shots = ((workflow.nodes['100'] as AINodeData).config.shots as StoryboardShotData[]).map((shot) => (
        shot.id === shotId ? { ...shot, videoGenStatus: 'completed' } : shot
      ));
      (workflow.nodes['100'] as AINodeData).config.shots = shots;
    },
    getCommittedStoryboardGroupState: (_nodeId, shotId) => ({
      workflowId: workflow.id,
      nodeId: '100',
      nodeType: 'aiStoryboard',
      groupId: shotId,
      groupOrder: shotId === 'shot-a' ? 1 : 3,
      taskRecordId: null,
      aiTaskId: null,
      status: 'completed',
      progress: 100,
      message: 'done',
      resultFileId: `video-${shotId}`,
      isOutputCommitted: true,
    }),
    notification: notifications.notification,
  });

  assert.deepEqual(calls, [
    { shotId: 'shot-a', suppressNotifications: true },
    { shotId: 'shot-c', suppressNotifications: true },
  ]);
  assert.equal(notifications.calls[0]?.kind, 'info');
  assert.equal(notifications.calls[notifications.calls.length - 1]?.kind, 'success');
});

test('runStoryboardBatchVideo reports mixed completion when some shots fail or cancel', async () => {
  const workflow = createWorkflow([
    createShot({ id: 'shot-a', order: 1, videoGenStatus: 'idle' }),
    createShot({ id: 'shot-b', order: 2, videoGenStatus: 'idle' }),
  ]);
  const notifications = createNotifications();

  await runStoryboardBatchVideo('100', {
    getNodeById: (nodeId) => workflow.nodes[nodeId] ?? null,
    getNodeNameById: () => 'AI Storyboard',
    getCurrentWorkflow: () => workflow,
    generateStoryboardShotVideo: async (_nodeId, shotId) => {
      const shots = ((workflow.nodes['100'] as AINodeData).config.shots as StoryboardShotData[]).map((shot) => (
        shot.id === shotId
          ? { ...shot, videoGenStatus: shotId === 'shot-a' ? 'completed' : 'idle' }
          : shot
      ));
      (workflow.nodes['100'] as AINodeData).config.shots = shots;
    },
    getCommittedStoryboardGroupState: (_nodeId, shotId) => (
      shotId === 'shot-a'
        ? {
          workflowId: workflow.id,
          nodeId: '100',
          nodeType: 'aiStoryboard',
          groupId: shotId,
          groupOrder: 1,
          taskRecordId: null,
          aiTaskId: null,
          status: 'completed',
          progress: 100,
          message: 'done',
          resultFileId: 'video-shot-a',
          isOutputCommitted: true,
        }
        : null
    ),
    notification: notifications.notification,
  });

  assert.equal(notifications.calls[notifications.calls.length - 1]?.kind, 'warning');
  assert.equal(notifications.calls[notifications.calls.length - 1]?.message.includes('已取消 1 个'), true);
});
