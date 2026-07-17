import type { VisibleNodeMap, VisibleNodeState } from '@/hooks/canvas/useVisibleNodes';

export interface ResolveForcedOffscreenImportNodeIdsOptions {
  candidateNodeIds: Iterable<string>;
  importingNodeIds: Iterable<string>;
  lastAppliedVisibleNodes: VisibleNodeMap;
}

function shouldEmitOffscreenFallback(visibility: VisibleNodeState): boolean {
  return visibility.isVisible ||
    visibility.isNearViewport ||
    visibility.renderTier === 'compact' ||
    visibility.renderTier === 'full';
}

export function resolveForcedOffscreenImportNodeIds({
  candidateNodeIds,
  importingNodeIds,
  lastAppliedVisibleNodes,
}: ResolveForcedOffscreenImportNodeIdsOptions): string[] {
  const candidateSet = new Set(candidateNodeIds);
  const forcedNodeIds: string[] = [];

  for (const nodeId of importingNodeIds) {
    if (candidateSet.has(nodeId)) {
      continue;
    }

    const lastVisibility = lastAppliedVisibleNodes.get(nodeId);
    if (!lastVisibility || !shouldEmitOffscreenFallback(lastVisibility)) {
      continue;
    }

    forcedNodeIds.push(nodeId);
  }

  return forcedNodeIds;
}
