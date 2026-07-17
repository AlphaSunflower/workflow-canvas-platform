import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from 'reactflow';

import type { AINodeData, AnyNodeData, Viewport } from '@/types';
import { AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT } from '@/nodes/ai-image-inpaint/constants';
import {
  createCanvasNodeSpatialIndex,
  resolveNodeSpatialRect,
} from './canvas-node-spatial-index';

function createNode(id: string, x: number, y: number, width = 200, height = 120): Node<AnyNodeData> {
  return {
    id,
    type: 'image',
    position: { x, y },
    data: {
      id: { value: id, display: `#${id}` },
      type: 'image',
      position: { x, y },
      dimensions: { width, height },
      rotation: 0,
      scale: 1,
      locked: false,
      status: 'idle',
      zIndex: 0,
      timestamp: { created: 1, updated: 1 },
      fileId: `file-${id}`,
      fileName: `${id}.png`,
      fileSize: 1024,
      mimeType: 'image/png',
      source: { type: 'imported', importMethod: 'local', importedAt: 1 },
      metadata: {},
    } as AnyNodeData,
    width,
    height,
    selected: false,
  };
}

function createInpaintNode(id: string, x: number, y: number): Node<AnyNodeData> {
  const data: AINodeData = {
    id: { value: id, display: `#${id}` },
    type: 'aiImageInpaint',
    position: { x, y },
    dimensions: { width: 500, height: 460 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: 1, updated: 1 },
    references: [],
    outputs: [],
    config: {
      editorHeight: AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
    },
    tasks: [],
  };

  return {
    id,
    type: 'aiImageInpaint',
    position: data.position,
    data,
    width: data.dimensions.width,
    height: data.dimensions.height,
    selected: false,
  };
}

const viewport: Viewport = { x: 0, y: 0, zoom: 1 };
const containerSize = { width: 1280, height: 720 };

test('canvas spatial index queries only nodes inside viewport overscan', () => {
  const index = createCanvasNodeSpatialIndex(256);
  const nearNode = createNode('near', 100, 100);
  const farNode = createNode('far', 3200, 2400);

  index.rebuild([nearNode, farNode]);
  const result = index.queryViewport(viewport, containerSize, 240);

  assert.deepEqual(result, ['near']);
});

test('canvas spatial index reflects node move after upsert', () => {
  const index = createCanvasNodeSpatialIndex(256);
  const node = createNode('move', 3000, 2000);

  index.rebuild([node]);
  assert.deepEqual(index.queryViewport(viewport, containerSize, 240), []);

  const moved = createNode('move', 120, 90);
  index.upsert(moved.id, resolveNodeSpatialRect(moved));

  assert.deepEqual(index.queryViewport(viewport, containerSize, 240), ['move']);
});

test('canvas spatial index removes deleted nodes from viewport query results', () => {
  const index = createCanvasNodeSpatialIndex(256);
  const left = createNode('left', 80, 80);
  const right = createNode('right', 180, 140);

  index.rebuild([left, right]);
  assert.deepEqual(index.queryViewport(viewport, containerSize, 240).sort(), ['left', 'right']);

  index.remove('left');

  assert.deepEqual(index.queryViewport(viewport, containerSize, 240), ['right']);
});

test('canvas spatial index handles batched import-like rebuilds accurately', () => {
  const index = createCanvasNodeSpatialIndex(256);
  const nodes = Array.from({ length: 24 }, (_, index) => (
    createNode(`n-${index + 1}`, (index % 6) * 260, Math.floor(index / 6) * 220)
  ));

  index.rebuild(nodes);
  const result = index.queryViewport(viewport, containerSize, 240);

  assert.equal(result.length <= nodes.length, true);
  assert.equal(result.length > 0, true);
  assert.equal(result.every((nodeId) => nodeId.startsWith('n-')), true);
});

test('canvas spatial index includes the floating inpaint editor rect', () => {
  const index = createCanvasNodeSpatialIndex(256);
  const inpaintNode = createInpaintNode('inpaint', 80, 740);

  index.rebuild([inpaintNode]);

  assert.deepEqual(index.queryViewport(viewport, containerSize, 0), ['inpaint']);
  assert.equal(resolveNodeSpatialRect(inpaintNode).y < inpaintNode.position.y, true);
});
