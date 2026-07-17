import { useCallback, useSyncExternalStore } from 'react';

import type {
  FileNodeActiveReason,
  NodeActiveState,
  NodeRenderTier,
} from '@/types';
import { resolveNodeRenderTierWithActiveState } from '@/hooks/canvas/node-render-tier';

import type { CanvasActiveNodeStateSnapshot } from './canvas-active-node-state';

type Listener = () => void;

export interface CanvasRuntimeLocalActiveStateSnapshot {
  activeState: NodeActiveState;
  activeReasons: FileNodeActiveReason[];
}

export interface CanvasRuntimeVisualBaseSnapshot {
  scheduledRenderTier: NodeRenderTier;
  canvasState: CanvasActiveNodeStateSnapshot;
}

export interface CanvasRuntimeVisualStateSnapshot {
  scheduledRenderTier: NodeRenderTier;
  canvasActiveState: NodeActiveState;
  canvasActiveReasons: FileNodeActiveReason[];
  localActiveState: NodeActiveState;
  localActiveReasons: FileNodeActiveReason[];
  activeState: NodeActiveState;
  activeReasons: FileNodeActiveReason[];
  renderTier: NodeRenderTier;
}

export interface ResolveCanvasRuntimeVisualStateInput {
  scheduledRenderTier: NodeRenderTier;
  canvasState?: CanvasActiveNodeStateSnapshot;
  localState?: CanvasRuntimeLocalActiveStateSnapshot;
}

const PASSIVE_ACTIVE_STATE: CanvasRuntimeLocalActiveStateSnapshot = {
  activeState: 'passive',
  activeReasons: [],
};

const runtimeVisualBaseStore = new Map<string, CanvasRuntimeVisualBaseSnapshot>();
const runtimeVisualLocalStore = new Map<string, CanvasRuntimeLocalActiveStateSnapshot>();
const runtimeVisualSnapshotCache = new Map<
  string,
  Map<NodeRenderTier, CanvasRuntimeVisualStateSnapshot>
>();
const runtimeVisualFallbackSnapshotCache = new Map<
  NodeRenderTier,
  CanvasRuntimeVisualStateSnapshot
>();
const runtimeVisualListeners = new Map<string, Set<Listener>>();
const localActiveRevisionListeners = new Set<Listener>();
let localActiveRevision = 0;

function normalizeReasons(reasons: readonly FileNodeActiveReason[]): FileNodeActiveReason[] {
  return Array.from(new Set(reasons)).sort();
}

function buildActiveStateSnapshot(
  reasons: readonly FileNodeActiveReason[],
): CanvasRuntimeLocalActiveStateSnapshot {
  const normalizedReasons = normalizeReasons(reasons);
  if (normalizedReasons.length === 0) {
    return PASSIVE_ACTIVE_STATE;
  }

  return {
    activeState: 'active',
    activeReasons: normalizedReasons,
  };
}

function areActiveStateSnapshotsEqual(
  previous: CanvasRuntimeLocalActiveStateSnapshot | undefined,
  next: CanvasRuntimeLocalActiveStateSnapshot,
): boolean {
  if (!previous) {
    return false;
  }

  if (
    previous.activeState !== next.activeState ||
    previous.activeReasons.length !== next.activeReasons.length
  ) {
    return false;
  }

  return previous.activeReasons.every((reason, index) => reason === next.activeReasons[index]);
}

function normalizeCanvasRuntimeVisualBaseSnapshot(
  snapshot: CanvasRuntimeVisualBaseSnapshot,
): CanvasRuntimeVisualBaseSnapshot {
  return {
    scheduledRenderTier: snapshot.scheduledRenderTier,
    canvasState: buildActiveStateSnapshot(snapshot.canvasState.activeReasons),
  };
}

function invalidateCanvasRuntimeVisualStateSnapshotCache(nodeId: string): void {
  runtimeVisualSnapshotCache.delete(nodeId);
}

function areCanvasRuntimeVisualBaseSnapshotsEqual(
  previous: CanvasRuntimeVisualBaseSnapshot | undefined,
  next: CanvasRuntimeVisualBaseSnapshot | undefined,
): boolean {
  if (!previous && !next) {
    return true;
  }

  if (!previous || !next) {
    return false;
  }

  return previous.scheduledRenderTier === next.scheduledRenderTier &&
    areActiveStateSnapshotsEqual(previous.canvasState, next.canvasState);
}

function emitCanvasRuntimeVisualState(nodeId: string): void {
  runtimeVisualListeners.get(nodeId)?.forEach((listener) => {
    listener();
  });
}

function emitCanvasRuntimeVisualLocalRevision(): void {
  localActiveRevision += 1;
  localActiveRevisionListeners.forEach((listener) => {
    listener();
  });
}

export function resolveCanvasRuntimeVisualState(
  input: ResolveCanvasRuntimeVisualStateInput,
): CanvasRuntimeVisualStateSnapshot {
  const canvasState = input.canvasState
    ? buildActiveStateSnapshot(input.canvasState.activeReasons)
    : PASSIVE_ACTIVE_STATE;
  const localState = input.localState
    ? buildActiveStateSnapshot(input.localState.activeReasons)
    : PASSIVE_ACTIVE_STATE;
  const mergedActiveState = buildActiveStateSnapshot([
    ...canvasState.activeReasons,
    ...localState.activeReasons,
  ]);

  return {
    scheduledRenderTier: input.scheduledRenderTier,
    canvasActiveState: canvasState.activeState,
    canvasActiveReasons: canvasState.activeReasons,
    localActiveState: localState.activeState,
    localActiveReasons: localState.activeReasons,
    activeState: mergedActiveState.activeState,
    activeReasons: mergedActiveState.activeReasons,
    renderTier: resolveNodeRenderTierWithActiveState(
      input.scheduledRenderTier,
      mergedActiveState.activeState,
    ),
  };
}

function getFallbackCanvasRuntimeVisualStateSnapshot(
  fallbackScheduledRenderTier: NodeRenderTier,
): CanvasRuntimeVisualStateSnapshot {
  const cachedSnapshot = runtimeVisualFallbackSnapshotCache.get(fallbackScheduledRenderTier);
  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  const snapshot = resolveCanvasRuntimeVisualState({
    scheduledRenderTier: fallbackScheduledRenderTier,
  });
  runtimeVisualFallbackSnapshotCache.set(fallbackScheduledRenderTier, snapshot);
  return snapshot;
}

function buildCanvasRuntimeVisualStateSnapshot(
  nodeId: string,
  fallbackScheduledRenderTier: NodeRenderTier = 'full',
): CanvasRuntimeVisualStateSnapshot {
  const baseSnapshot = runtimeVisualBaseStore.get(nodeId);
  const localSnapshot = runtimeVisualLocalStore.get(nodeId);

  if (!baseSnapshot && !localSnapshot) {
    return getFallbackCanvasRuntimeVisualStateSnapshot(fallbackScheduledRenderTier);
  }

  const cachedNodeSnapshots = runtimeVisualSnapshotCache.get(nodeId);
  const cachedSnapshot = cachedNodeSnapshots?.get(fallbackScheduledRenderTier);
  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  const snapshot = resolveCanvasRuntimeVisualState({
    scheduledRenderTier: baseSnapshot?.scheduledRenderTier ?? fallbackScheduledRenderTier,
    canvasState: baseSnapshot?.canvasState,
    localState: localSnapshot,
  });

  const nextCachedNodeSnapshots = cachedNodeSnapshots ?? new Map<
    NodeRenderTier,
    CanvasRuntimeVisualStateSnapshot
  >();
  nextCachedNodeSnapshots.set(fallbackScheduledRenderTier, snapshot);
  runtimeVisualSnapshotCache.set(nodeId, nextCachedNodeSnapshots);

  return snapshot;
}

export function syncCanvasRuntimeVisualStateSnapshot(
  entries: Iterable<readonly [string, CanvasRuntimeVisualBaseSnapshot]>,
): void {
  const nextSnapshot = new Map<string, CanvasRuntimeVisualBaseSnapshot>();

  for (const [nodeId, snapshot] of entries) {
    nextSnapshot.set(nodeId, normalizeCanvasRuntimeVisualBaseSnapshot(snapshot));
  }

  const affectedNodeIds = new Set([
    ...runtimeVisualBaseStore.keys(),
    ...nextSnapshot.keys(),
  ]);

  affectedNodeIds.forEach((nodeId) => {
    const previousBaseSnapshot = runtimeVisualBaseStore.get(nodeId);
    const nextBaseSnapshot = nextSnapshot.get(nodeId);

    if (areCanvasRuntimeVisualBaseSnapshotsEqual(previousBaseSnapshot, nextBaseSnapshot)) {
      return;
    }

    if (nextBaseSnapshot) {
      runtimeVisualBaseStore.set(nodeId, nextBaseSnapshot);
    } else {
      runtimeVisualBaseStore.delete(nodeId);
    }

    invalidateCanvasRuntimeVisualStateSnapshotCache(nodeId);
    emitCanvasRuntimeVisualState(nodeId);
  });
}

export function syncCanvasNodeLocalActiveState(
  nodeId: string,
  snapshot: CanvasRuntimeLocalActiveStateSnapshot,
): void {
  const normalizedSnapshot = buildActiveStateSnapshot(snapshot.activeReasons);
  const previousLocalSnapshot = runtimeVisualLocalStore.get(nodeId);

  if (normalizedSnapshot.activeState === 'passive') {
    if (!previousLocalSnapshot) {
      return;
    }
    runtimeVisualLocalStore.delete(nodeId);
  } else {
    if (areActiveStateSnapshotsEqual(previousLocalSnapshot, normalizedSnapshot)) {
      return;
    }
    runtimeVisualLocalStore.set(nodeId, normalizedSnapshot);
  }

  invalidateCanvasRuntimeVisualStateSnapshotCache(nodeId);
  emitCanvasRuntimeVisualLocalRevision();
  emitCanvasRuntimeVisualState(nodeId);
}

export function clearCanvasNodeLocalActiveState(nodeId: string): void {
  const previousLocalSnapshot = runtimeVisualLocalStore.get(nodeId);
  if (!previousLocalSnapshot) {
    return;
  }

  runtimeVisualLocalStore.delete(nodeId);
  invalidateCanvasRuntimeVisualStateSnapshotCache(nodeId);
  emitCanvasRuntimeVisualLocalRevision();
  emitCanvasRuntimeVisualState(nodeId);
}

export function clearCanvasRuntimeVisualStateSnapshot(): void {
  if (runtimeVisualBaseStore.size === 0 && runtimeVisualLocalStore.size === 0) {
    return;
  }

  const nodeIds = new Set([
    ...runtimeVisualBaseStore.keys(),
    ...runtimeVisualLocalStore.keys(),
  ]);

  runtimeVisualBaseStore.clear();
  runtimeVisualLocalStore.clear();
  runtimeVisualSnapshotCache.clear();
  emitCanvasRuntimeVisualLocalRevision();

  nodeIds.forEach((nodeId) => {
    emitCanvasRuntimeVisualState(nodeId);
  });
}

export function getCanvasRuntimeVisualState(
  nodeId: string,
  fallbackScheduledRenderTier: NodeRenderTier = 'full',
): CanvasRuntimeVisualStateSnapshot {
  return buildCanvasRuntimeVisualStateSnapshot(nodeId, fallbackScheduledRenderTier);
}

function subscribeCanvasRuntimeVisualState(nodeId: string, listener: Listener): () => void {
  const listeners = runtimeVisualListeners.get(nodeId) ?? new Set<Listener>();
  listeners.add(listener);
  runtimeVisualListeners.set(nodeId, listeners);

  return (): void => {
    const currentListeners = runtimeVisualListeners.get(nodeId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      runtimeVisualListeners.delete(nodeId);
    }
  };
}

function subscribeCanvasRuntimeVisualLocalRevision(listener: Listener): () => void {
  localActiveRevisionListeners.add(listener);

  return (): void => {
    localActiveRevisionListeners.delete(listener);
  };
}

export function useCanvasRuntimeVisualState(
  nodeId: string,
  fallbackScheduledRenderTier: NodeRenderTier = 'full',
): CanvasRuntimeVisualStateSnapshot {
  const subscribe = useCallback(
    (listener: Listener) => subscribeCanvasRuntimeVisualState(nodeId, listener),
    [nodeId],
  );
  const getSnapshot = useCallback(
    () => getCanvasRuntimeVisualState(nodeId, fallbackScheduledRenderTier),
    [fallbackScheduledRenderTier, nodeId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useCanvasRuntimeVisualLocalRevision(): number {
  return useSyncExternalStore(
    subscribeCanvasRuntimeVisualLocalRevision,
    () => localActiveRevision,
    () => localActiveRevision,
  );
}
