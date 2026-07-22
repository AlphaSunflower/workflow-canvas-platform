import type { FileInfo } from '@/types';
import type { NodeActionOnlyExecutionMode } from '@/nodes/types';
import {
  normalizeAIVideoGenAspectRatio,
  normalizeAIVideoGenModel,
  normalizeAIVideoGenParameters,
  normalizeAIVideoGenResolution,
  type AIVideoGenSupportedAspectRatio,
  type AIVideoGenSupportedDurationSeconds,
  type AIVideoGenSupportedModel,
  type AIVideoGenSupportedResolution,
  type AIVideoGenSupportedSize,
} from '@/nodes/ai-video-gen/constants';
import { httpClient } from '@/api/client/http-client';
import {
  canCommitExecutionOutput,
  isExecutionOutputCommitted,
  isTerminalExecutionStatus,
} from '@/execution-runtime/execution-runtime.diff';
import type {
  ExecutionRuntimeBackendFile,
  ExecutionRuntimeBackendRunDetail,
  ExecutionRuntimeCreateTaskSummary,
  ExecutionRuntimeEvent,
  ExecutionRuntimeRunState,
  ExecutionRuntimeSummary,
  ExecutionRuntimeTaskEventEnvelope,
  ExecutionRuntimeTaskState,
} from '@/execution-runtime/execution-runtime.types';
import { getBackendFileInfo } from '@/services/backendFileService';
import {
  getExecutionOutputRuntimeStatus,
  prefetchExecutionOutputRuntimeResource,
} from '@/services/execution-output-runtime-sync';
import { createModuleLogger } from '@/utils';
import type { AppError } from '@/types';

type BackendExecutionStatus = ExecutionRuntimeRunState['status'];
type BackendExecutionStep = ExecutionRuntimeTaskState['currentStep'];
type BackendExecutionTaskQueryItem = ExecutionRuntimeBackendRunDetail['tasks'][number] & {
  inputFileId?: string | null;
  sourceFileId?: string | null;
  maskFileId?: string | null;
  maskMode?: string | null;
  workflowId?: string | null;
  projectId?: string | null;
  workflowTemplateKey?: string | null;
  providerTaskId?: string | null;
  providerClientId?: string | null;
  prompt?: string | null;
  referenceFileIds?: string[] | null;
  stylePreset?: string | null;
  imageSize?: string | null;
  aspectRatio?: string | null;
  inputFile?: ExecutionRuntimeBackendFile | null;
  sourceFile?: ExecutionRuntimeBackendFile | null;
  maskFile?: ExecutionRuntimeBackendFile | null;
};
type BackendExecutionRunDetailQuery = Omit<ExecutionRuntimeBackendRunDetail, 'tasks'> & {
  tasks: BackendExecutionTaskQueryItem[];
};

export type BackendExecutionNodeType =
  | 'aiModelRenderTransfer'
  | 'aiImageGen'
  | 'aiImageInpaint'
  | 'aiStoryboard'
  | 'aiImageHd'
  | 'aiFloorplanColorize'
  | 'aiImageToPly'
  | 'aiMultiViewRestore'
  | 'aiVideoGen';

export type BackendExecutionTaskType =
  | 'model-render-transfer'
  | 'image-gen'
  | 'image-inpaint'
  | 'image-hd'
  | 'floorplan-colorize'
  | 'image-to-ply'
  | 'multi-view-restore'
  | 'video-gen';

interface CreateWhiteModelExecutionGroup {
  groupId: string;
  whiteModelFileId: string;
  styleReferenceFileId: string;
}

interface CreateSourceImageExecutionGroup {
  groupId: string;
  sourceFileId: string;
  stylePreset?: string;
  imageSize?: string;
  aspectRatio?: string;
}

interface CreateAIImageGenExecutionGroup {
  groupId: string;
  referenceFileIds: string[];
}

interface CreateAIImageInpaintExecutionGroup {
  groupId: string;
  sourceFileId: string;
  maskFileId: string;
}

interface CreateAIImageToPlyExecutionGroup {
  groupId: string;
  sourceFileId: string;
}

interface CreateAIMultiViewRestoreExecutionGroup {
  groupId: string;
  renderFileId: string;
  referenceFileId: string;
}

interface CreateAIVideoGenExecutionGroup {
  groupId: string;
  referenceFileIds: string[];
}

interface CreateExecutionRequestBase<
  TNodeType extends BackendExecutionNodeType,
  TTaskType extends BackendExecutionTaskType,
  TGroup,
  TExecutionMode extends string = 'legacy-grouped-task',
> {
  workflowId: string;
  nodeType: TNodeType;
  taskType: TTaskType;
  executionMode: TExecutionMode;
  nodeId: string;
  nodeTitle: string;
  groups: TGroup[];
}

type StoryboardExecutionMode = 'legacy-grouped-task' | NodeActionOnlyExecutionMode;

export type CreateWhiteModelExecutionRequest = CreateExecutionRequestBase<
  'aiModelRenderTransfer',
  'model-render-transfer',
  CreateWhiteModelExecutionGroup
> & {
  model?: string;
  imageSize?: string;
  aspectRatio?: string;
};

export type CreateAIImageHdExecutionRequest = CreateExecutionRequestBase<
  'aiImageHd',
  'image-hd',
  CreateSourceImageExecutionGroup
> & {
  model?: string;
};

export type CreateAIImageGenExecutionRequest = CreateExecutionRequestBase<
  'aiImageGen' | 'aiStoryboard',
  'image-gen',
  CreateAIImageGenExecutionGroup,
  'legacy-grouped-task' | StoryboardExecutionMode
> & {
  prompt: string;
  model?: string;
  imageSize?: string;
  aspectRatio?: string;
  quality?: string;
};

export type AIImageInpaintMaskMode = 'original-markup' | 'strong-mask';

export type CreateAIImageInpaintExecutionRequest = CreateExecutionRequestBase<
  'aiImageInpaint',
  'image-inpaint',
  CreateAIImageInpaintExecutionGroup
> & {
  prompt: string;
  model?: string;
  imageSize?: string;
  aspectRatio?: string;
  maskMode: AIImageInpaintMaskMode;
};

export type CreateAIFloorplanColorizeExecutionRequest = CreateExecutionRequestBase<
  'aiFloorplanColorize',
  'floorplan-colorize',
  CreateSourceImageExecutionGroup
> & {
  model?: string;
};

export type CreateAIImageToPlyExecutionRequest = CreateExecutionRequestBase<
  'aiImageToPly',
  'image-to-ply',
  CreateAIImageToPlyExecutionGroup
>;

export type CreateAIMultiViewRestoreExecutionRequest = CreateExecutionRequestBase<
  'aiMultiViewRestore',
  'multi-view-restore',
  CreateAIMultiViewRestoreExecutionGroup
>;

export type CreateAIVideoGenExecutionRequest = CreateExecutionRequestBase<
  'aiVideoGen' | 'aiStoryboard',
  'video-gen',
  CreateAIVideoGenExecutionGroup,
  'legacy-grouped-task' | StoryboardExecutionMode
> & {
  prompt: string;
  model: AIVideoGenSupportedModel | string;
  duration: AIVideoGenSupportedDurationSeconds;
  aspectRatio?: AIVideoGenSupportedAspectRatio | string;
  resolution?: AIVideoGenSupportedResolution | string;
  size?: AIVideoGenSupportedSize | string;
};

export type CreateBackendExecutionRequest =
  | CreateWhiteModelExecutionRequest
  | CreateAIImageGenExecutionRequest
  | CreateAIImageInpaintExecutionRequest
  | CreateAIImageHdExecutionRequest
  | CreateAIFloorplanColorizeExecutionRequest
  | CreateAIImageToPlyExecutionRequest
  | CreateAIMultiViewRestoreExecutionRequest
  | CreateAIVideoGenExecutionRequest;

interface BackendCreateExecutionResponse {
  runId: string;
  runNo: string;
  nodeType: string;
  taskType: string;
  executionMode: string;
  status: BackendExecutionStatus;
  tasks: ExecutionRuntimeCreateTaskSummary[];
}

export type BackendExecutionSummary = ExecutionRuntimeSummary;
export type BackendExecutionTaskSnapshot = ExecutionRuntimeTaskState & {
  inputFileId?: string | null;
  sourceFileId?: string | null;
  maskFileId?: string | null;
  maskMode?: string | null;
  workflowId?: string | null;
  projectId?: string | null;
  workflowTemplateKey?: string | null;
  providerTaskId?: string | null;
  providerClientId?: string | null;
  prompt?: string | null;
  referenceFileIds?: string[] | null;
  stylePreset?: string | null;
  imageSize?: string | null;
  aspectRatio?: string | null;
  inputFile?: ExecutionRuntimeBackendFile | null;
  sourceFile?: ExecutionRuntimeBackendFile | null;
  maskFile?: ExecutionRuntimeBackendFile | null;
};
export type BackendExecutionRunSnapshot = Omit<ExecutionRuntimeRunState, 'tasks'> & {
  tasks: BackendExecutionTaskSnapshot[];
};

export interface PollExecutionOptions {
  intervalMs?: number;
  signal?: AbortSignal;
  onUpdate?: (snapshot: BackendExecutionRunSnapshot) => void;
}

interface RunSnapshotHydrationOptions {
  hydrateEvents?: boolean;
  scheduleOutputPrefetch?: boolean;
}

const resultFileInfoCache = new Map<string, FileInfo>();
const scheduledExecutionOutputPrefetch = new Set<string>();
const log = createModuleLogger('backend-execution-service');
const defaultRunSnapshotHydrationOptions: Required<RunSnapshotHydrationOptions> = {
  hydrateEvents: true,
  scheduleOutputPrefetch: true,
};
const GPT_IMAGE_2_PARAMETERLESS_MODEL = 'gpt-image-2';

function isRecoverableExecutionReconcileMiss(error: AppError): boolean {
  return error.code === 'RUN_NOT_FOUND' ||
    error.message === 'RUN_NOT_FOUND' ||
    error.message === 'Execution run not found.' ||
    error.context?.backendError === 'RUN_NOT_FOUND' ||
    error.context?.backendCode === 40441;
}

function isTerminalStatus(status: BackendExecutionStatus): boolean {
  return isTerminalExecutionStatus(status);
}

function toBackendFileFormat(file: ExecutionRuntimeBackendFile): FileInfo['format'] {
  const extension = file.extension?.trim().toLowerCase();

  if (extension === 'ply') {
    return 'ply';
  }

  if (
    extension === 'jpg'
    || extension === 'jpeg'
    || extension === 'png'
    || extension === 'gif'
    || extension === 'webp'
    || extension === 'bmp'
    || extension === 'svg'
    || extension === 'mp4'
    || extension === 'webm'
    || extension === 'mov'
    || extension === 'avi'
    || extension === 'mkv'
  ) {
    return extension;
  }

  if (file.fileType === 'ply') {
    return 'ply';
  }

  if (file.fileType === 'video') {
    return 'mp4';
  }

  return 'png';
}

function toBackendFileInfoType(file: ExecutionRuntimeBackendFile): FileInfo['fileType'] {
  if (file.fileType === 'ply') {
    return 'model3d';
  }

  if (file.fileType === 'video') {
    return 'video';
  }

  return 'image';
}

function stepLabel(step: BackendExecutionStep): string {
  switch (step) {
    case 'lineart':
      return '线稿';
    case 'depth':
      return '深度图';
    case 'final':
      return '最终图';
    default:
      return '执行';
  }
}

function buildTaskMessage(
  task: BackendExecutionTaskQueryItem,
  events: ExecutionRuntimeEvent[],
): string | null {
  const lastEvent = [...events].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];

  if (task.status === 'failed') {
    return task.lastErrorMessage ?? lastEvent?.message ?? `${stepLabel(task.currentStep)}失败`;
  }

  if (task.status === 'completed') {
    return '已完成';
  }

  if (lastEvent?.phase === 'retrying') {
    const attemptNo = lastEvent.attemptNo ?? task.currentAttemptNo;
    return `第 ${attemptNo} 次尝试失败，准备重试`;
  }

  if (lastEvent?.message) {
    return lastEvent.message;
  }

  if (task.status === 'queued') {
    return '排队中';
  }

  if (task.status === 'processing') {
    return `${stepLabel(task.currentStep)}处理中`;
  }

  return null;
}

function buildTaskProgress(
  task: BackendExecutionTaskQueryItem,
  events: ExecutionRuntimeEvent[],
): number {
  const stepBase = ((): number => {
    switch (task.currentStep) {
      case 'lineart':
        return 10;
      case 'depth':
        return 35;
      case 'final':
        return 70;
      default:
        return task.status === 'queued' ? 0 : 5;
    }
  })();

  const eventProgress = [...events]
    .map((event) => event.progress)
    .filter((value) => Number.isFinite(value))
    .reduce((max, value) => Math.max(max, value), 0);

  if (task.status === 'completed') {
    return 100;
  }

  if (task.status === 'failed' || task.status === 'cancelled') {
    return Math.max(stepBase, Math.min(99, eventProgress));
  }

  return Math.max(stepBase, Math.min(99, eventProgress || stepBase));
}

async function getTaskEvents(taskId: string, signal?: AbortSignal): Promise<ExecutionRuntimeEvent[]> {
  const result = await httpClient.get<ExecutionRuntimeTaskEventEnvelope>(`/api/v1/tasks/${taskId}/events`, undefined, {
    signal,
    timeout: 30000,
  });

  if (!result.success) {
    throw result.error;
  }

  return result.data.items;
}

async function toFileInfo(file: ExecutionRuntimeBackendFile | null, signal?: AbortSignal): Promise<FileInfo | undefined> {
  if (!file?.fileId) {
    return undefined;
  }

  const cached = resultFileInfoCache.get(file.fileId);
  if (cached) {
    return cached;
  }

  const fileInfo = file.downloadUrl
    ? {
      id: file.fileId,
      name: file.displayName || file.originalName || file.fileId,
      originalName: file.originalName || file.displayName || file.fileId,
      size: file.size ?? 0,
      mimeType: file.mimeType,
      format: toBackendFileFormat(file),
      fileType: toBackendFileInfoType(file),
      status: file.status === 'ready' ? 'ready' : 'uploading',
      hash: file.sha256 ?? '',
      path: file.downloadUrl ?? `/api/v1/files/${file.fileId}/download`,
      ...(file.fileType === 'image'
        ? { thumbnailPath: file.thumbnailUrl ?? `/api/v1/files/${file.fileId}/thumbnail` }
        : {}),
      ...(file.previewUrl ? { previewPath: file.previewUrl } : {}),
      metadata: {
        ...(typeof file.width === 'number' ? { width: file.width } : {}),
        ...(typeof file.height === 'number' ? { height: file.height } : {}),
        ...(typeof file.duration === 'number' ? { duration: file.duration } : {}),
      },
      source: {
        type: 'node-output',
      },
      timestamp: {
        created: Date.parse(file.createdAt) || Date.now(),
        updated: Date.parse(file.createdAt) || Date.now(),
      },
    } satisfies FileInfo
    : await getBackendFileInfo(file.fileId, signal);

  resultFileInfoCache.set(file.fileId, fileInfo);
  return fileInfo;
}

async function resolveTaskResultFileInfo(
  task: BackendExecutionTaskQueryItem,
  signal?: AbortSignal,
): Promise<FileInfo | undefined> {
  const hydratedResultFile = await toFileInfo(task.resultFile, signal);
  if (hydratedResultFile) {
    return hydratedResultFile;
  }

  if (!task.resultFileId) {
    return undefined;
  }

  const cached = resultFileInfoCache.get(task.resultFileId);
  if (cached) {
    return cached;
  }

  const fallbackFileInfo = await getBackendFileInfo(task.resultFileId, signal);
  resultFileInfoCache.set(task.resultFileId, fallbackFileInfo);
  return fallbackFileInfo;
}

function shouldPrefetchExecutionOutputRuntimeResource(
  task: BackendExecutionTaskQueryItem,
  fileInfo: FileInfo | undefined,
): fileInfo is FileInfo {
  if (!fileInfo) {
    return false;
  }

  if (task.status !== 'completed') {
    return false;
  }

  return fileInfo.fileType === 'image' || fileInfo.fileType === 'video' || fileInfo.fileType === 'model3d';
}

function scheduleExecutionOutputRuntimePrefetch(
  task: BackendExecutionTaskQueryItem,
  fileInfo: FileInfo,
  signal?: AbortSignal,
): void {
  const runtimeStatus = getExecutionOutputRuntimeStatus(fileInfo.id);
  if (runtimeStatus === 'ready' || runtimeStatus === 'syncing') {
    return;
  }

  if (scheduledExecutionOutputPrefetch.has(fileInfo.id)) {
    return;
  }

  scheduledExecutionOutputPrefetch.add(fileInfo.id);
  log.debug('scheduleExecutionOutputRuntimePrefetch', 'Scheduling execution output runtime sync', {
    taskId: task.taskId,
    resultFileId: fileInfo.id,
    fileType: fileInfo.fileType,
    runtimeStatus,
  });

  void prefetchExecutionOutputRuntimeResource(fileInfo, { signal })
    .catch((error: unknown) => {
      log.warn('scheduleExecutionOutputRuntimePrefetch', 'Execution output runtime sync failed', {
        taskId: task.taskId,
        resultFileId: fileInfo.id,
        fileType: fileInfo.fileType,
        errorMessage: error instanceof Error ? error.message : 'unknown',
      });
    })
    .finally(() => {
      scheduledExecutionOutputPrefetch.delete(fileInfo.id);
    });
}

function buildTaskTerminalFields(task: {
  status: ExecutionRuntimeTaskState['status'];
  resultFileId: string | null;
  resultCommitStatus: ExecutionRuntimeTaskState['resultCommitStatus'];
}): Pick<ExecutionRuntimeTaskState, 'isTerminal' | 'canCommitOutput' | 'isOutputCommitted'> {
  return {
    isTerminal: isTerminalExecutionStatus(task.status),
    canCommitOutput: canCommitExecutionOutput(task.resultFileId, task.status),
    isOutputCommitted: isExecutionOutputCommitted(task.resultCommitStatus ?? 'idle'),
  };
}

async function toRunSnapshot(
  run: BackendExecutionRunDetailQuery,
  signal?: AbortSignal,
  options?: RunSnapshotHydrationOptions,
): Promise<BackendExecutionRunSnapshot> {
  const hydrationOptions = {
    ...defaultRunSnapshotHydrationOptions,
    ...options,
  };
  const tasks = await Promise.all(run.tasks.map(async (task) => {
    const events = hydrationOptions.hydrateEvents
      ? await getTaskEvents(task.taskId, signal)
      : [];
    const resultFile = await resolveTaskResultFileInfo(task, signal);
    if (
      hydrationOptions.scheduleOutputPrefetch
      && shouldPrefetchExecutionOutputRuntimeResource(task, resultFile)
    ) {
      scheduleExecutionOutputRuntimePrefetch(task, resultFile, signal);
    }
    const resultCommitStatus: ExecutionRuntimeTaskState['resultCommitStatus'] =
      task.status === 'completed' && resultFile ? 'ready' : 'idle';

    return {
      taskId: task.taskId,
      taskNo: task.taskNo,
      runId: run.runId,
      runNo: run.runNo,
      nodeId: run.nodeId,
      nodeType: run.nodeType,
      groupId: task.groupId,
      groupOrder: task.groupOrder,
      status: task.status,
      currentStep: task.currentStep,
      currentAttemptNo: task.currentAttemptNo,
      retryCount: task.retryCount,
      maxRetries: task.maxRetries,
      maxAttempts: task.maxAttempts,
      progress: buildTaskProgress(task, events),
      message: buildTaskMessage(task, events),
      error: task.lastErrorMessage,
      errorCode: task.lastErrorCode,
      lastErrorCode: task.lastErrorCode,
      inputFileId: task.inputFileId ?? null,
      sourceFileId: task.sourceFileId ?? null,
      maskFileId: task.maskFileId ?? null,
      maskMode: task.maskMode ?? null,
      workflowId: task.workflowId ?? null,
      projectId: task.projectId ?? null,
      workflowTemplateKey: task.workflowTemplateKey ?? null,
      providerTaskId: task.providerTaskId ?? null,
      providerClientId: task.providerClientId ?? null,
      prompt: task.prompt ?? null,
      referenceFileIds: task.referenceFileIds ?? null,
      stylePreset: task.stylePreset ?? null,
      imageSize: task.imageSize ?? null,
      aspectRatio: task.aspectRatio ?? null,
      ...(task.inputFile ? { inputFile: task.inputFile } : {}),
      ...(task.sourceFile ? { sourceFile: task.sourceFile } : {}),
      ...(task.maskFile ? { maskFile: task.maskFile } : {}),
      resultFileId: task.resultFileId,
      ...(resultFile ? { resultFile, resultFileInfo: resultFile } : {}),
      resultCommitStatus,
      resultCommittedAt: null,
      resultCommitError: null,
      ...buildTaskTerminalFields({
        status: task.status,
        resultFileId: task.resultFileId,
        resultCommitStatus,
      }),
    } satisfies BackendExecutionTaskSnapshot;
  }));

  const completed = tasks.filter((task) => isTerminalStatus(task.status)).length;
  const progress = tasks.length === 0
    ? 0
    : Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length);
  const hasCommittableOutput = tasks.some((task) => task.canCommitOutput);
  const allOutputsCommitted = hasCommittableOutput
    && tasks.filter((task) => task.canCommitOutput).every((task) => task.isOutputCommitted);

  const snapshot = {
    runId: run.runId,
    runNo: run.runNo,
    workflowId: run.workflowId ?? null,
    nodeId: run.nodeId,
    nodeType: run.nodeType,
    status: run.status,
    totalTaskCount: run.totalTaskCount,
    completedTaskCount: run.completedTaskCount,
    failedTaskCount: run.failedTaskCount,
    progress,
    message: completed === tasks.length
      ? '执行完成'
      : `已完成 ${completed} / ${tasks.length} 组`,
    createdAt: run.createdAt ? Date.parse(run.createdAt) : null,
    startedAt: run.startedAt ? Date.parse(run.startedAt) : null,
    completedAt: run.completedAt ? Date.parse(run.completedAt) : null,
    isTerminal: isTerminalExecutionStatus(run.status),
    hasCommittableOutput,
    allOutputsCommitted,
    tasks,
  };

  return snapshot;
}

function normalizeAspectRatio(aspectRatio: string | undefined): string | undefined {
  if (typeof aspectRatio !== 'string') {
    return undefined;
  }

  const trimmed = aspectRatio.trim();
  if (trimmed.length === 0 || trimmed === 'auto') {
    return undefined;
  }

  return trimmed;
}

function normalizeSourceImageAspectRatio(
  model: string | undefined,
  aspectRatio: string | undefined,
): string | undefined {
  const trimmedModel = normalizeOptionalString(model);
  const trimmedAspectRatio = typeof aspectRatio === 'string' ? aspectRatio.trim() : '';

  if (trimmedModel === GPT_IMAGE_2_PARAMETERLESS_MODEL) {
    return undefined;
  }

  if (trimmedModel && trimmedModel !== 'gpt-image-2-vip' && trimmedAspectRatio === 'auto') {
    return 'auto';
  }

  return normalizeAspectRatio(aspectRatio);
}

function normalizeAIImageGenAspectRatio(
  model: string | undefined,
  aspectRatio: string | undefined,
): string | undefined {
  const trimmedModel = normalizeOptionalString(model);
  const trimmedAspectRatio = typeof aspectRatio === 'string' ? aspectRatio.trim() : '';

  if (trimmedModel === GPT_IMAGE_2_PARAMETERLESS_MODEL) {
    return undefined;
  }

  if (trimmedModel === 'gpt-image-2-official' && trimmedAspectRatio === 'auto') {
    return 'auto';
  }

  return normalizeAspectRatio(aspectRatio);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function usesImageGenerationParameters(model: string | undefined): boolean {
  return normalizeOptionalString(model) !== GPT_IMAGE_2_PARAMETERLESS_MODEL;
}

function normalizeReferenceFileIds(referenceFileIds: string[]): string[] {
  return referenceFileIds
    .map((fileId) => fileId.trim())
    .filter((fileId) => fileId.length > 0);
}

function normalizePrompt(value: string): string {
  return value.trim();
}

function normalizeVeoModel(
  model: CreateAIVideoGenExecutionRequest['model'],
): AIVideoGenSupportedModel {
  return normalizeAIVideoGenModel(model) ?? 'veo-3.1-fast-generate-preview';
}

function normalizeExecutionMode(
  request: Pick<CreateBackendExecutionRequest, 'nodeType' | 'taskType' | 'executionMode'>,
): 'legacy-grouped-task' {
  if (
    request.nodeType === 'aiStoryboard'
    && (request.taskType === 'image-gen' || request.taskType === 'video-gen')
    && request.executionMode === 'node-action-only'
  ) {
    return 'legacy-grouped-task';
  }

  return 'legacy-grouped-task';
}

function toExecutionRequestBody(request: CreateBackendExecutionRequest): CreateBackendExecutionRequest {
  if (request.nodeType === 'aiModelRenderTransfer') {
    const model = normalizeOptionalString(request.model);
    const usesParameters = usesImageGenerationParameters(model);
    const imageSize = usesParameters ? normalizeOptionalString(request.imageSize) : undefined;
    const aspectRatio = usesParameters ? normalizeSourceImageAspectRatio(model, request.aspectRatio) : undefined;

    return {
      workflowId: request.workflowId,
      nodeType: 'aiModelRenderTransfer',
      taskType: 'model-render-transfer',
      executionMode: request.executionMode,
      nodeId: request.nodeId,
      nodeTitle: request.nodeTitle,
      ...(model ? { model } : {}),
      ...(imageSize ? { imageSize } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      groups: request.groups.map((group) => ({
        groupId: group.groupId,
        whiteModelFileId: group.whiteModelFileId.trim(),
        styleReferenceFileId: group.styleReferenceFileId.trim(),
      })),
    };
  }

  if (request.nodeType === 'aiImageGen' || (request.nodeType === 'aiStoryboard' && request.taskType === 'image-gen')) {
    const model = normalizeOptionalString(request.model);
    const usesParameters = usesImageGenerationParameters(model);
    const imageSize = usesParameters ? normalizeOptionalString(request.imageSize) : undefined;
    const aspectRatio = normalizeAIImageGenAspectRatio(model, request.aspectRatio);
    const quality = model === 'gpt-image-2-official'
      ? normalizeOptionalString(request.quality)
      : undefined;

    return {
      workflowId: request.workflowId,
      nodeType: request.nodeType,
      taskType: request.taskType,
      executionMode: normalizeExecutionMode(request),
      nodeId: request.nodeId,
      nodeTitle: request.nodeTitle,
      prompt: request.prompt,
      ...(model ? { model } : {}),
      ...(imageSize ? { imageSize } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(quality ? { quality } : {}),
      groups: request.groups.map((group) => ({
        groupId: group.groupId,
        referenceFileIds: normalizeReferenceFileIds(group.referenceFileIds),
      })),
    } as CreateAIImageGenExecutionRequest;
  }

  if (request.nodeType === 'aiImageInpaint') {
    const model = normalizeOptionalString(request.model);
    const usesParameters = usesImageGenerationParameters(model);
    const imageSize = usesParameters ? normalizeOptionalString(request.imageSize) : undefined;
    const aspectRatio = usesParameters ? normalizeAspectRatio(request.aspectRatio) : undefined;

    return {
      workflowId: request.workflowId,
      nodeType: request.nodeType,
      taskType: request.taskType,
      executionMode: request.executionMode,
      nodeId: request.nodeId,
      nodeTitle: request.nodeTitle,
      prompt: normalizePrompt(request.prompt),
      maskMode: request.maskMode,
      ...(model ? { model } : {}),
      ...(imageSize ? { imageSize } : {}),
      ...(aspectRatio ? { aspectRatio } : {}),
      groups: request.groups.map((group) => ({
        groupId: group.groupId,
        sourceFileId: group.sourceFileId.trim(),
        maskFileId: group.maskFileId.trim(),
      })),
    };
  }

  if (request.nodeType === 'aiImageToPly') {
    return {
      ...request,
      groups: request.groups.map((group) => ({
        groupId: group.groupId,
        sourceFileId: group.sourceFileId,
      })),
    };
  }

  if (request.nodeType === 'aiMultiViewRestore') {
    return {
      ...request,
      groups: request.groups.map((group) => ({
        groupId: group.groupId,
        renderFileId: group.renderFileId,
        referenceFileId: group.referenceFileId,
      })),
    };
  }

  if (request.nodeType === 'aiVideoGen' || (request.nodeType === 'aiStoryboard' && request.taskType === 'video-gen')) {
    const videoParameters = normalizeAIVideoGenParameters({
      aspectRatio: normalizeAIVideoGenAspectRatio(request.aspectRatio),
      resolution: normalizeAIVideoGenResolution(request.resolution),
    });

    return {
      ...request,
      executionMode: normalizeExecutionMode(request),
      prompt: normalizePrompt(request.prompt),
      model: normalizeVeoModel(request.model),
      duration: 8,
      aspectRatio: videoParameters.aspectRatio,
      resolution: videoParameters.resolution,
      size: videoParameters.size,
      groups: request.groups.map((group) => ({
        groupId: group.groupId,
        referenceFileIds: normalizeReferenceFileIds(group.referenceFileIds),
      })),
    };
  }

  if (request.nodeType === 'aiImageHd') {
    const model = normalizeOptionalString(request.model);
    const usesParameters = usesImageGenerationParameters(model);

    return {
      workflowId: request.workflowId,
      nodeType: 'aiImageHd',
      taskType: 'image-hd',
      executionMode: request.executionMode,
      nodeId: request.nodeId,
      nodeTitle: request.nodeTitle,
      ...(model ? { model } : {}),
      groups: request.groups.map((group) => ({
        groupId: group.groupId,
        sourceFileId: group.sourceFileId,
        ...(normalizeOptionalString(group.stylePreset) ? { stylePreset: normalizeOptionalString(group.stylePreset) } : {}),
        ...(usesParameters && normalizeOptionalString(group.imageSize) ? { imageSize: normalizeOptionalString(group.imageSize) } : {}),
        ...(usesParameters && normalizeSourceImageAspectRatio(model, group.aspectRatio) ? { aspectRatio: normalizeSourceImageAspectRatio(model, group.aspectRatio) } : {}),
      })),
    };
  }

  if (request.nodeType === 'aiFloorplanColorize') {
    const model = normalizeOptionalString(request.model);
    const usesParameters = usesImageGenerationParameters(model);

    return {
      workflowId: request.workflowId,
      nodeType: 'aiFloorplanColorize',
      taskType: 'floorplan-colorize',
      executionMode: request.executionMode,
      nodeId: request.nodeId,
      nodeTitle: request.nodeTitle,
      ...(model ? { model } : {}),
      groups: request.groups.map((group) => ({
        groupId: group.groupId,
        sourceFileId: group.sourceFileId,
        ...(normalizeOptionalString(group.stylePreset) ? { stylePreset: normalizeOptionalString(group.stylePreset) } : {}),
        ...(usesParameters && normalizeOptionalString(group.imageSize) ? { imageSize: normalizeOptionalString(group.imageSize) } : {}),
        ...(usesParameters && normalizeSourceImageAspectRatio(model, group.aspectRatio) ? { aspectRatio: normalizeSourceImageAspectRatio(model, group.aspectRatio) } : {}),
      })),
    };
  }

  return request;
}

export const __testOnly = {
  toExecutionRequestBody,
  toRunSnapshot,
};

export async function createGroupedExecution(
  request: CreateBackendExecutionRequest,
  signal?: AbortSignal,
): Promise<BackendExecutionSummary> {
  const result = await httpClient.post<BackendCreateExecutionResponse>('/api/v1/executions', toExecutionRequestBody(request), {
    signal,
    timeout: 60000,
  });

  if (!result.success) {
    throw result.error;
  }

  return {
    runId: result.data.runId,
    runNo: result.data.runNo,
    status: result.data.status,
    tasks: result.data.tasks,
  };
}

export async function createWhiteModelExecution(
  request: Omit<CreateWhiteModelExecutionRequest, 'nodeType' | 'taskType' | 'executionMode'>,
  signal?: AbortSignal,
): Promise<BackendExecutionSummary> {
  return createGroupedExecution({
    ...request,
    nodeType: 'aiModelRenderTransfer',
    taskType: 'model-render-transfer',
    executionMode: 'legacy-grouped-task',
  }, signal);
}

export async function getExecutionRun(runId: string, signal?: AbortSignal): Promise<BackendExecutionRunSnapshot> {
  const result = await httpClient.get<BackendExecutionRunDetailQuery>(`/api/v1/executions/${runId}`, undefined, {
    signal,
    timeout: 30000,
  });

  if (!result.success) {
    throw result.error;
  }

  return toRunSnapshot(result.data, signal);
}

export async function getLatestWorkflowNodeCompletedRun(
  workflowId: string,
  nodeId: string,
  signal?: AbortSignal,
): Promise<BackendExecutionRunSnapshot | null> {
  const result = await httpClient.get<BackendExecutionRunDetailQuery>(
    `/api/v1/workflows/${encodeURIComponent(workflowId)}/executions/reconcile`,
    {
      nodeId,
    },
    {
      signal,
      timeout: 30000,
      suppressErrorLog: true,
    },
  );

  if (!result.success) {
    if (isRecoverableExecutionReconcileMiss(result.error)) {
      log.debug('getLatestWorkflowNodeCompletedRun', 'No completed historical run found for workflow node', {
        workflowId,
        nodeId,
        code: result.error.code,
      });
      return null;
    }

    throw result.error;
  }

  return toRunSnapshot(result.data, signal, {
    hydrateEvents: false,
    scheduleOutputPrefetch: false,
  });
}

export function clearBackendExecutionCache(): void {
  resultFileInfoCache.clear();
  scheduledExecutionOutputPrefetch.clear();
}

export const backendExecutionService = {
  createGroupedExecution,
  createWhiteModelExecution,
  getExecutionRun,
  getLatestWorkflowNodeCompletedRun,
  clearBackendExecutionCache,
};
