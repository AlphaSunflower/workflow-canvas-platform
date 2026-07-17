import test from 'node:test';
import assert from 'node:assert/strict';

import { ImageCache } from './image-cache';

test('ImageCache records thumbnail and original entries in separate pools', () => {
  const cache = new ImageCache({}, () => 1_000);

  cache.upsert({
    key: 'node-1:canvas',
    nodeId: 'node-1',
    kind: 'resource-state',
    mode: 'canvas',
    status: 'ready',
    url: 'blob:thumb-1',
    tier: 'thumbnail',
    pool: 'canvas',
    isVisible: true,
    isNearViewport: true,
    byteSize: 32,
  });
  cache.upsert({
    key: 'node-1:original',
    nodeId: 'node-1',
    kind: 'resource-state',
    mode: 'original',
    status: 'ready',
    url: 'blob:original-1',
    tier: 'original',
    pool: 'original',
    isVisible: false,
    isNearViewport: false,
    byteSize: 256,
  });

  const stats = cache.getStats();

  assert.equal(stats.thumbnailEntryCount, 1);
  assert.equal(stats.thumbnailBytes, 32);
  assert.equal(stats.originalEntryCount, 1);
  assert.equal(stats.originalBytes, 256);
  assert.equal(stats.canvasResourceEntryCount, 1);
});

test('ImageCache protects visible canvas thumbnails from original cache pressure', () => {
  let now = 10_000;
  const cache = new ImageCache({
    maxOriginalEntries: 1,
    maxThumbnailEntries: 1,
    maxCanvasBytes: 512,
    maxOriginalBytes: 128,
    maxThumbnailBytes: 128,
    invisibleReleaseAfterMs: 100,
  }, () => now);

  cache.upsert({
    key: 'visible:canvas',
    nodeId: 'visible',
    kind: 'resource-state',
    mode: 'canvas',
    status: 'ready',
    url: 'blob:thumb-visible',
    tier: 'thumbnail',
    isVisible: true,
    isNearViewport: true,
    loadedAt: now,
    byteSize: 512,
  });
  cache.upsert({
    key: 'original-a',
    nodeId: 'original-a',
    kind: 'resource-state',
    mode: 'original',
    status: 'ready',
    url: 'blob:original-a',
    tier: 'original',
    isVisible: false,
    isNearViewport: false,
    loadedAt: now,
    byteSize: 256,
  });
  cache.upsert({
    key: 'original-b',
    nodeId: 'original-b',
    kind: 'resource-state',
    mode: 'original',
    status: 'ready',
    url: 'blob:original-b',
    tier: 'original',
    isVisible: false,
    isNearViewport: false,
    loadedAt: now,
    byteSize: 256,
  });

  now += 200;
  const evictions = cache.collectEvictions('full');

  assert.equal(evictions.some((entry) => entry.key === 'visible:canvas'), false);
  assert.equal(evictions.some((entry) => entry.mode === 'original'), true);
});

test('ImageCache budget snapshot exposes thumbnail and original limits only', () => {
  const cache = new ImageCache({
    maxThumbnailEntries: 24,
    maxOriginalEntries: 8,
    maxThumbnailBytes: 1024,
    maxOriginalBytes: 512,
  });

  const budget = cache.getBudgetSnapshot();

  assert.equal(budget.maxThumbnailEntries, 24);
  assert.equal(budget.maxOriginalEntries, 8);
  assert.equal(budget.maxThumbnailBytes, 1024);
  assert.equal(budget.maxOriginalBytes, 512);
});

test('ImageCache keeps recently accessed offscreen thumbnails protected inside near-viewport release window', () => {
  const now = 20_000;
  const cache = new ImageCache({
    maxResourceEntries: 1,
    maxThumbnailEntries: 1,
    maxCanvasBytes: 100,
    maxThumbnailBytes: 100,
    invisibleReleaseAfterMs: 2_000,
    nearViewportReleaseAfterMs: 8_000,
    recentlyLoadedCanvasProtectionMs: 12_000,
  }, () => now);

  cache.upsert({
    key: 'node-a:canvas',
    nodeId: 'node-a',
    kind: 'resource-state',
    mode: 'canvas',
    status: 'ready',
    url: 'blob:thumb-a',
    tier: 'thumbnail',
    isVisible: false,
    isNearViewport: false,
    loadedAt: now - 12_000,
    lastAccessAt: now - 500,
    byteSize: 60,
  });
  cache.upsert({
    key: 'node-b:canvas',
    nodeId: 'node-b',
    kind: 'resource-state',
    mode: 'canvas',
    status: 'ready',
    url: 'blob:thumb-b',
    tier: 'thumbnail',
    isVisible: false,
    isNearViewport: false,
    loadedAt: now - 20_000,
    lastAccessAt: now - 10_000,
    byteSize: 60,
  });

  const evictions = cache.collectEvictions('full');

  assert.equal(evictions.some((entry) => entry.key === 'node-a:canvas'), false);
  assert.equal(evictions.some((entry) => entry.key === 'node-b:canvas'), true);
});
