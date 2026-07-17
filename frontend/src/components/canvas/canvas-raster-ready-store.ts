import { useCallback, useSyncExternalStore } from 'react';

import type { CanvasImageRasterItem } from './canvas-image-raster-draw';
import { recordCanvasTraceEvent } from '@/utils/performance';

type Listener = () => void;

const DEFAULT_READY_ITEM_RETENTION_MS = 4_000;

export interface CanvasRasterReadySnapshot {
  version: number;
  items: CanvasImageRasterItem[];
}

export interface CanvasRasterReadyStoreReplaceOptions {
  retainPreviousReady?: boolean;
  retentionMs?: number;
}

export interface CanvasRasterReadyStoreOptions {
  now?: () => number;
  retentionMs?: number;
}

export interface CanvasRasterReadyStore {
  getSnapshot: () => CanvasRasterReadySnapshot;
  hasReadyItem: (nodeId: string, src?: string) => boolean;
  hasReadyNode: (nodeId: string) => boolean;
  getReadyNodeSrc: (nodeId: string) => string | undefined;
  replace: (items: readonly CanvasImageRasterItem[], options?: CanvasRasterReadyStoreReplaceOptions) => CanvasRasterReadySnapshot;
  upsert: (items: readonly CanvasImageRasterItem[], options?: CanvasRasterReadyStoreReplaceOptions) => CanvasRasterReadySnapshot;
  retainNodeIds: (nodeIds: Iterable<string>) => CanvasRasterReadySnapshot;
  clear: () => CanvasRasterReadySnapshot;
  subscribe: (listener: Listener) => () => void;
}

function areRasterReadyItemsEqual(
  left: CanvasImageRasterItem,
  right: CanvasImageRasterItem,
): boolean {
  return left.nodeId === right.nodeId &&
    left.fileName === right.fileName &&
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.rotation === right.rotation &&
    left.status === right.status &&
    left.src === right.src &&
    left.resourceSrc === right.resourceSrc;
}

function areRasterReadyItemListsEqual(
  left: readonly CanvasImageRasterItem[],
  right: readonly CanvasImageRasterItem[],
): boolean {
  return left.length === right.length &&
    left.every((item, index) => areRasterReadyItemsEqual(item, right[index]!));
}

function normalizeReadyItems(items: readonly CanvasImageRasterItem[]): CanvasImageRasterItem[] {
  return items
    .filter((item) => item.kind !== 'cluster' && item.status === 'ready' && Boolean(item.src))
    .map((item) => ({ ...item }));
}

function snapshotHasReadyItem(
  snapshot: CanvasRasterReadySnapshot,
  nodeId: string,
  src?: string,
): boolean {
  if (!src) {
    return false;
  }

  return snapshot.items.some((item) => item.nodeId === nodeId && item.src === src);
}

function snapshotHasReadyNode(
  snapshot: CanvasRasterReadySnapshot,
  nodeId: string,
): boolean {
  return snapshot.items.some((item) => item.nodeId === nodeId);
}

function snapshotGetReadyNodeSrc(
  snapshot: CanvasRasterReadySnapshot,
  nodeId: string,
): string | undefined {
  return snapshot.items.find((item) => item.nodeId === nodeId)?.src;
}

export function createCanvasRasterReadyStore(options: CanvasRasterReadyStoreOptions = {}): CanvasRasterReadyStore {
  const listeners = new Set<Listener>();
  const retainedItemExpirations = new Map<string, number>();
  const now = options.now ?? Date.now;
  const defaultRetentionMs = options.retentionMs ?? DEFAULT_READY_ITEM_RETENTION_MS;
  let snapshot: CanvasRasterReadySnapshot = {
    version: 0,
    items: [],
  };

  const emit = (): void => {
    listeners.forEach((listener) => listener());
  };

  const commit = (
    items: readonly CanvasImageRasterItem[],
    replaceOptions: CanvasRasterReadyStoreReplaceOptions = {},
  ): CanvasRasterReadySnapshot => {
    const readyItems = normalizeReadyItems(items);
    const readyNodeIds = new Set(readyItems.map((item) => item.nodeId));
    const retentionEnabled = replaceOptions.retainPreviousReady === true;
    const retentionMs = replaceOptions.retentionMs ?? defaultRetentionMs;
    const currentTime = now();

    if (!retentionEnabled) {
      retainedItemExpirations.clear();
    } else {
      snapshot.items.forEach((item) => {
        if (readyNodeIds.has(item.nodeId)) {
          retainedItemExpirations.delete(item.nodeId);
          return;
        }

        if (!retainedItemExpirations.has(item.nodeId)) {
          retainedItemExpirations.set(item.nodeId, currentTime + retentionMs);
        }
      });
    }

    retainedItemExpirations.forEach((expiresAt, nodeId) => {
      if (expiresAt <= currentTime || readyNodeIds.has(nodeId)) {
        retainedItemExpirations.delete(nodeId);
      }
    });

    const nextItems = retentionEnabled
      ? [
        ...readyItems,
        ...snapshot.items.filter((item) => (
          !readyNodeIds.has(item.nodeId) &&
          (retainedItemExpirations.get(item.nodeId) ?? 0) > currentTime
        )),
      ]
      : readyItems;

    if (areRasterReadyItemListsEqual(snapshot.items, nextItems)) {
      return snapshot;
    }

    snapshot = {
      version: snapshot.version + 1,
      items: nextItems,
    };
    recordCanvasTraceEvent({
      type: 'raster.readyStoreCommit',
      phase: 'instant',
      data: {
        version: snapshot.version,
        itemCount: nextItems.length,
        readyItemCount: readyItems.length,
        retainedItemCount: Math.max(0, nextItems.length - readyItems.length),
      },
    });
    emit();
    return snapshot;
  };

  const commitUpsert = (
    items: readonly CanvasImageRasterItem[],
    replaceOptions: CanvasRasterReadyStoreReplaceOptions = {},
  ): CanvasRasterReadySnapshot => {
    const readyItems = normalizeReadyItems(items);
    const readyNodeIds = new Set(readyItems.map((item) => item.nodeId));
    const retentionEnabled = replaceOptions.retainPreviousReady === true;
    const retentionMs = replaceOptions.retentionMs ?? defaultRetentionMs;
    const currentTime = now();
    const expiredNodeIds = new Set<string>();

    readyNodeIds.forEach((nodeId) => {
      retainedItemExpirations.delete(nodeId);
    });
    retainedItemExpirations.forEach((expiresAt, nodeId) => {
      if (expiresAt <= currentTime) {
        expiredNodeIds.add(nodeId);
        retainedItemExpirations.delete(nodeId);
      }
    });
    if (retentionEnabled) {
      snapshot.items.forEach((item) => {
        if (
          readyNodeIds.has(item.nodeId) ||
          expiredNodeIds.has(item.nodeId) ||
          retainedItemExpirations.has(item.nodeId)
        ) {
          return;
        }

        retainedItemExpirations.set(item.nodeId, currentTime + retentionMs);
      });
    } else {
      retainedItemExpirations.clear();
    }

    const nextItemsByNodeId = new Map<string, CanvasImageRasterItem>();
    snapshot.items.forEach((item) => {
      if (expiredNodeIds.has(item.nodeId)) {
        return;
      }

      const retainedUntil = retainedItemExpirations.get(item.nodeId);
      if (!retentionEnabled && !readyNodeIds.has(item.nodeId)) {
        return;
      }

      if (retentionEnabled && retainedUntil !== undefined && retainedUntil <= currentTime) {
        return;
      }

      nextItemsByNodeId.set(item.nodeId, item);
    });
    readyItems.forEach((item) => {
      nextItemsByNodeId.set(item.nodeId, item);
    });

    const nextItems = Array.from(nextItemsByNodeId.values());
    if (areRasterReadyItemListsEqual(snapshot.items, nextItems)) {
      return snapshot;
    }

    snapshot = {
      version: snapshot.version + 1,
      items: nextItems,
    };
    recordCanvasTraceEvent({
      type: 'raster.readyStoreCommit',
      phase: 'instant',
      data: {
        version: snapshot.version,
        itemCount: nextItems.length,
        readyItemCount: readyItems.length,
        retainedItemCount: Math.max(0, nextItems.length - readyItems.length),
        mode: 'upsert',
      },
    });
    emit();
    return snapshot;
  };

  return {
    getSnapshot(): CanvasRasterReadySnapshot {
      return snapshot;
    },
    hasReadyItem(nodeId: string, src?: string): boolean {
      return snapshotHasReadyItem(snapshot, nodeId, src);
    },
    hasReadyNode(nodeId: string): boolean {
      return snapshotHasReadyNode(snapshot, nodeId);
    },
    getReadyNodeSrc(nodeId: string): string | undefined {
      return snapshotGetReadyNodeSrc(snapshot, nodeId);
    },
    replace(
      items: readonly CanvasImageRasterItem[],
      replaceOptions?: CanvasRasterReadyStoreReplaceOptions,
    ): CanvasRasterReadySnapshot {
      return commit(items, replaceOptions);
    },
    upsert(
      items: readonly CanvasImageRasterItem[],
      replaceOptions?: CanvasRasterReadyStoreReplaceOptions,
    ): CanvasRasterReadySnapshot {
      return commitUpsert(items, replaceOptions);
    },
    retainNodeIds(nodeIds: Iterable<string>): CanvasRasterReadySnapshot {
      const retainedNodeIds = new Set(nodeIds);
      retainedItemExpirations.forEach((_expiresAt, nodeId) => {
        if (!retainedNodeIds.has(nodeId)) {
          retainedItemExpirations.delete(nodeId);
        }
      });
      return commit(snapshot.items.filter((item) => retainedNodeIds.has(item.nodeId)));
    },
    clear(): CanvasRasterReadySnapshot {
      retainedItemExpirations.clear();
      return commit([]);
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}

export const canvasRasterReadyStore = createCanvasRasterReadyStore();

export function hasCanvasRasterReadyItem(nodeId: string, src?: string): boolean {
  return canvasRasterReadyStore.hasReadyItem(nodeId, src);
}

export function hasCanvasRasterReadyNode(nodeId: string): boolean {
  return canvasRasterReadyStore.hasReadyNode(nodeId);
}

export function getCanvasRasterReadyNodeSrc(nodeId: string): string | undefined {
  return canvasRasterReadyStore.getReadyNodeSrc(nodeId);
}

export function useCanvasRasterReadyItem(nodeId: string, src?: string): boolean {
  const subscribe = useCallback(
    (listener: Listener) => canvasRasterReadyStore.subscribe(listener),
    [],
  );
  const getSnapshot = useCallback(
    () => hasCanvasRasterReadyItem(nodeId, src),
    [nodeId, src],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useCanvasRasterReadyNode(nodeId: string): boolean {
  const subscribe = useCallback(
    (listener: Listener) => canvasRasterReadyStore.subscribe(listener),
    [],
  );
  const getSnapshot = useCallback(
    () => hasCanvasRasterReadyNode(nodeId),
    [nodeId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useCanvasRasterReadyNodeSrc(nodeId: string): string | undefined {
  const subscribe = useCallback(
    (listener: Listener) => canvasRasterReadyStore.subscribe(listener),
    [],
  );
  const getSnapshot = useCallback(
    () => getCanvasRasterReadyNodeSrc(nodeId),
    [nodeId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
