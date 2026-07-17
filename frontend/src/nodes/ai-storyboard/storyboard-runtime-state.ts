import type {
  StoryboardPersistedShotData,
  StoryboardShotData,
  StoryboardShotMediaStatus,
  StoryboardShotRuntimeState,
} from '@/types';

function normalizeTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value.trim().length > 0 ? value : undefined;
}

function normalizeMediaStatus(value: unknown): StoryboardShotMediaStatus | undefined {
  return value === 'generating' || value === 'completed' || value === 'failed'
    || value === 'idle'
    ? value
    : undefined;
}

function normalizeProgress(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.min(100, value));
}

function hasPersistedResultFileId(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function createDefaultStoryboardShotRuntimeState(): StoryboardShotRuntimeState {
  return {
    imageGenStatus: 'idle',
    imageGenMessage: undefined,
    imageGenRunId: undefined,
    videoGenStatus: 'idle',
    videoProgress: undefined,
    videoError: undefined,
    videoRunId: undefined,
  };
}

export function resolveStoryboardShotRuntimeState(
  shot: Partial<StoryboardPersistedShotData>,
): StoryboardShotRuntimeState {
  const defaultRuntimeState = createDefaultStoryboardShotRuntimeState();
  const imageGenStatus = normalizeMediaStatus(shot.imageGenStatus)
    ?? (hasPersistedResultFileId(shot.imageFileId) ? 'completed' : defaultRuntimeState.imageGenStatus);
  const videoGenStatus = normalizeMediaStatus(shot.videoGenStatus)
    ?? (hasPersistedResultFileId(shot.videoFileId) ? 'completed' : defaultRuntimeState.videoGenStatus);
  const videoProgress = normalizeProgress(shot.videoProgress)
    ?? (videoGenStatus === 'completed' ? 100 : undefined);

  return {
    imageGenStatus,
    imageGenMessage: normalizeOptionalText(shot.imageGenMessage),
    imageGenRunId: normalizeTrimmedString(shot.imageGenRunId),
    videoGenStatus,
    videoProgress,
    videoError: normalizeOptionalText(shot.videoError),
    videoRunId: normalizeTrimmedString(shot.videoRunId),
  };
}

export function applyStoryboardShotRuntimeState<TShot extends StoryboardPersistedShotData>(
  shot: TShot,
): TShot & StoryboardShotRuntimeState {
  return {
    ...shot,
    ...resolveStoryboardShotRuntimeState(shot),
  };
}

export function applyStoryboardShotRuntimeStateToShots<TShot extends StoryboardPersistedShotData>(
  shots: readonly TShot[],
): Array<TShot & StoryboardShotRuntimeState> {
  return shots.map((shot) => applyStoryboardShotRuntimeState(shot));
}

export function stripStoryboardShotRuntimeState(
  shot: StoryboardShotData,
): StoryboardPersistedShotData {
  const nextShot: Record<string, unknown> = { ...shot };
  delete nextShot.imageGenStatus;
  delete nextShot.imageGenMessage;
  delete nextShot.imageGenRunId;
  delete nextShot.videoGenStatus;
  delete nextShot.videoProgress;
  delete nextShot.videoError;
  delete nextShot.videoRunId;

  return nextShot as unknown as StoryboardPersistedShotData;
}

export function stripStoryboardShotRuntimeStateFromShots(
  shots: readonly StoryboardShotData[],
): StoryboardPersistedShotData[] {
  return shots.map((shot) => stripStoryboardShotRuntimeState(shot));
}
