import test from 'node:test';
import assert from 'node:assert/strict';

import type { Workflow } from '@/types';
import {
  buildGroupedImageDropConfig,
  buildSequenceImageDropConfig,
  createAINodeTargetResolver,
  normalizeDraggedImageNodes,
  validateUniqueDraggedImageNodes,
} from './drop-config-builder';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';

function createWorkflow(nodes: Workflow['nodes']): Workflow {
  const now = Date.now();

  return {
    id: 'workflow-1',
    projectId: 'project-1',
    name: 'Test workflow',
    nodes,
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: Object.keys(nodes).length,
      connectionCount: 0,
      lastNodeId: 999,
      canvasSize: { width: 4000, height: 3000 },
    },
    timestamp: {
      created: now,
      updated: now,
    },
  };
}

test('normalizeDraggedImageNodes filters non-image nodes and sorts by canvas position', () => {
  const first = createDefaultFileNodeData(
    createSequentialNodeId(1),
    { x: 80, y: 20 },
    'image',
    'file-1',
    'first.png',
    100,
    'image/png'
  );
  const second = createDefaultFileNodeData(
    createSequentialNodeId(2),
    { x: 30, y: 20 },
    'image',
    'file-2',
    'second.png',
    100,
    'image/png'
  );
  const third = createDefaultFileNodeData(
    createSequentialNodeId(3),
    { x: 50, y: 10 },
    'image',
    'file-3',
    'third.png',
    100,
    'image/png'
  );
  const ignoredVideo = createDefaultFileNodeData(
    createSequentialNodeId(4),
    { x: 0, y: 0 },
    'video',
    'file-4',
    'clip.mp4',
    100,
    'video/mp4'
  );
  const ignoredNode = createDefaultAINodeData(
    createSequentialNodeId(5),
    { x: 0, y: 0 },
    'aiImageGen'
  );

  const normalized = normalizeDraggedImageNodes([
    first,
    ignoredVideo,
    second,
    ignoredNode,
    third,
  ]);

  assert.deepEqual(
    normalized.map((node) => node.id.value),
    ['3', '2', '1']
  );
});

test('createAINodeTargetResolver returns only matching ai node type', () => {
  const targetNode = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 10, y: 20 },
    'aiImageGen'
  );
  const otherNode = createDefaultAINodeData(
    createSequentialNodeId(101),
    { x: 30, y: 40 },
    'aiImageHd'
  );
  const fileNode = createDefaultFileNodeData(
    createSequentialNodeId(102),
    { x: 50, y: 60 },
    'image',
    'file-102',
    'image.png',
    100,
    'image/png'
  );
  const workflow = createWorkflow({
    [targetNode.id.value]: targetNode,
    [otherNode.id.value]: otherNode,
    [fileNode.id.value]: fileNode,
  });
  const resolveTarget = createAINodeTargetResolver('aiImageGen');

  assert.equal(resolveTarget(workflow, targetNode.id.value)?.id.value, targetNode.id.value);
  assert.equal(resolveTarget(workflow, otherNode.id.value), null);
  assert.equal(resolveTarget(workflow, fileNode.id.value), null);
  assert.equal(resolveTarget(workflow, 'missing-node'), null);
});

test('validateUniqueDraggedImageNodes rejects duplicate node ids with shared message', () => {
  const imageNode = createDefaultFileNodeData(
    createSequentialNodeId(200),
    { x: 0, y: 0 },
    'image',
    'file-200',
    'image-200.png',
    100,
    'image/png'
  );
  const duplicateNode = {
    ...imageNode,
    position: { x: 20, y: 20 },
  };

  assert.equal(
    validateUniqueDraggedImageNodes([imageNode, duplicateNode]),
    'Duplicate images are not allowed in the same drop action.'
  );
  assert.equal(validateUniqueDraggedImageNodes([imageNode]), null);
});

test('buildGroupedImageDropConfig attaches shared normalizeDraggedNodes without changing node-specific options', () => {
  const resolveInputGroups = () => [];
  const getTargetNode = createAINodeTargetResolver('aiImageHd');

  const config = buildGroupedImageDropConfig({
    getTargetNode,
    resolveInputGroups,
    sidePortMap: Object.freeze({ input: 'image' }),
    maxGroups: 4,
    allowCtrl: false,
    allowShift: true,
    ctrlSingleBroadcast: false,
    validateDraggedNodes: validateUniqueDraggedImageNodes,
  });

  assert.equal(config.getTargetNode, getTargetNode);
  assert.equal(config.resolveInputGroups, resolveInputGroups);
  assert.equal(config.normalizeDraggedNodes, normalizeDraggedImageNodes);
  assert.equal(config.maxGroups, 4);
  assert.equal(config.allowCtrl, false);
  assert.equal(config.validateDraggedNodes, validateUniqueDraggedImageNodes);
});

test('buildSequenceImageDropConfig preserves sequence-specific options while attaching shared normalization', () => {
  const resolveInputGroups = () => [];
  const getTargetNode = createAINodeTargetResolver('aiImageGen');
  const resolveDropTarget = () => null;

  const config = buildSequenceImageDropConfig({
    getTargetNode,
    resolveInputGroups,
    sidePortMap: Object.freeze({ input: 'images' }),
    maxGroups: 10,
    allowCtrl: true,
    allowShift: true,
    ctrlSingleBroadcast: true,
    shiftPlacementStrategy: 'single-per-group',
    disallowHandleDuplicates: true,
    resolveDropTarget,
    validateDraggedNodes: validateUniqueDraggedImageNodes,
  });

  assert.equal(config.normalizeDraggedNodes, normalizeDraggedImageNodes);
  assert.equal(config.resolveDropTarget, resolveDropTarget);
  assert.equal(config.shiftPlacementStrategy, 'single-per-group');
  assert.equal(config.disallowHandleDuplicates, true);
  assert.equal(config.validateDraggedNodes, validateUniqueDraggedImageNodes);
});

