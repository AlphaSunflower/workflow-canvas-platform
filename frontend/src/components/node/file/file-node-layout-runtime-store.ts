import type { FileNodeData } from '@/types';
import { recordCanvasNodePatchQueueMetric } from '@/utils/performance';

export interface FileNodeLayoutRuntimeSnapshot {
  nodeId: string;
  fileId: string;
  nodeType: FileNodeData['type'];
  width: number;
  height: number;
  duration?: number;
  reason?: string;
  updatedAt: number;
}

export interface SetFileNodeLayoutRuntimeSnapshotInput {
  nodeId: string;
  fileId: string;
  nodeType: FileNodeData['type'];
  width: number;
  height: number;
  duration?: number;
  reason?: string;
  now?: number;
}

const layoutRuntimeSnapshots = new Map<string, FileNodeLayoutRuntimeSnapshot>();

function normalizeDuration(duration: number | undefined): number | undefined {
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
    ? duration
    : undefined;
}

export function setFileNodeLayoutRuntimeSnapshot(
  input: SetFileNodeLayoutRuntimeSnapshotInput,
): FileNodeLayoutRuntimeSnapshot | null {
  const width = Math.round(input.width);
  const height = Math.round(input.height);
  if (width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  const duration = normalizeDuration(input.duration);
  const current = layoutRuntimeSnapshots.get(input.nodeId);
  if (
    current &&
    current.fileId === input.fileId &&
    current.nodeType === input.nodeType &&
    current.width === width &&
    current.height === height &&
    current.duration === duration
  ) {
    return current;
  }

  const snapshot: FileNodeLayoutRuntimeSnapshot = {
    nodeId: input.nodeId,
    fileId: input.fileId,
    nodeType: input.nodeType,
    width,
    height,
    duration,
    reason: input.reason,
    updatedAt: input.now ?? Date.now(),
  };
  layoutRuntimeSnapshots.set(input.nodeId, snapshot);
  recordCanvasNodePatchQueueMetric({
    pendingCount: layoutRuntimeSnapshots.size,
    enqueueCount: 1,
  });
  return snapshot;
}

export function getFileNodeLayoutRuntimeSnapshot(
  nodeId: string,
): FileNodeLayoutRuntimeSnapshot | undefined {
  return layoutRuntimeSnapshots.get(nodeId);
}

export function consumeFileNodeLayoutRuntimeSnapshot(
  nodeId: string,
): FileNodeLayoutRuntimeSnapshot | undefined {
  const snapshot = layoutRuntimeSnapshots.get(nodeId);
  if (snapshot) {
    layoutRuntimeSnapshots.delete(nodeId);
    recordCanvasNodePatchQueueMetric({
      pendingCount: layoutRuntimeSnapshots.size,
    });
  }

  return snapshot;
}

export function consumeFileNodeLayoutRuntimeSnapshots(): FileNodeLayoutRuntimeSnapshot[] {
  const snapshots = Array.from(layoutRuntimeSnapshots.values())
    .sort((left, right) => left.updatedAt - right.updatedAt);
  layoutRuntimeSnapshots.clear();
  if (snapshots.length > 0) {
    recordCanvasNodePatchQueueMetric({
      pendingCount: 0,
      flushCount: 1,
    });
  }
  return snapshots;
}

export function clearFileNodeLayoutRuntimeSnapshot(nodeId: string): boolean {
  const deleted = layoutRuntimeSnapshots.delete(nodeId);
  if (deleted) {
    recordCanvasNodePatchQueueMetric({
      pendingCount: layoutRuntimeSnapshots.size,
    });
  }

  return deleted;
}

export function clearFileNodeLayoutRuntimeSnapshots(): void {
  if (layoutRuntimeSnapshots.size === 0) {
    return;
  }

  layoutRuntimeSnapshots.clear();
  recordCanvasNodePatchQueueMetric({
    pendingCount: 0,
  });
}

export function getFileNodeLayoutRuntimeSnapshotCount(): number {
  return layoutRuntimeSnapshots.size;
}
