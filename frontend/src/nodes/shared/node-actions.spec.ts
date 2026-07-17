import test from 'node:test';
import assert from 'node:assert/strict';

import type { AINodeData, Workflow } from '@/types';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import type { NodeActionDefinition } from '../types';
import {
  createNodeActionContext,
  getNodeActionDefinition,
  resolveNodeActionServices,
  runNodeActionDefinition,
  validateNodeAction,
} from './node-actions';

function createWorkflow(node: AINodeData): Workflow {
  return {
    id: 'workflow-node-action',
    projectId: 'project-node-action',
    name: 'Node Action Workflow',
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

test('validateNodeAction requires target id when targetRequired is enabled', () => {
  const node = createDefaultAINodeData(createSequentialNodeId(1), { x: 0, y: 0 }, 'aiStoryboard');
  const workflow = createWorkflow(node);
  const action: NodeActionDefinition = {
    id: 'shot-image',
    label: 'Shot Image',
    targetRequired: true,
    run: () => undefined,
  };

  const validation = validateNodeAction(action, createNodeActionContext({
    workflow,
    node,
    actionId: action.id,
    inputs: [],
    resolveServices: ({ services }) => services,
  }));

  assert.equal(validation.valid, false);
  assert.equal(/requires a target id/i.test(validation.reason ?? ''), true);
});

test('runNodeActionDefinition executes validated action with options and target', async () => {
  const node = createDefaultAINodeData(createSequentialNodeId(2), { x: 0, y: 0 }, 'aiStoryboard');
  const workflow = createWorkflow(node);
  const observed: {
    targetId?: string;
    suppressNotifications?: boolean;
  } = {};

  const action: NodeActionDefinition = {
    id: 'shot-video',
    label: 'Shot Video',
    targetRequired: true,
    validate: ({ targetId }) => ({
      valid: targetId === 'shot-1',
      reason: 'invalid target',
    }),
    run: ({ targetId, options }) => {
      observed.targetId = targetId;
      observed.suppressNotifications = Boolean(options.suppressNotifications);
    },
  };

  await runNodeActionDefinition(action, createNodeActionContext({
    workflow,
    node,
    actionId: action.id,
    inputs: [],
    targetId: 'shot-1',
    options: {
      suppressNotifications: true,
    },
    resolveServices: ({ services }) => services,
  }));

  assert.deepEqual(observed, {
    targetId: 'shot-1',
    suppressNotifications: true,
  });
});

test('getNodeActionDefinition resolves action from injected node definition resolver', () => {
  const action: NodeActionDefinition = {
    id: 'arrange',
    label: 'Arrange',
    run: () => undefined,
  };

  const resolved = getNodeActionDefinition('aiStoryboard', 'arrange', () => ({
    actions: [action],
  }));

  assert.equal(resolved, action);
});

test('resolveNodeActionServices uses the injected service resolver when provided', () => {
  const node = createDefaultAINodeData(createSequentialNodeId(3), { x: 0, y: 0 }, 'aiStoryboard');
  const workflow = createWorkflow(node);
  const baseServices = { marker: 'base' };
  const resolved = resolveNodeActionServices({
    workflow,
    node,
    actionId: 'arrange',
    inputs: [],
    services: baseServices,
    resolveServices: (context) => ({
      marker: context.services,
      nodeType: context.node.type,
    }),
  });

  assert.deepEqual(resolved, {
    marker: baseServices,
    nodeType: 'aiStoryboard',
  });
});
