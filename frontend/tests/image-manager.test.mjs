import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageManager } from '../dist-tests/src/services/image/image-manager.js';

function createCanvasAsset(seed = 'default') {
  return {
    asset: {
      source: 'local',
      variants: {
        thumbnail: {
          url: `blob:thumb-${seed}`,
          width: 512,
          height: 320,
        },
      },
      version: 1,
    },
    thumbnail: {
      kind: 'thumbnail',
      url: `blob:thumb-${seed}`,
      fromLegacy: false,
      asset: {
        url: `blob:thumb-${seed}`,
        width: 512,
        height: 320,
      },
    },
    preferred: {
      kind: 'thumbnail',
      url: `blob:thumb-${seed}`,
      fromLegacy: false,
      asset: {
        url: `blob:thumb-${seed}`,
        width: 512,
        height: 320,
      },
    },
  };
}

function createAssetWithOriginal(seed = 'default') {
  return {
    ...createCanvasAsset(seed),
    asset: {
      source: 'local',
      variants: {
        thumbnail: {
          url: `blob:thumb-${seed}`,
          width: 512,
          height: 320,
        },
        original: {
          url: `blob:original-${seed}`,
          width: 2400,
          height: 1600,
        },
      },
      version: 1,
    },
    original: {
      kind: 'original',
      url: `blob:original-${seed}`,
      fromLegacy: false,
      asset: {
        url: `blob:original-${seed}`,
        width: 2400,
        height: 1600,
      },
    },
  };
}

function createLoadedResource(src, width, height) {
  return {
    src,
    width,
    height,
    decoded: 'image',
    estimatedBytes: width * height * 4,
  };
}

test('ImageManager canvas requests stay thumbnail-only', async () => {
  const loadAttempts = [];
  const manager = new ImageManager({
    now: () => 1_000,
    loadImageResource: async (url) => {
      loadAttempts.push(url);
      return createLoadedResource(url, 512, 320);
    },
  });
  const resolvedAsset = createAssetWithOriginal('thumbnail-only');

  manager.register({
    nodeId: 'node-thumbnail-only',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.original.url,
  });
  manager.updateVisibility('node-thumbnail-only', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 1600,
    displayHeight: 1000,
    visibilityScore: 0.95,
  });
  await manager.request('node-thumbnail-only', 'canvas');

  const state = manager.getState('node-thumbnail-only', 'canvas');
  const snapshot = manager.getDebugSnapshot();

  assert.deepEqual(loadAttempts, [resolvedAsset.thumbnail.url]);
  assert.equal(state.src, resolvedAsset.thumbnail.url);
  assert.equal(state.phase, 'thumbnail-ready');
  assert.equal(state.activeVariantKind, 'thumbnail');
  assert.equal(state.resourceRole, 'canvas-thumbnail');
  assert.equal(snapshot.cache.stats.thumbnailEntryCount, 1);
  assert.equal(snapshot.cache.stats.originalEntryCount, 0);
});

test('ImageManager canvas does not fall back to original when thumbnail load fails', async () => {
  const loadAttempts = [];
  const manager = new ImageManager({
    now: () => 1_500,
    loadImageResource: async (url) => {
      loadAttempts.push(url);
      throw new Error(`load failed for ${url}`);
    },
  });
  const resolvedAsset = createAssetWithOriginal('failure');

  manager.register({
    nodeId: 'node-thumbnail-failure',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.original.url,
  });
  manager.updateVisibility('node-thumbnail-failure', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 1280,
    displayHeight: 800,
  });
  await manager.request('node-thumbnail-failure', 'canvas');

  const state = manager.getState('node-thumbnail-failure', 'canvas');

  assert.deepEqual(loadAttempts, [resolvedAsset.thumbnail.url]);
  assert.equal(state.status, 'error');
  assert.equal(state.phase, 'error');
  assert.equal(state.src, resolvedAsset.thumbnail.url);
  assert.equal(state.lastAttemptedUrl, resolvedAsset.thumbnail.url);
});

test('ImageManager exposes canvas thumbnail and viewer original as separate lifecycle states', async () => {
  const manager = new ImageManager({
    now: () => 5_000,
    loadImageResource: async (url) => createLoadedResource(
      url,
      url.includes('original') ? 2400 : 512,
      url.includes('original') ? 1600 : 320,
    ),
  });
  const resolvedAsset = createAssetWithOriginal('phase');

  manager.register({
    nodeId: 'node-phase',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.thumbnail.url,
  });
  manager.updateVisibility('node-phase', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 1200,
    displayHeight: 750,
  });
  await manager.request('node-phase', 'canvas');

  manager.register({
    nodeId: 'node-phase',
    mode: 'original',
    resolvedAsset,
    preferredUrl: resolvedAsset.original.url,
  });
  await manager.request('node-phase', 'original');

  const canvasState = manager.getState('node-phase', 'canvas');
  const originalState = manager.getState('node-phase', 'original');
  const cache = manager.getDebugSnapshot().cache;

  assert.equal(canvasState.phase, 'thumbnail-ready');
  assert.equal(canvasState.src, resolvedAsset.thumbnail.url);
  assert.equal(originalState.phase, 'original-ready');
  assert.equal(originalState.src, resolvedAsset.original.url);
  assert.equal(cache.stats.thumbnailEntryCount, 1);
  assert.equal(cache.stats.originalEntryCount, 1);
});

test('ImageManager original viewer load does not evict visible canvas thumbnail under pressure', async () => {
  const manager = new ImageManager({
    now: () => 24_000,
    loadImageResource: async (url) => createLoadedResource(
      url,
      url.includes('original') ? 2600 : 512,
      url.includes('original') ? 1800 : 320,
    ),
  });
  const resolvedAsset = createAssetWithOriginal('cache-isolated');

  manager.register({
    nodeId: 'node-cache-isolated',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.thumbnail.url,
  });
  manager.updateVisibility('node-cache-isolated', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 1200,
    displayHeight: 760,
    centerDistance: 0,
  });
  await manager.request('node-cache-isolated', 'canvas');

  manager.updateCacheBudgetContext({
    imageNodeCount: 120,
    isImporting: false,
    isDragging: false,
    device: {
      deviceMemoryGb: 4,
      hardwareConcurrency: 4,
      jsHeapSizeLimit: 256 * 1024 * 1024,
    },
  });

  manager.register({
    nodeId: 'node-cache-isolated',
    mode: 'original',
    resolvedAsset,
    preferredUrl: resolvedAsset.original.url,
  });
  await manager.request('node-cache-isolated', 'original');

  const canvasState = manager.getState('node-cache-isolated', 'canvas');
  const viewerState = manager.getState('node-cache-isolated', 'original');
  const cacheSnapshot = manager.getDebugSnapshot().cache;
  const canvasEntry = cacheSnapshot.entries.find((entry) => entry.key === 'node-cache-isolated:canvas');

  assert.equal(canvasState.phase, 'thumbnail-ready');
  assert.equal(viewerState.phase, 'original-ready');
  assert.equal(canvasEntry?.tier, 'thumbnail');
  assert.equal(cacheSnapshot.stats.thumbnailEntryCount >= 1, true);
});

test('ImageManager cache budget profile uses thumbnail/original limits during import dragging', () => {
  const manager = new ImageManager({
    now: () => 21_000,
  });

  manager.updateCacheBudgetContext({
    imageNodeCount: 220,
    importingNodeCount: 12,
    isDragging: true,
    isImporting: true,
    device: {
      deviceMemoryGb: 4,
      hardwareConcurrency: 4,
      jsHeapSizeLimit: 1024 * 1024 * 1024,
    },
  });

  const snapshot = manager.getDebugSnapshot();
  assert.equal(snapshot.cacheBudget?.profile.scene, 'import-dragging');
  assert.equal(snapshot.cache.policy.maxThumbnailEntries < 96, true);
  assert.equal(snapshot.cache.policy.maxOriginalEntries < 16, true);
});

test('ImageManager keeps recently accessed thumbnail stable during short offscreen budget pressure', async () => {
  let now = 30_000;
  const attempts = [];
  const manager = new ImageManager({
    now: () => now,
    loadImageResource: async (url) => {
      attempts.push(url);
      return createLoadedResource(url, 512, 320);
    },
  });
  const resolvedAsset = {
    asset: {
      assetId: 'file-offscreen-protected',
      source: 'remote',
      variants: {
        thumbnail: {
          url: '/api/v1/files/file-offscreen-protected/thumbnail',
          width: 512,
          height: 320,
        },
      },
      version: 1,
    },
    thumbnail: {
      kind: 'thumbnail',
      url: '/api/v1/files/file-offscreen-protected/thumbnail',
      fromLegacy: false,
      asset: {
        url: '/api/v1/files/file-offscreen-protected/thumbnail',
        width: 512,
        height: 320,
      },
    },
    preferred: {
      kind: 'thumbnail',
      url: '/api/v1/files/file-offscreen-protected/thumbnail',
      fromLegacy: false,
      asset: {
        url: '/api/v1/files/file-offscreen-protected/thumbnail',
        width: 512,
        height: 320,
      },
    },
  };

  manager.register({
    nodeId: 'node-offscreen-protected',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.thumbnail.url,
  });
  manager.updateVisibility('node-offscreen-protected', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 240,
    displayHeight: 150,
    centerDistance: 0,
    visibleAreaRatio: 0.9,
    viewportZoom: 1,
    visibilityScore: 0.92,
  });
  await manager.request('node-offscreen-protected', 'canvas');

  manager.updateVisibility('node-offscreen-protected', {
    isVisible: false,
    isNearViewport: false,
    displayWidth: 0,
    displayHeight: 0,
    centerDistance: 2_200,
    visibleAreaRatio: 0,
    viewportZoom: 1,
    visibilityScore: 0.05,
  });

  now += 2_000;
  manager.updateCacheBudgetContext({
    imageNodeCount: 220,
    isImporting: false,
    isDragging: false,
    device: {
      deviceMemoryGb: 4,
      hardwareConcurrency: 4,
      jsHeapSizeLimit: 256 * 1024 * 1024,
    },
  });

  const state = manager.getState('node-offscreen-protected', 'canvas');

  assert.equal(attempts.length, 1);
  assert.equal(state.lastEventKind === 'release', false);
  assert.equal(state.phase === 'thumbnail-ready' || state.phase === 'viewport-hidden', true);
});
