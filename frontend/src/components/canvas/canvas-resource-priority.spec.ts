import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData } from '@/types';
import type { VisibleNodeState } from '@/hooks/canvas/useVisibleNodes';

import type { CanvasRasterImageNode } from './canvas-raster-image-resource-bridge';
import { resolveCanvasImageResourcePriority } from './canvas-resource-priority';

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

test('canvas image resource priority ranks selected, hovered, and active nodes first', () => {
  const passive = resolveCanvasImageResourcePriority({
    node: createImageNode('passive'),
    visibility: createVisibility(),
  });
  const active = resolveCanvasImageResourcePriority({
    node: createImageNode('active', { activeState: 'active' }),
    visibility: createVisibility(),
  });
  const hovered = resolveCanvasImageResourcePriority({
    node: createImageNode('hovered', { activeReasons: ['hovered'] }),
    visibility: createVisibility(),
  });
  const selected = resolveCanvasImageResourcePriority({
    node: createImageNode('selected', { activeReasons: ['selected'] }),
    visibility: createVisibility(),
  });

  assert.equal(selected.tier, 'selected');
  assert.equal(hovered.tier, 'hovered');
  assert.equal(active.tier, 'active');
  assert.equal(selected.rank < passive.rank, true);
  assert.equal(hovered.rank < passive.rank, true);
  assert.equal(active.rank < passive.rank, true);
});

test('canvas image resource priority keeps passive importing work behind stable visible work', () => {
  const visible = resolveCanvasImageResourcePriority({
    node: createImageNode('visible'),
    visibility: createVisibility({ isImporting: false }),
  });
  const importing = resolveCanvasImageResourcePriority({
    node: createImageNode('importing', { status: 'processing' }),
    visibility: createVisibility({ isImporting: true }),
  });

  assert.equal(importing.tier, 'importing-passive');
  assert.equal(visible.rank < importing.rank, true);
  assert.equal(importing.importing, true);
});

test('canvas image resource priority keeps interacted importing resources promoted', () => {
  const selected = resolveCanvasImageResourcePriority({
    node: createImageNode('selected-importing', { status: 'processing', activeReasons: ['selected'] }),
    visibility: createVisibility({ isImporting: true, isSelected: true }),
  });
  const hovered = resolveCanvasImageResourcePriority({
    node: createImageNode('hovered-importing', { status: 'processing', activeReasons: ['hovered'] }),
    visibility: createVisibility({ isImporting: true }),
  });
  const active = resolveCanvasImageResourcePriority({
    node: createImageNode('active-importing', { status: 'processing', activeState: 'active' }),
    visibility: createVisibility({ isImporting: true }),
    activeImageNodeIdSet: new Set(['active-importing']),
  });

  assert.equal(selected.tier, 'selected');
  assert.equal(hovered.tier, 'hovered');
  assert.equal(active.tier, 'active');
  assert.equal(selected.importing, true);
  assert.equal(hovered.importing, true);
  assert.equal(active.importing, true);
});
