import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageCache } from '../dist-tests/src/services/image/image-cache.js';

test('ImageCache evicts stale invisible original entries before visible entries', () => {
  let now = 30_000;
  const cache = new ImageCache({
    maxResourceEntries: 10,
    maxOriginalEntries: 10,
    invisibleReleaseAfterMs: 5_000,
  }, () => now);

  cache.upsert({
    key: 'node-1:original',
    nodeId: 'node-1',
    kind: 'resource-state',
    mode: 'original',
    url: 'blob:original-1',
    status: 'ready',
    lastAccessAt: 0,
    isVisible: false,
    isNearViewport: false,
  });

  cache.upsert({
    key: 'node-2:canvas',
    nodeId: 'node-2',
    kind: 'resource-state',
    mode: 'canvas',
    url: 'blob:canvas-2',
    status: 'ready',
    lastAccessAt: now - 100,
    isVisible: true,
    isNearViewport: true,
  });

  const evictions = cache.collectEvictions();
  assert.equal(evictions.length, 1);
  assert.deepEqual(evictions[0], {
    key: 'node-1:original',
    nodeId: 'node-1',
    kind: 'resource-state',
    mode: 'original',
    reason: 'stale-original',
  });
});

test('ImageCache enforces original entry cap with LRU order', () => {
  const cache = new ImageCache({
    maxResourceEntries: 10,
    maxOriginalEntries: 1,
    invisibleReleaseAfterMs: 60_000,
  }, () => 10_000);

  cache.upsert({
    key: 'node-a:original',
    nodeId: 'node-a',
    kind: 'resource-state',
    mode: 'original',
    url: 'blob:original-a',
    status: 'ready',
    lastAccessAt: 1_000,
    isVisible: false,
    isNearViewport: false,
  });

  cache.upsert({
    key: 'node-b:original',
    nodeId: 'node-b',
    kind: 'resource-state',
    mode: 'original',
    url: 'blob:original-b',
    status: 'ready',
    lastAccessAt: 9_000,
    isVisible: true,
    isNearViewport: true,
  });

  const evictions = cache.collectEvictions();
  assert.equal(evictions.length, 1);
  assert.equal(evictions[0]?.key, 'node-a:original');
  assert.equal(evictions[0]?.reason, 'over-limit');
});

test('ImageCache evicts oversized original resources by byte budget', () => {
  const cache = new ImageCache({
    maxResourceEntries: 10,
    maxOriginalEntries: 10,
    maxOriginalBytes: 100,
    maxCanvasBytes: 1_000,
    invisibleReleaseAfterMs: 60_000,
  }, () => 10_000);

  cache.upsert({
    key: 'node-a:original',
    nodeId: 'node-a',
    kind: 'resource-state',
    mode: 'original',
    url: 'blob:original-a',
    status: 'ready',
    lastAccessAt: 1_000,
    isVisible: false,
    isNearViewport: false,
    byteSize: 70,
  });

  cache.upsert({
    key: 'node-b:original',
    nodeId: 'node-b',
    kind: 'resource-state',
    mode: 'original',
    url: 'blob:original-b',
    status: 'ready',
    lastAccessAt: 2_000,
    isVisible: false,
    isNearViewport: false,
    byteSize: 70,
  });

  const evictions = cache.collectEvictions();
  assert.equal(evictions.length, 1);
  assert.equal(evictions[0]?.key, 'node-a:original');
  assert.equal(evictions[0]?.reason, 'over-limit');
});

test('ImageCache keeps recently accessed offscreen thumbnails protected inside near-viewport release window', () => {
  let now = 20_000;
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
