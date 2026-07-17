import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from 'reactflow';

import type { AnyNodeData, FileNodeData } from '@/types';

import { createCanvasNodeSpatialIndex } from './canvas-node-spatial-index';
import { hitTestCanvasNode, screenPointToFlowPosition } from './canvas-hit-test';
import { syncCanvasActiveNodeStateSnapshot, clearCanvasActiveNodeStateSnapshot } from './canvas-active-node-state';

function createImageNode(
  id: string,
  overrides: Partial<Node<FileNodeData>> = {},
  dataOverrides: Partial<FileNodeData> = {},
): Node<AnyNodeData> {
  const now = Date.now();
  const data: FileNodeData = {
    id: { value: id, display: `#${id}` },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 200, height: 120 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: now, updated: now },
    fileId: `file-${id}`,
    fileName: `${id}.png`,
    fileSize: 1024,
    mimeType: 'image/png',
    source: { type: 'imported', importMethod: 'local', importedAt: now },
    metadata: {},
    ...dataOverrides,
  };

  return {
    id,
    type: 'image',
    position: data.position,
    data,
    width: data.dimensions.width,
    height: data.dimensions.height,
    selected: false,
    ...overrides,
  };
}

test('screenPointToFlowPosition converts viewport-transformed coordinates back to canvas space', () => {
  clearCanvasActiveNodeStateSnapshot();
  assert.deepEqual(
    screenPointToFlowPosition({ x: 250, y: 170 }, { x: 50, y: 20, zoom: 2 }),
    { x: 100, y: 75 },
  );
});

test('screenPointToFlowPosition accounts for canvas container offset before viewport transform', () => {
  clearCanvasActiveNodeStateSnapshot();
  assert.deepEqual(
    screenPointToFlowPosition(
      { x: 360, y: 240 },
      { x: 40, y: 30, zoom: 2 },
      { left: 120, top: 50 },
    ),
    { x: 100, y: 80 },
  );
});

test('hitTestCanvasNode returns the topmost file node under pointer using spatial index candidates', () => {
  clearCanvasActiveNodeStateSnapshot();
  const lower = createImageNode('lower', {
    position: { x: 10, y: 20 },
    zIndex: 1,
  }, {
    position: { x: 10, y: 20 },
    zIndex: 1,
  });
  const higher = createImageNode('higher', {
    position: { x: 10, y: 20 },
    zIndex: 5,
  }, {
    position: { x: 10, y: 20 },
    zIndex: 5,
  });
  const index = createCanvasNodeSpatialIndex();
  index.rebuild([lower, higher]);

  const hit = hitTestCanvasNode({
    clientPosition: { x: 140, y: 260 },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [lower, higher],
    spatialIndex: index,
    containerBounds: { left: 100, top: 200 },
  });

  assert.equal(hit?.node.id, 'higher');
});

test('hitTestCanvasNode prefers currently active nodes when candidates overlap', () => {
  clearCanvasActiveNodeStateSnapshot();
  const passive = createImageNode('passive', {
    position: { x: 10, y: 20 },
  }, {
    position: { x: 10, y: 20 },
  });
  const active = createImageNode('active', {
    position: { x: 10, y: 20 },
  }, {
    position: { x: 10, y: 20 },
  });
  const index = createCanvasNodeSpatialIndex();
  index.rebuild([passive, active]);
  syncCanvasActiveNodeStateSnapshot([
    ['active', { activeState: 'active', activeReasons: ['hovered'] }],
    ['passive', { activeState: 'passive', activeReasons: [] }],
  ]);

  const hit = hitTestCanvasNode({
    clientPosition: { x: 80, y: 60 },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [passive, active],
    spatialIndex: index,
  });

  assert.equal(hit?.node.id, 'active');
  clearCanvasActiveNodeStateSnapshot();
});
