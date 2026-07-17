import test from 'node:test';
import assert from 'node:assert/strict';

import type { AINodeData, Workflow } from '@/types';
import { NODE_ACTION_ONLY_EXECUTION_MODE } from '@/execution-runtime/node-action-only-execution';
import { createDefaultAINodeData, createSequentialNodeId } from '@/utils/node/create';
import { createStoryboardActionFacade } from './storyboard-action-facade';
import {
  aiStoryboardExecution,
  aiStoryboardNodeActions,
  createAIStoryboardNodeActionOnlyExecutionRequest,
  getAIStoryboardActionIds,
} from './runtime';

function createStoryboardWorkflow(): { workflow: Workflow; node: AINodeData } {
  const node = createDefaultAINodeData(
    createSequentialNodeId(200),
    { x: 100, y: 100 },
    'aiStoryboard',
  );
  node.config = {
    ...node.config,
    shots: [{
      id: 'shot-1',
      order: 1,
      row: 0,
      col: 0,
      originalIndex: 1,
      originalTotal: 1,
      prompt: 'camera move',
      imageFileId: 'backend-image-1',
      imageModel: 'gemini-3-pro-image-preview',
      imageAspectRatio: 'auto',
      imageSize: '1K',
      videoModel: 'veo-3.1-landscape-fast-fl',
      videoDuration: 8,
      videoAspectRatio: '16:9',
      videoResolution: '720P',
      imageGenStatus: 'idle',
      imageGenMessage: undefined,
      imageGenRunId: undefined,
      videoGenStatus: 'idle',
      videoProgress: undefined,
      videoError: undefined,
      videoRunId: undefined,
    }],
  };

  return {
    node,
    workflow: {
      id: 'workflow-storyboard-runtime',
      projectId: 'project-storyboard-runtime',
      name: 'Storyboard Runtime',
      nodes: {
        [node.id.value]: node,
      },
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        nodeCount: 1,
        connectionCount: 0,
        lastNodeId: 200,
        canvasSize: { width: 1920, height: 1080 },
        relatedTasks: [],
        usedNodeIds: [node.id.value],
        releasedNodeIds: [],
      },
      timestamp: {
        created: 1,
        updated: 1,
      },
    },
  };
}

test('aiStoryboard runtime exposes node-action-only execution contract', () => {
  assert.equal(aiStoryboardExecution.mode, 'node-action-only');
  assert.equal(aiStoryboardExecution.canRun({} as never, []).valid, true);
  assert.deepEqual(getAIStoryboardActionIds(), [
    'arrange',
    'shot-image',
    'shot-video',
    'batch-video',
  ]);
});

test('aiStoryboard runtime builds a formal node-action-only execution request', () => {
  const request = createAIStoryboardNodeActionOnlyExecutionRequest();

  assert.deepEqual(request, {
    boundary: NODE_ACTION_ONLY_EXECUTION_MODE,
    actionIds: ['arrange', 'shot-image', 'shot-video', 'batch-video'],
    plan: {
      files: [],
      references: [],
      config: {},
    },
  });
});

test('aiStoryboard shot-video action forwards target id and suppressNotifications option', async () => {
  const { workflow, node } = createStoryboardWorkflow();
  const calls: Array<{ nodeId: string; shotId: string; suppressNotifications: boolean }> = [];
  const action = aiStoryboardNodeActions?.find((item) => item.id === 'shot-video');

  if (!action) {
    throw new Error('Expected storyboard shot-video action');
  }

  await action.run({
    workflow,
    node,
    inputs: [],
    targetId: 'shot-1',
    options: {
      suppressNotifications: true,
    },
    services: {
      arrange: async () => undefined,
      runShotImage: async () => undefined,
      runShotVideo: async (
        nodeId: string,
        shotId: string,
        options?: {
          suppressNotifications?: boolean;
        },
      ) => {
        calls.push({
          nodeId,
          shotId,
          suppressNotifications: Boolean(options?.suppressNotifications),
        });
      },
      runBatchVideo: async () => undefined,
    },
  });

  assert.deepEqual(calls, [{
    nodeId: node.id.value,
    shotId: 'shot-1',
    suppressNotifications: true,
  }]);
});

test('aiStoryboard runtime accepts services resolved from the storyboard facade', async () => {
  const { workflow, node } = createStoryboardWorkflow();
  let facadeArrangeCalls = 0;
  const action = aiStoryboardNodeActions?.find((item) => item.id === 'arrange');

  if (!action) {
    throw new Error('Expected storyboard arrange action');
  }

  await action.run({
    workflow,
    node,
    inputs: [],
    options: {},
    services: {
      ...createStoryboardActionFacade({
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
      }),
      arrange: async (nodeId: string, options?: { signal?: AbortSignal }): Promise<void> => {
        facadeArrangeCalls += 1;
        await createStoryboardActionFacade({
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
        }).arrange(nodeId, options);
      },
    },
  });

  assert.equal(facadeArrangeCalls, 1);
});
