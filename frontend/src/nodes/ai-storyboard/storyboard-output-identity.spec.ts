import test from 'node:test';
import assert from 'node:assert/strict';

import { getAIStoryboardShotOutputHandle } from './groups';
import {
  createStoryboardExecutionTargetIdentity,
  findMatchingStoryboardTaskRef,
  getStoryboardTaskTypeFromFileInfo,
  matchesStoryboardOutputIdentity,
  normalizeStoryboardOutputRoutingIdentity,
  normalizeStoryboardTaskRefIdentity,
} from './storyboard-output-identity';

test('normalizeStoryboardOutputRoutingIdentity backfills the per-shot output handle', () => {
  const identity = normalizeStoryboardOutputRoutingIdentity({
    groupId: 'shot-1',
  });

  assert.deepEqual(identity, {
    kind: 'storyboard-shot-output',
    groupId: 'shot-1',
    outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
  });
});

test('createStoryboardExecutionTargetIdentity keeps shot group id and media-derived task type', () => {
  const identity = createStoryboardExecutionTargetIdentity({
    groupId: 'shot-1',
    taskType: 'image',
  });

  assert.deepEqual(identity, {
    kind: 'storyboard-shot-output',
    groupId: 'shot-1',
    outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
    taskType: 'image-gen',
  });
});

test('normalizeStoryboardTaskRefIdentity repairs legacy storyboard task refs missing task type and output handle', () => {
  const taskRef = normalizeStoryboardTaskRefIdentity<{
    taskId: string;
    runId: string;
    groupId: string;
    outputHandle?: string;
    taskType?: string;
  }>({
    taskId: 'task-1',
    runId: 'run-1',
    groupId: 'shot-1',
  }, {
    fallbackTaskType: 'video',
  });

  assert.equal(taskRef.groupId, 'shot-1');
  assert.equal(taskRef.outputHandle, getAIStoryboardShotOutputHandle('shot-1'));
  assert.equal(taskRef.taskType, 'video-gen');
});

test('matchesStoryboardOutputIdentity keeps image and video identities separated for the same shot slot', () => {
  assert.equal(matchesStoryboardOutputIdentity(
    {
      groupId: 'shot-1',
      outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
      taskType: 'image-gen',
    },
    {
      groupId: 'shot-1',
      outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
      taskType: 'video-gen',
    },
  ), false);
});

test('findMatchingStoryboardTaskRef prefers exact task id and falls back to run + identity match', () => {
  const taskRefs = [
    {
      taskId: 'task-image-1',
      runId: 'run-1',
      runNo: 'RUN-1',
      groupId: 'shot-1',
      outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
      taskType: 'image-gen',
    },
    {
      taskId: 'task-video-1',
      runId: 'run-1',
      runNo: 'RUN-1',
      groupId: 'shot-1',
      outputHandle: getAIStoryboardShotOutputHandle('shot-1'),
      taskType: 'video-gen',
    },
  ];

  assert.equal(findMatchingStoryboardTaskRef(taskRefs, {
    runId: 'run-1',
    runNo: 'RUN-1',
  }, {
    taskId: 'missing-task',
    groupId: 'shot-1',
    taskType: 'video-gen',
  })?.taskId, 'task-video-1');
});

test('getStoryboardTaskTypeFromFileInfo infers image and video outputs', () => {
  assert.equal(getStoryboardTaskTypeFromFileInfo({
    id: 'image-1',
    name: 'image-1.png',
    originalName: 'image-1.png',
    size: 1,
    mimeType: 'image/png',
    format: 'png',
    fileType: 'image',
    status: 'ready',
    hash: 'hash-image-1',
    path: '/files/image-1',
    metadata: {},
    source: { type: 'node-output' },
    timestamp: { created: 1, updated: 1 },
  }), 'image-gen');
  assert.equal(getStoryboardTaskTypeFromFileInfo({
    id: 'video-1',
    name: 'video-1.mp4',
    originalName: 'video-1.mp4',
    size: 1,
    mimeType: 'video/mp4',
    format: 'mp4',
    fileType: 'video',
    status: 'ready',
    hash: 'hash-video-1',
    path: '/files/video-1',
    metadata: {},
    source: { type: 'node-output' },
    timestamp: { created: 1, updated: 1 },
  }), 'video-gen');
});
