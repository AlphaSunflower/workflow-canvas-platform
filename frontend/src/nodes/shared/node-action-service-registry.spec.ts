import test from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import type { Workflow } from '@/types';
import type { SharedNodeActionServices } from './node-action-service-registry';
import {
  NodeActionServiceRegistry,
  createNodeActionServiceRegistry,
} from './node-action-service-registry';
import { defaultNodeActionServiceRegistry } from './node-action-service-registry.default';

function createWorkflow() {
  const node = createDefaultAINodeData(createSequentialNodeId(1), { x: 0, y: 0 }, 'aiStoryboard');
  const workflow: Workflow = {
    id: 'workflow-node-action-services',
    projectId: 'project-node-action-services',
    name: 'Node Action Services',
    nodes: {
      [node.id.value]: node,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 1,
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

  return { workflow, node };
}

test('NodeActionServiceRegistry returns input services when no resolver is registered', () => {
  const registry = new NodeActionServiceRegistry();
  const { workflow, node } = createWorkflow();
  const services = { mode: 'passthrough' };

  const resolved = registry.resolve({
    workflow,
    node,
    actionId: 'arrange',
    inputs: [],
    services,
  });

  assert.equal(resolved, services);
});

test('NodeActionServiceRegistry resolves services from the registered node-type resolver', () => {
  const registry = createNodeActionServiceRegistry();
  const { workflow, node } = createWorkflow();
  const calls: string[] = [];

  registry.register('aiStoryboard', (context) => {
    calls.push(`${context.node.type}:${context.actionId}`);
    return { resolved: true };
  });

  const resolved = registry.resolve({
    workflow,
    node,
    actionId: 'shot-video',
    inputs: [],
  });

  assert.deepEqual(calls, ['aiStoryboard:shot-video']);
  assert.deepEqual(resolved, { resolved: true });
});

test('defaultNodeActionServiceRegistry adapts shared services into storyboard facade services', () => {
  const { workflow, node } = createWorkflow();
  const sharedServices = {
    auth: {} as never,
    getNodeById: () => node,
    getNodeNameById: () => 'AI Storyboard',
    getCurrentWorkflow: () => workflow,
    applyRuntimeSnapshot: () => workflow,
    ensureWorkflowPersistedForExecution: async () => workflow,
    ensureBackendFileId: async () => null,
    getBackendFileInfo: async () => ({ status: 'ready' }),
    getExecutionRuntimeGroupState: () => null,
    syncTaskRefsToWorkflow: () => undefined,
    commitBackendExecutionOutputs: async () => undefined,
    buildExecutionRuntimeAdapterContext: () => ({
      workflowId: workflow.id,
      workflow,
      node,
      nodeTitle: 'AI Storyboard',
      inputs: [],
      resolvedInputGroups: [],
      services: {},
    }),
    createOutputCommitInput: () => ({ mode: 'incremental', workflowId: workflow.id, nodeId: node.id.value } as never),
    setNodeExecutionState: () => undefined,
    setGroupExecutionState: () => undefined,
    createGroupedExecution: async () => ({ runId: 'run-1', runNo: 'RUN-1', status: 'queued', tasks: [] } as never),
    startExecutionPolling: async () => ({ runId: 'run-1', workflowId: workflow.id, status: 'completed', progress: 100, message: '', tasks: [] } as never),
    logWarn: () => undefined,
    notification: {
      showWarning: () => undefined,
      showInfo: () => undefined,
      showSuccess: () => undefined,
      showError: () => undefined,
      showAuthFeedback: () => false,
    },
  } satisfies SharedNodeActionServices;

  const resolved = defaultNodeActionServiceRegistry.resolve({
    workflow,
    node,
    actionId: 'arrange',
    inputs: [],
    services: sharedServices,
  }) as Record<string, unknown>;

  assert.equal(typeof resolved.arrange, 'function');
  assert.equal(typeof resolved.runShotImage, 'function');
  assert.equal(typeof resolved.runShotVideo, 'function');
  assert.equal(typeof resolved.runBatchVideo, 'function');
});
