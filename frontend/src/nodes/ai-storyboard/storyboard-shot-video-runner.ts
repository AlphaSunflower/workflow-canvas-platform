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
  BackendExecutionSummary,
  CreateBackendExecutionRequest,
} from '@/services/backendExecutionService';
import {
  AI_VIDEO_GEN_DEFAULT_MODEL,
  normalizeAIVideoGenModel,
  normalizeAIVideoGenParameters,
} from '@/nodes/ai-video-gen/constants';
import type { AIVideoGenSupportedModel } from '@/nodes/ai-video-gen/constants';
import { getExecutionErrorUserMessage } from '@/constants/executionMessages';
import { createRetryDecision } from '@/utils';
import { isTimeoutLikeError, sleepWithAbort } from '@/utils/common/retry-policy';
import { getStoryboardShotVideoUnavailableReason } from './shot-video-execution';
import {
  createStoryboardShotExecutionPayload,
  getStoryboardShots,
  mergeStoryboardNodeTaskRefs,
  resolveStoryboardExecutionReferenceFileIds,
} from './storyboard-execution-service';
import { getAIStoryboardInputHandle } from './groups';
import type { StoryboardShotConnectedImage } from './types';
import type { StoryboardExecutionNotifications } from './storyboard-shot-image-runner';

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

export interface StoryboardVideoRunnerDependencies {
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
  logWarn: (
    event: string,
    message: string,
    context: Record<string, unknown>,
  ) => void;
  sleepWithAbort?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  notification: StoryboardExecutionNotifications;
}

export async function runStoryboardShotVideo(
  nodeId: string,
  shotId: string,
  dependencies: StoryboardVideoRunnerDependencies,
  options?: {
    signal?: AbortSignal;
    suppressNotifications?: boolean;
  },
): Promise<void> {
  const notifyInfo = (title: string, message: string): void => {
    if (!options?.suppressNotifications) {
      dependencies.notification.showInfo(title, message);
    }
  };
  const notifySuccess = (title: string, message: string): void => {
    if (!options?.suppressNotifications) {
      dependencies.notification.showSuccess(title, message);
    }
  };
  const notifyError = (title: string, message: string): void => {
    if (!options?.suppressNotifications) {
      dependencies.notification.showError(title, message);
    }
  };
  const getLatestStoryboardShot = (): StoryboardShotData | null => {
    const latestWorkflow = dependencies.getCurrentWorkflow();
    if (!latestWorkflow) {
      return null;
    }

    const latestNode = latestWorkflow.nodes[nodeId];
    if (!latestNode || !isAINodeData(latestNode) || latestNode.type !== 'aiStoryboard') {
      return null;
    }

    return getStoryboardShots(latestNode).find((item) => item.id === shotId) ?? null;
  };

  const node = dependencies.getNodeById(nodeId);

  if (!node || !isAINodeData(node) || node.type !== 'aiStoryboard') {
    dependencies.notification.showWarning('生成视频不可用', '当前节点不是 AI 分镜表节点。');
    return;
  }

  const authError = requireAuthenticatedAction(dependencies.auth, { actionLabel: '生成分镜视频' });
  if (authError) {
    dependencies.notification.showWarning('需要登录', authError.message);
    return;
  }

  const activeWorkflow = dependencies.getCurrentWorkflow();
  if (!activeWorkflow) {
    dependencies.notification.showWarning('生成视频不可用', '当前画布未就绪，暂时无法执行单镜头视频生成。');
    return;
  }

  const shot = getStoryboardShots(node).find((item) => item.id === shotId);
  if (!shot) {
    dependencies.notification.showWarning('生成视频不可用', '当前镜头不存在或已被删除。');
    return;
  }

  const prompt = typeof shot.prompt === 'string' ? shot.prompt.trim() : '';
  if (prompt.length === 0) {
    dependencies.notification.showWarning('生成视频不可用', '请先填写该镜头的运镜提示词，再执行视频生成。');
    return;
  }

  if (shot.videoGenStatus === 'generating') {
    notifyInfo('生成视频进行中', `镜头 ${shot.order} 已在执行视频生成，请等待当前请求完成。`);
    return;
  }

  const persistedWorkflow = await dependencies.ensureWorkflowPersistedForExecution();
  const persistedNode = persistedWorkflow.nodes[nodeId];
  if (!persistedNode || !isAINodeData(persistedNode) || persistedNode.type !== 'aiStoryboard') {
    dependencies.notification.showWarning('生成视频不可用', '当前节点状态已变化，无法继续执行单镜头视频生成。');
    return;
  }

  const persistedShot = getStoryboardShots(persistedNode).find((item) => item.id === shotId);
  if (!persistedShot) {
    dependencies.notification.showWarning('生成视频不可用', '当前镜头不存在或已被删除。');
    return;
  }

  const getCommittedStoryboardVideoOutput = (lookup?: {
    runId?: string | null;
    taskId?: string | null;
    resultFileId?: string | null;
  }): WorkflowNodeGroupExecutionState | null => {
    return dependencies.getCommittedStoryboardGroupState(nodeId, shotId, {
      workflowId: persistedWorkflow.id,
      runId: lookup?.runId,
      taskId: lookup?.taskId,
      resultFileId: lookup?.resultFileId,
      fileType: 'video',
    });
  };
  const hasRecoveredStoryboardVideoOutput = (lookup?: {
    runId?: string | null;
    taskId?: string | null;
    resultFileId?: string | null;
  }): boolean => getCommittedStoryboardVideoOutput(lookup) !== null;

  const sourceNode = (
    typeof persistedShot.sourceNodeId === 'string' && persistedShot.sourceNodeId.length > 0
      ? dependencies.getNodeById(persistedShot.sourceNodeId)
      : null
  );

  // Resolve connected images from per-shot input port directly from workflow connections
  const shotInputHandle = getAIStoryboardInputHandle(shotId);
  const connectedImages: StoryboardShotConnectedImage[] = [];
  const incomingConnections = persistedWorkflow.connections.filter(
    (conn) => conn.type === 'file-reference'
      && conn.targetId === nodeId
      && conn.targetHandle === shotInputHandle,
  );
  for (let i = 0; i < incomingConnections.length; i++) {
    const conn = incomingConnections[i];
    const connSourceNode = dependencies.getNodeById(conn.sourceId);
    if (connSourceNode && isFileNodeData(connSourceNode) && connSourceNode.type === 'image') {
      connectedImages.push({
        sourceNodeId: connSourceNode.id.value,
        sourceFileId: connSourceNode.fileId,
        sourceNode: connSourceNode,
        fileName: connSourceNode.fileName,
        order: i,
      });
    }
  }

  const { referenceFileIds: normalizedReferenceFileIds, unavailableReason } = await resolveStoryboardExecutionReferenceFileIds({
    shot: persistedShot,
    sourceNode: sourceNode && isFileNodeData(sourceNode) && sourceNode.type === 'image'
      ? sourceNode
      : null,
    connectedImages,
    signal: options?.signal,
    maxReferences: 4,
    ensureBackendFileId: dependencies.ensureBackendFileId,
    workflowId: persistedWorkflow.id,
  });

  if (normalizedReferenceFileIds.length === 0) {
    const reason = getStoryboardShotVideoUnavailableReason(persistedShot, connectedImages)
      ?? unavailableReason
      ?? '当前镜头缺少可用参考图，无法执行视频生成。';
    dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
      item.id === shotId
        ? {
          ...item,
          videoGenStatus: 'idle',
          videoProgress: undefined,
          videoError: reason,
        }
        : item
    )));
    dependencies.notification.showWarning('生成视频不可用', reason);
    return;
  }

  if (options?.signal?.aborted) {
    notifyInfo('生成视频已取消', `镜头 ${persistedShot.order} 已取消视频生成。`);
    return;
  }

  const resolvedVideoModel = (
    normalizeAIVideoGenModel(persistedShot.videoModel) ?? AI_VIDEO_GEN_DEFAULT_MODEL
  ) as AIVideoGenSupportedModel;
  const resolvedVideoParameters = normalizeAIVideoGenParameters({
    aspectRatio: persistedShot.videoAspectRatio,
    resolution: persistedShot.videoResolution,
    duration: persistedShot.videoDuration,
  });

  const runVideoAttempt = async (attemptNo: number): Promise<void> => {
    dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
      item.id === shotId
        ? {
          ...item,
          videoGenStatus: 'generating',
          videoProgress: attemptNo > 1 ? 1 : 0,
          videoError: attemptNo > 1
            ? `正在重试第 ${attemptNo} 次视频生成`
            : undefined,
        }
        : item
    )));

    dependencies.setStoryboardNodeExecutionState(nodeId, {
      nodeType: 'aiStoryboard',
      taskRecordId: null,
      aiTaskId: null,
      status: 'processing',
      progress: 5,
      message: attemptNo > 1
        ? `镜头 ${persistedShot.order} 正在重试第 ${attemptNo} 次视频生成`
        : `镜头 ${persistedShot.order} 正在创建视频生成任务`,
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
      message: attemptNo > 1 ? `第 ${attemptNo} 次尝试创建中` : '任务创建中',
      error: undefined,
      lastErrorCode: null,
    });

    const storyboardVideoExecutionPayload = createStoryboardShotExecutionPayload(
      persistedNode,
      dependencies.getNodeNameById(nodeId),
      persistedShot,
      'video',
    );
    const execution = await dependencies.createGroupedExecution({
      workflowId: persistedWorkflow.id,
      nodeType: 'aiStoryboard',
      taskType: 'video-gen',
      executionMode: 'node-action-only',
      nodeId,
      nodeTitle: dependencies.getNodeNameById(nodeId),
      prompt,
      model: resolvedVideoModel,
      duration: resolvedVideoParameters.duration,
      aspectRatio: resolvedVideoParameters.aspectRatio,
      resolution: resolvedVideoParameters.resolution,
      size: resolvedVideoParameters.size,
      groups: [{
        groupId: shotId,
        referenceFileIds: normalizedReferenceFileIds,
      }],
    }, options?.signal);

    const task = execution.tasks.find((item) => item.groupId === shotId) ?? execution.tasks[0];
    if (task) {
      const processingTaskRef = createExecutionTaskRef(persistedNode, {
        taskId: task.taskId,
        taskNo: task.taskNo,
        batchId: execution.runNo,
        runId: execution.runId,
        runNo: execution.runNo,
        taskType: 'video-gen',
        projectId: persistedWorkflow.projectId,
        workflowId: persistedWorkflow.id,
        scope: 'group',
        groupId: shotId,
        groupLabel: storyboardVideoExecutionPayload.targets[0]?.groupLabel,
        groupOrder: storyboardVideoExecutionPayload.targets[0]?.groupOrder ?? persistedShot.order,
        outputHandle: storyboardVideoExecutionPayload.targets[0]?.outputHandle,
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
      message: `镜头 ${persistedShot.order} 已进入视频生成队列`,
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
      message: attemptNo > 1 ? `第 ${attemptNo} 次尝试已入队` : '已入队',
      error: undefined,
      lastErrorCode: null,
    });

    dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
      item.id === shotId
        ? {
          ...item,
          videoRunId: execution.runId,
          videoGenStatus: 'generating',
          videoProgress: 10,
          videoError: undefined,
        }
        : item
    )));

    let lastPendingCommit: Promise<void> | undefined;
    let observedResultFileId: string | undefined;

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

        if (typeof snapshotTask.resultFileId === 'string' && snapshotTask.resultFileId.length > 0) {
          observedResultFileId = snapshotTask.resultFileId;
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

        dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
          item.id === shotId
            ? {
              ...item,
              videoProgress: typeof snapshotTask.progress === 'number'
                ? snapshotTask.progress
                : item.videoProgress,
              videoGenStatus: 'generating' as const,
              videoError: snapshotTask.error ?? undefined,
            }
            : item
        )));

        lastPendingCommit = dependencies.commitBackendExecutionOutputs(
          persistedNode,
          snapshot,
          dependencies.createOutputCommitInput(
            storyboardVideoExecutionPayload,
            dependencies.buildExecutionRuntimeAdapterContext(persistedNode, options?.signal),
          ),
        );

        // Note: Don't set videoGenStatus/videoFileId here to avoid race condition
        // with commitBackendExecutionOutputs. The final state is set in the
        // post-polling success path below.
      },
    });

    if (lastPendingCommit) {
      await lastPendingCommit;
    }

    const finalTask = finalSnapshot.tasks.find((item) => item.groupId === shotId) ?? finalSnapshot.tasks[0];
    if (!finalTask) {
      throw new Error('未获取到当前镜头的视频执行结果。');
    }

    if (finalTask.status === 'completed' && typeof finalTask.resultFileId === 'string') {
      await dependencies.commitBackendExecutionOutputs(
        persistedNode,
        finalSnapshot,
        dependencies.createOutputCommitInput(
          storyboardVideoExecutionPayload,
          dependencies.buildExecutionRuntimeAdapterContext(persistedNode, options?.signal),
        ),
      );

      // Only write videoFileId to shot if it has an imageFileId (preview exists)
      // Otherwise, the video output node will be connected via output-link
      const hasImagePreview = typeof persistedShot.imageFileId === 'string' && persistedShot.imageFileId.trim().length > 0;

      dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
        item.id === shotId
          ? {
            ...item,
            videoRunId: finalSnapshot.runId,
            videoGenStatus: 'completed' as const,
            videoProgress: 100,
            videoError: undefined,
            ...(hasImagePreview ? { videoFileId: finalTask.resultFileId ?? undefined } : {}),
          }
          : item
      )));

      notifySuccess('生成视频完成', `镜头 ${persistedShot.order} 已生成视频。`);
      return;
    }

    if (finalTask.status === 'completed') {
      const committedState = dependencies.getCommittedStoryboardGroupState(nodeId, shotId, {
        workflowId: persistedWorkflow.id,
        runId: finalSnapshot.runId,
        taskId: finalTask.taskId,
        fileType: 'video',
      });
      if (committedState) {
        // Only write videoFileId to shot if it has an imageFileId (preview exists)
        const hasImagePreview = typeof persistedShot.imageFileId === 'string' && persistedShot.imageFileId.trim().length > 0;

        dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
          item.id === shotId
            ? {
              ...item,
              videoRunId: finalSnapshot.runId,
              videoGenStatus: 'completed',
              videoProgress: 100,
              videoError: undefined,
              ...(hasImagePreview && typeof committedState.resultFileId === 'string' ? { videoFileId: committedState.resultFileId } : {}),
            }
            : item
        )));
        notifySuccess('生成视频完成', `镜头 ${persistedShot.order} 已生成视频。`);
        return;
      }
    }

    // Recovery: if we observed a resultFileId during polling (worker set it before crashing),
    // treat the task as completed even though the backend task status is still 'processing'.
    if (typeof observedResultFileId === 'string' && observedResultFileId.length > 0) {
      // Only write videoFileId to shot if it has an imageFileId (preview exists)
      const hasImagePreview = typeof persistedShot.imageFileId === 'string' && persistedShot.imageFileId.trim().length > 0;

      dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
        item.id === shotId
          ? {
            ...item,
            videoRunId: finalSnapshot.runId,
            videoGenStatus: 'completed',
            videoProgress: 100,
            videoError: undefined,
            ...(hasImagePreview ? { videoFileId: observedResultFileId } : {}),
          }
          : item
      )));
      notifySuccess('生成视频完成', `镜头 ${persistedShot.order} 已生成视频。`);
      return;
    }

    const finalErrorMessage = getExecutionErrorUserMessage(
      finalTask.errorCode,
      finalTask.error ?? '当前镜头视频生成失败',
    ) ?? finalTask.error ?? '当前镜头视频生成失败';

    const terminalError = new Error(finalErrorMessage) as Error & { code?: string };
    terminalError.code = finalTask.errorCode ?? 'AI_TASK_ERROR';
    throw terminalError;
  };

  const retryDelays = [15000, 30000] as const;
  const retryPolicy = {
    maxAttempts: retryDelays.length + 1,
    delaysMs: retryDelays,
  } as const;

  try {
    notifyInfo('生成视频开始', `镜头 ${persistedShot.order} 已提交到真实后端执行。`);

    for (let attemptNo = 1; attemptNo <= retryDelays.length + 1; attemptNo += 1) {
      try {
        await runVideoAttempt(attemptNo);
        return;
      } catch (error) {
        if (options?.signal?.aborted || isAbortError(error)) {
          dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
            item.id === shotId
              ? {
                ...item,
                videoGenStatus: item.videoGenStatus === 'completed' ? 'completed' : 'idle',
                videoProgress: item.videoGenStatus === 'completed' ? 100 : undefined,
                videoError: undefined,
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

          notifyInfo('生成视频已取消', `镜头 ${persistedShot.order} 已取消视频生成。`);
          return;
        }

        const errorMessage = getActionErrorMessage(error, '单镜头视频生成失败，请稍后重试。');
        const timeoutLike = isTimeoutLikeError(error);
        const retryDecision = createRetryDecision({
          policy: retryPolicy,
          attemptNo,
          failureKind: options?.signal?.aborted || isAbortError(error)
            ? 'abort'
            : timeoutLike
              ? 'timeout'
              : 'fatal',
        });
        const canRetry = attemptNo <= retryDelays.length;
        if (timeoutLike) {
          dependencies.logWarn(
            'generateStoryboardShotVideo',
            'Retrying timeout-like storyboard video failure',
            {
              nodeId,
              shotId,
              attemptNo,
              maxAttempts: retryPolicy.maxAttempts,
              delayMs: retryDecision.delayMs,
              failureKind: retryDecision.failureKind,
            },
          );
        }

        if (canRetry && retryDecision.retry) {
          const delayMs = retryDecision.delayMs ?? retryDelays[attemptNo - 1];
          dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
            item.id === shotId
              ? {
                ...item,
                videoGenStatus: 'generating',
                videoProgress: item.videoProgress ?? 0,
                videoError: `第 ${attemptNo} 次尝试失败，${Math.round(delayMs / 1000)} 秒后自动重试`,
              }
              : item
          )));

          dependencies.setStoryboardGroupExecutionState(nodeId, {
            groupId: shotId,
            groupOrder: persistedShot.order,
            taskRecordId: null,
            aiTaskId: null,
            nodeType: 'aiStoryboard',
            status: 'processing',
            progress: 0,
            message: `第 ${attemptNo} 次尝试失败，等待自动重试`,
            error: errorMessage,
          });

          await (dependencies.sleepWithAbort ?? sleepWithAbort)(delayMs, options?.signal);
          if (hasRecoveredStoryboardVideoOutput()) {
            const recoveredShot = getLatestStoryboardShot();
            const committedGroup = getCommittedStoryboardVideoOutput();
            if (recoveredShot && committedGroup?.resultFileId) {
              dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
                item.id === shotId
                  ? {
                    ...item,
                    videoRunId: recoveredShot.videoRunId ?? item.videoRunId,
                    videoGenStatus: 'completed',
                    videoProgress: 100,
                    videoError: undefined,
                  }
                  : item
              )));

              dependencies.setStoryboardGroupExecutionState(nodeId, {
                groupId: shotId,
                groupOrder: recoveredShot.order,
                taskRecordId: null,
                aiTaskId: null,
                nodeType: 'aiStoryboard',
                status: 'completed',
                progress: 100,
                message: 'Recovered video output from reconcile',
                error: undefined,
                lastErrorCode: null,
                resultFileId: committedGroup.resultFileId,
              });
            }
            return;
          }
          continue;
        }

        dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
          item.id === shotId
            ? {
              ...item,
              videoGenStatus: 'failed',
              videoProgress: undefined,
              videoError: errorMessage,
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

        notifyError('生成视频失败', errorMessage);
        return;
      }
    }
  } catch (error) {
    if (dependencies.notification.showAuthFeedback(error, '生成分镜视频')) {
      return;
    }

    if (options?.signal?.aborted || isAbortError(error)) {
      dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
        item.id === shotId
          ? {
            ...item,
            videoGenStatus: item.videoGenStatus === 'completed' ? 'completed' : 'idle',
            videoProgress: item.videoGenStatus === 'completed' ? 100 : undefined,
            videoError: undefined,
          }
          : item
      )));

      notifyInfo('生成视频已取消', `镜头 ${persistedShot.order} 已取消视频生成。`);
      return;
    }

    const errorMessage = getActionErrorMessage(error, '单镜头视频生成失败，请稍后重试。');
    dependencies.patchStoryboardShotState(nodeId, shotId, (shots) => shots.map((item) => (
      item.id === shotId
        ? {
          ...item,
          videoGenStatus: 'failed',
          videoProgress: undefined,
          videoError: errorMessage,
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

    notifyError('生成视频失败', errorMessage);
  }
}
