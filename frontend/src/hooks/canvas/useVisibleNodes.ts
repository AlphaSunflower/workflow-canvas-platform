import { useEffect, useMemo, useState } from 'react';
import type { Node } from 'reactflow';
import type { SerializableImageVisibilityState } from '@/services/image/image-resource.types';
import type { AnyNodeData, Viewport } from '@/types';
import { rectsIntersect } from '@/utils';
import {
  deriveVisibilityBucketState,
  resolveDisplayBucket,
  shouldEmitVisibilityDiff,
  type VisibilityBucketState,
} from './visibility-buckets';
import { resolveNodeRenderTier } from './node-render-tier';
import { resolveCanvasNodeVisibilityRect } from './node-visibility-rect';

export interface VisibleNodeState extends SerializableImageVisibilityState {}

export type VisibleNodeMap = Map<string, VisibleNodeState>;

export interface VisibleNodeSnapshotMetadata {
  viewport: Viewport;
  nodesVersion: number;
  containerSize: {
    width: number;
    height: number;
  };
  computedAt: number;
}

export interface VisibleNodeSnapshot extends VisibleNodeSnapshotMetadata {
  visibleNodes: VisibleNodeMap;
}

export interface SerializableVisibleNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  dataType?: AnyNodeData['type'];
}

export interface SerializableVisibleNodesRequest {
  nodes: SerializableVisibleNode[];
  forcedOffscreenNodeIds?: string[];
  viewport: Viewport;
  containerSize: {
    width: number;
    height: number;
  };
  overscan?: number;
  recentlyInteractedNodeIds?: string[];
  importingNodeIds?: string[];
  totalImageCount?: number;
}

export interface SerializableVisibleNodeResult {
  nodeId: string;
  visibility: VisibleNodeState;
}

interface UseVisibleNodesOptions {
  nodes: Array<Node<AnyNodeData>>;
  nodesVersion?: number;
  candidateNodeIds?: Iterable<string>;
  forcedOffscreenNodeIds?: Iterable<string>;
  viewport: Viewport;
  containerSize: {
    width: number;
    height: number;
  };
  precomputedVisibility?: VisibleNodeSnapshot;
  overscan?: number;
  recentlyInteractedNodeIds?: Iterable<string>;
  importingNodeIds?: Iterable<string>;
  freezeComputedVisibility?: boolean;
}

export interface ComputeVisibleNodesOptions extends UseVisibleNodesOptions {}

export interface ResolveVisibleNodesForCurrentStateOptions extends ComputeVisibleNodesOptions {}

export interface CanvasVisibilityCandidateRetentionConfig {
  defaultRetentionMs: number;
  importingRetentionMs: number;
}

export interface ResolveRetainedVisibilityCandidateIdsOptions {
  baseCandidateNodeIds: Iterable<string>;
  retainedCandidateExpirations: Map<string, number>;
  lastAppliedVisibleNodes: VisibleNodeMap;
  selectedNodeIds?: Iterable<string>;
  recentlyInteractedNodeIds?: Iterable<string>;
  importingNodeIds?: Iterable<string>;
  now: number;
  retention: CanvasVisibilityCandidateRetentionConfig;
}

export function serializeVisibleNodesInput({
  nodes,
  candidateNodeIds,
  forcedOffscreenNodeIds,
  viewport,
  containerSize,
  overscan = 240,
  recentlyInteractedNodeIds,
  importingNodeIds,
}: ComputeVisibleNodesOptions): SerializableVisibleNodesRequest {
  const candidateSet = candidateNodeIds ? new Set(candidateNodeIds) : null;
  const filteredNodes = candidateSet
    ? nodes.filter((node) => candidateSet.has(node.id))
    : nodes;
  const totalImageCount = nodes.filter((node) => node.data.type === 'image').length;

  return {
    nodes: filteredNodes.map((node) => {
      const rect = resolveCanvasNodeVisibilityRect(node);
      return {
        id: node.id,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        selected: Boolean(node.selected),
        dataType: node.data.type,
      };
    }),
    forcedOffscreenNodeIds: Array.from(forcedOffscreenNodeIds ?? []),
    viewport,
    containerSize,
    overscan,
    recentlyInteractedNodeIds: Array.from(recentlyInteractedNodeIds ?? []),
    importingNodeIds: Array.from(importingNodeIds ?? []),
    totalImageCount,
  };
}

export function materializeVisibleNodeMap(results: SerializableVisibleNodeResult[]): VisibleNodeMap {
  return new Map(results.map((entry) => [entry.nodeId, entry.visibility]));
}

function areVisibleNodeStatesEqual(left: VisibleNodeState, right: VisibleNodeState): boolean {
  return !shouldEmitVisibilityDiff(
    toVisibilityBucketState(left),
    toVisibilityBucketState(right),
  ) &&
    left.isSelected === right.isSelected &&
    left.isRecentlyInteracted === right.isRecentlyInteracted &&
    left.isImporting === right.isImporting &&
    left.renderTier === right.renderTier;
}

export function areVisibleNodeMapsEqual(left: VisibleNodeMap, right: VisibleNodeMap): boolean {
  if (left === right) {
    return true;
  }

  if (left.size !== right.size) {
    return false;
  }

  for (const [nodeId, leftState] of left.entries()) {
    const rightState = right.get(nodeId);
    if (!rightState || !areVisibleNodeStatesEqual(leftState, rightState)) {
      return false;
    }
  }

  return true;
}

function areViewportsEqual(left: Viewport, right: Viewport): boolean {
  return left.x === right.x && left.y === right.y && left.zoom === right.zoom;
}

function areContainerSizesEqual(
  left: VisibleNodeSnapshotMetadata['containerSize'],
  right: VisibleNodeSnapshotMetadata['containerSize'],
): boolean {
  return left.width === right.width && left.height === right.height;
}

export function hasUsableVisibleNodeContainerSize(
  containerSize: VisibleNodeSnapshotMetadata['containerSize'],
): boolean {
  return containerSize.width > 0 && containerSize.height > 0;
}

export function isVisibleNodeSnapshotFresh(
  snapshot: VisibleNodeSnapshot | undefined,
  current: Pick<VisibleNodeSnapshotMetadata, 'viewport' | 'nodesVersion' | 'containerSize'>,
): snapshot is VisibleNodeSnapshot {
  if (!snapshot) {
    return false;
  }

  if (
    !hasUsableVisibleNodeContainerSize(snapshot.containerSize) ||
    !hasUsableVisibleNodeContainerSize(current.containerSize)
  ) {
    return false;
  }

  return (
    snapshot.nodesVersion === current.nodesVersion &&
    areViewportsEqual(snapshot.viewport, current.viewport) &&
    areContainerSizesEqual(snapshot.containerSize, current.containerSize)
  );
}

export function areVisibleNodeSnapshotsEqual(
  left: VisibleNodeSnapshot,
  right: VisibleNodeSnapshot,
): boolean {
  return left.nodesVersion === right.nodesVersion &&
    areViewportsEqual(left.viewport, right.viewport) &&
    areContainerSizesEqual(left.containerSize, right.containerSize) &&
    areVisibleNodeMapsEqual(left.visibleNodes, right.visibleNodes);
}

function buildViewportRect(
  viewport: Viewport,
  width: number,
  height: number,
  extraMargin = 0,
): { x: number; y: number; width: number; height: number } {
  const zoom = viewport.zoom || 1;
  return {
    x: -viewport.x / zoom - extraMargin,
    y: -viewport.y / zoom - extraMargin,
    width: width / zoom + extraMargin * 2,
    height: height / zoom + extraMargin * 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeIntersectionArea(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): number {
  const overlapWidth = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const overlapHeight = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  if (overlapWidth <= 0 || overlapHeight <= 0) {
    return 0;
  }

  return overlapWidth * overlapHeight;
}

function createIdSet(ids?: Iterable<string>): Set<string> {
  return new Set(Array.from(ids ?? []));
}

function shouldRetainVisibilityCandidate(visibility: VisibleNodeState): boolean {
  return visibility.isVisible ||
    visibility.isNearViewport ||
    visibility.renderTier === 'compact' ||
    visibility.isRecentlyInteracted ||
    visibility.isSelected;
}

export function resolveRetainedVisibilityCandidateIds({
  baseCandidateNodeIds,
  retainedCandidateExpirations,
  lastAppliedVisibleNodes,
  selectedNodeIds,
  recentlyInteractedNodeIds,
  importingNodeIds,
  now,
  retention,
}: ResolveRetainedVisibilityCandidateIdsOptions): string[] {
  const candidates = new Set(baseCandidateNodeIds);
  const selectedSet = createIdSet(selectedNodeIds);
  const interactedSet = createIdSet(recentlyInteractedNodeIds);
  const importingSet = createIdSet(importingNodeIds);

  selectedSet.forEach((nodeId) => {
    candidates.add(nodeId);
  });
  interactedSet.forEach((nodeId) => {
    candidates.add(nodeId);
  });

  lastAppliedVisibleNodes.forEach((visibility, nodeId) => {
    if (!shouldRetainVisibilityCandidate(visibility)) {
      return;
    }

    retainedCandidateExpirations.set(
      nodeId,
      now + (visibility.isImporting ? retention.importingRetentionMs : retention.defaultRetentionMs),
    );
  });

  retainedCandidateExpirations.forEach((expiresAt, nodeId) => {
    if (expiresAt <= now) {
      retainedCandidateExpirations.delete(nodeId);
      return;
    }

    candidates.add(nodeId);
  });

  candidates.forEach((nodeId) => {
    const visibility = lastAppliedVisibleNodes.get(nodeId);
    const shouldRetain = selectedSet.has(nodeId) ||
      interactedSet.has(nodeId) ||
      (visibility ? shouldRetainVisibilityCandidate(visibility) : false);
    if (!shouldRetain) {
      return;
    }

    retainedCandidateExpirations.set(
      nodeId,
      now + (importingSet.has(nodeId) || visibility?.isImporting
        ? retention.importingRetentionMs
        : retention.defaultRetentionMs),
    );
  });

  return Array.from(candidates);
}

function applyForcedOffscreenVisibility({
  baseVisibility,
  nodes,
  forcedOffscreenNodeIds,
  viewport,
  recentlyInteractedNodeIds,
  importingNodeIds,
}: {
  baseVisibility: VisibleNodeMap;
  nodes: Array<Node<AnyNodeData>>;
  forcedOffscreenNodeIds?: Iterable<string>;
  viewport: Viewport;
  recentlyInteractedNodeIds?: Iterable<string>;
  importingNodeIds?: Iterable<string>;
}): VisibleNodeMap {
  const forcedOffscreenSet = createIdSet(forcedOffscreenNodeIds);
  if (forcedOffscreenSet.size === 0) {
    return baseVisibility;
  }

  const interactedSet = createIdSet(recentlyInteractedNodeIds);
  const importingSet = createIdSet(importingNodeIds);
  let nextVisibility = baseVisibility;
  let hasPatchedVisibility = false;
  forcedOffscreenSet.forEach((nodeId) => {
    const current = nextVisibility.get(nodeId);
    if (current) {
      if (!importingSet.has(nodeId) || current.isImporting) {
        return;
      }

      if (!hasPatchedVisibility) {
        nextVisibility = new Map(nextVisibility);
        hasPatchedVisibility = true;
      }

      nextVisibility.set(nodeId, {
        ...current,
        isImporting: true,
      });
      return;
    }

    const fallback = nodes.find((node) => node.id === nodeId);
    if (!fallback) {
      return;
    }

    if (!hasPatchedVisibility) {
      nextVisibility = new Map(nextVisibility);
      hasPatchedVisibility = true;
    }

    const fallbackRect = resolveCanvasNodeVisibilityRect(fallback);

    nextVisibility.set(nodeId, {
      isVisible: false,
      isNearViewport: false,
      displayWidth: Math.round(fallbackRect.width * (viewport.zoom || 1)),
      displayHeight: Math.round(fallbackRect.height * (viewport.zoom || 1)),
      visibilityBucket: 'offscreen',
      visibilityScoreBucket: 'cancel',
      visibilityAreaBucket: 'none',
      visibleAreaRatio: 0,
      viewportZoom: viewport.zoom || 1,
      visibilityScore: 0,
      centerDistance: Number.POSITIVE_INFINITY,
      isSelected: Boolean(fallback.selected),
      isRecentlyInteracted: interactedSet.has(nodeId),
      isImporting: importingSet.has(nodeId),
      renderTier: 'minimal',
    });
  });

  return nextVisibility;
}

export function resolveVisibleNodesForCurrentState({
  nodes,
  nodesVersion = 0,
  candidateNodeIds,
  forcedOffscreenNodeIds,
  viewport,
  containerSize,
  precomputedVisibility,
  overscan = 240,
  recentlyInteractedNodeIds,
  importingNodeIds,
}: ResolveVisibleNodesForCurrentStateOptions): VisibleNodeMap | undefined {
  const freshPrecomputedVisibility = isVisibleNodeSnapshotFresh(precomputedVisibility, {
    viewport,
    nodesVersion,
    containerSize,
  })
    ? precomputedVisibility.visibleNodes
    : undefined;
  const baseVisibility = freshPrecomputedVisibility ?? (
    hasUsableVisibleNodeContainerSize(containerSize)
      ? computeVisibleNodes({
        nodes,
        candidateNodeIds,
        forcedOffscreenNodeIds,
        viewport,
        containerSize,
        overscan,
        recentlyInteractedNodeIds,
        importingNodeIds,
      })
      : undefined
  );

  if (!baseVisibility) {
    return undefined;
  }

  return applyForcedOffscreenVisibility({
    baseVisibility,
    nodes,
    forcedOffscreenNodeIds,
    viewport,
    recentlyInteractedNodeIds,
    importingNodeIds,
  });
}

export function useVisibleNodes({
  nodes,
  nodesVersion = 0,
  candidateNodeIds,
  forcedOffscreenNodeIds,
  viewport,
  containerSize,
  precomputedVisibility,
  overscan = 240,
  recentlyInteractedNodeIds,
  importingNodeIds,
  freezeComputedVisibility = false,
}: UseVisibleNodesOptions): VisibleNodeMap {
  const recentInteractionIds = Array.from(recentlyInteractedNodeIds ?? []).sort();
  const interactedSet = useMemo(() => new Set(recentInteractionIds), [recentInteractionIds]);
  const importingIds = Array.from(importingNodeIds ?? []).sort();
  const importingSet = useMemo(() => new Set(importingIds), [importingIds]);
  const forcedOffscreenIds = Array.from(forcedOffscreenNodeIds ?? []).sort();
  const forcedOffscreenSet = useMemo(() => new Set(forcedOffscreenIds), [forcedOffscreenIds]);

  const computedVisibility = useMemo(() => {
    return resolveVisibleNodesForCurrentState({
      nodes,
      nodesVersion,
      candidateNodeIds,
      forcedOffscreenNodeIds: forcedOffscreenSet,
      viewport,
      containerSize,
      precomputedVisibility,
      overscan,
      recentlyInteractedNodeIds: interactedSet,
      importingNodeIds: importingSet,
    });
  }, [
    candidateNodeIds,
    containerSize,
    forcedOffscreenNodeIds,
    forcedOffscreenSet,
    importingSet,
    interactedSet,
    nodes,
    nodesVersion,
    overscan,
    precomputedVisibility,
    viewport,
  ]);

  const [visibleNodes, setVisibleNodes] = useState<VisibleNodeMap>(computedVisibility ?? new Map());

  useEffect(() => {
    if (freezeComputedVisibility || !computedVisibility) {
      return;
    }

    let frameId = window.requestAnimationFrame(() => {
      setVisibleNodes((current) => (
        areVisibleNodeMapsEqual(current, computedVisibility)
          ? current
          : computedVisibility
      ));
      frameId = 0;
    });

    return (): void => {
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [computedVisibility, freezeComputedVisibility]);

  return visibleNodes;
}

export function computeVisibleNodes({
  nodes,
  candidateNodeIds,
  forcedOffscreenNodeIds,
  viewport,
  containerSize,
  overscan = 240,
  recentlyInteractedNodeIds,
  importingNodeIds,
}: ComputeVisibleNodesOptions): VisibleNodeMap {
  return materializeVisibleNodeMap(
    computeVisibleNodesSerialized(serializeVisibleNodesInput({
      nodes,
      candidateNodeIds,
      forcedOffscreenNodeIds,
      viewport,
      containerSize,
      overscan,
      recentlyInteractedNodeIds: recentlyInteractedNodeIds instanceof Set
        ? Array.from(recentlyInteractedNodeIds)
        : Array.from(recentlyInteractedNodeIds ?? []),
      importingNodeIds: importingNodeIds instanceof Set
        ? Array.from(importingNodeIds)
        : Array.from(importingNodeIds ?? []),
    }))
  );
}

export function computeVisibleNodesSerialized(
  input: SerializableVisibleNodesRequest
): SerializableVisibleNodeResult[] {
  const interactedSet = new Set(input.recentlyInteractedNodeIds ?? []);
  const importingSet = new Set(input.importingNodeIds ?? []);
  const result: SerializableVisibleNodeResult[] = [];

  if (input.containerSize.width <= 0 || input.containerSize.height <= 0) {
    return result;
  }

  const viewportRect = buildViewportRect(input.viewport, input.containerSize.width, input.containerSize.height, 0);
  const nearViewportRect = buildViewportRect(
    input.viewport,
    input.containerSize.width,
    input.containerSize.height,
    input.overscan ?? 240,
  );
  const zoom = input.viewport.zoom || 1;
  const viewportCenterX = viewportRect.x + viewportRect.width / 2;
  const viewportCenterY = viewportRect.y + viewportRect.height / 2;
  const totalImageCount = input.totalImageCount ?? input.nodes.filter((node) => node.dataType === 'image').length;
  let visibleImageCount = 0;
  input.nodes.forEach((node) => {
    if (node.dataType !== 'image') {
      return;
    }

    const nodeRect = {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
    if (computeIntersectionArea(nodeRect, viewportRect) > 0) {
      visibleImageCount += 1;
    }
  });

  input.nodes.forEach((node) => {
    const width = node.width;
    const height = node.height;
    const nodeRect = {
      x: node.x,
      y: node.y,
      width,
      height,
    };
    const nodeArea = Math.max(width * height, 1);
    const visibleArea = computeIntersectionArea(nodeRect, viewportRect);
    const visibleAreaRatio = clamp(visibleArea / nodeArea, 0, 1);
    const nodeCenterX = nodeRect.x + nodeRect.width / 2;
    const nodeCenterY = nodeRect.y + nodeRect.height / 2;
    const centerDistance = Math.hypot(nodeCenterX - viewportCenterX, nodeCenterY - viewportCenterY);
    const normalizedCenterDistance = Math.max(
      0,
      1 - clamp(centerDistance / Math.max(viewportRect.width, viewportRect.height, 1), 0, 1.5)
    );
    const zoomWeight = clamp((zoom - 0.6) / 1.4, 0, 1);
    const selectedWeight = node.selected ? 1 : 0;
    const selectedPromotesRenderTier = Boolean(node.selected && node.dataType !== 'image');
    const interactedWeight = interactedSet.has(node.id) ? 1 : 0;
    const importingWeight = importingSet.has(node.id) ? 1 : 0;
    const nearViewportWeight = rectsIntersect(nodeRect, nearViewportRect) ? 1 : 0;
    const visibilityScore = clamp(
      visibleAreaRatio * 0.5 +
      normalizedCenterDistance * 0.2 +
      zoomWeight * 0.1 +
      selectedWeight * 0.12 +
      interactedWeight * 0.06 +
      importingWeight * 0.18 +
      nearViewportWeight * 0.02,
      0,
      1
    );
    const bucketState = deriveVisibilityBucketState({
      isVisible: visibleArea > 0,
      isNearViewport: nearViewportWeight > 0,
      visibleAreaRatio,
      visibilityScore,
      centerDistance,
      viewportSpan: Math.max(viewportRect.width, viewportRect.height, 1),
      isSelected: Boolean(node.selected),
      isRecentlyInteracted: interactedSet.has(node.id),
      isImporting: importingSet.has(node.id),
      displayWidth: Math.round(width * zoom),
      displayHeight: Math.round(height * zoom),
    });
    const renderTier = resolveNodeRenderTier({
      visibilityBucket: bucketState.visibilityBucket,
      isSelected: selectedPromotesRenderTier,
      isRecentlyInteracted: interactedSet.has(node.id),
      isImporting: importingSet.has(node.id),
      isImage: node.dataType === 'image',
      viewportZoom: zoom,
      visibleImageCount,
      totalImageCount,
    });

    result.push({
      nodeId: node.id,
      visibility: {
        isVisible: visibleArea > 0,
        isNearViewport: nearViewportWeight > 0,
        displayWidth: Math.round(width * zoom),
        displayHeight: Math.round(height * zoom),
        visibilityBucket: bucketState.visibilityBucket,
        visibilityScoreBucket: bucketState.visibilityScoreBucket,
        visibilityAreaBucket: bucketState.visibilityAreaBucket,
        visibleAreaRatio,
        viewportZoom: zoom,
        visibilityScore,
        centerDistance,
        isSelected: Boolean(node.selected),
        isRecentlyInteracted: interactedSet.has(node.id),
        isImporting: importingSet.has(node.id),
        renderTier,
      },
    });
  });

  (input.forcedOffscreenNodeIds ?? []).forEach((nodeId) => {
    if (result.some((entry) => entry.nodeId === nodeId)) {
      return;
    }

    result.push({
      nodeId,
      visibility: {
        isVisible: false,
        isNearViewport: false,
        displayWidth: 0,
        displayHeight: 0,
        visibilityBucket: 'offscreen',
        visibilityScoreBucket: 'cancel',
        visibilityAreaBucket: 'none',
        visibleAreaRatio: 0,
        viewportZoom: input.viewport.zoom || 1,
        visibilityScore: 0,
        centerDistance: Number.POSITIVE_INFINITY,
        isSelected: false,
        isRecentlyInteracted: false,
        isImporting: importingSet.has(nodeId),
        renderTier: 'minimal',
      },
    });
  });

  return result;
}

export function diffVisibleNodes(
  previous: VisibleNodeMap | undefined,
  next: VisibleNodeMap
): VisibleNodeMap {
  if (!previous || previous.size === 0) {
    return next;
  }

  const diff: VisibleNodeMap = new Map();

  next.forEach((nextState, nodeId) => {
    const previousState = previous.get(nodeId);
    if (!previousState) {
      diff.set(nodeId, nextState);
      return;
    }

    if (shouldEmitVisibilityDiff(
      toVisibilityBucketState(previousState),
      toVisibilityBucketState(nextState),
    )) {
      diff.set(nodeId, nextState);
      return;
    }

    if (
      previousState.isSelected !== nextState.isSelected ||
      previousState.isRecentlyInteracted !== nextState.isRecentlyInteracted ||
      previousState.isImporting !== nextState.isImporting ||
      previousState.renderTier !== nextState.renderTier
    ) {
      diff.set(nodeId, nextState);
    }
  });

  previous.forEach((previousState, nodeId) => {
    if (next.has(nodeId)) {
      return;
    }

    if (
      !previousState.isVisible &&
      !previousState.isNearViewport &&
      previousState.renderTier === 'minimal' &&
      !previousState.isRecentlyInteracted &&
      !previousState.isImporting &&
      !previousState.isSelected
    ) {
      return;
    }

    diff.set(nodeId, {
      isVisible: false,
      isNearViewport: false,
      displayWidth: 0,
      displayHeight: 0,
      visibilityBucket: 'offscreen',
      visibilityScoreBucket: 'cancel',
      visibilityAreaBucket: 'none',
      visibleAreaRatio: 0,
      viewportZoom: previousState.viewportZoom,
      visibilityScore: 0,
      centerDistance: Number.POSITIVE_INFINITY,
      isSelected: false,
      isRecentlyInteracted: false,
      isImporting: false,
      renderTier: 'minimal',
    });
  });

  return diff;
}

function toVisibilityBucketState(state: VisibleNodeState): VisibilityBucketState {
  return {
    visibilityBucket: state.visibilityBucket,
    visibilityScoreBucket: state.visibilityScoreBucket,
    visibilityAreaBucket: state.visibilityAreaBucket,
    displayWidthBucket: resolveDisplayBucket(state.displayWidth),
    displayHeightBucket: resolveDisplayBucket(state.displayHeight),
  };
}
