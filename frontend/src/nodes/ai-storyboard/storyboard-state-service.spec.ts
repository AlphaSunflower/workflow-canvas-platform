import test from 'node:test';
import assert from 'node:assert/strict';

import type { Node as ReactFlowNode } from 'reactflow';
import type { AINodeData, AnyNodeData, Workflow } from '@/types';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import { AI_STORYBOARD_DEFAULT_SIZE } from './constants';
import {
  patchStoryboardNodeRuntimeState,
  patchStoryboardShotRuntimeState,
  writeStoryboardLocalStateToNodeGraph,
} from './storyboard-state-service';
import type { StoryboardConfig, StoryboardShotData } from '@/types';
import { getStoryboardShotDefaults, type StoryboardLocalState } from './types';

function createShot(overrides: Partial<StoryboardShotData> = {}): StoryboardShotData {
  return {
    id: 'shot-1',
    order: 1,
    row: 0,
    col: 0,
    originalIndex: 1,
    originalTotal: 1,
    prompt: 'prompt',
    imageModel: 'gemini-3-pro-image-preview',
    imageAspectRatio: 'auto',
    imageSize: '1K',
    videoModel: 'veo-3.1-landscape-fast-fl',
    videoDuration: 8,
    videoAspectRatio: '16:9',
    videoResolution: '720P',
    imageGenStatus: 'idle',
    videoGenStatus: 'idle',
    ...overrides,
  };
}

function createStoryboardNode(): AINodeData {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 120 },
    'aiStoryboard',
  ) as AINodeData;

  node.dimensions = { ...AI_STORYBOARD_DEFAULT_SIZE };
  node.config = {
    ...node.config,
    shots: [createShot()],
    processedInputFileIds: ['source-file-1'],
  } satisfies Partial<StoryboardConfig>;

  return node;
}

function createWorkflow(): Workflow {
  const node = createStoryboardNode();
  return {
    id: 'workflow-storyboard-state',
    projectId: 'project-storyboard-state',
    name: 'Storyboard State',
    nodes: {
      [node.id.value]: node,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 100,
      canvasSize: { width: 1920, height: 1080 },
      relatedTasks: [],
      usedNodeIds: ['100'],
      releasedNodeIds: [],
    },
    timestamp: {
      created: 1,
      updated: 1,
    },
  };
}

test('writeStoryboardLocalStateToNodeGraph only updates the targeted storyboard node when state changes', () => {
  const node = createStoryboardNode();
  const defaults = getStoryboardShotDefaults(node.config);
  const nextState: StoryboardLocalState = {
    shots: [createShot({ prompt: 'updated prompt' })],
    processedInputFileIds: ['source-file-1', 'source-file-2'],
  };

  const result = writeStoryboardLocalStateToNodeGraph({
    nodes: [{
      id: node.id.value.toString(),
      type: node.type,
      data: node,
      position: node.position,
    } satisfies ReactFlowNode<AnyNodeData>],
    nodeId: node.id.value,
    nextState,
    defaults,
  });

  assert.equal(result.changed, true);
  const nextNode = result.nextNodes[0]?.data as AINodeData | undefined;
  if (!nextNode) {
    throw new Error('Expected storyboard node data');
  }
  assert.equal((nextNode.config.shots as StoryboardShotData[])[0]?.prompt, 'updated prompt');
  assert.deepEqual(nextNode.config.processedInputFileIds, ['source-file-1', 'source-file-2']);
});

test('writeStoryboardLocalStateToNodeGraph keeps graph unchanged when next local state is identical', () => {
  const node = createStoryboardNode();
  const defaults = getStoryboardShotDefaults(node.config);

  const result = writeStoryboardLocalStateToNodeGraph({
    nodes: [{
      id: node.id.value.toString(),
      type: node.type,
      data: node,
      position: node.position,
    } satisfies ReactFlowNode<AnyNodeData>],
    nodeId: node.id.value,
    nextState: {
      shots: node.config.shots as StoryboardShotData[],
      processedInputFileIds: ['source-file-1'],
    },
    defaults,
  });

  assert.equal(result.changed, false);
  assert.equal(result.nextNodes[0]?.data, node);
});

test('patchStoryboardNodeRuntimeState applies storyboard-wide state changes through runtime snapshot callback', () => {
  const workflow = createWorkflow();
  let appliedWorkflow: Workflow | null = null;

  const changed = patchStoryboardNodeRuntimeState({
    workflow,
    nodeId: '100',
    updater: ({ shots, processedInputFileIds }) => ({
      shots: shots.map((shot) => ({ ...shot, prompt: 'patched prompt' })),
      processedInputFileIds: [...processedInputFileIds, 'source-file-2'],
    }),
    applyRuntimeSnapshot: (runtimeSnapshot) => {
      appliedWorkflow = {
        ...workflow,
        nodes: runtimeSnapshot.nodes,
        connections: runtimeSnapshot.connections,
        viewport: runtimeSnapshot.viewport,
        metadata: {
          ...workflow.metadata,
          ...runtimeSnapshot.metadata,
        },
      };
      return appliedWorkflow;
    },
  });

  assert.equal(changed, true);
  if (!appliedWorkflow) {
    throw new Error('Expected workflow patch to be applied');
  }
  const workflowAfterPatch: Workflow = appliedWorkflow;
  const patchedNode = workflowAfterPatch.nodes['100'] as AINodeData;
  assert.equal((patchedNode.config.shots as StoryboardShotData[])[0]?.prompt, 'patched prompt');
  assert.deepEqual(patchedNode.config.processedInputFileIds, ['source-file-1', 'source-file-2']);
});

test('patchStoryboardShotRuntimeState only updates the targeted shot and preserves processed ids', () => {
  const workflow = createWorkflow();
  let appliedWorkflow: Workflow | null = null;

  const changed = patchStoryboardShotRuntimeState({
    workflow,
    nodeId: '100',
    shotId: 'shot-1',
    updater: (shots) => shots.map((shot) => (
      shot.id === 'shot-1'
        ? { ...shot, imageGenStatus: 'generating' }
        : shot
    )),
    applyRuntimeSnapshot: (runtimeSnapshot) => {
      appliedWorkflow = {
        ...workflow,
        nodes: runtimeSnapshot.nodes,
        connections: runtimeSnapshot.connections,
        viewport: runtimeSnapshot.viewport,
        metadata: {
          ...workflow.metadata,
          ...runtimeSnapshot.metadata,
        },
      };
      return appliedWorkflow;
    },
  });

  assert.equal(changed, true);
  if (!appliedWorkflow) {
    throw new Error('Expected workflow patch to be applied');
  }
  const workflowAfterPatch: Workflow = appliedWorkflow;
  const patchedNode = workflowAfterPatch.nodes['100'] as AINodeData;
  assert.equal((patchedNode.config.shots as StoryboardShotData[])[0]?.imageGenStatus, 'generating');
  assert.deepEqual(patchedNode.config.processedInputFileIds, ['source-file-1']);
});
