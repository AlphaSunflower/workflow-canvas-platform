import test from 'node:test';
import assert from 'node:assert/strict';

import type { FileNodeData } from '@/types';
import type { CanvasRasterImageNode } from './canvas-raster-image-resource-bridge';
import {
  createCanvasRasterResourceScheduler,
  type CanvasRasterResourceCandidate,
  type CanvasRasterResourceSchedulerMetric,
} from './canvas-raster-resource-scheduler';

function createImageNode(id: string, overrides: Partial<FileNodeData> = {}): CanvasRasterImageNode {
  const now = Date.now();
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
    width: data.dimensions.width,
    height: data.dimensions.height,
    selected: false,
  } as CanvasRasterImageNode;
}

function createCandidate(
  id: string,
  options: Partial<Pick<CanvasRasterResourceCandidate, 'active' | 'importing' | 'resourceSignature'>> = {},
): CanvasRasterResourceCandidate {
  return {
    node: createImageNode(id, options.importing ? { status: 'processing' } : {}),
    active: options.active ?? false,
    importing: options.importing ?? false,
    resourceSignature: options.resourceSignature ?? `resource-${id}`,
  };
}

function createManualFrameScheduler() {
  let nextFrameId = 0;
  const callbacks = new Map<number, () => void>();

  return {
    schedule(callback: () => void): number {
      nextFrameId += 1;
      callbacks.set(nextFrameId, callback);
      return nextFrameId;
    },
    cancel(frameId: number): void {
      callbacks.delete(frameId);
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
  };
}

test('canvas raster resource scheduler processes request work in frame batches', async () => {
  const frames = createManualFrameScheduler();
  const registeredBatches: string[][] = [];
  const requestedNodeIds: string[] = [];
  const scheduler = createCanvasRasterResourceScheduler({
    registerNodes: (nodes) => {
      const ids = nodes.map((node) => node.id);
      registeredBatches.push(ids);
      return ids;
    },
    requestNode: (nodeId) => {
      requestedNodeIds.push(nodeId);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 2,
    passiveMaxConcurrentRequests: 10,
  });

  scheduler.update([
    createCandidate('node-1'),
    createCandidate('node-2'),
    createCandidate('node-3'),
    createCandidate('node-4'),
    createCandidate('node-5'),
  ]);

  assert.equal(frames.flushOne(), true);
  await Promise.resolve();
  assert.deepEqual(registeredBatches, [['node-1', 'node-2']]);
  assert.deepEqual(requestedNodeIds, ['node-1', 'node-2']);

  assert.equal(frames.flushOne(), true);
  await Promise.resolve();
  assert.deepEqual(registeredBatches, [['node-1', 'node-2'], ['node-3', 'node-4']]);
  assert.deepEqual(requestedNodeIds, ['node-1', 'node-2', 'node-3', 'node-4']);

  assert.equal(frames.flushOne(), true);
  await Promise.resolve();
  assert.deepEqual(registeredBatches[2], ['node-5']);
  scheduler.dispose();
});

test('canvas raster resource scheduler prioritizes active images before passive images', async () => {
  const frames = createManualFrameScheduler();
  const registeredBatches: string[][] = [];
  const scheduler = createCanvasRasterResourceScheduler({
    registerNodes: (nodes) => {
      const ids = nodes.map((node) => node.id);
      registeredBatches.push(ids);
      return ids;
    },
    requestNode: () => undefined,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 2,
    passiveMaxConcurrentRequests: 10,
  });

  scheduler.update([
    createCandidate('passive-1'),
    createCandidate('active-1', { active: true }),
    createCandidate('passive-2'),
    createCandidate('active-2', { active: true }),
  ]);
  frames.flushOne();
  await Promise.resolve();

  assert.deepEqual(registeredBatches[0], ['active-1', 'active-2']);
  scheduler.dispose();
});

test('canvas raster resource scheduler uses explicit priority rank before insertion order', async () => {
  const frames = createManualFrameScheduler();
  const registeredBatches: string[][] = [];
  const scheduler = createCanvasRasterResourceScheduler({
    registerNodes: (nodes) => {
      const ids = nodes.map((node) => node.id);
      registeredBatches.push(ids);
      return ids;
    },
    requestNode: () => undefined,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 3,
    passiveMaxConcurrentRequests: 10,
  });

  scheduler.update([
    createCandidate('near', { resourceSignature: 'near' }),
    {
      ...createCandidate('selected', { resourceSignature: 'selected' }),
      priorityRank: 0,
    },
    {
      ...createCandidate('visible', { resourceSignature: 'visible' }),
      priorityRank: 20,
    },
  ]);
  frames.flushOne();
  await Promise.resolve();

  assert.deepEqual(registeredBatches[0], ['selected', 'visible', 'near']);
  scheduler.dispose();
});

test('canvas raster resource scheduler uses smaller importing batches', async () => {
  const frames = createManualFrameScheduler();
  const registeredBatches: string[][] = [];
  const scheduler = createCanvasRasterResourceScheduler({
    registerNodes: (nodes) => {
      const ids = nodes.map((node) => node.id);
      registeredBatches.push(ids);
      return ids;
    },
    requestNode: () => undefined,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 4,
    importingBatchSize: 1,
    passiveMaxConcurrentRequests: 10,
    importingMaxConcurrentRequests: 10,
  });

  scheduler.update([
    createCandidate('importing-1', { importing: true }),
    createCandidate('importing-2', { importing: true }),
    createCandidate('passive-1'),
  ]);
  frames.flushOne();
  await Promise.resolve();

  assert.deepEqual(registeredBatches[0], ['importing-1']);
  scheduler.dispose();
});

test('canvas raster resource scheduler skips queued nodes that leave the candidate set', async () => {
  const frames = createManualFrameScheduler();
  const registeredBatches: string[][] = [];
  const cancelledNodeIds: string[] = [];
  const scheduler = createCanvasRasterResourceScheduler({
    registerNodes: (nodes) => {
      const ids = nodes.map((node) => node.id);
      registeredBatches.push(ids);
      return ids;
    },
    requestNode: () => undefined,
    cancelNodeRequest: (nodeId) => {
      cancelledNodeIds.push(nodeId);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 2,
    passiveMaxConcurrentRequests: 10,
  });

  scheduler.update([
    createCandidate('node-1'),
    createCandidate('node-2'),
    createCandidate('node-3'),
  ]);
  scheduler.update([
    createCandidate('node-3'),
  ]);
  frames.flushOne();
  await Promise.resolve();

  assert.deepEqual(cancelledNodeIds.sort(), ['node-1', 'node-2']);
  assert.deepEqual(registeredBatches, [['node-3']]);
  scheduler.dispose();
});

test('canvas raster resource scheduler reports candidate removals separately from signature changes', () => {
  const frames = createManualFrameScheduler();
  const metrics: CanvasRasterResourceSchedulerMetric[] = [];
  const cancelledNodeIds: string[] = [];
  const scheduler = createCanvasRasterResourceScheduler({
    registerNodes: (nodes) => nodes.map((node) => node.id),
    requestNode: () => undefined,
    cancelNodeRequest: (nodeId) => {
      cancelledNodeIds.push(nodeId);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    onBatch: (metric) => {
      metrics.push(metric);
    },
  });

  scheduler.update([
    createCandidate('removed-node', { resourceSignature: 'same' }),
    createCandidate('changed-node', { resourceSignature: 'before' }),
    createCandidate('stable-node', { resourceSignature: 'stable' }),
  ]);
  scheduler.update([
    createCandidate('changed-node', { resourceSignature: 'after' }),
    createCandidate('stable-node', { resourceSignature: 'stable' }),
  ]);

  assert.deepEqual(cancelledNodeIds.sort(), ['changed-node', 'removed-node']);
  const cancelMetric = metrics.find((metric) => metric.cancelledNodeCount === 2);
  assert.equal(cancelMetric?.candidateRemovedNodeCount, 1);
  assert.equal(cancelMetric?.signatureChangedNodeCount, 1);
  scheduler.dispose();
});

test('canvas raster resource scheduler keeps in-flight work when a candidate temporarily leaves', async () => {
  const frames = createManualFrameScheduler();
  const cancelledNodeIds: string[] = [];
  const requestedNodeIds: string[] = [];
  let resolveRequest: (() => void) | undefined;
  const scheduler = createCanvasRasterResourceScheduler({
    registerNodes: (nodes) => nodes.map((node) => node.id),
    requestNode: (nodeId) => new Promise<void>((resolve) => {
      requestedNodeIds.push(nodeId);
      resolveRequest = resolve;
    }),
    cancelNodeRequest: (nodeId) => {
      cancelledNodeIds.push(nodeId);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 1,
    passiveMaxConcurrentRequests: 1,
  });

  scheduler.update([createCandidate('node-1')]);
  frames.flushOne();
  scheduler.update([]);

  assert.deepEqual(cancelledNodeIds, []);
  assert.deepEqual(requestedNodeIds, ['node-1']);
  resolveRequest?.();
  await Promise.resolve();
  await Promise.resolve();
  scheduler.dispose();
});

test('canvas raster resource scheduler cancelAll cancels in-flight work for teardown', async () => {
  const frames = createManualFrameScheduler();
  const cancelledNodeIds: string[] = [];
  let resolveRequest: (() => void) | undefined;
  const scheduler = createCanvasRasterResourceScheduler({
    registerNodes: (nodes) => nodes.map((node) => node.id),
    requestNode: () => new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }),
    cancelNodeRequest: (nodeId) => {
      cancelledNodeIds.push(nodeId);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 1,
    passiveMaxConcurrentRequests: 1,
  });

  scheduler.update([createCandidate('node-1')]);
  frames.flushOne();
  scheduler.cancelAll();

  assert.deepEqual(cancelledNodeIds, ['node-1']);
  resolveRequest?.();
  await Promise.resolve();
  await Promise.resolve();
  scheduler.dispose();
});

test('canvas raster resource scheduler reprioritizes unchanged resources without cancelling or rerequesting ready work', async () => {
  const frames = createManualFrameScheduler();
  const cancelledNodeIds: string[] = [];
  const requestedNodeIds: string[] = [];
  const scheduler = createCanvasRasterResourceScheduler({
    registerNodes: (nodes) => nodes.map((node) => node.id),
    requestNode: (nodeId) => {
      requestedNodeIds.push(nodeId);
    },
    cancelNodeRequest: (nodeId) => {
      cancelledNodeIds.push(nodeId);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 1,
    passiveMaxConcurrentRequests: 1,
  });

  scheduler.update([createCandidate('node-1', { resourceSignature: 'same-resource' })]);
  frames.flushOne();
  await Promise.resolve();

  scheduler.update([{
    ...createCandidate('node-1', { active: true, resourceSignature: 'same-resource' }),
    priorityRank: 0,
    priorityScore: 100,
  }]);
  assert.equal(frames.flushOne(), false);

  assert.deepEqual(cancelledNodeIds, []);
  assert.deepEqual(requestedNodeIds, ['node-1']);
  scheduler.dispose();
});

test('canvas raster resource scheduler ignores small priority score jitter', async () => {
  const frames = createManualFrameScheduler();
  const metrics: CanvasRasterResourceSchedulerMetric[] = [];
  const scheduler = createCanvasRasterResourceScheduler({
    registerNodes: (nodes) => nodes.map((node) => node.id),
    requestNode: () => undefined,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 1,
    passiveMaxConcurrentRequests: 1,
    onBatch: (metric) => {
      metrics.push(metric);
    },
  });

  scheduler.update([{
    ...createCandidate('node-1', { resourceSignature: 'same-resource' }),
    priorityRank: 20,
    priorityScore: 1.01,
  }]);
  frames.flushOne();
  await Promise.resolve();
  scheduler.update([{
    ...createCandidate('node-1', { resourceSignature: 'same-resource' }),
    priorityRank: 20,
    priorityScore: 1.04,
  }]);

  assert.equal(frames.flushOne(), false);
  assert.equal(metrics.some((metric) => (metric.reprioritizedNodeCount ?? 0) > 0), false);
  scheduler.dispose();
});

test('canvas raster resource scheduler pause stops queued requests without cancelling them', async () => {
  const frames = createManualFrameScheduler();
  const cancelledNodeIds: string[] = [];
  const requestedNodeIds: string[] = [];
  const scheduler = createCanvasRasterResourceScheduler({
    registerNodes: (nodes) => nodes.map((node) => node.id),
    requestNode: (nodeId) => {
      requestedNodeIds.push(nodeId);
    },
    cancelNodeRequest: (nodeId) => {
      cancelledNodeIds.push(nodeId);
    },
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    passiveBatchSize: 2,
    passiveMaxConcurrentRequests: 10,
  });

  scheduler.update([createCandidate('node-1'), createCandidate('node-2')]);
  scheduler.pauseRequests();

  assert.equal(frames.flushOne(), false);
  assert.deepEqual(cancelledNodeIds, []);
  assert.deepEqual(requestedNodeIds, []);

  scheduler.resumeRequests();
  assert.equal(frames.flushOne(), true);
  await Promise.resolve();

  assert.deepEqual(requestedNodeIds, ['node-1', 'node-2']);
  scheduler.dispose();
});
