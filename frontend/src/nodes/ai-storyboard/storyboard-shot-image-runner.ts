import type { AuthContextValue } from '@/auth';
import { requireAuthenticatedAction } from '@/auth';
import type {
  AINodeData,
  AnyNodeData,
  ExecutionTaskRef,
  FileInfo,
  FileNodeData,
  NodeTaskRef,
  StoryboardShotData,
  Workflow,
} from '@/types';
import { isAINodeData, isFileNodeData } from '@/utils';
import { buildExecutionTaskNodeRef, toNodeTaskRef } from '@/utils/workflow/task-batch';
import type { ExecutionOutputCommitWorkflowInput } from '@/execution-runtime/execution-output-commit.types';
import type { ExecutionRuntimeNodeAdapterContext } from '@/execution-runtime/node-execution-adapter.types';
import type { ExecutionRuntimeRunState } from '@/execution-runtime/execution-runtime.types';
import type {
  WorkflowAIExecutionState,
  WorkflowNodeGroupExecutionState,
} from '@/contracts/execution';
import type {
  CreateBackendExecutionRequest,
  BackendExecutionSummary,
} from '@/services/backendExecutionService';
import {
  createStoryboardShotExecutionPayload,
  getStoryboardShots,
  mergeStoryboardNodeTaskRefs,
  resolveStoryboardExecutionReferenceFileIds,
} from './storyboard-execution-service';
import {
  isAIImageGenNodeParameterlessModel,
  normalizeAIImageGenNodeModel,
} from '@/nodes/ai-image-gen/constants';

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function getActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

function createExecutionTaskRef(
  node: AINodeData,
  input: Omit<ExecutionTaskRef, 'node'>,
): ExecutionTaskRef {
  return {
    ...input,
    node: buildExecutionTaskNodeRef(node),
  };
}

export interface StoryboardExecutionNotifications {
  showWarning: (title: string, message: string) => void;
  showInfo: (title: string, message: string) => void;
  showSuccess: (title: string, message: string) => void;
  showError: (title: string, message: string) => void;
  showAuthFeedback: (error: unknown, actionLabel: string) => boolean;
}

export interface StoryboardImageRunnerDependencies {
  auth: AuthContextValue;
  getNodeById: (nodeId: string) => AnyNodeData | null;
  getNodeNameById: (nodeId: string) => string;
  getCurrentWorkflow: () => Workflow | null;
  ensureWorkflowPersistedForExecution: () => Promise<Workflow>;
  ensureBackendFileId: (
    sourceNode: FileNodeData,
    options?: { signal?: AbortSignal; workflowId?: string | null },
  ) => Promise<string | null | undefined>;
  patchStoryboardShotState: (
    nodeId: string,
    shotId: string,
    updater: (shots: StoryboardShotData[]) => StoryboardShotData[],
  ) => boolean;
  getCommittedStoryboardGroupState: (
    nodeId: string,
    shotId: string,
    options?: {
      workflowId?: string | null;
      runId?: string | null;
      taskId?: string | null;
      resultFileId?: string | null;
      fileType?: FileInfo['fileType'];
    },
  ) => WorkflowNodeGroupExecutionState | null;
  syncTaskRefsToWorkflow: (
    nodeId: string,
    taskRefs: NodeTaskRef[],
    taskRefsForMetadata: ExecutionTaskRef[],
  ) => void;
  commitBackendExecutionOutputs: (
    node: AINodeData,
    snapshot: ExecutionRuntimeRunState,
    input: ExecutionOutputCommitWorkflowInput,
  ) => Promise<void>;
  buildExecutionRuntimeAdapterContext: (
    node: AINodeData,
    signal?: AbortSignal,
  ) => ExecutionRuntimeNodeAdapterContext;
  createOutputCommitInput: (
    payload: ReturnType<typeof createStoryboardShotExecutionPayload>,
    adapterContext: ExecutionRuntimeNodeAdapterContext,
  ) => ExecutionOutputCommitWorkflowInput;
  setStoryboardNodeExecutionState: (nodeId: string, nextState: WorkflowAIExecutionState) => void;
  setStoryboardGroupExecutionState: (nodeId: string, nextState: WorkflowNodeGroupExecutionState) => void;
  createGroupedExecution: (
    request: CreateBackendExecutionRequest,
    signal?: AbortSignal,
  ) => Promise<BackendExecutionSummary>;
  startExecutionPolling: (options: {
    runId: string;
    workflowId: string;
    nodeId: string;
    signal?: AbortSignal;
    onSnapshot: (snapshot: ExecutionRuntimeRunState) => void;
  }) => Promise<ExecutionRuntimeRunState>;
  notification: StoryboardExecutionNotifications;
}

export async function runStoryboardShotImage(
  nodeId: string,
  shotId: string,
  dependencies: StoryboardImageRunnerDependencies,
  options?: {
    signal?: AbortSignal;
  },
): Promise<void> {
  const node = dependencies.getNodeById(nodeId);

  if (!node || !isAINodeData(node) || node.type !== 'aiStoryboard') {
    dependencies.notification.showWarning('AI 出图不可用', '当前节点不是 AI 分镜表节点。');
    return;
  }

  const authError = requireAuthenticatedAction(dependencies.auth, { actionLabel: '生成分镜图片' });
  if (authError) {
    dependencies.notification.showWarning('需要登录', authError.message);
    return;
  }

  const activeWorkflow = dependencies.getCurrentWorkflow();
  if (!activeWorkflow) {
    dependencies.notification.showWarning('AI 出图不可用', '当前画布未就绪，暂时无法执行单镜头 AI 出图。');
    return;
  }

  const currentShots = getStoryboardShots(node);
  const shot = currentShots.find((item) => item.id === shotId);
  if (!shot) {
    dependencies.notification.showWarning('AI 出图不可用', '当前镜头不存在或已被删除。');
    return;
  }

  const prompt = typeof shot.prompt === 'string' ? shot.prompt.trim() : '';
  if (prompt.length === 0) {
    dependencies.notification.showWarning('AI 出图不可用', '请先填写该镜头的提示词，再执行 AI 出图。');
    return;
  }

  if (shot.imageGenStatus === 'generating') {
    dependencies.notification.showInfo('AI 出图进行中', `镜头 ${shot.order} 已在执行 AI 出图，请等待当前请求完成。`);
    return;
  }

  const persistedWorkflow = await dependencies.ensureWorkflowPersistedForExecution();
  const persistedNode = persistedWorkflow.nodes[nodeId];
  if (!persistedNode || !isAINodeData(persistedNode) || persistedNode.type !== 'aiStoryboard') {
    dependencies.notification.showWarning('AI 出图不可用', '当前节点状态已变化，无法继续执行单镜头 AI 出图。');
    return;
  }

  const persistedShot = getStoryboardShots(persistedNode).find((item) => item.id === shotId);
  if (!persistedShot) {
    dependencies.notification.showWarning('AI 出图不可用', '当前镜头不存在或已被删除。');
    return;
  }

  const sourceNode = typeof persistedShot.sourceNodeId === 'string' && persistedShot.sourceNodeId.length > 0
    ? dependencies.getNodeById(persistedShot.sourceNodeId)
    : null;
  const { referenceFileIds: normalizedReferenceFileIds } = await resolveStoryboardExecutionReferenceFileIds({
    shot: persistedShot,
    sourceNode: sourceNode && isFileNodeData(sourceNode) && sourceNode.type === 'image'
      ? sourceNode
      : null,
    signal: options?.signal,
    maxReferences: 5,
    ensureBackendFileId: dependencies.ensureBackendFileId,
    workflowId: persistedWorkflow.id,
  });
  const resolvedImageModel = normalizeAIImageGenNodeModel(persistedShot.imageModel);
  const usesImageParameters = !isAIImageGenNodeParameterlessModel(resolvedImageModel);

  if (normalizedReferenceFileIds.length === 0 && usesImageParameters) {
    dependencies.notification.showWarning('AI 出图不可用', '当前镜头缺少可用参考图，无法执行 AI 出图。');
    return;
  }

  if (options?.signal?.aborted) {
    dependencies.notification.showInfo('AI 出图已取消', `镜头 ${persistedShot.order} 已取消 AI 出图。`);
    return;
  }

  dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
    item.id === shotId
      ? {
        ...item,
        imageGenStatus: 'generating',
        imageGenMessage: '任务创建中',
      }
      : item
  )));

  dependencies.setStoryboardNodeExecutionState(nodeId, {
    nodeType: 'aiStoryboard',
    taskRecordId: null,
    aiTaskId: null,
    status: 'processing',
    progress: 5,
    message: `镜头 ${persistedShot.order} 正在创建 AI 出图任务`,
    error: undefined,
    lastErrorCode: null,
  });

  dependencies.setStoryboardGroupExecutionState(nodeId, {
    nodeType: 'aiStoryboard',
    groupId: shotId,
    groupOrder: persistedShot.order,
    taskRecordId: null,
    aiTaskId: null,
    status: 'processing',
    progress: 5,
    message: '任务创建中',
    error: undefined,
    lastErrorCode: null,
  });

  dependencies.notification.showInfo('AI 出图开始', `镜头 ${persistedShot.order} 已提交到真实后端执行。`);

  try {
    const storyboardImageExecutionPayload = createStoryboardShotExecutionPayload(
      persistedNode,
      dependencies.getNodeNameById(nodeId),
      persistedShot,
      'image',
    );
    const execution = await dependencies.createGroupedExecution({
      workflowId: persistedWorkflow.id,
      nodeType: 'aiStoryboard',
      taskType: 'image-gen',
      executionMode: 'node-action-only',
      nodeId,
      nodeTitle: dependencies.getNodeNameById(nodeId),
      prompt,
      model: resolvedImageModel,
      ...(usesImageParameters
        ? {
            imageSize: typeof persistedShot.imageSize === 'string' ? persistedShot.imageSize : undefined,
            aspectRatio: typeof persistedShot.imageAspectRatio === 'string' ? persistedShot.imageAspectRatio : undefined,
          }
        : {}),
      groups: [{
        groupId: shotId,
        referenceFileIds: normalizedReferenceFileIds,
      }],
    } as CreateBackendExecutionRequest, options?.signal);

    const task = execution.tasks.find((item) => item.groupId === shotId) ?? execution.tasks[0];
    if (task) {
      const processingTaskRef = createExecutionTaskRef(persistedNode, {
        taskId: task.taskId,
        taskNo: task.taskNo,
        batchId: execution.runNo,
        runId: execution.runId,
        runNo: execution.runNo,
        taskType: 'image-gen',
        projectId: persistedWorkflow.projectId,
        workflowId: persistedWorkflow.id,
        scope: 'group',
        groupId: shotId,
        groupLabel: storyboardImageExecutionPayload.targets[0]?.groupLabel,
        groupOrder: storyboardImageExecutionPayload.targets[0]?.groupOrder ?? persistedShot.order,
        outputHandle: storyboardImageExecutionPayload.targets[0]?.outputHandle,
        status: task.status === 'completed' ? 'completed' : 'processing',
        createdAt: Date.now(),
        startedAt: Date.now(),
      });
      dependencies.syncTaskRefsToWorkflow(
        nodeId,
        mergeStoryboardNodeTaskRefs(persistedNode.tasks, toNodeTaskRef(processingTaskRef)),
        [processingTaskRef],
      );
    }

    dependencies.setStoryboardNodeExecutionState(nodeId, {
      runId: execution.runId,
      taskRecordId: null,
      aiTaskId: execution.runId,
      batchId: execution.runNo,
      nodeType: 'aiStoryboard',
      status: execution.status,
      progress: 10,
      message: `镜头 ${persistedShot.order} 已入队`,
      error: undefined,
      lastErrorCode: null,
    });

    dependencies.setStoryboardGroupExecutionState(nodeId, {
      runId: execution.runId,
      groupId: shotId,
      groupOrder: persistedShot.order,
      taskRecordId: null,
      aiTaskId: task?.taskId ?? null,
      taskNo: task?.taskNo,
      batchId: execution.runNo,
      nodeType: 'aiStoryboard',
      status: task?.status ?? 'queued',
      progress: 10,
      message: '已入队',
      error: undefined,
      lastErrorCode: null,
    });

    dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
      item.id === shotId
        ? {
          ...item,
          imageGenRunId: execution.runId,
          imageGenStatus: 'generating',
          imageGenMessage: '已入队',
        }
        : item
    )));

    const finalSnapshot = await dependencies.startExecutionPolling({
      runId: execution.runId,
      workflowId: persistedWorkflow.id,
      nodeId,
      signal: options?.signal,
      onSnapshot: (snapshot) => {
        const snapshotTask = snapshot.tasks.find((item) => item.groupId === shotId) ?? snapshot.tasks[0];
        if (!snapshotTask) {
          return;
        }

        dependencies.setStoryboardNodeExecutionState(nodeId, {
          runId: snapshot.runId,
          taskRecordId: null,
          aiTaskId: snapshot.runId,
          batchId: snapshot.runNo,
          nodeType: 'aiStoryboard',
          status: snapshot.status,
          progress: snapshot.progress,
          message: snapshot.message,
          error: snapshot.status === 'failed'
            ? (snapshotTask.error ?? undefined)
            : undefined,
          lastErrorCode: snapshot.status === 'failed'
            ? (snapshotTask.errorCode ?? null)
            : null,
        });

        dependencies.setStoryboardGroupExecutionState(nodeId, {
          runId: snapshot.runId,
          groupId: shotId,
          groupOrder: snapshotTask.groupOrder,
          taskRecordId: null,
          aiTaskId: snapshotTask.taskId,
          taskNo: snapshotTask.taskNo,
          batchId: snapshot.runNo,
          nodeType: 'aiStoryboard',
          status: snapshotTask.status,
          progress: snapshotTask.progress,
          message: snapshotTask.message,
          currentStep: snapshotTask.currentStep,
          currentAttemptNo: snapshotTask.currentAttemptNo,
          retryCount: snapshotTask.retryCount,
          maxRetries: snapshotTask.maxRetries,
          maxAttempts: snapshotTask.maxAttempts,
          lastErrorCode: snapshotTask.errorCode,
          resultFileId: snapshotTask.resultFileId,
          ...(snapshotTask.resultFileInfo ? { resultFile: snapshotTask.resultFileInfo } : {}),
          error: snapshotTask.error ?? undefined,
        });

        void dependencies.commitBackendExecutionOutputs(
          persistedNode,
          snapshot,
          dependencies.createOutputCommitInput(
            storyboardImageExecutionPayload,
            dependencies.buildExecutionRuntimeAdapterContext(persistedNode, options?.signal),
          ),
        );

        dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
          item.id === shotId
            ? {
              ...item,
              imageGenRunId: snapshot.runId,
              imageGenStatus: snapshotTask.status === 'completed'
                ? 'completed'
                : snapshotTask.status === 'failed'
                  ? 'failed'
                  : 'generating',
              imageGenMessage: snapshotTask.error
                ?? snapshotTask.message
                ?? undefined,
            }
            : item
        )));
      },
    });

    const finalTask = finalSnapshot.tasks.find((item) => item.groupId === shotId) ?? finalSnapshot.tasks[0];
    if (!finalTask) {
      throw new Error('未获取到当前镜头的执行结果。');
    }

    if (finalTask.status === 'completed' && typeof finalTask.resultFileId === 'string') {
      await dependencies.commitBackendExecutionOutputs(
        persistedNode,
        finalSnapshot,
        dependencies.createOutputCommitInput(
          storyboardImageExecutionPayload,
          dependencies.buildExecutionRuntimeAdapterContext(persistedNode, options?.signal),
        ),
      );
      dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
        item.id === shotId
          ? {
            ...item,
            imageGenRunId: finalSnapshot.runId,
            imageGenStatus: 'completed',
            imageGenMessage: finalTask.message ?? '已完成',
          }
          : item
      )));

      dependencies.notification.showSuccess('AI 出图完成', `镜头 ${persistedShot.order} 已生成新图片。`);
      return;
    }

    if (dependencies.getCommittedStoryboardGroupState(nodeId, shotId, {
      workflowId: persistedWorkflow.id,
      runId: finalSnapshot.runId,
      taskId: finalTask.taskId,
      resultFileId: finalTask.resultFileId,
      fileType: 'image',
    })) {
      dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
        item.id === shotId
          ? {
            ...item,
            imageGenRunId: finalSnapshot.runId,
            imageGenStatus: 'completed',
            imageGenMessage: undefined,
          }
          : item
      )));
      return;
    }

    const finalErrorMessage = finalTask.error ?? '当前镜头出图失败';
    dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
      item.id === shotId
        ? {
          ...item,
          imageGenRunId: finalSnapshot.runId,
          imageGenStatus: 'failed',
          imageGenMessage: finalErrorMessage,
        }
        : item
    )));

    dependencies.notification.showError('AI 出图失败', finalErrorMessage);
  } catch (error) {
    if (dependencies.notification.showAuthFeedback(error, '生成分镜图片')) {
      return;
    }

    if (options?.signal?.aborted || isAbortError(error)) {
      dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
        item.id === shotId
          ? {
            ...item,
            imageGenStatus: item.imageGenStatus === 'completed' ? 'completed' : 'idle',
            imageGenMessage: undefined,
          }
          : item
      )));

      dependencies.setStoryboardGroupExecutionState(nodeId, {
        groupId: shotId,
        groupOrder: persistedShot.order,
        taskRecordId: null,
        aiTaskId: null,
        nodeType: 'aiStoryboard',
        status: 'cancelled',
        progress: 0,
        message: '已取消',
        error: undefined,
      });

      dependencies.notification.showInfo('AI 出图已取消', `镜头 ${persistedShot.order} 已取消 AI 出图。`);
      return;
    }

    const errorMessage = getActionErrorMessage(error, '单镜头 AI 出图失败，请稍后重试。');
    dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
      item.id === shotId
        ? {
          ...item,
          imageGenStatus: 'failed',
          imageGenMessage: errorMessage,
        }
        : item
    )));

    dependencies.setStoryboardGroupExecutionState(nodeId, {
      groupId: shotId,
      groupOrder: persistedShot.order,
      taskRecordId: null,
      aiTaskId: null,
      nodeType: 'aiStoryboard',
      status: 'failed',
      progress: 0,
      message: '执行失败',
      error: errorMessage,
    });

    dependencies.notification.showError('AI 出图失败', errorMessage);
  }
}
