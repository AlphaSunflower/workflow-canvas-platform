import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { MutableRefObject } from 'react';
import type { AuthContextValue } from '@/auth';
import { requireAuthenticatedAction } from '@/auth';
import { aiApi, aiPromptApi, fileApi } from '@/api';
import type {
  PatchNodeConfigOptions,
  RunNodeActionParams,
} from '@/contracts/node-actions';
import type {
  WorkflowAIExecutionState,
  WorkflowNodeGroupExecutionState,
} from '@/contracts/execution';
import type {
  WorkflowRuntimeSnapshot,
  WorkflowContextSelectors,
} from '@/components/context/workflow-context.types';
import type {
  AINodeData,
  AITask,
  AITaskType,
  AIStreamChunk,
  AnyNodeData,
  AppError,
  CreateAITaskRequest,
  ExecutionTaskRef,
  FileInfo,
  FileNodeData,
  NodeTaskRef,
  Workflow,
  WorkflowRelatedTaskRef,
} from '@/types';
import { createGroupedExecutionOutputAdapter } from '@/execution-runtime/execution-output-commit.adapters';
import { executionOutputCommitService } from '@/execution-runtime/execution-output-commit.service';
import type { ExecutionOutputCommitWorkflowInput } from '@/execution-runtime/execution-output-commit.types';
import { executionPollingManager } from '@/execution-runtime/execution-polling-manager';
import { executionRuntimeStore } from '@/execution-runtime/execution-runtime.store';
import { getExecutionRuntimeNodeAdapter } from '@/execution-runtime/node-execution-adapter.registry';
import type { ExecutionRuntimeNodeAdapterContext } from '@/execution-runtime/node-execution-adapter.types';
import type { ExecutionRuntimeRunState } from '@/execution-runtime/execution-runtime.types';
import {
  canReconcileWorkflowExecutions,
  getLocallyIncompleteReconcileExecutionNodeIds,
  getLocallyIncompleteReconcileExecutionNodes,
  reconcileExecutionOutputs,
  shouldReconcileNodeOutputs,
} from '@/execution-runtime/execution-output-reconcile.service';
import {
  createLegacyGroupedExecutionOutputCommitInput,
  createPayloadExecutionOutputCommitInput,
  resolveWorkflowExecutionOutputCommitRequest,
} from '@/execution-runtime/execution-output-commit.workflow';
import { getExecutionErrorUserMessage, formatExecutionErrorMessage } from '@/constants/executionMessages';
import {
  getNodeDefinition,
} from '@/nodes/registry';
import {
  appendMockExecutionOutputs,
  appendResolvedTaskOutputs,
  buildMockExecutionContext,
  createGroupedExecutionContext,
  createRuntimeOutputSnapshot,
  isGroupedTaskExecutionAdapter,
  isMockExecutionAdapter,
  isSingleTaskExecutionAdapter,
  resolveConnectedOutputGroups,
  resolveGroupedExecutionGroups,
} from '@/nodes/shared/runtime';
import type { MockOutputDescriptor } from '@/nodes/types';
import { runNodeAction as runRegisteredNodeAction } from '@/nodes/shared/node-actions';
import type { SharedNodeActionServices } from '@/nodes/shared/node-action-service-registry';
import {
  createNodeOutputFileSource,
  normalizeTaskResultFileInfo,
  normalizeTaskResultFileInfos,
} from '@/nodes/shared/task-result-normalizer';
import { patchNodeConfigInWorkflow } from '@/nodes/shared/node-config-updater';
import {
  assertExecutionFilesReady,
  ensureExecutionFilesReady,
} from '@/services/execution-file-readiness';
import { backendExecutionService } from '@/services/backendExecutionService';
import type { BackendExecutionSummary } from '@/services/backendExecutionService';
import { backendFileService } from '@/services/backendFileService';
import { executionOutputRuntimeSyncService } from '@/services/execution-output-runtime-sync';
import {
  getPersistedWorkflowId,
} from '@/services/workflow-session';
import { buildAIFloorplanColorizeBackendGroupPayload } from '@/nodes/ai-floorplan-colorize/runtime';
import { AI_IMAGE_HD_INPUT_PORT_ID } from '@/nodes/ai-image-hd/constants';
import { AI_FLOORPLAN_COLORIZE_INPUT_PORT_ID } from '@/nodes/ai-floorplan-colorize/constants';
import { AI_IMAGE_INPUT_PORT_ID } from '@/nodes/ai-image-gen/groups';
import {
  createModuleLogger,
  isAINodeData,
  isFileNodeData,
} from '@/utils';
import { normalizeWorkflowRelatedTasks } from '@/utils/workflow/snapshot-links';
import {
  buildExecutionTaskNodeRef,
  toNodeTaskRef,
} from '@/utils/workflow/task-batch';

const log = createModuleLogger('workflow-execution-coordinator');

const unreconcilableWorkflowIdsSession = new Set<string>();
const pendingExecutionReconcileKeysSession = new Set<string>();
const executionReconcileCooldownUntilSession = new Map<string, number>();
const executionReconcileVerifiedCleanSession = new Map<string, {
  workflowVersion: number;
  verifiedAt: number;
}>();
const EXECUTION_RECONCILE_SUCCESS_COOLDOWN_MS = 30_000;
const EXECUTION_RECONCILE_FAILURE_COOLDOWN_MS = 60_000;
const EXECUTION_RECONCILE_VERIFIED_CLEAN_TTL_MS = 120_000;

function shouldSkipReconcileAttempt(params: {
  workflowId: string;
  nodeId: string;
  workflowVersion: number;
  now?: number;
}): boolean {
  const reconcileKey = `${params.workflowId}:${params.nodeId}`;
  const now = params.now ?? Date.now();
  const verifiedCleanEntry = executionReconcileVerifiedCleanSession.get(reconcileKey);
  if (
    verifiedCleanEntry
    && verifiedCleanEntry.workflowVersion === params.workflowVersion
    && now - verifiedCleanEntry.verifiedAt <= EXECUTION_RECONCILE_VERIFIED_CLEAN_TTL_MS
  ) {
    return true;
  }

  const cooldownUntil = executionReconcileCooldownUntilSession.get(reconcileKey) ?? 0;
  if (cooldownUntil > now) {
    return true;
  }

  return pendingExecutionReconcileKeysSession.has(reconcileKey);
}

function markReconcileAttemptStarted(params: {
  workflowId: string;
  nodeId: string;
  now?: number;
}): void {
  const reconcileKey = `${params.workflowId}:${params.nodeId}`;
  const now = params.now ?? Date.now();
  pendingExecutionReconcileKeysSession.add(reconcileKey);
  executionReconcileCooldownUntilSession.set(
    reconcileKey,
    now + EXECUTION_RECONCILE_SUCCESS_COOLDOWN_MS,
  );
}

function markReconcileAttemptFailed(params: {
  workflowId: string;
  nodeId: string;
  now?: number;
}): void {
  const reconcileKey = `${params.workflowId}:${params.nodeId}`;
  executionReconcileCooldownUntilSession.set(
    reconcileKey,
    (params.now ?? Date.now()) + EXECUTION_RECONCILE_FAILURE_COOLDOWN_MS,
  );
}

function markReconcileAttemptFinished(params: {
  workflowId: string;
  nodeId: string;
}): void {
  pendingExecutionReconcileKeysSession.delete(`${params.workflowId}:${params.nodeId}`);
}

export function clearWorkflowExecutionReconcileState(workflowId?: string | null): void {
  if (!workflowId) {
    return;
  }

  unreconcilableWorkflowIdsSession.delete(workflowId);
  Array.from(pendingExecutionReconcileKeysSession)
    .filter((key) => key.startsWith(`${workflowId}:`))
    .forEach((key) => pendingExecutionReconcileKeysSession.delete(key));
  Array.from(executionReconcileCooldownUntilSession.keys())
    .filter((key) => key.startsWith(`${workflowId}:`))
    .forEach((key) => executionReconcileCooldownUntilSession.delete(key));
  Array.from(executionReconcileVerifiedCleanSession.keys())
    .filter((key) => key.startsWith(`${workflowId}:`))
    .forEach((key) => executionReconcileVerifiedCleanSession.delete(key));
}

export const __testOnly = {
  shouldSkipReconcileAttempt,
  markReconcileAttemptStarted,
  markReconcileAttemptFailed,
  markReconcileAttemptFinished,
  isRecoverableExecutionReconcileMiss,
};

interface WorkflowExecutionCoordinatorDependencies {
  auth: AuthContextValue;
  workflow: {
    workflow: Workflow | null;
    persistedWorkflowId: string | null;
  };
  workflowRef: MutableRefObject<Workflow | null>;
  nodeMap: Map<string, AnyNodeData>;
  selectors: Pick<
    WorkflowContextSelectors,
    | 'getNodeById'
    | 'getConnectedFileInputs'
    | 'getNodeDisplayName'
    | 'getNodeInputGroups'
    | 'getNodeInputSummary'
    | 'getNodeTasks'
    | 'getResolvedNodeGroupPortInputs'
    | 'getResolvedNodeInputGroups'
  >;
  applyRuntimeSnapshot: (
    runtimeSnapshot: WorkflowRuntimeSnapshot,
    options?: {
      hydrateCanvas?: boolean;
      hydrationReason?: 'external-output' | 'workflow-load' | 'canvas-reset';
    },
  ) => Workflow | null;
  ensureWorkflowPersistedForExecution: () => Promise<Workflow>;
  patchCurrentWorkflow: (updater: (workflow: Workflow) => Workflow) => Workflow | null;
  showAuthFeedback: (error: unknown, actionLabel: string) => boolean;
  showError: (title: string, message: string) => void;
  showInfo: (title: string, message: string) => void;
  showSuccess: (title: string, message: string) => void;
  showWarning: (title: string, message: string) => void;
}

export interface WorkflowExecutionCoordinator {
  canRunNode: (nodeId: string) => boolean;
  patchNodeConfig: <TConfig extends AINodeData['config']>(
    nodeId: string,
    updater: (config: TConfig, node: AINodeData) => Partial<TConfig> | null,
    options?: PatchNodeConfigOptions,
  ) => Workflow | null;
  optimizeAIImageGenPrompt: (
    nodeId: string,
    options?: {
      signal?: AbortSignal;
      prompt?: string;
    },
  ) => Promise<void>;
  runNodeAction: (params: RunNodeActionParams) => Promise<void>;
  runAINode: (nodeId: string) => Promise<void>;
  cancelAINodeRun: (nodeId: string) => Promise<void>;
  hasAnyActiveExecution: (workflowId?: string | null) => boolean;
  hasActiveNodeExecution: boolean;
  resetRuntimeExecutionState: () => void;
}

function isAppError(error: unknown): error is AppError {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && 'message' in error,
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isRecoverableExecutionReconcileMiss(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  const code = isAppError(error) ? error.code : '';

  return code === 'RUN_NOT_FOUND' ||
    message === 'RUN_NOT_FOUND' ||
    message === 'Execution run not found.';
}

function getActionErrorMessage(error: unknown, fallback: string): string {
  if (isAppError(error)) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

function getChunkMessage(chunk: AIStreamChunk): string | null {
  if (typeof chunk.content === 'string') {
    return chunk.content;
  }

  if (typeof chunk.content === 'number') {
    return `${chunk.content}`;
  }

  return null;
}

function buildTaskPayload(params: {
  taskRef?: ExecutionTaskRef;
  nodeId: string;
  projectId: string;
  workflowId?: string;
  workflowVersion?: number;
  nodeType?: AINodeData['type'];
  type: AITaskType;
  provider: AITask['provider'];
  model?: AITask['model'];
  files: string[];
  references: string[];
  fileBindings?: AITask['input']['fileBindings'];
  config: AINodeData['config'];
  prompt?: string;
  negativePrompt?: string;
  groupId?: string;
  groupLabel?: string;
  groupOrder?: number;
  outputHandle?: string;
  idempotencyKey?: string;
}): CreateAITaskRequest {
  return {
    type: params.type,
    provider: params.provider,
    model: params.model,
    nodeId: params.nodeId,
    projectId: params.projectId,
    input: {
      files: params.files,
      references: params.references,
      config: params.config,
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      fileBindings: params.fileBindings,
      execution: {
        scope: params.groupId ? 'group' : 'node',
        workflowId: params.workflowId,
        workflowVersion: params.workflowVersion,
        nodeType: params.nodeType,
        nodeDisplayId: params.taskRef?.node.nodeDisplayId,
        taskRecordId: params.taskRef?.taskId,
        taskNo: params.taskRef?.taskNo,
        batchId: params.taskRef?.batchId,
        runId: params.taskRef?.runId,
        runNo: params.taskRef?.runNo,
        groupId: params.groupId,
        groupLabel: params.groupLabel,
        groupOrder: params.groupOrder,
        outputHandle: params.outputHandle,
        idempotencyKey: params.idempotencyKey,
      },
    },
    idempotencyKey: params.idempotencyKey,
  };
}

function remapOriginalFileIds(
  fileIds: string[],
  fileBindings: Record<string, string> | undefined,
): string[] {
  if (!fileBindings) {
    return fileIds;
  }

  return fileIds.map((fileId) => fileBindings[fileId] ?? fileId);
}

function buildExecutionState(task: AITask): WorkflowAIExecutionState {
  return {
    taskRecordId: task.input.execution?.taskRecordId ?? null,
    aiTaskId: task.id,
    taskNo: task.input.execution?.taskNo,
    batchId: task.input.execution?.batchId,
    status: task.status,
    progress: task.progress,
    message: null,
    output: task.output,
    error: task.error?.message,
  };
}

function reduceExecutionEvent(
  task: AITask,
  chunk?: AIStreamChunk,
  previousState?: WorkflowAIExecutionState,
): {
  task: AITask;
  chunk?: AIStreamChunk;
  state: Pick<WorkflowAIExecutionState, 'status' | 'progress' | 'message' | 'output' | 'error'>;
} {
  const nextState = {
    status: task.status,
    progress: typeof chunk?.content === 'number' && chunk.type === 'progress'
      ? chunk.content
      : previousState?.progress ?? task.progress,
    message: chunk ? getChunkMessage(chunk) : previousState?.message ?? null,
    output: previousState?.output ?? task.output,
    error: previousState?.error ?? task.error?.message,
  };

  if (chunk?.type === 'file' || chunk?.type === 'metadata' || chunk?.type === 'done') {
    nextState.output = task.output;
  }

  if (chunk?.type === 'error') {
    nextState.status = 'failed';
    nextState.error = getChunkMessage(chunk) ?? 'AI task failed';
  }

  return {
    task,
    chunk,
    state: nextState,
  };
}

function createSkippedGroupExecutionState(
  groupId: string,
  error: string,
): WorkflowNodeGroupExecutionState {
  return {
    groupId,
    taskRecordId: null,
    aiTaskId: null,
    status: 'skipped',
    progress: 0,
    message: null,
    error,
  };
}

function createGroupExecutionState(
  groupId: string,
  task: AITask,
): WorkflowNodeGroupExecutionState {
  return {
    groupId,
    taskRecordId: task.input.execution?.taskRecordId ?? null,
    aiTaskId: task.id,
    taskNo: task.input.execution?.taskNo,
    batchId: task.input.execution?.batchId,
    status: task.status,
    progress: task.progress,
    message: null,
    output: task.output,
    error: task.error?.message,
  };
}

function reduceGroupExecutionEvent(
  groupId: string,
  task: AITask,
  chunk?: AIStreamChunk,
  previousState?: WorkflowNodeGroupExecutionState,
): WorkflowNodeGroupExecutionState {
  const nextState = reduceExecutionEvent(task, chunk, previousState
    ? {
      taskRecordId: previousState.taskRecordId,
      aiTaskId: previousState.aiTaskId,
      status: previousState.status === 'skipped' ? null : previousState.status,
      progress: previousState.progress,
      message: previousState.message,
      output: previousState.output,
      error: previousState.error,
    }
    : undefined);

  return {
    groupId,
    taskRecordId: task.input.execution?.taskRecordId ?? previousState?.taskRecordId ?? null,
    aiTaskId: nextState.task.id,
    taskNo: task.input.execution?.taskNo ?? previousState?.taskNo,
    batchId: task.input.execution?.batchId ?? previousState?.batchId,
    status: nextState.state.status,
    progress: nextState.state.progress,
    message: nextState.state.message,
    output: nextState.state.output,
    error: nextState.state.error,
  };
}

function isActiveTaskStatus(status: AITask['status'] | 'skipped' | null | undefined): boolean {
  return status === 'queued' || status === 'processing';
}

function isTerminalTaskStatus(status: AITask['status'] | null | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function isExecutionRuntimeGroupedNode(node: AINodeData): boolean {
  return node.type === 'aiModelRenderTransfer'
    || node.type === 'aiImageGen'
    || node.type === 'aiImageInpaint'
    || node.type === 'aiImageToPly'
    || node.type === 'aiMultiViewRestore'
    || node.type === 'aiVideoGen';
}

function isBackendGroupedExecutionNode(node: AINodeData): boolean {
  return node.type === 'aiImageHd'
    || node.type === 'aiFloorplanColorize';
}

function mergeTaskWithChunk(task: AITask, chunk: AIStreamChunk): AITask {
  const nextStatus: AITask['status'] = (() : AITask['status'] => {
    switch (chunk.type) {
      case 'done':
        return 'completed';
      case 'error':
        return 'failed';
      case 'progress':
      case 'text':
      case 'file':
      case 'metadata':
        return 'processing';
      default:
        return task.status;
    }
  })();

  const nextProgress = (() : number => {
    if (chunk.type === 'progress' && typeof chunk.content === 'number') {
      return Math.max(0, Math.min(100, chunk.content));
    }

    if (chunk.type === 'done') {
      return 100;
    }

    return task.progress;
  })();

  const nextTask: AITask = {
    ...task,
    status: nextStatus,
    progress: nextProgress,
    timestamp: {
      ...task.timestamp,
      updated: chunk.timestamp,
    },
  };

  if (chunk.type === 'error') {
    nextTask.error = {
      code: task.error?.code ?? 'TASK_ERROR',
      message: getChunkMessage(chunk) ?? task.error?.message ?? 'AI task failed.',
      retryable: task.error?.retryable ?? true,
      details: task.error?.details,
    };
  }

  return nextTask;
}

function toWorkflowRelatedTaskRef(task: ExecutionTaskRef): WorkflowRelatedTaskRef {
  return {
    taskId: task.taskId,
    taskNo: task.taskNo,
    batchId: task.batchId,
    runId: task.runId,
    runNo: task.runNo,
    taskType: task.taskType,
    nodeId: task.node.nodeId,
    nodeDisplayId: task.node.nodeDisplayId,
    nodeType: task.node.nodeType,
    groupId: task.groupId,
    groupLabel: task.groupLabel,
    groupOrder: task.groupOrder,
    outputHandle: task.outputHandle,
    createdAt: task.createdAt,
  };
}

function shouldPersistWorkflowTaskRef(task: ExecutionTaskRef): boolean {
  return typeof task.runId === 'string' && task.runId.trim().length > 0;
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

function createExecutionTaskRefFromAITask(
  node: AINodeData,
  task: AITask,
  overrides: Partial<Omit<ExecutionTaskRef, 'node'>> = {},
): ExecutionTaskRef {
  return createExecutionTaskRef(node, {
    taskId: task.id,
    taskType: task.type,
    taskNo: task.input.execution?.taskNo,
    batchId: task.input.execution?.batchId,
    runId: task.input.execution?.runId,
    runNo: task.input.execution?.runNo,
    projectId: task.projectId,
    workflowId: task.input.execution?.workflowId,
    scope: task.input.execution?.scope ?? 'node',
    groupId: task.input.execution?.groupId,
    groupLabel: task.input.execution?.groupLabel,
    groupOrder: task.input.execution?.groupOrder,
    outputHandle: task.input.execution?.outputHandle,
    status: task.status,
    createdAt: task.timestamp.created,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    ...overrides,
  });
}

function createExecutionTaskRefFromBackendSummary(
  node: AINodeData,
  workflowId: string,
  projectId: string,
  runId: string,
  runNo: string,
  task: BackendExecutionSummary['tasks'][number],
  overrides: Partial<Omit<ExecutionTaskRef, 'node'>> = {},
): ExecutionTaskRef {
  const createdAt = Date.now();
  return createExecutionTaskRef(node, {
    taskId: task.taskId,
    taskType: undefined,
    taskNo: task.taskNo,
    batchId: runNo,
    runId,
    runNo,
    projectId,
    workflowId,
    scope: 'group',
    groupId: task.groupId,
    groupOrder: task.groupOrder,
    status: task.status,
    createdAt,
    ...overrides,
  });
}

export function useWorkflowExecutionCoordinator(
  dependencies: WorkflowExecutionCoordinatorDependencies,
): WorkflowExecutionCoordinator {
  const {
    auth,
    workflow,
    workflowRef,
    nodeMap,
    selectors,
    applyRuntimeSnapshot,
    ensureWorkflowPersistedForExecution,
    patchCurrentWorkflow,
    showAuthFeedback,
    showError,
    showInfo,
    showSuccess,
    showWarning,
  } = dependencies;
  const {
    getConnectedFileInputs,
    getNodeDisplayName: getNodeNameById,
    getNodeInputGroups,
    getNodeInputSummary,
    getResolvedNodeGroupPortInputs,
    getResolvedNodeInputGroups,
  } = selectors;

  const taskUnsubscribeRef = useRef<Map<string, Set<() => void>>>(new Map());
  const activeTaskRef = useRef<Map<string, AITask>>(new Map());
  const taskCompletionResolverRef = useRef<Map<string, (task: AITask) => void>>(new Map());
  const backendExecutionAbortRef = useRef<Map<string, AbortController>>(new Map());
  const groupedExecutionOutputAdapterRef = useRef<
    ReturnType<typeof createGroupedExecutionOutputAdapter<undefined>>
  >(createGroupedExecutionOutputAdapter<undefined>());

  const hasAnyActiveExecution = useCallback((workflowId?: string | null): boolean => {
    const snapshot = executionRuntimeStore.getSnapshot();
    const targetWorkflowId = workflowId ?? workflowRef.current?.id ?? null;
    const nodeExecutionActive = Array.from(snapshot.nodesByKey.values())
      .some((execution) => execution.workflowId === targetWorkflowId && isActiveTaskStatus(execution.status));
    if (nodeExecutionActive) {
      return true;
    }

    return Array.from(snapshot.groupsByKey.values())
      .some((groupState) => groupState.workflowId === targetWorkflowId && isActiveTaskStatus(groupState.status));
  }, [workflowRef]);

  const resetRuntimeExecutionState = useCallback((): void => {
    taskUnsubscribeRef.current.forEach((unsubscribeSet) => {
      unsubscribeSet.forEach((unsubscribe) => unsubscribe());
    });
    taskUnsubscribeRef.current.clear();

    backendExecutionAbortRef.current.forEach((controller) => controller.abort());
    backendExecutionAbortRef.current.clear();

    activeTaskRef.current.clear();
    taskCompletionResolverRef.current.clear();
    executionPollingManager.stopAll();
    executionRuntimeStore.reset();
    executionOutputCommitService.reset();
    executionOutputRuntimeSyncService.clearAll();
  }, []);

  const patchNodeConfig = useCallback(<TConfig extends AINodeData['config']>(
    nodeId: string,
    updater: (config: TConfig, node: AINodeData) => Partial<TConfig> | null,
    options?: PatchNodeConfigOptions,
  ): Workflow | null => {
    const activeWorkflow = workflowRef.current;
    if (!activeWorkflow) {
      return null;
    }

    const patchResult = patchNodeConfigInWorkflow<TConfig>({
      workflow: activeWorkflow,
      nodeId,
      expectedType: options?.expectedType,
      updater,
    });

    if (!patchResult.changed) {
      return activeWorkflow;
    }

    return patchCurrentWorkflow((currentWorkflow) => (
      patchNodeConfigInWorkflow<TConfig>({
        workflow: currentWorkflow,
        nodeId,
        expectedType: options?.expectedType,
        updater,
      }).nextWorkflow
    ));
  }, [patchCurrentWorkflow, workflowRef]);

  useEffect(() => {
    const activeWorkflow = workflow.workflow;
    const persistedWorkflowId = getPersistedWorkflowId(activeWorkflow);
    if (!persistedWorkflowId || !activeWorkflow || !canReconcileWorkflowExecutions(activeWorkflow)) {
      return;
    }

    const reconcileNodeIdsKey = getLocallyIncompleteReconcileExecutionNodeIds(activeWorkflow).join(',');
    if (!reconcileNodeIdsKey || unreconcilableWorkflowIdsSession.has(persistedWorkflowId)) {
      return;
    }

    let cancelled = false;
    const reconcileAbortController = new AbortController();

    const run = async (): Promise<void> => {
      const executionNodes = getLocallyIncompleteReconcileExecutionNodes(activeWorkflow);
      const workflowVersionKey = activeWorkflow.timestamp.updated;

      for (const node of executionNodes) {
        if (cancelled) {
          return;
        }

        const reconcileKey = `${persistedWorkflowId}:${node.id.value}`;
        const now = Date.now();
        const latestWorkflow = workflowRef.current;
        const latestWorkflowVersionKey = latestWorkflow?.timestamp.updated ?? workflowVersionKey;
        if (shouldSkipReconcileAttempt({
          workflowId: persistedWorkflowId,
          nodeId: node.id.value,
          workflowVersion: latestWorkflowVersionKey,
          now,
        })) {
          continue;
        }
        markReconcileAttemptStarted({
          workflowId: persistedWorkflowId,
          nodeId: node.id.value,
          now,
        });

        try {
          const snapshot = await backendExecutionService.getLatestWorkflowNodeCompletedRun(
            persistedWorkflowId,
            node.id.value,
            reconcileAbortController.signal,
          );
          if (!snapshot) {
            executionReconcileVerifiedCleanSession.set(reconcileKey, {
              workflowVersion: latestWorkflowVersionKey ?? workflowVersionKey,
              verifiedAt: Date.now(),
            });
            continue;
          }

          const currentWorkflow = workflowRef.current;
          const latestNode = currentWorkflow?.nodes[node.id.value];
          const currentWorkflowVersionKey = currentWorkflow?.timestamp.updated ?? null;

          if (
            cancelled
            || !currentWorkflow
            || !latestNode
            || !isAINodeData(latestNode)
          ) {
            if (currentWorkflowVersionKey !== null) {
              executionReconcileVerifiedCleanSession.delete(reconcileKey);
            }
            continue;
          }

          const shouldReconcile = await shouldReconcileNodeOutputs(currentWorkflow, latestNode, snapshot, {
            resolveFileUrl: fileApi.getUrl,
          });

          if (!shouldReconcile) {
            executionReconcileVerifiedCleanSession.set(reconcileKey, {
              workflowVersion: currentWorkflowVersionKey ?? workflowVersionKey,
              verifiedAt: Date.now(),
            });
            continue;
          }

          const reconciled = await reconcileExecutionOutputs({
            workflow: currentWorkflow,
            node: latestNode,
            snapshot,
            resolveFileUrl: fileApi.getUrl,
            getCurrentWorkflow: () => workflowRef.current,
            applyRuntimeSnapshot,
          });

          if (reconciled) {
            executionReconcileVerifiedCleanSession.delete(reconcileKey);
          } else {
            executionReconcileVerifiedCleanSession.set(reconcileKey, {
              workflowVersion: currentWorkflowVersionKey ?? workflowVersionKey,
              verifiedAt: Date.now(),
            });
          }
        } catch (error) {
          markReconcileAttemptFailed({
            workflowId: persistedWorkflowId,
            nodeId: node.id.value,
          });
          const message = error instanceof Error ? error.message : '';
          const code = (
            error
            && typeof error === 'object'
            && 'code' in error
            && typeof (error as { code?: unknown }).code === 'string'
          )
            ? (error as { code: string }).code
            : '';
          if (isRecoverableExecutionReconcileMiss(error)) {
            executionReconcileVerifiedCleanSession.set(reconcileKey, {
              workflowVersion: latestWorkflowVersionKey ?? workflowVersionKey,
              verifiedAt: Date.now(),
            });
            continue;
          }

          if (
            cancelled
            || code === 'WORKFLOW_NOT_FOUND'
            || message === 'The operation was aborted.'
          ) {
            if (code === 'WORKFLOW_NOT_FOUND') {
              unreconcilableWorkflowIdsSession.add(persistedWorkflowId);
            }
            continue;
          }

          log.warn('reconcileExecutionOutputs', 'Failed to reconcile historical execution outputs', {
            workflowId: persistedWorkflowId,
            nodeId: node.id.value,
            error: message,
          });
        } finally {
          markReconcileAttemptFinished({
            workflowId: persistedWorkflowId,
            nodeId: node.id.value,
          });
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      reconcileAbortController.abort();
    };
  }, [applyRuntimeSnapshot, workflow.workflow, workflowRef]);

  const setNodeExecutionState = useCallback((nodeId: string, nextState: WorkflowAIExecutionState | null): void => {
    if (nextState) {
      executionRuntimeStore.setNodeState({
        workflowId: workflowRef.current?.id ?? nextState.workflowId ?? null,
        nodeId,
        ...nextState,
      });
    } else {
      executionRuntimeStore.removeNodeState(nodeId, workflowRef.current?.id ?? null);
    }
  }, [workflowRef]);

  const getNodeExecutionState = useCallback((nodeId: string): WorkflowAIExecutionState | null => {
    return executionRuntimeStore.getNode(nodeId, workflowRef.current?.id ?? null);
  }, [workflowRef]);

  const setNodeGroupExecutionState = useCallback((
    nodeId: string,
    groupId: string,
    nextState: WorkflowNodeGroupExecutionState | null,
  ): void => {
    if (nextState) {
      executionRuntimeStore.setGroupState({
        ...nextState,
        workflowId: workflowRef.current?.id ?? nextState.workflowId ?? null,
        nodeId,
        groupId: nextState.groupId ?? groupId,
      });
    } else {
      executionRuntimeStore.removeGroupState(nodeId, groupId, workflowRef.current?.id ?? null);
    }
  }, [workflowRef]);

  const clearNodeGroupExecutionStates = useCallback((nodeId: string): void => {
    executionRuntimeStore.clearNodeGroups(nodeId, workflowRef.current?.id ?? null);
  }, [workflowRef]);

  const getNodeGroupExecutionState = useCallback((nodeId: string, groupId: string): WorkflowNodeGroupExecutionState | null => {
    return executionRuntimeStore.getGroup(nodeId, groupId, workflowRef.current?.id ?? null);
  }, [workflowRef]);

  const getNodeGroupExecutionStates = useCallback((nodeId: string): WorkflowNodeGroupExecutionState[] => {
    return executionRuntimeStore.getNodeGroups(nodeId, workflowRef.current?.id ?? null);
  }, [workflowRef]);

  const getBackendGroupedSourceNode = useCallback((
    node: AINodeData,
    groupId: string,
  ): FileNodeData | null => {
    if (node.type === 'aiImageHd') {
      return getResolvedNodeGroupPortInputs(node.id.value, groupId, AI_IMAGE_HD_INPUT_PORT_ID)[0]?.sourceNode ?? null;
    }

    if (node.type === 'aiFloorplanColorize') {
      return getResolvedNodeGroupPortInputs(node.id.value, groupId, AI_FLOORPLAN_COLORIZE_INPUT_PORT_ID)[0]?.sourceNode ?? null;
    }

    return null;
  }, [getResolvedNodeGroupPortInputs]);

  const registerTaskSubscription = useCallback((nodeId: string, unsubscribe: () => void): void => {
    const currentSet = taskUnsubscribeRef.current.get(nodeId) ?? new Set<() => void>();
    currentSet.add(unsubscribe);
    taskUnsubscribeRef.current.set(nodeId, currentSet);
  }, []);

  const unregisterTaskSubscription = useCallback((nodeId: string, unsubscribe: () => void): void => {
    const currentSet = taskUnsubscribeRef.current.get(nodeId);
    if (!currentSet) {
      return;
    }

    currentSet.delete(unsubscribe);
    if (currentSet.size === 0) {
      taskUnsubscribeRef.current.delete(nodeId);
    }
  }, []);

  const cleanupTaskSubscription = useCallback((nodeId: string): void => {
    const unsubscribeSet = taskUnsubscribeRef.current.get(nodeId);
    if (!unsubscribeSet) {
      return;
    }

    unsubscribeSet.forEach((unsubscribe) => unsubscribe());
    taskUnsubscribeRef.current.delete(nodeId);
  }, []);

  const cleanupBackendExecution = useCallback((nodeId: string): void => {
    const controller = backendExecutionAbortRef.current.get(nodeId);
    if (!controller) {
      return;
    }

    controller.abort();
    backendExecutionAbortRef.current.delete(nodeId);
    const runId = executionRuntimeStore.getNode(nodeId, workflowRef.current?.id ?? null)?.runId;
    if (runId) {
      executionOutputCommitService.resetRun(runId, workflowRef.current?.id ?? null);
    }
  }, [workflowRef]);

  const syncTaskRefsToWorkflow = useCallback((
    nodeId: string,
    taskRefs: NodeTaskRef[],
    taskRefsForMetadata: ExecutionTaskRef[],
  ): void => {
    const activeWorkflow = workflowRef.current;
    if (!activeWorkflow) {
      return;
    }

    const targetNode = activeWorkflow.nodes[nodeId];
    if (!targetNode || !isAINodeData(targetNode)) {
      return;
    }

    const relatedTaskMap = new Map<string, WorkflowRelatedTaskRef>(
      (activeWorkflow.metadata.relatedTasks ?? []).map((task) => [task.taskId, task] as const),
    );
    taskRefsForMetadata.forEach((task) => {
      if (!shouldPersistWorkflowTaskRef(task)) {
        return;
      }

      relatedTaskMap.set(task.taskId, toWorkflowRelatedTaskRef(task));
    });

    const nextNode: AINodeData = {
      ...targetNode,
      tasks: taskRefs,
      timestamp: {
        ...targetNode.timestamp,
        updated: Date.now(),
      },
    };

    applyRuntimeSnapshot({
      nodes: {
        ...activeWorkflow.nodes,
        [nodeId]: nextNode,
      },
      connections: activeWorkflow.connections,
      viewport: activeWorkflow.viewport,
      metadata: {
        relatedTasks: normalizeWorkflowRelatedTasks(Array.from(relatedTaskMap.values())),
      },
    });
  }, [applyRuntimeSnapshot, workflowRef]);

  const resolveOutputFileInfos = useCallback(async (
    task: AITask,
    taskRef?: ExecutionTaskRef,
  ): Promise<Array<{ fileInfo: FileInfo; sourceHandle?: string; order?: number }>> => {
    const outputItems = task.output?.items?.filter((item) => item.fileInfo);
    if (Array.isArray(outputItems) && outputItems.length > 0) {
      return outputItems.map((item, index) => ({
        fileInfo: taskRef
          ? normalizeTaskResultFileInfo(item.fileInfo as FileInfo, taskRef)
          : item.fileInfo as FileInfo,
        sourceHandle: item.sourceHandle,
        order: item.order ?? index,
      }));
    }

    const directInfos = task.output?.fileInfos;
    if (Array.isArray(directInfos) && directInfos.length > 0) {
      const normalizedInfos = taskRef
        ? normalizeTaskResultFileInfos(directInfos, taskRef)
        : directInfos;

      return normalizedInfos.map((fileInfo, index) => ({
        fileInfo,
        sourceHandle: task.output?.items?.[index]?.sourceHandle ?? task.input.execution?.outputHandle,
        order: task.output?.items?.[index]?.order ?? index,
      }));
    }

    const outputFiles = task.output?.files ?? [];
    if (outputFiles.length === 0) {
      return [];
    }

    const infoResults = await Promise.all(outputFiles.map(async (fileId) => {
      const infoResult = await fileApi.getInfo(fileId);
      return infoResult.success ? infoResult.data : null;
    }));

    return infoResults.reduce<Array<{ fileInfo: FileInfo; sourceHandle?: string; order?: number }>>((accumulator, item, index) => {
      if (!item) {
        return accumulator;
      }

      accumulator.push({
        fileInfo: taskRef ? normalizeTaskResultFileInfo(item, taskRef) : item,
        sourceHandle: task.output?.items?.[index]?.sourceHandle ?? task.input.execution?.outputHandle,
        order: task.output?.items?.[index]?.order ?? index,
      });

      return accumulator;
    }, []);
  }, []);

  const appendTaskOutputs = useCallback(async (
    node: AINodeData,
    tasks: Array<{ task: AITask; taskRef: ExecutionTaskRef; sourceHandle?: string; orderBase: number }>,
  ): Promise<void> => {
    const activeWorkflow = workflowRef.current;
    if (!activeWorkflow || tasks.length === 0) {
      return;
    }

    const resolvedOutputsNested = await Promise.all(tasks.map(async (taskItem) => {
      const fileInfos = await resolveOutputFileInfos(taskItem.task, taskItem.taskRef);
      return fileInfos.map((item, fileIndex) => ({
        fileInfo: item.fileInfo,
        sourceHandle: item.sourceHandle ?? taskItem.sourceHandle,
        order: taskItem.orderBase + (item.order ?? fileIndex),
      }));
    }));

    const resolvedOutputs = resolvedOutputsNested.flat();
    if (resolvedOutputs.length === 0) {
      return;
    }

    const latestWorkflow = workflowRef.current;
    if (!latestWorkflow) {
      return;
    }
    const latestNode = latestWorkflow.nodes[node.id.value];
    if (!latestNode || !isAINodeData(latestNode) || latestNode.type !== node.type) {
      return;
    }

    const writeResult = appendResolvedTaskOutputs({
      workflow: latestWorkflow,
      sourceNode: latestNode,
      resolveFileUrl: fileApi.getUrl,
    }, resolvedOutputs, {
      x: latestNode.position.x + Math.max(
        typeof latestNode.dimensions?.width === 'number' ? latestNode.dimensions.width : 0,
        420,
      ) + 180,
      y: latestNode.position.y,
      gapX: 180,
      gapY: 180,
      columns: 1,
      replaceExistingHandleSlot: false,
    });

    if (!writeResult) {
      return;
    }

    applyRuntimeSnapshot(createRuntimeOutputSnapshot(latestWorkflow, writeResult), {
      hydrateCanvas: true,
      hydrationReason: 'external-output',
    });
  }, [applyRuntimeSnapshot, resolveOutputFileInfos, workflowRef]);

  const commitBackendExecutionOutputs = useCallback(async (
    node: AINodeData,
    snapshot: ExecutionRuntimeRunState,
    input: ExecutionOutputCommitWorkflowInput,
  ): Promise<void> => {
    const latestWorkflow = workflowRef.current ?? workflow.workflow ?? null;
    const workflowAccess = {
      getCurrentWorkflow: () => workflowRef.current,
      applyRuntimeSnapshot,
      resolveFileUrl: fileApi.getUrl,
      ensureExecutionOutputRuntimeResource: executionOutputRuntimeSyncService.ensure,
      prefetchExecutionOutputRuntimeResource: executionOutputRuntimeSyncService.prefetch,
    };
    const activeWorkflow = workflowRef.current ?? workflow.workflow;
    if (!activeWorkflow) {
      throw new Error('Workflow context is unavailable for execution output commit.');
    }
    const adapterBaseWorkflow = latestWorkflow ?? activeWorkflow;

    const resolvedRequest = resolveWorkflowExecutionOutputCommitRequest({
      node,
      snapshot,
      input,
      latestWorkflow,
      resolveNodeTitle: getNodeNameById,
      buildAdapterContext: (commitNode) => ({
        workflowId: workflowRef.current?.id ?? null,
        workflow: adapterBaseWorkflow,
        node: commitNode,
        nodeTitle: getNodeNameById(commitNode.id.value),
        inputs: getNodeInputSummary(commitNode.id.value),
        resolvedInputGroups: getResolvedNodeInputGroups(commitNode.id.value),
        services: {
          resolveFileUrl: fileApi.getUrl,
        },
      }),
      groupedAdapter: groupedExecutionOutputAdapterRef.current,
      getNodeAdapter: getExecutionRuntimeNodeAdapter,
      workflowAccess,
    });

    if (!resolvedRequest) {
      return;
    }

    if (resolvedRequest.kind === 'legacy-grouped-targets') {
      await executionOutputCommitService.commitResolved(resolvedRequest.request);
      return;
    }

    await executionOutputCommitService.commitResolved(resolvedRequest.request);
  }, [
    applyRuntimeSnapshot,
    getNodeInputSummary,
    getNodeNameById,
    getResolvedNodeInputGroups,
    workflow.workflow,
    workflowRef,
  ]);

  const buildExecutionRuntimeAdapterContext = useCallback((
    node: AINodeData,
    signal?: AbortSignal,
  ): ExecutionRuntimeNodeAdapterContext => {
    const activeWorkflow = workflowRef.current ?? workflow.workflow;
    if (!activeWorkflow) {
      throw new Error('Workflow context is unavailable for execution runtime adapter.');
    }

    return {
      workflowId: activeWorkflow.id ?? null,
      workflow: activeWorkflow,
      node,
      nodeTitle: getNodeNameById(node.id.value),
      inputs: getNodeInputSummary(node.id.value),
      resolvedInputGroups: getResolvedNodeInputGroups(node.id.value),
      signal,
      services: {
        ensureBackendFileId: backendFileService.ensureBackendFileId,
        registerBackendBlobFile: backendFileService.registerBackendBlobFile,
        registerInpaintMaskFile: backendFileService.registerInpaintMaskFile,
        getBackendFileInfo: backendFileService.getBackendFileInfo,
        resolveFileUrl: fileApi.getUrl,
      },
    };
  }, [
    getNodeInputSummary,
    getNodeNameById,
    getResolvedNodeInputGroups,
    workflow.workflow,
    workflowRef,
  ]);

  const canRunNode = useCallback((nodeId: string): boolean => {
    const node = nodeMap.get(nodeId);
    if (!node || !isAINodeData(node)) {
      return false;
    }

    const execution = getNodeExecutionState(nodeId);
    if (isActiveTaskStatus(execution?.status)) {
      return false;
    }

    const definition = getNodeDefinition(node.type);
    if (!definition) {
      return false;
    }

    if (definition.execution.mode === 'node-action-only') {
      return true;
    }

    return definition.execution.canRun(node, getNodeInputSummary(nodeId)).valid;
  }, [getNodeExecutionState, getNodeInputSummary, nodeMap]);

  const optimizeAIImageGenPrompt = useCallback(async (
    nodeId: string,
    options?: {
      signal?: AbortSignal;
      prompt?: string;
    },
  ): Promise<void> => {
    const node = nodeMap.get(nodeId);

    if (!node || !isAINodeData(node) || node.type !== 'aiImageGen') {
      showWarning('提示词优化不可用', '当前节点不是 AI 生图节点。');
      return;
    }

    const authError = requireAuthenticatedAction(auth, { actionLabel: '使用 AI 提示词优化' });
    if (authError) {
      showWarning('需要登录', authError.message);
      return;
    }

    const workflowId = workflowRef.current?.id ?? '';
    if (!workflowId) {
      showWarning('提示词优化不可用', '当前画布未就绪，暂时无法执行提示词优化。');
      return;
    }

    const prompt = (
      typeof options?.prompt === 'string'
        ? options.prompt
        : typeof node.config.prompt === 'string'
          ? node.config.prompt
          : ''
    ).trim();
    if (prompt.length === 0) {
      showWarning('提示词优化不可用', '请先输入提示词，再执行 AI 提示词优化。');
      return;
    }

    const resolvedGroups = getResolvedNodeInputGroups(nodeId);
    if (resolvedGroups.length > 1) {
      showWarning('提示词优化不可用', '仅当 AI 生图节点只挂载一组输入时，才能执行提示词优化。');
      return;
    }

    const imageInputs = resolvedGroups[0]?.ports
      .find((port) => port.portId === AI_IMAGE_INPUT_PORT_ID)
      ?.inputs
      .map((input) => input.sourceNode)
      .filter((sourceNode): sourceNode is FileNodeData => (
        isFileNodeData(sourceNode) && sourceNode.type === 'image'
      )) ?? [];

    showInfo(
      '提示词优化中',
      imageInputs.length > 0
        ? `${getNodeNameById(nodeId)} 正在结合参考图优化提示词`
        : `${getNodeNameById(nodeId)} 正在根据文本优化提示词`,
    );

    try {
      const referenceFileIds = await Promise.all(
        imageInputs.map((sourceNode) => backendFileService.ensureBackendFileId(sourceNode, {
          signal: options?.signal,
          purpose: 'prompt-reference',
          workflowId,
        })),
      );

      const result = await aiPromptApi.optimizeAIImageGenPrompt({
        workflowId,
        nodeId,
        nodeType: 'aiImageGen',
        prompt,
        referenceFileIds,
      }, {
        signal: options?.signal,
      });

      if (!result.success) {
        if (showAuthFeedback(result.error, '使用 AI 提示词优化')) {
          return;
        }

        if (options?.signal?.aborted || isAbortError(result.error)) {
          showInfo('提示词优化已取消', `${getNodeNameById(nodeId)} 已取消提示词优化`);
          return;
        }

        showError('提示词优化失败', result.error.message);
        return;
      }

      const activeWorkflow = workflowRef.current;
      if (!activeWorkflow) {
        showWarning('提示词优化失败', '当前画布未就绪，无法回填优化后的提示词。');
        return;
      }

      const currentNode = activeWorkflow.nodes[nodeId];
      if (!currentNode || !isAINodeData(currentNode) || currentNode.type !== 'aiImageGen') {
        showWarning('提示词优化失败', '当前节点已变化，无法回填优化后的提示词。');
        return;
      }

      applyRuntimeSnapshot({
        nodes: {
          ...activeWorkflow.nodes,
          [nodeId]: {
            ...currentNode,
            config: {
              ...currentNode.config,
              prompt: result.data.optimizedPrompt,
            },
            timestamp: {
              ...currentNode.timestamp,
              updated: Date.now(),
            },
          },
        },
        connections: activeWorkflow.connections,
        viewport: activeWorkflow.viewport,
        metadata: activeWorkflow.metadata ?? undefined,
      }, {
        hydrateCanvas: true,
        hydrationReason: 'external-output',
      });

      showSuccess('提示词优化完成', `${getNodeNameById(nodeId)} 的提示词已回填`);
    } catch (error) {
      if (showAuthFeedback(error, '使用 AI 提示词优化')) {
        return;
      }

      if (options?.signal?.aborted || isAbortError(error)) {
        showInfo('提示词优化已取消', `${getNodeNameById(nodeId)} 已取消提示词优化`);
        return;
      }

      showError(
        '提示词优化失败',
        getActionErrorMessage(error, '提示词优化失败，请稍后重试。'),
      );
    }
  }, [
    applyRuntimeSnapshot,
    auth,
    getNodeNameById,
    getResolvedNodeInputGroups,
    nodeMap,
    showAuthFeedback,
    showError,
    showInfo,
    showSuccess,
    showWarning,
    workflowRef,
  ]);

  const runNodeAction = useCallback(async ({
    nodeId,
    actionId,
    targetId,
    options,
  }: RunNodeActionParams): Promise<void> => {
    const activeWorkflow = workflowRef.current;
    const node = nodeMap.get(nodeId);
    if (!activeWorkflow || !node || !isAINodeData(node)) {
      return;
    }

    await runRegisteredNodeAction({
      workflow: activeWorkflow,
      node,
      actionId,
      inputs: getNodeInputSummary(nodeId),
      targetId,
      options,
      services: {
        auth,
        getNodeById: (targetNodeId: string) => nodeMap.get(targetNodeId) ?? null,
        getNodeNameById,
        getCurrentWorkflow: () => workflowRef.current,
        applyRuntimeSnapshot,
        ensureWorkflowPersistedForExecution,
        ensureBackendFileId: backendFileService.ensureBackendFileId,
        getBackendFileInfo: backendFileService.getBackendFileInfo,
        getExecutionRuntimeGroupState: (targetNodeId: string, groupId: string, workflowId?: string | null) => (
          executionRuntimeStore.getGroup(targetNodeId, groupId, workflowId)
        ),
        syncTaskRefsToWorkflow,
        commitBackendExecutionOutputs,
        buildExecutionRuntimeAdapterContext,
        createOutputCommitInput: (payload, adapterContext) => (
          createPayloadExecutionOutputCommitInput(payload, adapterContext, 'incremental')
        ),
        setNodeExecutionState: (targetNodeId: string, nextState: WorkflowAIExecutionState): void => {
          executionRuntimeStore.setNodeState({
            workflowId: workflowRef.current?.id ?? null,
            nodeId: targetNodeId,
            ...nextState,
          });
        },
        setGroupExecutionState: (targetNodeId: string, nextState: WorkflowNodeGroupExecutionState): void => {
          executionRuntimeStore.setGroupState({
            workflowId: workflowRef.current?.id ?? null,
            nodeId: targetNodeId,
            ...nextState,
          });
        },
        createGroupedExecution: backendExecutionService.createGroupedExecution,
        startExecutionPolling: async (pollingOptions) => executionPollingManager.start(pollingOptions).promise,
        logWarn: (event: string, message: string, context: Record<string, unknown>): void => {
          log.warn(event, message, context);
        },
        notification: {
          showWarning,
          showInfo,
          showSuccess,
          showError,
          showAuthFeedback,
        },
      } satisfies SharedNodeActionServices,
      resolveNodeDefinition: getNodeDefinition,
    });
  }, [
    applyRuntimeSnapshot,
    auth,
    buildExecutionRuntimeAdapterContext,
    commitBackendExecutionOutputs,
    ensureWorkflowPersistedForExecution,
    getNodeInputSummary,
    getNodeNameById,
    nodeMap,
    showAuthFeedback,
    showError,
    showInfo,
    showSuccess,
    showWarning,
    syncTaskRefsToWorkflow,
    workflowRef,
  ]);

  const handleExecutionEvent = useCallback((nodeId: string, event: ReturnType<typeof reduceExecutionEvent>): void => {
    const currentState = getNodeExecutionState(nodeId);
    const nextState: WorkflowAIExecutionState = {
      taskRecordId: event.task.input.execution?.taskRecordId ?? currentState?.taskRecordId ?? null,
      aiTaskId: event.task.id,
      taskNo: event.task.input.execution?.taskNo ?? currentState?.taskNo,
      batchId: event.task.input.execution?.batchId ?? currentState?.batchId,
      status: event.state.status,
      progress: event.state.progress,
      message: event.state.message,
      output: event.state.output,
      error: event.state.error,
    };

    setNodeExecutionState(nodeId, nextState);

    if (event.state.status === 'completed') {
      showSuccess('节点运行完成', `${getNodeNameById(nodeId)} 已完成执行`);
      cleanupTaskSubscription(nodeId);
    }

    if (event.state.status === 'failed') {
      showError('节点运行失败', event.state.error ?? `${getNodeNameById(nodeId)} 执行失败`);
      cleanupTaskSubscription(nodeId);
    }

    if (event.state.status === 'cancelled') {
      showInfo('节点已取消', `${getNodeNameById(nodeId)} 已取消执行`);
      cleanupTaskSubscription(nodeId);
    }

    if (!currentState && event.state.status === 'processing') {
      showInfo('节点开始运行', `${getNodeNameById(nodeId)} 已提交到执行队列`);
    }
  }, [
    cleanupTaskSubscription,
    getNodeExecutionState,
    getNodeNameById,
    setNodeExecutionState,
    showError,
    showInfo,
    showSuccess,
  ]);

  const loadCompletedTask = useCallback(async (taskId: string, fallbackTask: AITask): Promise<AITask> => {
    const result = await aiApi.getTask(taskId);
    if (result.success) {
      return result.data;
    }

    return fallbackTask;
  }, []);

  const createNodeTask = useCallback(async (
    payload: ReturnType<typeof buildTaskPayload>,
  ): Promise<AITask> => {
    const createResult = await aiApi.createTask(payload);
    if (!createResult.success) {
      throw new Error(createResult.error.message);
    }

    const createdTask = createResult.data;
    activeTaskRef.current.set(createdTask.id, createdTask);
    return createdTask;
  }, []);

  const subscribeToTask = useCallback((
    nodeId: string,
    taskId: string,
    onChunk: (task: AITask, chunk: AIStreamChunk) => void,
  ): (() => void) => {
    let unsubscribeRef: (() => void) | null = null;

    const unsubscribe = aiApi.subscribeTask(taskId, (chunk) => {
      const previousTask = activeTaskRef.current.get(taskId);
      if (!previousTask) {
        return;
      }

      const nextTask = mergeTaskWithChunk(previousTask, chunk);
      activeTaskRef.current.set(taskId, nextTask);
      onChunk(nextTask, chunk);

      if (isTerminalTaskStatus(nextTask.status)) {
        taskCompletionResolverRef.current.get(taskId)?.(nextTask);
        taskCompletionResolverRef.current.delete(taskId);
        activeTaskRef.current.delete(taskId);
        if (unsubscribeRef) {
          unsubscribeRef();
          unregisterTaskSubscription(nodeId, unsubscribeRef);
          unsubscribeRef = null;
        }
      }
    });

    unsubscribeRef = unsubscribe;
    registerTaskSubscription(nodeId, unsubscribe);
    return unsubscribe;
  }, [registerTaskSubscription, unregisterTaskSubscription]);

  const awaitTaskTerminalState = useCallback(async (
    nodeId: string,
    task: AITask,
    onChunk: (task: AITask, chunk: AIStreamChunk) => void,
  ): Promise<AITask> => {
    if (isTerminalTaskStatus(task.status)) {
      return task;
    }

    return new Promise<AITask>((resolve) => {
      taskCompletionResolverRef.current.set(task.id, resolve);
      const unsubscribe = subscribeToTask(nodeId, task.id, onChunk);

      if (isTerminalTaskStatus(activeTaskRef.current.get(task.id)?.status)) {
        taskCompletionResolverRef.current.delete(task.id);
        unsubscribe();
        unregisterTaskSubscription(nodeId, unsubscribe);
        const completedTask = activeTaskRef.current.get(task.id) ?? task;
        activeTaskRef.current.delete(task.id);
        resolve(completedTask);
      }
    });
  }, [subscribeToTask, unregisterTaskSubscription]);

  const runExecutionRuntimeGroupedNode = useCallback(async (node: AINodeData): Promise<void> => {
    const activeWorkflow = workflowRef.current;
    if (!activeWorkflow) {
      return;
    }

    const adapter = getExecutionRuntimeNodeAdapter(node.type);
    if (!adapter || adapter.executionKind !== 'grouped') {
      throw new Error(`节点 ${node.type} 未注册 grouped 执行适配器`);
    }

    const nodeId = node.id.value;
    cleanupBackendExecution(nodeId);
    clearNodeGroupExecutionStates(nodeId);

    const abortController = new AbortController();
    backendExecutionAbortRef.current.set(nodeId, abortController);

    const adapterContext = buildExecutionRuntimeAdapterContext(node, abortController.signal);
    const validation = adapter.validateExecution(adapterContext);
    if (!validation.valid) {
      backendExecutionAbortRef.current.delete(nodeId);
      const errorMessage = formatExecutionErrorMessage(
        validation.code ?? 'VALIDATION_ERROR',
        validation.reason,
      ) ?? validation.reason;
      setNodeExecutionState(nodeId, {
        workflowId: workflowRef.current?.id ?? null,
        nodeId,
        nodeType: node.type,
        taskRecordId: null,
        aiTaskId: null,
        status: 'failed',
        progress: 0,
        message: null,
        error: errorMessage,
        lastErrorCode: validation.code ?? 'VALIDATION_ERROR',
      });
      showWarning('无法运行节点', errorMessage);
      return;
    }

    setNodeExecutionState(nodeId, {
      workflowId: workflowRef.current?.id ?? null,
      nodeId,
      nodeType: node.type,
      taskRecordId: null,
      aiTaskId: null,
      status: 'queued',
      progress: 0,
      message: `准备提交 ${adapterContext.resolvedInputGroups.length} 组任务`,
      error: undefined,
    });

    adapterContext.resolvedInputGroups.forEach((groupState) => {
      const hasAnyInput = groupState.ports.some((port) => port.inputs.length > 0);
      if (!hasAnyInput) {
        return;
      }

      setNodeGroupExecutionState(nodeId, groupState.group.id, {
        workflowId: workflowRef.current?.id ?? null,
        nodeId,
        nodeType: node.type,
        groupId: groupState.group.id,
        groupOrder: groupState.group.order,
        taskRecordId: null,
        aiTaskId: null,
        status: 'queued',
        progress: 0,
        message: '准备上传输入文件',
        error: undefined,
      });
    });

    showInfo('节点开始运行', `${getNodeNameById(nodeId)} 已提交到真实后端执行`);

    try {
      let payload;
      try {
        payload = await adapter.createExecutionPayload(adapterContext);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        const appError = isAppError(error) ? error : null;
        const errorCode = appError?.code ?? 'FILE_UPLOAD_FAILED';
        const errorMessage = formatExecutionErrorMessage(
          errorCode,
          appError?.message ?? (error instanceof Error ? error.message : '输入文件上传失败'),
          appError?.context,
        ) ?? '输入文件上传失败，请稍后重试';

        setNodeExecutionState(nodeId, {
          workflowId: workflowRef.current?.id ?? null,
          nodeId,
          nodeType: node.type,
          taskRecordId: null,
          aiTaskId: null,
          status: 'failed',
          progress: 0,
          message: '输入文件上传失败',
          error: errorMessage,
          lastErrorCode: errorCode,
        });
        showError('输入文件上传失败', errorMessage);
        return;
      }

      let execution;
      try {
        execution = await backendExecutionService.createGroupedExecution(
          {
            ...(payload.request as Parameters<typeof backendExecutionService.createGroupedExecution>[0]),
            workflowId: workflowRef.current?.id ?? '',
          },
          abortController.signal,
        );
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        const appError = isAppError(error) ? error : null;
        const errorCode = appError?.code ?? 'EXECUTION_CREATE_FAILED';
        const errorMessage = formatExecutionErrorMessage(
          errorCode,
          appError?.message ?? (error instanceof Error ? error.message : '任务创建失败'),
          appError?.context,
        ) ?? '任务创建失败，请稍后重试';

        setNodeExecutionState(nodeId, {
          workflowId: workflowRef.current?.id ?? null,
          nodeId,
          nodeType: node.type,
          taskRecordId: null,
          aiTaskId: null,
          status: 'failed',
          progress: 10,
          message: '任务创建失败',
          error: errorMessage,
          lastErrorCode: errorCode,
        });
        showError('任务创建失败', errorMessage);
        return;
      }

      const taskByGroupId = new Map(execution.tasks.map((task) => [task.groupId, task] as const));
      const executionTaskRefs = payload.targets.flatMap((target) => {
        const task = taskByGroupId.get(target.groupId);
        if (!task || !workflowRef.current) {
          return [];
        }

        return [createExecutionTaskRefFromBackendSummary(
          node,
          workflowRef.current.id,
          workflowRef.current.projectId,
          execution.runId,
          execution.runNo,
          task,
          {
            taskType: payload.taskType,
            groupLabel: target.groupLabel,
            groupOrder: target.groupOrder,
            outputHandle: target.outputHandle,
            createdAt: Date.now(),
          },
        )];
      });
      if (executionTaskRefs.length > 0) {
        syncTaskRefsToWorkflow(
          nodeId,
          executionTaskRefs.map((taskRef) => toNodeTaskRef(taskRef)),
          executionTaskRefs,
        );
      }

      setNodeExecutionState(nodeId, {
        workflowId: workflowRef.current?.id ?? null,
        nodeId,
        nodeType: node.type,
        runId: execution.runId,
        runNo: execution.runNo,
        taskRecordId: null,
        aiTaskId: execution.runId,
        batchId: execution.runNo,
        status: execution.status,
        progress: 10,
        message: '任务已创建，等待后端执行',
        error: undefined,
        totalTaskCount: execution.tasks.length,
        completedTaskCount: 0,
        failedTaskCount: 0,
      });

      payload.targets.forEach((target) => {
        const task = taskByGroupId.get(target.groupId);
        setNodeGroupExecutionState(nodeId, target.groupId, {
          workflowId: workflowRef.current?.id ?? null,
          nodeId,
          nodeType: node.type,
          runId: execution.runId,
          runNo: execution.runNo,
          groupId: target.groupId,
          groupOrder: target.groupOrder,
          taskRecordId: null,
          aiTaskId: task?.taskId ?? null,
          taskNo: task?.taskNo,
          batchId: execution.runNo,
          status: task?.status ?? 'queued',
          progress: 10,
          message: '已入队',
          error: undefined,
        });
      });

      const runContext = {
        workflowId: workflowRef.current?.id ?? null,
        nodeId,
        payload,
        previousSnapshot: executionRuntimeStore.getRun(execution.runId),
      };

      let finalSnapshot: ExecutionRuntimeRunState;
      try {
        finalSnapshot = await executionPollingManager.start({
          runId: execution.runId,
          workflowId: workflowRef.current?.id ?? null,
          nodeId,
          signal: abortController.signal,
          mapSnapshotToPatches: (snapshot, previousSnapshot) => adapter.mapSnapshotToRuntimePatch(snapshot, {
            ...runContext,
            previousSnapshot,
          }),
          onSnapshot: (snapshot) => {
            void commitBackendExecutionOutputs(
              node,
              snapshot,
              createPayloadExecutionOutputCommitInput(
                payload,
                {
                  ...adapterContext,
                  signal: abortController.signal,
                },
                adapter.outputCommitMode ?? 'incremental',
              ),
            );
          },
        }).promise;
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }

        const appError = isAppError(error) ? error : null;
        const errorCode = appError?.code ?? 'TASK_QUERY_FAILED';
        const errorMessage = getExecutionErrorUserMessage(
          errorCode,
          appError?.message ?? (error instanceof Error ? error.message : '任务状态获取失败'),
        ) ?? '任务状态获取失败，请稍后重试';

        setNodeExecutionState(nodeId, {
          ...(getNodeExecutionState(nodeId) ?? {}),
          workflowId: workflowRef.current?.id ?? null,
          nodeId,
          nodeType: node.type,
          runId: execution.runId,
          runNo: execution.runNo,
          taskRecordId: null,
          aiTaskId: execution.runId,
          batchId: execution.runNo,
          status: 'failed',
          progress: 10,
          message: '任务状态获取失败',
          error: errorMessage,
          lastErrorCode: errorCode,
        } as WorkflowAIExecutionState);

        showError('任务状态获取失败', errorMessage);
        return;
      }

      await commitBackendExecutionOutputs(
        node,
        finalSnapshot,
        createPayloadExecutionOutputCommitInput(
          payload,
          {
            ...adapterContext,
            signal: abortController.signal,
          },
          adapter.outputCommitMode ?? 'incremental',
        ),
      );

      const successfulCount = finalSnapshot.tasks.filter((task) => task.status === 'completed').length;
      const failedCount = finalSnapshot.tasks.filter((task) => task.status === 'failed').length;
      const failedTask = finalSnapshot.tasks.find((task) => task.status === 'failed');

      if (successfulCount > 0 && failedCount > 0) {
        showWarning(
          '节点运行部分完成',
          `${getNodeNameById(nodeId)} 完成 ${successfulCount} 组结果，${failedCount} 组失败`,
        );
      } else if (successfulCount > 0) {
        showSuccess('节点运行完成', `${getNodeNameById(nodeId)} 完成 ${successfulCount} 组结果`);
      } else if (failedTask) {
        showError(
          '节点运行失败',
          getExecutionErrorUserMessage(failedTask.errorCode, failedTask.error ?? `${getNodeNameById(nodeId)} 执行失败`)
            ?? `${getNodeNameById(nodeId)} 执行失败`,
        );
      }
    } finally {
      backendExecutionAbortRef.current.delete(nodeId);
    }
  }, [
    buildExecutionRuntimeAdapterContext,
    cleanupBackendExecution,
    clearNodeGroupExecutionStates,
    commitBackendExecutionOutputs,
    getNodeExecutionState,
    getNodeNameById,
    setNodeExecutionState,
    setNodeGroupExecutionState,
    showError,
    showInfo,
    showSuccess,
    showWarning,
    workflowRef,
  ]);

  const runSingleAINodeTask = useCallback(async (node: AINodeData): Promise<void> => {
    const activeWorkflow = workflowRef.current;
    if (!activeWorkflow) {
      return;
    }

    const definition = getNodeDefinition(node.type);
    if (!definition || !isSingleTaskExecutionAdapter(definition.execution)) {
      throw new Error('Node single-task execution contract is missing.');
    }

    const nodeId = node.id.value;
    const inputs = getNodeInputSummary(nodeId);
    const connectedFileInputs = inputs
      .map((input) => input.sourceNode)
      .filter((sourceNode): sourceNode is FileNodeData => isFileNodeData(sourceNode));
    const readinessResult = await ensureExecutionFilesReady(activeWorkflow, connectedFileInputs, {
      workflowId: activeWorkflow.id,
    });
    assertExecutionFilesReady(activeWorkflow, readinessResult);
    const plan = definition.execution.buildPlan(node, inputs);
    const payload = buildTaskPayload({
      nodeId,
      projectId: activeWorkflow.projectId,
      workflowId: activeWorkflow.id,
      workflowVersion: activeWorkflow.version,
      nodeType: node.type,
      type: definition.execution.taskType,
      provider: definition.execution.provider,
      model: node.config.model as AITask['model'],
      files: remapOriginalFileIds(plan.files, readinessResult.fileBindingMap),
      references: remapOriginalFileIds(plan.references, readinessResult.fileBindingMap),
      fileBindings: readinessResult.fileBindings,
      config: plan.config,
      prompt: plan.prompt,
      negativePrompt: plan.negativePrompt,
      idempotencyKey: `${activeWorkflow.id}:${nodeId}:${activeWorkflow.timestamp.updated}`,
    });

    const createdTask = await createNodeTask(payload);
    const processingTaskRef = createExecutionTaskRefFromAITask(node, createdTask, {
      status: 'processing',
      startedAt: createdTask.startedAt ?? Date.now(),
    });

    syncTaskRefsToWorkflow(nodeId, [toNodeTaskRef(processingTaskRef)], [processingTaskRef]);
    setNodeExecutionState(nodeId, buildExecutionState(createdTask));
    showInfo('节点开始运行', `${getNodeNameById(nodeId)} 已提交到执行队列`);

    const terminalTask = await awaitTaskTerminalState(nodeId, createdTask, (nextTask, chunk) => {
      const previousState = getNodeExecutionState(nodeId) ?? undefined;
      const event = reduceExecutionEvent(nextTask, chunk, previousState);
      handleExecutionEvent(nodeId, event);
    });

    const completedTask = isTerminalTaskStatus(terminalTask.status)
      ? await loadCompletedTask(terminalTask.id, terminalTask)
      : terminalTask;
    const finalEvent = reduceExecutionEvent(
      completedTask,
      undefined,
      getNodeExecutionState(nodeId) ?? undefined,
    );

    handleExecutionEvent(nodeId, finalEvent);

    if (completedTask.status === 'completed') {
      const completedTaskRef = createExecutionTaskRefFromAITask(node, completedTask, {
        status: 'completed',
        createdAt: processingTaskRef.createdAt,
        startedAt: completedTask.startedAt ?? processingTaskRef.startedAt,
        completedAt: completedTask.completedAt ?? Date.now(),
      });
      syncTaskRefsToWorkflow(nodeId, [toNodeTaskRef(completedTaskRef)], [completedTaskRef]);
      await appendTaskOutputs(node, [{
        task: completedTask,
        taskRef: completedTaskRef,
        orderBase: 0,
      }]);
      return;
    }

    const terminalTaskRef = createExecutionTaskRefFromAITask(node, completedTask, {
      status: completedTask.status,
      createdAt: processingTaskRef.createdAt,
      startedAt: completedTask.startedAt ?? processingTaskRef.startedAt,
      completedAt: completedTask.completedAt ?? Date.now(),
    });
    syncTaskRefsToWorkflow(nodeId, [toNodeTaskRef(terminalTaskRef)], [terminalTaskRef]);
  }, [
    appendTaskOutputs,
    awaitTaskTerminalState,
    createNodeTask,
    getNodeExecutionState,
    getNodeInputSummary,
    getNodeNameById,
    handleExecutionEvent,
    loadCompletedTask,
    setNodeExecutionState,
    showInfo,
    syncTaskRefsToWorkflow,
    workflowRef,
  ]);

  const runGroupedDefinitionNode = useCallback(async (node: AINodeData): Promise<void> => {
    const activeWorkflow = workflowRef.current;
    if (!activeWorkflow) {
      return;
    }

    const definition = getNodeDefinition(node.type);
    if (!definition || !isGroupedTaskExecutionAdapter(definition.execution)) {
      throw new Error('Node grouped execution contract is missing.');
    }

    const nodeId = node.id.value;
    const inputs = getNodeInputSummary(nodeId);
    const connectedFileInputs = inputs
      .map((input) => input.sourceNode)
      .filter((sourceNode): sourceNode is FileNodeData => isFileNodeData(sourceNode));
    const readinessResult = await ensureExecutionFilesReady(activeWorkflow, connectedFileInputs, {
      workflowId: activeWorkflow.id,
    });
    assertExecutionFilesReady(activeWorkflow, readinessResult);
    const validation = definition.execution.canRun(node, inputs);
    if (!validation.valid) {
      showWarning('无法运行节点', validation.reason ?? `${getNodeNameById(nodeId)} 缺少有效输入`);
      return;
    }

    const groupStates = getNodeInputGroups(nodeId);
    const groupPlans = definition.execution.buildGroupPlans(
      createGroupedExecutionContext(activeWorkflow, node, inputs),
    );
    const groupPlanById = new Map(groupPlans.map((groupPlan) => [groupPlan.groupId, groupPlan] as const));
    const groupedExecution = resolveGroupedExecutionGroups(groupStates, groupPlans);
    const executableGroupIdSet = new Set(groupedExecution.executableGroupIds);
    const skippedGroupIdSet = new Set(groupedExecution.skippedGroupIds);
    const executableGroups = groupStates.filter((groupState) => executableGroupIdSet.has(groupState.group.id));
    if (executableGroups.length === 0) {
      showWarning('无法运行节点', `${getNodeNameById(nodeId)} 至少需要一组有效输入。`);
      return;
    }

    clearNodeGroupExecutionStates(nodeId);
    setNodeExecutionState(nodeId, {
      taskRecordId: null,
      aiTaskId: null,
      batchId: undefined,
      status: 'processing',
      progress: 0,
      message: `准备执行 ${executableGroups.length} 组任务`,
      error: undefined,
    });

    groupStates
      .filter((groupState) => skippedGroupIdSet.has(groupState.group.id))
      .forEach((groupState) => {
        setNodeGroupExecutionState(
          nodeId,
          groupState.group.id,
          createSkippedGroupExecutionState(groupState.group.id, '当前组输入不完整，已跳过'),
        );
      });

    showInfo('节点开始运行', `${getNodeNameById(nodeId)} 正在执行 ${executableGroups.length} 组任务`);

    const groupResults = await Promise.all(executableGroups.map(async (groupState) => {
      const groupId = groupState.group.id;
      const executionPlan = groupPlanById.get(groupId);
      if (!executionPlan) {
        throw new Error(`Missing grouped execution plan for ${groupId}.`);
      }

      const payload = buildTaskPayload({
        nodeId,
        projectId: activeWorkflow.projectId,
        workflowId: activeWorkflow.id,
        workflowVersion: activeWorkflow.version,
        nodeType: node.type,
        type: definition.execution.taskType,
        provider: definition.execution.provider,
        model: node.config.model as AITask['model'],
        files: remapOriginalFileIds(executionPlan.plan.files, readinessResult.fileBindingMap),
        references: remapOriginalFileIds(executionPlan.plan.references, readinessResult.fileBindingMap),
        fileBindings: readinessResult.fileBindings,
        config: executionPlan.plan.config,
        prompt: executionPlan.plan.prompt,
        negativePrompt: executionPlan.plan.negativePrompt,
        groupId,
        groupLabel: groupState.group.label,
        groupOrder: groupState.group.order,
        outputHandle: executionPlan.outputHandle,
        idempotencyKey: `${activeWorkflow.id}:${nodeId}:${groupId}:${activeWorkflow.timestamp.updated}`,
      });

      const createdTask = await createNodeTask(payload);
      const processingTaskRef = createExecutionTaskRefFromAITask(node, createdTask, {
        status: 'processing',
        startedAt: createdTask.startedAt ?? Date.now(),
      });
      syncTaskRefsToWorkflow(nodeId, [toNodeTaskRef(processingTaskRef)], [processingTaskRef]);
      setNodeGroupExecutionState(nodeId, groupId, createGroupExecutionState(groupId, createdTask));

      const terminalTask = await awaitTaskTerminalState(nodeId, createdTask, (nextTask, chunk) => {
        const previousState = getNodeGroupExecutionState(nodeId, groupId) ?? undefined;
        const nextState = reduceGroupExecutionEvent(groupId, nextTask, chunk, previousState);
        setNodeGroupExecutionState(nodeId, groupId, nextState);
      });

      const completedTask = isTerminalTaskStatus(terminalTask.status)
        ? await loadCompletedTask(terminalTask.id, terminalTask)
        : terminalTask;
      const finalState = reduceGroupExecutionEvent(
        groupId,
        completedTask,
        undefined,
        getNodeGroupExecutionState(nodeId, groupId) ?? undefined,
      );
      setNodeGroupExecutionState(nodeId, groupId, finalState);

      const finalTaskRef = createExecutionTaskRefFromAITask(node, completedTask, {
        status: completedTask.status,
        createdAt: processingTaskRef.createdAt,
        startedAt: completedTask.startedAt ?? processingTaskRef.startedAt,
        completedAt: completedTask.completedAt ?? (
          completedTask.status === 'completed' || completedTask.status === 'failed' || completedTask.status === 'cancelled'
            ? Date.now()
            : undefined
        ),
      });

      return {
        groupId,
        groupOrder: groupState.group.order,
        sourceHandle: executionPlan.outputHandle,
        task: completedTask,
        taskRef: finalTaskRef,
      };
    }));

    syncTaskRefsToWorkflow(
      nodeId,
      groupResults.map((result) => toNodeTaskRef(result.taskRef)),
      groupResults.map((result) => result.taskRef),
    );

    const successfulGroups = groupResults.filter((result) => result.task.status === 'completed');
    const failedGroups = groupResults.filter((result) => result.task.status === 'failed');
    const cancelledGroups = groupResults.filter((result) => result.task.status === 'cancelled');

    if (successfulGroups.length > 0) {
      await appendTaskOutputs(node, successfulGroups.map((result) => ({
        task: result.task,
        taskRef: result.taskRef,
        sourceHandle: result.sourceHandle,
        orderBase: result.groupOrder * 1000,
      })));
    }

    const completedCount = successfulGroups.length;
    const skippedCount = groupedExecution.skippedGroupIds.length;

    if (completedCount > 0) {
      showSuccess(
        '节点运行完成',
        `${getNodeNameById(nodeId)} 完成 ${completedCount} 组结果${failedGroups.length > 0 ? `，${failedGroups.length} 组失败` : ''}${skippedCount > 0 ? `，${skippedCount} 组跳过` : ''}`,
      );
    } else if (failedGroups.length > 0) {
      showError('节点运行失败', failedGroups[0].task.error?.message ?? `${getNodeNameById(nodeId)} 执行失败`);
    } else if (cancelledGroups.length > 0) {
      showInfo('节点已取消', `${getNodeNameById(nodeId)} 已取消执行`);
    }

    const nodeStatus: WorkflowAIExecutionState = {
      taskRecordId: null,
      aiTaskId: null,
      batchId: groupResults[0]?.taskRef.batchId,
      status: cancelledGroups.length === executableGroups.length
        ? 'cancelled'
        : completedCount > 0
          ? 'completed'
          : failedGroups.length > 0
            ? 'failed'
            : 'completed',
      progress: executableGroups.length === 0
        ? 0
        : Math.round((
          groupResults.filter((result) => (
            result.task.status === 'completed'
            || result.task.status === 'failed'
            || result.task.status === 'cancelled'
          )).length / executableGroups.length
        ) * 100),
      message: `已完成 ${groupResults.length} / ${executableGroups.length} 组任务`,
      error: completedCount === 0 && failedGroups.length > 0
        ? failedGroups[0].task.error?.message
        : undefined,
    };

    setNodeExecutionState(nodeId, nodeStatus);
  }, [
    appendTaskOutputs,
    awaitTaskTerminalState,
    clearNodeGroupExecutionStates,
    createNodeTask,
    getNodeGroupExecutionState,
    getNodeInputGroups,
    getNodeInputSummary,
    getNodeNameById,
    loadCompletedTask,
    setNodeExecutionState,
    setNodeGroupExecutionState,
    showError,
    showInfo,
    showSuccess,
    showWarning,
    syncTaskRefsToWorkflow,
    workflowRef,
  ]);

  const runBackendGroupedDefinitionNode = useCallback(async (node: AINodeData): Promise<void> => {
    const activeWorkflow = workflowRef.current;
    if (!activeWorkflow) {
      return;
    }

    const nodeId = node.id.value;
    const inputs = getNodeInputSummary(nodeId);
    const definition = getNodeDefinition(node.type);
    if (!definition || !isGroupedTaskExecutionAdapter(definition.execution)) {
      throw new Error('Node grouped execution contract is missing.');
    }

    const validation = definition.execution.canRun(node, inputs);
    if (!validation.valid) {
      throw new Error(validation.reason ?? 'Node input is invalid.');
    }

    const groupStates = getNodeInputGroups(nodeId);
    const groupPlans = definition.execution.buildGroupPlans(
      createGroupedExecutionContext(activeWorkflow, node, inputs),
    );
    const groupPlanById = new Map(groupPlans.map((groupPlan) => [groupPlan.groupId, groupPlan] as const));
    const groupedExecution = resolveGroupedExecutionGroups(groupStates, groupPlans);
    const executableGroupIdSet = new Set(groupedExecution.executableGroupIds);
    const skippedGroupIdSet = new Set(groupedExecution.skippedGroupIds);
    const executableGroups = groupStates
      .filter((groupState) => executableGroupIdSet.has(groupState.group.id))
      .sort((left, right) => left.group.order - right.group.order);

    if (executableGroups.length === 0) {
      throw new Error(validation.reason ?? `${getNodeNameById(nodeId)} 至少需要一组有效输入。`);
    }

    cleanupBackendExecution(nodeId);
    const abortController = new AbortController();
    backendExecutionAbortRef.current.set(nodeId, abortController);
    const outputHandleByGroupId = new Map(groupPlans.map((groupPlan) => [groupPlan.groupId, groupPlan.outputHandle] as const));

    clearNodeGroupExecutionStates(nodeId);
    setNodeExecutionState(nodeId, {
      runId: undefined,
      taskRecordId: null,
      aiTaskId: null,
      status: 'queued',
      progress: 0,
      message: `准备提交 ${executableGroups.length} 组任务`,
      error: undefined,
    });

    groupStates
      .filter((groupState) => skippedGroupIdSet.has(groupState.group.id))
      .forEach((groupState) => {
        setNodeGroupExecutionState(
          nodeId,
          groupState.group.id,
          createSkippedGroupExecutionState(groupState.group.id, '当前组输入不完整，已跳过'),
        );
      });

    executableGroups.forEach((groupState) => {
      setNodeGroupExecutionState(nodeId, groupState.group.id, {
        runId: undefined,
        groupId: groupState.group.id,
        groupOrder: groupState.group.order,
        taskRecordId: null,
        aiTaskId: null,
        status: 'queued',
        progress: 0,
        message: '准备上传输入文件',
        error: undefined,
      });
    });

    showInfo('节点开始运行', `${getNodeNameById(nodeId)} 已提交到真实后端执行`);

    try {
      let backendGroups;
      try {
        backendGroups = await Promise.all(executableGroups.map(async (groupState) => {
          const groupId = groupState.group.id;
          const groupPlan = groupPlanById.get(groupId);
          const sourceNode = getBackendGroupedSourceNode(node, groupId);
          if (!groupPlan || !sourceNode) {
            throw new Error(`Missing grouped execution input for ${groupId}.`);
          }

          setNodeGroupExecutionState(nodeId, groupId, {
            ...getNodeGroupExecutionState(nodeId, groupId),
            groupId,
            groupOrder: groupState.group.order,
            taskRecordId: null,
            aiTaskId: null,
            status: 'processing',
            progress: 5,
            message: '正在注册输入文件',
            error: undefined,
            lastErrorCode: null,
          } as WorkflowNodeGroupExecutionState);

          const sourceFileId = await backendFileService.ensureBackendFileId(sourceNode, {
            signal: abortController.signal,
            workflowId: activeWorkflow.id,
          });

          setNodeGroupExecutionState(nodeId, groupId, {
            ...getNodeGroupExecutionState(nodeId, groupId),
            runId: undefined,
            groupId,
            groupOrder: groupState.group.order,
            taskRecordId: null,
            aiTaskId: null,
            status: 'queued',
            progress: 10,
            message: '输入文件已就绪，等待创建任务',
            error: undefined,
            lastErrorCode: null,
          } as WorkflowNodeGroupExecutionState);

          return {
            groupId,
            groupOrder: groupState.group.order,
            outputHandle: groupPlan.outputHandle,
            payload: buildAIFloorplanColorizeBackendGroupPayload({
              groupId,
              sourceFileId: sourceFileId ?? '',
              config: {
                model: groupPlan.plan.config.model,
                stylePreset: groupPlan.plan.config.stylePreset,
                imageSize: groupPlan.plan.config.imageSize,
                aspectRatio: groupPlan.plan.config.aspectRatio,
              },
            }),
          };
        }));
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        const appError = isAppError(error) ? error : null;
        const errorCode = appError?.code ?? 'FILE_UPLOAD_FAILED';
        const errorMessage = formatExecutionErrorMessage(
          errorCode,
          appError?.message ?? (error instanceof Error ? error.message : '输入文件上传失败'),
          appError?.context,
        ) ?? '输入文件上传失败，请稍后重试';

        setNodeExecutionState(nodeId, {
          runId: undefined,
          taskRecordId: null,
          aiTaskId: null,
          status: 'failed',
          progress: 0,
          message: '输入文件上传失败',
          error: errorMessage,
          lastErrorCode: errorCode,
        });

        executableGroups.forEach((groupState) => {
          setNodeGroupExecutionState(nodeId, groupState.group.id, {
            ...getNodeGroupExecutionState(nodeId, groupState.group.id),
            runId: undefined,
            groupId: groupState.group.id,
            groupOrder: groupState.group.order,
            taskRecordId: null,
            aiTaskId: null,
            status: 'failed',
            progress: 0,
            message: '输入文件上传失败',
            error: errorMessage,
            lastErrorCode: errorCode,
          } as WorkflowNodeGroupExecutionState);
        });

        showError('输入文件上传失败', errorMessage);
        return;
      }

      let execution;
      try {
        execution = node.type === 'aiImageHd'
          ? await backendExecutionService.createGroupedExecution({
            workflowId: workflowRef.current?.id ?? '',
            nodeType: 'aiImageHd',
            taskType: 'image-hd',
            executionMode: 'legacy-grouped-task',
            nodeId: node.id.value,
            nodeTitle: getNodeNameById(nodeId),
            model: node.config.model,
            groups: backendGroups.map((group) => group.payload),
          }, abortController.signal)
          : await backendExecutionService.createGroupedExecution({
            workflowId: workflowRef.current?.id ?? '',
            nodeType: 'aiFloorplanColorize',
            taskType: 'floorplan-colorize',
            executionMode: 'legacy-grouped-task',
            nodeId: node.id.value,
            nodeTitle: getNodeNameById(nodeId),
            model: node.config.model,
            groups: backendGroups.map((group) => group.payload),
          }, abortController.signal);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        const appError = isAppError(error) ? error : null;
        const errorCode = appError?.code ?? 'EXECUTION_CREATE_FAILED';
        const errorMessage = formatExecutionErrorMessage(
          errorCode,
          appError?.message ?? (error instanceof Error ? error.message : '任务创建失败'),
          appError?.context,
        ) ?? '任务创建失败，请稍后重试';

        setNodeExecutionState(nodeId, {
          runId: undefined,
          taskRecordId: null,
          aiTaskId: null,
          status: 'failed',
          progress: 10,
          message: '任务创建失败',
          error: errorMessage,
          lastErrorCode: errorCode,
        });

        backendGroups.forEach((group) => {
          setNodeGroupExecutionState(nodeId, group.groupId, {
            ...getNodeGroupExecutionState(nodeId, group.groupId),
            runId: undefined,
            groupId: group.groupId,
            groupOrder: group.groupOrder,
            taskRecordId: null,
            aiTaskId: null,
            status: 'failed',
            progress: 10,
            message: '任务创建失败',
            error: errorMessage,
            lastErrorCode: errorCode,
          } as WorkflowNodeGroupExecutionState);
        });

        showError('任务创建失败', errorMessage);
        return;
      }

      const taskByGroupId = new Map(execution.tasks.map((task) => [task.groupId, task] as const));
      const executionTaskRefs = backendGroups.flatMap((group) => {
        const task = taskByGroupId.get(group.groupId);
        if (!task || !workflowRef.current) {
          return [];
        }

        const matchingGroupState = executableGroups.find((item) => item.group.id === group.groupId);
        return [createExecutionTaskRefFromBackendSummary(
          node,
          workflowRef.current.id,
          workflowRef.current.projectId,
          execution.runId,
          execution.runNo,
          task,
          {
            taskType: node.type === 'aiImageHd' ? 'image-hd' : 'floorplan-colorize',
            groupLabel: matchingGroupState?.group.label,
            groupOrder: group.groupOrder,
            outputHandle: group.outputHandle,
            createdAt: Date.now(),
          },
        )];
      });
      if (executionTaskRefs.length > 0) {
        syncTaskRefsToWorkflow(
          nodeId,
          executionTaskRefs.map((taskRef) => toNodeTaskRef(taskRef)),
          executionTaskRefs,
        );
      }

      setNodeExecutionState(nodeId, {
        runId: execution.runId,
        taskRecordId: null,
        aiTaskId: execution.runId,
        batchId: execution.runNo,
        status: execution.status,
        progress: 10,
        message: '任务已创建，等待后端执行',
        error: undefined,
        lastErrorCode: null,
      });

      backendGroups.forEach((group) => {
        const task = taskByGroupId.get(group.groupId);
        setNodeGroupExecutionState(nodeId, group.groupId, {
          runId: execution.runId,
          groupId: group.groupId,
          groupOrder: group.groupOrder,
          taskRecordId: null,
          aiTaskId: task?.taskId ?? null,
          taskNo: task?.taskNo,
          batchId: execution.runNo,
          status: task?.status ?? 'queued',
          progress: 10,
          message: '已入队',
          error: undefined,
          lastErrorCode: null,
        });
      });

      let finalSnapshot;
      try {
        finalSnapshot = await executionPollingManager.start({
          runId: execution.runId,
          workflowId: workflowRef.current?.id ?? null,
          nodeId,
          signal: abortController.signal,
          onSnapshot: (snapshot) => {
            const failedTask = snapshot.tasks.find((task) => task.status === 'failed');

            setNodeExecutionState(nodeId, {
              runId: snapshot.runId,
              taskRecordId: null,
              aiTaskId: snapshot.runId,
              batchId: snapshot.runNo,
              status: snapshot.status,
              progress: snapshot.progress,
              message: snapshot.message,
              error: snapshot.status === 'failed'
                ? (failedTask?.error ?? undefined)
                : undefined,
              lastErrorCode: snapshot.status === 'failed'
                ? (failedTask?.errorCode ?? null)
                : null,
            });

            snapshot.tasks.forEach((task) => {
              const previous = getNodeGroupExecutionState(nodeId, task.groupId);
              setNodeGroupExecutionState(nodeId, task.groupId, {
                runId: snapshot.runId,
                groupId: task.groupId,
                groupOrder: task.groupOrder,
                taskRecordId: null,
                aiTaskId: task.taskId,
                taskNo: task.taskNo,
                batchId: snapshot.runNo,
                status: task.status,
                progress: task.progress,
                message: task.message,
                currentStep: task.currentStep,
                currentAttemptNo: task.currentAttemptNo,
                retryCount: task.retryCount,
                maxRetries: task.maxRetries,
                maxAttempts: task.maxAttempts,
                lastErrorCode: task.errorCode,
                resultFileId: task.resultFileId,
                ...(task.resultFileInfo ? { resultFile: task.resultFileInfo } : {}),
                error: task.error ?? previous?.error,
              });
            });

            void commitBackendExecutionOutputs(
              node,
              snapshot,
              createLegacyGroupedExecutionOutputCommitInput(
                backendGroups.map((group) => ({
                  groupId: group.groupId,
                  groupOrder: group.groupOrder,
                  outputHandle: outputHandleByGroupId.get(group.groupId),
                })),
                'incremental',
              ),
            );
          },
        }).promise;
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }

        const appError = isAppError(error) ? error : null;
        const errorCode = appError?.code ?? 'TASK_QUERY_FAILED';
        const errorMessage = getExecutionErrorUserMessage(
          errorCode,
          appError?.message ?? (error instanceof Error ? error.message : '任务状态获取失败'),
        ) ?? '任务状态获取失败，请稍后重试';

        setNodeExecutionState(nodeId, {
          runId: execution.runId,
          taskRecordId: null,
          aiTaskId: execution.runId,
          batchId: execution.runNo,
          status: 'failed',
          progress: 10,
          message: '任务状态获取失败',
          error: errorMessage,
          lastErrorCode: errorCode,
        });

        backendGroups.forEach((group) => {
          setNodeGroupExecutionState(nodeId, group.groupId, {
            ...getNodeGroupExecutionState(nodeId, group.groupId),
            runId: execution.runId,
            groupId: group.groupId,
            groupOrder: group.groupOrder,
            taskRecordId: null,
            aiTaskId: taskByGroupId.get(group.groupId)?.taskId ?? null,
            taskNo: taskByGroupId.get(group.groupId)?.taskNo,
            batchId: execution.runNo,
            status: 'failed',
            progress: 10,
            message: '任务状态获取失败',
            error: errorMessage,
            lastErrorCode: errorCode,
          } as WorkflowNodeGroupExecutionState);
        });

        showError('任务状态获取失败', errorMessage);
        return;
      }

      await commitBackendExecutionOutputs(
        node,
        finalSnapshot,
        createLegacyGroupedExecutionOutputCommitInput(
          backendGroups.map((group) => ({
            groupId: group.groupId,
            groupOrder: group.groupOrder,
            outputHandle: outputHandleByGroupId.get(group.groupId),
          })),
          'incremental',
        ),
      );

      const successfulCount = finalSnapshot.tasks.filter((task) => task.status === 'completed').length;
      const failedTask = finalSnapshot.tasks.find((task) => task.status === 'failed');

      if (successfulCount > 0) {
        showSuccess('节点运行完成', `${getNodeNameById(nodeId)} 完成 ${successfulCount} 组结果`);
      } else if (failedTask) {
        showError(
          '节点运行失败',
          getExecutionErrorUserMessage(failedTask.errorCode, failedTask.error ?? `${getNodeNameById(nodeId)} 执行失败`)
            ?? `${getNodeNameById(nodeId)} 执行失败`,
        );
      }
    } finally {
      backendExecutionAbortRef.current.delete(nodeId);
    }
  }, [
    cleanupBackendExecution,
    clearNodeGroupExecutionStates,
    commitBackendExecutionOutputs,
    getBackendGroupedSourceNode,
    getNodeGroupExecutionState,
    getNodeInputGroups,
    getNodeInputSummary,
    getNodeNameById,
    setNodeExecutionState,
    setNodeGroupExecutionState,
    showError,
    showInfo,
    showSuccess,
    workflowRef,
  ]);

  const activeExecutionWorkflowId = workflow.persistedWorkflowId ?? workflow.workflow?.id ?? null;
  const hasActiveNodeExecution = useSyncExternalStore(
    (listener) => executionRuntimeStore.subscribeAll(listener),
    () => hasAnyActiveExecution(activeExecutionWorkflowId),
    () => hasAnyActiveExecution(activeExecutionWorkflowId),
  );

  const runAINode = useCallback(async (nodeId: string): Promise<void> => {
    const node = nodeMap.get(nodeId);
    if (!node || !isAINodeData(node) || !workflowRef.current) {
      return;
    }

    const definition = getNodeDefinition(node.type);
    if (!definition) {
      return;
    }

    if (definition.execution.mode === 'node-action-only') {
      showInfo('请使用节点内部动作', 'AI 分镜表是工作台节点，请使用节点内的 AI 编排、单镜头出图、单镜头视频和一键生成视频。');
      return;
    }

    if (!canRunNode(nodeId)) {
      const validation = definition.execution.canRun(node, getNodeInputSummary(nodeId));
      const warningMessage = validation.valid
        ? `${getNodeNameById(nodeId)} 缺少输入或仍在执行中`
        : validation.reason ?? `${getNodeNameById(nodeId)} 缺少输入或仍在执行中`;

      showWarning('无法运行节点', warningMessage);
      return;
    }

    const requiresAuthentication =
      isExecutionRuntimeGroupedNode(node)
      || isBackendGroupedExecutionNode(node)
      || isSingleTaskExecutionAdapter(definition.execution);
    if (requiresAuthentication) {
      const authError = requireAuthenticatedAction(auth, { actionLabel: '执行工作流任务' });
      if (authError) {
        showWarning('需要登录', authError.message);
        return;
      }
    }

    cleanupTaskSubscription(nodeId);

    try {
      const persistedWorkflow = requiresAuthentication
        ? await ensureWorkflowPersistedForExecution()
        : workflowRef.current;
      const connectedFileInputs = getConnectedFileInputs(nodeId);
      const readinessResult = await ensureExecutionFilesReady(
        persistedWorkflow,
        connectedFileInputs,
        {
          workflowId: persistedWorkflow.id,
        },
      );
      assertExecutionFilesReady(persistedWorkflow, readinessResult);

      if (isGroupedTaskExecutionAdapter(definition.execution)) {
        if (isExecutionRuntimeGroupedNode(node)) {
          await runExecutionRuntimeGroupedNode(node);
          return;
        }

        if (isBackendGroupedExecutionNode(node)) {
          await runBackendGroupedDefinitionNode(node);
          return;
        }

        await runGroupedDefinitionNode(node);
        return;
      }

      if (isMockExecutionAdapter(definition.execution)) {
        const activeWorkflow = workflowRef.current;
        if (!activeWorkflow) {
          return;
        }
        if (!definition.execution.mockProgressMessages || !definition.execution.getMockOutputs) {
          throw new Error('Mock execution contract is incomplete.');
        }
        const mockProgressMessages = definition.execution.mockProgressMessages;
        const getMockOutputs = definition.execution.getMockOutputs;

        const inputs = getNodeInputSummary(nodeId);
        const validation = definition.execution.canRun(node, inputs);
        if (!validation.valid) {
          throw new Error(validation.reason ?? 'Node input is invalid.');
        }

        const createdAt = Date.now();
        const mockTaskId = `mock-${nodeId}-${createdAt}`;
        const processingTaskRef = createExecutionTaskRef(node, {
          taskId: mockTaskId,
          projectId: activeWorkflow.projectId,
          workflowId: activeWorkflow.id,
          scope: 'node',
          status: 'processing',
          createdAt,
          startedAt: createdAt,
        });
        syncTaskRefsToWorkflow(nodeId, [toNodeTaskRef(processingTaskRef)], [processingTaskRef]);

        setNodeExecutionState(nodeId, {
          taskRecordId: processingTaskRef.taskId,
          aiTaskId: mockTaskId,
          taskNo: processingTaskRef.taskNo,
          batchId: processingTaskRef.batchId,
          status: 'queued',
          progress: 0,
          message: null,
          error: undefined,
        });

        for (let index = 0; index < mockProgressMessages.length; index += 1) {
          await new Promise<void>((resolve) => {
            window.setTimeout(() => {
              setNodeExecutionState(nodeId, {
                taskRecordId: processingTaskRef.taskId,
                aiTaskId: mockTaskId,
                taskNo: processingTaskRef.taskNo,
                batchId: processingTaskRef.batchId,
                status: 'processing',
                progress: Math.round(((index + 1) / mockProgressMessages.length) * 90),
                message: mockProgressMessages[index],
                error: undefined,
              });
              resolve();
            }, 180);
          });
        }

        const mockOutputs = getMockOutputs(buildMockExecutionContext(activeWorkflow, node, inputs));
        const resolvedGroups = definition.resolveInputGroups?.(node);
        const completedAt = Date.now();
        const completedTaskRef: ExecutionTaskRef = {
          ...processingTaskRef,
          status: 'completed',
          completedAt,
        };
        const taskSource = createNodeOutputFileSource({
          ...completedTaskRef,
        });
        const outputDescriptors = resolvedGroups
          ? (() : MockOutputDescriptor[] => {
            const connectedGroups = resolveConnectedOutputGroups(inputs, resolvedGroups);
            if (connectedGroups.length !== mockOutputs.length) {
              return mockOutputs.map((descriptor) => ({
                ...descriptor,
                source: descriptor.source ?? taskSource,
              }));
            }

            return mockOutputs.map((descriptor, index) => ({
              ...descriptor,
              source: descriptor.source ?? taskSource,
              sourceHandle: descriptor.sourceHandle ?? `${connectedGroups[index].groupId}:result`,
              order: descriptor.order ?? connectedGroups[index].order,
            }));
          })()
          : mockOutputs.map((descriptor) => ({
            ...descriptor,
            source: descriptor.source ?? taskSource,
          }));

        const latestWorkflow = workflowRef.current;
        if (!latestWorkflow) {
          return;
        }
        const latestNode = latestWorkflow.nodes[node.id.value];
        if (!latestNode || !isAINodeData(latestNode) || latestNode.type !== node.type) {
          return;
        }

        const writeResult = appendMockExecutionOutputs({
          workflow: latestWorkflow,
          sourceNode: latestNode,
          resolveFileUrl: fileApi.getUrl,
        }, outputDescriptors);

        if (writeResult) {
          applyRuntimeSnapshot(createRuntimeOutputSnapshot(latestWorkflow, writeResult), {
            hydrateCanvas: true,
            hydrationReason: 'external-output',
          });
        }

        syncTaskRefsToWorkflow(nodeId, [toNodeTaskRef(completedTaskRef)], [completedTaskRef]);

        setNodeExecutionState(nodeId, {
          taskRecordId: processingTaskRef.taskId,
          aiTaskId: mockTaskId,
          taskNo: processingTaskRef.taskNo,
          batchId: processingTaskRef.batchId,
          status: 'completed',
          progress: 100,
          message: null,
          error: undefined,
        });
        return;
      }

      if (isSingleTaskExecutionAdapter(definition.execution)) {
        await runSingleAINodeTask(node);
      }
    } catch (error) {
      if (showAuthFeedback(error, '执行工作流任务')) {
        return;
      }
      const message = error instanceof Error ? error.message : 'AI 节点执行失败。';
      setNodeExecutionState(nodeId, {
        taskRecordId: null,
        aiTaskId: null,
        status: 'failed',
        progress: 0,
        message: null,
        error: message,
      });
      showError('节点运行失败', message);
    }
  }, [
    auth,
    canRunNode,
    cleanupTaskSubscription,
    ensureWorkflowPersistedForExecution,
    getConnectedFileInputs,
    getNodeInputSummary,
    getNodeNameById,
    nodeMap,
    setNodeExecutionState,
    showAuthFeedback,
    showError,
    showInfo,
    showWarning,
    syncTaskRefsToWorkflow,
    workflowRef,
    applyRuntimeSnapshot,
    runExecutionRuntimeGroupedNode,
    runBackendGroupedDefinitionNode,
    runGroupedDefinitionNode,
    runSingleAINodeTask,
  ]);

  const cancelAINodeRun = useCallback(async (nodeId: string): Promise<void> => {
    const node = nodeMap.get(nodeId);
    if (
      node
      && isAINodeData(node)
      && (isExecutionRuntimeGroupedNode(node) || isBackendGroupedExecutionNode(node))
    ) {
      cleanupBackendExecution(nodeId);
      const currentState = getNodeExecutionState(nodeId);
      const groupStates = getNodeGroupExecutionStates(nodeId);

      if (currentState) {
        setNodeExecutionState(nodeId, {
          ...currentState,
          status: 'cancelled',
          message: '已停止前端轮询，后端任务可能仍在执行',
          error: undefined,
        });
      }

      groupStates.forEach((groupState) => {
        setNodeGroupExecutionState(nodeId, groupState.groupId, {
          ...groupState,
          status: isActiveTaskStatus(groupState.status) ? 'cancelled' : groupState.status,
          message: isActiveTaskStatus(groupState.status)
            ? '已停止前端轮询'
            : groupState.message,
          error: undefined,
        });
      });

      showInfo('已停止轮询', `${getNodeNameById(nodeId)} 已停止前端等待，后端任务可能仍在执行`);
      return;
    }

    const currentState = getNodeExecutionState(nodeId);
    const groupStates = getNodeGroupExecutionStates(nodeId);
    const cancellableTaskIds = new Set<string>();

    if (currentState?.aiTaskId && isActiveTaskStatus(currentState.status)) {
      cancellableTaskIds.add(currentState.aiTaskId);
    }

    groupStates.forEach((groupState) => {
      if (groupState.aiTaskId && isActiveTaskStatus(groupState.status)) {
        cancellableTaskIds.add(groupState.aiTaskId);
      }
    });

    if (cancellableTaskIds.size === 0) {
      return;
    }

    const cancelResults = await Promise.all(Array.from(cancellableTaskIds).map(async (taskId) => {
      const result = await aiApi.cancelTask(taskId);
      return { taskId, result };
    }));

    const failedResult = cancelResults.find(({ result }) => !result.success);
    if (failedResult && !failedResult.result.success) {
      showError('取消失败', failedResult.result.error.message);
      return;
    }

    cleanupTaskSubscription(nodeId);
    cancellableTaskIds.forEach((taskId) => {
      const activeTask = activeTaskRef.current.get(taskId);
      if (activeTask) {
        const cancelledTask: AITask = {
          ...activeTask,
          status: 'cancelled',
          timestamp: {
            ...activeTask.timestamp,
            updated: Date.now(),
          },
        };
        activeTaskRef.current.set(taskId, cancelledTask);
        taskCompletionResolverRef.current.get(taskId)?.(cancelledTask);
        taskCompletionResolverRef.current.delete(taskId);
      }
    });

    if (currentState) {
      setNodeExecutionState(nodeId, {
        ...currentState,
        status: 'cancelled',
        progress: currentState.progress,
        error: undefined,
        message: '执行已取消',
      });
    }

    groupStates.forEach((groupState) => {
      if (!groupState.aiTaskId || !isActiveTaskStatus(groupState.status)) {
        return;
      }

      setNodeGroupExecutionState(nodeId, groupState.groupId, {
        ...groupState,
        status: 'cancelled',
        error: undefined,
        message: '已取消',
      });
    });

    showInfo('节点已取消', `${getNodeNameById(nodeId)} 已取消执行`);
  }, [
    cleanupBackendExecution,
    cleanupTaskSubscription,
    getNodeExecutionState,
    getNodeGroupExecutionStates,
    getNodeNameById,
    nodeMap,
    setNodeExecutionState,
    setNodeGroupExecutionState,
    showError,
    showInfo,
  ]);

  return useMemo(() => ({
    canRunNode,
    patchNodeConfig,
    optimizeAIImageGenPrompt,
    runNodeAction,
    runAINode,
    cancelAINodeRun,
    hasAnyActiveExecution,
    hasActiveNodeExecution,
    resetRuntimeExecutionState,
  }), [
    canRunNode,
    patchNodeConfig,
    optimizeAIImageGenPrompt,
    runNodeAction,
    runAINode,
    cancelAINodeRun,
    hasAnyActiveExecution,
    hasActiveNodeExecution,
    resetRuntimeExecutionState,
  ]);
}
