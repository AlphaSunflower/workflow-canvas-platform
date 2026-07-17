import { getFileUrl } from '@/api/services/file-api';
import { buildRemoteImageAsset } from '@/services/image';
import { isEphemeralResourceUrl } from '@/services/protected-resource';
import type { FileMetadata, FileNodeData, FileSource, NodeId, Position } from '@/types';
import { createDefaultFileNodeData, getFileTypeFromName } from '@/utils';

import type { TaskHistoryListItem, TaskHistoryPreviewFile } from './task-history.types';

export const TASK_HISTORY_ARTIFACT_MIME_TYPE = 'application/x-workflow-task-history-artifact';

type TaskHistoryArtifactNodeType = FileNodeData['type'];

export interface TaskHistoryArtifactDragPayload {
  version: 1;
  taskId: string;
  taskNo: string;
  runId: string;
  runNo: string | null;
  nodeId: string | null;
  nodeType: string;
  nodeDisplayId: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileType: TaskHistoryArtifactNodeType;
  width?: number;
  height?: number;
  duration?: number;
  thumbnailUrl?: string;
  previewUrl?: string;
  downloadUrl?: string;
}

interface DataTransferLike {
  getData: (format: string) => string;
  setData?: (format: string, data: string) => void;
  types?: readonly string[];
}

function resolveArtifactNodeType(file: TaskHistoryPreviewFile | null): TaskHistoryArtifactNodeType | null {
  if (!file) {
    return null;
  }

  if (file.fileInfo?.fileType === 'image' || file.fileInfo?.fileType === 'video') {
    return file.fileInfo.fileType;
  }

  if (file.fileInfo?.fileType === 'model3d') {
    return 'ply';
  }

  if (file.backendFile?.fileType === 'image' || file.backendFile?.fileType === 'video') {
    return file.backendFile.fileType;
  }

  if (file.backendFile?.fileType === 'ply') {
    return 'ply';
  }

  const detectedByName = getFileTypeFromName(
    file.fileInfo?.name
      ?? file.backendFile?.displayName
      ?? file.backendFile?.originalName
      ?? '',
  );

  if (detectedByName === 'image' || detectedByName === 'video') {
    return detectedByName;
  }

  if (detectedByName === 'model3d') {
    return 'ply';
  }

  return null;
}

function resolveArtifactFileName(file: TaskHistoryPreviewFile): string {
  return file.fileInfo?.name
    ?? file.backendFile?.displayName
    ?? file.backendFile?.originalName
    ?? file.label
    ?? file.fileId;
}

function resolveArtifactMimeType(
  file: TaskHistoryPreviewFile,
  fileType: TaskHistoryArtifactNodeType,
): string {
  const resolved = file.fileInfo?.mimeType ?? file.backendFile?.mimeType;
  if (typeof resolved === 'string' && resolved.trim().length > 0) {
    return resolved;
  }

  switch (fileType) {
    case 'image':
      return 'image/png';
    case 'video':
      return 'video/mp4';
    case 'ply':
      return 'application/octet-stream';
  }
}

function resolveArtifactMetadata(file: TaskHistoryPreviewFile): FileMetadata {
  return {
    ...(typeof file.fileInfo?.metadata.width === 'number'
      ? { width: file.fileInfo.metadata.width }
      : typeof file.backendFile?.width === 'number'
        ? { width: file.backendFile.width }
        : {}),
    ...(typeof file.fileInfo?.metadata.height === 'number'
      ? { height: file.fileInfo.metadata.height }
      : typeof file.backendFile?.height === 'number'
        ? { height: file.backendFile.height }
        : {}),
    ...(typeof file.fileInfo?.metadata.duration === 'number'
      ? { duration: file.fileInfo.metadata.duration }
      : typeof file.backendFile?.duration === 'number'
        ? { duration: file.backendFile.duration }
        : {}),
  };
}

function resolveArtifactThumbnailUrl(
  file: TaskHistoryPreviewFile,
  fileType: TaskHistoryArtifactNodeType,
): string | undefined {
  return file.backendFile?.thumbnailUrl
    ?? (fileType === 'image' ? file.backendFile?.previewUrl : undefined)
    ?? (isEphemeralResourceUrl(file.fileInfo?.thumbnailPath) ? undefined : file.fileInfo?.thumbnailPath)
    ?? (fileType === 'image' ? getFileUrl(file.fileId, 'thumbnail') : undefined);
}

function resolveArtifactPreviewUrl(
  file: TaskHistoryPreviewFile,
  fileType: TaskHistoryArtifactNodeType,
): string | undefined {
  if (fileType === 'video') {
    return file.backendFile?.previewUrl
      ?? (isEphemeralResourceUrl(file.fileInfo?.path) ? undefined : file.fileInfo?.path)
      ?? file.backendFile?.downloadUrl
      ?? getFileUrl(file.fileId, 'preview');
  }

  return file.backendFile?.previewUrl;
}

function resolveArtifactDownloadUrl(file: TaskHistoryPreviewFile): string {
  return file.backendFile?.downloadUrl
    ?? (isEphemeralResourceUrl(file.fileInfo?.path) ? undefined : file.fileInfo?.path)
    ?? getFileUrl(file.fileId, 'download');
}

function buildTaskHistoryArtifactSource(payload: TaskHistoryArtifactDragPayload): FileSource {
  return {
    type: 'node-output',
    producerNodeId: payload.nodeId ?? `task-history:${payload.taskId}`,
    producerNodeDisplayId: payload.nodeDisplayId ?? payload.nodeId ?? payload.nodeType,
    producerNodeType: payload.nodeType,
    taskId: payload.taskId,
    taskNo: payload.taskNo,
    taskCreatedAt: payload.createdAt,
    ...(payload.startedAt !== null ? { taskStartedAt: payload.startedAt } : {}),
    ...(payload.completedAt !== null ? { taskCompletedAt: payload.completedAt } : {}),
  };
}

export function buildTaskHistoryArtifactDragPayload(
  item: TaskHistoryListItem,
  artifact: TaskHistoryPreviewFile | null,
): TaskHistoryArtifactDragPayload | null {
  const fileType = resolveArtifactNodeType(artifact);
  if (!artifact || !fileType) {
    return null;
  }

  const metadata = resolveArtifactMetadata(artifact);

  return {
    version: 1,
    taskId: item.taskId,
    taskNo: item.taskNo,
    runId: item.runId,
    runNo: item.runNo,
    nodeId: item.nodeId,
    nodeType: item.nodeType,
    nodeDisplayId: item.relatedTaskRef?.nodeDisplayId ?? item.nodeId ?? null,
    createdAt: item.createdAt,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    fileId: artifact.fileId,
    fileName: resolveArtifactFileName(artifact),
    fileSize: artifact.fileInfo?.size ?? artifact.backendFile?.size ?? 0,
    mimeType: resolveArtifactMimeType(artifact, fileType),
    fileType,
    ...(typeof metadata.width === 'number' ? { width: metadata.width } : {}),
    ...(typeof metadata.height === 'number' ? { height: metadata.height } : {}),
    ...(typeof metadata.duration === 'number' ? { duration: metadata.duration } : {}),
    ...(resolveArtifactThumbnailUrl(artifact, fileType)
      ? { thumbnailUrl: resolveArtifactThumbnailUrl(artifact, fileType) }
      : {}),
    ...(resolveArtifactPreviewUrl(artifact, fileType)
      ? { previewUrl: resolveArtifactPreviewUrl(artifact, fileType) }
      : {}),
    downloadUrl: resolveArtifactDownloadUrl(artifact),
  };
}

export function hasTaskHistoryArtifactDragPayload(dataTransfer: Pick<DataTransferLike, 'types'> | null | undefined): boolean {
  return Array.from(dataTransfer?.types ?? []).includes(TASK_HISTORY_ARTIFACT_MIME_TYPE);
}

export function serializeTaskHistoryArtifactDragPayload(payload: TaskHistoryArtifactDragPayload): string {
  return JSON.stringify(payload);
}

export function parseTaskHistoryArtifactDragPayload(raw: string | null | undefined): TaskHistoryArtifactDragPayload | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<TaskHistoryArtifactDragPayload>;

    if (
      parsed.version !== 1
      || typeof parsed.taskId !== 'string'
      || typeof parsed.taskNo !== 'string'
      || typeof parsed.runId !== 'string'
      || typeof parsed.nodeType !== 'string'
      || typeof parsed.fileId !== 'string'
      || typeof parsed.fileName !== 'string'
      || typeof parsed.mimeType !== 'string'
      || (parsed.fileType !== 'image' && parsed.fileType !== 'video' && parsed.fileType !== 'ply')
    ) {
      return null;
    }

    return {
      version: 1,
      taskId: parsed.taskId,
      taskNo: parsed.taskNo,
      runId: parsed.runId,
      runNo: typeof parsed.runNo === 'string' ? parsed.runNo : null,
      nodeId: typeof parsed.nodeId === 'string' ? parsed.nodeId : null,
      nodeType: parsed.nodeType,
      nodeDisplayId: typeof parsed.nodeDisplayId === 'string' ? parsed.nodeDisplayId : null,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : null,
      completedAt: typeof parsed.completedAt === 'number' ? parsed.completedAt : null,
      fileId: parsed.fileId,
      fileName: parsed.fileName,
      fileSize: typeof parsed.fileSize === 'number' ? parsed.fileSize : 0,
      mimeType: parsed.mimeType,
      fileType: parsed.fileType,
      ...(typeof parsed.width === 'number' ? { width: parsed.width } : {}),
      ...(typeof parsed.height === 'number' ? { height: parsed.height } : {}),
      ...(typeof parsed.duration === 'number' ? { duration: parsed.duration } : {}),
      ...(typeof parsed.thumbnailUrl === 'string' ? { thumbnailUrl: parsed.thumbnailUrl } : {}),
      ...(typeof parsed.previewUrl === 'string' ? { previewUrl: parsed.previewUrl } : {}),
      ...(typeof parsed.downloadUrl === 'string' ? { downloadUrl: parsed.downloadUrl } : {}),
    };
  } catch {
    return null;
  }
}

export function readTaskHistoryArtifactDragPayload(dataTransfer: DataTransferLike | null | undefined): TaskHistoryArtifactDragPayload | null {
  if (!dataTransfer || !hasTaskHistoryArtifactDragPayload(dataTransfer)) {
    return null;
  }

  return parseTaskHistoryArtifactDragPayload(dataTransfer.getData(TASK_HISTORY_ARTIFACT_MIME_TYPE));
}

export function writeTaskHistoryArtifactDragPayload(
  dataTransfer: Pick<DataTransferLike, 'setData'> | null | undefined,
  payload: TaskHistoryArtifactDragPayload,
): void {
  if (!dataTransfer?.setData) {
    return;
  }

  dataTransfer.setData(TASK_HISTORY_ARTIFACT_MIME_TYPE, serializeTaskHistoryArtifactDragPayload(payload));
  dataTransfer.setData('text/plain', payload.fileName);
}

export function createFileNodeFromTaskHistoryArtifact(
  payload: TaskHistoryArtifactDragPayload,
  nodeId: NodeId,
  position: Position,
): FileNodeData {
  const metadata: FileMetadata = {
    ...(typeof payload.width === 'number' ? { width: payload.width } : {}),
    ...(typeof payload.height === 'number' ? { height: payload.height } : {}),
    ...(typeof payload.duration === 'number' ? { duration: payload.duration } : {}),
  };
  const source = buildTaskHistoryArtifactSource(payload);
  const node = createDefaultFileNodeData(
    nodeId,
    position,
    payload.fileType,
    payload.fileId,
    payload.fileName,
    payload.fileSize,
    payload.mimeType,
    metadata,
    source,
  );

  node.backendFileId = payload.fileId;

  if (payload.fileType === 'image') {
    const remoteImage = buildRemoteImageAsset(payload.fileId, metadata, {
      thumbnailUrl: payload.thumbnailUrl,
      originalUrl: payload.downloadUrl,
      getUrl: (fileId, type) => getFileUrl(fileId, type === 'download' ? 'download' : 'thumbnail'),
    });
    node.imageAsset = remoteImage.imageAsset;
    node.thumbnailUrl = remoteImage.thumbnailUrl;
    node.previewUrl = undefined;
    return node;
  }

  node.imageAsset = undefined;
  node.thumbnailUrl = payload.thumbnailUrl;

  if (payload.fileType === 'video') {
    node.previewUrl = payload.previewUrl ?? payload.downloadUrl ?? getFileUrl(payload.fileId, 'preview');
    return node;
  }

  node.previewUrl = undefined;
  return node;
}

export const __testOnly = {
  resolveArtifactNodeType,
};
