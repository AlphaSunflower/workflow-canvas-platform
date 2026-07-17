import type { FileInfo, WorkflowRelatedTaskRef } from '@/types';
import type { BackendExecutionRunSnapshot } from '@/services/backendExecutionService';
import { getBackendFileInfo } from '@/services/backendFileService';
import { isEphemeralResourceUrl } from '@/services/protected-resource';
import { getExecutionErrorUserMessage } from '@/constants/executionMessages';
import type {
  TaskHistoryDetail,
  TaskHistoryDetailInputFileSummary,
  TaskHistoryListItem,
  TaskHistoryPreviewFile,
  WorkflowTaskHistoryBackendTaskItem,
  WorkflowTaskHistoryDetailResponse,
} from '@/components/canvas/task-history.types';
import type {
  ExecutionRuntimeBackendFile,
  ExecutionRuntimeEvent,
} from '@/execution-runtime/execution-runtime.types';

function sanitizePersistentUrl(url: string | undefined): string | undefined {
  return isEphemeralResourceUrl(url) ? undefined : url;
}

function hasPersistentFileInfoPreview(fileInfo: FileInfo | undefined): boolean {
  if (!fileInfo) {
    return false;
  }

  return Boolean(
    sanitizePersistentUrl(fileInfo.thumbnailPath)
    || sanitizePersistentUrl(fileInfo.previewPath)
    || sanitizePersistentUrl(fileInfo.path),
  );
}

function toBackendFileFromFileInfo(fileInfo: FileInfo): ExecutionRuntimeBackendFile {
  const normalizedFileType: ExecutionRuntimeBackendFile['fileType'] = fileInfo.fileType === 'video'
    ? 'video'
    : fileInfo.fileType === 'model3d'
      ? 'ply'
      : 'image';
  const metadata = fileInfo.metadata ?? {};

  return {
    fileId: fileInfo.id,
    originalName: fileInfo.originalName || fileInfo.name,
    displayName: fileInfo.name,
    mimeType: fileInfo.mimeType,
    fileType: normalizedFileType,
    sourceType: 'output',
    sha256: fileInfo.hash ?? null,
    size: Number.isFinite(fileInfo.size) ? fileInfo.size : null,
    extension: typeof fileInfo.format === 'string' ? fileInfo.format : null,
    width: typeof metadata.width === 'number' ? metadata.width : null,
    height: typeof metadata.height === 'number' ? metadata.height : null,
    duration: typeof metadata.duration === 'number' ? metadata.duration : null,
    status: fileInfo.status === 'ready' ? 'ready' : 'pending_upload',
    createdAt: new Date(fileInfo.timestamp.created).toISOString(),
    downloadUrl: sanitizePersistentUrl(fileInfo.path),
    thumbnailUrl: sanitizePersistentUrl(fileInfo.thumbnailPath),
    previewUrl: normalizedFileType === 'video'
      ? sanitizePersistentUrl(fileInfo.previewPath) ?? sanitizePersistentUrl(fileInfo.path)
      : sanitizePersistentUrl(fileInfo.previewPath) ?? sanitizePersistentUrl(fileInfo.thumbnailPath),
  };
}

function toTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTerminalStatus(status: WorkflowTaskHistoryBackendTaskItem['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function toFileInfoFromBackendFile(file: ExecutionRuntimeBackendFile): FileInfo {
  const extension = file.extension?.trim().toLowerCase();
  const format: FileInfo['format'] = extension === 'ply'
    ? 'ply'
    : (
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
    )
      ? extension
      : file.fileType === 'ply'
        ? 'ply'
        : file.fileType === 'video'
          ? 'mp4'
          : 'png';

  const fileType: FileInfo['fileType'] = file.fileType === 'ply'
    ? 'model3d'
    : file.fileType === 'video'
      ? 'video'
      : 'image';

  return {
    id: file.fileId,
    name: file.displayName || file.originalName || file.fileId,
    originalName: file.originalName || file.displayName || file.fileId,
    size: file.size ?? 0,
    mimeType: file.mimeType,
    format,
    fileType,
    status: file.status === 'ready' ? 'ready' : 'uploading',
    hash: file.sha256 ?? '',
    path: file.downloadUrl ?? `/api/v1/files/${file.fileId}/download`,
    ...(file.thumbnailUrl || file.previewUrl || file.fileType === 'image'
      ? { thumbnailPath: file.thumbnailUrl ?? file.previewUrl ?? `/api/v1/files/${file.fileId}/thumbnail` }
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
      created: toTimestamp(file.createdAt) ?? Date.now(),
      updated: toTimestamp(file.createdAt) ?? Date.now(),
    },
  };
}

async function resolvePreviewFileInfo(
  fileId: string,
  backendFile?: ExecutionRuntimeBackendFile | null,
): Promise<FileInfo | undefined> {
  if (backendFile) {
    return toFileInfoFromBackendFile(backendFile);
  }

  try {
    return await getBackendFileInfo(fileId);
  } catch {
    return undefined;
  }
}

async function hydratePreviewItem(
  item: Omit<TaskHistoryPreviewFile, 'fileInfo'>,
): Promise<TaskHistoryPreviewFile> {
  const fileInfo = await resolvePreviewFileInfo(item.fileId, item.backendFile);
  const backendFile = item.backendFile ?? (
    fileInfo && hasPersistentFileInfoPreview(fileInfo)
      ? toBackendFileFromFileInfo(fileInfo)
      : null
  );

  return {
    ...item,
    ...(fileInfo ? { fileInfo } : {}),
    backendFile,
  };
}

function buildPreviewItemInput(
  role: TaskHistoryPreviewFile['role'],
  label: string,
  order: number,
  fileId: string | null | undefined,
  backendFile?: ExecutionRuntimeBackendFile | null,
  isPrimary?: boolean,
): null | Omit<TaskHistoryPreviewFile, 'fileInfo'> {
  if (typeof fileId !== 'string' || fileId.trim().length === 0) {
    return null;
  }

  return {
    fileId,
    backendFile: backendFile ?? null,
    role,
    label,
    order,
    ...(isPrimary ? { isPrimary: true } : {}),
  };
}

async function hydratePreviewItems(
  items: Array<Omit<TaskHistoryPreviewFile, 'fileInfo'>>,
): Promise<TaskHistoryPreviewFile[]> {
  const hydrated = await Promise.all(items.map((item) => hydratePreviewItem(item)));

  return hydrated.sort((left, right) => left.order - right.order);
}

function collectReferencePreviewSeeds(
  task: WorkflowTaskHistoryBackendTaskItem,
): Array<Omit<TaskHistoryPreviewFile, 'fileInfo'>> {
  const items: Array<Omit<TaskHistoryPreviewFile, 'fileInfo'>> = [];

  const push = (item: ReturnType<typeof buildPreviewItemInput>): void => {
    if (item) {
      items.push(item);
    }
  };

  if (task.taskType === 'image-inpaint' || task.nodeType === 'aiImageInpaint') {
    push(buildPreviewItemInput('input', '原图', 0, task.sourceFileId ?? task.inputFileId, task.sourceFile ?? task.inputFile));
    push(buildPreviewItemInput('mask', '标记图', 1, task.maskFileId, task.maskFile));

    return items;
  }

  push(buildPreviewItemInput('input', '输入图', 0, task.inputFileId, task.inputFile));
  push(buildPreviewItemInput('input', '源图', 1, task.sourceFileId, task.sourceFile));
  push(buildPreviewItemInput('render', '渲染图', 2, task.renderFileId, task.renderFile));
  push(buildPreviewItemInput('reference', '参考图', 3, task.referenceFileId, task.referenceFile));
  push(buildPreviewItemInput('white-model', '白模图', 4, task.whiteModelFileId, task.whiteModelFile));
  push(buildPreviewItemInput('style-reference', '风格参考图', 5, task.styleReferenceFileId, task.styleReferenceFile));

  (task.referenceFileIds ?? []).forEach((fileId, index) => {
    const baseOrder = 10 + index;
    push(buildPreviewItemInput('reference', `参考图 ${index + 1}`, baseOrder, fileId));
  });

  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.fileId)) {
      return false;
    }

    seen.add(item.fileId);
    return true;
  });
}

function collectArtifactPreviewSeeds(
  task: WorkflowTaskHistoryBackendTaskItem,
): Array<Omit<TaskHistoryPreviewFile, 'fileInfo'>> {
  const result = buildPreviewItemInput(
    'result',
    task.taskType === 'image-inpaint' || task.nodeType === 'aiImageInpaint'
      ? '重绘结果'
      : '任务产物',
    0,
    task.resultFileId,
    task.resultFile,
    true,
  );

  return result ? [result] : [];
}

function buildTitle(task: WorkflowTaskHistoryBackendTaskItem): string {
  const nodeTitle = task.nodeTitle?.trim();
  if (nodeTitle) {
    return nodeTitle;
  }

  return task.taskNo;
}

function buildSubtitle(task: WorkflowTaskHistoryBackendTaskItem): string | null {
  const parts = [
    task.groupOrder !== null && task.groupOrder !== undefined ? `第 ${task.groupOrder + 1} 组` : null,
    task.model,
    task.taskType,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return parts.length > 0 ? parts.join(' · ') : null;
}

function buildMessage(
  task: WorkflowTaskHistoryBackendTaskItem,
  events: ExecutionRuntimeEvent[],
): string | null {
  const latestEvent = [...events].sort((left, right) =>
    (toTimestamp(right.timestamp) ?? 0) - (toTimestamp(left.timestamp) ?? 0))[0];

  if (task.status === 'failed') {
    return getExecutionErrorUserMessage(
      task.lastErrorCode,
      task.lastErrorMessage ?? latestEvent?.message ?? undefined,
    ) ?? task.lastErrorMessage ?? latestEvent?.message ?? '任务失败';
  }

  if (task.status === 'cancelled') {
    return latestEvent?.message ?? '任务已取消';
  }

  if (task.status === 'completed') {
    return latestEvent?.message ?? '任务已完成';
  }

  return latestEvent?.message ?? null;
}

function findRelatedTaskRef(
  task: WorkflowTaskHistoryBackendTaskItem,
  relatedTasks?: WorkflowRelatedTaskRef[],
): WorkflowRelatedTaskRef | undefined {
  return relatedTasks?.find((item) => item.taskId === task.taskId);
}

function buildInputFileSummaries(
  items: TaskHistoryPreviewFile[],
): TaskHistoryDetailInputFileSummary[] {
  return items.map((item, index) => {
    const fileInfo = item.fileInfo;
    const backendFile = item.backendFile;
    const fileName = fileInfo?.name
      ?? fileInfo?.originalName
      ?? backendFile?.displayName
      ?? backendFile?.originalName
      ?? item.fileId;
    const fileType = fileInfo?.fileType
      ?? (backendFile?.fileType === 'video'
        ? 'video'
        : backendFile?.fileType === 'ply'
          ? 'model3d'
          : backendFile?.fileType === 'image'
            ? 'image'
            : 'unknown');
    const size = typeof fileInfo?.size === 'number'
      ? fileInfo.size
      : typeof backendFile?.size === 'number'
        ? backendFile.size
        : null;
    const width = typeof fileInfo?.metadata.width === 'number'
      ? fileInfo.metadata.width
      : typeof backendFile?.width === 'number'
        ? backendFile.width
        : null;
    const height = typeof fileInfo?.metadata.height === 'number'
      ? fileInfo.metadata.height
      : typeof backendFile?.height === 'number'
        ? backendFile.height
        : null;
    const duration = typeof fileInfo?.metadata.duration === 'number'
      ? fileInfo.metadata.duration
      : typeof backendFile?.duration === 'number'
        ? backendFile.duration
        : null;

    return {
      key: `${item.fileId}:${item.role}:${item.order}:${index}`,
      fileId: item.fileId,
      role: item.role,
      label: item.label,
      fileName,
      fileType,
      mimeType: fileInfo?.mimeType ?? backendFile?.mimeType ?? null,
      format: fileInfo?.format ?? backendFile?.extension ?? null,
      size,
      width,
      height,
      duration,
    };
  });
}

export async function normalizeWorkflowTaskHistoryItem(
  task: WorkflowTaskHistoryBackendTaskItem,
  options?: {
    events?: ExecutionRuntimeEvent[];
    relatedTasks?: WorkflowRelatedTaskRef[];
  },
): Promise<TaskHistoryListItem> {
  const events = options?.events ?? [];
  const [inputPreviewItems, artifactPreviewItems] = await Promise.all([
    hydratePreviewItems(collectReferencePreviewSeeds(task)),
    hydratePreviewItems(collectArtifactPreviewSeeds(task)),
  ]);
  const latestEventAt = [...events]
    .map((event) => toTimestamp(event.timestamp))
    .filter((value): value is number => typeof value === 'number')
    .sort((left, right) => right - left)[0] ?? null;
  const isFailed = task.status === 'failed';
  const isCancelled = task.status === 'cancelled';
  const isSuccessful = task.status === 'completed';

  return {
    taskId: task.taskId,
    taskNo: task.taskNo,
    runId: task.runId,
    runNo: task.runNo,
    workflowId: task.workflowId,
    projectId: task.projectId,
    nodeId: task.nodeId ?? null,
    nodeTitle: task.nodeTitle ?? null,
    nodeType: task.nodeType,
    taskType: task.taskType,
    groupId: task.groupId,
    groupOrder: task.groupOrder,
    status: task.status,
    currentStep: task.currentStep,
    createdAt: toTimestamp(task.createdAt) ?? 0,
    startedAt: toTimestamp(task.startedAt),
    completedAt: toTimestamp(task.completedAt),
    durationMs: typeof task.durationMs === 'number' ? task.durationMs : null,
    provider: task.provider,
    model: task.model,
    title: buildTitle(task),
    subtitle: buildSubtitle(task),
    message: buildMessage(task, events),
    errorCode: task.lastErrorCode,
    errorMessage: task.lastErrorMessage,
    latestEventAt,
    isTerminal: isTerminalStatus(task.status),
    isFailed,
    isCancelled,
    isSuccessful,
    inputPreviewItems,
    artifactPreviewItems,
    primaryArtifact: artifactPreviewItems[0] ?? null,
    recentEvents: events,
    relatedTaskRef: findRelatedTaskRef(task, options?.relatedTasks),
    raw: task,
  };
}

export async function normalizeWorkflowTaskHistoryList(
  tasks: WorkflowTaskHistoryBackendTaskItem[],
  options?: {
    relatedTasks?: WorkflowRelatedTaskRef[];
  },
): Promise<TaskHistoryListItem[]> {
  const items = await Promise.all(tasks.map((task) => normalizeWorkflowTaskHistoryItem(task, {
    relatedTasks: options?.relatedTasks,
  })));

  return items.sort((left, right) => right.createdAt - left.createdAt);
}

export async function normalizeWorkflowTaskHistoryDetail(
  task: WorkflowTaskHistoryDetailResponse,
  options?: {
    events?: ExecutionRuntimeEvent[];
    runDetail?: BackendExecutionRunSnapshot;
    relatedTasks?: WorkflowRelatedTaskRef[];
  },
): Promise<TaskHistoryDetail> {
  const events = options?.events ?? task.recentEvents ?? [];
  const base = await normalizeWorkflowTaskHistoryItem(task, {
    events,
    relatedTasks: options?.relatedTasks,
  });

  return {
    ...base,
    provider: base.provider ?? null,
    model: base.model ?? null,
    title: base.title ?? task.nodeTitle ?? task.taskNo,
    subtitle: base.subtitle ?? null,
    latestEventAt: base.latestEventAt ?? null,
    inputPreviewItems: base.inputPreviewItems ?? [],
    recentEvents: base.recentEvents ?? [],
    raw: base.raw ?? task,
    events,
    eventCount: events.length,
    inputFileSummaries: buildInputFileSummaries(base.inputPreviewItems ?? []),
    ...(options?.runDetail ? { runDetail: options.runDetail } : {}),
  };
}

export const __testOnly = {
  sanitizePersistentUrl,
  hasPersistentFileInfoPreview,
};
