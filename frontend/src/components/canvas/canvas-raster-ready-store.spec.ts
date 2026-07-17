import test from 'node:test';
import assert from 'node:assert/strict';

import type { CanvasImageRasterItem } from './canvas-image-raster-draw';
import { createCanvasRasterReadyStore } from './canvas-raster-ready-store';

function createItem(id: string, overrides: Partial<CanvasImageRasterItem> = {}): CanvasImageRasterItem {
  return {
    nodeId: id,
    fileName: `${id}.png`,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    status: 'ready',
    src: `blob:${id}`,
    resourceSrc: `blob:${id}`,
    ...overrides,
  };
}

test('CanvasRasterReadyStore stores only ready raster items and bumps version on batch replace', () => {
  const store = createCanvasRasterReadyStore();
  let emitCount = 0;
  store.subscribe(() => {
    emitCount += 1;
  });

  const snapshot = store.replace([
    createItem('ready'),
    createItem('loading', { status: 'loading', src: undefined }),
  ]);

  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.items.map((item) => item.nodeId), ['ready']);
  assert.equal(emitCount, 1);
});

test('CanvasRasterReadyStore ignores cluster items', () => {
  const store = createCanvasRasterReadyStore();
  const snapshot = store.replace([
    createItem('cluster-1', {
      kind: 'cluster',
      status: 'cluster',
      clusterCount: 12,
    }),
  ]);

  assert.equal(snapshot.version, 0);
  assert.deepEqual(snapshot.items, []);
});

test('CanvasRasterReadyStore does not emit when a batch is unchanged', () => {
  const store = createCanvasRasterReadyStore();
  let emitCount = 0;
  store.subscribe(() => {
    emitCount += 1;
  });

  store.replace([createItem('node-1')]);
  store.replace([createItem('node-1')]);

  assert.equal(store.getSnapshot().version, 1);
  assert.equal(emitCount, 1);
});

test('CanvasRasterReadyStore reports ready items by node id and source', () => {
  const store = createCanvasRasterReadyStore();
  store.replace([
    createItem('node-1', { src: 'blob:node-1-ready' }),
  ]);

  assert.equal(store.hasReadyNode('node-1'), true);
  assert.equal(store.hasReadyNode('node-2'), false);
  assert.equal(store.getReadyNodeSrc('node-1'), 'blob:node-1-ready');
  assert.equal(store.getReadyNodeSrc('node-2'), undefined);
  assert.equal(store.hasReadyItem('node-1', 'blob:node-1-ready'), true);
  assert.equal(store.hasReadyItem('node-1', 'blob:node-1-stale'), false);
  assert.equal(store.hasReadyItem('node-2', 'blob:node-1-ready'), false);
  assert.equal(store.hasReadyItem('node-1'), false);
});

test('CanvasRasterReadyStore retainNodeIds removes stale ready items in one batch', () => {
  const store = createCanvasRasterReadyStore();
  store.replace([
    createItem('node-1'),
    createItem('node-2'),
  ]);

  const snapshot = store.retainNodeIds(['node-2']);

  assert.equal(snapshot.version, 2);
  assert.deepEqual(snapshot.items.map((item) => item.nodeId), ['node-2']);
});

test('CanvasRasterReadyStore retainNodeIds removes deleted nodes even while retention is active', () => {
  let now = 1_000;
  const store = createCanvasRasterReadyStore({
    now: () => now,
    retentionMs: 500,
  });

  store.replace([
    createItem('node-1'),
    createItem('node-2'),
  ]);
  store.upsert([createItem('node-2')], {
    retainPreviousReady: true,
  });

  assert.deepEqual(store.getSnapshot().items.map((item) => item.nodeId), ['node-1', 'node-2']);

  now = 1_100;
  const snapshot = store.retainNodeIds(['node-2']);

  assert.deepEqual(snapshot.items.map((item) => item.nodeId), ['node-2']);
});

test('CanvasRasterReadyStore can retain previous ready items across transient empty batches', () => {
  let now = 1_000;
  const store = createCanvasRasterReadyStore({
    now: () => now,
    retentionMs: 500,
  });

  store.replace([createItem('node-1')]);
  const retained = store.replace([], {
    retainPreviousReady: true,
  });

  assert.deepEqual(retained.items.map((item) => item.nodeId), ['node-1']);

  now = 1_501;
  const expired = store.replace([], {
    retainPreviousReady: true,
  });

  assert.deepEqual(expired.items.map((item) => item.nodeId), []);
});

test('CanvasRasterReadyStore upsert updates ready items while retaining previous ready items temporarily', () => {
  let now = 1_000;
  const store = createCanvasRasterReadyStore({
    now: () => now,
    retentionMs: 500,
  });

  store.replace([
    createItem('node-1'),
    createItem('node-2'),
  ]);
  const updated = store.upsert([
    createItem('node-2', { x: 24, src: 'blob:node-2-updated' }),
  ], {
    retainPreviousReady: true,
  });

  assert.equal(updated.version, 2);
  assert.deepEqual(updated.items.map((item) => item.nodeId), ['node-1', 'node-2']);
  assert.equal(updated.items.find((item) => item.nodeId === 'node-2')?.x, 24);
  assert.equal(updated.items.find((item) => item.nodeId === 'node-2')?.src, 'blob:node-2-updated');

  now = 1_501;
  const expired = store.upsert([], {
    retainPreviousReady: true,
  });

  assert.deepEqual(expired.items.map((item) => item.nodeId), ['node-2']);

  now = 2_002;
  const fullyExpired = store.upsert([], {
    retainPreviousReady: true,
  });

  assert.deepEqual(fullyExpired.items.map((item) => item.nodeId), []);
});

test('CanvasRasterReadyStore upsert does not emit when ready updates are unchanged', () => {
  const store = createCanvasRasterReadyStore();
  let emitCount = 0;
  store.subscribe(() => {
    emitCount += 1;
  });

  store.upsert([createItem('node-1')], {
    retainPreviousReady: true,
  });
  store.upsert([createItem('node-1')], {
    retainPreviousReady: true,
  });

  assert.equal(store.getSnapshot().version, 1);
  assert.equal(emitCount, 1);
});
