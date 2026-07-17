import test from 'node:test';
import assert from 'node:assert/strict';
import type { Workflow } from '@/types';
import { createDefaultAINodeData, createDefaultFileNodeData, createSequentialNodeId } from '@/utils/node/create';
import {
  buildAIFloorplanColorizeBackendGroupPayload,
  buildAIFloorplanColorizeGroupPlans,
} from './runtime';
import { getAIFloorplanColorizeInputHandle } from './groups';

test('AI floorplan colorize backend payload preserves model and simplified size params', () => {
  const payload = buildAIFloorplanColorizeBackendGroupPayload({
    groupId: 'group-1',
    sourceFileId: 'source-file-1',
    config: {
      model: 'gpt-image-2-vip',
      stylePreset: 'photoreal-render',
      imageSize: '2K',
      aspectRatio: '3:4',
    },
  });

  assert.deepEqual(payload, {
    groupId: 'group-1',
    sourceFileId: 'source-file-1',
    model: 'gpt-image-2-vip',
    stylePreset: 'photoreal-render',
    imageSize: '2K',
    aspectRatio: '3:4',
  });
});

test('AI floorplan colorize backend payload rejects empty sourceFileId', () => {
  let error: unknown = null;
  try {
    buildAIFloorplanColorizeBackendGroupPayload({
      groupId: 'group-1',
      sourceFileId: '   ',
      config: {
        model: 'gpt-image-2',
        stylePreset: 'modern',
      },
    });
  } catch (caught) {
    error = caught;
  }

  if (!(error instanceof Error)) {
    throw new Error('Expected buildAIFloorplanColorizeBackendGroupPayload to throw.');
  }
  assert.equal(error.message.includes('sourceFileId'), true);
});

test('AI floorplan colorize backend payload omits image params for GPT Image 2 default model', () => {
  const payload = buildAIFloorplanColorizeBackendGroupPayload({
    groupId: 'group-1',
    sourceFileId: 'source-file-1',
    config: {
      model: 'gpt-image-2',
      stylePreset: 'photoreal-render',
      imageSize: '4K',
      aspectRatio: '16:9',
    },
  });

  assert.deepEqual(payload, {
    groupId: 'group-1',
    sourceFileId: 'source-file-1',
    model: 'gpt-image-2',
    stylePreset: 'photoreal-render',
  });
});

test('AI floorplan colorize backend payload preserves gemini model switch', () => {
  const payload = buildAIFloorplanColorizeBackendGroupPayload({
    groupId: 'group-1',
    sourceFileId: 'source-file-1',
    config: {
      model: 'gemini-3-pro-image-preview',
      stylePreset: 'three-d-render',
      imageSize: '2K',
      aspectRatio: 'auto',
    },
  });

  assert.equal(payload.model, 'gemini-3-pro-image-preview');
  assert.equal(payload.aspectRatio, 'auto');
});

test('AI floorplan colorize group plan preserves model config for execution', () => {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiFloorplanColorize',
  );
  node.config = {
    ...node.config,
    model: 'gpt-image-2-vip',
    stylePreset: 'photoreal-render',
    imageSize: '2K',
    aspectRatio: '3:4',
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
    id: 'workflow-floorplan-runtime',
    projectId: 'project-floorplan-runtime',
    name: 'Floorplan Runtime',
    nodes: {
      [node.id.value]: node,
      [sourceNode.id.value]: sourceNode,
    },
    connections: [{
      id: 'connection-group-1',
      type: 'file-reference',
      sourceId: sourceNode.id.value,
      targetId: node.id.value,
      targetHandle: getAIFloorplanColorizeInputHandle('group-1'),
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

  const plans = buildAIFloorplanColorizeGroupPlans({
    workflow,
    node,
    inputs: [],
  });

  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.groupId, 'group-1');
  assert.equal(plans[0]?.plan.config.model, 'gpt-image-2-vip');
  assert.equal(plans[0]?.plan.config.stylePreset, 'photoreal-render');
  assert.equal(plans[0]?.plan.config.imageSize, '2K');
  assert.equal(plans[0]?.plan.config.aspectRatio, '3:4');
});

test('AI floorplan colorize group plan omits image params for GPT Image 2 default model', () => {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiFloorplanColorize',
  );
  node.config = {
    ...node.config,
    model: 'gpt-image-2',
    stylePreset: 'photoreal-render',
    imageSize: '4K',
    aspectRatio: '16:9',
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
    id: 'workflow-floorplan-runtime',
    projectId: 'project-floorplan-runtime',
    name: 'Floorplan Runtime',
    nodes: {
      [node.id.value]: node,
      [sourceNode.id.value]: sourceNode,
    },
    connections: [{
      id: 'connection-group-1',
      type: 'file-reference',
      sourceId: sourceNode.id.value,
      targetId: node.id.value,
      targetHandle: getAIFloorplanColorizeInputHandle('group-1'),
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

  const plans = buildAIFloorplanColorizeGroupPlans({
    workflow,
    node,
    inputs: [],
  });

  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.plan.config.model, 'gpt-image-2');
  assert.equal(Object.prototype.hasOwnProperty.call(plans[0]?.plan.config ?? {}, 'imageSize'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(plans[0]?.plan.config ?? {}, 'aspectRatio'), false);
});
