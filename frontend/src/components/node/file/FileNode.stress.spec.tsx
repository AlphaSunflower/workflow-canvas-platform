import test from 'node:test';
import assert from 'node:assert/strict';

import { ImageManager } from '@/services/image/image-manager';
import type { LoadedImageResource } from '@/services/image/image-loader';
import { selectCanvasImageVariant } from '@/services/image/image-asset';
import { buildRemoteImageAsset } from '@/services/image/image-node';
import {
  computeVisibleNodes,
  computeVisibleNodesSerialized,
  serializeVisibleNodesInput,
  type ComputeVisibleNodesOptions,
} from '@/hooks/canvas/useVisibleNodes';
import {
  computeVisibleNodesWithWorker,
  resetVisibilityWorkerClientForTests,
} from '@/hooks/canvas/visibility-worker-client';
import {
  getCanvasImageFlickerDebugSnapshot,
  recordCanvasFileNodeCommit,
  recordCanvasImageSessionSnapshot,
  resetCanvasImagePerformanceSnapshot,
} from '@/utils/performance/canvas-image-performance';
import { createCanvasNodeSpatialIndex } from '@/components/canvas/canvas-node-spatial-index';
import { hitTestCanvasNode } from '@/components/canvas/canvas-hit-test';
import { buildCanvasImageRasterItems } from '@/components/canvas/canvas-image-raster-draw';
import {
  clearCanvasActiveNodeStateSnapshot,
  syncCanvasActiveNodeStateSnapshot,
} from '@/components/canvas/canvas-active-node-state';
import {
  clearCanvasRuntimeVisualStateSnapshot,
  syncCanvasRuntimeVisualStateSnapshot,
} from '@/components/canvas/canvas-runtime-visual-state';
import { resolveCanvasNodeDomWindowing } from '@/components/canvas/canvas-node-dom-windowing';
import { resolveImageNodeProxyRouting } from './file-node-proxy.shared';
import { areImageNodePropsEqual } from './file-node-equality';
import { FILE_NODE_ACTION_LAYER_DELAY_MS } from './constants';

function createCanvasAsset(seed: string) {
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
    original: undefined,
  };
}

function createRemoteCanvasAsset(seed: string) {
  const fileId = `remote-stress-${seed}`;
  const remoteImage = buildRemoteImageAsset(fileId, {
    width: 3200,
    height: 2000,
  }, {
    thumbnailUrl: `/api/v1/files/${fileId}/thumbnail`,
    originalUrl: `/api/v1/files/${fileId}/download`,
    thumbnailSize: {
      width: 320,
      height: 200,
    },
  });

  return {
    asset: remoteImage.imageAsset,
    thumbnail: {
      kind: 'thumbnail' as const,
      url: remoteImage.thumbnailUrl,
      fromLegacy: false,
      asset: remoteImage.imageAsset.variants.thumbnail,
    },
    original: {
      kind: 'original' as const,
      url: remoteImage.imageAsset.variants.original?.url ?? '',
      fromLegacy: false,
      asset: remoteImage.imageAsset.variants.original,
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

async function flushMicrotasks(iterations = 6): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

function createWorkerVisibilityOptions(): ComputeVisibleNodesOptions {
  return {
    nodes: Array.from({ length: 18 }, (_, index) => ({
      id: `worker-node-${index + 1}`,
      position: {
        x: (index % 6) * 280,
        y: Math.floor(index / 6) * 220,
      },
      width: 240,
      height: 150,
      selected: index % 5 === 0,
      data: {
        dimensions: {
          width: 240,
          height: 150,
        },
      },
    })) as ComputeVisibleNodesOptions['nodes'],
    viewport: { x: -120, y: -80, zoom: 1.1 },
    containerSize: { width: 1440, height: 900 },
    recentlyInteractedNodeIds: ['worker-node-2', 'worker-node-7', 'worker-node-11'],
    importingNodeIds: ['worker-node-3', 'worker-node-4', 'worker-node-8', 'worker-node-14'],
  };
}

function createMockVisibilityWorker(): Worker {
  let messageHandler: ((event: MessageEvent) => void) | null = null;
  let errorHandler: ((event: Event) => void) | null = null;

  return {
    addEventListener(type: string, listener: EventListener): void {
      if (type === 'message') {
        messageHandler = listener as (event: MessageEvent) => void;
      }
      if (type === 'error') {
        errorHandler = listener as (event: Event) => void;
      }
    },
    postMessage(message: { id: string; payload: ReturnType<typeof serializeVisibleNodesInput> }): void {
      const result = computeVisibleNodesSerialized(message.payload);
      queueMicrotask(() => {
        messageHandler?.({
          data: {
            id: message.id,
            success: true,
            result,
          },
        } as MessageEvent);
      });
    },
    terminate(): void {
      messageHandler = null;
      errorHandler = null;
    },
    dispatchEvent(): boolean {
      errorHandler?.({ type: 'error' } as Event);
      return true;
    },
    onerror: null,
    onmessage: null,
    onmessageerror: null,
    removeEventListener(): void {
      return;
    },
  } as unknown as Worker;
}

async function runStressScenario(options: {
  enableVisibilityScoring: boolean;
  enableCanvasDisplayUrlLoading: boolean;
}): Promise<{
  totalLoads: number;
  thumbnailLoads: number;
  decodedReleaseCount: number;
  thumbnailEntryCount: number;
  originalEntryCount: number;
  features: {
    canvasDisplayUrlLoading: boolean;
    visibilityScoring: boolean;
  };
}> {
  let now = 50_000;
  const attempts: string[] = [];
  const manager = new ImageManager({
    now: () => now,
    enableVisibilityScoring: options.enableVisibilityScoring,
    enableCanvasDisplayUrlLoading: options.enableCanvasDisplayUrlLoading,
    loadImageResource: async (url, strategy) => {
      attempts.push(`${strategy ?? 'decode'}:${url}`);
      return createLoadedResource(
        url,
        url.includes('/download') ? 2048 : 512,
        url.includes('/download') ? 1280 : 320,
      );
    },
  });

  const nodeIds = Array.from({ length: 12 }, (_, index) => `stress-node-${index + 1}`);

  for (const [index, nodeId] of nodeIds.entries()) {
    const asset = createCanvasAsset(`${index + 1}`);
    manager.register({
      nodeId,
      mode: 'canvas',
      resolvedAsset: asset,
      preferredUrl: asset.thumbnail.url,
    });
    manager.updateVisibility(nodeId, {
      isVisible: true,
      isNearViewport: true,
      displayWidth: 760 + index * 12,
      displayHeight: 480 + index * 8,
      centerDistance: index * 36,
      visibleAreaRatio: Math.max(0.18, 0.92 - index * 0.06),
      viewportZoom: 0.82,
      visibilityScore: Math.max(0.2, 0.9 - index * 0.055),
      isRecentlyInteracted: index < 2,
    });
    await manager.request(nodeId, 'canvas');
  }

  const zoomFrames = [820, 930, 1080, 1180, 1040, 960, 1120, 1210];
  for (const [frameIndex, displayWidth] of zoomFrames.entries()) {
    now += 16;

    for (const [nodeIndex, nodeId] of nodeIds.entries()) {
      const asset = createCanvasAsset(`${nodeIndex + 1}`);
      const currentState = manager.getState(nodeId, 'canvas');
      const displayHeight = Math.round(displayWidth * 0.625);
      const visibleAreaRatio = Math.max(0, Math.min(1, 0.92 - nodeIndex * 0.07 - (frameIndex % 3) * 0.08));
      const visibilityScore = Math.max(0.08, Math.min(0.98, 0.88 - nodeIndex * 0.05 + (frameIndex % 2 === 0 ? 0.06 : -0.04)));

      manager.updateVisibility(nodeId, {
        isVisible: nodeIndex < 8 || frameIndex % 2 === 0,
        isNearViewport: nodeIndex < 10,
        displayWidth,
        displayHeight,
        centerDistance: nodeIndex * 40 + frameIndex * 18,
        visibleAreaRatio,
        viewportZoom: 0.8 + frameIndex * 0.08,
        visibilityScore,
        isRecentlyInteracted: nodeIndex === frameIndex % nodeIds.length,
      });
      manager.register({
        nodeId,
        mode: 'canvas',
        resolvedAsset: asset,
        preferredUrl: selectCanvasImageVariant(asset, {
          width: displayWidth,
          height: displayHeight,
        }, {
          currentVariantKind: currentState.activeVariantKind,
        }).preferred?.url,
      });
      void manager.request(nodeId, 'canvas');
    }

    await flushMicrotasks();
  }

  await flushMicrotasks(12);

  const snapshot = manager.getDebugSnapshot();
  return {
    totalLoads: attempts.length,
    thumbnailLoads: attempts.filter((item) => item.includes(':blob:thumb-')).length,
    decodedReleaseCount: snapshot.cache.stats.decodedReleaseCount,
    thumbnailEntryCount: snapshot.cache.stats.thumbnailEntryCount,
    originalEntryCount: snapshot.cache.stats.originalEntryCount,
    features: snapshot.features,
  };
}

test('stress baseline compares thumbnail-only canvas behavior across feature flags', async () => {
  const baseline = await runStressScenario({
    enableVisibilityScoring: false,
    enableCanvasDisplayUrlLoading: false,
  });
  const enhanced = await runStressScenario({
    enableVisibilityScoring: true,
    enableCanvasDisplayUrlLoading: true,
  });

  assert.deepEqual(baseline.features, {
    canvasDisplayUrlLoading: false,
    canvasResourcePolicy: 'thumbnail-only',
    visibilityScoring: false,
  });
  assert.deepEqual(enhanced.features, {
    canvasDisplayUrlLoading: true,
    canvasResourcePolicy: 'thumbnail-only',
    visibilityScoring: true,
  });
  assert.ok(enhanced.totalLoads <= baseline.totalLoads);
  assert.ok(enhanced.thumbnailLoads <= baseline.thumbnailLoads);
  assert.equal(enhanced.originalEntryCount, 0);
});

test('stress scenario keeps thumbnail load pressure bounded after import-like warmup', async () => {
  const enhanced = await runStressScenario({
    enableVisibilityScoring: true,
    enableCanvasDisplayUrlLoading: true,
  });

  assert.ok(enhanced.totalLoads <= 96);
  assert.ok(enhanced.thumbnailLoads <= 40);
  assert.ok(enhanced.thumbnailEntryCount <= 12);
  assert.equal(enhanced.originalEntryCount, 0);
});

test('canvas performance snapshot tracks thumbnail cache without preview counters', () => {
  resetCanvasImagePerformanceSnapshot();
  recordCanvasImageSessionSnapshot({
    nodeCount: 12,
    imageNodeCount: 12,
    visibleNodeCount: 8,
    nearViewportNodeCount: 10,
    selectedNodeCount: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1440, height: 900 },
    workflowId: 'stress-workflow',
  });
  recordCanvasFileNodeCommit({
    nodeId: 'stress-node-1',
    nodeType: 'image',
    fileName: 'stress-1.png',
    selected: false,
    dragging: false,
    status: 'idle',
    placeholder: 'ready',
    activeVariantKind: 'thumbnail',
    resourceStatus: 'ready',
    resourcePhase: 'thumbnail-ready',
    src: 'blob:thumb-1',
    isVisible: true,
    isNearViewport: true,
    displayWidth: 320,
    displayHeight: 200,
  });

  const flickerSnapshot = getCanvasImageFlickerDebugSnapshot({
    cache: {
      stats: {
        entryCount: 12,
        resourceEntryCount: 12,
        objectUrlEntryCount: 0,
        canvasResourceEntryCount: 12,
        originalEntryCount: 0,
        visibleEntryCount: 8,
        nearViewportEntryCount: 10,
        thumbnailEntryCount: 12,
        evictionCount: 0,
        revocationCount: 0,
        decodedReleaseCount: 0,
      },
      budget: {
        thumbnailEntryLimit: 24,
        originalEntryLimit: 8,
        resourceEntryLimit: 48,
      },
      inflightRequestCount: 0,
      subscriptionCount: 0,
      canvasSubscriptionCount: 0,
      originalSubscriptionCount: 0,
    },
    states: [],
    subscriptions: {
      total: 0,
      canvas: 0,
      original: 0,
      nodes: 0,
      canvasSubscribeCalls: 0,
      originalSubscribeCalls: 0,
      unsubscribeCalls: 0,
    },
    features: {
      visibilityScoring: true,
      canvasDisplayUrlLoading: true,
      canvasResourcePolicy: 'thumbnail-only',
    },
  } as never);

  assert.equal(flickerSnapshot.cache?.thumbnailEntryCount, 12);
  assert.equal(flickerSnapshot.cache?.originalEntryCount, 0);
  assert.equal(typeof flickerSnapshot.cache?.thumbnailEntryCount, 'number');
  assert.equal(typeof flickerSnapshot.cache?.originalEntryCount, 'number');
});

test('visibility worker and serialized path stay aligned during import-aware windowing', async () => {
  const options = createWorkerVisibilityOptions();
  const serialized = serializeVisibleNodesInput(options);
  const direct = computeVisibleNodes(options);
  const serializedResult = computeVisibleNodesSerialized(serialized);

  const originalWorker = globalThis.Worker;
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: function MockWorker(): Worker {
      return createMockVisibilityWorker();
    },
  });

  try {
    const workerResult = await computeVisibleNodesWithWorker(options);

    assert.equal(serializedResult.length, direct.size);
    assert.equal(workerResult.size, direct.size);
    assert.deepEqual(
      serializedResult.map((entry) => [entry.nodeId, entry.visibility.renderTier]),
      Array.from(direct.entries()).map(([id, value]) => [id, value.renderTier]),
    );
  } finally {
    Object.defineProperty(globalThis, 'Worker', {
      configurable: true,
      value: originalWorker,
    });
    resetVisibilityWorkerClientForTests();
  }
});

test('remote canvas assets keep thumbnail and original lanes separate under stress', () => {
  const asset = createRemoteCanvasAsset('1');
  assert.equal(asset.thumbnail.url.endsWith('/thumbnail'), true);
  assert.equal(asset.original.url.endsWith('/download'), true);
  assert.equal(asset.asset.variants.thumbnail?.url, asset.thumbnail.url);
  assert.equal(asset.asset.variants.original?.url, asset.original.url);
});

test('image node prop equality ignores runtime visual state churn', () => {
  const baseData = {
    id: { value: 'visual-node-1', display: '#00001' },
    type: 'image' as const,
    position: { x: 0, y: 0 },
    dimensions: { width: 240, height: 160 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle' as const,
    zIndex: 1,
    timestamp: { created: 1, updated: 1 },
    fileId: 'file-visual-1',
    fileName: 'visual.png',
    fileSize: 1024,
    mimeType: 'image/png',
    source: { type: 'imported', importMethod: 'local', importedAt: 1 },
    metadata: {},
  };
  const previous = {
    id: 'visual-node-1',
    type: 'image',
    selected: false,
    dragging: false,
    data: {
      ...baseData,
      renderTier: 'compact' as const,
      activeState: 'active' as const,
      activeReasons: ['selected', 'viewer'] as const,
    },
  };
  const next = {
    id: 'visual-node-1',
    type: 'image',
    selected: false,
    dragging: false,
    data: {
      ...baseData,
      renderTier: 'full' as const,
      activeState: undefined,
      activeReasons: undefined,
    },
  };

  assert.equal(areImageNodePropsEqual(previous as never, next as never), true);
});

test('structural rendering pipeline keeps visible nodes rasterized, far nodes proxied, and offscreen passive nodes detached', () => {
  clearCanvasActiveNodeStateSnapshot();
  clearCanvasRuntimeVisualStateSnapshot();

  const nodes = [
    {
      id: 'visible-passive',
      type: 'image',
      position: { x: 20, y: 20 },
      width: 240,
      height: 160,
      selected: false,
      zIndex: 1,
      data: {
        id: { value: 'visible-passive', display: '#00001' },
        type: 'image',
        position: { x: 20, y: 20 },
        dimensions: { width: 240, height: 160 },
        rotation: 0,
        scale: 1,
        locked: false,
        status: 'idle',
        zIndex: 1,
        timestamp: { created: 1, updated: 1 },
        fileId: 'file-visible',
        fileName: 'visible.png',
        fileSize: 1024,
        mimeType: 'image/png',
        source: { type: 'imported', importMethod: 'local', importedAt: 1 },
        metadata: {},
      },
    },
    {
      id: 'far-passive',
      type: 'image',
      position: { x: 1900, y: 240 },
      width: 240,
      height: 160,
      selected: false,
      zIndex: 2,
      data: {
        id: { value: 'far-passive', display: '#00002' },
        type: 'image',
        position: { x: 1900, y: 240 },
        dimensions: { width: 240, height: 160 },
        rotation: 0,
        scale: 1,
        locked: false,
        status: 'idle',
        zIndex: 2,
        timestamp: { created: 1, updated: 1 },
        fileId: 'file-far',
        fileName: 'far.png',
        fileSize: 1024,
        mimeType: 'image/png',
        source: { type: 'imported', importMethod: 'local', importedAt: 1 },
        metadata: {},
      },
    },
    {
      id: 'offscreen-passive',
      type: 'image',
      position: { x: 5800, y: 4200 },
      width: 240,
      height: 160,
      selected: false,
      zIndex: 3,
      data: {
        id: { value: 'offscreen-passive', display: '#00003' },
        type: 'image',
        position: { x: 5800, y: 4200 },
        dimensions: { width: 240, height: 160 },
        rotation: 0,
        scale: 1,
        locked: false,
        status: 'idle',
        zIndex: 3,
        timestamp: { created: 1, updated: 1 },
        fileId: 'file-offscreen',
        fileName: 'offscreen.png',
        fileSize: 1024,
        mimeType: 'image/png',
        source: { type: 'imported', importMethod: 'local', importedAt: 1 },
        metadata: {},
      },
    },
    {
      id: 'offscreen-active',
      type: 'image',
      position: { x: 6200, y: 4400 },
      width: 240,
      height: 160,
      selected: false,
      zIndex: 4,
      data: {
        id: { value: 'offscreen-active', display: '#00004' },
        type: 'image',
        position: { x: 6200, y: 4400 },
        dimensions: { width: 240, height: 160 },
        rotation: 0,
        scale: 1,
        locked: false,
        status: 'idle',
        zIndex: 4,
        timestamp: { created: 1, updated: 1 },
        fileId: 'file-offscreen-active',
        fileName: 'offscreen-active.png',
        fileSize: 1024,
        mimeType: 'image/png',
        source: { type: 'imported', importMethod: 'local', importedAt: 1 },
        metadata: {},
      },
    },
  ] as ComputeVisibleNodesOptions['nodes'];

  const visibleNodes = computeVisibleNodes({
    nodes,
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
    overscan: 240,
    recentlyInteractedNodeIds: [],
    importingNodeIds: [],
  });

  syncCanvasActiveNodeStateSnapshot([
    ['visible-passive', { activeState: 'passive', activeReasons: [] }],
    ['far-passive', { activeState: 'passive', activeReasons: [] }],
    ['offscreen-passive', { activeState: 'passive', activeReasons: [] }],
    ['offscreen-active', { activeState: 'active', activeReasons: ['selected'] }],
  ]);
  syncCanvasRuntimeVisualStateSnapshot([
    ['visible-passive', {
      scheduledRenderTier: visibleNodes.get('visible-passive')?.renderTier ?? 'full',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
    ['far-passive', {
      scheduledRenderTier: visibleNodes.get('far-passive')?.renderTier ?? 'compact',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
    ['offscreen-passive', {
      scheduledRenderTier: visibleNodes.get('offscreen-passive')?.renderTier ?? 'minimal',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
    ['offscreen-active', {
      scheduledRenderTier: visibleNodes.get('offscreen-active')?.renderTier ?? 'minimal',
      canvasState: { activeState: 'active', activeReasons: ['selected'] },
    }],
  ]);

  const rasterItems = buildCanvasImageRasterItems({
    nodes: nodes as never,
    visibleNodes,
    rasterEligibleNodeIds: new Set(['visible-passive']),
    getResourceState: () => ({
      status: 'ready',
      phase: 'thumbnail-ready',
      activeVariantKind: 'thumbnail',
      src: 'blob:thumb',
    }),
  });
  const domWindowing = resolveCanvasNodeDomWindowing({
    nodes: nodes as never,
    visibleNodes,
    edges: [
      { id: 'edge-offscreen-passive', source: 'offscreen-passive', target: 'visible-passive' },
      { id: 'edge-offscreen-active', source: 'offscreen-active', target: 'visible-passive' },
    ],
  });
  const proxyVisible = resolveImageNodeProxyRouting({
    nodeType: 'image',
    scheduledRenderTier: visibleNodes.get('visible-passive')?.renderTier ?? 'full',
    canvasActiveState: 'passive',
  });
  const proxyFar = resolveImageNodeProxyRouting({
    nodeType: 'image',
    scheduledRenderTier: visibleNodes.get('far-passive')?.renderTier ?? 'compact',
    canvasActiveState: 'passive',
  });
  const proxyOffscreenActive = resolveImageNodeProxyRouting({
    nodeType: 'image',
    scheduledRenderTier: visibleNodes.get('offscreen-active')?.renderTier ?? 'minimal',
    canvasActiveState: 'active',
  });

  assert.equal(visibleNodes.get('visible-passive')?.renderTier, 'full');
  assert.equal(visibleNodes.get('far-passive')?.renderTier, 'compact');
  assert.equal(visibleNodes.get('offscreen-passive')?.renderTier, 'minimal');
  assert.equal(visibleNodes.get('offscreen-active')?.renderTier, 'minimal');
  assert.deepEqual(rasterItems.map((item) => item.nodeId), ['visible-passive']);
  assert.equal(proxyVisible.useProxy, false);
  assert.equal(proxyFar.useProxy, true);
  assert.equal(proxyFar.renderTier, 'compact');
  assert.equal(proxyOffscreenActive.useProxy, false);
  assert.equal(domWindowing.placeholderNodeIds.has('offscreen-passive'), true);
  assert.equal(domWindowing.placeholderNodeIds.has('offscreen-active'), false);
  assert.equal(domWindowing.hiddenEdgeIds.has('edge-offscreen-passive'), true);
  assert.equal(domWindowing.hiddenEdgeIds.has('edge-offscreen-active'), false);

  clearCanvasActiveNodeStateSnapshot();
  clearCanvasRuntimeVisualStateSnapshot();
});

test('spatial index hit testing remains stable for compact image nodes', () => {
  const nodes = [
    {
      id: 'hit-node-1',
      type: 'image',
      position: { x: 40, y: 60 },
      width: 240,
      height: 160,
      zIndex: 1,
      selected: false,
      data: {
        id: { value: 'hit-node-1', display: '#00901' },
        type: 'image',
        position: { x: 40, y: 60 },
        dimensions: {
          width: 240,
          height: 160,
        },
        rotation: 0,
        scale: 1,
        locked: false,
        status: 'idle',
        zIndex: 1,
        timestamp: { created: 1, updated: 1 },
        fileId: 'file-hit-1',
        fileName: 'hit-1.png',
        fileSize: 1024,
        mimeType: 'image/png',
        source: { type: 'imported', importMethod: 'local', importedAt: 1 },
        metadata: {},
      },
    },
    {
      id: 'hit-node-2',
      type: 'image',
      position: { x: 320, y: 60 },
      width: 240,
      height: 160,
      zIndex: 2,
      selected: false,
      data: {
        id: { value: 'hit-node-2', display: '#00902' },
        type: 'image',
        position: { x: 320, y: 60 },
        dimensions: {
          width: 240,
          height: 160,
        },
        rotation: 0,
        scale: 1,
        locked: false,
        status: 'idle',
        zIndex: 2,
        timestamp: { created: 1, updated: 1 },
        fileId: 'file-hit-2',
        fileName: 'hit-2.png',
        fileSize: 1024,
        mimeType: 'image/png',
        source: { type: 'imported', importMethod: 'local', importedAt: 1 },
        metadata: {},
      },
    },
  ];

  const index = createCanvasNodeSpatialIndex();
  index.rebuild(nodes as never);

  assert.equal(hitTestCanvasNode({
    clientPosition: { x: 80, y: 100 },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: nodes as never,
    spatialIndex: index,
  })?.node.id, 'hit-node-1');
  assert.equal(hitTestCanvasNode({
    clientPosition: { x: 360, y: 100 },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: nodes as never,
    spatialIndex: index,
  })?.node.id, 'hit-node-2');
  assert.equal(hitTestCanvasNode({
    clientPosition: { x: 10, y: 10 },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: nodes as never,
    spatialIndex: index,
  }), null);
});

test('action layer mount delay constant remains a small frame-budgeted threshold', () => {
  assert.equal(FILE_NODE_ACTION_LAYER_DELAY_MS > 0, true);
  assert.equal(FILE_NODE_ACTION_LAYER_DELAY_MS <= 64, true);
});
