import test from 'node:test';
import assert from 'node:assert/strict';

import { isAINodeData } from '@/utils';
import type { Connection } from '@/types';
import {
  mergeInstanceSnapshotNodes,
  mergeWorkflowConnections,
  shouldBlockLocalCanvasSyncDuringHydration,
  type CanvasSyncNodeLike,
} from './canvas-sync';

function createNode(id: string, updatedAt: number, overrides: Partial<CanvasSyncNodeLike['data']> = {}): CanvasSyncNodeLike {
  return {
    id,
    position: { x: updatedAt, y: updatedAt },
    data: {
      id: { value: id, display: `#${id}` },
      type: 'aiImageGen',
      position: { x: updatedAt, y: updatedAt },
      dimensions: { width: 320, height: 240 },
      rotation: 0,
      scale: 1,
      locked: false,
      status: 'idle',
      zIndex: 0,
      timestamp: { created: 1, updated: updatedAt },
      references: [],
      outputs: [],
      tasks: [],
      config: {
        model: 'test-model',
        prompt: '',
        negativePrompt: '',
        steps: 20,
        seed: 0,
        width: 1024,
        height: 1024,
        cfgScale: 7,
        sampler: 'default',
        aspectRatio: '1:1',
        imageSize: '1K',
        resolutionPreset: '1024x1024',
        outputCount: 1,
        strength: 0.75,
        denoise: 0.5,
        cameraCount: 4,
        textureQuality: 'high',
        fps: 24,
        duration: 4,
        inputGroups: [],
      },
      ...overrides,
    } as CanvasSyncNodeLike['data'],
  };
}

function createConnection(id: string, type: Connection['type']): Connection {
  return {
    id,
    type,
    sourceId: 'source',
    targetId: 'target',
    sourceHandle: type === 'output-link' ? 'group-1:result' : undefined,
    targetHandle: undefined,
    order: 0,
  };
}

test('mergeInstanceSnapshotNodes preserves workflow-only output nodes during stale instance sync', () => {
  const currentNodes = [
    createNode('source', 10),
    createNode('result', 20, {
      type: 'image',
      fileId: 'file-result',
      fileName: 'result.png',
      fileSize: 1024,
      mimeType: 'image/png',
      source: { type: 'node-output', producerNodeId: 'source', producerNodeDisplayId: '#source' },
      metadata: {},
    } as Partial<CanvasSyncNodeLike['data']>),
  ];
  const instanceNodes = [createNode('source', 10)];

  const merged = mergeInstanceSnapshotNodes(currentNodes, instanceNodes, {
    preserveNodeIds: new Set(['result']),
    workflowNodesById: new Map(currentNodes.map((node) => [node.id, node] as const)),
  });

  assert.deepEqual(merged.map((node) => node.id), ['source', 'result']);
});

test('mergeInstanceSnapshotNodes preserves current nodes missing from non-delete instance snapshots', () => {
  const visibleNode = createNode('visible', 20, { status: 'processing' });
  const hiddenNode = createNode('hidden', 30, { status: 'completed' });
  const instanceVisibleNode = createNode('visible', 40, { status: 'idle' });

  const merged = mergeInstanceSnapshotNodes([visibleNode, hiddenNode], [instanceVisibleNode], {
    preserveMissingCurrentNodes: true,
  });

  assert.deepEqual(merged.map((node) => node.id), ['visible', 'hidden']);
  assert.equal(merged[0]?.data.timestamp.updated, 40);
  assert.equal(merged[0]?.position.x, 40);
  assert.equal(merged[1], hiddenNode);
});

test('mergeInstanceSnapshotNodes preserves detached render-plan nodes missing from React Flow instance snapshots', () => {
  const visibleNode = createNode('visible', 20, { status: 'processing' });
  const detachedNode = createNode('detached', 30, { status: 'completed' });
  const instanceVisibleNode = createNode('visible', 40, { status: 'idle' });

  const merged = mergeInstanceSnapshotNodes([visibleNode, detachedNode], [instanceVisibleNode], {
    preserveNodeIds: new Set(['detached']),
  });

  assert.deepEqual(merged.map((node) => node.id), ['visible', 'detached']);
  assert.equal(merged[0]?.data.timestamp.updated, 40);
  assert.equal(merged[1], detachedNode);
});

test('mergeInstanceSnapshotNodes allows explicit shrink when missing-node preservation is disabled', () => {
  const visibleNode = createNode('visible', 20);
  const hiddenNode = createNode('hidden', 30);
  const instanceVisibleNode = createNode('visible', 40);

  const merged = mergeInstanceSnapshotNodes([visibleNode, hiddenNode], [instanceVisibleNode]);

  assert.deepEqual(merged.map((node) => node.id), ['visible']);
});

test('mergeInstanceSnapshotNodes strips transient ReactFlow hidden flags from instance snapshots', () => {
  const currentNode = createNode('image', 20);
  const instanceNode = {
    ...createNode('image', 40),
    hidden: true,
  } as CanvasSyncNodeLike & { hidden: boolean };

  const merged = mergeInstanceSnapshotNodes([currentNode], [instanceNode]);

  assert.equal('hidden' in merged[0]!, false);
  assert.equal(merged[0]?.data.timestamp.updated, 40);
});

test('mergeInstanceSnapshotNodes preserves real node type when instance uses a DOM window placeholder', () => {
  const currentNode = {
    ...createNode('image', 20),
    type: 'image',
  };
  const instanceNode = {
    ...createNode('image', 40),
    type: '__canvasDomWindowPlaceholder',
    position: { x: 400, y: 420 },
  };

  const merged = mergeInstanceSnapshotNodes([currentNode], [instanceNode], {
    transientNodeTypes: new Set(['__canvasDomWindowPlaceholder']),
  });

  assert.equal(merged[0]?.type, 'image');
  assert.equal(merged[0]?.data.timestamp.updated, 20);
  assert.deepEqual(merged[0]?.position, { x: 400, y: 420 });
  assert.deepEqual(merged[0]?.data.position, { x: 400, y: 420 });
});

test('mergeInstanceSnapshotNodes keeps placeholder type and hidden flag out of workflow nodes', () => {
  const currentNode: CanvasSyncNodeLike = {
    ...createNode('image', 20, {
      type: 'image',
    }),
    type: 'image',
  };
  const instanceNode = {
    ...createNode('image', 40, {
      type: 'image',
    }),
    type: '__canvasDomWindowPlaceholder',
    hidden: true,
    position: { x: 520, y: 540 },
  } as CanvasSyncNodeLike & { hidden: boolean };

  const merged = mergeInstanceSnapshotNodes([currentNode], [instanceNode], {
    transientNodeTypes: new Set(['__canvasDomWindowPlaceholder']),
  });

  assert.equal(merged[0]?.type, 'image');
  assert.equal(merged[0]?.type === '__canvasDomWindowPlaceholder', false);
  assert.equal('hidden' in merged[0]!, false);
  assert.equal(merged[0]?.data.type, 'image');
  assert.equal(merged[0]?.data.timestamp.updated, 20);
  assert.deepEqual(merged[0]?.position, { x: 520, y: 540 });
  assert.deepEqual(merged[0]?.data.position, { x: 520, y: 540 });
});

test('mergeInstanceSnapshotNodes prefers newer workflow node data for same node id', () => {
  const currentSource = createNode('source', 10);
  const workflowSource = createNode('source', 30, {
    outputs: ['file-result'],
  });
  const instanceSource = createNode('source', 10);

  const merged = mergeInstanceSnapshotNodes([currentSource], [instanceSource], {
    preserveNodeDataIds: new Set(['source']),
    workflowNodesById: new Map([['source', workflowSource]]),
  });

  assert.equal(isAINodeData(merged[0]?.data), true);
  assert.deepEqual((merged[0]?.data && isAINodeData(merged[0].data)) ? merged[0].data.outputs : [], ['file-result']);
  assert.equal(merged[0]?.data.timestamp.updated, 30);
});

test('mergeWorkflowConnections preserves workflow output-link missing from stale instance edges', () => {
  const workflowConnections = [
    createConnection('input-1', 'file-reference'),
    createConnection('output-1', 'output-link'),
  ];
  const instanceConnections = [
    createConnection('input-1', 'file-reference'),
  ];

  const merged = mergeWorkflowConnections(workflowConnections, instanceConnections, {
    preserveConnectionIds: new Set(['output-1']),
  });

  assert.deepEqual(merged.map((connection) => connection.id), ['input-1', 'output-1']);
  assert.equal(merged[1]?.type, 'output-link');
});

test('mergeWorkflowConnections preserves current connections missing from non-delete instance snapshots', () => {
  const currentConnections = [
    createConnection('visible-edge', 'file-reference'),
    createConnection('hidden-node-edge', 'output-link'),
  ];
  const instanceConnections = [
    createConnection('visible-edge', 'file-reference'),
  ];

  const merged = mergeWorkflowConnections(currentConnections, instanceConnections, {
    preserveMissingCurrentConnections: true,
  });

  assert.deepEqual(merged.map((connection) => connection.id), ['visible-edge', 'hidden-node-edge']);
});

test('mergeWorkflowConnections preserves render-plan hidden business edges missing from instance snapshot', () => {
  const workflowConnections = [
    createConnection('visible-edge', 'file-reference'),
    createConnection('hidden-file-reference', 'file-reference'),
    createConnection('hidden-output-link', 'output-link'),
  ];
  const instanceConnections = [
    createConnection('visible-edge', 'file-reference'),
  ];

  const merged = mergeWorkflowConnections(workflowConnections, instanceConnections, {
    preserveConnectionIds: new Set(['hidden-file-reference', 'hidden-output-link']),
  });

  assert.deepEqual(
    merged.map((connection) => connection.id),
    ['visible-edge', 'hidden-file-reference', 'hidden-output-link'],
  );
  assert.equal(merged[1]?.type, 'file-reference');
  assert.equal(merged[2]?.type, 'output-link');
});

test('mergeWorkflowConnections allows explicit connection shrink when preservation is disabled', () => {
  const currentConnections = [
    createConnection('visible-edge', 'file-reference'),
    createConnection('hidden-node-edge', 'output-link'),
  ];
  const instanceConnections = [
    createConnection('visible-edge', 'file-reference'),
  ];

  const merged = mergeWorkflowConnections(currentConnections, instanceConnections);

  assert.deepEqual(merged.map((connection) => connection.id), ['visible-edge']);
});

test('canvas sync preserves multiple same-handle output nodes and links after external-output hydration', () => {
  const sourceNode = createNode('source', 30, {
    outputs: ['file-result-1', 'file-result-2'],
  });
  const resultNodeOne = createNode('result-1', 20, {
    type: 'image',
    fileId: 'file-result-1',
    fileName: 'result-1.png',
    fileSize: 1024,
    mimeType: 'image/png',
    source: { type: 'node-output', producerNodeId: 'source', producerNodeDisplayId: '#source' },
    metadata: {},
  } as Partial<CanvasSyncNodeLike['data']>);
  const resultNodeTwo = createNode('result-2', 25, {
    type: 'image',
    fileId: 'file-result-2',
    fileName: 'result-2.png',
    fileSize: 1024,
    mimeType: 'image/png',
    source: { type: 'node-output', producerNodeId: 'source', producerNodeDisplayId: '#source' },
    metadata: {},
  } as Partial<CanvasSyncNodeLike['data']>);
  const currentNodes = [sourceNode, resultNodeOne, resultNodeTwo];
  const instanceNodes = [createNode('source', 10)];

  const mergedNodes = mergeInstanceSnapshotNodes(currentNodes, instanceNodes, {
    preserveNodeIds: new Set(['result-1', 'result-2']),
    preserveNodeDataIds: new Set(['source']),
    workflowNodesById: new Map(currentNodes.map((node) => [node.id, node] as const)),
  });

  const workflowConnections = [
    {
      id: 'output-1',
      type: 'output-link' as const,
      sourceId: 'source',
      targetId: 'result-1',
      sourceHandle: 'group-1:result',
      targetHandle: undefined,
      order: 0,
    },
    {
      id: 'output-2',
      type: 'output-link' as const,
      sourceId: 'source',
      targetId: 'result-2',
      sourceHandle: 'group-1:result',
      targetHandle: undefined,
      order: 0,
    },
  ];
  const instanceConnections = [
    {
      id: 'output-1',
      type: 'output-link' as const,
      sourceId: 'source',
      targetId: 'result-1',
      sourceHandle: 'group-1:result',
      targetHandle: undefined,
      order: 0,
    },
  ];

  const mergedConnections = mergeWorkflowConnections(workflowConnections, instanceConnections, {
    preserveConnectionIds: new Set(['output-1', 'output-2']),
  });

  assert.deepEqual(mergedNodes.map((node) => node.id), ['source', 'result-1', 'result-2']);
  assert.equal(isAINodeData(mergedNodes[0]?.data), true);
  assert.deepEqual(
    (mergedNodes[0]?.data && isAINodeData(mergedNodes[0].data)) ? mergedNodes[0].data.outputs : [],
    ['file-result-1', 'file-result-2'],
  );
  assert.deepEqual(mergedConnections.map((connection) => connection.id), ['output-1', 'output-2']);
  assert.equal(
    mergedConnections.filter((connection) => (
      connection.type === 'output-link' && connection.sourceHandle === 'group-1:result'
    )).length,
    2,
  );
});

test('shouldBlockLocalCanvasSyncDuringHydration blocks stale instance writeback while external output hydration is pending', () => {
  assert.equal(shouldBlockLocalCanvasSyncDuringHydration({
    lastAppliedHydrationVersion: 3,
    nextHydrationVersion: 4,
    hydrationReason: 'external-output',
    pendingExternalHydrationVersion: 4,
  }), true);
});
