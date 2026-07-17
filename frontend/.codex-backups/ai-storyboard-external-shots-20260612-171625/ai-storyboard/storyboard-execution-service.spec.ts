import test from 'node:test';
import assert from 'node:assert/strict';

import type { ExecutionRuntimeGroupState } from '@/execution-runtime/execution-runtime.types';
import type { AINodeData, StoryboardShotData, Workflow } from '@/types';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import { getAIStoryboardOutputHandle } from './groups';
import {
  createStoryboardNodePatchResult,
  createStoryboardShotExecutionPayload,
  createStoryboardShotPatchResult,
  getCommittedStoryboardGroupState,
  getStoryboardExecutionDebtMap,
  mergeStoryboardNodeTaskRefs,
  resolveStoryboardExecutionReferenceFileIds,
} from './storyboard-execution-service';

function createStoryboardShot(overrides: Partial<StoryboardShotData> = {}): StoryboardShotData {
  return {
    id: 'shot-1',
    order: 1,
    row: 0,
    col: 0,
    originalIndex: 1,
    originalTotal: 1,
    prompt: 'camera prompt',
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

function createWorkflowWithStoryboardNode(): {
  workflow: Workflow;
  nodeId: string;
} {
  const baseNode = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiStoryboard',
  );
  const node = {
    ...baseNode,
    config: {
      ...baseNode.config,
      processedInputFileIds: ['source-a'],
      shots: [createStoryboardShot()],
    },
  };
  const now = Date.now();

  return {
    nodeId: node.id.value,
    workflow: {
      id: 'workflow-1',
      projectId: 'project-1',
      name: 'Storyboard workflow',
      nodes: {
        [node.id.value]: node,
      },
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        nodeCount: 1,
        connectionCount: 0,
        lastNodeId: 100,
        canvasSize: { width: 4000, height: 3000 },
      },
      timestamp: {
        created: now,
        updated: now,
      },
    },
  };
}

test('storyboard node patch result preserves processed input ids', () => {
  const { workflow, nodeId } = createWorkflowWithStoryboardNode();
  const result = createStoryboardNodePatchResult(workflow, nodeId, ({ shots }) => ({
    shots: shots.map((shot) => ({ ...shot, prompt: 'updated prompt' })),
  }));

  assert.ok(result);
  if (!result) {
    return;
  }
  assert.deepEqual(result.nextNode.config.processedInputFileIds, ['source-a']);
});

test('storyboard shot patch result updates only existing shots', () => {
  const { workflow, nodeId } = createWorkflowWithStoryboardNode();
  const success = createStoryboardShotPatchResult(workflow, nodeId, 'shot-1', (shots) => shots.map((shot) => ({
    ...shot,
    imageGenStatus: 'generating',
  })));
  const missing = createStoryboardShotPatchResult(workflow, nodeId, 'missing-shot', (shots) => shots);

  assert.ok(success);
  if (!success) {
    return;
  }
  assert.equal((success.nextNode.config.shots as StoryboardShotData[])[0]?.imageGenStatus, 'generating');
  assert.equal(missing, null);
});

test('storyboard execution payload keeps shot group id and shared output handle', () => {
  const { workflow, nodeId } = createWorkflowWithStoryboardNode();
  const node = workflow.nodes[nodeId] as AINodeData;
  const shot = (node.config.shots as StoryboardShotData[])[0];
  const payload = createStoryboardShotExecutionPayload(node, 'Storyboard Node', shot, 'video');

  assert.equal(payload.targets[0]?.groupId, 'shot-1');
  assert.equal(payload.targets[0]?.outputHandle, getAIStoryboardOutputHandle('group-1'));
  assert.equal(payload.taskType, 'video-gen');
});

test('storyboard task ref merge deduplicates by storyboard group/output identity', () => {
  const outputHandle = getAIStoryboardOutputHandle('group-1');
  const merged = mergeStoryboardNodeTaskRefs([
    {
      taskId: 'task-1',
      runId: 'run-1',
      taskType: 'image-gen',
      scope: 'group',
      createdAt: 1,
      status: 'processing',
      groupId: 'shot-1',
      outputHandle,
    },
  ], {
    taskId: 'task-2',
    runId: 'run-2',
    taskType: 'image-gen',
    scope: 'group',
    createdAt: 2,
    status: 'processing',
    groupId: 'shot-1',
    outputHandle,
  });

  assert.deepEqual(merged.map((item) => item.taskId), ['task-2']);
});

test('storyboard task ref merge keeps image and video refs for the same shot output slot separated by task type', () => {
  const outputHandle = getAIStoryboardOutputHandle('group-1');
  const merged = mergeStoryboardNodeTaskRefs([
    {
      taskId: 'task-image-1',
      runId: 'run-image-1',
      taskType: 'image-gen',
      scope: 'group',
      createdAt: 1,
      status: 'completed',
      groupId: 'shot-1',
      outputHandle,
    },
  ], {
    taskId: 'task-video-1',
    runId: 'run-video-1',
    taskType: 'video-gen',
    scope: 'group',
    createdAt: 2,
    status: 'processing',
    groupId: 'shot-1',
    outputHandle,
  });

  assert.deepEqual(
    merged.map((item) => `${item.taskType}:${item.taskId}`).sort(),
    ['image-gen:task-image-1', 'video-gen:task-video-1'],
  );
});

test('committed storyboard group lookup filters by file type and task identity', () => {
  const groupState: ExecutionRuntimeGroupState = {
    workflowId: 'workflow-1',
    nodeId: 'node-1',
    nodeType: 'aiStoryboard',
    groupId: 'shot-1',
    groupOrder: 1,
    taskRecordId: null,
    aiTaskId: 'task-1',
    runId: 'run-1',
    status: 'completed',
    progress: 100,
    message: 'done',
    resultFileId: 'file-1',
    resultFile: {
      id: 'file-1',
      name: 'result.mp4',
      originalName: 'result.mp4',
      size: 100,
      mimeType: 'video/mp4',
      format: 'mp4',
      fileType: 'video',
      status: 'ready',
      hash: 'hash',
      path: '/result.mp4',
      metadata: {},
      source: { type: 'node-output' },
      timestamp: { created: Date.now(), updated: Date.now() },
    },
    isOutputCommitted: true,
  };

  const resolved = getCommittedStoryboardGroupState({
    nodeId: 'node-1',
    shotId: 'shot-1',
    workflowId: 'workflow-1',
    runId: 'run-1',
    taskId: 'task-1',
    fileType: 'video',
    getGroupState: () => groupState,
  });
  const filtered = getCommittedStoryboardGroupState({
    nodeId: 'node-1',
    shotId: 'shot-1',
    workflowId: 'workflow-1',
    taskId: 'other-task',
    getGroupState: () => groupState,
  });

  assert.equal(resolved, groupState);
  assert.equal(filtered, null);
});

test('storyboard reference resolution only accepts confirmed fallback ids', async () => {
  const direct = await resolveStoryboardExecutionReferenceFileIds({
    shot: createStoryboardShot({
      imageFileId: 'backend-image',
      sourceImageFileId: 'local-file',
      sourceFileId: 'local-file',
    }),
    sourceNode: null,
    maxReferences: 5,
    ensureBackendFileId: async () => null,
  });
  const fallback = await resolveStoryboardExecutionReferenceFileIds({
    shot: createStoryboardShot({
      sourceImageFileId: 'backend-fallback',
      sourceFileId: 'local-file',
    }),
    sourceNode: null,
    maxReferences: 5,
    ensureBackendFileId: async () => null,
  });

  assert.deepEqual(direct.referenceFileIds, ['backend-image']);
  assert.deepEqual(fallback.referenceFileIds, ['backend-fallback']);
});

test('storyboard debt map keeps uncontracted paths explicit', () => {
  const debtMap = getStoryboardExecutionDebtMap();

  assert.equal(debtMap.some((item) => item.includes('node-action-only execution contract')), true);
  assert.equal(debtMap.some((item) => item.includes('node action service registry')), true);
  assert.equal(debtMap.some((item) => item.includes('storyboard application facade')), true);
  assert.equal(debtMap.some((item) => item.includes('runNodeAction')), true);
});
