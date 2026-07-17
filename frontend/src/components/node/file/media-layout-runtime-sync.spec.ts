import test from 'node:test';
import assert from 'node:assert/strict';

import { createMediaLayoutRuntimeSyncController } from './media-layout-runtime-sync';

test('media layout runtime sync controller batches repeated schedules into one frame commit', () => {
  const frameCallbacks = new Map<number, FrameRequestCallback>();
  const committedReasons: Array<string | undefined> = [];
  let nextFrameId = 1;

  const controller = createMediaLayoutRuntimeSyncController({
    requestAnimationFrameImpl: (callback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      frameCallbacks.set(frameId, callback);
      return frameId;
    },
    cancelAnimationFrameImpl: (frameId) => {
      frameCallbacks.delete(frameId);
    },
    onCommit: ({ reason }) => {
      committedReasons.push(reason);
    },
  });

  controller.schedule({ reason: 'image-ready' });
  controller.schedule({ reason: 'video-ready' });

  assert.equal(controller.isScheduled(), true);
  assert.equal(frameCallbacks.size, 1);

  const callback = frameCallbacks.values().next().value;
  if (!callback) {
    throw new Error('Expected scheduled frame callback');
  }

  callback(16);

  assert.equal(controller.isScheduled(), false);
  assert.deepEqual(committedReasons, ['video-ready']);
});

test('media layout runtime sync controller flushes immediately and clears pending frame state', () => {
  const frameCallbacks = new Map<number, FrameRequestCallback>();
  const committed: Array<{ reason?: string; force?: boolean }> = [];
  let nextFrameId = 1;

  const controller = createMediaLayoutRuntimeSyncController({
    requestAnimationFrameImpl: (callback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      frameCallbacks.set(frameId, callback);
      return frameId;
    },
    cancelAnimationFrameImpl: (frameId) => {
      frameCallbacks.delete(frameId);
    },
    onCommit: ({ reason, force }) => {
      committed.push({ reason, force });
    },
  });

  controller.schedule({ reason: 'image-ready' });
  controller.flush({ reason: 'before-save', force: true });

  assert.equal(controller.isScheduled(), false);
  assert.equal(frameCallbacks.size, 0);
  assert.deepEqual(committed, [
    {
      reason: 'before-save',
      force: true,
    },
  ]);
});
