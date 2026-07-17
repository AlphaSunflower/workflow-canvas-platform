import test from 'node:test';
import assert from 'node:assert/strict';
import type { Edge, Node } from 'reactflow';

import type { AINodeData, AnyNodeData, FileNodeData } from '@/types';
import type { VisibleNodeMap, VisibleNodeState } from '@/hooks/canvas/useVisibleNodes';

import {
  clearCanvasActiveNodeStateSnapshot,
  syncCanvasActiveNodeStateSnapshot,
} from './canvas-active-node-state';
import {
  clearCanvasRuntimeVisualStateSnapshot,
  syncCanvasRuntimeVisualStateSnapshot,
} from './canvas-runtime-visual-state';
import { buildCanvasRenderPlan } from './canvas-render-plan';

const PLACEHOLDER_NODE_TYPE = '__canvasDomWindowPlaceholder';

function createImageNode(
  id: string,
  overrides: Partial<Node<FileNodeData>> = {},
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

function createAIImageGenNode(id: string): Node<AnyNodeData> {
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
  };

  return {
    id,
    type: 'aiImageGen',
    position: data.position,
    data,
    width: data.dimensions.width,
    height: data.dimensions.height,
    selected: false,
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

function syncPassiveRuntime(nodes: Array<Node<AnyNodeData>>, visibleNodes: VisibleNodeMap): void {
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
}

test('buildCanvasRenderPlan wraps dom windowing output into rendered nodes and edges', () => {
  clearRuntimeState();
  const detached = createImageNode('detached', {
    className: 'custom-node-class',
  });
  const visible = createImageNode('visible');
  const nodes = [detached, visible];
  const edges: Edge[] = [
    { id: 'edge-detached', source: 'detached', target: 'visible' },
    { id: 'edge-visible', source: 'visible', target: 'visible' },
  ];
  const visibleNodes: VisibleNodeMap = new Map([
    ['detached', createVisibility()],
    ['visible', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      visibleAreaRatio: 1,
      visibilityScore: 1,
      visibilityScoreBucket: 'ready',
      visibilityAreaBucket: 'ready',
      renderTier: 'full',
    })],
  ]);

  syncPassiveRuntime(nodes, visibleNodes);
  const plan = buildCanvasRenderPlan({
    nodes,
    edges,
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.deepEqual(Array.from(plan.placeholderNodeIds), ['detached']);
  assert.deepEqual(Array.from(plan.detachedNodeIds), ['detached']);
  assert.deepEqual(Array.from(plan.hiddenEdgeIds), ['edge-detached']);
  assert.deepEqual(plan.renderedEdges.map((edge) => edge.id), ['edge-visible']);
  assert.equal(plan.renderedNodes[0]?.type, PLACEHOLDER_NODE_TYPE);
  assert.equal(plan.renderedNodes[0]?.selected, false);
  assert.equal(plan.renderedNodes[0]?.draggable, false);
  assert.equal(plan.renderedNodes[0]?.selectable, false);
  assert.equal(plan.renderedNodes[0]?.connectable, false);
  assert.equal(plan.renderedNodes[0]?.focusable, false);
  assert.equal(plan.renderedNodes[0]?.className, 'custom-node-class canvas-dom-window-placeholder-node');
  assert.equal(plan.renderedNodes[1]?.id, visible.id);
  assert.equal((plan.renderedNodes[1]?.data as FileNodeData | undefined)?.renderTier, 'full');
  assert.equal(plan.nodeRenderModes.get('detached'), 'placeholder');
  assert.equal(plan.nodeRenderModes.get('visible'), 'full');
  assert.equal(plan.nodeRenderTiers.get('detached'), 'minimal');
  assert.equal(plan.nodeRenderTiers.get('visible'), 'full');
  assert.deepEqual(Array.from(plan.fullNodeIds), ['visible']);
  assert.equal((plan.renderedNodes[1]?.data as FileNodeData | undefined)?.imageResourceOwner, 'raster');
  assert.equal(plan.diagnostics.imageShellNodeCount, 1);
  assert.equal(plan.diagnostics.imageObjectLayerCount, 1);
  assert.equal(plan.diagnostics.imageFullDomNodeCount, 0);
  clearRuntimeState();
});

test('buildCanvasRenderPlan can keep passive full images on DOM owner when object layer is disabled', () => {
  clearRuntimeState();
  const visible = createImageNode('visible');
  const visibleNodes: VisibleNodeMap = new Map([
    ['visible', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      visibleAreaRatio: 1,
      visibilityScore: 1,
      visibilityScoreBucket: 'ready',
      visibilityAreaBucket: 'ready',
      renderTier: 'full',
    })],
  ]);

  syncPassiveRuntime([visible], visibleNodes);
  const plan = buildCanvasRenderPlan({
    nodes: [visible],
    edges: [],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
    imageObjectLayerEnabled: false,
  });

  assert.equal(plan.nodeRenderModes.get('visible'), 'full');
  assert.equal(plan.nodeRenderTiers.get('visible'), 'full');
  assert.equal((plan.renderedNodes[0]?.data as FileNodeData | undefined)?.imageResourceOwner, 'dom');
  assert.equal(plan.diagnostics.imageFullDomNodeCount, 1);
  assert.equal(plan.diagnostics.imageShellNodeCount, 0);
  assert.equal(plan.diagnostics.imageObjectLayerCount, 0);
  clearRuntimeState();
});

test('buildCanvasRenderPlan routes compact image nodes to proxy without hiding edges', () => {
  clearRuntimeState();
  const compact = createImageNode('compact');
  const visible = createImageNode('visible');
  const visibleNodes: VisibleNodeMap = new Map([
    ['compact', createVisibility({
      visibilityBucket: 'far',
      renderTier: 'compact',
    })],
    ['visible', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
  ]);

  syncPassiveRuntime([compact, visible], visibleNodes);
  const plan = buildCanvasRenderPlan({
    nodes: [compact, visible],
    edges: [{ id: 'edge-compact', source: 'compact', target: 'visible' }],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.equal(plan.nodeRenderModes.get('compact'), 'proxy');
  assert.equal(plan.nodeRenderTiers.get('compact'), 'compact');
  assert.equal(plan.proxyNodeIds.has('compact'), true);
  assert.equal(plan.placeholderNodeIds.has('compact'), false);
  assert.equal(plan.hiddenEdgeIds.has('edge-compact'), false);
  assert.equal(plan.renderedNodes[0]?.type, 'image');
  assert.equal((plan.renderedNodes[0]?.data as FileNodeData | undefined)?.renderTier, 'compact');
  assert.equal((plan.renderedNodes[0]?.data as FileNodeData | undefined)?.imageResourceOwner, 'raster');
  clearRuntimeState();
});

test('buildCanvasRenderPlan keeps business edges rendered unless an endpoint is placeholdered', () => {
  clearRuntimeState();
  const source = createImageNode('source');
  const target = createImageNode('target');
  const visibleNodes: VisibleNodeMap = new Map([
    ['source', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
    ['target', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
  ]);
  const edges: Edge[] = [
    {
      id: 'file-reference-edge',
      source: 'source',
      target: 'target',
      data: { connectionType: 'file-reference' },
    },
    {
      id: 'output-link-edge',
      source: 'source',
      target: 'target',
      data: { connectionType: 'output-link' },
    },
  ];

  syncPassiveRuntime([source, target], visibleNodes);
  const plan = buildCanvasRenderPlan({
    nodes: [source, target],
    edges,
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.deepEqual(Array.from(plan.hiddenEdgeIds), []);
  assert.deepEqual(plan.renderedEdges.map((edge) => edge.id), ['file-reference-edge', 'output-link-edge']);
  clearRuntimeState();
});

test('buildCanvasRenderPlan hides business edges only while an endpoint is placeholdered', () => {
  clearRuntimeState();
  const source = createImageNode('source');
  const detached = createImageNode('detached');
  const visibleNodes: VisibleNodeMap = new Map([
    ['source', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
    ['detached', createVisibility()],
  ]);
  const edges: Edge[] = [
    {
      id: 'file-reference-hidden',
      source: 'source',
      target: 'detached',
      data: { connectionType: 'file-reference' },
    },
    {
      id: 'output-link-hidden',
      source: 'detached',
      target: 'source',
      data: { connectionType: 'output-link' },
    },
  ];

  syncPassiveRuntime([source, detached], visibleNodes);
  const hiddenPlan = buildCanvasRenderPlan({
    nodes: [source, detached],
    edges,
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.deepEqual(
    Array.from(hiddenPlan.hiddenEdgeIds).sort(),
    ['file-reference-hidden', 'output-link-hidden'],
  );
  assert.deepEqual(hiddenPlan.renderedEdges, []);
  assert.deepEqual(edges.map((edge) => edge.id), ['file-reference-hidden', 'output-link-hidden']);

  const restoredVisibleNodes: VisibleNodeMap = new Map([
    ['source', visibleNodes.get('source')!],
    ['detached', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
  ]);
  syncPassiveRuntime([source, detached], restoredVisibleNodes);
  const restoredPlan = buildCanvasRenderPlan({
    nodes: [source, detached],
    edges,
    visibleNodes: restoredVisibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.deepEqual(Array.from(restoredPlan.hiddenEdgeIds), []);
  assert.deepEqual(restoredPlan.renderedEdges.map((edge) => edge.id), ['file-reference-hidden', 'output-link-hidden']);
  clearRuntimeState();
});

test('buildCanvasRenderPlan keeps selected images lightweight while active images go full DOM', () => {
  clearRuntimeState();
  const selected = createImageNode('selected', { selected: true });
  const importing = createImageNode('importing');
  const active = createImageNode('active');
  const nodes = [selected, importing, active];
  const visibleNodes: VisibleNodeMap = new Map([
    ['selected', createVisibility({ isSelected: true, visibilityBucket: 'far', renderTier: 'compact' })],
    ['importing', createVisibility({ isImporting: true })],
    ['active', createVisibility()],
  ]);
  const activeNodeStates = new Map([
    ['active', { activeState: 'active' as const, activeReasons: ['dragging' as const] }],
  ]);

  syncPassiveRuntime(nodes, visibleNodes);
  const plan = buildCanvasRenderPlan({
    nodes,
    edges: [],
    visibleNodes,
    activeNodeStates,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.equal(plan.nodeRenderModes.get('selected'), 'proxy');
  assert.equal(plan.nodeRenderModes.get('active'), 'full');
  assert.equal(plan.nodeRenderTiers.get('selected'), 'compact');
  assert.equal(plan.nodeRenderTiers.get('active'), 'full');
  assert.equal((plan.renderedNodes[0]?.data as FileNodeData | undefined)?.imageResourceOwner, 'raster');
  assert.equal((plan.renderedNodes[0]?.data as FileNodeData | undefined)?.activeState, 'passive');
  assert.equal((plan.renderedNodes[2]?.data as FileNodeData | undefined)?.imageResourceOwner, 'dom');
  assert.equal(plan.diagnostics.imageFullDomNodeCount, 1);
  assert.equal(plan.diagnostics.imageShellNodeCount, 0);
  assert.equal(plan.diagnostics.imageObjectLayerCount, 1);
  assert.equal(plan.placeholderNodeIds.has('selected'), false);
  assert.equal(plan.placeholderNodeIds.has('active'), false);
  assert.equal(plan.placeholderNodeIds.has('importing'), true);
  clearRuntimeState();
});

test('buildCanvasRenderPlan keeps offscreen importing image nodes lightweight', () => {
  const importing = createImageNode('importing');
  const visibleNodes: VisibleNodeMap = new Map([
    ['importing', createVisibility({ isImporting: true, renderTier: 'minimal' })],
  ]);

  const plan = buildCanvasRenderPlan({
    nodes: [importing],
    edges: [],
    visibleNodes,
    activeNodeStates: new Map([
      ['importing', { activeState: 'passive', activeReasons: [] }],
    ]),
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.equal(plan.nodeRenderTiers.get('importing'), 'minimal');
  assert.equal(plan.nodeRenderModes.get('importing'), 'placeholder');
  assert.equal((plan.renderedNodes[0]?.data as FileNodeData | undefined)?.imageResourceOwner, 'none');
  assert.equal(plan.placeholderNodeIds.has('importing'), true);
  assert.equal(plan.fullNodeIds.has('importing'), false);
});

test('buildCanvasRenderPlan keeps initial offscreen importing images operable on proxy path without forced visibility', () => {
  clearRuntimeState();
  const importing = createImageNode('initial-offscreen-importing');

  const plan = buildCanvasRenderPlan({
    nodes: [importing],
    edges: [],
    visibleNodes: new Map(),
    activeNodeStates: new Map([
      ['initial-offscreen-importing', { activeState: 'passive', activeReasons: [] }],
    ]),
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.equal(plan.nodeRenderModes.get('initial-offscreen-importing'), 'proxy');
  assert.equal(plan.nodeRenderTiers.get('initial-offscreen-importing'), 'compact');
  assert.equal(plan.placeholderNodeIds.has('initial-offscreen-importing'), false);
  assert.equal((plan.renderedNodes[0]?.data as FileNodeData | undefined)?.imageResourceOwner, 'raster');
  clearRuntimeState();
});

test('buildCanvasRenderPlan restores returning importing image candidates to proxy DOM', () => {
  clearRuntimeState();
  const importing = createImageNode('returning-importing');
  const visibleNodes: VisibleNodeMap = new Map([
    ['returning-importing', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      isImporting: true,
      renderTier: 'compact',
    })],
  ]);

  const plan = buildCanvasRenderPlan({
    nodes: [importing],
    edges: [],
    visibleNodes,
    activeNodeStates: new Map([
      ['returning-importing', { activeState: 'passive', activeReasons: [] }],
    ]),
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.equal(plan.nodeRenderModes.get('returning-importing'), 'proxy');
  assert.equal(plan.nodeRenderTiers.get('returning-importing'), 'compact');
  assert.equal(plan.placeholderNodeIds.has('returning-importing'), false);
  assert.equal((plan.renderedNodes[0]?.data as FileNodeData | undefined)?.imageResourceOwner, 'raster');
  clearRuntimeState();
});

test('buildCanvasRenderPlan keeps visible importing images on compact proxy until active', () => {
  clearRuntimeState();
  const importing = createImageNode('importing');
  const activeImporting = createImageNode('active-importing');
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

  syncPassiveRuntime([importing, activeImporting], visibleNodes);
  const plan = buildCanvasRenderPlan({
    nodes: [importing, activeImporting],
    edges: [],
    visibleNodes,
    activeNodeStates: new Map([
      ['active-importing', { activeState: 'active', activeReasons: ['viewer'] }],
    ]),
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.equal(plan.nodeRenderModes.get('importing'), 'proxy');
  assert.equal(plan.nodeRenderTiers.get('importing'), 'compact');
  assert.equal(plan.proxyNodeIds.has('importing'), true);
  assert.equal(plan.fullNodeIds.has('importing'), false);
  assert.equal(plan.nodeRenderModes.get('active-importing'), 'full');
  assert.equal(plan.nodeRenderTiers.get('active-importing'), 'full');
  assert.equal((plan.renderedNodes[0]?.data as FileNodeData | undefined)?.imageResourceOwner, 'raster');
  assert.equal((plan.renderedNodes[1]?.data as FileNodeData | undefined)?.imageResourceOwner, 'dom');
  assert.equal(plan.fullNodeIds.has('active-importing'), true);
  clearRuntimeState();
});

test('buildCanvasRenderPlan keeps bulk visible importing images compact while preserving active promotion', () => {
  clearRuntimeState();
  const nodes = Array.from({ length: 20 }, (_, index) => createImageNode(`importing-${index}`));
  const visibleNodes: VisibleNodeMap = new Map(nodes.map((node) => [
    node.id,
    createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      visibilityScoreBucket: 'import-priority',
      visibilityAreaBucket: 'ready',
      visibleAreaRatio: 1,
      visibilityScore: 1,
      isImporting: true,
      renderTier: 'compact',
    }),
  ]));
  const activeNodeStates = new Map([
    ['importing-0', { activeState: 'active' as const, activeReasons: ['selected' as const] }],
    ['importing-1', { activeState: 'active' as const, activeReasons: ['hovered' as const] }],
  ]);

  syncPassiveRuntime(nodes, visibleNodes);
  const plan = buildCanvasRenderPlan({
    nodes,
    edges: [],
    visibleNodes,
    activeNodeStates,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.equal(plan.fullNodeIds.has('importing-0'), true);
  assert.equal(plan.fullNodeIds.has('importing-1'), true);
  assert.equal(plan.proxyNodeIds.size, 18);
  assert.equal(plan.diagnostics.fullNodeCount, 2);
  assert.equal(plan.diagnostics.compactNodeCount, 18);
  nodes.slice(2).forEach((node) => {
    assert.equal(plan.nodeRenderModes.get(node.id), 'proxy');
    assert.equal(plan.nodeRenderTiers.get(node.id), 'compact');
    const renderedNode = plan.renderedNodes.find((item) => item.id === node.id);
    assert.equal((renderedNode?.data as FileNodeData | undefined)?.imageResourceOwner, 'raster');
  });
  clearRuntimeState();
});

test('buildCanvasRenderPlan keeps large stable image canvases proxy-first', () => {
  clearRuntimeState();
  const nodes = Array.from({ length: 232 }, (_, index) => createImageNode(`image-${index}`));
  const visibleNodes: VisibleNodeMap = new Map(nodes.map((node, index) => [
    node.id,
    index < 120
      ? createVisibility({
        isVisible: index < 60,
        isNearViewport: true,
        visibilityBucket: index < 60 ? 'visible' : 'near',
        visibilityScoreBucket: 'ready',
        visibilityAreaBucket: index < 60 ? 'ready' : 'defer',
        visibleAreaRatio: index < 60 ? 1 : 0,
        visibilityScore: index < 60 ? 1 : 0.4,
        renderTier: index < 60 ? 'compact' : 'minimal',
      })
      : createVisibility(),
  ]));
  syncPassiveRuntime(nodes, visibleNodes);

  const plan = buildCanvasRenderPlan({
    nodes,
    edges: [],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.equal(plan.diagnostics.fullNodeCount, 0);
  assert.equal(plan.diagnostics.proxyNodeCount, 120);
  assert.equal(plan.diagnostics.placeholderNodeCount, 112);
  assert.equal(plan.fullNodeIds.size, 0);
  assert.equal(plan.proxyNodeIds.size, 120);
  assert.equal(plan.rasterEligibleImageNodes.length, 60);
  clearRuntimeState();
});

test('buildCanvasRenderPlan restores returning visible nodes and keeps connected dynamic handles full', () => {
  clearRuntimeState();
  const returning = createImageNode('returning');
  const source = createImageNode('source');
  const aiNode = createAIImageGenNode('ai-gen');
  const visibleNodes: VisibleNodeMap = new Map([
    ['returning', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
    ['source', createVisibility()],
    ['ai-gen', createVisibility()],
  ]);

  syncPassiveRuntime([returning, source, aiNode], visibleNodes);
  const plan = buildCanvasRenderPlan({
    nodes: [returning, source, aiNode],
    edges: [
      { id: 'edge-ai-input', source: 'source', target: 'ai-gen' },
    ],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.equal(plan.nodeRenderModes.get('returning'), 'full');
  assert.equal(plan.nodeRenderModes.get('ai-gen'), 'full');
  assert.equal(plan.nodeRenderTiers.get('ai-gen'), 'full');
  assert.equal(plan.placeholderNodeIds.has('returning'), false);
  assert.equal(plan.placeholderNodeIds.has('ai-gen'), false);
  assert.equal(plan.placeholderNodeIds.has('source'), true);
  assert.equal(plan.hiddenEdgeIds.has('edge-ai-input'), true);
  clearRuntimeState();
});

test('buildCanvasRenderPlan exposes raster candidates from the same visibility plan', () => {
  clearRuntimeState();
  const visibleImage = createImageNode('visible-image');
  const nearImage = createImageNode('near-image');
  const compactImage = createImageNode('compact-image');
  const farCompactImage = createImageNode('far-compact-image');
  const detachedImage = createImageNode('detached-image');
  const nodes = [visibleImage, nearImage, compactImage, farCompactImage, detachedImage];
  const visibleNodes: VisibleNodeMap = new Map([
    ['visible-image', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
    ['near-image', createVisibility({
      isVisible: false,
      isNearViewport: true,
      visibilityBucket: 'near',
      renderTier: 'full',
    })],
    ['compact-image', createVisibility({
      isVisible: false,
      isNearViewport: true,
      visibilityBucket: 'near',
      renderTier: 'compact',
    })],
    ['far-compact-image', createVisibility({
      isVisible: false,
      isNearViewport: false,
      visibilityBucket: 'far',
      renderTier: 'compact',
    })],
    ['detached-image', createVisibility()],
  ]);

  syncPassiveRuntime(nodes, visibleNodes);
  const plan = buildCanvasRenderPlan({
    nodes,
    edges: [],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.deepEqual(
    Array.from(plan.rasterEligibleNodeIds).sort(),
    ['compact-image', 'near-image', 'visible-image'],
  );
  assert.deepEqual(
    plan.rasterEligibleImageNodes.map((node) => node.id),
    ['visible-image', 'near-image', 'compact-image'],
  );
  assert.deepEqual(
    plan.imageNodeIds,
    ['visible-image', 'near-image', 'compact-image', 'far-compact-image', 'detached-image'],
  );
  assert.equal(
    plan.rasterEligibleImageNodes[0],
    plan.renderedNodes.find((node) => node.id === 'visible-image'),
  );
  assert.equal(
    plan.rasterEligibleImageNodes[1],
    plan.renderedNodes.find((node) => node.id === 'near-image'),
  );
  assert.equal(
    plan.rasterEligibleImageNodes[2],
    plan.renderedNodes.find((node) => node.id === 'compact-image'),
  );
  assert.equal((plan.rasterEligibleImageNodes[0]?.data as FileNodeData | undefined)?.imageResourceOwner, 'raster');
  assert.equal((plan.rasterEligibleImageNodes[1]?.data as FileNodeData | undefined)?.imageResourceOwner, 'raster');
  assert.equal((plan.rasterEligibleImageNodes[2]?.data as FileNodeData | undefined)?.imageResourceOwner, 'raster');
  assert.equal(plan.rasterEligibleImageNodes.includes(compactImage as never), false);
  assert.equal(plan.rasterEligibleImageNodes.includes(farCompactImage as never), false);
  assert.equal(plan.rasterEligibleImageNodes.includes(detachedImage as never), false);
  assert.equal(plan.rasterEligibleNodeIds.has('compact-image'), true);
  assert.equal(plan.rasterEligibleNodeIds.has('far-compact-image'), false);
  assert.equal(plan.rasterEligibleNodeIds.has('detached-image'), false);
  clearRuntimeState();
});

test('buildCanvasRenderPlan exposes raster candidates with rendered owner state for full proxy shells', () => {
  clearRuntimeState();
  const image = createImageNode('full-raster');
  const nodes = [image];
  const visibleNodes: VisibleNodeMap = new Map([
    ['full-raster', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
  ]);

  syncPassiveRuntime(nodes, visibleNodes);
  const plan = buildCanvasRenderPlan({
    nodes,
    edges: [],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  const renderedNode = plan.renderedNodes.find((node) => node.id === 'full-raster');
  assert.equal(plan.rasterEligibleImageNodes[0], renderedNode);
  assert.equal((renderedNode?.data as FileNodeData | undefined)?.imageResourceOwner, 'raster');
  assert.equal((plan.rasterEligibleImageNodes[0]?.data as FileNodeData | undefined)?.imageResourceOwner, 'raster');
  clearRuntimeState();
});

test('buildCanvasRenderPlan keeps previous render plan when visibility is not fresh', () => {
  clearRuntimeState();
  const node = createImageNode('offscreen');
  const visibleNodes: VisibleNodeMap = new Map([
    ['offscreen', createVisibility()],
  ]);

  syncPassiveRuntime([node], visibleNodes);
  const firstPlan = buildCanvasRenderPlan({
    nodes: [node],
    edges: [],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });
  const plan = buildCanvasRenderPlan({
    nodes: [node],
    edges: [],
    visibleNodes,
    visibilityFresh: false,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
    previousCache: firstPlan.cache,
  });

  assert.deepEqual(Array.from(plan.placeholderNodeIds), ['offscreen']);
  assert.deepEqual(Array.from(plan.detachedNodeIds), ['offscreen']);
  assert.equal(plan.renderedNodes[0], firstPlan.renderedNodes[0]);
  assert.equal(plan.nodeRenderModes.get('offscreen'), 'placeholder');
  assert.equal(plan.nodeRenderTiers.get('offscreen'), 'minimal');
  assert.equal(plan.diagnostics.reusedNodeCount, 1);
  clearRuntimeState();
});

test('buildCanvasRenderPlan falls back to proxy for stale image nodes without previous cache', () => {
  clearRuntimeState();
  const node = createImageNode('offscreen');
  const visibleNodes: VisibleNodeMap = new Map([
    ['offscreen', createVisibility()],
  ]);

  syncPassiveRuntime([node], visibleNodes);
  const plan = buildCanvasRenderPlan({
    nodes: [node],
    edges: [],
    visibleNodes,
    visibilityFresh: false,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  assert.deepEqual(Array.from(plan.placeholderNodeIds), []);
  assert.equal(plan.nodeRenderModes.get('offscreen'), 'proxy');
  assert.equal(plan.nodeRenderTiers.get('offscreen'), 'compact');
  clearRuntimeState();
});

test('buildCanvasRenderPlan reuses rendered node references when render signatures are unchanged', () => {
  clearRuntimeState();
  const full = createImageNode('full');
  const compact = createImageNode('compact');
  const placeholder = createImageNode('placeholder');
  const nodes = [full, compact, placeholder];
  const visibleNodes: VisibleNodeMap = new Map([
    ['full', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
    ['compact', createVisibility({
      visibilityBucket: 'far',
      renderTier: 'compact',
    })],
    ['placeholder', createVisibility({
      visibilityBucket: 'offscreen',
      renderTier: 'minimal',
    })],
  ]);

  syncPassiveRuntime(nodes, visibleNodes);
  const firstPlan = buildCanvasRenderPlan({
    nodes,
    edges: [],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });
  const secondPlan = buildCanvasRenderPlan({
    nodes,
    edges: [],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
    previousCache: firstPlan.cache,
  });

  assert.equal(secondPlan.renderedNodes[0], firstPlan.renderedNodes[0]);
  assert.equal(secondPlan.renderedNodes[1], firstPlan.renderedNodes[1]);
  assert.equal(secondPlan.renderedNodes[2], firstPlan.renderedNodes[2]);
  assert.equal(secondPlan.diagnostics.reusedNodeCount, 3);
  assert.equal(secondPlan.diagnostics.createdNodeCount, 0);
  clearRuntimeState();
});

test('buildCanvasRenderPlan preserves references across large unchanged render plans', () => {
  clearRuntimeState();
  const nodes = Array.from({ length: 120 }, (_, index) => createImageNode(`image-${index}`));
  const visibleNodes: VisibleNodeMap = new Map(nodes.map((node, index) => [
    node.id,
    createVisibility(index % 3 === 0
      ? {
        isVisible: true,
        isNearViewport: true,
        visibilityBucket: 'visible',
        visibilityScoreBucket: 'ready',
        visibilityAreaBucket: 'ready',
        visibleAreaRatio: 1,
        visibilityScore: 1,
        renderTier: 'full',
      }
      : index % 3 === 1
        ? {
          isNearViewport: true,
          visibilityBucket: 'near',
          renderTier: 'compact',
        }
        : {
          visibilityBucket: 'offscreen',
          renderTier: 'minimal',
        }),
  ]));

  syncPassiveRuntime(nodes, visibleNodes);
  const firstPlan = buildCanvasRenderPlan({
    nodes,
    edges: [],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });
  const secondPlan = buildCanvasRenderPlan({
    nodes,
    edges: [],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
    previousCache: firstPlan.cache,
  });

  assert.equal(secondPlan.renderedNodes.length, firstPlan.renderedNodes.length);
  assert.equal(secondPlan.renderedNodes.every((node, index) => node === firstPlan.renderedNodes[index]), true);
  assert.equal(secondPlan.placeholderNodeIds, firstPlan.placeholderNodeIds);
  assert.equal(secondPlan.detachedNodeIds, firstPlan.detachedNodeIds);
  assert.equal(secondPlan.rasterEligibleNodeIds, firstPlan.rasterEligibleNodeIds);
  assert.equal(secondPlan.rasterEligibleImageNodes, firstPlan.rasterEligibleImageNodes);
  assert.equal(secondPlan.fullNodeIds, firstPlan.fullNodeIds);
  assert.equal(secondPlan.proxyNodeIds, firstPlan.proxyNodeIds);
  assert.equal(secondPlan.diagnostics.reusedNodeCount, nodes.length);
  assert.equal(secondPlan.diagnostics.createdNodeCount, 0);
  clearRuntimeState();
});

test('buildCanvasRenderPlan creates new node objects when source node mode tier or active signature changes', () => {
  clearRuntimeState();
  const stable = createImageNode('stable');
  const tierChange = createImageNode('tier-change');
  const activeChange = createImageNode('active-change');
  const sourceChange = createImageNode('source-change');
  const nodes = [stable, tierChange, activeChange, sourceChange];
  const firstVisibleNodes: VisibleNodeMap = new Map([
    ['stable', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
    ['tier-change', createVisibility({
      visibilityBucket: 'far',
      renderTier: 'compact',
    })],
    ['active-change', createVisibility({
      visibilityBucket: 'offscreen',
      renderTier: 'minimal',
    })],
    ['source-change', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
  ]);

  syncPassiveRuntime(nodes, firstVisibleNodes);
  const firstPlan = buildCanvasRenderPlan({
    nodes,
    edges: [],
    visibleNodes: firstVisibleNodes,
    activeNodeStates: new Map([
      ['active-change', { activeState: 'passive', activeReasons: [] }],
    ]),
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  const replacedSource = createImageNode('source-change', {
    position: { x: 10, y: 20 },
  });
  const nextNodes = [stable, tierChange, activeChange, replacedSource];
  const nextVisibleNodes: VisibleNodeMap = new Map([
    ['stable', firstVisibleNodes.get('stable')!],
    ['tier-change', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
    ['active-change', firstVisibleNodes.get('active-change')!],
    ['source-change', firstVisibleNodes.get('source-change')!],
  ]);

  syncPassiveRuntime(nextNodes, nextVisibleNodes);
  const secondPlan = buildCanvasRenderPlan({
    nodes: nextNodes,
    edges: [],
    visibleNodes: nextVisibleNodes,
    activeNodeStates: new Map([
      ['active-change', { activeState: 'active', activeReasons: ['selected'] }],
    ]),
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
    previousCache: firstPlan.cache,
  });

  assert.equal(secondPlan.renderedNodes[0], firstPlan.renderedNodes[0]);
  assert.notStrictEqual(secondPlan.renderedNodes[1], firstPlan.renderedNodes[1]);
  assert.notStrictEqual(secondPlan.renderedNodes[2], firstPlan.renderedNodes[2]);
  assert.notStrictEqual(secondPlan.renderedNodes[3], firstPlan.renderedNodes[3]);
  assert.equal(secondPlan.nodeRenderModes.get('tier-change'), 'full');
  assert.equal(secondPlan.nodeRenderTiers.get('tier-change'), 'full');
  assert.equal(secondPlan.nodeRenderModes.get('active-change'), 'full');
  assert.equal(secondPlan.nodeRenderTiers.get('active-change'), 'full');
  assert.equal(secondPlan.diagnostics.reusedNodeCount, 1);
  assert.equal(secondPlan.diagnostics.createdNodeCount, 3);
  clearRuntimeState();
});

test('buildCanvasRenderPlan reuses rendered edges and stable collection references when hidden edges are unchanged', () => {
  clearRuntimeState();
  const source = createImageNode('source');
  const target = createImageNode('target');
  const nodes = [source, target];
  const edges: Edge[] = [
    { id: 'visible-edge', source: 'source', target: 'target' },
  ];
  const visibleNodes: VisibleNodeMap = new Map([
    ['source', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
    ['target', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
  ]);

  syncPassiveRuntime(nodes, visibleNodes);
  const firstPlan = buildCanvasRenderPlan({
    nodes,
    edges,
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });
  const secondPlan = buildCanvasRenderPlan({
    nodes,
    edges,
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
    previousCache: firstPlan.cache,
  });

  assert.equal(secondPlan.renderedEdges, firstPlan.renderedEdges);
  assert.equal(secondPlan.hiddenEdgeIds, firstPlan.hiddenEdgeIds);
  assert.equal(secondPlan.rasterEligibleNodeIds, firstPlan.rasterEligibleNodeIds);
  assert.equal(secondPlan.rasterEligibleImageNodes, firstPlan.rasterEligibleImageNodes);
  assert.equal(secondPlan.imageNodeIds, firstPlan.imageNodeIds);
  assert.equal(secondPlan.fullNodeIds, firstPlan.fullNodeIds);
  assert.equal(secondPlan.proxyNodeIds, firstPlan.proxyNodeIds);
  assert.equal(secondPlan.nodeRenderModes, firstPlan.nodeRenderModes);
  assert.equal(secondPlan.nodeRenderTiers, firstPlan.nodeRenderTiers);
  clearRuntimeState();
});

test('buildCanvasRenderPlan refreshes raster candidate nodes when node references change', () => {
  clearRuntimeState();
  const image = createImageNode('image');
  const nodes = [image];
  const visibleNodes: VisibleNodeMap = new Map([
    ['image', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
  ]);

  syncPassiveRuntime(nodes, visibleNodes);
  const firstPlan = buildCanvasRenderPlan({
    nodes,
    edges: [],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  const movedImage = createImageNode('image', {
    position: { x: 320, y: 240 },
  });
  const nextNodes = [movedImage];
  syncPassiveRuntime(nextNodes, visibleNodes);
  const secondPlan = buildCanvasRenderPlan({
    nodes: nextNodes,
    edges: [],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
    previousCache: firstPlan.cache,
  });

  assert.notStrictEqual(secondPlan.rasterEligibleImageNodes, firstPlan.rasterEligibleImageNodes);
  assert.equal(secondPlan.rasterEligibleImageNodes[0], secondPlan.renderedNodes[0]);
  assert.notStrictEqual(secondPlan.rasterEligibleImageNodes[0], movedImage);
  assert.equal(secondPlan.imageNodeIds, firstPlan.imageNodeIds);
  clearRuntimeState();
});

test('buildCanvasRenderPlan changes raster candidate references only for actual candidate changes', () => {
  clearRuntimeState();
  const stableCandidate = createImageNode('stable-candidate');
  const changingCandidate = createImageNode('changing-candidate');
  const offscreen = createImageNode('offscreen');
  const nodes = [stableCandidate, changingCandidate, offscreen];
  const visibleNodes: VisibleNodeMap = new Map([
    ['stable-candidate', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
    ['changing-candidate', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
    ['offscreen', createVisibility()],
  ]);

  syncPassiveRuntime(nodes, visibleNodes);
  const firstPlan = buildCanvasRenderPlan({
    nodes,
    edges: [],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  const movedCandidate = createImageNode('changing-candidate', {
    position: { x: 64, y: 64 },
  });
  const nextNodes = [stableCandidate, movedCandidate, offscreen];
  syncPassiveRuntime(nextNodes, visibleNodes);
  const secondPlan = buildCanvasRenderPlan({
    nodes: nextNodes,
    edges: [],
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
    previousCache: firstPlan.cache,
  });

  assert.notStrictEqual(secondPlan.rasterEligibleImageNodes, firstPlan.rasterEligibleImageNodes);
  assert.equal(secondPlan.rasterEligibleImageNodes.length, 2);
  assert.equal(secondPlan.rasterEligibleImageNodes[0], firstPlan.rasterEligibleImageNodes[0]);
  assert.equal(secondPlan.rasterEligibleImageNodes[1], secondPlan.renderedNodes[1]);
  assert.notStrictEqual(secondPlan.rasterEligibleImageNodes[1], movedCandidate);
  assert.equal(secondPlan.rasterEligibleNodeIds, firstPlan.rasterEligibleNodeIds);
  assert.equal(secondPlan.imageNodeIds, firstPlan.imageNodeIds);
  clearRuntimeState();
});

test('buildCanvasRenderPlan updates rendered edges when placeholder endpoints hide and restore edges', () => {
  clearRuntimeState();
  const source = createImageNode('source');
  const target = createImageNode('target');
  const nodes = [source, target];
  const edges: Edge[] = [
    { id: 'edge-source-target', source: 'source', target: 'target' },
  ];
  const visibleNodes: VisibleNodeMap = new Map([
    ['source', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
    ['target', createVisibility({
      isVisible: true,
      isNearViewport: true,
      visibilityBucket: 'visible',
      renderTier: 'full',
    })],
  ]);

  syncPassiveRuntime(nodes, visibleNodes);
  const visiblePlan = buildCanvasRenderPlan({
    nodes,
    edges,
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
  });

  const hiddenVisibleNodes: VisibleNodeMap = new Map([
    ['source', visibleNodes.get('source')!],
    ['target', createVisibility({
      visibilityBucket: 'offscreen',
      renderTier: 'minimal',
    })],
  ]);
  syncPassiveRuntime(nodes, hiddenVisibleNodes);
  const hiddenPlan = buildCanvasRenderPlan({
    nodes,
    edges,
    visibleNodes: hiddenVisibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
    previousCache: visiblePlan.cache,
  });

  syncPassiveRuntime(nodes, visibleNodes);
  const restoredPlan = buildCanvasRenderPlan({
    nodes,
    edges,
    visibleNodes,
    placeholderNodeType: PLACEHOLDER_NODE_TYPE,
    previousCache: hiddenPlan.cache,
  });

  assert.deepEqual(visiblePlan.renderedEdges.map((edge) => edge.id), ['edge-source-target']);
  assert.deepEqual(Array.from(hiddenPlan.hiddenEdgeIds), ['edge-source-target']);
  assert.deepEqual(hiddenPlan.renderedEdges, []);
  assert.notStrictEqual(hiddenPlan.renderedEdges, visiblePlan.renderedEdges);
  assert.deepEqual(Array.from(restoredPlan.hiddenEdgeIds), []);
  assert.deepEqual(restoredPlan.renderedEdges.map((edge) => edge.id), ['edge-source-target']);
  assert.notStrictEqual(restoredPlan.renderedEdges, hiddenPlan.renderedEdges);
  clearRuntimeState();
});
