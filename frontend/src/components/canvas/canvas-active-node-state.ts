import { useCallback, useSyncExternalStore } from 'react';
import type { FileNodeActiveReason, FileNodeData, NodeActiveState } from '@/types';

export interface ResolveCanvasActiveNodeStateInput {
  selected?: boolean;
  hovered?: boolean;
  dragging?: boolean;
  contextMenuTarget?: boolean;
  importError?: boolean;
}

export interface ResolveFileNodeActiveStateInput {
  canvasState?: CanvasActiveNodeStateSnapshot;
  uploadStatus?: string | null;
  isViewerOpen?: boolean;
  isPreviewModalOpen?: boolean;
  isPreviewPlaying?: boolean;
  isResizing?: boolean;
  isRotating?: boolean;
}

export interface CanvasActiveNodeStateSnapshot {
  activeState: NodeActiveState;
  activeReasons: FileNodeActiveReason[];
}

type Listener = () => void;

const baseActiveNodeStateStore = new Map<string, CanvasActiveNodeStateSnapshot>();
const promotedActiveNodeReasonStore = new Map<string, Set<FileNodeActiveReason>>();
const activeNodeStateSnapshotCache = new Map<string, CanvasActiveNodeStateSnapshot>();
const activeNodeStateListeners = new Map<string, Set<Listener>>();
const viewerOpenRequestStore = new Map<string, number>();
const viewerOpenRequestListeners = new Map<string, Set<Listener>>();

const ACTIVE_UPLOAD_STATUSES = new Set(['waiting', 'hashing', 'registering', 'uploading']);
const PASSIVE_NODE_STATE: CanvasActiveNodeStateSnapshot = {
  activeState: 'passive',
  activeReasons: [],
};

function buildSnapshot(reasons: FileNodeActiveReason[]): CanvasActiveNodeStateSnapshot {
  const sortedReasons = Array.from(new Set(reasons)).sort();
  if (sortedReasons.length === 0) {
    return PASSIVE_NODE_STATE;
  }

  return {
    activeState: 'active',
    activeReasons: sortedReasons,
  };
}

function areSnapshotsEqual(
  left: CanvasActiveNodeStateSnapshot | undefined,
  right: CanvasActiveNodeStateSnapshot
): boolean {
  if (!left) {
    return false;
  }

  if (left.activeState !== right.activeState || left.activeReasons.length !== right.activeReasons.length) {
    return false;
  }

  return left.activeReasons.every((reason, index) => reason === right.activeReasons[index]);
}

function emitNodeActiveState(nodeId: string): void {
  activeNodeStateListeners.get(nodeId)?.forEach((listener) => {
    listener();
  });
}

function emitViewerOpenRequest(nodeId: string): void {
  viewerOpenRequestListeners.get(nodeId)?.forEach((listener) => {
    listener();
  });
}

function invalidateCanvasActiveNodeStateSnapshot(nodeId: string): void {
  activeNodeStateSnapshotCache.delete(nodeId);
}

export function resolveCanvasActiveNodeState(
  input: ResolveCanvasActiveNodeStateInput
): CanvasActiveNodeStateSnapshot {
  const reasons: FileNodeActiveReason[] = [];

  if (input.selected) {
    reasons.push('selected');
  }
  if (input.hovered) {
    reasons.push('hovered');
  }
  if (input.dragging) {
    reasons.push('dragging');
  }
  if (input.contextMenuTarget) {
    reasons.push('context-menu');
  }
  if (input.importError) {
    reasons.push('import-error');
  }

  return buildSnapshot(reasons);
}

export function resolveFileNodeActiveState(
  input: ResolveFileNodeActiveStateInput
): CanvasActiveNodeStateSnapshot {
  const reasons = [...(input.canvasState?.activeReasons ?? [])];

  if (input.uploadStatus && ACTIVE_UPLOAD_STATUSES.has(input.uploadStatus)) {
    reasons.push('upload-active');
  }
  if (input.isViewerOpen) {
    reasons.push('viewer');
  }
  if (input.isPreviewModalOpen) {
    reasons.push('preview-modal');
  }
  if (input.isPreviewPlaying) {
    reasons.push('preview-playing');
  }
  if (input.isResizing) {
    reasons.push('resizing');
  }
  if (input.isRotating) {
    reasons.push('rotating');
  }

  return buildSnapshot(reasons);
}

export function createCanvasActiveNodeStateEntry(node: Pick<FileNodeData, 'id' | 'status'>, options: {
  isSelected?: boolean;
  isHovered?: boolean;
  isDragging?: boolean;
  isContextMenuTarget?: boolean;
} = {}): readonly [string, CanvasActiveNodeStateSnapshot] {
  return [
    node.id.value,
    resolveCanvasActiveNodeState({
      selected: options.isSelected,
      hovered: options.isHovered,
      dragging: options.isDragging,
      contextMenuTarget: options.isContextMenuTarget,
      importError: node.status === 'error',
    }),
  ] as const;
}

export function syncCanvasActiveNodeStateSnapshot(
  entries: Iterable<readonly [string, CanvasActiveNodeStateSnapshot]>
): void {
  const nextSnapshot = new Map<string, CanvasActiveNodeStateSnapshot>();
  const changedNodeIds = new Set<string>();

  for (const [nodeId, snapshot] of entries) {
    nextSnapshot.set(nodeId, snapshot);
  }

  baseActiveNodeStateStore.forEach((snapshot, nodeId) => {
    const nextState = nextSnapshot.get(nodeId);
    if (!nextState) {
      baseActiveNodeStateStore.delete(nodeId);
      invalidateCanvasActiveNodeStateSnapshot(nodeId);
      changedNodeIds.add(nodeId);
      return;
    }

    if (!areSnapshotsEqual(snapshot, nextState)) {
      changedNodeIds.add(nodeId);
    }
  });

  nextSnapshot.forEach((snapshot, nodeId) => {
    const previous = baseActiveNodeStateStore.get(nodeId);
    if (areSnapshotsEqual(previous, snapshot)) {
      return;
    }

    baseActiveNodeStateStore.set(nodeId, snapshot);
    invalidateCanvasActiveNodeStateSnapshot(nodeId);
    changedNodeIds.add(nodeId);
  });

  changedNodeIds.forEach((nodeId) => {
    emitNodeActiveState(nodeId);
  });
}

export function clearCanvasActiveNodeStateSnapshot(): void {
  if (
    baseActiveNodeStateStore.size === 0 &&
    promotedActiveNodeReasonStore.size === 0 &&
    viewerOpenRequestStore.size === 0
  ) {
    return;
  }

  const nodeIds = new Set([
    ...baseActiveNodeStateStore.keys(),
    ...promotedActiveNodeReasonStore.keys(),
  ]);
  const viewerRequestNodeIds = Array.from(viewerOpenRequestStore.keys());
  baseActiveNodeStateStore.clear();
  promotedActiveNodeReasonStore.clear();
  activeNodeStateSnapshotCache.clear();
  viewerOpenRequestStore.clear();
  nodeIds.forEach((nodeId) => {
    emitNodeActiveState(nodeId);
  });
  viewerRequestNodeIds.forEach((nodeId) => {
    emitViewerOpenRequest(nodeId);
  });
}

export function promoteCanvasNode(nodeId: string, reasons: FileNodeActiveReason[]): void {
  const nextReasons = new Set(reasons);
  const previousReasons = promotedActiveNodeReasonStore.get(nodeId);
  if (
    previousReasons &&
    previousReasons.size === nextReasons.size &&
    Array.from(previousReasons).every((reason) => nextReasons.has(reason))
  ) {
    return;
  }

  promotedActiveNodeReasonStore.set(nodeId, nextReasons);
  invalidateCanvasActiveNodeStateSnapshot(nodeId);
  emitNodeActiveState(nodeId);
}

export function clearPromotedCanvasNodeReason(nodeId: string, reason: FileNodeActiveReason): void {
  const previous = promotedActiveNodeReasonStore.get(nodeId);
  if (!previous) {
    return;
  }

  if (!previous.has(reason)) {
    return;
  }

  previous.delete(reason);

  if (previous.size === 0) {
    promotedActiveNodeReasonStore.delete(nodeId);
  } else {
    promotedActiveNodeReasonStore.set(nodeId, new Set(previous));
  }
  invalidateCanvasActiveNodeStateSnapshot(nodeId);
  emitNodeActiveState(nodeId);
}

export function getCanvasActiveNodeState(
  nodeId: string
): CanvasActiveNodeStateSnapshot {
  const baseSnapshot = baseActiveNodeStateStore.get(nodeId);
  const promotedReasons = promotedActiveNodeReasonStore.get(nodeId);
  if (!promotedReasons || promotedReasons.size === 0) {
    return baseSnapshot ?? PASSIVE_NODE_STATE;
  }

  const cachedSnapshot = activeNodeStateSnapshotCache.get(nodeId);
  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  const snapshot = buildSnapshot([
    ...(baseSnapshot?.activeReasons ?? []),
    ...promotedReasons,
  ]);
  activeNodeStateSnapshotCache.set(nodeId, snapshot);
  return snapshot;
}

export function requestCanvasNodeViewerOpen(nodeId: string): void {
  viewerOpenRequestStore.set(nodeId, (viewerOpenRequestStore.get(nodeId) ?? 0) + 1);
  emitViewerOpenRequest(nodeId);
}

export function consumeCanvasNodeViewerOpenRequest(nodeId: string): number {
  const token = viewerOpenRequestStore.get(nodeId) ?? 0;
  if (token > 0) {
    viewerOpenRequestStore.delete(nodeId);
    emitViewerOpenRequest(nodeId);
  }
  return token;
}

function subscribeCanvasActiveNodeState(nodeId: string, listener: Listener): () => void {
  const listeners = activeNodeStateListeners.get(nodeId) ?? new Set<Listener>();
  listeners.add(listener);
  activeNodeStateListeners.set(nodeId, listeners);

  return (): void => {
    const currentListeners = activeNodeStateListeners.get(nodeId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      activeNodeStateListeners.delete(nodeId);
    }
  };
}

function subscribeCanvasNodeViewerOpenRequest(nodeId: string, listener: Listener): () => void {
  const listeners = viewerOpenRequestListeners.get(nodeId) ?? new Set<Listener>();
  listeners.add(listener);
  viewerOpenRequestListeners.set(nodeId, listeners);

  return (): void => {
    const currentListeners = viewerOpenRequestListeners.get(nodeId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      viewerOpenRequestListeners.delete(nodeId);
    }
  };
}

export function useCanvasActiveNodeState(nodeId: string): CanvasActiveNodeStateSnapshot {
  const subscribe = useCallback((listener: Listener) => subscribeCanvasActiveNodeState(nodeId, listener), [nodeId]);
  const getSnapshot = useCallback(() => getCanvasActiveNodeState(nodeId), [nodeId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useCanvasNodeViewerOpenRequest(nodeId: string): number {
  const subscribe = useCallback((listener: Listener) => subscribeCanvasNodeViewerOpenRequest(nodeId, listener), [nodeId]);
  const getSnapshot = useCallback(() => viewerOpenRequestStore.get(nodeId) ?? 0, [nodeId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
