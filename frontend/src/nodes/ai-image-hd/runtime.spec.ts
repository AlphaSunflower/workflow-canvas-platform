import test from 'node:test';
import assert from 'node:assert/strict';
import type { Workflow } from '@/types';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import { buildAIImageHdGroupPlans } from './runtime';
import { getAIImageHdGroupInputHandle } from './groups';

test('AI image hd group plan preserves normalized image model config for execution', () => {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiImageHd',
  );
  node.config = {
    ...node.config,
    model: 'gpt-image-2-vip',
    imageSize: '4K',
    aspectRatio: '9:16',
    inputGroups: [{
      id: 'group-1',
      label: 'Group 1',
      order: 0,
    }],
  };

  const sourceNode = createDefaultFileNodeData(
    createSequentialNodeId(1),
    { x: 0, y: 0 },
    'image',
    'source-file-1',
    'source.png',
    1024,
    'image/png',
    { width: 1024, height: 768 },
  );

  const workflow: Workflow = {
    id: 'workflow-ai-image-hd-runtime',
    projectId: 'project-ai-image-hd-runtime',
    name: 'AI Image HD Runtime',
    nodes: {
      [node.id.value]: node,
      [sourceNode.id.value]: sourceNode,
    },
    connections: [{
      id: 'connection-group-1',
      type: 'file-reference',
      sourceId: sourceNode.id.value,
      targetId: node.id.value,
      targetHandle: getAIImageHdGroupInputHandle('group-1'),
      order: 0,
    }],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 2,
      connectionCount: 1,
      lastNodeId: 100,
      canvasSize: { width: 1920, height: 1080 },
      relatedTasks: [],
      usedNodeIds: [node.id.value, sourceNode.id.value],
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };

  const plans = buildAIImageHdGroupPlans({
    workflow,
    node,
    inputs: [],
  });

  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.groupId, 'group-1');
  assert.equal(plans[0]?.plan.config.model, 'gpt-image-2-vip');
  assert.equal(plans[0]?.plan.config.imageSize, '4K');
  assert.equal(plans[0]?.plan.config.aspectRatio, '9:16');
  assert.deepEqual(plans[0]?.plan.references, ['source-file-1']);
});

test('AI image hd group plan omits image params for GPT Image 2 default model', () => {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiImageHd',
  );
  node.config = {
    ...node.config,
    model: 'gpt-image-2',
    imageSize: '4K',
    aspectRatio: '9:16',
    inputGroups: [{
      id: 'group-1',
      label: 'Group 1',
      order: 0,
    }],
  };

  const sourceNode = createDefaultFileNodeData(
    createSequentialNodeId(1),
    { x: 0, y: 0 },
    'image',
    'source-file-1',
    'source.png',
    1024,
    'image/png',
    { width: 1024, height: 768 },
  );

  const workflow: Workflow = {
    id: 'workflow-ai-image-hd-runtime',
    projectId: 'project-ai-image-hd-runtime',
    name: 'AI Image HD Runtime',
    nodes: {
      [node.id.value]: node,
      [sourceNode.id.value]: sourceNode,
    },
    connections: [{
      id: 'connection-group-1',
      type: 'file-reference',
      sourceId: sourceNode.id.value,
      targetId: node.id.value,
      targetHandle: getAIImageHdGroupInputHandle('group-1'),
      order: 0,
    }],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 2,
      connectionCount: 1,
      lastNodeId: 100,
      canvasSize: { width: 1920, height: 1080 },
      relatedTasks: [],
      usedNodeIds: [node.id.value, sourceNode.id.value],
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };

  const plans = buildAIImageHdGroupPlans({
    workflow,
    node,
    inputs: [],
  });

  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.plan.config.model, 'gpt-image-2');
  assert.equal(Object.prototype.hasOwnProperty.call(plans[0]?.plan.config ?? {}, 'imageSize'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(plans[0]?.plan.config ?? {}, 'aspectRatio'), false);
  assert.deepEqual(plans[0]?.plan.references, ['source-file-1']);
});
