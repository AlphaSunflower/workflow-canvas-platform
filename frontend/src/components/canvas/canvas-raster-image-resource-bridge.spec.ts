import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData } from '@/types';
import { ImageManager, imageManager, resolveRenderableImageSrc } from '@/services/image/image-manager';
import { buildRemoteImageAsset } from '@/services/image/image-node';
import { imageThumbnailRuntimeStore } from '@/services/image/image-thumbnail-runtime-store';
import type { LoadedImageResource } from '@/services/image/image-loader';

import {
  buildCanvasRasterItemsFromBridge,
  type CanvasRasterImageNode,
  getCanvasRasterBridgeSnapshot,
  registerCanvasRasterBridgeNodes,
} from './canvas-raster-image-resource-bridge';

const EMPTY_ACTIVE_IMAGE_NODE_ID_SET = new Set<string>();

function createLoadedResource(src: string): LoadedImageResource {
  return {
    src,
    width: 512,
    height: 320,
    decoded: 'display-url',
    estimatedBytes: 0,
  };
}

function createImageNode(dataOverrides: Partial<FileNodeData> = {}): CanvasRasterImageNode {
  const now = Date.now();
  const data: FileNodeData = {
    id: { value: 'node-1', display: '#1' },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 220, height: 140 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: { created: now, updated: now },
    fileId: 'file-1',
    fileName: 'node-1.png',
    fileSize: 1024,
    mimeType: 'image/png',
    source: { type: 'imported', importMethod: 'local', importedAt: now },
    metadata: { width: 1400, height: 900 },
    ...dataOverrides,
  };

  return {
    id: data.id.value,
    type: 'image',
    position: data.position,
    data,
    width: data.dimensions.width,
    height: data.dimensions.height,
    selected: false,
  } as CanvasRasterImageNode;
}

function createVisibleMap() {
  return new Map([['node-1', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 420,
    displayHeight: 260,
    visibilityBucket: 'visible',
    visibilityScoreBucket: 'ready',
    visibilityAreaBucket: 'ready',
    visibleAreaRatio: 1,
    viewportZoom: 1,
    visibilityScore: 0.95,
    centerDistance: 0,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    renderTier: 'full',
  }]]);
}

test('raster bridge registers passive nodes against canvas mode only', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const asset = buildRemoteImageAsset('file-1', {
    width: 1600,
    height: 1000,
  });
  const node = createImageNode({
    imageAsset: asset.imageAsset,
    thumbnailUrl: asset.thumbnailUrl,
  });

  const registered = registerCanvasRasterBridgeNodes([node]);

  assert.deepEqual(registered, ['node-1']);
  assert.equal(imageManager.getState('node-1', 'canvas').mode, 'canvas');
  assert.equal(imageManager.getState('node-1', 'original').mode, 'original');
});

test('raster bridge does not register visible nodes missing from render plan raster candidates', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();

  const registered = registerCanvasRasterBridgeNodes([]);
  const items = buildCanvasRasterItemsFromBridge([], createVisibleMap() as never, EMPTY_ACTIVE_IMAGE_NODE_ID_SET);

  assert.deepEqual(registered, []);
  assert.deepEqual(items, []);
});

test('raster bridge only iterates render plan candidate image nodes', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const candidate = createImageNode();
  const nonCandidate = createImageNode({
    id: { value: 'node-2', display: '#2' },
    fileId: 'file-2',
    fileName: 'node-2.png',
  });
  const visibility = new Map(createVisibleMap());
  visibility.set('node-2', {
    ...visibility.get('node-1')!,
    isVisible: true,
    isNearViewport: true,
  });

  const registered = registerCanvasRasterBridgeNodes([candidate]);
  const items = buildCanvasRasterItemsFromBridge(
    [candidate],
    visibility as never,
    EMPTY_ACTIVE_IMAGE_NODE_ID_SET,
  );

  assert.deepEqual(registered, ['node-1']);
  assert.deepEqual(items.map((item) => item.nodeId), ['node-1']);
  assert.equal(imageManager.getState('node-1', 'canvas').mode, 'canvas');
  assert.equal(imageManager.getState('node-2', 'canvas').mode, 'canvas');
  assert.equal(imageManager.getState('node-2', 'canvas').status, 'idle');
  assert.equal(nonCandidate.id, 'node-2');
});

test('raster bridge incremental candidates avoid registering non-candidate visible images', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const candidates = Array.from({ length: 3 }, (_, index) => createImageNode({
    id: { value: `candidate-${index}`, display: `#candidate-${index}` },
    fileId: `candidate-file-${index}`,
    fileName: `candidate-${index}.png`,
  }));
  const visibleNonCandidates = Array.from({ length: 20 }, (_, index) => createImageNode({
    id: { value: `visible-non-candidate-${index}`, display: `#visible-non-candidate-${index}` },
    fileId: `visible-non-candidate-file-${index}`,
    fileName: `visible-non-candidate-${index}.png`,
  }));
  const visibility = new Map<string, ReturnType<typeof createVisibleMap> extends Map<string, infer TValue> ? TValue : never>();
  [...candidates, ...visibleNonCandidates].forEach((node) => {
    visibility.set(node.id, {
      ...createVisibleMap().get('node-1')!,
      isVisible: true,
      isNearViewport: true,
    });
  });

  const registered = registerCanvasRasterBridgeNodes(candidates);
  const items = buildCanvasRasterItemsFromBridge(
    candidates,
    visibility as never,
    EMPTY_ACTIVE_IMAGE_NODE_ID_SET,
  );

  assert.deepEqual(registered, ['candidate-0', 'candidate-1', 'candidate-2']);
  assert.deepEqual(items.map((item) => item.nodeId), ['candidate-0', 'candidate-1', 'candidate-2']);
  visibleNonCandidates.forEach((node) => {
    assert.equal(imageManager.getState(node.id, 'canvas').status, 'idle');
  });
});

test('raster bridge uses render plan candidates rather than visibility to expand raster items', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const node = createImageNode();
  const notVisible = createVisibleMap();
  notVisible.get('node-1')!.isVisible = false;
  notVisible.get('node-1')!.isNearViewport = false;

  const items = buildCanvasRasterItemsFromBridge([node], notVisible as never, EMPTY_ACTIVE_IMAGE_NODE_ID_SET);

  assert.deepEqual(items.map((item) => item.nodeId), ['node-1']);
  assert.equal(items[0]?.status, 'viewport-hidden');
});

test('raster bridge prefers runtime thumbnail object URL over remote thumbnail', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const asset = buildRemoteImageAsset('file-1', {
    width: 1600,
    height: 1000,
  });
  const node = createImageNode({
    imageAsset: asset.imageAsset,
    thumbnailUrl: asset.thumbnailUrl,
  });
  imageThumbnailRuntimeStore.upsert('node-1', {
    objectUrl: 'blob:runtime-thumb',
    status: 'ready',
  });

  const fileNodeData = node.data as FileNodeData;
  registerCanvasRasterBridgeNodes([node]);
  const snapshot = getCanvasRasterBridgeSnapshot({
    id: fileNodeData.id,
    fileId: fileNodeData.fileId,
    imageAsset: fileNodeData.imageAsset,
    thumbnailUrl: fileNodeData.thumbnailUrl,
    metadata: fileNodeData.metadata,
  });
  const items = buildCanvasRasterItemsFromBridge([node], createVisibleMap() as never, EMPTY_ACTIVE_IMAGE_NODE_ID_SET);

  assert.equal(snapshot.preferredUrl, 'blob:runtime-thumb');
  assert.equal(snapshot.resolvedAsset.thumbnail?.url, 'blob:runtime-thumb');
  assert.equal(imageManager.getState('node-1', 'canvas').preferredUrl, 'blob:runtime-thumb');
  assert.equal(items[0]?.status, 'ready');
  assert.equal(items[0]?.src, 'blob:runtime-thumb');
  imageThumbnailRuntimeStore.clearAll();
});

test('raster bridge builds ready item from runtime thumbnail before image manager is ready', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const asset = buildRemoteImageAsset('file-1', {
    width: 1600,
    height: 1000,
  });
  const node = createImageNode({
    imageAsset: asset.imageAsset,
    thumbnailUrl: asset.thumbnailUrl,
  });
  imageThumbnailRuntimeStore.upsert('node-1', {
    objectUrl: 'blob:runtime-ready-before-manager',
    objectUrlOwner: 'external',
    status: 'ready',
  });

  const items = buildCanvasRasterItemsFromBridge(
    [node],
    createVisibleMap() as never,
    EMPTY_ACTIVE_IMAGE_NODE_ID_SET,
  );

  assert.equal(imageManager.getState('node-1', 'canvas').status, 'idle');
  assert.equal(items.length, 1);
  assert.equal(items[0]?.status, 'ready');
  assert.equal(items[0]?.src, 'blob:runtime-ready-before-manager');
  assert.equal(items[0]?.resourceSrc, 'blob:runtime-ready-before-manager');
  imageThumbnailRuntimeStore.clearAll();
});

test('raster bridge falls back to persistent thumbnail when runtime thumbnail is cleared', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const asset = buildRemoteImageAsset('file-1', {
    width: 1600,
    height: 1000,
  }, {
    thumbnailUrl: '/api/v1/files/file-1/thumbnail',
  });
  const node = createImageNode({
    imageAsset: asset.imageAsset,
    thumbnailUrl: asset.thumbnailUrl,
  });

  imageThumbnailRuntimeStore.upsert('node-1', {
    objectUrl: 'blob:runtime-thumb',
    status: 'ready',
  });
  registerCanvasRasterBridgeNodes([node]);

  assert.equal(imageManager.getState('node-1', 'canvas').preferredUrl, 'blob:runtime-thumb');

  imageThumbnailRuntimeStore.clearNode('node-1');
  registerCanvasRasterBridgeNodes([node]);

  const snapshot = getCanvasRasterBridgeSnapshot({
    id: (node.data as FileNodeData).id,
    fileId: (node.data as FileNodeData).fileId,
    imageAsset: (node.data as FileNodeData).imageAsset,
    thumbnailUrl: (node.data as FileNodeData).thumbnailUrl,
    metadata: (node.data as FileNodeData).metadata,
  });
  const state = imageManager.getState('node-1', 'canvas');

  assert.equal(snapshot.preferredUrl, asset.thumbnailUrl);
  assert.equal(snapshot.resolvedAsset.thumbnail?.url, asset.thumbnailUrl);
  assert.equal(state.preferredUrl, asset.thumbnailUrl);
  assert.equal(state.requestUrl, asset.thumbnailUrl);
});

test('raster bridge ignores runtime thumbnail loading and error entries without object URLs', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const asset = buildRemoteImageAsset('file-1', {
    width: 1600,
    height: 1000,
  }, {
    thumbnailUrl: '/api/v1/files/file-1/thumbnail',
  });
  const node = createImageNode({
    imageAsset: asset.imageAsset,
    thumbnailUrl: asset.thumbnailUrl,
  });

  imageThumbnailRuntimeStore.upsert('node-1', {
    status: 'loading',
  });
  registerCanvasRasterBridgeNodes([node]);
  assert.equal(imageManager.getState('node-1', 'canvas').preferredUrl, asset.thumbnailUrl);

  imageThumbnailRuntimeStore.upsert('node-1', {
    status: 'error',
    error: 'thumbnail-unavailable',
  });
  registerCanvasRasterBridgeNodes([node]);
  assert.equal(imageManager.getState('node-1', 'canvas').preferredUrl, asset.thumbnailUrl);
});

test('raster bridge ignores non-ready runtime thumbnail entries even when they retain old object URLs', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const asset = buildRemoteImageAsset('file-1', {
    width: 1600,
    height: 1000,
  }, {
    thumbnailUrl: '/api/v1/files/file-1/thumbnail',
  });
  const node = createImageNode({
    imageAsset: asset.imageAsset,
    thumbnailUrl: asset.thumbnailUrl,
  });

  imageThumbnailRuntimeStore.upsert('node-1', {
    objectUrl: 'blob:old-runtime-thumb',
    status: 'ready',
  });
  imageThumbnailRuntimeStore.upsert('node-1', {
    status: 'loading',
  });
  registerCanvasRasterBridgeNodes([node]);
  assert.equal(imageManager.getState('node-1', 'canvas').preferredUrl, asset.thumbnailUrl);

  imageThumbnailRuntimeStore.upsert('node-1', {
    status: 'error',
    error: 'thumbnail-unavailable',
  });
  registerCanvasRasterBridgeNodes([node]);
  assert.equal(imageManager.getState('node-1', 'canvas').preferredUrl, asset.thumbnailUrl);
});

test('raster bridge snapshot exposes canvas thumbnail preference and renderable source', () => {
  imageManager.clearAll();
  const asset = buildRemoteImageAsset('file-1', {
    width: 1600,
    height: 1000,
  }, {
    thumbnailUrl: '/api/v1/files/file-1/thumbnail',
  });
  const snapshot = getCanvasRasterBridgeSnapshot({
    id: { value: 'node-1', display: '#1' },
    fileId: 'file-1',
    imageAsset: asset.imageAsset,
    thumbnailUrl: asset.thumbnailUrl,
    metadata: {
      width: 1600,
      height: 1000,
    },
  });

  assert.equal(snapshot.preferredUrl, '/api/v1/files/file-1/thumbnail');
  assert.equal(snapshot.resolvedAsset.thumbnail?.url, '/api/v1/files/file-1/thumbnail');
  assert.equal(snapshot.resolvedAsset.original?.url?.includes('/download'), true);
});

test('resolveRenderableImageSrc keeps protected raw urls hidden until decoded display url is ready', () => {
  assert.equal(resolveRenderableImageSrc({
    src: '/api/v1/files/file-1/thumbnail',
    decodedResource: undefined,
  }), undefined);

  assert.equal(resolveRenderableImageSrc({
    src: '/api/v1/files/file-1/thumbnail',
    decodedResource: {
      src: 'blob:protected-thumbnail',
      width: 0,
      height: 0,
      decoded: 'display-url',
      estimatedBytes: 0,
    },
  }), 'blob:protected-thumbnail');
});

test('raster bridge items retain raw resource source alongside renderable display source', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const asset = buildRemoteImageAsset('file-1', {
    width: 1600,
    height: 1000,
  }, {
    thumbnailUrl: '/api/v1/files/file-1/thumbnail',
  });
  const node = createImageNode({
    imageAsset: asset.imageAsset,
    thumbnailUrl: asset.thumbnailUrl,
  });

  imageManager.register({
    nodeId: 'node-1',
    mode: 'canvas',
    resolvedAsset: {
      asset: asset.imageAsset!,
      thumbnail: {
        kind: 'thumbnail',
        url: asset.thumbnailUrl!,
        fromLegacy: false,
      },
      preferred: {
        kind: 'thumbnail',
        url: asset.thumbnailUrl!,
        fromLegacy: false,
      },
    },
    preferredUrl: asset.thumbnailUrl,
  });

  const items = buildCanvasRasterItemsFromBridge([node], createVisibleMap() as never, EMPTY_ACTIVE_IMAGE_NODE_ID_SET);

  assert.equal(items[0]?.resourceSrc, asset.thumbnailUrl);
});

test('raster bridge forwards raster load failures to image manager lifecycle', async () => {
  const manager = new ImageManager({
    loadImageResource: async () => createLoadedResource('blob:decoded-thumbnail'),
  });
  const asset = buildRemoteImageAsset('file-1', {
    width: 1600,
    height: 1000,
  }, {
    thumbnailUrl: 'blob:raw-thumbnail',
  });

  manager.register({
    nodeId: 'node-1',
    mode: 'canvas',
    resolvedAsset: {
      asset: asset.imageAsset!,
      thumbnail: {
        kind: 'thumbnail',
        url: asset.thumbnailUrl!,
        fromLegacy: false,
      },
      preferred: {
        kind: 'thumbnail',
        url: asset.thumbnailUrl!,
        fromLegacy: false,
      },
    },
    preferredUrl: asset.thumbnailUrl,
  });
  manager.updateVisibility('node-1', {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 512,
    displayHeight: 320,
  });
  await manager.request('node-1', 'canvas');

  manager.reportRenderableSourceFailure('node-1', 'blob:decoded-thumbnail', 'canvas', 'stale raster blob');

  const state = manager.getState('node-1', 'canvas');
  assert.equal(state.status, 'loading');
  assert.equal(state.src, asset.thumbnailUrl);
  assert.equal(state.requestUrl, asset.thumbnailUrl);
  assert.equal(state.lastAttemptedUrl, asset.thumbnailUrl);
});

test('raster layer reports actual failed display src and suppresses duplicate failures', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const source = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/CanvasImageRasterLayer.tsx`,
    'utf8',
  );

  assert.equal(source.includes('RASTER_IMAGE_FAILURE_SUPPRESSION_MS'), true);
  assert.equal(source.includes('failedSourceReportedAtRef.current.get(src)'), true);
  assert.equal(source.includes('Date.now() - lastFailureAt < RASTER_IMAGE_FAILURE_SUPPRESSION_MS'), true);
  assert.equal(source.includes('reportCanvasRasterImageLoadFailure('), true);
  assert.equal(source.includes('              src,\n              `Canvas raster image failed to load: ${src}`,'), true);
});

test('raster layer separates render refreshes from runtime thumbnail bridge registration', async () => {
  const fsSpecifier = 'node:fs';
  const processLike = globalThis as typeof globalThis & {
    process?: {
      cwd: () => string;
    };
  };
  const { readFileSync } = await import(fsSpecifier);
  const source = readFileSync(
    `${processLike.process?.cwd() ?? '.'}/src/components/canvas/CanvasImageRasterLayer.tsx`,
    'utf8',
  );
  const controllerSetup = source.slice(
    source.indexOf('controllerRef.current = createCanvasImageResourceController({'),
    source.indexOf('  useEffect(() => {', source.indexOf('controllerRef.current = createCanvasImageResourceController({')),
  );
  const subscriptionEffect = source.slice(
    source.indexOf('const unsubscribe = imageThumbnailRuntimeStore.subscribeAll'),
    source.indexOf('  return items;', source.indexOf('const unsubscribe = imageThumbnailRuntimeStore.subscribeAll')),
  );

  assert.equal(controllerSetup.includes('createCanvasImageResourceController({'), true);
  assert.equal(source.includes('requestCanvasRasterBridgeResource'), false);
  assert.equal(source.includes('cancelCanvasRasterBridgeResourceRequest'), false);
  assert.equal(source.includes('buildCanvasImageResourceSnapshot({'), false);
  assert.equal(source.includes('useSyncExternalStore('), true);
  assert.equal(source.includes('canvasRasterReadyStore.subscribe'), true);
  assert.equal(source.includes('controllerRef.current?.update({'), true);
  assert.equal(source.includes('imageManager.subscribe'), false);
  assert.equal(source.includes('nodes: Array<Node<AnyNodeData>>'), false);
  assert.equal(subscriptionEffect.includes("reason: 'resource-subscription'"), false);
  assert.equal(subscriptionEffect.includes('bumpRenderVersion((version) => version + 1);'), false);
  assert.equal(subscriptionEffect.includes("reason: 'runtime-thumbnail-subscription'"), false);
  assert.equal(source.includes('candidateNodeIdSignature'), false);
  assert.equal(subscriptionEffect.includes('imageThumbnailRuntimeStore.subscribeAll'), true);
  assert.equal(subscriptionEffect.includes('bumpRuntimeRegistrationRevision((version) => version + 1);'), true);
  assert.equal(subscriptionEffect.includes('requestAnimationFrame(() => {'), true);
  assert.equal(subscriptionEffect.includes('imageThumbnailRuntimeStore.subscribe('), false);
});

test('raster bridge can build items from controller-provided resource snapshots', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const node = createImageNode();

  const items = buildCanvasRasterItemsFromBridge(
    [node],
    createVisibleMap() as never,
    EMPTY_ACTIVE_IMAGE_NODE_ID_SET,
    new Map([['node-1', {
      src: 'blob:ready-from-controller',
      resourceSrc: 'blob:raw-from-controller',
      status: 'ready',
    }]]),
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.status, 'ready');
  assert.equal(items[0]?.src, 'blob:ready-from-controller');
  assert.equal(items[0]?.resourceSrc, 'blob:raw-from-controller');
  assert.equal(imageManager.getState('node-1', 'canvas').status, 'idle');
});
