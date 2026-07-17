import test from 'node:test';
import assert from 'node:assert/strict';

import { ImageManager } from './image-manager';
import type { LoadedImageResource } from './image-loader';
import { buildRemoteImageAsset } from './image-node';
import { resolveFileNodeImageAsset, selectCanvasImageVariant } from './image-asset';
import {
  getCanvasImageFlickerDebugSnapshot,
  recordCanvasFileNodeCommit,
  resetCanvasImagePerformanceSnapshot,
} from '../../utils/performance/canvas-image-performance';
import type { FileNodeData } from '../../types';

function createLoadedResource(src: string): LoadedImageResource {
  const isPreview = false;
  return {
    src,
    width: isPreview ? 1600 : 320,
    height: isPreview ? 1000 : 200,
    decoded: 'image',
    estimatedBytes: (isPreview ? 1600 * 1000 : 320 * 200) * 4,
  };
}

function createRemoteImageNode(fileId: string): FileNodeData {
  const remote = buildRemoteImageAsset(fileId, {
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
    id: {
      value: `node-${fileId}`,
      display: '#00001',
    },
    type: 'image',
    position: {
      x: 0,
      y: 0,
    },
    dimensions: {
      width: 240,
      height: 150,
    },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 1,
    timestamp: {
      created: 1,
      updated: 1,
    },
    fileId,
    backendFileId: fileId,
    fileName: `${fileId}.jpg`,
    fileSize: 1024,
    mimeType: 'image/jpeg',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: 1,
    },
    metadata: {
      width: 3200,
      height: 2000,
    },
    thumbnailUrl: remote.thumbnailUrl,
    imageAsset: remote.imageAsset,
  };
}

function recordCurrentState(node: FileNodeData, manager: ImageManager): void {
  const state = manager.getState(node.id.value, 'canvas');
  recordCanvasFileNodeCommit({
    nodeId: node.id.value,
    nodeType: 'image',
    fileName: node.fileName,
    selected: false,
    dragging: false,
    status: node.status,
    placeholder: 'ready',
    activeVariantKind: state.activeVariantKind,
    resourceStatus: state.status,
    resourcePhase: state.phase,
    requestKey: state.requestKey,
    requestEventKind: state.lastEventKind,
    requestEventClassification: state.lastEventClassification,
    requestEventReason: state.lastEventReason,
    requestSwitchReason: state.lastSwitchReason,
    attemptedUrl: state.lastAttemptedUrl,
    src: state.src,
    isVisible: true,
    isNearViewport: true,
    displayWidth: state.visibility.displayWidth,
    displayHeight: state.visibility.displayHeight,
  });
}

test('stable remote thumbnail registrations do not create request-key or release loops', async () => {
  resetCanvasImagePerformanceSnapshot();

  const attempts: string[] = [];
  const manager = new ImageManager({
    now: () => 100_000,
    loadImageResource: async (url) => {
      attempts.push(url);
      return createLoadedResource(url);
    },
  });
  const node = createRemoteImageNode('file-stable-thumbnail');
  const resolved = resolveFileNodeImageAsset(node);
  const displaySize = {
    width: 240,
    height: 150,
  };

  for (let pass = 0; pass < 8; pass += 1) {
    const state = manager.getState(node.id.value, 'canvas');
    manager.register({
      nodeId: node.id.value,
      mode: 'canvas',
      resolvedAsset: {
        ...resolved,
        asset: {
          ...resolved.asset,
          variants: {
            ...resolved.asset.variants,
          },
        },
      },
      preferredUrl: selectCanvasImageVariant(resolved, displaySize, {
        currentVariantKind: state.activeVariantKind,
      }).preferred?.url,
    });
    manager.updateVisibility(node.id.value, {
      isVisible: true,
      isNearViewport: true,
      displayWidth: displaySize.width,
      displayHeight: displaySize.height,
      centerDistance: 24,
      visibleAreaRatio: 0.9,
      viewportZoom: 1,
      visibilityScore: 0.92,
    });
    const requestPromise = manager.request(node.id.value, 'canvas');
    recordCurrentState(node, manager);
    await requestPromise;
    recordCurrentState(node, manager);
  }

  const state = manager.getState(node.id.value, 'canvas');
  const snapshot = getCanvasImageFlickerDebugSnapshot(manager.getDebugSnapshot());

  assert.deepEqual(attempts, ['/api/v1/files/file-stable-thumbnail/thumbnail']);
  assert.equal(state.phase, 'thumbnail-ready');
  assert.equal(state.activeVariantKind, 'thumbnail');
  assert.equal(snapshot.suspectedLoops.length, 0);
  assert.equal(snapshot.nodeLifecycleStats[0]?.releaseCount ?? 0, 0);
  assert.equal(snapshot.nodeLifecycleStats[0]?.requestStartedCount ?? 0, 1);

  resetCanvasImagePerformanceSnapshot();
});

test('remote canvas variant selection stays on thumbnail across display changes', async () => {
  const attempts: string[] = [];
  const manager = new ImageManager({
    now: () => 110_000,
    loadImageResource: async (url) => {
      attempts.push(url);
      return createLoadedResource(url);
    },
  });
  const node = createRemoteImageNode('file-hysteresis');
  const resolved = resolveFileNodeImageAsset(node);
  const displayWidths = [
    820, 930, 1010, 1080, 1099, 1100, 1060, 980, 870, 839, 860, 1040,
  ];

  for (const displayWidth of displayWidths) {
    const state = manager.getState(node.id.value, 'canvas');
    const displayHeight = Math.round(displayWidth * 0.625);
    manager.updateVisibility(node.id.value, {
      isVisible: true,
      isNearViewport: true,
      displayWidth,
      displayHeight,
      centerDistance: 32,
      visibleAreaRatio: 0.9,
      viewportZoom: 1,
      visibilityScore: 0.9,
    });
    manager.register({
      nodeId: node.id.value,
      mode: 'canvas',
      resolvedAsset: resolved,
      preferredUrl: selectCanvasImageVariant(resolved, {
        width: displayWidth,
        height: displayHeight,
      }, {
        currentVariantKind: state.activeVariantKind,
      }).preferred?.url,
    });
    await manager.request(node.id.value, 'canvas');
  }

  const thumbnailLoads = attempts.filter((url) => url.endsWith('/thumbnail'));

  assert.equal(thumbnailLoads.length, 1);
  assert.equal(attempts.length, 1);
  assert.equal(manager.getState(node.id.value, 'canvas').phase, 'thumbnail-ready');
});

test('recently accessed thumbnail does not emit release loop during short offscreen budget pressure', async () => {
  resetCanvasImagePerformanceSnapshot();

  let now = 210_000;
  const attempts: string[] = [];
  const manager = new ImageManager({
    now: () => now,
    loadImageResource: async (url) => {
      attempts.push(url);
      return createLoadedResource(url);
    },
  });
  const node = createRemoteImageNode('file-protected-offscreen');
  const resolved = resolveFileNodeImageAsset(node);

  manager.register({
    nodeId: node.id.value,
    mode: 'canvas',
    resolvedAsset: resolved,
    preferredUrl: resolved.thumbnail?.url,
  });
  manager.updateVisibility(node.id.value, {
    isVisible: true,
    isNearViewport: true,
    displayWidth: 240,
    displayHeight: 150,
    centerDistance: 24,
    visibleAreaRatio: 0.9,
    viewportZoom: 1,
    visibilityScore: 0.92,
  });
  await manager.request(node.id.value, 'canvas');
  recordCurrentState(node, manager);

  manager.updateVisibility(node.id.value, {
    isVisible: false,
    isNearViewport: false,
    displayWidth: 0,
    displayHeight: 0,
    centerDistance: 2200,
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
  recordCurrentState(node, manager);

  const state = manager.getState(node.id.value, 'canvas');
  const snapshot = getCanvasImageFlickerDebugSnapshot(manager.getDebugSnapshot());

  assert.equal(attempts.length, 1);
  assert.equal(state.lastEventKind === 'release', false);
  assert.equal(state.lastEventKind === 'request-started', false);
  assert.equal(snapshot.suspectedLoops.length, 0);
  assert.equal(snapshot.nodeLifecycleStats[0]?.releaseCount ?? 0, 0);

  resetCanvasImagePerformanceSnapshot();
});
