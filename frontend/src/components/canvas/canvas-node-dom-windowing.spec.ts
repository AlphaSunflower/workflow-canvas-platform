import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from 'reactflow';

import type { AINodeData, AnyNodeData, FileNodeData } from '@/types';
import {
  AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
  AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP,
  AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP,
  AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT,
  resolveAIImageInpaintEditorSize,
} from '@/nodes/ai-image-inpaint/constants';
import {
  computeVisibleNodes,
} from '@/hooks/canvas/useVisibleNodes';
import type { VisibleNodeMap, VisibleNodeState } from '@/hooks/canvas/useVisibleNodes';

import {
  clearCanvasActiveNodeStateSnapshot,
  syncCanvasActiveNodeStateSnapshot,
} from './canvas-active-node-state';
import {
  clearCanvasRuntimeVisualStateSnapshot,
  syncCanvasNodeLocalActiveState,
  syncCanvasRuntimeVisualStateSnapshot,
} from './canvas-runtime-visual-state';
import {
  resolveCanvasNodeDomWindowing,
  shouldDetachCanvasNodeDom,
} from './canvas-node-dom-windowing';

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

function createInpaintNode(
  id: string,
  overrides: Partial<Node<AINodeData>> = {},
  dataOverrides: Partial<AINodeData> = {},
): Node<AnyNodeData> {
  const now = Date.now();
  const data: AINodeData = {
    id: { value: id, display: `#${id}` },
    type: 'aiImageInpaint',
    position: { x: 0, y: 0 },
    dimensions: { width: 500, height: 460 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: now, updated: now },
    references: [],
    outputs: [],
    config: {
      editorHeight: AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
    },
    tasks: [],
    ...dataOverrides,
  };

  return {
    id,
    type: 'aiImageInpaint',
    position: data.position,
    data,
    width: data.dimensions.width,
    height: data.dimensions.height,
    selected: false,
    ...overrides,
  };
}

function createAIImageGenNode(
  id: string,
  overrides: Partial<Node<AINodeData>> = {},
  dataOverrides: Partial<AINodeData> = {},
): Node<AnyNodeData> {
  const now = Date.now();
  const data: AINodeData = {
    id: { value: id, display: `#${id}` },
    type: 'aiImageGen',
    position: { x: 0, y: 0 },
    dimensions: { width: 320, height: 372 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: now, updated: now },
    references: [],
    outputs: [],
    config: {
      inputGroups: [{ id: 'group-1', label: 'Group 1', order: 0 }],
    },
    tasks: [],
    ...dataOverrides,
  };

  return {
    id,
    type: 'aiImageGen',
    position: data.position,
    data,
    width: data.dimensions.width,
    height: data.dimensions.height,
    selected: false,
    ...overrides,
  };
}

function createVisibility(overrides: Partial<VisibleNodeState> = {}): VisibleNodeState {
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

function clearRuntimeState(): void {
  clearCanvasActiveNodeStateSnapshot();
  clearCanvasRuntimeVisualStateSnapshot();
}

test('offscreen passive minimal nodes are detached from heavy canvas rendering', () => {
  clearRuntimeState();
  const node = createImageNode('detached');
  const visibleNodes: VisibleNodeMap = new Map([
    ['detached', createVisibility()],
  ]);

  syncCanvasActiveNodeStateSnapshot([
    ['detached', { activeState: 'passive', activeReasons: [] }],
  ]);
  syncCanvasRuntimeVisualStateSnapshot([
    ['detached', {
      scheduledRenderTier: 'minimal',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
  ]);

  assert.equal(shouldDetachCanvasNodeDom(node, visibleNodes), true);
  clearRuntimeState();
});

test('near, non-image selected, and active nodes are kept in ReactFlow DOM', () => {
  clearRuntimeState();
  const nearNode = createImageNode('near');
  const selectedNode = createInpaintNode('selected', { selected: true });
  const activeNode = createImageNode('active');
  const localActiveNode = createImageNode('local-active');
  const visibleNodes: VisibleNodeMap = new Map([
    ['near', createVisibility({ isNearViewport: true, visibilityBucket: 'near', renderTier: 'full' })],
    ['selected', createVisibility({ isSelected: true, renderTier: 'full' })],
    ['active', createVisibility()],
    ['local-active', createVisibility()],
  ]);

  syncCanvasActiveNodeStateSnapshot([
    ['near', { activeState: 'passive', activeReasons: [] }],
    ['selected', { activeState: 'active', activeReasons: ['selected'] }],
    ['active', { activeState: 'active', activeReasons: ['hovered'] }],
    ['local-active', { activeState: 'passive', activeReasons: [] }],
  ]);
  syncCanvasRuntimeVisualStateSnapshot([
    ['near', {
      scheduledRenderTier: 'full',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
    ['selected', {
      scheduledRenderTier: 'full',
      canvasState: { activeState: 'active', activeReasons: ['selected'] },
    }],
    ['active', {
      scheduledRenderTier: 'minimal',
      canvasState: { activeState: 'active', activeReasons: ['hovered'] },
    }],
    ['local-active', {
      scheduledRenderTier: 'minimal',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
  ]);
  syncCanvasNodeLocalActiveState('local-active', {
    activeState: 'active',
    activeReasons: ['viewer'],
  });

  assert.equal(shouldDetachCanvasNodeDom(nearNode, visibleNodes), false);
  assert.equal(shouldDetachCanvasNodeDom(selectedNode, visibleNodes), false);
  assert.equal(shouldDetachCanvasNodeDom(activeNode, visibleNodes), false);
  assert.equal(shouldDetachCanvasNodeDom(localActiveNode, visibleNodes), false);
  clearRuntimeState();
});

test('selected image nodes keep the planned lightweight render path when not otherwise active', () => {
  clearRuntimeState();
  const selectedNode = createImageNode('selected-image', { selected: true });
  const visibleNodes: VisibleNodeMap = new Map([
    ['selected-image', createVisibility({
      isSelected: true,
      visibilityBucket: 'far',
      renderTier: 'compact',
    })],
  ]);

  syncCanvasActiveNodeStateSnapshot([
    ['selected-image', { activeState: 'passive', activeReasons: [] }],
  ]);
  syncCanvasRuntimeVisualStateSnapshot([
    ['selected-image', {
      scheduledRenderTier: 'compact',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
  ]);

  const decision = resolveCanvasNodeDomWindowing({
    nodes: [selectedNode],
    visibleNodes,
  });

  assert.equal(shouldDetachCanvasNodeDom(selectedNode, visibleNodes), false);
  assert.equal(decision.nodeRenderPlan.get('selected-image')?.mode, 'proxy');
  assert.equal(decision.nodeRenderPlan.get('selected-image')?.renderTier, 'compact');
  assert.equal(decision.nodeRenderPlan.get('selected-image')?.activeState, 'passive');
  assert.deepEqual(decision.nodeRenderPlan.get('selected-image')?.activeReasons, []);
  clearRuntimeState();
});

test('dom windowing allows offscreen importing image nodes to stay lightweight', () => {
  clearRuntimeState();
  const importingNode = createImageNode('importing');
  const visibleNodes: VisibleNodeMap = new Map([
    ['importing', createVisibility({ isImporting: true, renderTier: 'minimal' })],
  ]);

  syncCanvasActiveNodeStateSnapshot([
    ['importing', { activeState: 'passive', activeReasons: [] }],
  ]);
  syncCanvasRuntimeVisualStateSnapshot([
    ['importing', {
      scheduledRenderTier: 'minimal',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
  ]);

  const decision = resolveCanvasNodeDomWindowing({
    nodes: [importingNode],
    visibleNodes,
  });

  assert.equal(shouldDetachCanvasNodeDom(importingNode, visibleNodes), true);
  assert.equal(decision.nodeRenderPlan.get('importing')?.mode, 'placeholder');
  assert.equal(decision.nodeRenderPlan.get('importing')?.renderTier, 'minimal');
  assert.equal(decision.placeholderNodeIds.has('importing'), true);
  clearRuntimeState();
});

test('dom windowing routes visible importing image nodes to compact proxy unless active', () => {
  clearRuntimeState();
  const importingNode = createImageNode('importing');
  const activeImportingNode = createImageNode('active-importing');
  const visibleNodes: VisibleNodeMap = new Map([
    ['importing', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      isImporting: true,
      renderTier: 'compact',
    })],
    ['active-importing', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      isImporting: true,
      renderTier: 'compact',
    })],
  ]);

  syncCanvasActiveNodeStateSnapshot([
    ['importing', { activeState: 'passive', activeReasons: [] }],
    ['active-importing', { activeState: 'active', activeReasons: ['dragging'] }],
  ]);
  syncCanvasRuntimeVisualStateSnapshot([
    ['importing', {
      scheduledRenderTier: 'compact',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
    ['active-importing', {
      scheduledRenderTier: 'compact',
      canvasState: { activeState: 'active', activeReasons: ['dragging'] },
    }],
  ]);

  const decision = resolveCanvasNodeDomWindowing({
    nodes: [importingNode, activeImportingNode],
    visibleNodes,
  });

  assert.equal(decision.nodeRenderPlan.get('importing')?.mode, 'proxy');
  assert.equal(decision.nodeRenderPlan.get('importing')?.renderTier, 'compact');
  assert.equal(decision.nodeRenderPlan.get('active-importing')?.mode, 'full');
  assert.equal(decision.nodeRenderPlan.get('active-importing')?.renderTier, 'full');
  assert.equal(decision.placeholderNodeIds.has('importing'), false);
  assert.equal(decision.placeholderNodeIds.has('active-importing'), false);
  clearRuntimeState();
});

test('dom windowing replaces detached nodes with placeholders and hides connected edges', () => {
  clearRuntimeState();
  const detachedNode = createImageNode('detached');
  const restoredNode = createImageNode('restored');
  const visibleNodes: VisibleNodeMap = new Map([
    ['detached', createVisibility()],
    ['restored', createVisibility({ isNearViewport: true, visibilityBucket: 'near', renderTier: 'full' })],
  ]);

  syncCanvasActiveNodeStateSnapshot([
    ['detached', { activeState: 'passive', activeReasons: [] }],
    ['restored', { activeState: 'passive', activeReasons: [] }],
  ]);
  syncCanvasRuntimeVisualStateSnapshot([
    ['detached', {
      scheduledRenderTier: 'minimal',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
    ['restored', {
      scheduledRenderTier: 'full',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
  ]);

  const decision = resolveCanvasNodeDomWindowing({
    nodes: [detachedNode, restoredNode],
    edges: [
      { id: 'edge-detached', source: 'detached', target: 'restored' },
      { id: 'edge-visible', source: 'restored', target: 'restored' },
    ],
    visibleNodes,
  });

  assert.deepEqual(Array.from(decision.detachedNodeIds), ['detached']);
  assert.deepEqual(Array.from(decision.placeholderNodeIds), ['detached']);
  assert.deepEqual(Array.from(decision.hiddenEdgeIds), ['edge-detached']);
  assert.equal(decision.nodeRenderPlan.get('detached')?.mode, 'placeholder');
  assert.equal(decision.nodeRenderPlan.get('restored')?.mode, 'full');
  assert.equal(visibleNodes.has('detached'), true);
  clearRuntimeState();
});

test('dom windowing keeps compact far image nodes on proxy path without hiding edges', () => {
  clearRuntimeState();
  const compactNode = createImageNode('compact');
  const visibleNode = createImageNode('visible');
  const visibleNodes: VisibleNodeMap = new Map([
    ['compact', createVisibility({ visibilityBucket: 'far', renderTier: 'compact' })],
    ['visible', createVisibility({ isVisible: true, isNearViewport: true, visibilityBucket: 'visible', renderTier: 'full' })],
  ]);

  syncCanvasActiveNodeStateSnapshot([
    ['compact', { activeState: 'passive', activeReasons: [] }],
    ['visible', { activeState: 'passive', activeReasons: [] }],
  ]);
  syncCanvasRuntimeVisualStateSnapshot([
    ['compact', {
      scheduledRenderTier: 'compact',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
    ['visible', {
      scheduledRenderTier: 'full',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
  ]);

  const decision = resolveCanvasNodeDomWindowing({
    nodes: [compactNode, visibleNode],
    edges: [{ id: 'edge-compact', source: 'compact', target: 'visible' }],
    visibleNodes,
  });

  assert.equal(decision.nodeRenderPlan.get('compact')?.mode, 'proxy');
  assert.equal(decision.nodeRenderPlan.get('compact')?.renderTier, 'compact');
  assert.equal(decision.placeholderNodeIds.has('compact'), false);
  assert.equal(decision.hiddenEdgeIds.has('edge-compact'), false);
  assert.equal(shouldDetachCanvasNodeDom(compactNode, visibleNodes), false);
  clearRuntimeState();
});

test('dom windowing keeps connected dynamic-handle AI nodes mounted', () => {
  clearRuntimeState();
  const sourceNode = createImageNode('source');
  const aiNode = createAIImageGenNode('ai-gen');
  const visibleNodes: VisibleNodeMap = new Map([
    ['source', createVisibility()],
    ['ai-gen', createVisibility()],
  ]);

  syncCanvasActiveNodeStateSnapshot([
    ['source', { activeState: 'passive', activeReasons: [] }],
    ['ai-gen', { activeState: 'passive', activeReasons: [] }],
  ]);
  syncCanvasRuntimeVisualStateSnapshot([
    ['source', {
      scheduledRenderTier: 'minimal',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
    ['ai-gen', {
      scheduledRenderTier: 'minimal',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
  ]);

  const decision = resolveCanvasNodeDomWindowing({
    nodes: [sourceNode, aiNode],
    edges: [
      { id: 'edge-ai-input', source: 'source', target: 'ai-gen' },
    ],
    visibleNodes,
  });

  assert.equal(shouldDetachCanvasNodeDom(aiNode, visibleNodes, [
    { source: 'source', target: 'ai-gen' },
  ]), false);
  assert.equal(decision.placeholderNodeIds.has('source'), true);
  assert.equal(decision.placeholderNodeIds.has('ai-gen'), false);
  assert.equal(decision.nodeRenderPlan.get('ai-gen')?.mode, 'full');
  assert.equal(decision.nodeRenderPlan.get('ai-gen')?.renderTier, 'full');
  assert.equal(decision.hiddenEdgeIds.has('edge-ai-input'), true);
  clearRuntimeState();
});

test('dom windowing reuses previous node render plan when visibility is not fresh', () => {
  clearRuntimeState();
  const detachedNode = createImageNode('detached');
  const restoredNode = createImageNode('restored');
  const visibleNodes: VisibleNodeMap = new Map([
    ['detached', createVisibility()],
    ['restored', createVisibility({ isNearViewport: true, visibilityBucket: 'near', renderTier: 'full' })],
  ]);

  syncCanvasActiveNodeStateSnapshot([
    ['detached', { activeState: 'passive', activeReasons: [] }],
    ['restored', { activeState: 'passive', activeReasons: [] }],
  ]);
  syncCanvasRuntimeVisualStateSnapshot([
    ['detached', {
      scheduledRenderTier: 'minimal',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
    ['restored', {
      scheduledRenderTier: 'full',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
  ]);

  const decision = resolveCanvasNodeDomWindowing({
    nodes: [detachedNode, restoredNode],
    edges: [
      { id: 'edge-detached', source: 'detached', target: 'restored' },
      { id: 'edge-visible', source: 'restored', target: 'restored' },
    ],
    visibleNodes,
    visibilityFresh: false,
    previousNodeRenderPlan: new Map([
      ['detached', {
        mode: 'placeholder',
        renderTier: 'minimal',
        scheduledRenderTier: 'minimal',
        activeState: 'passive',
        activeReasons: [],
      }],
      ['restored', {
        mode: 'full',
        renderTier: 'full',
        scheduledRenderTier: 'full',
        activeState: 'passive',
        activeReasons: [],
      }],
    ]),
  });

  assert.deepEqual(Array.from(decision.detachedNodeIds), ['detached']);
  assert.deepEqual(Array.from(decision.placeholderNodeIds), ['detached']);
  assert.deepEqual(Array.from(decision.hiddenEdgeIds), ['edge-detached']);
  assert.equal(decision.nodeRenderPlan.get('detached')?.mode, 'placeholder');
  assert.equal(decision.nodeRenderPlan.get('detached')?.renderTier, 'minimal');
  assert.equal(decision.nodeRenderPlan.get('restored')?.mode, 'full');
  clearRuntimeState();
});

test('dom windowing falls back to proxy for image nodes without stale render history', () => {
  clearRuntimeState();
  const node = createImageNode('new-node');
  const visibleNodes: VisibleNodeMap = new Map([
    ['new-node', createVisibility()],
  ]);

  syncCanvasActiveNodeStateSnapshot([
    ['new-node', { activeState: 'passive', activeReasons: [] }],
  ]);
  syncCanvasRuntimeVisualStateSnapshot([
    ['new-node', {
      scheduledRenderTier: 'minimal',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
  ]);

  const decision = resolveCanvasNodeDomWindowing({
    nodes: [node],
    visibleNodes,
    visibilityFresh: false,
  });

  assert.deepEqual(Array.from(decision.detachedNodeIds), []);
  assert.equal(decision.nodeRenderPlan.get('new-node')?.mode, 'proxy');
  assert.equal(decision.nodeRenderPlan.get('new-node')?.renderTier, 'compact');
  clearRuntimeState();
});

test('dom windowing restores a previously detached node when fresh visibility marks it visible', () => {
  clearRuntimeState();
  const returningNode = createImageNode('returning');
  const visibleNodes: VisibleNodeMap = new Map([
    ['returning', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
      visibleAreaRatio: 1,
      visibilityScore: 1,
      visibilityScoreBucket: 'ready',
      visibilityAreaBucket: 'ready',
    })],
  ]);

  syncCanvasActiveNodeStateSnapshot([
    ['returning', { activeState: 'passive', activeReasons: [] }],
  ]);
  syncCanvasRuntimeVisualStateSnapshot([
    ['returning', {
      scheduledRenderTier: 'full',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
  ]);

  const decision = resolveCanvasNodeDomWindowing({
    nodes: [returningNode],
    edges: [{ id: 'edge-returning', source: 'returning', target: 'returning' }],
    visibleNodes,
    visibilityFresh: true,
  });

  assert.deepEqual(Array.from(decision.detachedNodeIds), []);
  assert.deepEqual(Array.from(decision.placeholderNodeIds), []);
  assert.deepEqual(Array.from(decision.hiddenEdgeIds), []);
  assert.equal(decision.nodeRenderPlan.get('returning')?.mode, 'full');
  assert.equal(decision.nodeRenderPlan.get('returning')?.renderTier, 'full');
  assert.equal(shouldDetachCanvasNodeDom(returningNode, visibleNodes), false);
  clearRuntimeState();
});

test('dom windowing still detaches only offscreen passive minimal nodes in large canvases', () => {
  clearRuntimeState();
  const nodes = Array.from({ length: 120 }, (_unused, index) => (
    createImageNode(`node-${index}`)
  ));
  const visibleNodes: VisibleNodeMap = new Map(nodes.map((node, index) => [
    node.id,
    index < 12
      ? createVisibility({
        isVisible: true,
        isNearViewport: true,
        visibilityBucket: 'visible',
        renderTier: 'full',
        visibleAreaRatio: 1,
        visibilityScore: 1,
        visibilityScoreBucket: 'ready',
        visibilityAreaBucket: 'ready',
      })
      : createVisibility(),
  ]));

  syncCanvasActiveNodeStateSnapshot(nodes.map((node) => [
    node.id,
    { activeState: 'passive', activeReasons: [] },
  ]));
  syncCanvasRuntimeVisualStateSnapshot(nodes.map((node, index) => [
    node.id,
    {
      scheduledRenderTier: index < 12 ? 'full' : 'minimal',
      canvasState: { activeState: 'passive', activeReasons: [] },
    },
  ]));

  const decision = resolveCanvasNodeDomWindowing({
    nodes,
    edges: [
      { id: 'edge-visible', source: 'node-0', target: 'node-1' },
      { id: 'edge-detached', source: 'node-0', target: 'node-80' },
    ],
    visibleNodes,
    visibilityFresh: true,
  });

  assert.equal(decision.detachedNodeIds.size, 108);
  assert.equal(decision.placeholderNodeIds.has('node-0'), false);
  assert.equal(decision.placeholderNodeIds.has('node-80'), true);
  assert.equal(decision.hiddenEdgeIds.has('edge-visible'), false);
  assert.equal(decision.hiddenEdgeIds.has('edge-detached'), true);
  clearRuntimeState();
});

test('dom windowing keeps large visible image canvases on proxy path', () => {
  clearRuntimeState();
  const nodes = Array.from({ length: 232 }, (_unused, index) => (
    createImageNode(`image-${index}`, {
      position: { x: index * 220, y: 0 },
    }, {
      position: { x: index * 220, y: 0 },
    })
  ));
  const visibleNodes = computeVisibleNodes({
    nodes,
    viewport: { x: 0, y: 0, zoom: 0.7 },
    containerSize: { width: 1280, height: 720 },
  });

  syncCanvasActiveNodeStateSnapshot(nodes.map((node) => [
    node.id,
    { activeState: 'passive', activeReasons: [] },
  ]));
  syncCanvasRuntimeVisualStateSnapshot(nodes.map((node) => [
    node.id,
    {
      scheduledRenderTier: visibleNodes.get(node.id)?.renderTier ?? 'minimal',
      canvasState: { activeState: 'passive', activeReasons: [] },
    },
  ]));

  const decision = resolveCanvasNodeDomWindowing({
    nodes,
    visibleNodes,
    visibilityFresh: true,
  });
  const fullImageNodeCount = Array.from(decision.nodeRenderPlan.values())
    .filter((entry) => entry.mode === 'full')
    .length;
  const proxyImageNodeCount = Array.from(decision.nodeRenderPlan.values())
    .filter((entry) => entry.mode === 'proxy')
    .length;

  assert.equal(fullImageNodeCount, 0);
  assert.equal(proxyImageNodeCount > 0, true);
  assert.equal(visibleNodes.get('image-0')?.renderTier, 'compact');
  assert.equal(decision.nodeRenderPlan.get('image-0')?.mode, 'proxy');
  clearRuntimeState();
});

test('floating inpaint editor keeps node visible even when only the editor intersects the viewport', () => {
  clearRuntimeState();
  const inpaintNode = createInpaintNode('inpaint', {
    position: { x: 80, y: 740 },
  }, {
    position: { x: 80, y: 740 },
  });
  const visibleNodes = computeVisibleNodes({
    nodes: [inpaintNode],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerSize: { width: 1280, height: 720 },
    overscan: 0,
  });

  syncCanvasActiveNodeStateSnapshot([
    ['inpaint', { activeState: 'passive', activeReasons: [] }],
  ]);
  syncCanvasRuntimeVisualStateSnapshot([
    ['inpaint', {
      scheduledRenderTier: 'full',
      canvasState: { activeState: 'passive', activeReasons: [] },
    }],
  ]);

  const visibility = visibleNodes.get('inpaint');
  const editorSize = resolveAIImageInpaintEditorSize({
    editorHeight: AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
  });
  assert.equal(visibility?.isVisible, true);
  assert.equal(visibility?.renderTier, 'full');
  assert.equal(
    visibility?.displayHeight,
    460
      + editorSize.totalHeight
      + AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP
      + AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP
      + AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT,
  );
  assert.equal(shouldDetachCanvasNodeDom(inpaintNode, visibleNodes), false);
  clearRuntimeState();
});
