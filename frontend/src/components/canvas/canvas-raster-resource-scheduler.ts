import type { CanvasRasterImageNode } from './canvas-raster-image-resource-bridge';
import { recordCanvasTraceEvent } from '@/utils/performance';

export interface CanvasRasterResourceCandidate {
  node: CanvasRasterImageNode;
  active: boolean;
  importing: boolean;
  resourceSignature: string;
  priorityRank?: number;
  priorityScore?: number;
}

export interface CanvasRasterResourceSchedulerMetric {
  candidateNodeCount: number;
  registeredNodeCount: number;
  requestedNodeCount: number;
  cancelledNodeCount: number;
  candidateRemovedNodeCount?: number;
  signatureChangedNodeCount?: number;
  reprioritizedNodeCount?: number;
  skippedReadyNodeCount?: number;
  durationMs: number;
}

export interface CanvasRasterResourceSchedulerOptions {
  registerNodes: (nodes: readonly CanvasRasterImageNode[]) => readonly string[];
  requestNode: (nodeId: string) => Promise<void> | void;
  cancelNodeRequest?: (nodeId: string) => void;
  scheduleFrame?: (callback: () => void) => number;
  cancelFrame?: (frameId: number) => void;
  now?: () => number;
  passiveBatchSize?: number;
  importingBatchSize?: number;
  passiveMaxConcurrentRequests?: number;
  importingMaxConcurrentRequests?: number;
  onBatch?: (metric: CanvasRasterResourceSchedulerMetric) => void;
}

interface CanvasRasterResourceQueueEntry {
  id: string;
  candidate: CanvasRasterResourceCandidate;
  resourceSignature: string;
  prioritySignature: string;
  sequence: number;
  status: 'queued' | 'running' | 'completed';
  requestToken?: number;
}

const DEFAULT_PASSIVE_BATCH_SIZE = 4;
const DEFAULT_IMPORTING_BATCH_SIZE = 1;
const DEFAULT_PASSIVE_MAX_CONCURRENT_REQUESTS = 2;
const DEFAULT_IMPORTING_MAX_CONCURRENT_REQUESTS = 1;

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

function buildResourceSignature(candidate: CanvasRasterResourceCandidate): string {
  return [
    candidate.node.id,
    candidate.resourceSignature,
  ].join('|');
}

function buildPrioritySignature(candidate: CanvasRasterResourceCandidate): string {
  return [
    candidate.active ? 'active' : 'passive',
    candidate.importing ? 'importing' : 'stable',
    candidate.priorityRank ?? '',
    Math.round((candidate.priorityScore ?? 0) * 10),
  ].join('|');
}

function compareQueueEntries(
  left: CanvasRasterResourceQueueEntry,
  right: CanvasRasterResourceQueueEntry,
): number {
  if (left.candidate.active !== right.candidate.active) {
    return left.candidate.active ? -1 : 1;
  }

  const leftRank = left.candidate.priorityRank ?? Number.MAX_SAFE_INTEGER;
  const rightRank = right.candidate.priorityRank ?? Number.MAX_SAFE_INTEGER;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const leftScore = left.candidate.priorityScore ?? 0;
  const rightScore = right.candidate.priorityScore ?? 0;
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  return left.sequence - right.sequence;
}

export class CanvasRasterResourceScheduler {
  private readonly entries = new Map<string, CanvasRasterResourceQueueEntry>();
  private readonly inFlightTokens = new Map<string, number>();
  private readonly registerNodes: CanvasRasterResourceSchedulerOptions['registerNodes'];
  private readonly requestNode: CanvasRasterResourceSchedulerOptions['requestNode'];
  private readonly cancelNodeRequest: NonNullable<CanvasRasterResourceSchedulerOptions['cancelNodeRequest']>;
  private readonly scheduleFrameImpl: NonNullable<CanvasRasterResourceSchedulerOptions['scheduleFrame']>;
  private readonly cancelFrameImpl: NonNullable<CanvasRasterResourceSchedulerOptions['cancelFrame']>;
  private readonly now: NonNullable<CanvasRasterResourceSchedulerOptions['now']>;
  private readonly passiveBatchSize: number;
  private readonly importingBatchSize: number;
  private readonly passiveMaxConcurrentRequests: number;
  private readonly importingMaxConcurrentRequests: number;
  private readonly onBatch?: CanvasRasterResourceSchedulerOptions['onBatch'];
  private frameId: number | null = null;
  private nextSequence = 0;
  private nextRequestToken = 0;
  private paused = false;

  constructor(options: CanvasRasterResourceSchedulerOptions) {
    this.registerNodes = options.registerNodes;
    this.requestNode = options.requestNode;
    this.cancelNodeRequest = options.cancelNodeRequest ?? ((): void => undefined);
    this.scheduleFrameImpl = options.scheduleFrame ?? defaultScheduleFrame;
    this.cancelFrameImpl = options.cancelFrame ?? defaultCancelFrame;
    this.now = options.now ?? ((): number => performance.now());
    this.passiveBatchSize = options.passiveBatchSize ?? DEFAULT_PASSIVE_BATCH_SIZE;
    this.importingBatchSize = options.importingBatchSize ?? DEFAULT_IMPORTING_BATCH_SIZE;
    this.passiveMaxConcurrentRequests = options.passiveMaxConcurrentRequests ?? DEFAULT_PASSIVE_MAX_CONCURRENT_REQUESTS;
    this.importingMaxConcurrentRequests = options.importingMaxConcurrentRequests ?? DEFAULT_IMPORTING_MAX_CONCURRENT_REQUESTS;
    this.onBatch = options.onBatch;
  }

  update(candidates: readonly CanvasRasterResourceCandidate[]): void {
    const nextIds = new Set(candidates.map((candidate) => candidate.node.id));
    let cancelledNodeCount = 0;
    let candidateRemovedNodeCount = 0;
    let signatureChangedNodeCount = 0;
    let reprioritizedNodeCount = 0;
    let skippedReadyNodeCount = 0;

    Array.from(this.entries.entries()).forEach(([nodeId, entry]) => {
      if (nextIds.has(nodeId)) {
        return;
      }

      if (entry.status === 'queued') {
        const cancelled = this.cancelEntry(entry);
        cancelledNodeCount += cancelled;
        candidateRemovedNodeCount += cancelled;
        this.entries.delete(nodeId);
      }
    });

    candidates.forEach((candidate) => {
      const nodeId = candidate.node.id;
      const resourceSignature = buildResourceSignature(candidate);
      const prioritySignature = buildPrioritySignature(candidate);
      const previous = this.entries.get(nodeId);
      if (previous?.resourceSignature === resourceSignature) {
        if (previous.prioritySignature !== prioritySignature) {
          reprioritizedNodeCount += 1;
        }
        previous.candidate = candidate;
        previous.prioritySignature = prioritySignature;
        if (previous.status === 'completed') {
          skippedReadyNodeCount += 1;
        }
        return;
      }

      if (previous) {
        const cancelled = this.cancelEntry(previous);
        cancelledNodeCount += cancelled;
        signatureChangedNodeCount += cancelled;
      }

      this.entries.set(nodeId, {
        id: nodeId,
        candidate,
        resourceSignature,
        prioritySignature,
        sequence: this.nextSequence += 1,
        status: 'queued',
      });
    });

    if (cancelledNodeCount > 0 || reprioritizedNodeCount > 0 || skippedReadyNodeCount > 0) {
      this.emitMetric({
        registeredNodeCount: 0,
        requestedNodeCount: 0,
        cancelledNodeCount,
        candidateRemovedNodeCount,
        signatureChangedNodeCount,
        reprioritizedNodeCount,
        skippedReadyNodeCount,
        durationMs: 0,
      });
      if (cancelledNodeCount > 0) {
        const reason = candidateRemovedNodeCount > 0 && signatureChangedNodeCount > 0
          ? 'candidate-removed-and-resource-changed'
          : candidateRemovedNodeCount > 0
            ? 'candidate-removed'
            : 'resource-signature-changed';
        recordCanvasTraceEvent({
          type: 'resource.cancel',
          phase: 'instant',
          data: {
            reason,
            cancelledNodeCount,
            candidateRemovedNodeCount,
            signatureChangedNodeCount,
            candidateNodeCount: this.entries.size,
          },
        });
      }
      if (reprioritizedNodeCount > 0) {
        recordCanvasTraceEvent({
          type: 'resource.batch',
          phase: 'instant',
          data: {
            reason: 'reprioritize',
            reprioritizedNodeCount,
            skippedReadyNodeCount,
            candidateNodeCount: this.entries.size,
          },
        });
      }
    }

    this.scheduleIfNeeded();
  }

  pauseRequests(): void {
    this.paused = true;
    if (this.frameId !== null) {
      this.cancelFrameImpl(this.frameId);
      this.frameId = null;
    }
  }

  resumeRequests(): void {
    if (!this.paused) {
      return;
    }

    this.paused = false;
    this.scheduleIfNeeded();
  }

  cancelAll(): void {
    if (this.frameId !== null) {
      this.cancelFrameImpl(this.frameId);
      this.frameId = null;
    }

    Array.from(this.entries.values()).forEach((entry) => {
      this.cancelEntry(entry);
    });
    this.entries.clear();
    this.inFlightTokens.clear();
  }

  dispose(): void {
    this.cancelAll();
  }

  private cancelEntry(entry: CanvasRasterResourceQueueEntry): number {
    const shouldCancel = entry.status !== 'completed' || this.inFlightTokens.has(entry.id);
    if (!shouldCancel) {
      return 0;
    }

    this.inFlightTokens.delete(entry.id);
    entry.status = 'completed';
    entry.requestToken = undefined;
    this.cancelNodeRequest(entry.id);
    return 1;
  }

  private scheduleIfNeeded(): void {
    if (this.paused) {
      return;
    }

    if (this.frameId !== null) {
      return;
    }

    if (!this.hasQueuedEntries()) {
      return;
    }

    if (this.getAvailableRequestSlots() <= 0) {
      return;
    }

    this.frameId = this.scheduleFrameImpl(() => {
      this.frameId = null;
      this.processFrame();
    });
  }

  private processFrame(): void {
    if (this.paused) {
      return;
    }

    const startedAt = this.now();
    const batchSize = this.resolveBatchSize();
    const availableSlots = this.getAvailableRequestSlots();
    const batch: CanvasRasterResourceQueueEntry[] = [];

    while (batch.length < batchSize && batch.length < availableSlots) {
      const nextEntry = this.takeNextQueuedEntry();
      if (!nextEntry) {
        break;
      }

      nextEntry.status = 'running';
      nextEntry.requestToken = this.nextRequestToken += 1;
      this.inFlightTokens.set(nextEntry.id, nextEntry.requestToken);
      batch.push(nextEntry);
    }

    if (batch.length === 0) {
      this.scheduleIfNeeded();
      return;
    }

    const registeredNodeIds = this.registerNodes(batch.map((entry) => entry.candidate.node));
    const registeredNodeIdSet = new Set(registeredNodeIds);
    let requestedNodeCount = 0;
    recordCanvasTraceEvent({
      type: 'resource.register',
      phase: 'instant',
      data: {
        registeredNodeCount: registeredNodeIds.length,
        batchSize: batch.length,
      },
    });

    batch.forEach((entry) => {
      const token = entry.requestToken;
      if (!token || !registeredNodeIdSet.has(entry.id)) {
        this.inFlightTokens.delete(entry.id);
        entry.status = 'completed';
        entry.requestToken = undefined;
        return;
      }

      requestedNodeCount += 1;
      recordCanvasTraceEvent({
        type: 'resource.request',
        phase: 'start',
        data: {
          nodeId: entry.id,
          importing: entry.candidate.importing,
          active: entry.candidate.active,
        },
      });
      Promise.resolve(this.requestNode(entry.id))
        .catch(() => undefined)
        .finally(() => {
          if (this.inFlightTokens.get(entry.id) !== token) {
            return;
          }

          this.inFlightTokens.delete(entry.id);
          const current = this.entries.get(entry.id);
          if (current?.requestToken === token) {
            current.status = 'completed';
            current.requestToken = undefined;
          }
          this.scheduleIfNeeded();
        });
    });

    this.emitMetric({
      registeredNodeCount: registeredNodeIds.length,
      requestedNodeCount,
      cancelledNodeCount: 0,
      durationMs: this.now() - startedAt,
    });
    this.scheduleIfNeeded();
  }

  private takeNextQueuedEntry(): CanvasRasterResourceQueueEntry | undefined {
    return Array.from(this.entries.values())
      .filter((entry) => entry.status === 'queued')
      .sort(compareQueueEntries)[0];
  }

  private hasQueuedEntries(): boolean {
    return Array.from(this.entries.values()).some((entry) => entry.status === 'queued');
  }

  private hasImportingEntries(): boolean {
    return Array.from(this.entries.values()).some((entry) => entry.candidate.importing);
  }

  private resolveBatchSize(): number {
    return this.hasImportingEntries()
      ? this.importingBatchSize
      : this.passiveBatchSize;
  }

  private resolveMaxConcurrentRequests(): number {
    return this.hasImportingEntries()
      ? this.importingMaxConcurrentRequests
      : this.passiveMaxConcurrentRequests;
  }

  private getAvailableRequestSlots(): number {
    return Math.max(0, this.resolveMaxConcurrentRequests() - this.inFlightTokens.size);
  }

  private emitMetric(metric: Omit<CanvasRasterResourceSchedulerMetric, 'candidateNodeCount'>): void {
    this.onBatch?.({
      candidateNodeCount: this.entries.size,
      ...metric,
    });
  }
}

export function createCanvasRasterResourceScheduler(
  options: CanvasRasterResourceSchedulerOptions,
): CanvasRasterResourceScheduler {
  return new CanvasRasterResourceScheduler(options);
}
