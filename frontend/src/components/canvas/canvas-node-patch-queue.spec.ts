import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData } from '@/types';
import {
  getCanvasImagePerformanceSummary,
  resetCanvasImagePerformanceSnapshot,
  setCanvasImageDiagnosticsConfig,
} from '@/utils/performance';

import {
  createCanvasNodePatchQueue,
  type CanvasNodePatchQueueCommitMeta,
} from './canvas-node-patch-queue';
import type { CanvasSyncNodeLike } from './canvas-sync';

function enableDiagnostics(): void {
  resetCanvasImagePerformanceSnapshot();
  setCanvasImageDiagnosticsConfig({
    enabled: true,
    verbose: false,
    autoReport: false,
  });
}

function disableDiagnostics(): void {
  resetCanvasImagePerformanceSnapshot();
  setCanvasImageDiagnosticsConfig({
    enabled: false,
    verbose: false,
    autoReport: false,
  });
}

function createNode(id: string, overrides: Partial<FileNodeData> = {}): CanvasSyncNodeLike {
  const now = 1;
  const data: FileNodeData = {
    id: { value: id, display: `#${id}` },
    type: 'image',
    position: { x: 0, y: 0 },
    dimensions: { width: 100, height: 100 },
    rotation: 0,
    scale: 1,
    locked: false,
    status: 'idle',
    zIndex: 0,
    timestamp: { created: now, updated: now },
    fileId: `file-${id}`,
    fileName: `${id}.png`,
    fileSize: 1,
    mimeType: 'image/png',
    source: { type: 'imported', importMethod: 'local', importedAt: now },
    metadata: {},
    ...overrides,
  };

  return {
    id,
    type: 'image',
    position: data.position,
    data,
  };
}

function createManualFrameScheduler() {
  let nextFrameId = 0;
  const callbacks = new Map<number, () => void>();
  const cancelledFrameIds: number[] = [];

  return {
    schedule(callback: () => void): number {
      nextFrameId += 1;
      callbacks.set(nextFrameId, callback);
      return nextFrameId;
    },
    cancel(frameId: number): void {
      callbacks.delete(frameId);
      cancelledFrameIds.push(frameId);
    },
    flushOne(): boolean {
      const [frameId, callback] = callbacks.entries().next().value as [number, () => void] | undefined ?? [];
      if (!frameId || !callback) {
        return false;
      }

      callbacks.delete(frameId);
      callback();
      return true;
    },
    get size(): number {
      return callbacks.size;
    },
    get cancelled(): number[] {
      return cancelledFrameIds;
    },
  };
}

test('canvas node patch queue merges multiple patches for the same node into one commit', () => {
  const frames = createManualFrameScheduler();
  let nodes: CanvasSyncNodeLike[] = [createNode('node-1')];
  const commits: CanvasNodePatchQueueCommitMeta[] = [];
  const queue = createCanvasNodePatchQueue({
    getNodes: () => nodes,
    commit: (nextNodes, meta) => {
      nodes = nextNodes;
      commits.push(meta);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

  queue.enqueue('node-1', { status: 'processing' }, {
    batchId: 'batch-1',
    reason: 'metadata',
    sync: false,
  });
  queue.enqueue('node-1', { fileName: 'merged.png' }, {
    reason: 'thumbnail',
    sync: true,
    force: true,
  });

  assert.equal(frames.flushOne(), true);

  assert.equal(commits.length, 1);
  assert.equal(commits[0]?.nodeId, 'node-1');
  assert.deepEqual(commits[0]?.nodeIds, ['node-1']);
  assert.equal(commits[0]?.batchId, 'batch-1');
  assert.equal(commits[0]?.reason, 'thumbnail');
  assert.equal(commits[0]?.sync, true);
  assert.equal(commits[0]?.force, true);
  assert.equal(commits[0]?.mergedPatchCount, 2);
  assert.equal(nodes[0]?.data.status, 'processing');
  assert.equal((nodes[0]?.data as FileNodeData | undefined)?.fileName, 'merged.png');
  queue.dispose();
});

test('canvas node patch queue runs functional patchers in enqueue order', () => {
  const frames = createManualFrameScheduler();
  let nodes: CanvasSyncNodeLike[] = [createNode('node-1', {
    metadata: { width: 100 },
  })];
  const queue = createCanvasNodePatchQueue({
    getNodes: () => nodes,
    commit: (nextNodes) => {
      nodes = nextNodes;
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

  queue.enqueue('node-1', () => ({
    metadata: { width: 200 },
  }));
  queue.enqueue('node-1', (current) => ({
    metadata: {
      ...(current as FileNodeData).metadata,
      height: (current as FileNodeData).metadata.width,
    },
  }));

  frames.flushOne();

  assert.deepEqual((nodes[0]?.data as FileNodeData | undefined)?.metadata, {
    width: 200,
    height: 200,
  });
  queue.dispose();
});

test('canvas node patch queue limits frame flushes by configured node count', () => {
  const frames = createManualFrameScheduler();
  let nodes: CanvasSyncNodeLike[] = [
    createNode('node-1'),
    createNode('node-2'),
    createNode('node-3'),
    createNode('node-4'),
    createNode('node-5'),
  ];
  const committedNodeIdBatches: string[][] = [];
  const queue = createCanvasNodePatchQueue({
    getNodes: () => nodes,
    commit: (nextNodes, meta) => {
      nodes = nextNodes;
      committedNodeIdBatches.push(meta.nodeIds ?? [meta.nodeId]);
    },
    maxFlushPerFrame: 2,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

  nodes.forEach((node) => {
    queue.enqueue(node.id, { status: 'processing' });
  });

  assert.equal(frames.flushOne(), true);
  assert.deepEqual(committedNodeIdBatches, [['node-1', 'node-2']]);
  assert.equal(queue.getPendingCount(), 3);
  assert.equal(frames.flushOne(), true);
  assert.deepEqual(committedNodeIdBatches, [['node-1', 'node-2'], ['node-3', 'node-4']]);
  assert.equal(queue.getPendingCount(), 1);
  assert.equal(frames.flushOne(), true);
  assert.deepEqual(committedNodeIdBatches, [['node-1', 'node-2'], ['node-3', 'node-4'], ['node-5']]);
  assert.equal(queue.getPendingCount(), 0);
  queue.dispose();
});

test('canvas node patch queue applies multi-node frame batches with one node pass', () => {
  const frames = createManualFrameScheduler();
  let visitCount = 0;
  const nodes: CanvasSyncNodeLike[] = [
    createNode('node-1'),
    createNode('node-2'),
    createNode('node-3'),
    createNode('node-4'),
  ].map((node) => ({
    ...node,
    get id() {
      visitCount += 1;
      return node.id;
    },
  }));
  let committedNodes: CanvasSyncNodeLike[] = nodes;
  const queue = createCanvasNodePatchQueue({
    getNodes: () => committedNodes,
    commit: (nextNodes) => {
      committedNodes = nextNodes;
    },
    maxFlushPerFrame: 3,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

  queue.enqueue('node-1', { status: 'processing' });
  queue.enqueue('node-2', { status: 'error' });
  queue.enqueue('node-3', { fileName: 'batched.png' });

  visitCount = 0;
  frames.flushOne();

  assert.equal(visitCount <= 7, true);
  assert.equal(committedNodes.find((node) => node.id === 'node-1')?.data.status, 'processing');
  assert.equal(committedNodes.find((node) => node.id === 'node-2')?.data.status, 'error');
  assert.equal((committedNodes.find((node) => node.id === 'node-3')?.data as FileNodeData | undefined)?.fileName, 'batched.png');
  queue.dispose();
});

test('canvas node patch queue flush submits all pending patches immediately', () => {
  const frames = createManualFrameScheduler();
  let nodes: CanvasSyncNodeLike[] = [
    createNode('node-1'),
    createNode('node-2'),
    createNode('node-3'),
  ];
  const committedNodeIdBatches: string[][] = [];
  const queue = createCanvasNodePatchQueue({
    getNodes: () => nodes,
    commit: (nextNodes, meta) => {
      nodes = nextNodes;
      committedNodeIdBatches.push(meta.nodeIds ?? [meta.nodeId]);
    },
    maxFlushPerFrame: 1,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

  queue.enqueue('node-1', { status: 'processing' });
  queue.enqueue('node-2', { status: 'processing' });
  queue.enqueue('node-3', { status: 'processing' });

  assert.equal(queue.flush(), 3);
  assert.deepEqual(committedNodeIdBatches, [['node-1', 'node-2', 'node-3']]);
  assert.equal(queue.getPendingCount(), 0);
  assert.equal(frames.size, 0);
  assert.equal(frames.cancelled.length, 1);
  queue.dispose();
});

test('canvas node patch queue cancel prevents stale node patches from committing', () => {
  const frames = createManualFrameScheduler();
  let nodes: CanvasSyncNodeLike[] = [
    createNode('node-1'),
    createNode('node-2'),
  ];
  const committedNodeIdBatches: string[][] = [];
  const queue = createCanvasNodePatchQueue({
    getNodes: () => nodes,
    commit: (nextNodes, meta) => {
      nodes = nextNodes;
      committedNodeIdBatches.push(meta.nodeIds ?? [meta.nodeId]);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

  queue.enqueue('node-1', { status: 'processing' });
  queue.enqueue('node-2', { status: 'error' });

  assert.equal(queue.cancel('node-1'), 1);
  frames.flushOne();

  assert.deepEqual(committedNodeIdBatches, [['node-2']]);
  assert.equal(nodes.find((node) => node.id === 'node-1')?.data.status, 'idle');
  assert.equal(nodes.find((node) => node.id === 'node-2')?.data.status, 'error');
  queue.dispose();
});

test('canvas node patch queue dispose clears pending work and cancels scheduled frame', () => {
  const frames = createManualFrameScheduler();
  let nodes: CanvasSyncNodeLike[] = [createNode('node-1')];
  const committedNodeIdBatches: string[][] = [];
  const queue = createCanvasNodePatchQueue({
    getNodes: () => nodes,
    commit: (nextNodes, meta) => {
      nodes = nextNodes;
      committedNodeIdBatches.push(meta.nodeIds ?? [meta.nodeId]);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
  });

  queue.enqueue('node-1', { status: 'processing' });
  queue.dispose();

  assert.equal(frames.size, 0);
  assert.equal(frames.cancelled.length, 1);
  assert.equal(frames.flushOne(), false);
  assert.equal(queue.enqueue('node-1', { status: 'error' }), false);
  assert.deepEqual(committedNodeIdBatches, []);
  assert.equal(nodes[0]?.data.status, 'idle');
});

test('canvas node patch queue records queue metrics', () => {
  enableDiagnostics();
  const frames = createManualFrameScheduler();
  let now = 100;
  let nodes: CanvasSyncNodeLike[] = [
    createNode('node-1'),
    createNode('node-2'),
  ];
  const queue = createCanvasNodePatchQueue({
    getNodes: () => nodes,
    commit: (nextNodes) => {
      nodes = nextNodes;
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    now: () => {
      now += 5;
      return now;
    },
  });

  queue.enqueue('node-1', { status: 'processing' });
  queue.enqueue('node-2', { status: 'processing' });
  queue.cancel('node-2');
  frames.flushOne();

  const summary = getCanvasImagePerformanceSummary().nodePatchQueueSummary;

  assert.equal(summary.pendingCount, 0);
  assert.equal(summary.maxPendingCount, 2);
  assert.equal(summary.enqueueCount, 2);
  assert.equal(summary.flushCount, 1);
  assert.equal(summary.totalFlushDurationMs, 5);
  queue.dispose();
  disableDiagnostics();
});
