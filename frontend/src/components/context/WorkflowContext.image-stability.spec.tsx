import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData, Workflow } from '@/types';
import { hydrateWorkflowFromApiDetail } from '@/services/workflow-file-normalizer';
import { ImageManager } from '@/services/image/image-manager';
import type { LoadedImageResource } from '@/services/image/image-loader';
import { resolveFileNodeImageAsset, selectCanvasImageVariant } from '@/services/image/image-asset';
import {
  getCanvasImageFlickerDebugSnapshot,
  recordCanvasFileNodeCommit,
  recordCanvasImageSessionSnapshot,
  resetCanvasImagePerformanceSnapshot,
} from '@/utils/performance/canvas-image-performance';

function createLoadedResource(src: string): LoadedImageResource {
  return {
    src,
    width: src.includes('/download') ? 1600 : 320,
    height: src.includes('/download') ? 1000 : 200,
    decoded: 'image',
    estimatedBytes: (src.includes('/download') ? 1600 * 1000 : 320 * 200) * 4,
  };
}

function createPersistedRemoteImageNode(index: number): FileNodeData {
  const nodeId = `remote-node-${index + 1}`;
  const fileId = `remote-file-${index + 1}`;
  const now = 1_775_900_000_000 + index;

  return {
    id: {
      value: nodeId,
      display: `#${String(index + 1).padStart(5, '0')}`,
    },
    type: 'image',
    position: {
      x: (index % 11) * 320,
      y: Math.floor(index / 11) * 220,
    },
    dimensions: {
      width: 240,
      height: 150,
    },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: index,
    timestamp: {
      created: now,
      updated: now,
    },
    fileId,
    backendFileId: fileId,
    fileName: `remote-${index + 1}.jpg`,
    fileSize: 1_024_000,
    mimeType: 'image/jpeg',
    source: {
      type: 'imported',
      importMethod: 'local',
      importedAt: now,
    },
    metadata: {
      width: 3200,
      height: 2000,
    },
  };
}

function createPersistedWorkflowDetail(nodeCount = 55): Parameters<typeof hydrateWorkflowFromApiDetail>[0] {
  const nodes = Object.fromEntries(
    Array.from({ length: nodeCount }, (_, index) => {
      const node = createPersistedRemoteImageNode(index);
      return [node.id.value, node];
    }),
  );

  return {
    workflowId: 'workflow-image-stability',
    ownerUserId: 'user-image-stability',
    groupId: null,
    containerKey: '__ungrouped__',
    isAutoNamed: false,
    createdAt: new Date(1_775_900_000_000).toISOString(),
    updatedAt: new Date(1_775_900_100_000).toISOString(),
    workflow: {
      id: 'workflow-image-stability',
      projectId: 'project-image-stability',
      name: '55 Remote Images',
      nodes,
      connections: [],
      viewport: {
        x: -480,
        y: -220,
        zoom: 1,
      },
      metadata: {
        nodeCount,
        connectionCount: 0,
        lastNodeId: nodeCount,
        canvasSize: {
          width: 4096,
          height: 4096,
        },
        relatedTasks: [],
        usedNodeIds: Array.from({ length: nodeCount }, (_, index) => index + 1),
        releasedNodeIds: [],
      },
      timestamp: 1_775_900_100_000,
      version: 3,
    },
  };
}

async function loadVisibleCanvasResources(
  workflow: Workflow,
  manager: ImageManager,
  displaySize: {
    width: number;
    height: number;
  },
): Promise<void> {
  const fileNodes = Object.values(workflow.nodes).filter((node): node is FileNodeData => node.type === 'image');

  for (const [index, node] of fileNodes.entries()) {
    const resolvedAsset = resolveFileNodeImageAsset(node);
    const preferred = selectCanvasImageVariant(resolvedAsset, displaySize).preferred;
    manager.register({
      nodeId: node.id.value,
      mode: 'canvas',
      resolvedAsset,
      preferredUrl: preferred?.url,
    });
    manager.updateVisibility(node.id.value, {
      isVisible: index < 12,
      isNearViewport: index < 20,
      displayWidth: displaySize.width,
      displayHeight: displaySize.height,
      centerDistance: index * 18,
      visibleAreaRatio: index < 12 ? 0.9 : 0.24,
      viewportZoom: 1,
      visibilityScore: index < 12 ? 0.92 : 0.58,
    });
    await manager.request(node.id.value, 'canvas');
  }
}

test('saved backend workflow reload hydrates 55 remote images into stable thumbnail canvas resources', async () => {
  resetCanvasImagePerformanceSnapshot();
  const attempts: string[] = [];
  const workflow = hydrateWorkflowFromApiDetail(createPersistedWorkflowDetail());
  const manager = new ImageManager({
    now: () => 90_000,
    loadImageResource: async (url) => {
      attempts.push(url);
      return createLoadedResource(url);
    },
  });
  const displaySize = {
    width: 240,
    height: 150,
  };

  await loadVisibleCanvasResources(workflow, manager, displaySize);
  const firstLoadCount = attempts.length;
  await loadVisibleCanvasResources(workflow, manager, displaySize);

  recordCanvasImageSessionSnapshot({
    nodeCount: Object.keys(workflow.nodes).length,
    imageNodeCount: Object.keys(workflow.nodes).length,
    visibleNodeCount: 12,
    nearViewportNodeCount: 20,
    selectedNodeCount: 0,
    viewport: workflow.viewport,
    containerSize: {
      width: 1600,
      height: 900,
    },
    workflowId: workflow.id,
  });

  Object.values(workflow.nodes).forEach((node, index) => {
    if (node.type !== 'image') {
      return;
    }

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
      isVisible: index < 12,
      isNearViewport: index < 20,
      displayWidth: displaySize.width,
      displayHeight: displaySize.height,
    });
  });

  const imageManagerSnapshot = manager.getDebugSnapshot();
  const flickerSnapshot = getCanvasImageFlickerDebugSnapshot(imageManagerSnapshot);
  const hydratedNodes = Object.values(workflow.nodes).filter((node): node is FileNodeData => node.type === 'image');

  assert.equal(hydratedNodes.length, 55);
  assert.equal(firstLoadCount, 20);
  assert.equal(attempts.length, 20);
  assert.equal(attempts.every((url) => url.endsWith('/thumbnail')), true);
  assert.equal(imageManagerSnapshot.cache.stats.thumbnailEntryCount, 20);
  assert.equal(imageManagerSnapshot.cache.stats.originalEntryCount, 0);
  assert.equal(imageManagerSnapshot.cache.stats.evictionCount, 0);
  assert.equal(imageManagerSnapshot.cache.stats.decodedReleaseCount, 0);
  assert.equal(flickerSnapshot.suspectedLoops.length, 0);
  assert.equal(flickerSnapshot.session?.workflowId, 'workflow-image-stability');
  assert.equal(
    hydratedNodes.every((node) => (
      node.thumbnailUrl === `/api/v1/files/${node.fileId}/thumbnail`
      && node.previewUrl === undefined
      && node.imageAsset?.variants.thumbnail?.url === node.thumbnailUrl
      && node.imageAsset?.variants.original?.url === `/api/v1/files/${node.fileId}/download`
    )),
    true,
  );

  resetCanvasImagePerformanceSnapshot();
});

test('reload after import-style persistence keeps remote thumbnail-first canvas behavior stable', async () => {
  const persistedWorkflow = hydrateWorkflowFromApiDetail(createPersistedWorkflowDetail(12));
  const manager = new ImageManager({
    now: () => 95_000,
    loadImageResource: async (url) => createLoadedResource(url),
  });
  const displaySize = {
    width: 240,
    height: 150,
  };

  await loadVisibleCanvasResources(persistedWorkflow, manager, displaySize);

  const imageNodes = Object.values(persistedWorkflow.nodes).filter((node): node is FileNodeData => node.type === 'image');
  const snapshot = manager.getDebugSnapshot();

  assert.equal(imageNodes.length, 12);
  assert.equal(
    imageNodes.every((node) => (
      node.thumbnailUrl === `/api/v1/files/${node.fileId}/thumbnail`
      && node.previewUrl === undefined
      && node.imageAsset?.variants.thumbnail?.url === node.thumbnailUrl
      && node.imageAsset?.variants.original?.url === `/api/v1/files/${node.fileId}/download`
    )),
    true,
  );
  assert.equal(snapshot.cache.stats.originalEntryCount, 0);
  assert.equal(snapshot.cache.stats.thumbnailEntryCount, 12);
  assert.equal(
    snapshot.states.every((state) => state.mode !== 'canvas' || state.phase === 'thumbnail-ready'),
    true,
  );
});

test('remote reload keeps original viewer resources dormant until viewer access is requested', async () => {
  const persistedWorkflow = hydrateWorkflowFromApiDetail(createPersistedWorkflowDetail(8));
  const attempts: string[] = [];
  const manager = new ImageManager({
    now: () => 96_000,
    loadImageResource: async (url) => {
      attempts.push(url);
      return createLoadedResource(url);
    },
  });

  await loadVisibleCanvasResources(persistedWorkflow, manager, {
    width: 240,
    height: 150,
  });

  const snapshot = manager.getDebugSnapshot();

  assert.equal(
    snapshot.states.some((state) => state.mode === 'original'),
    false,
  );
  assert.equal(snapshot.subscriptions.original, 0);
  assert.equal(snapshot.cache.stats.originalEntryCount, 0);
  assert.equal(attempts.some((url) => url.endsWith('/download')), false);

  const firstImageNode = Object.values(persistedWorkflow.nodes).find((node): node is FileNodeData => node.type === 'image');
  if (!firstImageNode) {
    throw new Error('Expected a persisted image node.');
  }

  const originalUrl = firstImageNode.imageAsset?.variants.original?.url;
  if (!originalUrl) {
    throw new Error('Expected a persisted original image url.');
  }

  manager.register({
    nodeId: firstImageNode.id.value,
    mode: 'original',
    resolvedAsset: resolveFileNodeImageAsset(firstImageNode),
    preferredUrl: originalUrl,
  });
  await manager.request(firstImageNode.id.value, 'original');

  const viewerState = manager.getState(firstImageNode.id.value, 'original');
  assert.equal(viewerState.phase, 'original-ready');
  assert.equal(viewerState.src, originalUrl);
  assert.equal(attempts.some((url) => url === originalUrl), true);
});
