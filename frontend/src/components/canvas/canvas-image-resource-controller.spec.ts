import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData } from '@/types';
import type { VisibleNodeMap, VisibleNodeState } from '@/hooks/canvas/useVisibleNodes';
import { imageManager } from '@/services/image/image-manager';
import { imageThumbnailRuntimeStore } from '@/services/image/image-thumbnail-runtime-store';
import type { LoadedImageResource } from '@/services/image/image-loader';

import type { CanvasRasterImageNode } from './canvas-raster-image-resource-bridge';
import {
  buildCanvasImageResourceSnapshot,
  createCanvasImageResourceController,
} from './canvas-image-resource-controller';
import { createCanvasRasterReadyStore } from './canvas-raster-ready-store';

function createVisibility(overrides: Partial<VisibleNodeState> = {}): VisibleNodeState {
  return {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 100,
    displayHeight: 100,
    visibilityBucket: 'visible',
    visibilityScoreBucket: 'ready',
    visibilityAreaBucket: 'ready',
    visibleAreaRatio: 1,
    viewportZoom: 1,
    visibilityScore: 0.8,
    centerDistance: 10,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    renderTier: 'compact',
    ...overrides,
  };
}

function createImageNode(id: string, overrides: Partial<FileNodeData> = {}): CanvasRasterImageNode {
  const now = Date.now();
  const data: FileNodeData = {
    id: { value: id, display: `#${id}` },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: now, updated: now },
    fileId: `file-${id}`,
    fileName: `${id}.png`,
    fileSize: 1,
    mimeType: 'image/png',
    source: { type: 'imported', importMethod: 'local', importedAt: now },
    metadata: {},
    imageResourceOwner: 'raster',
    thumbnailUrl: `blob:${id}`,
    imageAsset: {
      source: 'local',
      variants: {
        thumbnail: {
          url: `blob:${id}`,
          width: 100,
          height: 100,
        },
      },
      version: 1,
    },
    ...overrides,
  };

  return {
    id,
    type: 'image',
    position: data.position,
    data,
    width: data.dimensions.width,
    height: data.dimensions.height,
    selected: false,
  } as CanvasRasterImageNode;
}

function createVisibleMap(nodes: readonly CanvasRasterImageNode[]): VisibleNodeMap {
  return new Map(nodes.map((node) => [node.id, createVisibility({
    isImporting: node.data.status === 'pending' || node.data.status === 'processing',
    isSelected: Boolean(node.selected || node.data.activeReasons?.includes('selected')),
  })]));
}

function createManualFrameScheduler() {
  let nextFrameId = 0;
  const callbacks = new Map<number, () => void>();

  return {
    schedule(callback: () => void): number {
      nextFrameId += 1;
      callbacks.set(nextFrameId, callback);
      return nextFrameId;
    },
    cancel(frameId: number): void {
      callbacks.delete(frameId);
    },
    flushOne(): boolean {
      const [frameId, callback] = callbacks.entries().next().value as [number, () => void] | undefined ?? [];
      if (!frameId || !callback) {
        return false;
      }

      callbacks.delete(frameId);
      callback();
      return true;
    },
  };
}

function createLoadedResource(src: string): LoadedImageResource {
  return {
    src,
    width: 100,
    height: 100,
    decoded: 'display-url',
    estimatedBytes: 0,
  };
}

test('CanvasImageResourceController registers and requests resources from render plan candidates', async () => {
  const frames = createManualFrameScheduler();
  const nodes = [
    createImageNode('node-1'),
    createImageNode('node-2'),
  ];
  const registeredBatches: string[][] = [];
  const requestedNodeIds: string[] = [];
  const controller = createCanvasImageResourceController({
    registerNodes: (batch) => {
      const ids = batch.map((node) => node.id);
      registeredBatches.push(ids);
      return ids;
    },
    requestNode: (nodeId) => {
      requestedNodeIds.push(nodeId);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 2,
    passiveMaxConcurrentRequests: 10,
  });

  const snapshot = controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
  });

  assert.deepEqual(snapshot.items.map((item) => item.nodeId), ['node-1', 'node-2']);
  assert.deepEqual(snapshot.resourceCandidates.map((candidate) => candidate.node.id), ['node-1', 'node-2']);

  assert.equal(frames.flushOne(), true);
  await Promise.resolve();

  assert.deepEqual(registeredBatches, [['node-1', 'node-2']]);
  assert.deepEqual(requestedNodeIds, ['node-1', 'node-2']);
  controller.dispose();
});

test('CanvasImageResourceController uses LOD candidates instead of full render plan candidates', async () => {
  const frames = createManualFrameScheduler();
  const nodes = [
    createImageNode('node-1'),
    createImageNode('node-2'),
  ];
  const registeredBatches: string[][] = [];
  const requestedNodeIds: string[] = [];
  const controller = createCanvasImageResourceController({
    registerNodes: (batch) => {
      const ids = batch.map((node) => node.id);
      registeredBatches.push(ids);
      return ids;
    },
    requestNode: (nodeId) => {
      requestedNodeIds.push(nodeId);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

  const snapshot = controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    lodRasterEligibleImageNodes: [],
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
  });

  assert.deepEqual(snapshot.items, []);
  assert.deepEqual(snapshot.resourceCandidates, []);
  assert.equal(frames.flushOne(), false);
  assert.deepEqual(registeredBatches, []);
  assert.deepEqual(requestedNodeIds, []);
  controller.dispose();
});

test('CanvasImageResourceController update does not commit non-ready snapshots to ready store', () => {
  const readyStore = createCanvasRasterReadyStore();
  let emitCount = 0;
  readyStore.subscribe(() => {
    emitCount += 1;
  });
  const nodes = [createImageNode('node-1')];
  const controller = createCanvasImageResourceController({
    readyStore,
    registerNodes: () => [],
    requestNode: () => undefined,
  });

  const snapshot = controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
  });

  assert.equal(snapshot.items.length, 1);
  assert.equal(readyStore.getSnapshot().version, 0);
  assert.deepEqual(readyStore.getSnapshot().items, []);
  assert.equal(emitCount, 0);
  controller.dispose();
});

test('CanvasImageResourceController commits ready runtime thumbnails from update without requesting first', async () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const frames = createManualFrameScheduler();
  const readyStore = createCanvasRasterReadyStore();
  const nodes = [createImageNode('node-runtime-thumb', {
    thumbnailUrl: '/api/v1/files/node-runtime-thumb/thumbnail',
  })];
  let emitCount = 0;
  readyStore.subscribe(() => {
    emitCount += 1;
  });
  imageThumbnailRuntimeStore.upsert('node-runtime-thumb', {
    objectUrl: 'blob:runtime-thumb-ready',
    objectUrlOwner: 'external',
    status: 'ready',
  });
  const controller = createCanvasImageResourceController({
    readyStore,
    registerNodes: () => [],
    requestNode: () => undefined,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

  controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
    deferResourceRequests: true,
  });

  assert.deepEqual(readyStore.getSnapshot().items, []);
  assert.equal(frames.flushOne(), true);

  const snapshot = readyStore.getSnapshot();
  assert.equal(snapshot.version, 1);
  assert.equal(emitCount, 1);
  assert.deepEqual(snapshot.items.map((item) => item.nodeId), ['node-runtime-thumb']);
  assert.equal(snapshot.items[0]?.status, 'ready');
  assert.equal(snapshot.items[0]?.src, 'blob:runtime-thumb-ready');
  controller.dispose();
  imageThumbnailRuntimeStore.clearAll();
  imageManager.clearAll();
});

test('CanvasImageResourceController low zoom ready snapshot commit ignores non-ready runtime entries', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const frames = createManualFrameScheduler();
  const readyStore = createCanvasRasterReadyStore();
  const nodes = [createImageNode('node-runtime-loading')];
  imageThumbnailRuntimeStore.upsert('node-runtime-loading', {
    status: 'loading',
  });
  const controller = createCanvasImageResourceController({
    readyStore,
    registerNodes: () => [],
    requestNode: () => undefined,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

  controller.commitReadySnapshotFromUpdate({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
    deferResourceRequests: true,
  });

  assert.equal(frames.flushOne(), false);
  assert.deepEqual(readyStore.getSnapshot().items, []);
  assert.equal(readyStore.getSnapshot().version, 0);
  controller.dispose();
  imageThumbnailRuntimeStore.clearAll();
  imageManager.clearAll();
});

test('CanvasImageResourceController pause resumes queued requests without clearing ready store', async () => {
  const readyStore = createCanvasRasterReadyStore();
  readyStore.replace([{
    nodeId: 'ready-node',
    fileName: 'ready-node.png',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    status: 'ready',
    src: 'blob:ready-node',
  }]);
  const frames = createManualFrameScheduler();
  const requestedNodeIds: string[] = [];
  const nodes = [createImageNode('node-1')];
  const controller = createCanvasImageResourceController({
    readyStore,
    registerNodes: (batch) => batch.map((node) => node.id),
    requestNode: (nodeId) => {
      requestedNodeIds.push(nodeId);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

  controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
  });
  controller.pauseRequests();

  assert.equal(frames.flushOne(), false);
  assert.deepEqual(readyStore.getSnapshot().items.map((item) => item.nodeId), ['ready-node']);

  controller.resumeRequests();
  assert.equal(frames.flushOne(), true);
  await Promise.resolve();

  assert.deepEqual(requestedNodeIds, ['node-1']);
  controller.dispose();
});

test('CanvasImageResourceController prioritizes selected and hovered resources before passive resources', async () => {
  const frames = createManualFrameScheduler();
  const nodes = [
    createImageNode('passive-1'),
    createImageNode('hovered', { activeReasons: ['hovered'] }),
    createImageNode('selected', { activeReasons: ['selected'] }),
    createImageNode('passive-2'),
  ];
  const registeredBatches: string[][] = [];
  const controller = createCanvasImageResourceController({
    registerNodes: (batch) => {
      const ids = batch.map((node) => node.id);
      registeredBatches.push(ids);
      return ids;
    },
    requestNode: () => undefined,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 2,
    passiveMaxConcurrentRequests: 10,
  });

  controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(['hovered', 'selected']),
    runtimeRegistrationRevision: 1,
  });
  frames.flushOne();
  await Promise.resolve();

  assert.deepEqual(registeredBatches[0], ['selected', 'hovered']);
  controller.dispose();
});

test('CanvasImageResourceController defers passive importing resources without ready runtime thumbnails', async () => {
  imageThumbnailRuntimeStore.clearAll();
  const frames = createManualFrameScheduler();
  const nodes = [
    createImageNode('importing-1', { status: 'processing' }),
    createImageNode('importing-2', { status: 'processing' }),
    createImageNode('stable'),
  ];
  const registeredBatches: string[][] = [];
  const controller = createCanvasImageResourceController({
    registerNodes: (batch) => {
      const ids = batch.map((node) => node.id);
      registeredBatches.push(ids);
      return ids;
    },
    requestNode: () => undefined,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 4,
    importingBatchSize: 1,
    passiveMaxConcurrentRequests: 10,
    importingMaxConcurrentRequests: 10,
  });

  const snapshot = controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
  });

  assert.deepEqual(snapshot.resourceCandidates.map((candidate) => candidate.node.id), ['stable']);
  frames.flushOne();
  await Promise.resolve();

  assert.deepEqual(registeredBatches[0], ['stable']);
  assert.equal(frames.flushOne(), false);
  controller.dispose();
  imageThumbnailRuntimeStore.clearAll();
});

test('CanvasImageResourceController promotes selected hovered and active importing resources', async () => {
  imageThumbnailRuntimeStore.clearAll();
  const frames = createManualFrameScheduler();
  const nodes = [
    createImageNode('passive-importing', { status: 'processing' }),
    createImageNode('selected-importing', { status: 'processing', activeReasons: ['selected'] }),
    createImageNode('hovered-importing', { status: 'processing', activeReasons: ['hovered'] }),
    createImageNode('active-importing', {
      status: 'processing',
      activeState: 'active',
      imageResourceOwner: 'dom',
      renderTier: 'full',
    }),
  ];
  const registeredBatches: string[][] = [];
  const controller = createCanvasImageResourceController({
    registerNodes: (batch) => {
      const ids = batch.map((node) => node.id);
      registeredBatches.push(ids);
      return ids;
    },
    requestNode: () => undefined,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    importingBatchSize: 4,
    importingMaxConcurrentRequests: 10,
  });

  const snapshot = controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(['selected-importing', 'hovered-importing', 'active-importing']),
    runtimeRegistrationRevision: 1,
  });

  assert.deepEqual(snapshot.resourceCandidates.map((candidate) => candidate.node.id), [
    'selected-importing',
    'hovered-importing',
    'active-importing',
  ]);
  frames.flushOne();
  await Promise.resolve();

  assert.deepEqual(registeredBatches[0], [
    'selected-importing',
    'hovered-importing',
    'active-importing',
  ]);
  controller.dispose();
  imageThumbnailRuntimeStore.clearAll();
});

test('CanvasImageResourceController does not promote importing resources before any request source exists', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const nodes = [
    createImageNode('selected-no-source', {
      status: 'processing',
      activeReasons: ['selected'],
      thumbnailUrl: undefined,
      imageAsset: {
        source: 'local',
        variants: {},
        version: 1,
      },
    }),
    createImageNode('hovered-no-source', {
      status: 'processing',
      activeReasons: ['hovered'],
      thumbnailUrl: undefined,
      imageAsset: {
        source: 'local',
        variants: {},
        version: 1,
      },
    }),
    createImageNode('active-no-source', {
      status: 'processing',
      activeState: 'active',
      imageResourceOwner: 'dom',
      renderTier: 'full',
      thumbnailUrl: undefined,
      imageAsset: {
        source: 'local',
        variants: {},
        version: 1,
      },
    }),
  ];

  const snapshot = buildCanvasImageResourceSnapshot({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(['selected-no-source', 'hovered-no-source', 'active-no-source']),
    runtimeRegistrationRevision: 1,
  });

  assert.deepEqual(snapshot.resourceCandidates, []);
  imageThumbnailRuntimeStore.clearAll();
  imageManager.clearAll();
});

test('CanvasImageResourceController promotes importing resources once a runtime thumbnail is ready', () => {
  imageManager.clearAll();
  imageThumbnailRuntimeStore.clearAll();
  const nodes = [
    createImageNode('selected-runtime-source', {
      status: 'processing',
      activeReasons: ['selected'],
      thumbnailUrl: undefined,
      imageAsset: {
        source: 'local',
        variants: {},
        version: 1,
      },
    }),
  ];
  imageThumbnailRuntimeStore.upsert('selected-runtime-source', {
    objectUrl: 'blob:selected-runtime-source',
    objectUrlOwner: 'external',
    status: 'ready',
  });

  const snapshot = buildCanvasImageResourceSnapshot({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(['selected-runtime-source']),
    runtimeRegistrationRevision: 1,
  });

  assert.deepEqual(snapshot.resourceCandidates.map((candidate) => candidate.node.id), ['selected-runtime-source']);
  imageThumbnailRuntimeStore.clearAll();
  imageManager.clearAll();
});

test('CanvasImageResourceController allows passive importing resources after runtime thumbnail is ready', () => {
  imageThumbnailRuntimeStore.clearAll();
  const nodes = [
    createImageNode('importing-ready-thumb', { status: 'processing' }),
  ];
  imageThumbnailRuntimeStore.upsert('importing-ready-thumb', {
    objectUrl: 'blob:runtime-ready-thumb',
    objectUrlOwner: 'external',
    status: 'ready',
  });

  const snapshot = buildCanvasImageResourceSnapshot({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 2,
  });

  assert.deepEqual(snapshot.resourceCandidates.map((candidate) => candidate.node.id), ['importing-ready-thumb']);
  imageThumbnailRuntimeStore.clearAll();
});

test('CanvasImageResourceController resource signatures ignore global runtime revision and track per-node runtime thumbnail changes', () => {
  imageThumbnailRuntimeStore.clearAll();
  const nodes = [
    createImageNode('node-1'),
    createImageNode('node-2'),
  ];
  const firstSnapshot = buildCanvasImageResourceSnapshot({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
  });
  const revisionOnlySnapshot = buildCanvasImageResourceSnapshot({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 2,
  });

  assert.deepEqual(
    revisionOnlySnapshot.resourceCandidates.map((candidate) => candidate.resourceSignature),
    firstSnapshot.resourceCandidates.map((candidate) => candidate.resourceSignature),
  );

  imageThumbnailRuntimeStore.upsert('node-2', {
    objectUrl: 'blob:node-2-runtime-loading',
    objectUrlOwner: 'external',
    status: 'loading',
  });
  const runtimeLoadingSnapshot = buildCanvasImageResourceSnapshot({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 3,
  });

  assert.deepEqual(
    runtimeLoadingSnapshot.resourceCandidates.map((candidate) => candidate.resourceSignature),
    firstSnapshot.resourceCandidates.map((candidate) => candidate.resourceSignature),
  );

  imageThumbnailRuntimeStore.upsert('node-2', {
    objectUrl: 'blob:node-2-runtime',
    objectUrlOwner: 'external',
    width: 160,
    height: 120,
    mimeType: 'image/webp',
    status: 'ready',
  });
  const runtimeThumbnailSnapshot = buildCanvasImageResourceSnapshot({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 4,
  });

  assert.equal(
    runtimeThumbnailSnapshot.resourceCandidates[0]?.resourceSignature,
    firstSnapshot.resourceCandidates[0]?.resourceSignature,
  );
  assert.equal(
    runtimeThumbnailSnapshot.resourceCandidates[1]?.resourceSignature === firstSnapshot.resourceCandidates[1]?.resourceSignature,
    false,
  );
  imageThumbnailRuntimeStore.clearAll();
});

test('CanvasImageResourceController skips scheduler updates for unchanged resource candidates', () => {
  const frames = createManualFrameScheduler();
  const nodes = [createImageNode('node-1')];
  let registeredBatchCount = 0;
  const controller = createCanvasImageResourceController({
    registerNodes: (batch) => {
      registeredBatchCount += 1;
      return batch.map((node) => node.id);
    },
    requestNode: () => undefined,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

  controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
  });
  controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 2,
  });
  frames.flushOne();

  assert.equal(registeredBatchCount, 1);
  assert.equal(frames.flushOne(), false);
  controller.dispose();
});

test('CanvasImageResourceController does not request near or offscreen passive importing resources', async () => {
  imageThumbnailRuntimeStore.clearAll();
  const frames = createManualFrameScheduler();
  const nodes = [
    createImageNode('near-importing', { status: 'processing' }),
    createImageNode('offscreen-importing', { status: 'processing' }),
  ];
  imageThumbnailRuntimeStore.upsert('near-importing', {
    objectUrl: 'blob:near-ready-thumb',
    objectUrlOwner: 'external',
    status: 'ready',
  });
  imageThumbnailRuntimeStore.upsert('offscreen-importing', {
    objectUrl: 'blob:offscreen-ready-thumb',
    objectUrlOwner: 'external',
    status: 'ready',
  });
  const visibleNodes: VisibleNodeMap = new Map([
    ['near-importing', createVisibility({
      isVisible: false,
      isNearViewport: true,
      visibilityBucket: 'near',
      isImporting: true,
      renderTier: 'minimal',
    })],
    ['offscreen-importing', createVisibility({
      isVisible: false,
      isNearViewport: false,
      visibilityBucket: 'offscreen',
      isImporting: true,
      renderTier: 'minimal',
    })],
  ]);
  const registeredBatches: string[][] = [];
  const controller = createCanvasImageResourceController({
    registerNodes: (batch) => {
      const ids = batch.map((node) => node.id);
      registeredBatches.push(ids);
      return ids;
    },
    requestNode: () => undefined,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

  const snapshot = controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes,
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
  });

  assert.deepEqual(snapshot.resourceCandidates, []);
  assert.equal(frames.flushOne(), false);
  assert.deepEqual(registeredBatches, []);
  controller.dispose();
  imageThumbnailRuntimeStore.clearAll();
});

test('CanvasImageResourceController uses rendered render-plan node data for resource ownership', () => {
  const sourceNode = createImageNode('planned-raster', { imageResourceOwner: 'dom' });
  const renderedNode = {
    ...sourceNode,
    data: {
      ...sourceNode.data,
      renderTier: 'compact' as const,
      imageResourceOwner: 'raster' as const,
    },
  };

  const snapshot = buildCanvasImageResourceSnapshot({
    renderPlan: {
      rasterEligibleImageNodes: [sourceNode],
      renderedNodes: [renderedNode],
    },
    visibleNodes: createVisibleMap([sourceNode]),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
  });

  assert.deepEqual(snapshot.resourceCandidates.map((candidate) => candidate.node.id), ['planned-raster']);
  assert.equal(snapshot.resourceCandidates[0]?.node.data.imageResourceOwner, 'raster');
});

test('CanvasImageResourceController cancels queued work but keeps in-flight work when candidates leave', async () => {
  const frames = createManualFrameScheduler();
  const nodes = [
    createImageNode('node-1'),
    createImageNode('node-2'),
  ];
  const cancelledNodeIds: string[] = [];
  let resolveRequest: (() => void) | undefined;
  const controller = createCanvasImageResourceController({
    registerNodes: (batch) => batch.map((node) => node.id),
    requestNode: () => new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }),
    cancelNodeRequest: (nodeId) => {
      cancelledNodeIds.push(nodeId);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 1,
    passiveMaxConcurrentRequests: 1,
  });

  controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
  });
  frames.flushOne();
  controller.update({
    renderPlan: { rasterEligibleImageNodes: [], renderedNodes: [] },
    visibleNodes: new Map(),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
  });

  assert.deepEqual(cancelledNodeIds.sort(), ['node-2']);
  resolveRequest?.();
  await Promise.resolve();
  await Promise.resolve();
  controller.dispose();
});

test('buildCanvasImageResourceSnapshot suppresses resource candidates while requests are deferred', () => {
  const nodes = [createImageNode('node-1')];
  const snapshot = buildCanvasImageResourceSnapshot({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
    deferResourceRequests: true,
  });

  assert.equal(snapshot.items.length, 1);
  assert.deepEqual(snapshot.resourceCandidates, []);
});

test('CanvasImageResourceController commits ready raster snapshots to ready store after request batch settles', async () => {
  imageManager.clearAll();
  const frames = createManualFrameScheduler();
  const readyStore = createCanvasRasterReadyStore();
  const nodes = [createImageNode('node-1')];
  const controller = createCanvasImageResourceController({
    readyStore,
    registerNodes: (batch) => {
      batch.forEach((node) => {
        imageManager.register({
          nodeId: node.id,
          mode: 'canvas',
          resolvedAsset: {
            asset: node.data.imageAsset!,
            thumbnail: {
              kind: 'thumbnail',
              url: node.data.thumbnailUrl!,
              fromLegacy: false,
            },
            preferred: {
              kind: 'thumbnail',
              url: node.data.thumbnailUrl!,
              fromLegacy: false,
            },
          },
          preferredUrl: node.data.thumbnailUrl,
        });
      });
      return batch.map((node) => node.id);
    },
    requestNode: (nodeId) => {
      const state = imageManager.getState(nodeId, 'canvas');
      const managerInternals = imageManager as unknown as {
        states: Map<string, typeof state>;
      };
      managerInternals.states.set(`${nodeId}:canvas`, {
        ...state,
        src: state.requestUrl ?? state.src,
        status: 'ready' as const,
        decodedResource: createLoadedResource(`blob:decoded-${nodeId}`),
        requestKey: undefined,
      });
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 1,
    passiveMaxConcurrentRequests: 1,
  });

  controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
  });

  assert.deepEqual(readyStore.getSnapshot().items, []);
  assert.equal(frames.flushOne(), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(readyStore.getSnapshot().items.length, 0);
  assert.equal(frames.flushOne(), true);

  const snapshot = readyStore.getSnapshot();
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.items.map((item) => item.nodeId), ['node-1']);
  assert.equal(snapshot.items[0]?.status, 'ready');
  assert.equal(snapshot.items[0]?.src, 'blob:decoded-node-1');
  controller.dispose();
  imageManager.clearAll();
});

test('CanvasImageResourceController batches multiple ready request settlements into one ready store commit', async () => {
  imageManager.clearAll();
  const frames = createManualFrameScheduler();
  const readyStore = createCanvasRasterReadyStore();
  const nodes = [
    createImageNode('node-1'),
    createImageNode('node-2'),
  ];
  let emitCount = 0;
  readyStore.subscribe(() => {
    emitCount += 1;
  });
  const controller = createCanvasImageResourceController({
    readyStore,
    registerNodes: (batch) => {
      batch.forEach((node) => {
        imageManager.register({
          nodeId: node.id,
          mode: 'canvas',
          resolvedAsset: {
            asset: node.data.imageAsset!,
            thumbnail: {
              kind: 'thumbnail',
              url: node.data.thumbnailUrl!,
              fromLegacy: false,
            },
            preferred: {
              kind: 'thumbnail',
              url: node.data.thumbnailUrl!,
              fromLegacy: false,
            },
          },
          preferredUrl: node.data.thumbnailUrl,
        });
      });
      return batch.map((node) => node.id);
    },
    requestNode: (nodeId) => {
      const state = imageManager.getState(nodeId, 'canvas');
      const managerInternals = imageManager as unknown as {
        states: Map<string, typeof state>;
      };
      managerInternals.states.set(`${nodeId}:canvas`, {
        ...state,
        src: state.requestUrl ?? state.src,
        status: 'ready' as const,
        decodedResource: createLoadedResource(`blob:decoded-${nodeId}`),
        requestKey: undefined,
      });
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 2,
    passiveMaxConcurrentRequests: 2,
  });

  controller.update({
    renderPlan: { rasterEligibleImageNodes: nodes, renderedNodes: nodes },
    visibleNodes: createVisibleMap(nodes),
    activeImageNodeIdSet: new Set(),
    runtimeRegistrationRevision: 1,
  });
  assert.equal(frames.flushOne(), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(frames.flushOne(), true);

  assert.equal(emitCount, 1);
  assert.deepEqual(readyStore.getSnapshot().items.map((item) => item.nodeId), ['node-1', 'node-2']);
  controller.dispose();
  imageManager.clearAll();
});

test('CanvasImageResourceController cancels queued resource work without clearing ready snapshot', () => {
  const readyStore = createCanvasRasterReadyStore();
  const controller = createCanvasImageResourceController({
    readyStore,
    registerNodes: () => [],
    requestNode: () => undefined,
  });

  readyStore.replace([{
    nodeId: 'ready-node',
    fileName: 'ready-node.png',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    status: 'ready',
    src: 'blob:ready-node',
  }]);

  controller.cancelAll();

  assert.deepEqual(readyStore.getSnapshot().items.map((item) => item.nodeId), ['ready-node']);
  controller.dispose();
});
