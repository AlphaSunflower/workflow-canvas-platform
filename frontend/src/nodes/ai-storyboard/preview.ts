import type { StoryboardShotData } from '@/types';

export function resolveStoryboardGeneratedImagePreviewUrl(
  shot: Pick<StoryboardShotData, 'imageFileId'>,
): string | undefined {
  const imageFileId = (
    typeof shot.imageFileId === 'string' && shot.imageFileId.trim().length > 0
      ? shot.imageFileId.trim()
      : undefined
  );

  return imageFileId
    ? `/api/v1/files/${encodeURIComponent(imageFileId)}/preview`
    : undefined;
}
