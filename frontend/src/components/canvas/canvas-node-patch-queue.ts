import type { AnyNodeData } from '@/types';
import {
  recordCanvasNodePatchQueueMetric,
  recordCanvasTraceEvent,
} from '@/utils/performance';

import {
  type CanvasSyncNodeLike,
} from './canvas-sync';

export type CanvasNodePatchQueuePatcher =
  | Partial<AnyNodeData>
  | ((node: AnyNodeData) => Partial<AnyNodeData> | null | undefined);

export interface CanvasNodePatchQueueMeta {
  batchId?: string;
  reason?: string;
  sync?: boolean;
  force?: boolean;
  allowNodeShrink?: boolean;
}

export interface CanvasNodePatchQueueCommitMeta extends CanvasNodePatchQueueMeta {
  nodeId: string;
  nodeIds?: string[];
  sync: boolean;
  force?: boolean;
  mergedPatchCount: number;
}

export interface CanvasNodePatchQueueOptions<T extends CanvasSyncNodeLike> {
  getNodes: () => readonly T[];
  commit: (nextNodes: T[], meta: CanvasNodePatchQueueCommitMeta) => void;
  maxFlushPerFrame?: number;
  scheduleFrame?: (callback: () => void) => number;
  cancelFrame?: (frameId: number) => void;
  now?: () => number;
}

interface PendingPatchEntry {
  nodeId: string;
  patchers: CanvasNodePatchQueuePatcher[];
  meta: CanvasNodePatchQueueMeta;
  sequence: number;
}

const DEFAULT_MAX_FLUSH_PER_FRAME = 8;

function defaultScheduleFrame(callback: () => void): number {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(() => callback());
  }

  return globalThis.setTimeout(callback, 16) as unknown as number;
}

function defaultCancelFrame(frameId: number): void {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frameId);
    return;
  }

  globalThis.clearTimeout(frameId);
}

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
}

function normalizeMaxFlushPerFrame(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_FLUSH_PER_FRAME;
  }

  return Math.max(1, Math.floor(value));
}

function mergePatchers(
  patchers: readonly CanvasNodePatchQueuePatcher[],
  nodeData: AnyNodeData,
): Partial<AnyNodeData> | null {
  let currentData = nodeData;
  let mergedPatch: Partial<AnyNodeData> | null = null;

  patchers.forEach((patcher) => {
    const patch = typeof patcher === 'function' ? patcher(currentData) : patcher;
    if (!patch) {
      return;
    }

    mergedPatch = {
      ...(mergedPatch ?? {}),
      ...patch,
    };
    currentData = {
      ...currentData,
      ...patch,
      position: patch.position ?? currentData.position,
    } as AnyNodeData;
  });

  return mergedPatch;
}

function mergeMeta(
  current: CanvasNodePatchQueueMeta,
  next: CanvasNodePatchQueueMeta,
): CanvasNodePatchQueueMeta {
  return {
    batchId: next.batchId ?? current.batchId,
    reason: next.reason ?? current.reason,
    sync: Boolean(current.sync ?? true) || Boolean(next.sync ?? true),
    force: Boolean(current.force) || Boolean(next.force) || undefined,
    allowNodeShrink: Boolean(current.allowNodeShrink) || Boolean(next.allowNodeShrink) || undefined,
  };
}

function mergeCommitMeta(
  entries: readonly PendingPatchEntry[],
  committedNodeIds: readonly string[],
  mergedPatchCount: number,
): CanvasNodePatchQueueCommitMeta {
  const firstEntry = entries[0];
  const firstCommittedNodeId = committedNodeIds[0] ?? firstEntry?.nodeId ?? 'unknown';
  const batchIds = Array.from(new Set(entries.map((entry) => entry.meta.batchId).filter(Boolean)));

  return {
    batchId: batchIds.length <= 1 ? batchIds[0] : 'mixed',
    reason: firstEntry?.meta.reason,
    sync: entries.some((entry) => entry.meta.sync ?? true),
    force: entries.some((entry) => entry.meta.force) || undefined,
    allowNodeShrink: entries.some((entry) => entry.meta.allowNodeShrink) || undefined,
    nodeId: firstCommittedNodeId,
    nodeIds: [...committedNodeIds],
    mergedPatchCount,
  };
}

function applyPatchEntries<T extends CanvasSyncNodeLike>(
  currentNodes: readonly T[],
  entries: readonly PendingPatchEntry[],
): {
  nextNodes: T[];
  committedNodeIds: string[];
  mergedPatchCount: number;
} {
  const entriesByNodeId = new Map<string, PendingPatchEntry>();
  entries.forEach((entry) => {
    entriesByNodeId.set(entry.nodeId, entry);
  });

  const committedNodeIds: string[] = [];
  let mergedPatchCount = 0;
  let hasAnyUpdate = false;
  const nextNodes = currentNodes.map((node) => {
    const entry = entriesByNodeId.get(node.id);
    if (!entry) {
      return node;
    }

    const patch = mergePatchers(entry.patchers, node.data);
    if (!patch) {
      return node;
    }

    hasAnyUpdate = true;
    committedNodeIds.push(entry.nodeId);
    mergedPatchCount += entry.patchers.length;
    const nextData = {
      ...node.data,
      ...patch,
      position: patch.position ?? node.data.position,
    } as T['data'];

    return {
      ...node,
      position: nextData.position,
      data: nextData,
    };
  });

  return {
    nextNodes: hasAnyUpdate ? nextNodes : [...currentNodes] as T[],
    committedNodeIds,
    mergedPatchCount,
  };
}

export class CanvasNodePatchQueue<T extends CanvasSyncNodeLike> {
  private readonly entries = new Map<string, PendingPatchEntry>();
  private readonly getNodes: CanvasNodePatchQueueOptions<T>['getNodes'];
  private readonly commit: CanvasNodePatchQueueOptions<T>['commit'];
  private readonly scheduleFrameImpl: NonNullable<CanvasNodePatchQueueOptions<T>['scheduleFrame']>;
  private readonly cancelFrameImpl: NonNullable<CanvasNodePatchQueueOptions<T>['cancelFrame']>;
  private readonly now: NonNullable<CanvasNodePatchQueueOptions<T>['now']>;
  private readonly maxFlushPerFrame: number;
  private frameId: number | null = null;
  private nextSequence = 0;
  private disposed = false;

  constructor(options: CanvasNodePatchQueueOptions<T>) {
    this.getNodes = options.getNodes;
    this.commit = options.commit;
    this.scheduleFrameImpl = options.scheduleFrame ?? defaultScheduleFrame;
    this.cancelFrameImpl = options.cancelFrame ?? defaultCancelFrame;
    this.now = options.now ?? defaultNow;
    this.maxFlushPerFrame = normalizeMaxFlushPerFrame(options.maxFlushPerFrame);
  }

  enqueue(
    nodeId: string,
    patcher: CanvasNodePatchQueuePatcher,
    meta: CanvasNodePatchQueueMeta = {},
  ): boolean {
    if (this.disposed) {
      return false;
    }

    const current = this.entries.get(nodeId);
    if (current) {
      current.patchers.push(patcher);
      current.meta = mergeMeta(current.meta, meta);
    } else {
      this.entries.set(nodeId, {
        nodeId,
        patchers: [patcher],
        meta: {
          ...meta,
          sync: meta.sync ?? true,
        },
        sequence: this.nextSequence += 1,
      });
    }

    this.recordQueueMetric({ enqueueCount: 1 });
    recordCanvasTraceEvent({
      type: 'nodePatch.enqueue',
      phase: 'instant',
      data: {
        pendingCount: this.entries.size,
        reason: meta.reason,
        batchId: meta.batchId,
      },
    });
    this.scheduleIfNeeded();
    return true;
  }

  cancel(nodeId?: string): number {
    if (this.disposed || this.entries.size === 0) {
      return 0;
    }

    const cancelledCount = typeof nodeId === 'string'
      ? (this.entries.delete(nodeId) ? 1 : 0)
      : this.cancelAllEntries();

    if (cancelledCount > 0) {
      this.cancelFrameIfIdle();
      this.recordQueueMetric();
      recordCanvasTraceEvent({
        type: 'nodePatch.cancel',
        phase: 'instant',
        data: {
          pendingCount: this.entries.size,
          cancelledCount,
          nodeId,
        },
      });
    }

    return cancelledCount;
  }

  flush(): number {
    if (this.disposed || this.entries.size === 0) {
      return 0;
    }

    if (this.frameId !== null) {
      this.cancelFrameImpl(this.frameId);
      this.frameId = null;
    }

    return this.processBatch(Number.POSITIVE_INFINITY);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    if (this.frameId !== null) {
      this.cancelFrameImpl(this.frameId);
      this.frameId = null;
    }

    this.entries.clear();
    this.recordQueueMetric();
  }

  getPendingCount(): number {
    return this.entries.size;
  }

  private cancelAllEntries(): number {
    const cancelledCount = this.entries.size;
    this.entries.clear();
    return cancelledCount;
  }

  private cancelFrameIfIdle(): void {
    if (this.entries.size > 0 || this.frameId === null) {
      return;
    }

    this.cancelFrameImpl(this.frameId);
    this.frameId = null;
  }

  private scheduleIfNeeded(): void {
    if (this.disposed || this.frameId !== null || this.entries.size === 0) {
      return;
    }

    this.frameId = this.scheduleFrameImpl(() => {
      this.frameId = null;
      this.processBatch(this.maxFlushPerFrame);
      this.scheduleIfNeeded();
    });
  }

  private processBatch(limit: number): number {
    if (this.disposed || this.entries.size === 0) {
      return 0;
    }

    const startedAt = this.now();
    const entries = Array.from(this.entries.values())
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, limit);

    entries.forEach((entry) => {
      this.entries.delete(entry.nodeId);
    });

    const {
      nextNodes,
      committedNodeIds,
      mergedPatchCount,
    } = applyPatchEntries(this.getNodes(), entries);

    if (committedNodeIds.length > 0) {
      this.commit(nextNodes, mergeCommitMeta(entries, committedNodeIds, mergedPatchCount));
    }

    this.recordQueueMetric({
      flushCount: entries.length > 0 ? 1 : 0,
      flushDurationMs: this.now() - startedAt,
    });
    recordCanvasTraceEvent({
      type: 'nodePatch.flush',
      phase: 'end',
      durationMs: this.now() - startedAt,
      data: {
        pendingCount: this.entries.size,
        entryCount: entries.length,
        committedNodeCount: committedNodeIds.length,
        mergedPatchCount,
        reason: entries[0]?.meta.reason,
        batchId: entries[0]?.meta.batchId,
      },
    });
    return committedNodeIds.length;
  }

  private recordQueueMetric(extra: {
    enqueueCount?: number;
    flushCount?: number;
    flushDurationMs?: number;
  } = {}): void {
    recordCanvasNodePatchQueueMetric({
      pendingCount: this.entries.size,
      ...extra,
    });
  }
}

export function createCanvasNodePatchQueue<T extends CanvasSyncNodeLike>(
  options: CanvasNodePatchQueueOptions<T>,
): CanvasNodePatchQueue<T> {
  return new CanvasNodePatchQueue(options);
}
