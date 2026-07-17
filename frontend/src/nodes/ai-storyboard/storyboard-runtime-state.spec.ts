import test from 'node:test';
import assert from 'node:assert/strict';

import type { StoryboardShotData } from '@/types';
import {
  applyStoryboardShotRuntimeState,
  createDefaultStoryboardShotRuntimeState,
  resolveStoryboardShotRuntimeState,
  stripStoryboardShotRuntimeState,
  stripStoryboardShotRuntimeStateFromShots,
} from './storyboard-runtime-state';

function createShot(overrides: Partial<StoryboardShotData> = {}): StoryboardShotData {
  return {
    id: 'shot-1',
    order: 1,
    row: 0,
    col: 0,
    originalIndex: 1,
    originalTotal: 1,
    sourceNodeId: 'node-1',
    sourceFileId: 'source-file-1',
    sourceImageFileId: 'source-image-1',
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

test('createDefaultStoryboardShotRuntimeState returns idle execution state', () => {
  assert.deepEqual(createDefaultStoryboardShotRuntimeState(), {
    imageGenStatus: 'idle',
    imageGenMessage: undefined,
    imageGenRunId: undefined,
    videoGenStatus: 'idle',
    videoProgress: undefined,
    videoError: undefined,
    videoRunId: undefined,
  });
});

test('resolveStoryboardShotRuntimeState restores legacy runtime fields when present', () => {
  const runtimeState = resolveStoryboardShotRuntimeState(createShot({
    imageGenStatus: 'failed',
    imageGenMessage: 'image failed',
    imageGenRunId: 'run-image-1',
    videoGenStatus: 'generating',
    videoProgress: 24,
    videoError: 'recovering',
    videoRunId: 'run-video-1',
  }));

  assert.deepEqual(runtimeState, {
    imageGenStatus: 'failed',
    imageGenMessage: 'image failed',
    imageGenRunId: 'run-image-1',
    videoGenStatus: 'generating',
    videoProgress: 24,
    videoError: 'recovering',
    videoRunId: 'run-video-1',
  });
});

test('resolveStoryboardShotRuntimeState infers completed status from persisted result ids', () => {
  const runtimeState = resolveStoryboardShotRuntimeState({
    id: 'shot-1',
    order: 1,
    row: 0,
    col: 0,
    prompt: 'camera move',
    imageModel: 'gemini-3-pro-image-preview',
    imageAspectRatio: 'auto',
    imageSize: '1K',
    videoModel: 'veo-3.1-landscape-fast-fl',
    videoDuration: 8,
    imageFileId: 'image-result-1',
    videoFileId: 'video-result-1',
  });

  assert.equal(runtimeState.imageGenStatus, 'completed');
  assert.equal(runtimeState.videoGenStatus, 'completed');
  assert.equal(runtimeState.videoProgress, 100);
});

test('applyStoryboardShotRuntimeState merges resolved runtime fields without dropping persisted fields', () => {
  const shot = stripStoryboardShotRuntimeState(createShot({
    imageFileId: 'image-result-1',
  }));

  const merged = applyStoryboardShotRuntimeState(shot);

  assert.equal(merged.imageFileId, 'image-result-1');
  assert.equal(merged.imageGenStatus, 'completed');
  assert.equal(merged.videoGenStatus, 'idle');
});

test('stripStoryboardShotRuntimeState removes execution-only fields before persistence', () => {
  const persisted = stripStoryboardShotRuntimeState(createShot({
    imageGenStatus: 'generating',
    imageGenMessage: 'creating image',
    imageGenRunId: 'run-image-1',
    videoGenStatus: 'failed',
    videoProgress: 67,
    videoError: 'failed',
    videoRunId: 'run-video-1',
  })) as unknown as Record<string, unknown>;

  assert.equal('imageGenStatus' in persisted, false);
  assert.equal('imageGenMessage' in persisted, false);
  assert.equal('imageGenRunId' in persisted, false);
  assert.equal('videoGenStatus' in persisted, false);
  assert.equal('videoProgress' in persisted, false);
  assert.equal('videoError' in persisted, false);
  assert.equal('videoRunId' in persisted, false);
  assert.equal(persisted.prompt, 'camera move');
});

test('stripStoryboardShotRuntimeStateFromShots preserves shot ordering', () => {
  const persistedShots = stripStoryboardShotRuntimeStateFromShots([
    createShot({ id: 'shot-a', order: 1 }),
    createShot({ id: 'shot-b', order: 2, videoGenStatus: 'generating' }),
  ]);

  assert.deepEqual(
    persistedShots.map((shot) => ({ id: shot.id, order: shot.order })),
    [
      { id: 'shot-a', order: 1 },
      { id: 'shot-b', order: 2 },
    ],
  );
});
