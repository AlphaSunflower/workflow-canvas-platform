import test from 'node:test';
import assert from 'node:assert/strict';

import type { AINodeData, Workflow } from '@/types';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import type { SharedNodeActionServices } from '../shared/node-action-service-registry';
import {
  createStoryboardActionFacade,
  createStoryboardActionFacadeDependencies,
} from './storyboard-action-facade';

function createWorkflow(): { workflow: Workflow; node: AINodeData } {
  const node = createDefaultAINodeData(
    createSequentialNodeId(9),
    { x: 100, y: 100 },
    'aiStoryboard',
  );

  const workflow: Workflow = {
    id: 'workflow-storyboard-facade',
    projectId: 'project-storyboard-facade',
    name: 'Storyboard Facade',
    nodes: {
      [node.id.value]: node,
    },
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {
      nodeCount: 1,
      connectionCount: 0,
      lastNodeId: 9,
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

test('createStoryboardActionFacade exposes all storyboard actions', () => {
  const { workflow, node } = createWorkflow();
  const facade = createStoryboardActionFacade({
    auth: {} as never,
    getNodeById: () => node,
    getNodeNameById: () => 'AI Storyboard',
    getCurrentWorkflow: () => workflow,
    applyRuntimeSnapshot: () => workflow,
    ensureWorkflowPersistedForExecution: async () => workflow,
    ensureBackendFileId: async () => null,
    getBackendFileInfo: async () => ({ status: 'ready' }),
    arrangeStoryboardShots: async () => ({
      success: true,
      data: {
        shots: [],
        model: 'stub-model',
        referenceCount: 0,
        promptVersion: 'v1',
        mode: 'image' as const,
      },
    }),
    arrangeStoryboardFromStory: async () => ({
      success: true,
      data: {
        shots: [],
        model: 'stub-model',
        referenceCount: 0,
        promptVersion: 'v1',
        mode: 'story' as const,
      },
    }),
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
  });

  assert.equal(typeof facade.arrange, 'function');
  assert.equal(typeof facade.runShotImage, 'function');
  assert.equal(typeof facade.runShotVideo, 'function');
  assert.equal(typeof facade.runBatchVideo, 'function');
});

test('createStoryboardActionFacadeDependencies extends shared services with storyboard arrange api', () => {
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

  const dependencies = createStoryboardActionFacadeDependencies(sharedServices);

  assert.equal(typeof dependencies.arrangeStoryboardShots, 'function');
  assert.equal(dependencies.getNodeById, sharedServices.getNodeById);
  assert.equal(dependencies.setNodeExecutionState, sharedServices.setNodeExecutionState);
  assert.equal(dependencies.setGroupExecutionState, sharedServices.setGroupExecutionState);
});
