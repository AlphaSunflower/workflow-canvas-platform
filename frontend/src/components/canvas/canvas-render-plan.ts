import type { Edge, Node } from 'reactflow';

import type { VisibleNodeMap } from '@/hooks/canvas/useVisibleNodes';
import type { AnyNodeData, FileNodeData, FileNodeImageResourceOwner, NodeRenderTier } from '@/types';
import type { CanvasActiveNodeStateSnapshot } from './canvas-active-node-state';

import {
  resolveCanvasNodeDomWindowing,
  type CanvasNodeDomWindowingDecision,
  type CanvasNodeDomRenderMode,
  type CanvasNodeDomRenderPlanEntry,
} from './canvas-node-dom-windowing';
import { isCanvasImageObjectLayerEnabled } from './canvas-image-object-layer-flags';

/**
 * Single canvas visibility plan.
 *
 * visibleNodes supplies viewport facts; this module decides node DOM lifecycle
 * (full/proxy/placeholder), edge visibility, render tier, and raster eligibility.
 * Dynamic-handle keepalive belongs here and in DOM windowing, not in React Flow
 * `onlyRenderVisibleElements` switching.
 */
export interface CanvasRenderPlan {
  renderedNodes: Array<Node<AnyNodeData>>;
  renderedEdges: Edge[];
  placeholderNodeIds: Set<string>;
  detachedNodeIds: Set<string>;
  hiddenEdgeIds: Set<string>;
  rasterEligibleNodeIds: Set<string>;
  rasterEligibleImageNodes: Array<Node<AnyNodeData> & { data: FileNodeData & { type: 'image' } }>;
  imageNodeIds: string[];
  nodeRenderModes: Map<string, CanvasNodeDomRenderMode>;
  nodeRenderTiers: Map<string, NodeRenderTier>;
  fullNodeIds: Set<string>;
  proxyNodeIds: Set<string>;
  domWindowing: CanvasNodeDomWindowingDecision;
  diagnostics: CanvasRenderPlanDiagnostics;
  cache: CanvasRenderPlanCache;
}

export interface CanvasRenderPlanDiagnostics {
  nodeCount: number;
  renderedNodeCount: number;
  renderedEdgeCount: number;
  fullNodeCount: number;
  compactNodeCount: number;
  minimalNodeCount: number;
  proxyNodeCount: number;
  imageFullDomNodeCount: number;
  imageShellNodeCount: number;
  imageObjectLayerCount: number;
  placeholderNodeCount: number;
  detachedNodeCount: number;
  hiddenEdgeCount: number;
  rasterEligibleNodeCount: number;
  reusedNodeCount?: number;
  createdNodeCount?: number;
  durationMs: number;
}

export interface BuildCanvasRenderPlanOptions {
  nodes: Array<Node<AnyNodeData>>;
  edges: Edge[];
  visibleNodes: VisibleNodeMap;
  activeNodeStates?: Map<string, CanvasActiveNodeStateSnapshot>;
  visibilityFresh?: boolean;
  runtimeVisualRevision?: number;
  placeholderNodeType: string;
  previousCache?: CanvasRenderPlanCache;
  imageObjectLayerEnabled?: boolean;
}

interface CanvasRenderPlanNodeCacheEntry {
  sourceNode: Node<AnyNodeData>;
  renderedNode: Node<AnyNodeData>;
  signature: string;
}

export interface CanvasRenderPlanCache {
  nodesById: Map<string, CanvasRenderPlanNodeCacheEntry>;
  sourceEdges?: Edge[];
  renderedEdges?: Edge[];
  hiddenEdgeIds?: Set<string>;
  hiddenEdgeIdsSignature?: string;
  placeholderNodeIds?: Set<string>;
  placeholderNodeIdsSignature?: string;
  detachedNodeIds?: Set<string>;
  detachedNodeIdsSignature?: string;
  rasterEligibleNodeIds?: Set<string>;
  rasterEligibleNodeIdsSignature?: string;
  rasterEligibleImageNodes?: Array<Node<AnyNodeData> & { data: FileNodeData & { type: 'image' } }>;
  rasterEligibleImageNodesSignature?: string;
  imageNodeIds?: string[];
  imageNodeIdsSignature?: string;
  fullNodeIds?: Set<string>;
  fullNodeIdsSignature?: string;
  proxyNodeIds?: Set<string>;
  proxyNodeIdsSignature?: string;
  nodeRenderModes?: Map<string, CanvasNodeDomRenderMode>;
  nodeRenderModesSignature?: string;
  nodeRenderTiers?: Map<string, NodeRenderTier>;
  nodeRenderTiersSignature?: string;
  nodeRenderPlan?: Map<string, CanvasNodeDomRenderPlanEntry>;
  nodeRenderPlanSignature?: string;
}

export function createCanvasRenderPlanCache(): CanvasRenderPlanCache {
  return {
    nodesById: new Map(),
  };
}

function createPlaceholderNode(
  node: Node<AnyNodeData>,
  placeholderNodeType: string,
): Node<AnyNodeData> {
  const placeholderData = ['image', 'video', 'ply'].includes(node.data.type)
    ? {
      ...node.data,
      renderTier: 'minimal' as const,
      activeState: 'passive' as const,
      activeReasons: [],
      imageResourceOwner: node.data.type === 'image' ? 'none' as const : undefined,
    } as FileNodeData
    : node.data;

  return {
    ...node,
    type: placeholderNodeType,
    data: placeholderData,
    width: Math.max(1, node.width ?? node.data.dimensions.width),
    height: Math.max(1, node.height ?? node.data.dimensions.height),
    selected: false,
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    dragHandle: undefined,
    className: [
      typeof node.className === 'string' ? node.className : '',
      'canvas-dom-window-placeholder-node',
    ].filter(Boolean).join(' '),
  };
}

function createRenderPlannedNode(
  node: Node<AnyNodeData>,
  renderEntry: CanvasNodeDomRenderPlanEntry | undefined,
  imageObjectLayerEnabled: boolean,
): Node<AnyNodeData> {
  if (
    !renderEntry ||
    !['image', 'video', 'ply'].includes(node.data.type)
  ) {
    return node;
  }

  const imageResourceOwner = resolveImageResourceOwner(renderEntry, node.data.type, imageObjectLayerEnabled);

  return {
    ...node,
    data: {
      ...node.data,
      renderTier: renderEntry.renderTier,
      activeState: renderEntry.activeState,
      activeReasons: renderEntry.activeReasons,
      imageResourceOwner,
    } as FileNodeData,
  } as Node<AnyNodeData>;
}

function resolveImageResourceOwner(
  renderEntry: CanvasNodeDomRenderPlanEntry | undefined,
  nodeType: AnyNodeData['type'],
  imageObjectLayerEnabled: boolean,
): FileNodeImageResourceOwner | undefined {
  if (nodeType !== 'image') {
    return undefined;
  }

  if (!renderEntry || renderEntry.renderTier === 'minimal') {
    return 'none';
  }

  if (renderEntry.activeState === 'active') {
    return 'dom';
  }

  if (renderEntry.renderTier === 'compact') {
    return 'raster';
  }

  if (imageObjectLayerEnabled) {
    return 'raster';
  }

  return 'dom';
}

function buildActiveReasonsSignature(
  activeReasons: CanvasNodeDomRenderPlanEntry['activeReasons'] | undefined,
): string {
  return (activeReasons ?? []).join(',');
}

function buildStringSetSignature(values: ReadonlySet<string>): string {
  return Array.from(values).sort().join('|');
}

function buildStringMapSignature<Value extends string>(
  values: ReadonlyMap<string, Value>,
): string {
  return Array.from(values.entries())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
}

function buildNodeRenderPlanSignature(
  values: ReadonlyMap<string, CanvasNodeDomRenderPlanEntry>,
): string {
  return Array.from(values.entries())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, entry]) => [
      key,
      entry.mode,
      entry.renderTier,
      entry.scheduledRenderTier,
      entry.activeState,
      buildActiveReasonsSignature(entry.activeReasons),
    ].join(':'))
    .join('|');
}

function resolveStableStringSet(options: {
  nextSet: Set<string>;
  previousSet?: Set<string>;
  previousSignature?: string;
}): {
  set: Set<string>;
  signature: string;
} {
  const signature = buildStringSetSignature(options.nextSet);
  if (options.previousSet && options.previousSignature === signature) {
    return {
      set: options.previousSet,
      signature,
    };
  }

  return {
    set: options.nextSet,
    signature,
  };
}

function resolveStableStringMap<Value extends string>(options: {
  nextMap: Map<string, Value>;
  previousMap?: Map<string, Value>;
  previousSignature?: string;
}): {
  map: Map<string, Value>;
  signature: string;
} {
  const signature = buildStringMapSignature(options.nextMap);
  if (options.previousMap && options.previousSignature === signature) {
    return {
      map: options.previousMap,
      signature,
    };
  }

  return {
    map: options.nextMap,
    signature,
  };
}

function buildNodeRenderSignature(
  node: Node<AnyNodeData>,
  mode: CanvasNodeDomRenderMode,
  renderEntry: CanvasNodeDomRenderPlanEntry | undefined,
  placeholderNodeType: string,
  imageObjectLayerEnabled: boolean,
): string {
  const renderTier = renderEntry?.renderTier ?? 'full';
  const activeState = renderEntry?.activeState ?? 'passive';
  const activeReasons = buildActiveReasonsSignature(renderEntry?.activeReasons);
  const imageResourceOwner = resolveImageResourceOwner(renderEntry, node.data.type, imageObjectLayerEnabled) ?? '';
  return [
    mode,
    renderTier,
    activeState,
    activeReasons,
    imageResourceOwner,
    mode === 'placeholder' ? placeholderNodeType : node.type ?? '',
  ].join('|');
}

function createRenderedNodeForPlan(
  node: Node<AnyNodeData>,
  mode: CanvasNodeDomRenderMode,
  renderEntry: CanvasNodeDomRenderPlanEntry | undefined,
  placeholderNodeType: string,
  imageObjectLayerEnabled: boolean,
): Node<AnyNodeData> {
  if (mode === 'placeholder') {
    return createPlaceholderNode(node, placeholderNodeType);
  }

  return createRenderPlannedNode(node, renderEntry, imageObjectLayerEnabled);
}

function resolveCachedRenderedNode(options: {
  node: Node<AnyNodeData>;
  mode: CanvasNodeDomRenderMode;
  renderEntry: CanvasNodeDomRenderPlanEntry | undefined;
  placeholderNodeType: string;
  imageObjectLayerEnabled: boolean;
  previousCache?: CanvasRenderPlanCache;
  nextCache: CanvasRenderPlanCache;
}): {
  renderedNode: Node<AnyNodeData>;
  reused: boolean;
} {
  const signature = buildNodeRenderSignature(
    options.node,
    options.mode,
    options.renderEntry,
    options.placeholderNodeType,
    options.imageObjectLayerEnabled,
  );
  const previousEntry = options.previousCache?.nodesById.get(options.node.id);
  if (previousEntry?.sourceNode === options.node && previousEntry.signature === signature) {
    options.nextCache.nodesById.set(options.node.id, previousEntry);
    return {
      renderedNode: previousEntry.renderedNode,
      reused: true,
    };
  }

  const renderedNode = createRenderedNodeForPlan(
    options.node,
    options.mode,
    options.renderEntry,
    options.placeholderNodeType,
    options.imageObjectLayerEnabled,
  );
  options.nextCache.nodesById.set(options.node.id, {
    sourceNode: options.node,
    renderedNode,
    signature,
  });

  return {
    renderedNode,
    reused: false,
  };
}

function shouldMarkRasterEligible(
  node: Node<AnyNodeData>,
  visibleNodes: VisibleNodeMap,
  domWindowing: CanvasNodeDomWindowingDecision,
): boolean {
  if (domWindowing.detachedNodeIds.has(node.id)) {
    return false;
  }

  if (node.data.type !== 'image') {
    return false;
  }

  const renderEntry = domWindowing.nodeRenderPlan.get(node.id);
  if (renderEntry?.renderTier === 'minimal') {
    return false;
  }

  const visibility = visibleNodes.get(node.id);
  if (!visibility) {
    return false;
  }

  return visibility.isVisible || visibility.isNearViewport;
}

function isImageFileNode(
  node: Node<AnyNodeData>,
): node is Node<AnyNodeData> & { data: FileNodeData & { type: 'image' } } {
  return node.data.type === 'image';
}

function resolveStableArray<Value>(options: {
  nextArray: Value[];
  signature: string;
  previousArray?: Value[];
  previousSignature?: string;
  canReuse?: (previousArray: Value[], nextArray: Value[]) => boolean;
}): {
  array: Value[];
  signature: string;
} {
  if (
    options.previousArray &&
    options.previousSignature === options.signature &&
    (options.canReuse?.(options.previousArray, options.nextArray) ?? true)
  ) {
    return {
      array: options.previousArray,
      signature: options.signature,
    };
  }

  return {
    array: options.nextArray,
    signature: options.signature,
  };
}

function areArraysReferentiallyEqual<Value>(
  previousArray: readonly Value[],
  nextArray: readonly Value[],
): boolean {
  return previousArray.length === nextArray.length &&
    previousArray.every((previousValue, index) => previousValue === nextArray[index]);
}

export function buildCanvasRenderPlan({
  nodes,
  edges,
  visibleNodes,
  activeNodeStates,
  visibilityFresh = true,
  runtimeVisualRevision,
  placeholderNodeType,
  previousCache,
  imageObjectLayerEnabled = isCanvasImageObjectLayerEnabled(),
}: BuildCanvasRenderPlanOptions): CanvasRenderPlan {
  const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
  const domWindowing = resolveCanvasNodeDomWindowing({
    nodes,
    edges,
    visibleNodes,
    activeNodeStates,
    visibilityFresh,
    runtimeVisualRevision,
    previousNodeRenderPlan: previousCache?.nodeRenderPlan,
  });

  const nodeRenderModes = new Map<string, CanvasNodeDomRenderMode>();
  const nodeRenderTiers = new Map<string, NodeRenderTier>();
  const fullNodeIds = new Set<string>();
  const proxyNodeIds = new Set<string>();
  const nextCache = createCanvasRenderPlanCache();
  let nextHiddenEdgeIds = domWindowing.hiddenEdgeIds;
  const hiddenEdgeIdsSignature = buildStringSetSignature(nextHiddenEdgeIds);
  if (
    previousCache?.hiddenEdgeIds &&
    previousCache.hiddenEdgeIdsSignature === hiddenEdgeIdsSignature
  ) {
    nextHiddenEdgeIds = previousCache.hiddenEdgeIds;
  }
  nextCache.hiddenEdgeIds = nextHiddenEdgeIds;
  nextCache.hiddenEdgeIdsSignature = hiddenEdgeIdsSignature;
  let fullNodeCount = 0;
  let compactNodeCount = 0;
  let minimalNodeCount = 0;
  let imageFullDomNodeCount = 0;
  let imageShellNodeCount = 0;
  let imageObjectLayerCount = 0;
  let reusedNodeCount = 0;
  let createdNodeCount = 0;
  const renderedNodes = nodes.map((node) => {
    const renderEntry = domWindowing.nodeRenderPlan.get(node.id);
    const mode = renderEntry?.mode ?? 'full';
    const renderTier = renderEntry?.renderTier ?? 'full';
    nodeRenderModes.set(node.id, mode);
    nodeRenderTiers.set(node.id, renderTier);
    if (renderTier === 'full') {
      fullNodeCount += 1;
    } else if (renderTier === 'compact') {
      compactNodeCount += 1;
    } else {
      minimalNodeCount += 1;
    }

    if (mode === 'proxy') {
      proxyNodeIds.add(node.id);
    } else if (mode === 'full') {
      fullNodeIds.add(node.id);
    }

    const imageResourceOwner = resolveImageResourceOwner(
      renderEntry,
      node.data.type,
      imageObjectLayerEnabled,
    );
    if (node.data.type === 'image') {
      if (imageResourceOwner === 'raster') {
        imageObjectLayerCount += 1;
        if (renderTier === 'full' && mode === 'full') {
          imageShellNodeCount += 1;
        }
      } else if (imageResourceOwner === 'dom' && renderTier === 'full' && mode === 'full') {
        imageFullDomNodeCount += 1;
      }
    }

    const resolvedNode = resolveCachedRenderedNode({
      node,
      mode,
      renderEntry,
      placeholderNodeType,
      imageObjectLayerEnabled,
      previousCache,
      nextCache,
    });
    if (resolvedNode.reused) {
      reusedNodeCount += 1;
    } else {
      createdNodeCount += 1;
    }
    return resolvedNode.renderedNode;
  });
  const renderedEdges = (
    previousCache?.sourceEdges === edges &&
    previousCache.renderedEdges &&
    previousCache.hiddenEdgeIdsSignature === hiddenEdgeIdsSignature
  )
    ? previousCache.renderedEdges
    : edges.filter((edge) => !nextHiddenEdgeIds.has(edge.id));
  nextCache.sourceEdges = edges;
  nextCache.renderedEdges = renderedEdges;
  const rasterEligibleNodeIds = new Set<string>();
  const rasterEligibleImageNodes: Array<Node<AnyNodeData> & { data: FileNodeData & { type: 'image' } }> = [];
  const imageNodeIds: string[] = [];

  nodes.forEach((node, index) => {
    if (isImageFileNode(node)) {
      imageNodeIds.push(node.id);
    }

    if (shouldMarkRasterEligible(node, visibleNodes, domWindowing)) {
      rasterEligibleNodeIds.add(node.id);
      const renderedNode = renderedNodes[index];
      if (renderedNode && isImageFileNode(renderedNode)) {
        rasterEligibleImageNodes.push(renderedNode);
      }
    }
  });
  const stableRasterEligibleNodeIds = resolveStableStringSet({
    nextSet: rasterEligibleNodeIds,
    previousSet: previousCache?.rasterEligibleNodeIds,
    previousSignature: previousCache?.rasterEligibleNodeIdsSignature,
  });
  const rasterEligibleImageNodesSignature = rasterEligibleImageNodes.map((node) => node.id).join('|');
  const stableRasterEligibleImageNodes = resolveStableArray({
    nextArray: rasterEligibleImageNodes,
    signature: rasterEligibleImageNodesSignature,
    previousArray: previousCache?.rasterEligibleImageNodes,
    previousSignature: previousCache?.rasterEligibleImageNodesSignature,
    canReuse: areArraysReferentiallyEqual,
  });
  const imageNodeIdsSignature = imageNodeIds.join('|');
  const stableImageNodeIds = resolveStableArray({
    nextArray: imageNodeIds,
    signature: imageNodeIdsSignature,
    previousArray: previousCache?.imageNodeIds,
    previousSignature: previousCache?.imageNodeIdsSignature,
  });
  const stableFullNodeIds = resolveStableStringSet({
    nextSet: fullNodeIds,
    previousSet: previousCache?.fullNodeIds,
    previousSignature: previousCache?.fullNodeIdsSignature,
  });
  const stableProxyNodeIds = resolveStableStringSet({
    nextSet: proxyNodeIds,
    previousSet: previousCache?.proxyNodeIds,
    previousSignature: previousCache?.proxyNodeIdsSignature,
  });
  const stablePlaceholderNodeIds = resolveStableStringSet({
    nextSet: domWindowing.placeholderNodeIds,
    previousSet: previousCache?.placeholderNodeIds,
    previousSignature: previousCache?.placeholderNodeIdsSignature,
  });
  const stableDetachedNodeIds = resolveStableStringSet({
    nextSet: domWindowing.detachedNodeIds,
    previousSet: previousCache?.detachedNodeIds,
    previousSignature: previousCache?.detachedNodeIdsSignature,
  });
  const stableNodeRenderModes = resolveStableStringMap({
    nextMap: nodeRenderModes,
    previousMap: previousCache?.nodeRenderModes,
    previousSignature: previousCache?.nodeRenderModesSignature,
  });
  const stableNodeRenderTiers = resolveStableStringMap({
    nextMap: nodeRenderTiers,
    previousMap: previousCache?.nodeRenderTiers,
    previousSignature: previousCache?.nodeRenderTiersSignature,
  });
  const nodeRenderPlanSignature = buildNodeRenderPlanSignature(domWindowing.nodeRenderPlan);
  const stableNodeRenderPlan = (
    previousCache?.nodeRenderPlan &&
    previousCache.nodeRenderPlanSignature === nodeRenderPlanSignature
  )
    ? previousCache.nodeRenderPlan
    : domWindowing.nodeRenderPlan;
  nextCache.rasterEligibleNodeIds = stableRasterEligibleNodeIds.set;
  nextCache.rasterEligibleNodeIdsSignature = stableRasterEligibleNodeIds.signature;
  nextCache.rasterEligibleImageNodes = stableRasterEligibleImageNodes.array;
  nextCache.rasterEligibleImageNodesSignature = stableRasterEligibleImageNodes.signature;
  nextCache.imageNodeIds = stableImageNodeIds.array;
  nextCache.imageNodeIdsSignature = stableImageNodeIds.signature;
  nextCache.fullNodeIds = stableFullNodeIds.set;
  nextCache.fullNodeIdsSignature = stableFullNodeIds.signature;
  nextCache.proxyNodeIds = stableProxyNodeIds.set;
  nextCache.proxyNodeIdsSignature = stableProxyNodeIds.signature;
  nextCache.placeholderNodeIds = stablePlaceholderNodeIds.set;
  nextCache.placeholderNodeIdsSignature = stablePlaceholderNodeIds.signature;
  nextCache.detachedNodeIds = stableDetachedNodeIds.set;
  nextCache.detachedNodeIdsSignature = stableDetachedNodeIds.signature;
  nextCache.nodeRenderModes = stableNodeRenderModes.map;
  nextCache.nodeRenderModesSignature = stableNodeRenderModes.signature;
  nextCache.nodeRenderTiers = stableNodeRenderTiers.map;
  nextCache.nodeRenderTiersSignature = stableNodeRenderTiers.signature;
  nextCache.nodeRenderPlan = stableNodeRenderPlan;
  nextCache.nodeRenderPlanSignature = nodeRenderPlanSignature;
  const completedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

  return {
    renderedNodes,
    renderedEdges,
    placeholderNodeIds: stablePlaceholderNodeIds.set,
    detachedNodeIds: stableDetachedNodeIds.set,
    hiddenEdgeIds: nextHiddenEdgeIds,
    rasterEligibleNodeIds: stableRasterEligibleNodeIds.set,
    rasterEligibleImageNodes: stableRasterEligibleImageNodes.array,
    imageNodeIds: stableImageNodeIds.array,
    nodeRenderModes: stableNodeRenderModes.map,
    nodeRenderTiers: stableNodeRenderTiers.map,
    fullNodeIds: stableFullNodeIds.set,
    proxyNodeIds: stableProxyNodeIds.set,
    domWindowing,
    cache: nextCache,
    diagnostics: {
      nodeCount: nodes.length,
      renderedNodeCount: renderedNodes.length,
      renderedEdgeCount: renderedEdges.length,
      fullNodeCount,
      compactNodeCount,
      minimalNodeCount,
      proxyNodeCount: stableProxyNodeIds.set.size,
      imageFullDomNodeCount,
      imageShellNodeCount,
      imageObjectLayerCount,
      placeholderNodeCount: stablePlaceholderNodeIds.set.size,
      detachedNodeCount: stableDetachedNodeIds.set.size,
      hiddenEdgeCount: nextHiddenEdgeIds.size,
      rasterEligibleNodeCount: stableRasterEligibleNodeIds.set.size,
      reusedNodeCount,
      createdNodeCount,
      durationMs: completedAt - startedAt,
    },
  };
}
