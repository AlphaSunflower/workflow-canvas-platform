import { aiStoryboardApi } from '@/api';
import type {
  FileInfo,
  StoryboardShotData,
} from '@/types';
import type {
  WorkflowNodeGroupExecutionState,
} from '@/contracts/execution';
import type { SharedNodeActionServices } from '../shared/node-action-service-registry';
import { patchStoryboardShotRuntimeState } from './storyboard-state-service';
import {
  applyStoryboardArrangeToWorkflow,
  runStoryboardArrange,
} from './storyboard-arrange-service';
import { runStoryboardShotImage } from './storyboard-shot-image-runner';
import { runStoryboardShotVideo } from './storyboard-shot-video-runner';
import { runStoryboardBatchVideo } from './storyboard-batch-video-runner';
import {
  getCommittedStoryboardGroupState,
} from './storyboard-execution-service';
export type { StoryboardNodeActionServices } from './storyboard-action.contracts';

export interface StoryboardActionFacadeDependencies extends SharedNodeActionServices {
  arrangeStoryboardShots: (
    request: {
      workflowId: string;
      nodeId: string;
      nodeType: 'aiStoryboard';
      shots: Array<{
        shotId: string;
        order: number;
        imageFileId: string;
      }>;
    },
    options?: { signal?: AbortSignal },
  ) => Promise<Awaited<ReturnType<typeof aiStoryboardApi.arrangeStoryboardShots>>>;
}

export interface StoryboardActionFacade {
  arrange: (
    nodeId: string,
    options?: {
      signal?: AbortSignal;
    },
  ) => Promise<void>;
  runShotImage: (
    nodeId: string,
    shotId: string,
    options?: {
      signal?: AbortSignal;
    },
  ) => Promise<void>;
  runShotVideo: (
    nodeId: string,
    shotId: string,
    options?: {
      signal?: AbortSignal;
      suppressNotifications?: boolean;
    },
  ) => Promise<void>;
  runBatchVideo: (
    nodeId: string,
    options?: {
      signal?: AbortSignal;
    },
  ) => Promise<void>;
}

function createPatchStoryboardShotState(
  dependencies: StoryboardActionFacadeDependencies,
): (
  nodeId: string,
  shotId: string,
  updater: (shots: StoryboardShotData[]) => StoryboardShotData[],
) => boolean {
  return (nodeId, shotId, updater) => patchStoryboardShotRuntimeState({
    workflow: dependencies.getCurrentWorkflow(),
    nodeId,
    shotId,
    updater,
    applyRuntimeSnapshot: dependencies.applyRuntimeSnapshot,
    applyOptions: {
      hydrateCanvas: true,
      hydrationReason: 'external-output',
    },
  });
}

export function createStoryboardActionFacadeDependencies(
  services: SharedNodeActionServices,
): StoryboardActionFacadeDependencies {
  return {
    ...services,
    arrangeStoryboardShots: aiStoryboardApi.arrangeStoryboardShots,
  };
}

export function createStoryboardActionFacade(
  dependencies: StoryboardActionFacadeDependencies,
): StoryboardActionFacade {
  const patchStoryboardShotState = createPatchStoryboardShotState(dependencies);
  const getCommittedGroupState = (
    nodeId: string,
    shotId: string,
    options?: {
      workflowId?: string | null;
      runId?: string | null;
      taskId?: string | null;
      resultFileId?: string | null;
      fileType?: FileInfo['fileType'];
    },
  ): WorkflowNodeGroupExecutionState | null => getCommittedStoryboardGroupState({
    nodeId,
    shotId,
    workflowId: options?.workflowId ?? dependencies.getCurrentWorkflow()?.id ?? null,
    runId: options?.runId,
    taskId: options?.taskId,
    resultFileId: options?.resultFileId,
    fileType: options?.fileType,
    getGroupState: dependencies.getExecutionRuntimeGroupState,
  });
  const runShotVideoFromFacade = async (
    nodeId: string,
    shotId: string,
    options?: {
      signal?: AbortSignal;
      suppressNotifications?: boolean;
    },
  ): Promise<void> => {
    await runStoryboardShotVideo(nodeId, shotId, {
      auth: dependencies.auth,
      getNodeById: dependencies.getNodeById,
      getNodeNameById: dependencies.getNodeNameById,
      getCurrentWorkflow: dependencies.getCurrentWorkflow,
      ensureWorkflowPersistedForExecution: dependencies.ensureWorkflowPersistedForExecution,
      ensureBackendFileId: dependencies.ensureBackendFileId,
      patchStoryboardShotState,
      getCommittedStoryboardGroupState: getCommittedGroupState,
      syncTaskRefsToWorkflow: dependencies.syncTaskRefsToWorkflow,
      commitBackendExecutionOutputs: dependencies.commitBackendExecutionOutputs,
      buildExecutionRuntimeAdapterContext: dependencies.buildExecutionRuntimeAdapterContext,
      createOutputCommitInput: dependencies.createOutputCommitInput,
      setStoryboardNodeExecutionState: dependencies.setNodeExecutionState,
      setStoryboardGroupExecutionState: dependencies.setGroupExecutionState,
      createGroupedExecution: dependencies.createGroupedExecution,
      startExecutionPolling: dependencies.startExecutionPolling,
      logWarn: dependencies.logWarn,
      notification: dependencies.notification,
    }, options);
  };

  return {
    arrange: async (nodeId, options): Promise<void> => {
      await runStoryboardArrange(nodeId, {
        auth: dependencies.auth,
        getNodeNameById: dependencies.getNodeNameById,
        getNodeById: dependencies.getNodeById,
        getCurrentWorkflow: dependencies.getCurrentWorkflow,
        applyStoryboardArrangeResult: (targetNodeId, arrangedShots) => {
          const nextWorkflow = applyStoryboardArrangeToWorkflow(
            dependencies.getCurrentWorkflow(),
            targetNodeId,
            arrangedShots,
          );
          if (!nextWorkflow) {
            return false;
          }

          dependencies.applyRuntimeSnapshot({
            nodes: nextWorkflow.nodes,
            connections: nextWorkflow.connections,
            viewport: nextWorkflow.viewport,
            metadata: nextWorkflow.metadata ?? undefined,
          }, {
            hydrateCanvas: true,
            hydrationReason: 'external-output',
          });
          return true;
        },
        arrangeStoryboardShots: dependencies.arrangeStoryboardShots,
        getBackendFileInfo: dependencies.getBackendFileInfo,
        ensureBackendFileId: dependencies.ensureBackendFileId,
        notification: dependencies.notification,
      }, options);
    },
    runShotImage: async (nodeId, shotId, options): Promise<void> => {
      await runStoryboardShotImage(nodeId, shotId, {
        auth: dependencies.auth,
        getNodeById: dependencies.getNodeById,
        getNodeNameById: dependencies.getNodeNameById,
        getCurrentWorkflow: dependencies.getCurrentWorkflow,
        ensureWorkflowPersistedForExecution: dependencies.ensureWorkflowPersistedForExecution,
        ensureBackendFileId: dependencies.ensureBackendFileId,
        patchStoryboardShotState,
        getCommittedStoryboardGroupState: getCommittedGroupState,
        syncTaskRefsToWorkflow: dependencies.syncTaskRefsToWorkflow,
        commitBackendExecutionOutputs: dependencies.commitBackendExecutionOutputs,
        buildExecutionRuntimeAdapterContext: dependencies.buildExecutionRuntimeAdapterContext,
        createOutputCommitInput: dependencies.createOutputCommitInput,
        setStoryboardNodeExecutionState: dependencies.setNodeExecutionState,
        setStoryboardGroupExecutionState: dependencies.setGroupExecutionState,
        createGroupedExecution: dependencies.createGroupedExecution,
        startExecutionPolling: dependencies.startExecutionPolling,
        notification: dependencies.notification,
      }, options);
    },
    runShotVideo: async (nodeId, shotId, options): Promise<void> => {
      await runShotVideoFromFacade(nodeId, shotId, options);
    },
    runBatchVideo: async (nodeId, options): Promise<void> => {
      await runStoryboardBatchVideo(nodeId, {
        getNodeById: dependencies.getNodeById,
        getNodeNameById: dependencies.getNodeNameById,
        getCurrentWorkflow: dependencies.getCurrentWorkflow,
        generateStoryboardShotVideo: runShotVideoFromFacade,
        getCommittedStoryboardGroupState: getCommittedGroupState,
        notification: {
          showWarning: dependencies.notification.showWarning,
          showInfo: dependencies.notification.showInfo,
          showSuccess: dependencies.notification.showSuccess,
        },
      }, options);
    },
  };
}
