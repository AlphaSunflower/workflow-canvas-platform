import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData } from '@/types';

import {
  buildCanvasImageLodPlan,
  resolveCanvasImageLodMode,
} from './canvas-image-lod';
import type { CanvasImageRasterItem } from './canvas-image-raster-draw';
import type { CanvasRasterImageNode } from './canvas-raster-image-resource-bridge';

function createImageNode(
  id: string,
  position: { x: number; y: number },
  overrides: Partial<FileNodeData> = {},
): CanvasRasterImageNode {
  const data: FileNodeData = {
    id: { value: id, display: `#${id}` },
    type: 'image',
    position,
    dimensions: { width: 100, height: 80 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: 1, updated: 1 },
    fileId: `file-${id}`,
    fileName: `${id}.png`,
    fileSize: 100,
    mimeType: 'image/png',
    source: { type: 'imported', importMethod: 'local', importedAt: 1 },
    metadata: {},
    imageResourceOwner: 'raster',
    ...overrides,
  };

  return {
    id,
    type: 'image',
    position,
    data,
    width: data.dimensions.width,
    height: data.dimensions.height,
    selected: false,
  } as CanvasRasterImageNode;
}

function createReadyItem(nodeId: string, src = `blob:${nodeId}`): CanvasImageRasterItem {
  return {
    nodeId,
    fileName: `${nodeId}.png`,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    status: 'ready',
    src,
  };
}

test('resolveCanvasImageLodMode maps zoom to cluster thumbnail and detail', () => {
  assert.equal(resolveCanvasImageLodMode(0.02), 'cluster');
  assert.equal(resolveCanvasImageLodMode(0.08), 'thumbnail');
  assert.equal(resolveCanvasImageLodMode(0.38), 'thumbnail');
  assert.equal(resolveCanvasImageLodMode(0.45), 'detail');
});

test('buildCanvasImageLodPlan clusters dense extreme low zoom visible images without resource candidates', () => {
  const nodes = [
    createImageNode('node-1', { x: 0, y: 0 }),
    createImageNode('node-2', { x: 60, y: 0 }),
    createImageNode('node-3', { x: 120, y: 0 }),
    createImageNode('node-4', { x: 180, y: 0 }),
    createImageNode('offscreen', { x: 50000, y: 0 }),
  ];

  const plan = buildCanvasImageLodPlan({
    nodes,
    readyItems: [createReadyItem('node-1', 'blob:representative')],
    viewport: { x: 0, y: 0, zoom: 0.02 },
    canvasSize: { width: 800, height: 600 },
    overscanPx: 0,
  });

  assert.equal(plan.mode, 'cluster');
  assert.deepEqual(plan.rasterEligibleImageNodes, []);
  assert.equal(plan.visibleNodeCount, 4);
  assert.equal(plan.clusterItems.length, 1);
  assert.equal(plan.clusterItems[0]?.status, 'cluster');
  assert.equal(plan.clusterItems[0]?.clusterCount, 4);
  assert.equal(plan.clusterItems[0]?.src, 'blob:representative');
});

test('buildCanvasImageLodPlan keeps sparse extreme low zoom images at node dimensions when thumbnails are ready', () => {
  const nodes = [
    createImageNode('node-1', { x: 0, y: 0 }, { dimensions: { width: 320, height: 180 } }),
    createImageNode('node-2', { x: 1200, y: 0 }, { dimensions: { width: 180, height: 320 } }),
  ];

  const plan = buildCanvasImageLodPlan({
    nodes,
    readyItems: [
      createReadyItem('node-1', 'blob:wide'),
      createReadyItem('node-2', 'blob:tall'),
    ],
    viewport: { x: 0, y: 0, zoom: 0.02 },
    canvasSize: { width: 800, height: 600 },
    overscanPx: 0,
  });

  assert.equal(plan.mode, 'cluster');
  assert.equal(plan.clusterItems.length, 2);
  assert.deepEqual(
    plan.clusterItems.map((item) => ({
      nodeId: item.nodeId,
      kind: item.kind,
      width: item.width,
      height: item.height,
      src: item.src,
    })),
    [
      { nodeId: 'node-1', kind: undefined, width: 320, height: 180, src: 'blob:wide' },
      { nodeId: 'node-2', kind: undefined, width: 180, height: 320, src: 'blob:tall' },
    ],
  );
});

test('buildCanvasImageLodPlan returns only visible raster candidates above cluster zoom', () => {
  const nodes = [
    createImageNode('visible', { x: 0, y: 0 }),
    createImageNode('active', { x: 120, y: 0 }),
    createImageNode('dom-owned', { x: 240, y: 0 }, { imageResourceOwner: 'dom' }),
    createImageNode('offscreen', { x: 5000, y: 0 }),
  ];

  const plan = buildCanvasImageLodPlan({
    nodes,
    viewport: { x: 0, y: 0, zoom: 0.38 },
    canvasSize: { width: 800, height: 600 },
    activeImageNodeIdSet: new Set(['active']),
    overscanPx: 0,
  });

  assert.equal(plan.mode, 'thumbnail');
  assert.deepEqual(plan.rasterEligibleImageNodes.map((node) => node.id), ['visible']);
  assert.deepEqual(plan.clusterItems, []);
});
