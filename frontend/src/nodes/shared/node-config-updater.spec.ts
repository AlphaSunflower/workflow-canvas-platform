import test from 'node:test';
import assert from 'node:assert/strict';

import type { Node as ReactFlowNode } from 'reactflow';

import type { AINodeData, AnyNodeData, StoryboardConfig, Workflow } from '@/types';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import {
  patchNodeConfigInGraph,
  patchNodeConfigInWorkflow,
} from './node-config-updater';

function createStoryboardNode(): AINodeData {
  const node = createDefaultAINodeData(
    createSequentialNodeId(21),
    { x: 120, y: 160 },
    'aiStoryboard',
  ) as AINodeData;

  node.config = {
    ...node.config,
    viewMode: 'list',
    shots: [],
    processedInputFileIds: [],
    defaultImageModel: 'gemini-3-pro-image-preview',
    defaultImageAspectRatio: 'auto',
    defaultImageSize: '1K',
    batchVideoModel: 'veo-3.1-landscape-fast-fl',
    batchVideoDuration: 8,
    batchVideoAspectRatio: '16:9',
    batchVideoResolution: '720P',
  } satisfies Partial<StoryboardConfig>;

  return node;
}

function createWorkflow(node: AINodeData): Workflow {
  return {
    id: 'workflow-node-config-updater',
    projectId: 'project-node-config-updater',
    name: 'Node Config Updater',
    nodes: {
      [node.id.value]: node,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: Number(node.id.value),
      canvasSize: { width: 1920, height: 1080 },
      relatedTasks: [],
      usedNodeIds: [node.id.value],
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

test('patchNodeConfigInGraph updates only the targeted AI node config', () => {
  const storyboardNode = createStoryboardNode();
  const otherNode = createDefaultAINodeData(
    createSequentialNodeId(22),
    { x: 0, y: 0 },
    'aiImageGen',
  ) as AINodeData;
  const nodes: ReactFlowNode<AnyNodeData>[] = [
    {
      id: storyboardNode.id.value,
      type: storyboardNode.type,
      data: storyboardNode,
      position: storyboardNode.position,
    },
    {
      id: otherNode.id.value,
      type: otherNode.type,
      data: otherNode,
      position: otherNode.position,
    },
  ];

  const result = patchNodeConfigInGraph<StoryboardConfig>({
    nodes,
    nodeId: storyboardNode.id.value,
    expectedType: 'aiStoryboard',
    updatedAt: 99,
    updater: (config) => ({
      viewMode: config.viewMode === 'list' ? 'grid' : 'list',
    }),
  });

  assert.equal(result.changed, true);
  const nextStoryboardNode = result.nextNodes[0]?.data as AINodeData | undefined;
  assert.equal(nextStoryboardNode?.config.viewMode, 'grid');
  assert.equal(nextStoryboardNode?.timestamp.updated, 99);
  assert.equal((result.nextNodes[1]?.data as AINodeData | undefined)?.config.viewMode, otherNode.config.viewMode);
});

test('patchNodeConfigInGraph skips updates when expectedType does not match', () => {
  const storyboardNode = createStoryboardNode();
  const nodes: ReactFlowNode<AnyNodeData>[] = [{
    id: storyboardNode.id.value,
    type: storyboardNode.type,
    data: storyboardNode,
    position: storyboardNode.position,
  }];

  const result = patchNodeConfigInGraph<StoryboardConfig>({
    nodes,
    nodeId: storyboardNode.id.value,
    expectedType: 'aiImageGen',
    updater: () => ({
      viewMode: 'grid',
    }),
  });

  assert.equal(result.changed, false);
  assert.equal((result.nextNodes[0]?.data as AINodeData | undefined)?.config.viewMode, 'list');
});

test('patchNodeConfigInWorkflow returns unchanged workflow when updater produces no effective change', () => {
  const storyboardNode = createStoryboardNode();
  const workflow = createWorkflow(storyboardNode);

  const result = patchNodeConfigInWorkflow<StoryboardConfig>({
    workflow,
    nodeId: storyboardNode.id.value,
    expectedType: 'aiStoryboard',
    updater: () => ({
      viewMode: 'list',
    }),
  });

  assert.equal(result.changed, false);
  assert.equal(result.nextWorkflow, workflow);
});

test('patchNodeConfigInWorkflow patches targeted config and workflow timestamp when changed', () => {
  const storyboardNode = createStoryboardNode();
  const workflow = createWorkflow(storyboardNode);

  const result = patchNodeConfigInWorkflow<StoryboardConfig>({
    workflow,
    nodeId: storyboardNode.id.value,
    expectedType: 'aiStoryboard',
    updatedAt: 1234,
    updater: () => ({
      processedInputFileIds: ['source-file-1'],
    }),
  });

  assert.equal(result.changed, true);
  const nextStoryboardNode = result.nextWorkflow.nodes[storyboardNode.id.value] as AINodeData;
  assert.deepEqual(nextStoryboardNode.config.processedInputFileIds, ['source-file-1']);
  assert.equal(nextStoryboardNode.timestamp.updated, 1234);
  assert.equal(result.nextWorkflow.timestamp.updated, 1234);
});
