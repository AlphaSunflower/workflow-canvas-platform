import { memo } from 'react';

import { FileThumbnail } from '@/components/file';
import { isEphemeralResourceUrl } from '@/services/protected-resource';
import type { TaskHistoryPreviewFile } from './task-history.types';

interface TaskHistoryInputPreviewStripProps {
  items: TaskHistoryPreviewFile[];
}

interface PreviewSourcePair {
  primary?: string;
  fallback?: string;
}

type TaskHistoryInputPreviewType = 'image' | 'video' | 'model3d';

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

function getPreviewType(item: TaskHistoryPreviewFile): TaskHistoryInputPreviewType {
  return item.fileInfo?.fileType
    ?? (item.backendFile?.fileType === 'video'
      ? 'video'
      : item.backendFile?.fileType === 'ply'
        ? 'model3d'
        : 'image');
}

function getPersistentPreviewSources(item: TaskHistoryPreviewFile): string[] {
  const previewType = getPreviewType(item);
  const thumbnailPath = isEphemeralResourceUrl(item.fileInfo?.thumbnailPath)
    ? undefined
    : item.fileInfo?.thumbnailPath;
  const previewPath = isEphemeralResourceUrl(item.fileInfo?.previewPath)
    ? undefined
    : item.fileInfo?.previewPath;
  const filePath = isEphemeralResourceUrl(item.fileInfo?.path)
    ? undefined
    : item.fileInfo?.path;

  if (previewType === 'image') {
    return toDistinctCandidateUrls([
      item.backendFile?.thumbnailUrl,
      item.backendFile?.previewUrl,
      thumbnailPath,
      previewPath,
    ]);
  }

  if (previewType === 'video') {
    return toDistinctCandidateUrls([
      item.backendFile?.previewUrl,
      item.backendFile?.downloadUrl,
      previewPath,
      filePath,
    ]);
  }

  return toDistinctCandidateUrls([
    item.backendFile?.thumbnailUrl,
    item.backendFile?.previewUrl,
    item.backendFile?.downloadUrl,
    thumbnailPath,
    previewPath,
    filePath,
  ]);
}

function getEphemeralPreviewSrc(item: TaskHistoryPreviewFile): string | undefined {
  if (getPreviewType(item) === 'image') {
    return undefined;
  }

  return isEphemeralResourceUrl(item.fileInfo?.thumbnailPath)
    ? item.fileInfo?.thumbnailPath
    : isEphemeralResourceUrl(item.fileInfo?.path)
      ? item.fileInfo?.path
      : undefined;
}

function getPreviewSources(item: TaskHistoryPreviewFile): PreviewSourcePair {
  const persistentSources = getPersistentPreviewSources(item);
  if (persistentSources.length > 0) {
    return {
      primary: persistentSources[0],
      fallback: persistentSources[1],
    };
  }

  const ephemeral = getEphemeralPreviewSrc(item);
  return ephemeral
    ? {
      primary: ephemeral,
      fallback: undefined,
    }
    : {};
}

function getPreviewSrc(item: TaskHistoryPreviewFile): string | undefined {
  return getPreviewSources(item).primary;
}

function getFallbackPreviewSrc(item: TaskHistoryPreviewFile): string | undefined {
  return getPreviewSources(item).fallback;
}

export const TaskHistoryInputPreviewStrip = memo(({
  items,
}: TaskHistoryInputPreviewStripProps) => {
  if (items.length === 0) {
    return (
      <div className="canvas-task-history-card__section canvas-task-history-card__section--muted">
        <div className="canvas-task-history-card__section-title">输入</div>
        <div className="canvas-task-history-card__empty-inline">无输入文件</div>
      </div>
    );
  }

  return (
    <div className="canvas-task-history-card__section">
      <div className="canvas-task-history-card__section-title">输入</div>
      <div className="canvas-task-history-card__input-strip">
        {items.map((item) => (
          <div key={`${item.fileId}:${item.order}:${item.role}`} className="canvas-task-history-card__input-tile">
            <FileThumbnail
              src={getPreviewSrc(item)}
              fallbackSrc={getFallbackPreviewSrc(item)}
              alt={item.fileInfo?.name ?? item.label}
              fileType={getPreviewType(item)}
              width={72}
              height={72}
              className="canvas-task-history-card__input-thumbnail"
            />
            <div className="canvas-task-history-card__input-label" title={item.fileInfo?.name ?? item.label}>
              {item.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

TaskHistoryInputPreviewStrip.displayName = 'TaskHistoryInputPreviewStrip';

export const __testOnly = {
  getPersistentPreviewSources,
  getPreviewSources,
  getPreviewSrc,
  getFallbackPreviewSrc,
  getPreviewType,
};
