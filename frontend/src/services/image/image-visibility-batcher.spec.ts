import test from 'node:test';
import assert from 'node:assert/strict';

import { createImageVisibilityBatcher } from './image-visibility-batcher';
import type { ImageVisibilityReconcileEntry } from './image-resource.types';

function createEntry(
  stateKey: string,
  overrides: Partial<ImageVisibilityReconcileEntry> = {}
): ImageVisibilityReconcileEntry {
  return {
    nodeId: stateKey.split(':')[0] ?? 'node',
    mode: 'canvas',
    stateKey,
    previous: {
      isVisible: false,
      isNearViewport: false,
      displayWidth: 100,
      displayHeight: 60,
    },
    next: {
      isVisible: true,
      isNearViewport: true,
      displayWidth: 200,
      displayHeight: 120,
    },
    ...overrides,
  };
}

test('image visibility batcher coalesces repeated updates by state key and preserves earliest previous visibility', () => {
  const scheduledCallbacks: Array<() => void> = [];
  const flushedBatches: ImageVisibilityReconcileEntry[][] = [];
  const batcher = createImageVisibilityBatcher({
    onFlush: (entries) => {
      flushedBatches.push(entries);
    },
    scheduleMicrotaskImpl: (callback) => {
      scheduledCallbacks.push(callback);
    },
  });

  batcher.schedule(createEntry('node-a:canvas', {
    previous: {
      isVisible: false,
      isNearViewport: false,
      displayWidth: 100,
      displayHeight: 60,
    },
    next: {
      isVisible: false,
      isNearViewport: true,
      displayWidth: 120,
      displayHeight: 72,
    },
  }));
  batcher.schedule(createEntry('node-a:canvas', {
    previous: {
      isVisible: false,
      isNearViewport: true,
      displayWidth: 120,
      displayHeight: 72,
    },
    next: {
      isVisible: true,
      isNearViewport: true,
      displayWidth: 220,
      displayHeight: 132,
    },
  }));
  batcher.schedule(createEntry('node-b:canvas'));

  assert.equal(batcher.isScheduled(), true);
  assert.equal(scheduledCallbacks.length, 1);

  scheduledCallbacks[0]?.();

  assert.equal(flushedBatches.length, 1);
  assert.equal(flushedBatches[0]?.length, 2);
  assert.deepEqual(flushedBatches[0]?.[0]?.previous, {
    isVisible: false,
    isNearViewport: false,
    displayWidth: 100,
    displayHeight: 60,
  });
  assert.deepEqual(flushedBatches[0]?.[0]?.next, {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 220,
    displayHeight: 132,
  });
  assert.equal(batcher.isScheduled(), false);
});

test('image visibility batcher flush commits immediately and clears pending work', () => {
  const flushedBatches: ImageVisibilityReconcileEntry[][] = [];
  const batcher = createImageVisibilityBatcher({
    onFlush: (entries) => {
      flushedBatches.push(entries);
    },
    scheduleMicrotaskImpl: () => undefined,
  });

  batcher.schedule(createEntry('node-a:canvas'));

  assert.equal(batcher.flush(), true);
  assert.equal(flushedBatches.length, 1);
  assert.equal(flushedBatches[0]?.length, 1);
  assert.equal(batcher.flush(), false);
  assert.equal(batcher.isScheduled(), false);
});

test('image visibility batcher cancel drops pending entries', () => {
  const flushedBatches: ImageVisibilityReconcileEntry[][] = [];
  const batcher = createImageVisibilityBatcher({
    onFlush: (entries) => {
      flushedBatches.push(entries);
    },
    scheduleMicrotaskImpl: () => undefined,
  });

  batcher.schedule(createEntry('node-a:canvas'));
  batcher.cancel();

  assert.equal(batcher.flush(), false);
  assert.equal(flushedBatches.length, 0);
});

test('image visibility batcher can defer work to an animation frame scheduler', () => {
  const scheduledFrames: Array<() => void> = [];
  const flushedBatches: ImageVisibilityReconcileEntry[][] = [];
  const batcher = createImageVisibilityBatcher({
    onFlush: (entries) => {
      flushedBatches.push(entries);
    },
    scheduleFrameImpl: (callback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    },
  });

  batcher.schedule(createEntry('node-a:canvas'));

  assert.equal(flushedBatches.length, 0);
  assert.equal(scheduledFrames.length, 1);

  scheduledFrames[0]?.();

  assert.equal(flushedBatches.length, 1);
  assert.equal(flushedBatches[0]?.length, 1);
});
