import type { StoryboardShotData } from '@/types';

function normalizeFileId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveStoryboardGeneratedImagePreviewUrl(
  shot: Pick<StoryboardShotData, 'imageFileId' | 'videoFileId'>,
): string | undefined {
  const imageFileId = normalizeFileId(shot.imageFileId);

  if (imageFileId) {
    return `/api/v1/files/${encodeURIComponent(imageFileId)}/thumbnail`;
  }

  const videoFileId = normalizeFileId(shot.videoFileId);

  return videoFileId
    ? `/api/v1/files/${encodeURIComponent(videoFileId)}/download`
    : undefined;
}

export function resolveStoryboardGeneratedImageFallbackUrl(
  shot: Pick<StoryboardShotData, 'imageFileId' | 'videoFileId'>,
): string | undefined {
  const imageFileId = normalizeFileId(shot.imageFileId);

  if (imageFileId) {
    return `/api/v1/files/${encodeURIComponent(imageFileId)}/preview`;
  }

  return undefined;
}
