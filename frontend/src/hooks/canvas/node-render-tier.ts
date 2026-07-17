import { useCallback, useSyncExternalStore } from 'react';
import type { NodeActiveState } from '@/types';

export type NodeVisibilityBucket = 'visible' | 'near' | 'far' | 'offscreen';
export type NodeRenderTier = 'full' | 'compact' | 'minimal';

export interface ResolveNodeRenderTierInput {
  visibilityBucket: NodeVisibilityBucket;
  isSelected?: boolean;
  isRecentlyInteracted?: boolean;
  isImporting?: boolean;
  isImage?: boolean;
  viewportZoom?: number;
  visibleImageCount?: number;
  totalImageCount?: number;
}

type Listener = () => void;

const renderTierStore = new Map<string, NodeRenderTier>();
const renderTierListeners = new Map<string, Set<Listener>>();

export function resolveNodeRenderTier(input: ResolveNodeRenderTierInput): NodeRenderTier {
  if ((input.isSelected && !input.isImage) || input.isRecentlyInteracted) {
    return 'full';
  }

  const shouldUseRasterFirstImageTier = Boolean(
    input.isImage &&
    (input.visibilityBucket === 'visible' || input.visibilityBucket === 'near') &&
    (
      (input.visibleImageCount ?? 0) > 40 ||
      (input.totalImageCount ?? 0) > 80 ||
      (
        (input.viewportZoom ?? 1) < 0.18 &&
        ((input.visibleImageCount ?? 0) > 80 || (input.totalImageCount ?? 0) > 160)
      )
    )
  );
  if (shouldUseRasterFirstImageTier) {
    return input.visibilityBucket === 'visible' ? 'compact' : 'minimal';
  }

  if (input.isImporting) {
    return input.visibilityBucket === 'visible' ? 'compact' : 'minimal';
  }

  if (input.visibilityBucket === 'visible' || input.visibilityBucket === 'near') {
    return 'full';
  }

  if (input.visibilityBucket === 'far') {
    return 'compact';
  }

  return 'minimal';
}

export function shouldNodeRenderTierUpdate(
  previous: NodeRenderTier | undefined,
  next: NodeRenderTier
): boolean {
  return previous !== next;
}

export function resolveNodeRenderTierWithActiveState(
  scheduledRenderTier: NodeRenderTier,
  activeState?: NodeActiveState
): NodeRenderTier {
  return activeState === 'active' ? 'full' : scheduledRenderTier;
}

function emitNodeRenderTier(nodeId: string): void {
  renderTierListeners.get(nodeId)?.forEach((listener) => {
    listener();
  });
}

export function syncNodeRenderTierSnapshot(
  entries: Iterable<readonly [string, NodeRenderTier]>
): void {
  const nextSnapshot = new Map<string, NodeRenderTier>();
  const changedNodeIds = new Set<string>();

  for (const [nodeId, renderTier] of entries) {
    nextSnapshot.set(nodeId, renderTier);
  }

  renderTierStore.forEach((renderTier, nodeId) => {
    const nextRenderTier = nextSnapshot.get(nodeId);
    if (!nextRenderTier) {
      renderTierStore.delete(nodeId);
      changedNodeIds.add(nodeId);
      return;
    }

    if (shouldNodeRenderTierUpdate(renderTier, nextRenderTier)) {
      changedNodeIds.add(nodeId);
    }
  });

  nextSnapshot.forEach((renderTier, nodeId) => {
    const previous = renderTierStore.get(nodeId);
    if (!shouldNodeRenderTierUpdate(previous, renderTier)) {
      return;
    }

    renderTierStore.set(nodeId, renderTier);
    changedNodeIds.add(nodeId);
  });

  changedNodeIds.forEach((nodeId) => {
    emitNodeRenderTier(nodeId);
  });
}

export function clearNodeRenderTierSnapshot(): void {
  if (renderTierStore.size === 0) {
    return;
  }

  const nodeIds = Array.from(renderTierStore.keys());
  renderTierStore.clear();
  nodeIds.forEach((nodeId) => {
    emitNodeRenderTier(nodeId);
  });
}

export function getNodeRenderTier(
  nodeId: string,
  fallback: NodeRenderTier = 'full'
): NodeRenderTier {
  return renderTierStore.get(nodeId) ?? fallback;
}

function subscribeNodeRenderTier(nodeId: string, listener: Listener): () => void {
  const listeners = renderTierListeners.get(nodeId) ?? new Set<Listener>();
  listeners.add(listener);
  renderTierListeners.set(nodeId, listeners);

  return (): void => {
    const currentListeners = renderTierListeners.get(nodeId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      renderTierListeners.delete(nodeId);
    }
  };
}

export function useNodeRenderTier(
  nodeId: string,
  fallback: NodeRenderTier = 'full'
): NodeRenderTier {
  const subscribe = useCallback((listener: Listener) => subscribeNodeRenderTier(nodeId, listener), [nodeId]);
  const getSnapshot = useCallback(() => getNodeRenderTier(nodeId, fallback), [fallback, nodeId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
