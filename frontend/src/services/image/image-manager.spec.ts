import test from 'node:test';
import assert from 'node:assert/strict';

import { ImageManager } from './image-manager';
import { imageOriginalSourceRegistry } from './image-original-source-registry';
import { imageThumbnailRuntimeStore } from './image-thumbnail-runtime-store';
import { fileResourceLeaseManager, fileManifestStore } from '@/services/file-resource';
import type { ImageLoadStrategy, LoadedImageResource } from './image-loader';
import {
  getCanvasImageFlickerDebugSnapshot,
  recordCanvasFileNodeCommit,
  resetCanvasImagePerformanceSnapshot,
} from '../../utils/performance/canvas-image-performance';

function createCanvasAsset(seed = 'default') {
  return {
    asset: {
      source: 'local' as const,
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
      kind: 'thumbnail' as const,
      url: `blob:thumb-${seed}`,
      fromLegacy: false,
      asset: {
        url: `blob:thumb-${seed}`,
        width: 512,
        height: 320,
      },
    },
    preferred: {
      kind: 'thumbnail' as const,
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
      source: 'local' as const,
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
      kind: 'original' as const,
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

function createEmptyCanvasAsset(seed = 'default') {
  return {
    asset: {
      assetId: `file-${seed}`,
      source: 'local' as const,
      variants: {},
      version: 1,
    },
  };
}

function createLoadedResource(src: string, width: number, height: number): LoadedImageResource {
  return {
    src,
    width,
    height,
    decoded: 'image',
    estimatedBytes: width * height * 4,
  };
}

function createLoadedResourceWithHandle(src: string, width: number, height: number, onClose: () => void): LoadedImageResource {
  return {
    ...createLoadedResource(src, width, height),
    handle: {
      close: onClose,
    },
  };
}

test('ImageManager request reads pending visibility without synchronously flushing it', async () => {
  const scheduledMicrotasks: Array<() => void> = [];
  const scheduledNotifications: Array<() => void> = [];
  let resolveLoad: ((resource: LoadedImageResource) => void) | undefined;
  const manager = new ImageManager({
    now: () => 900,
    scheduleMicrotaskImpl: (callback) => {
      scheduledMicrotasks.push(callback);
    },
    scheduleNotificationImpl: (callback) => {
      scheduledNotifications.push(callback);
    },
    loadImageResource: async (url) => new Promise<LoadedImageResource>((resolve) => {
      resolveLoad = () => resolve(createLoadedResource(url, 512, 320));
    }),
  });
  const resolvedAsset = createCanvasAsset('request-no-visibility-flush');
  let emitCount = 0;

  manager.register({
    nodeId: 'node-request-no-visibility-flush',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.thumbnail.url,
  });
  manager.subscribe('node-request-no-visibility-flush', () => {
    emitCount += 1;
  }, 'canvas');

  manager.updateVisibility('node-request-no-visibility-flush', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 512,
    displayHeight: 320,
  });

  assert.equal(emitCount, 0);
  assert.equal(scheduledMicrotasks.length, 1);
  assert.equal(manager.getState('node-request-no-visibility-flush', 'canvas').visibility.isVisible, true);

  const requestPromise = manager.request('node-request-no-visibility-flush', 'canvas');

  assert.equal(manager.getState('node-request-no-visibility-flush', 'canvas').status, 'loading');
  assert.equal(emitCount, 0);
  assert.equal(scheduledNotifications.length, 1);
  assert.equal(scheduledMicrotasks.length, 1);

  scheduledMicrotasks.shift()?.();
  assert.equal(emitCount, 0);
  assert.equal(scheduledNotifications.length, 1);
  scheduledNotifications.shift()?.();
  assert.equal(emitCount, 1);

  resolveLoad?.(createLoadedResource(resolvedAsset.thumbnail.url, 512, 320));
  await requestPromise;
  assert.equal(manager.getState('node-request-no-visibility-flush', 'canvas').status, 'ready');
  scheduledNotifications.shift()?.();
  assert.equal(emitCount, 2);
});

test('ImageManager request failure does not indirectly flush pending visibility', async () => {
  const scheduledMicrotasks: Array<() => void> = [];
  const scheduledNotifications: Array<() => void> = [];
  const manager = new ImageManager({
    now: () => 950,
    scheduleMicrotaskImpl: (callback) => {
      scheduledMicrotasks.push(callback);
    },
    scheduleNotificationImpl: (callback) => {
      scheduledNotifications.push(callback);
    },
    loadImageResource: async (url) => {
      throw new Error(`load failed for ${url}`);
    },
  });
  const resolvedAsset = createCanvasAsset('request-failure-no-visibility-flush');
  let emitCount = 0;

  manager.register({
    nodeId: 'node-request-failure-no-visibility-flush',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.thumbnail.url,
  });
  manager.subscribe('node-request-failure-no-visibility-flush', () => {
    emitCount += 1;
  }, 'canvas');

  manager.updateVisibility('node-request-failure-no-visibility-flush', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 512,
    displayHeight: 320,
  });

  assert.equal(emitCount, 0);
  assert.equal(scheduledMicrotasks.length, 1);

  await manager.request('node-request-failure-no-visibility-flush', 'canvas');

  assert.equal(manager.getState('node-request-failure-no-visibility-flush', 'canvas').status, 'error');
  assert.equal(emitCount, 0);
  assert.equal(scheduledNotifications.length, 1);
  assert.equal(scheduledMicrotasks.length, 1);

  scheduledMicrotasks.shift()?.();
  assert.equal(emitCount, 0);
  assert.equal(scheduledNotifications.length, 1);
  scheduledNotifications.shift()?.();
  assert.equal(emitCount, 1);
});

test('ImageManager coalesces repeated state notifications by node and mode until the next notification frame', async () => {
  const scheduledNotifications: Array<() => void> = [];
  const manager = new ImageManager({
    now: () => 980,
    scheduleNotificationImpl: (callback) => {
      scheduledNotifications.push(callback);
    },
    loadImageResource: async (url) => createLoadedResource(url, 512, 320),
  });
  const resolvedAsset = createCanvasAsset('coalesced-notifications');
  let emitCount = 0;

  manager.register({
    nodeId: 'node-coalesced-notifications',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.thumbnail.url,
  });
  manager.subscribe('node-coalesced-notifications', () => {
    emitCount += 1;
  }, 'canvas');

  manager.updateVisibility('node-coalesced-notifications', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 512,
    displayHeight: 320,
  });
  await manager.request('node-coalesced-notifications', 'canvas');

  assert.equal(emitCount, 0);
  assert.equal(scheduledNotifications.length, 1);
  scheduledNotifications.shift()?.();

  assert.equal(emitCount, 1);
  assert.equal(manager.getState('node-coalesced-notifications', 'canvas').status, 'ready');
});

test('ImageManager cancelRequest makes in-flight canvas loads stale', async () => {
  let resolveLoad: ((resource: LoadedImageResource) => void) | undefined;
  const manager = new ImageManager({
    now: () => 1_000,
    loadImageResource: async (url) => new Promise<LoadedImageResource>((resolve) => {
      resolveLoad = () => resolve(createLoadedResource(url, 512, 320));
    }),
  });
  const resolvedAsset = createCanvasAsset('cancel-canvas-request');

  manager.register({
    nodeId: 'node-cancel-request',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.thumbnail.url,
  });
  manager.updateVisibility('node-cancel-request', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 512,
    displayHeight: 320,
  });
  const requestPromise = manager.request('node-cancel-request', 'canvas');
  assert.equal(manager.getState('node-cancel-request', 'canvas').status, 'loading');

  manager.cancelRequest('node-cancel-request', 'canvas');
  const cancelledState = manager.getState('node-cancel-request', 'canvas');
  assert.equal(cancelledState.status, 'idle');
  assert.equal(cancelledState.requestKey, undefined);
  assert.equal(cancelledState.lastEventReason?.startsWith('request cancelled'), true);

  resolveLoad?.(createLoadedResource(resolvedAsset.thumbnail.url, 512, 320));
  await requestPromise;
  const finalState = manager.getState('node-cancel-request', 'canvas');
  assert.equal(finalState.status, 'idle');
  assert.equal(finalState.decodedResource, undefined);
  assert.equal(finalState.lastEventClassification, 'stale');
});

test('ImageManager canvas requests stay thumbnail-only', async () => {
  const loadAttempts: string[] = [];
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

test('ImageManager treats missing canvas thumbnail source as no-source error and no longer owns import preview loading semantics', async () => {
  const loadAttempts: string[] = [];
  const manager = new ImageManager({
    now: () => 1_250,
    loadImageResource: async (url) => {
      loadAttempts.push(url);
      return createLoadedResource(url, 512, 320);
    },
  });

  imageThumbnailRuntimeStore.clearAll();
  imageThumbnailRuntimeStore.upsert('node-runtime-pending', {
    status: 'loading',
  });

  manager.register({
    nodeId: 'node-runtime-pending',
    mode: 'canvas',
    resolvedAsset: createEmptyCanvasAsset('runtime-pending'),
  });
  manager.updateVisibility('node-runtime-pending', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 512,
    displayHeight: 320,
  });
  await manager.request('node-runtime-pending', 'canvas');

  const state = manager.getState('node-runtime-pending', 'canvas');

  assert.deepEqual(loadAttempts, []);
  assert.equal(state.status, 'error');
  assert.equal(state.phase, 'error');
  assert.equal(state.error, 'No image source available');
  assert.equal(state.lastEventReason, 'request skipped: no image source available');
  manager.clearAll();
});

test('ImageManager clearAll only clears display resources and does not clear original sources', () => {
  try {
    imageOriginalSourceRegistry.clear({ force: true });
    fileResourceLeaseManager.clear();
    fileManifestStore.clear();
    const manager = new ImageManager();
    const originalFile = new File(['original'], 'original.png', { type: 'image/png' });
    imageOriginalSourceRegistry.registerLocalFile('node-original', 'file-original', originalFile, {
      workflowId: 'workflow-original',
    });

    manager.clearAll();

    assert.equal(imageOriginalSourceRegistry.getFile('node-original', 'file-original', {
      workflowId: 'workflow-original',
    }), originalFile);
  } finally {
    imageOriginalSourceRegistry.clear({ force: true });
    fileResourceLeaseManager.clear();
    fileManifestStore.clear();
  }
});

test('ImageManager canvas does not fall back to original when thumbnail load fails', async () => {
  const loadAttempts: string[] = [];
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

test('ImageManager clears stale decoded renderable blob and cools down its thumbnail source', async () => {
  let now = 2_000;
  let closeCount = 0;
  const loadAttempts: string[] = [];
  const manager = new ImageManager({
    now: () => now,
    loadImageResource: async (url) => {
      loadAttempts.push(url);
      return createLoadedResourceWithHandle('blob:decoded-stale', 512, 320, () => {
        closeCount += 1;
      });
    },
  });
  const resolvedAsset = createCanvasAsset('decoded-stale');

  manager.register({
    nodeId: 'node-decoded-stale',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.thumbnail.url,
  });
  manager.updateVisibility('node-decoded-stale', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 512,
    displayHeight: 320,
  });
  await manager.request('node-decoded-stale', 'canvas');

  assert.equal(manager.getRenderableSrc('node-decoded-stale', 'canvas'), 'blob:decoded-stale');

  manager.reportRenderableSourceFailure('node-decoded-stale', 'blob:decoded-stale', 'canvas', 'stale blob');

  const state = manager.getState('node-decoded-stale', 'canvas');
  const snapshot = manager.getDebugSnapshot();

  assert.equal(closeCount, 1);
  assert.equal(state.decodedResource, undefined);
  assert.equal(manager.getRenderableSrc('node-decoded-stale', 'canvas'), resolvedAsset.thumbnail.url);
  assert.equal(state.src, resolvedAsset.thumbnail.url);
  assert.equal(state.requestUrl, resolvedAsset.thumbnail.url);
  assert.equal(state.status, 'loading');
  assert.equal(state.lastAttemptedUrl, resolvedAsset.thumbnail.url);
  assert.equal(snapshot.failedUrlGroups, 1);
  assert.equal(snapshot.cache.stats.decodedReleaseCount, 1);

  now += 1_000;
  await manager.request('node-decoded-stale', 'canvas');
  assert.deepEqual(loadAttempts, [resolvedAsset.thumbnail.url, resolvedAsset.thumbnail.url]);

  now += 20_000;
  manager.updateVisibility('node-decoded-stale', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 513,
    displayHeight: 320,
  });

  assert.equal(manager.getState('node-decoded-stale', 'canvas').requestUrl, resolvedAsset.thumbnail.url);
});

test('ImageManager renderable source failure keeps canvas thumbnail-only and never retries original', async () => {
  const loadAttempts: string[] = [];
  const manager = new ImageManager({
    now: () => 2_500,
    loadImageResource: async (url) => {
      loadAttempts.push(url);
      return createLoadedResource('blob:decoded-original-guard', 512, 320);
    },
  });
  const resolvedAsset = createAssetWithOriginal('renderable-failure-original-guard');

  manager.register({
    nodeId: 'node-renderable-original-guard',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.original.url,
  });
  manager.updateVisibility('node-renderable-original-guard', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 1024,
    displayHeight: 640,
  });
  await manager.request('node-renderable-original-guard', 'canvas');

  manager.reportRenderableSourceFailure(
    'node-renderable-original-guard',
    'blob:decoded-original-guard',
    'canvas',
    'stale blob',
  );
  await manager.request('node-renderable-original-guard', 'canvas');

  const state = manager.getState('node-renderable-original-guard', 'canvas');

  assert.deepEqual(loadAttempts, [
    resolvedAsset.thumbnail.url,
    resolvedAsset.thumbnail.url,
  ]);
  assert.equal(loadAttempts.includes(resolvedAsset.original.url), false);
  assert.equal(state.activeVariantKind, 'thumbnail');
  assert.equal(state.resourceRole, 'canvas-thumbnail');
});

test('ImageManager does not cool down fallback thumbnail when a retained stale blob fails', async () => {
  let now = 4_000;
  let attempt = 0;
  const loadAttempts: string[] = [];
  const manager = new ImageManager({
    now: () => now,
    loadImageResource: async (url) => {
      attempt += 1;
      loadAttempts.push(url);
      return createLoadedResource(`blob:decoded-${attempt}`, 512, 320);
    },
  });
  const firstAsset = createCanvasAsset('stale-first');
  const secondAsset = createCanvasAsset('stale-second');

  manager.register({
    nodeId: 'node-retained-stale',
    mode: 'canvas',
    resolvedAsset: firstAsset,
    preferredUrl: firstAsset.thumbnail.url,
  });
  manager.updateVisibility('node-retained-stale', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 512,
    displayHeight: 320,
  });
  await manager.request('node-retained-stale', 'canvas');

  manager.register({
    nodeId: 'node-retained-stale',
    mode: 'canvas',
    resolvedAsset: secondAsset,
    preferredUrl: secondAsset.thumbnail.url,
  });
  assert.equal(manager.getRenderableSrc('node-retained-stale', 'canvas'), 'blob:decoded-1');
  assert.equal(manager.getState('node-retained-stale', 'canvas').requestUrl, secondAsset.thumbnail.url);

  manager.reportRenderableSourceFailure('node-retained-stale', 'blob:decoded-1', 'canvas', 'stale retained blob');
  const stateAfterFailure = manager.getState('node-retained-stale', 'canvas');
  assert.equal(stateAfterFailure.src, secondAsset.thumbnail.url);
  assert.equal(stateAfterFailure.requestUrl, secondAsset.thumbnail.url);
  assert.equal(stateAfterFailure.status, 'loading');

  now += 1;
  await manager.request('node-retained-stale', 'canvas');

  assert.deepEqual(loadAttempts, [
    firstAsset.thumbnail.url,
    secondAsset.thumbnail.url,
  ]);
  assert.equal(manager.getRenderableSrc('node-retained-stale', 'canvas'), 'blob:decoded-2');
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

test('ImageManager suppresses repeated original requests while failed url is cooling down', async () => {
  let now = 6_000;
  const loadAttempts: string[] = [];
  const manager = new ImageManager({
    now: () => now,
    loadImageResource: async (url) => {
      loadAttempts.push(url);
      if (url.includes('original')) {
        throw new Error(`load failed for ${url}`);
      }
      return createLoadedResource(url, 512, 320);
    },
  });
  const resolvedAsset = createAssetWithOriginal('cooldown');

  manager.register({
    nodeId: 'node-original-cooldown',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.thumbnail.url,
  });
  manager.updateVisibility('node-original-cooldown', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 512,
    displayHeight: 320,
  });
  await manager.request('node-original-cooldown', 'canvas');

  manager.register({
    nodeId: 'node-original-cooldown',
    mode: 'original',
    resolvedAsset,
    preferredUrl: resolvedAsset.original.url,
  });
  await manager.request('node-original-cooldown', 'original');
  await manager.request('node-original-cooldown', 'original');

  const originalState = manager.getState('node-original-cooldown', 'original');
  const canvasState = manager.getState('node-original-cooldown', 'canvas');

  assert.deepEqual(loadAttempts, [
    resolvedAsset.thumbnail.url,
    resolvedAsset.original.url,
  ]);
  assert.equal(originalState.status, 'error');
  assert.equal(originalState.lastEventReason, `request suppressed during failure cooldown src=${resolvedAsset.original.url}`);
  assert.equal(canvasState.status, 'ready');
  assert.equal(canvasState.src, resolvedAsset.thumbnail.url);

  now += 20_000;
  manager.register({
    nodeId: 'node-original-cooldown',
    mode: 'original',
    resolvedAsset,
    preferredUrl: resolvedAsset.original.url,
  });
  await manager.request('node-original-cooldown', 'original');

  assert.deepEqual(loadAttempts, [
    resolvedAsset.thumbnail.url,
    resolvedAsset.original.url,
    resolvedAsset.original.url,
  ]);
});

test('ImageManager display-url strategy applies only to canvas thumbnails', async () => {
  const calls: Array<{
    url: string;
    strategy?: ImageLoadStrategy;
    persistent?: boolean;
    version?: string;
    resizeWidth?: number;
    resizeHeight?: number;
  }> = [];
  const manager = new ImageManager({
    now: () => 10_000,
    canvasLoadStrategy: 'display-url',
    loadImageResource: async (url, strategy, options) => {
      calls.push({
        url,
        strategy,
        persistent: options?.preferPersistentCache,
        version: options?.persistentVersion,
        resizeWidth: options?.resizeWidth,
        resizeHeight: options?.resizeHeight,
      });
      return {
        src: url,
        width: strategy === 'display-url' ? 0 : 1200,
        height: strategy === 'display-url' ? 0 : 800,
        decoded: strategy === 'display-url' ? 'display-url' : 'image',
        estimatedBytes: strategy === 'display-url' ? 0 : 1200 * 800 * 4,
      };
    },
  });
  const resolvedAsset = {
    asset: {
      assetId: 'file-display-url',
      source: 'remote' as const,
      variants: {
        thumbnail: {
          url: '/api/v1/files/file-display-url/thumbnail',
          width: 512,
          height: 320,
        },
        original: {
          url: '/api/v1/files/file-display-url/download',
          width: 2400,
          height: 1600,
        },
      },
      version: 1,
    },
    thumbnail: {
      kind: 'thumbnail' as const,
      url: '/api/v1/files/file-display-url/thumbnail',
      fromLegacy: false,
      asset: {
        url: '/api/v1/files/file-display-url/thumbnail',
        width: 512,
        height: 320,
      },
    },
    original: {
      kind: 'original' as const,
      url: '/api/v1/files/file-display-url/download',
      fromLegacy: false,
      asset: {
        url: '/api/v1/files/file-display-url/download',
        width: 2400,
        height: 1600,
      },
    },
    preferred: {
      kind: 'thumbnail' as const,
      url: '/api/v1/files/file-display-url/thumbnail',
      fromLegacy: false,
      asset: {
        url: '/api/v1/files/file-display-url/thumbnail',
        width: 512,
        height: 320,
      },
    },
  };

  manager.register({
    nodeId: 'node-display-url',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.thumbnail.url,
  });
  manager.updateVisibility('node-display-url', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 900,
    displayHeight: 560,
  });
  await manager.request('node-display-url', 'canvas');

  manager.register({
    nodeId: 'node-display-url',
    mode: 'original',
    resolvedAsset,
    preferredUrl: resolvedAsset.original.url,
  });
  await manager.request('node-display-url', 'original');

  assert.equal(calls[0]?.url, resolvedAsset.thumbnail.url);
  assert.equal(calls[0]?.strategy, 'display-url');
  assert.equal(calls[0]?.persistent, true);
  assert.equal(calls[0]?.resizeWidth, undefined);
  assert.equal(calls[0]?.resizeHeight, undefined);
  assert.equal((calls[0]?.version ?? '').includes('thumbnail'), true);
  assert.equal((calls[0]?.version ?? '').includes(resolvedAsset.thumbnail.url), true);
  assert.equal(calls[1]?.url, resolvedAsset.original.url);
  assert.equal(calls[1]?.strategy, 'decode');
  assert.equal(calls[1]?.persistent, false);
  assert.equal(calls[1]?.resizeWidth, undefined);
  assert.equal(calls[1]?.resizeHeight, undefined);
  assert.equal((calls[1]?.version ?? '').includes('original'), true);
  assert.equal((calls[1]?.version ?? '').includes(resolvedAsset.original.url), true);
});

test('ImageManager passes display-sized decode hints for canvas thumbnail requests', async () => {
  const calls: Array<{
    url: string;
    strategy?: ImageLoadStrategy;
    resizeWidth?: number;
    resizeHeight?: number;
  }> = [];
  const manager = new ImageManager({
    now: () => 10_100,
    loadImageResource: async (url, strategy, options) => {
      calls.push({
        url,
        strategy,
        resizeWidth: options?.resizeWidth,
        resizeHeight: options?.resizeHeight,
      });
      return createLoadedResource(url, options?.resizeWidth ?? 512, options?.resizeHeight ?? 320);
    },
  });
  const resolvedAsset = createCanvasAsset('decode-resize');

  manager.register({
    nodeId: 'node-decode-resize',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.thumbnail.url,
  });
  manager.updateVisibility('node-decode-resize', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 900,
    displayHeight: 560,
  });
  await manager.request('node-decode-resize', 'canvas');

  assert.equal(calls[0]?.url, resolvedAsset.thumbnail.url);
  assert.equal(calls[0]?.strategy, 'decode');
  assert.equal(calls[0]?.resizeWidth, 1792);
  assert.equal(calls[0]?.resizeHeight, 1120);
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

test('ImageManager keeps previously ready canvas src while switching to a new thumbnail asset', async () => {
  const manager = new ImageManager({
    loadImageResource: async (url) => createLoadedResource(url, 512, 320),
    now: () => 30_000,
  });
  const initialAsset = createCanvasAsset('switch-a');
  const nextAsset = createCanvasAsset('switch-b');

  manager.register({
    nodeId: 'node-switch-stable',
    mode: 'canvas',
    resolvedAsset: initialAsset,
    preferredUrl: initialAsset.thumbnail.url,
  });
  manager.updateVisibility('node-switch-stable', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 640,
    displayHeight: 400,
  });
  await manager.request('node-switch-stable', 'canvas');

  manager.register({
    nodeId: 'node-switch-stable',
    mode: 'canvas',
    resolvedAsset: nextAsset,
    preferredUrl: nextAsset.thumbnail.url,
  });

  const nextState = manager.getState('node-switch-stable', 'canvas');
  assert.equal(nextState.src, initialAsset.thumbnail.url);
  assert.equal(nextState.requestUrl, nextAsset.thumbnail.url);
  assert.equal(nextState.status, 'ready');
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

test('ImageManager drag viewport updates keep canvas thumbnails from loading originals', async () => {
  const loadAttempts: string[] = [];
  const manager = new ImageManager({
    now: () => 22_000,
    loadImageResource: async (url) => {
      loadAttempts.push(url);
      return createLoadedResource(url, 512, 320);
    },
  });
  const resolvedAsset = createAssetWithOriginal('drag-thumbnail-only');

  manager.register({
    nodeId: 'node-drag-thumbnail-only',
    mode: 'canvas',
    resolvedAsset,
    preferredUrl: resolvedAsset.original.url,
  });

  manager.updateCacheBudgetContext({
    imageNodeCount: 180,
    isDragging: true,
    isImporting: false,
    device: {
      deviceMemoryGb: 4,
      hardwareConcurrency: 4,
      jsHeapSizeLimit: 512 * 1024 * 1024,
    },
  });

  manager.updateVisibility('node-drag-thumbnail-only', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 1200,
    displayHeight: 760,
    centerDistance: 0,
  });
  await manager.request('node-drag-thumbnail-only', 'canvas');
  manager.updateVisibility('node-drag-thumbnail-only', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 1400,
    displayHeight: 900,
    centerDistance: 80,
  });
  await manager.request('node-drag-thumbnail-only', 'canvas');

  const state = manager.getState('node-drag-thumbnail-only', 'canvas');

  assert.deepEqual(loadAttempts, [resolvedAsset.thumbnail.url]);
  assert.equal(loadAttempts.includes(resolvedAsset.original.url), false);
  assert.equal(state.activeVariantKind, 'thumbnail');
  assert.equal(state.resourceRole, 'canvas-thumbnail');
  assert.equal(manager.getDebugSnapshot().cache.stats.originalEntryCount, 0);
});

test('canvas image flicker debug snapshot does not flag stable thumbnail release transitions as loops', () => {
  resetCanvasImagePerformanceSnapshot();

  recordCanvasFileNodeCommit({
    nodeId: 'node-loop',
    nodeType: 'image',
    fileName: 'loop.jpg',
    selected: false,
    dragging: false,
    status: 'idle',
    placeholder: 'ready',
    activeVariantKind: 'thumbnail',
    resourceStatus: 'ready',
    resourcePhase: 'thumbnail-ready',
    requestKey: 'node-loop:canvas:1',
    requestEventKind: 'load-succeeded',
    requestEventClassification: 'current',
    requestEventReason: 'load succeeded node-loop:canvas:1 src=/api/v1/files/file-a/thumbnail',
    attemptedUrl: '/api/v1/files/file-a/thumbnail',
    src: 'blob:resource-a',
    isVisible: true,
    isNearViewport: true,
    displayWidth: 250,
    displayHeight: 141,
  });
  recordCanvasFileNodeCommit({
    nodeId: 'node-loop',
    nodeType: 'image',
    fileName: 'loop.jpg',
    selected: false,
    dragging: false,
    status: 'idle',
    placeholder: 'ready',
    activeVariantKind: 'thumbnail',
    resourceStatus: 'idle',
    resourcePhase: 'idle',
    requestKey: undefined,
    requestEventKind: 'release',
    requestEventClassification: 'current',
    requestEventReason: 'release canvas reset-to=/api/v1/files/file-a/thumbnail',
    requestSwitchReason: 'release-reset',
    attemptedUrl: '/api/v1/files/file-a/thumbnail',
    src: '/api/v1/files/file-a/thumbnail',
    isVisible: true,
    isNearViewport: true,
    displayWidth: 250,
    displayHeight: 141,
  });

  const snapshot = getCanvasImageFlickerDebugSnapshot();
  assert.equal(snapshot.suspectedLoops.length, 0);

  resetCanvasImagePerformanceSnapshot();
});
