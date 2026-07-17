import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMonotonicNodeIdAllocator,
  createNodeIdAllocatorFromWorkflowMetadata,
  normalizeWorkflowNodeIdMetadata,
} from './node-id-allocator';
import type { WorkflowMetadata, Workflow } from '@/types';

function createMetadata(overrides: Partial<WorkflowMetadata> = {}): WorkflowMetadata {
  return {
    nodeCount: 0,
    connectionCount: 0,
    lastNodeId: 0,
    canvasSize: { width: 1920, height: 1080 },
    relatedTasks: [],
    usedNodeIds: [],
    releasedNodeIds: [],
    ...overrides,
  };
}

function createNodes(nodeIds: string[]): Workflow['nodes'] {
  return Object.fromEntries(nodeIds.map((nodeId) => [
    nodeId,
    {
      id: { value: nodeId, display: `#${nodeId.padStart(5, '0')}` },
      type: 'aiImageGen',
      position: { x: 0, y: 0 },
      dimensions: { width: 320, height: 296 },
      rotation: 0,
      scale: 1,
      locked: false,
      status: 'idle',
      zIndex: 0,
      timestamp: { created: 1, updated: 1 },
      references: [],
      outputs: [],
      config: {},
      tasks: [],
    },
  ]));
}

test('monotonic allocator never reuses deleted ids and allocates continuously', () => {
  const allocator = createMonotonicNodeIdAllocator(3);

  const next1 = allocator.next();
  const batch = allocator.nextBatch(3);

  assert.equal(next1.success, true);
  assert.equal(next1.nodeId?.value, '4');
  assert.equal(batch.success, true);
  assert.deepEqual(batch.nodeIds?.map((nodeId) => nodeId.value), ['5', '6', '7']);
  assert.equal(allocator.getLastIssued(), 7);
});

test('allocator initialized from metadata keeps historical high-water mark', () => {
  const metadata = createMetadata({
    lastNodeId: 12,
    usedNodeIds: ['1', '2', '9', '12'],
    releasedNodeIds: ['3', '4'],
  });
  const nodes = createNodes(['2', '5']);
  const allocator = createNodeIdAllocatorFromWorkflowMetadata(metadata, nodes);
  const next = allocator.next();

  assert.equal(next.success, true);
  assert.equal(next.nodeId?.value, '13');
});

test('normalizeWorkflowNodeIdMetadata keeps max of historical value, used ids and current nodes', () => {
  const metadata = createMetadata({
    lastNodeId: 2,
    usedNodeIds: ['1', '8'],
    releasedNodeIds: ['2', '3'],
  });
  const nodes = createNodes(['4', '6']);
  const normalized = normalizeWorkflowNodeIdMetadata(metadata, nodes);

  assert.equal(normalized.lastNodeId, 8);
  assert.deepEqual(normalized.usedNodeIds, ['1', '8', '4', '6']);
  assert.deepEqual(normalized.releasedNodeIds, ['2', '3']);
});

test('normalizeWorkflowNodeIdMetadata does not reset lastNodeId when nodes are empty', () => {
  const metadata = createMetadata({
    lastNodeId: 15,
    usedNodeIds: ['1', '15'],
  });

  const normalized = normalizeWorkflowNodeIdMetadata(metadata, {});

  assert.equal(normalized.lastNodeId, 15);
  assert.deepEqual(normalized.usedNodeIds, ['1', '15']);
});
