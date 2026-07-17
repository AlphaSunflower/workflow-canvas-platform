import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import {
  getAIImageGenGroupInputHandle,
} from './groups';
import {
  buildAIImageGenGroupPlans,
  canRunAIImageGen,
} from './runtime';

function createAIImageGenNode(overrides: Record<string, unknown> = {}) {
  const node = createDefaultAINodeData(
    createSequentialNodeId(100),
    { x: 100, y: 100 },
    'aiImageGen',
  );

  node.config = {
    ...node.config,
    prompt: 'official text prompt',
    inputGroups: [
      {
        id: 'group-1',
        label: 'Group 1',
        order: 0,
      },
    ],
    ...overrides,
  };

  return node;
}

test('AI image gen official runtime can run without image inputs and builds an empty reference group plan', () => {
  const node = createAIImageGenNode({
    model: 'gpt-image-2-official',
    quality: 'high',
    imageSize: '2K',
    aspectRatio: 'auto',
  });

  const validation = canRunAIImageGen(node, []);
  const plans = buildAIImageGenGroupPlans({
    workflow: {
      id: 'workflow-official-runtime',
      nodes: {
        [node.id.value]: node,
      },
      connections: [],
    },
    node,
  } as never);

  assert.equal(validation.valid, true);
  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.groupId, 'group-1');
  assert.deepEqual(plans[0]?.plan.files, []);
  assert.deepEqual(plans[0]?.plan.references, []);
  assert.equal(plans[0]?.plan.config.model, 'gpt-image-2-official');
  assert.equal(plans[0]?.plan.config.quality, 'high');
});

test('AI image gen default runtime can run without image inputs and builds an empty reference group plan', () => {
  const node = createAIImageGenNode({
    model: 'gpt-image-2-vip',
    imageSize: '2K',
    aspectRatio: '1:1',
  });

  const validation = canRunAIImageGen(node, []);
  const plans = buildAIImageGenGroupPlans({
    workflow: {
      id: 'workflow-text-to-image-runtime',
      nodes: {
        [node.id.value]: node,
      },
      connections: [],
    },
    node,
  } as never);

  assert.equal(validation.valid, true);
  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.groupId, 'group-1');
  assert.deepEqual(plans[0]?.plan.files, []);
  assert.deepEqual(plans[0]?.plan.references, []);
  assert.equal(plans[0]?.plan.config.model, 'gpt-image-2-vip');
});

test('AI image gen official runtime rejects connected reference images until image edits are implemented', () => {
  const node = createAIImageGenNode({
    model: 'gpt-image-2-official',
    quality: 'medium',
  });

  const validation = canRunAIImageGen(node, [{
    sourceNodeId: '1',
    sourceNodeType: 'image',
    sourceHandle: null,
    targetHandle: getAIImageGenGroupInputHandle('group-1'),
    fileId: 'file-1',
  } as never]);

  assert.equal(validation.valid, false);
  assert.equal((validation.reason ?? '').includes('text-to-image only'), true);
});
