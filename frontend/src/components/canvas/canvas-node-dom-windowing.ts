import type { Node } from 'reactflow';

import type { AnyNodeData, FileNodeActiveReason, NodeRenderTier } from '@/types';
import {
  getCanvasActiveNodeState,
  type CanvasActiveNodeStateSnapshot,
} from '@/components/canvas/canvas-active-node-state';
import { getCanvasRuntimeVisualState } from '@/components/canvas/canvas-runtime-visual-state';
import { resolveNodeRenderTierWithActiveState } from '@/hooks/canvas/node-render-tier';

import type { VisibleNodeMap } from '@/hooks/canvas/useVisibleNodes';

export type CanvasNodeDomRenderMode = 'full' | 'proxy' | 'placeholder';

export interface CanvasNodeDomRenderPlanEntry {
  mode: CanvasNodeDomRenderMode;
  renderTier: NodeRenderTier;
  scheduledRenderTier: NodeRenderTier;
  activeState: CanvasActiveNodeStateSnapshot['activeState'];
  activeReasons: CanvasActiveNodeStateSnapshot['activeReasons'];
}

const DYNAMIC_HANDLE_AI_NODE_TYPES = new Set<AnyNodeData['type']>([
  'aiImageGen',
  'aiImageInpaint',
  'aiImageToPly',
  'aiMultiViewRestore',
  'aiModelRenderTransfer',
  'aiImageHd',
  'aiFloorplanColorize',
  'aiVideoGen',
]);

export interface CanvasNodeDomWindowingDecision {
  placeholderNodeIds: Set<string>;
  detachedNodeIds: Set<string>;
  hiddenEdgeIds: Set<string>;
  nodeRenderPlan: Map<string, CanvasNodeDomRenderPlanEntry>;
}

export interface CanvasNodeDomWindowingEdge {
  id: string;
  source: string;
  target: string;
}

export interface ResolveCanvasNodeDomWindowingOptions {
  nodes: Array<Node<AnyNodeData>>;
  edges?: CanvasNodeDomWindowingEdge[];
  visibleNodes: VisibleNodeMap;
  activeNodeStates?: Map<string, CanvasActiveNodeStateSnapshot>;
  visibilityFresh?: boolean;
  runtimeVisualRevision?: number;
  previousNodeRenderPlan?: ReadonlyMap<string, CanvasNodeDomRenderPlanEntry>;
}

function nodeHasIncidentEdge(nodeId: string, edges: Array<Pick<CanvasNodeDomWindowingEdge, 'source' | 'target'>>): boolean {
  return edges.some((edge) => edge.source === nodeId || edge.target === nodeId);
}

function mustKeepRealDomForHandles(
  node: Node<AnyNodeData>,
  edges: Array<Pick<CanvasNodeDomWindowingEdge, 'source' | 'target'>>,
): boolean {
  return DYNAMIC_HANDLE_AI_NODE_TYPES.has(node.data.type) && nodeHasIncidentEdge(node.id, edges);
}

function createPassiveImageProxyRenderPlanEntry(
  renderTier: NodeRenderTier = 'compact',
): CanvasNodeDomRenderPlanEntry {
  return {
    mode: renderTier === 'minimal' ? 'placeholder' : 'proxy',
    renderTier,
    scheduledRenderTier: renderTier,
    activeState: 'passive',
    activeReasons: [],
  };
}

export function shouldDetachCanvasNodeDom(
  node: Node<AnyNodeData>,
  visibleNodes: VisibleNodeMap,
  edges: Array<Pick<CanvasNodeDomWindowingEdge, 'source' | 'target'>> = [],
  activeNodeStates?: Map<string, CanvasActiveNodeStateSnapshot>,
): boolean {
  if (mustKeepRealDomForHandles(node, edges)) {
    return false;
  }

  const visibility = visibleNodes.get(node.id);
  if (!visibility) {
    return false;
  }

  if (visibility.visibilityBucket !== 'offscreen') {
    return false;
  }

  if (visibility.isSelected || visibility.isRecentlyInteracted) {
    return false;
  }

  const activeState = activeNodeStates?.get(node.id) ?? getCanvasActiveNodeState(node.id);
  if (activeState.activeState === 'active') {
    return false;
  }

  const runtimeVisualState = getCanvasRuntimeVisualState(node.id, visibility.renderTier);
  if (runtimeVisualState.activeState === 'active') {
    return false;
  }

  return runtimeVisualState.renderTier === 'minimal';
}

function resolveNodeDomRenderPlanEntry(
  node: Node<AnyNodeData>,
  visibleNodes: VisibleNodeMap,
  edges: Array<Pick<CanvasNodeDomWindowingEdge, 'source' | 'target'>>,
  activeNodeStates: Map<string, CanvasActiveNodeStateSnapshot> | undefined,
  visibilityFresh: boolean,
  previousNodeRenderPlan: ReadonlyMap<string, CanvasNodeDomRenderPlanEntry> | undefined,
): CanvasNodeDomRenderPlanEntry {
  if (!visibilityFresh) {
    const previousEntry = previousNodeRenderPlan?.get(node.id);
    if (mustKeepRealDomForHandles(node, edges)) {
      return {
        mode: 'full',
        renderTier: 'full',
        scheduledRenderTier: previousEntry?.scheduledRenderTier ?? 'full',
        activeState: 'passive',
        activeReasons: [],
      };
    }

    if (previousEntry) {
      const activeSnapshot = activeNodeStates?.get(node.id) ?? getCanvasActiveNodeState(node.id);
      const runtimeVisualState = getCanvasRuntimeVisualState(node.id, previousEntry.scheduledRenderTier);
      const activeReasons = Array.from(new Set([
        ...activeSnapshot.activeReasons,
        ...runtimeVisualState.activeReasons,
      ])).sort();
      if (activeReasons.length > 0) {
        return {
          mode: 'full',
          renderTier: 'full',
          scheduledRenderTier: previousEntry.scheduledRenderTier,
          activeState: 'active',
          activeReasons,
        };
      }

      return previousEntry;
    }

    if (node.data.type === 'image') {
      return createPassiveImageProxyRenderPlanEntry();
    }

    return {
      mode: 'full',
      renderTier: 'full',
      scheduledRenderTier: 'full',
      activeState: 'passive',
      activeReasons: [],
    };
  }

  const visibility = visibleNodes.get(node.id);
  const scheduledRenderTier = visibility?.renderTier ?? (node.data.type === 'image' ? 'compact' : 'full');
  const activeSnapshot = activeNodeStates?.get(node.id) ?? getCanvasActiveNodeState(node.id);
  const runtimeVisualState = getCanvasRuntimeVisualState(node.id, scheduledRenderTier);
  const forcedActiveReasons: FileNodeActiveReason[] = [];
  if (visibility?.isSelected && node.data.type !== 'image') {
    forcedActiveReasons.push('selected');
  }
  if (visibility?.isRecentlyInteracted) {
    forcedActiveReasons.push('hovered');
  }
  const activeReasons = Array.from(new Set([
    ...activeSnapshot.activeReasons,
    ...runtimeVisualState.activeReasons,
    ...forcedActiveReasons,
  ])).sort();
  const activeState = activeReasons.length > 0 ? 'active' : 'passive';
  const renderTier = resolveNodeRenderTierWithActiveState(scheduledRenderTier, activeState);

  if (mustKeepRealDomForHandles(node, edges)) {
    return {
      mode: 'full',
      renderTier: 'full',
      scheduledRenderTier,
      activeState,
      activeReasons,
    };
  }

  if (!visibility && node.data.type === 'image' && activeState !== 'active') {
    return createPassiveImageProxyRenderPlanEntry(renderTier === 'minimal' ? 'minimal' : 'compact');
  }

  if (!visibility || renderTier === 'full') {
    return {
      mode: 'full',
      renderTier,
      scheduledRenderTier,
      activeState,
      activeReasons,
    };
  }

  if (node.data.type === 'image' && renderTier === 'compact') {
    return {
      mode: 'proxy',
      renderTier,
      scheduledRenderTier,
      activeState,
      activeReasons,
    };
  }

  if (
    visibility.visibilityBucket === 'offscreen' &&
    renderTier === 'minimal' &&
    !visibility.isSelected &&
    !visibility.isRecentlyInteracted
  ) {
    return {
      mode: 'placeholder',
      renderTier,
      scheduledRenderTier,
      activeState,
      activeReasons,
    };
  }

  return {
    mode: node.data.type === 'image' ? 'proxy' : 'full',
    renderTier,
    scheduledRenderTier,
    activeState,
    activeReasons,
  };
}

export function resolveCanvasNodeDomWindowing({
  nodes,
  edges = [],
  visibleNodes,
  activeNodeStates,
  visibilityFresh = true,
  runtimeVisualRevision: _runtimeVisualRevision,
  previousNodeRenderPlan,
}: ResolveCanvasNodeDomWindowingOptions): CanvasNodeDomWindowingDecision {
  const detachedNodeIds = new Set<string>();
  const nodeRenderPlan = new Map<string, CanvasNodeDomRenderPlanEntry>();

  nodes.forEach((node) => {
    const renderEntry = resolveNodeDomRenderPlanEntry(
      node,
      visibleNodes,
      edges,
      activeNodeStates,
      visibilityFresh,
      previousNodeRenderPlan,
    );
    nodeRenderPlan.set(node.id, renderEntry);
    if (renderEntry.mode === 'placeholder') {
      detachedNodeIds.add(node.id);
    }
  });

  const hiddenEdgeIds = new Set<string>();
  edges.forEach((edge) => {
    if (detachedNodeIds.has(edge.source) || detachedNodeIds.has(edge.target)) {
      hiddenEdgeIds.add(edge.id);
    }
  });

  return {
    placeholderNodeIds: detachedNodeIds,
    detachedNodeIds,
    hiddenEdgeIds,
    nodeRenderPlan,
  };
}
