import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from 'reactflow';

import type { AINodeData, AnyNodeData, Viewport } from '@/types';
import {
  AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
  AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP,
  AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP,
  AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT,
  AI_IMAGE_INPAINT_EDITOR_TOOLBAR_HEIGHT,
} from '@/nodes/ai-image-inpaint/constants';
import {
  computeVisibleNodes,
  diffVisibleNodes,
  hasUsableVisibleNodeContainerSize,
  isVisibleNodeSnapshotFresh,
  resolveRetainedVisibilityCandidateIds,
  resolveVisibleNodesForCurrentState,
  type VisibleNodeSnapshot,
  type VisibleNodeState,
} from './useVisibleNodes';

function createNode(id: string, x: number, y: number, width = 200, height = 120): Node<AnyNodeData> {
  return {
    id,
    type: 'file',
    position: { x, y },
    data: {
      id,
      type: 'image',
      label: id,
      position: { x, y },
      dimensions: { width, height },
      metadata: {},
      status: 'idle',
      timestamp: { created: '', updated: '' },
    } as unknown as AnyNodeData,
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

function compute(
  nodes: Array<Node<AnyNodeData>>,
  viewport: Viewport,
  options?: {
    recent?: string[];
    importing?: string[];
  }
) {
  return computeVisibleNodes({
    nodes,
    viewport,
    containerSize: { width: 1280, height: 720 },
    recentlyInteractedNodeIds: options?.recent,
    importingNodeIds: options?.importing,
  });
}

function createVisibilityState(overrides: Partial<VisibleNodeState> = {}): VisibleNodeState {
  return {
    isVisible: false,
    isNearViewport: false,
    displayWidth: 0,
    displayHeight: 0,
    visibilityBucket: 'offscreen',
    visibilityScoreBucket: 'cancel',
    visibilityAreaBucket: 'none',
    visibleAreaRatio: 0,
    viewportZoom: 1,
    visibilityScore: 0,
    centerDistance: Number.POSITIVE_INFINITY,
    isSelected: false,
    isRecentlyInteracted: false,
    isImporting: false,
    renderTier: 'minimal',
    ...overrides,
  };
}

test('diffVisibleNodes suppresses minor continuous score changes inside the same bucket', () => {
  const node = createNode('n1', 80, 80);
  const previous = compute([node], { x: 0, y: 0, zoom: 1 });
  const next = compute([node], { x: -6, y: -4, zoom: 1 });
  const diff = diffVisibleNodes(previous, next);

  assert.equal(diff.size, 0);
});

test('diffVisibleNodes emits when node enters the viewport', () => {
  const node = createNode('n1', 1500, 80);
  const previous = compute([node], { x: 0, y: 0, zoom: 1 });
  const next = compute([node], { x: -1420, y: 0, zoom: 1 });
  const diff = diffVisibleNodes(previous, next);

  assert.equal(previous.get('n1')?.isVisible, false);
  assert.equal(next.get('n1')?.isVisible, true);
  assert.equal(diff.size, 1);
});

test('diffVisibleNodes emits when importing priority semantics change', () => {
  const node = createNode('n1', 900, 80);
  const previous = compute([node], { x: 0, y: 0, zoom: 1 });
  const next = compute([node], { x: 0, y: 0, zoom: 1 }, { importing: ['n1'] });
  const diff = diffVisibleNodes(previous, next);

  assert.equal(previous.get('n1')?.isImporting, false);
  assert.equal(next.get('n1')?.isImporting, true);
  assert.equal(diff.size, 1);
});

test('computeVisibleNodes downgrades visible importing images to compact tier by default', () => {
  const node = createNode('importing-visible', 80, 80);
  const result = compute([node], { x: 0, y: 0, zoom: 1 }, { importing: ['importing-visible'] });

  assert.equal(result.get('importing-visible')?.isVisible, true);
  assert.equal(result.get('importing-visible')?.isImporting, true);
  assert.equal(result.get('importing-visible')?.visibilityBucket, 'visible');
  assert.equal(result.get('importing-visible')?.renderTier, 'compact');
});

test('computeVisibleNodes keeps selected importing images compact but recent interaction full', () => {
  const selectedNode = createNode('selected-importing', 80, 80);
  selectedNode.selected = true;
  const recentNode = createNode('recent-importing', 340, 80);
  const result = compute(
    [selectedNode, recentNode],
    { x: 0, y: 0, zoom: 1 },
    { importing: ['selected-importing', 'recent-importing'], recent: ['recent-importing'] },
  );

  assert.equal(result.get('selected-importing')?.isSelected, true);
  assert.equal(result.get('selected-importing')?.renderTier, 'compact');
  assert.equal(result.get('recent-importing')?.renderTier, 'full');
});

test('computeVisibleNodes does not promote selected image nodes to full render tier', () => {
  const imageNode = createNode('selected-image', 1600, 80);
  imageNode.selected = true;
  const result = compute([imageNode], { x: 0, y: 0, zoom: 1 });

  assert.equal(result.get('selected-image')?.isSelected, true);
  assert.equal(result.get('selected-image')?.visibilityBucket, 'far');
  assert.equal(result.get('selected-image')?.renderTier, 'compact');
});

test('computeVisibleNodes still promotes selected non-image nodes to full render tier', () => {
  const inpaintNode = createInpaintNode('selected-inpaint', 1600, 80);
  inpaintNode.selected = true;
  const result = compute([inpaintNode], { x: 0, y: 0, zoom: 1 });

  assert.equal(result.get('selected-inpaint')?.isSelected, true);
  assert.equal(result.get('selected-inpaint')?.visibilityBucket, 'far');
  assert.equal(result.get('selected-inpaint')?.renderTier, 'full');
});

test('computeVisibleNodes uses raster-first tier for low-zoom large image canvases', () => {
  const nodes = Array.from({ length: 90 }, (_value, index) => (
    createNode(`image-${index}`, index * 210, 80)
  ));
  const result = computeVisibleNodes({
    nodes,
    viewport: { x: 0, y: 0, zoom: 0.05 },
    containerSize: { width: 1280, height: 720 },
  });

  assert.equal(result.get('image-0')?.isVisible, true);
  assert.equal(result.get('image-0')?.renderTier, 'compact');
});

test('computeVisibleNodes uses raster-first tier for large image canvases at interaction zoom', () => {
  const nodes = Array.from({ length: 232 }, (_value, index) => (
    createNode(`image-${index}`, index * 210, 80)
  ));
  const result = computeVisibleNodes({
    nodes,
    viewport: { x: 0, y: 0, zoom: 0.7 },
    containerSize: { width: 1280, height: 720 },
  });

  assert.equal(result.get('image-0')?.isVisible, true);
  assert.equal(result.get('image-0')?.renderTier, 'compact');
  assert.equal(result.get('image-9')?.isNearViewport, true);
  assert.equal(result.get('image-9')?.renderTier, 'minimal');
});

test('computeVisibleNodes keeps small image canvases on full visible DOM tier', () => {
  const nodes = Array.from({ length: 20 }, (_value, index) => (
    createNode(`image-${index}`, index * 210, 80)
  ));
  const result = computeVisibleNodes({
    nodes,
    viewport: { x: 0, y: 0, zoom: 0.7 },
    containerSize: { width: 1280, height: 720 },
  });

  assert.equal(result.get('image-0')?.isVisible, true);
  assert.equal(result.get('image-0')?.renderTier, 'full');
});

test('computeVisibleNodes does not raster-first downgrade selected non-image nodes on large canvases', () => {
  const images = Array.from({ length: 90 }, (_value, index) => (
    createNode(`image-${index}`, index * 210, 80)
  ));
  const inpaintNode = createInpaintNode('selected-inpaint-low-zoom', 80, 280);
  inpaintNode.selected = true;
  const result = computeVisibleNodes({
    nodes: [...images, inpaintNode],
    viewport: { x: 0, y: 0, zoom: 0.05 },
    containerSize: { width: 1280, height: 720 },
  });

  assert.equal(result.get('selected-inpaint-low-zoom')?.renderTier, 'full');
});

test('computeVisibleNodes only evaluates candidate nodes when candidateNodeIds is provided', () => {
  const visibleNode = createNode('visible', 80, 80);
  const offscreenNode = createNode('offscreen', 3000, 3000);
  const result = computeVisibleNodes({
    nodes: [visibleNode, offscreenNode],
    candidateNodeIds: ['visible'],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
  });

  assert.equal(result.has('visible'), true);
  assert.equal(result.has('offscreen'), false);
});

test('resolveRetainedVisibilityCandidateIds uses shorter importing retention and ignores importing alone', () => {
  const retained = new Map<string, number>();
  const result = resolveRetainedVisibilityCandidateIds({
    baseCandidateNodeIds: ['base-visible'],
    retainedCandidateExpirations: retained,
    lastAppliedVisibleNodes: new Map([
      ['base-visible', createVisibilityState({ isVisible: true, renderTier: 'full' })],
      ['importing-visible', createVisibilityState({
        isVisible: true,
        isNearViewport: true,
        isImporting: true,
        renderTier: 'compact',
        visibilityBucket: 'visible',
      })],
      ['importing-only', createVisibilityState({
        isImporting: true,
        renderTier: 'minimal',
      })],
      ['compact-passive', createVisibilityState({
        renderTier: 'compact',
      })],
    ]),
    importingNodeIds: ['importing-visible', 'importing-only'],
    now: 10_000,
    retention: {
      defaultRetentionMs: 6_000,
      importingRetentionMs: 1_200,
    },
  });

  assert.equal(result.includes('base-visible'), true);
  assert.equal(result.includes('importing-visible'), true);
  assert.equal(result.includes('compact-passive'), true);
  assert.equal(result.includes('importing-only'), false);
  assert.equal(retained.get('base-visible'), 16_000);
  assert.equal(retained.get('importing-visible'), 11_200);
  assert.equal(retained.get('compact-passive'), 16_000);
  assert.equal(retained.has('importing-only'), false);
});

test('resolveRetainedVisibilityCandidateIds expires importing candidates quickly after leaving the area', () => {
  const retained = new Map<string, number>([
    ['old-importing', 11_200],
    ['old-passive', 16_000],
  ]);
  const result = resolveRetainedVisibilityCandidateIds({
    baseCandidateNodeIds: [],
    retainedCandidateExpirations: retained,
    lastAppliedVisibleNodes: new Map(),
    now: 12_000,
    retention: {
      defaultRetentionMs: 6_000,
      importingRetentionMs: 1_200,
    },
  });

  assert.equal(result.includes('old-importing'), false);
  assert.equal(result.includes('old-passive'), true);
  assert.equal(retained.has('old-importing'), false);
  assert.equal(retained.get('old-passive'), 16_000);
});

test('computeVisibleNodes treats the floating inpaint editor as part of node visibility', () => {
  const bodyTop = 720 + 20;
  const inpaintNode = createInpaintNode('inpaint', 80, bodyTop);
  const result = computeVisibleNodes({
    nodes: [inpaintNode],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
    overscan: 0,
  });

  const visibility = result.get('inpaint');
  assert.equal(visibility?.isVisible, true);
  assert.equal(
    visibility?.displayHeight,
    460
      + AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT
      + AI_IMAGE_INPAINT_EDITOR_TOOLBAR_HEIGHT
      + AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP
      + AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP
      + AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT,
  );
});

test('diffVisibleNodes suppresses fallback when an already minimal node drops out of candidate set', () => {
  const node = createNode('n1', 3000, 3000);
  const previous = computeVisibleNodes({
    nodes: [node],
    candidateNodeIds: ['n1'],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
  });
  const next = computeVisibleNodes({
    nodes: [node],
    candidateNodeIds: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
  });
  const diff = diffVisibleNodes(previous, next);

  assert.equal(next.has('n1'), false);
  assert.equal(diff.size, 0);
});

test('computeVisibleNodes tracks forced importing nodes without promoting offscreen imports to full DOM', () => {
  const offscreenImportingNode = createNode('importing', 3000, 3000);
  const result = computeVisibleNodes({
    nodes: [offscreenImportingNode],
    candidateNodeIds: [],
    forcedOffscreenNodeIds: ['importing'],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
    importingNodeIds: ['importing'],
  });

  assert.equal(result.get('importing')?.isImporting, true);
  assert.equal(result.get('importing')?.isNearViewport, false);
  assert.equal(result.get('importing')?.visibilityBucket, 'offscreen');
  assert.equal(result.get('importing')?.renderTier, 'minimal');
});

test('diffVisibleNodes downgrades recently near-viewport nodes when they drop out of candidate set', () => {
  const previous = computeVisibleNodes({
    nodes: [createNode('n1', 1400, 80)],
    candidateNodeIds: ['n1'],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
  });
  const next = new Map();

  const diff = diffVisibleNodes(previous, next);

  assert.equal(previous.get('n1')?.isVisible, false);
  assert.equal(previous.get('n1')?.isNearViewport, true);
  assert.equal(diff.get('n1')?.isVisible, false);
  assert.equal(diff.get('n1')?.isNearViewport, false);
  assert.equal(diff.get('n1')?.visibilityBucket, 'offscreen');
  assert.equal(diff.get('n1')?.renderTier, 'minimal');
});

test('diffVisibleNodes downgrades visible nodes when they drop out of candidate set', () => {
  const previous = new Map([
    ['n1', {
      isVisible: true,
      isNearViewport: true,
      displayWidth: 220,
      displayHeight: 140,
      visibilityBucket: 'visible' as const,
      visibilityScoreBucket: 'ready' as const,
      visibilityAreaBucket: 'ready' as const,
      visibleAreaRatio: 0.8,
      viewportZoom: 1,
      visibilityScore: 0.82,
      centerDistance: 120,
      isSelected: false,
      isRecentlyInteracted: false,
      isImporting: false,
      renderTier: 'full' as const,
    }],
  ]);
  const next = new Map();

  const diff = diffVisibleNodes(previous, next);

  assert.equal(diff.get('n1')?.isVisible, false);
  assert.equal(diff.get('n1')?.isNearViewport, false);
  assert.equal(diff.get('n1')?.visibilityBucket, 'offscreen');
  assert.equal(diff.get('n1')?.renderTier, 'minimal');
});

test('isVisibleNodeSnapshotFresh accepts only matching viewport, nodes version, and container size', () => {
  const visibleNodes = computeVisibleNodes({
    nodes: [createNode('n1', 80, 80)],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
  });
  const snapshot: VisibleNodeSnapshot = {
    visibleNodes,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodesVersion: 2,
    containerSize: { width: 1280, height: 720 },
    computedAt: 123,
  };

  assert.equal(isVisibleNodeSnapshotFresh(snapshot, {
    viewport: { x: 0, y: 0, zoom: 1 },
    nodesVersion: 2,
    containerSize: { width: 1280, height: 720 },
  }), true);
  assert.equal(isVisibleNodeSnapshotFresh(snapshot, {
    viewport: { x: -100, y: 0, zoom: 1 },
    nodesVersion: 2,
    containerSize: { width: 1280, height: 720 },
  }), false);
  assert.equal(isVisibleNodeSnapshotFresh(snapshot, {
    viewport: { x: 0, y: 0, zoom: 1 },
    nodesVersion: 3,
    containerSize: { width: 1280, height: 720 },
  }), false);
  assert.equal(isVisibleNodeSnapshotFresh(snapshot, {
    viewport: { x: 0, y: 0, zoom: 1 },
    nodesVersion: 2,
    containerSize: { width: 1024, height: 720 },
  }), false);
});

test('isVisibleNodeSnapshotFresh rejects unusable current or snapshot container size', () => {
  const snapshot: VisibleNodeSnapshot = {
    visibleNodes: computeVisibleNodes({
      nodes: [createNode('n1', 80, 80)],
      viewport: { x: 0, y: 0, zoom: 1 },
      containerSize: { width: 1280, height: 720 },
    }),
    viewport: { x: 0, y: 0, zoom: 1 },
    nodesVersion: 1,
    containerSize: { width: 1280, height: 720 },
    computedAt: 123,
  };

  assert.equal(hasUsableVisibleNodeContainerSize({ width: 1280, height: 720 }), true);
  assert.equal(hasUsableVisibleNodeContainerSize({ width: 0, height: 720 }), false);
  assert.equal(isVisibleNodeSnapshotFresh(snapshot, {
    viewport: { x: 0, y: 0, zoom: 1 },
    nodesVersion: 1,
    containerSize: { width: 0, height: 720 },
  }), false);
  assert.equal(isVisibleNodeSnapshotFresh({
    ...snapshot,
    containerSize: { width: 0, height: 720 },
  }, {
    viewport: { x: 0, y: 0, zoom: 1 },
    nodesVersion: 1,
    containerSize: { width: 0, height: 720 },
  }), false);
});

test('resolveVisibleNodesForCurrentState ignores stale precomputed snapshot and recomputes current visibility', () => {
  const node = createNode('n1', 80, 80);
  const staleVisibility = computeVisibleNodes({
    nodes: [node],
    viewport: { x: -3000, y: -3000, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
  });
  const result = resolveVisibleNodesForCurrentState({
    nodes: [node],
    nodesVersion: 2,
    precomputedVisibility: {
      visibleNodes: staleVisibility,
      viewport: { x: -3000, y: -3000, zoom: 1 },
      nodesVersion: 1,
      containerSize: { width: 1280, height: 720 },
      computedAt: 123,
    },
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
  });

  assert.equal(staleVisibility.get('n1')?.isVisible, false);
  assert.equal(result?.get('n1')?.isVisible, true);
});

test('resolveVisibleNodesForCurrentState restores a node after it pans back into the viewport', () => {
  const node = createNode('returning-node', 3000, 80);
  const staleOffscreenVisibility = computeVisibleNodes({
    nodes: [node],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
  });
  const finalViewport = { x: -2920, y: 0, zoom: 1 };

  const result = resolveVisibleNodesForCurrentState({
    nodes: [node],
    nodesVersion: 4,
    precomputedVisibility: {
      visibleNodes: staleOffscreenVisibility,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodesVersion: 4,
      containerSize: { width: 1280, height: 720 },
      computedAt: 123,
    },
    viewport: finalViewport,
    containerSize: { width: 1280, height: 720 },
  });

  assert.equal(staleOffscreenVisibility.get('returning-node')?.visibilityBucket, 'offscreen');
  assert.equal(result?.get('returning-node')?.isVisible, true);
  assert.equal(result?.get('returning-node')?.renderTier, 'full');
});

test('resolveVisibleNodesForCurrentState invalidates hidden snapshots after output nodes land', () => {
  const hiddenSource = createNode('source', 80, 80);
  const outputNode = createNode('output', 360, 80);
  const staleHiddenVisibility = new Map([
    ['source', {
      isVisible: false,
      isNearViewport: false,
      displayWidth: 0,
      displayHeight: 0,
      visibilityBucket: 'offscreen' as const,
      visibilityScoreBucket: 'cancel' as const,
      visibilityAreaBucket: 'none' as const,
      visibleAreaRatio: 0,
      viewportZoom: 1,
      visibilityScore: 0,
      centerDistance: Number.POSITIVE_INFINITY,
      isSelected: false,
      isRecentlyInteracted: false,
      isImporting: false,
      renderTier: 'minimal' as const,
    }],
  ]);

  const result = resolveVisibleNodesForCurrentState({
    nodes: [hiddenSource, outputNode],
    nodesVersion: 8,
    precomputedVisibility: {
      visibleNodes: staleHiddenVisibility,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodesVersion: 7,
      containerSize: { width: 1280, height: 720 },
      computedAt: 123,
    },
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
  });

  assert.equal(staleHiddenVisibility.get('source')?.renderTier, 'minimal');
  assert.equal(result?.get('source')?.isVisible, true);
  assert.equal(result?.get('source')?.renderTier, 'full');
  assert.equal(result?.get('output')?.isVisible, true);
});

test('resolveVisibleNodesForCurrentState returns undefined when container size is temporarily unavailable', () => {
  const result = resolveVisibleNodesForCurrentState({
    nodes: [createNode('n1', 80, 80)],
    nodesVersion: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 0, height: 720 },
  });

  assert.equal(result, undefined);
});

test('resolveVisibleNodesForCurrentState keeps forced importing nodes tracked without forcing full DOM', () => {
  const importingNode = createNode('importing', 3000, 3000);
  const result = resolveVisibleNodesForCurrentState({
    nodes: [importingNode],
    nodesVersion: 1,
    candidateNodeIds: [],
    forcedOffscreenNodeIds: ['importing'],
    importingNodeIds: ['importing'],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
  });

  assert.equal(result?.get('importing')?.isImporting, true);
  assert.equal(result?.get('importing')?.isNearViewport, false);
  assert.equal(result?.get('importing')?.visibilityBucket, 'offscreen');
  assert.equal(result?.get('importing')?.renderTier, 'minimal');
});

test('computeVisibleNodes keeps initial offscreen imports out of visibility when not forced', () => {
  const node = createNode('initial-offscreen-importing', 3000, 3000);
  const result = computeVisibleNodes({
    nodes: [node],
    candidateNodeIds: [],
    forcedOffscreenNodeIds: [],
    importingNodeIds: ['initial-offscreen-importing'],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
  });

  assert.equal(result.has('initial-offscreen-importing'), false);
});

test('computeVisibleNodes restores importing nodes from candidate visibility instead of forced fallback', () => {
  const node = createNode('returning-importing', 3000, 80);
  const result = computeVisibleNodes({
    nodes: [node],
    candidateNodeIds: ['returning-importing'],
    forcedOffscreenNodeIds: [],
    importingNodeIds: ['returning-importing'],
    viewport: { x: -2920, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
  });

  assert.equal(result.get('returning-importing')?.isVisible, true);
  assert.equal(result.get('returning-importing')?.isImporting, true);
  assert.equal(result.get('returning-importing')?.renderTier, 'compact');
});
