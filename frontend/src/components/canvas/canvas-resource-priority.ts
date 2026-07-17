import type { VisibleNodeState } from '@/hooks/canvas/useVisibleNodes';

import type { CanvasRasterImageNode } from './canvas-raster-image-resource-bridge';

export type CanvasImageResourcePriorityTier =
  | 'selected'
  | 'hovered'
  | 'active'
  | 'recent'
  | 'visible'
  | 'near'
  | 'passive'
  | 'importing-passive';

export interface CanvasImageResourcePriority {
  tier: CanvasImageResourcePriorityTier;
  rank: number;
  score: number;
  active: boolean;
  importing: boolean;
}

export interface ResolveCanvasImageResourcePriorityOptions {
  node: CanvasRasterImageNode;
  visibility?: VisibleNodeState;
  activeImageNodeIdSet?: ReadonlySet<string>;
}

const PRIORITY_RANK: Record<CanvasImageResourcePriorityTier, number> = {
  selected: 0,
  hovered: 1,
  active: 2,
  recent: 10,
  visible: 20,
  near: 30,
  passive: 50,
  'importing-passive': 80,
};

function hasActiveReason(node: CanvasRasterImageNode, reason: string): boolean {
  return node.data.activeReasons?.includes(reason as never) ?? false;
}

function resolveScore(visibility?: VisibleNodeState): number {
  if (!visibility) {
    return 0;
  }

  const visibilityScore = Number.isFinite(visibility.visibilityScore)
    ? visibility.visibilityScore
    : 0;
  const distanceScore = Number.isFinite(visibility.centerDistance)
    ? Math.max(0, 1 - Math.min(visibility.centerDistance, 4_000) / 4_000)
    : 0;

  return visibilityScore + distanceScore * 0.2 + visibility.visibleAreaRatio * 0.2;
}

export function resolveCanvasImageResourcePriority({
  node,
  visibility,
  activeImageNodeIdSet,
}: ResolveCanvasImageResourcePriorityOptions): CanvasImageResourcePriority {
  const active = Boolean(
    activeImageNodeIdSet?.has(node.id) ||
    node.selected ||
    node.data.activeState === 'active',
  );
  const importing = Boolean(
    visibility?.isImporting ||
    node.data.status === 'pending' ||
    node.data.status === 'processing',
  );

  let tier: CanvasImageResourcePriorityTier;
  if (node.selected || visibility?.isSelected || hasActiveReason(node, 'selected')) {
    tier = 'selected';
  } else if (hasActiveReason(node, 'hovered')) {
    tier = 'hovered';
  } else if (active) {
    tier = 'active';
  } else if (visibility?.isRecentlyInteracted) {
    tier = 'recent';
  } else if (importing) {
    tier = 'importing-passive';
  } else if (visibility?.isVisible) {
    tier = 'visible';
  } else if (visibility?.isNearViewport) {
    tier = 'near';
  } else {
    tier = 'passive';
  }

  return {
    tier,
    rank: PRIORITY_RANK[tier],
    score: resolveScore(visibility),
    active,
    importing,
  };
}

