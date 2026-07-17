import { useCallback, useSyncExternalStore } from 'react';

type Listener = () => void;

interface CanvasImageFirstPaintEntry {
  src: string;
}

const canvasImageFirstPaintStore = new Map<string, CanvasImageFirstPaintEntry>();
const canvasImageFirstPaintListeners = new Map<string, Set<Listener>>();

function emitCanvasImageFirstPaint(nodeId: string): void {
  canvasImageFirstPaintListeners.get(nodeId)?.forEach((listener) => {
    listener();
  });
}

export function hasCanvasImageFirstPainted(nodeId: string, src?: string): boolean {
  if (!src) {
    return false;
  }

  return canvasImageFirstPaintStore.get(nodeId)?.src === src;
}

export function markCanvasImageFirstPainted(nodeId: string, src: string): void {
  if (!src) {
    return;
  }

  const previous = canvasImageFirstPaintStore.get(nodeId);
  if (previous?.src === src) {
    return;
  }

  canvasImageFirstPaintStore.set(nodeId, { src });
  emitCanvasImageFirstPaint(nodeId);
}

export function clearCanvasImageFirstPaint(nodeId: string): void {
  if (!canvasImageFirstPaintStore.delete(nodeId)) {
    return;
  }

  emitCanvasImageFirstPaint(nodeId);
}

export function retainCanvasImageFirstPaintNodeIds(nodeIds: Iterable<string>): void {
  if (canvasImageFirstPaintStore.size === 0) {
    return;
  }

  const liveNodeIds = new Set(nodeIds);
  const removedNodeIds: string[] = [];

  canvasImageFirstPaintStore.forEach((_entry, nodeId) => {
    if (liveNodeIds.has(nodeId)) {
      return;
    }

    canvasImageFirstPaintStore.delete(nodeId);
    removedNodeIds.push(nodeId);
  });

  removedNodeIds.forEach((nodeId) => {
    emitCanvasImageFirstPaint(nodeId);
  });
}

export function clearCanvasImageFirstPaintState(): void {
  if (canvasImageFirstPaintStore.size === 0) {
    return;
  }

  const nodeIds = Array.from(canvasImageFirstPaintStore.keys());
  canvasImageFirstPaintStore.clear();
  nodeIds.forEach((nodeId) => {
    emitCanvasImageFirstPaint(nodeId);
  });
}

function subscribeCanvasImageFirstPaint(nodeId: string, listener: Listener): () => void {
  const listeners = canvasImageFirstPaintListeners.get(nodeId) ?? new Set<Listener>();
  listeners.add(listener);
  canvasImageFirstPaintListeners.set(nodeId, listeners);

  return (): void => {
    const currentListeners = canvasImageFirstPaintListeners.get(nodeId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      canvasImageFirstPaintListeners.delete(nodeId);
    }
  };
}

export function useCanvasImageFirstPainted(nodeId: string, src?: string): boolean {
  const subscribe = useCallback(
    (listener: Listener) => subscribeCanvasImageFirstPaint(nodeId, listener),
    [nodeId],
  );
  const getSnapshot = useCallback(
    () => hasCanvasImageFirstPainted(nodeId, src),
    [nodeId, src],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
