import { memo, useCallback, useMemo } from 'react';

import { FileThumbnail } from '@/components/file';
import { useProtectedResourceUrl } from '@/hooks/file';
import { isEphemeralResourceUrl } from '@/services/protected-resource';
import type { TaskHistoryListItem, TaskHistoryPreviewFile } from './task-history.types';
import {
  buildTaskHistoryArtifactDragPayload,
  writeTaskHistoryArtifactDragPayload,
} from './task-history-artifact-dnd';

interface TaskHistoryArtifactPreviewProps {
  item: TaskHistoryListItem;
}

function getArtifactFile(item: TaskHistoryListItem): TaskHistoryPreviewFile | null {
  return item.primaryArtifact ?? item.artifactPreviewItems[0] ?? null;
}

function getArtifactType(file: TaskHistoryPreviewFile | null): 'image' | 'video' | 'model3d' | 'unknown' {
  if (!file) {
    return 'unknown';
  }

  return file.fileInfo?.fileType
    ?? (file.backendFile?.fileType === 'video'
      ? 'video'
      : file.backendFile?.fileType === 'ply'
        ? 'model3d'
        : file.backendFile?.fileType === 'image'
          ? 'image'
          : 'unknown');
}

interface ArtifactPreviewSourcePair {
  primary?: string;
  fallback?: string;
}

function toDistinctCandidateUrls(candidates: Array<string | undefined>): string[] {
  const urls: string[] = [];

  candidates.forEach((candidate) => {
    if (!candidate || urls.includes(candidate)) {
      return;
    }

    urls.push(candidate);
  });

  return urls;
}

function getArtifactPersistentPreviewUrls(file: TaskHistoryPreviewFile | null): string[] {
  if (!file) {
    return [];
  }

  const fileType = getArtifactType(file);
  const persistentThumbnail = file.backendFile?.thumbnailUrl;
  const persistentPreview = file.backendFile?.previewUrl;
  const persistentDownload = file.backendFile?.downloadUrl;
  const fileInfoThumbnail = isEphemeralResourceUrl(file.fileInfo?.thumbnailPath)
    ? undefined
    : file.fileInfo?.thumbnailPath;
  const fileInfoPreview = isEphemeralResourceUrl(file.fileInfo?.previewPath)
    ? undefined
    : file.fileInfo?.previewPath;
  const fileInfoPath = isEphemeralResourceUrl(file.fileInfo?.path)
    ? undefined
    : file.fileInfo?.path;

  if (fileType === 'image') {
    return toDistinctCandidateUrls([
      persistentThumbnail,
      persistentPreview,
      fileInfoThumbnail,
      fileInfoPreview,
    ]);
  }

  if (fileType === 'video') {
    return toDistinctCandidateUrls([
      persistentPreview,
      persistentDownload,
      fileInfoPreview,
      fileInfoPath,
    ]);
  }

  return toDistinctCandidateUrls([
    persistentThumbnail,
    persistentPreview,
    persistentDownload,
    fileInfoThumbnail,
    fileInfoPreview,
    fileInfoPath,
  ]);
}

function getArtifactEphemeralPreviewUrl(file: TaskHistoryPreviewFile | null): string | undefined {
  if (!file) {
    return undefined;
  }

  if (isEphemeralResourceUrl(file.fileInfo?.thumbnailPath)) {
    return file.fileInfo?.thumbnailPath;
  }

  if (isEphemeralResourceUrl(file.fileInfo?.path)) {
    return file.fileInfo?.path;
  }

  return undefined;
}

function getArtifactPreviewSources(file: TaskHistoryPreviewFile | null): ArtifactPreviewSourcePair {
  const persistentUrls = getArtifactPersistentPreviewUrls(file);
  if (persistentUrls.length > 0) {
    return {
      primary: persistentUrls[0],
      fallback: persistentUrls[1],
    };
  }

  const ephemeral = getArtifactEphemeralPreviewUrl(file);
  if (!ephemeral) {
    return {};
  }

  return {
    primary: ephemeral,
    fallback: undefined,
  };
}

function getArtifactPreviewUrl(file: TaskHistoryPreviewFile | null): string | undefined {
  return getArtifactPreviewSources(file).primary;
}

function getArtifactFallbackUrl(file: TaskHistoryPreviewFile | null): string | undefined {
  return getArtifactPreviewSources(file).fallback;
}

function getArtifactDownloadUrl(file: TaskHistoryPreviewFile | null): string | undefined {
  if (!file) {
    return undefined;
  }

  return file.backendFile?.downloadUrl
    ?? (isEphemeralResourceUrl(file.fileInfo?.path) ? undefined : file.fileInfo?.path);
}

function getStateTitle(item: TaskHistoryListItem): string {
  if (item.isCancelled) {
    return '任务已取消';
  }
  if (item.isFailed) {
    return '任务失败';
  }
  if (!item.isTerminal) {
    return '任务进行中';
  }
  return '暂无产物';
}

function getStateMessage(item: TaskHistoryListItem): string {
  return item.errorMessage
    ?? item.message
    ?? (item.isCancelled ? '该任务已被取消，未生成可预览产物。' : item.isFailed
      ? '任务执行失败，未生成可预览产物。'
      : '当前还没有可预览的任务产物。');
}

export const TaskHistoryArtifactPreview = memo(({
  item,
}: TaskHistoryArtifactPreviewProps) => {
  const artifact = getArtifactFile(item);
  const artifactType = getArtifactType(artifact);
  const artifactSectionTitle = artifact?.label ?? '产物';
  const dragPayload = useMemo(
    () => buildTaskHistoryArtifactDragPayload(item, artifact),
    [artifact, item],
  );
  const previewSources = useMemo(
    () => getArtifactPreviewSources(artifact),
    [artifact],
  );
  const previewUrl = previewSources.primary;
  const fallbackPreviewUrl = previewSources.fallback;
  const downloadUrl = getArtifactDownloadUrl(artifact);
  const { resolvedUrl } = useProtectedResourceUrl(previewUrl, {
    enabled: Boolean(previewUrl) && artifactType === 'video',
  });
  const resolvedVideoUrl = resolvedUrl ?? fallbackPreviewUrl;
  const statusToneClass = item.isFailed
    ? 'canvas-task-history-card__artifact-state--failed'
    : item.isCancelled
      ? 'canvas-task-history-card__artifact-state--cancelled'
      : 'canvas-task-history-card__artifact-state--pending';

  const meta = useMemo(() => {
    if (!artifact?.fileInfo) {
      return null;
    }

    const parts: string[] = [];
    if (typeof artifact.fileInfo.metadata.width === 'number' && typeof artifact.fileInfo.metadata.height === 'number') {
      parts.push(`${artifact.fileInfo.metadata.width} × ${artifact.fileInfo.metadata.height}`);
    }
    if (typeof artifact.fileInfo.metadata.duration === 'number' && Number.isFinite(artifact.fileInfo.metadata.duration)) {
      parts.push(`${artifact.fileInfo.metadata.duration.toFixed(1)} 秒`);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [artifact]);

  const handleDragStart = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!dragPayload) {
      event.preventDefault();
      return;
    }

    writeTaskHistoryArtifactDragPayload(event.dataTransfer, dragPayload);
    event.dataTransfer.effectAllowed = 'copy';
  }, [dragPayload]);

  const draggableProps = dragPayload
    ? {
      draggable: true,
      onDragStart: handleDragStart,
      title: '拖放到画布以创建文件节点',
    }
    : undefined;

  if (!artifact) {
    return (
      <div className="canvas-task-history-card__section">
        <div className="canvas-task-history-card__section-title">{artifactSectionTitle}</div>
        <div className={`canvas-task-history-card__artifact-state ${statusToneClass}`}>
          <div className="canvas-task-history-card__artifact-state-title">{getStateTitle(item)}</div>
          <div className="canvas-task-history-card__artifact-state-text">{getStateMessage(item)}</div>
        </div>
      </div>
    );
  }

  if (artifactType === 'image') {
    return (
      <div className="canvas-task-history-card__section">
        <div className="canvas-task-history-card__section-title">{artifactSectionTitle}</div>
        <div
          className="canvas-task-history-card__artifact-media canvas-task-history-card__artifact-media--draggable"
          {...draggableProps}
        >
          <FileThumbnail
            src={previewUrl}
            fallbackSrc={fallbackPreviewUrl}
            alt={artifact.fileInfo?.name ?? artifact.label}
            fileType="image"
            width={280}
            height={220}
            className="canvas-task-history-card__artifact-thumbnail"
          />
        </div>
        <div className="canvas-task-history-card__artifact-caption">
          <div className="canvas-task-history-card__artifact-name" title={artifact.fileInfo?.name ?? artifact.label}>
            {artifact.fileInfo?.name ?? artifact.label}
          </div>
          {meta && <div className="canvas-task-history-card__artifact-meta">{meta}</div>}
        </div>
      </div>
    );
  }

  if (artifactType === 'video' && resolvedVideoUrl) {
    return (
      <div className="canvas-task-history-card__section">
        <div className="canvas-task-history-card__section-title">产物</div>
        <div
          className="canvas-task-history-card__artifact-video-frame canvas-task-history-card__artifact-video-frame--draggable"
          {...draggableProps}
        >
          <video
            className="canvas-task-history-card__artifact-video"
            src={resolvedVideoUrl}
            controls
            preload="metadata"
          />
        </div>
        <div className="canvas-task-history-card__artifact-caption">
          <div className="canvas-task-history-card__artifact-name" title={artifact.fileInfo?.name ?? artifact.label}>
            {artifact.fileInfo?.name ?? artifact.label}
          </div>
          {meta && <div className="canvas-task-history-card__artifact-meta">{meta}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-task-history-card__section">
      <div className="canvas-task-history-card__section-title">{artifactSectionTitle}</div>
      <div
        className="canvas-task-history-card__artifact-file-card canvas-task-history-card__artifact-file-card--draggable"
        {...draggableProps}
      >
        <FileThumbnail
          src={previewUrl}
          fallbackSrc={fallbackPreviewUrl}
          alt={artifact.fileInfo?.name ?? artifact.label}
          fileType={artifactType === 'model3d' ? 'model3d' : 'image'}
          width={88}
          height={88}
          className="canvas-task-history-card__artifact-file-thumb"
        />
        <div className="canvas-task-history-card__artifact-file-body">
          <div className="canvas-task-history-card__artifact-name" title={artifact.fileInfo?.name ?? artifact.label}>
            {artifact.fileInfo?.name ?? artifact.label}
          </div>
          <div className="canvas-task-history-card__artifact-meta">
            {artifactType === 'model3d' ? 'PLY / 3D 文件' : '文件产物'}
          </div>
          {meta && <div className="canvas-task-history-card__artifact-meta">{meta}</div>}
          {downloadUrl && (
            <a
              className="canvas-task-history-card__artifact-link"
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
            >
              打开文件
            </a>
          )}
        </div>
      </div>
    </div>
  );
});

TaskHistoryArtifactPreview.displayName = 'TaskHistoryArtifactPreview';

export const __testOnly = {
  getArtifactFile,
  getArtifactType,
  getArtifactPersistentPreviewUrls,
  getArtifactPreviewSources,
  getArtifactPreviewUrl,
  getArtifactFallbackUrl,
  getArtifactDownloadUrl,
  buildTaskHistoryArtifactDragPayload,
};
