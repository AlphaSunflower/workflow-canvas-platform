import type {
  FileNodeData,
  StoryboardConfig,
  StoryboardPersistedShotData,
  StoryboardShotData,
} from '@/types';
import {
  AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS,
  getAIImageGenNodeAspectRatioOptions,
  normalizeAIImageGenNodeAspectRatio,
  normalizeAIImageGenNodeModel,
  type AIImageGenNodeAspectRatio,
  type AIImageGenNodeImageSize,
  type AIImageGenNodeModel,
} from '@/nodes/ai-image-gen/constants';
import {
  AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO,
  AI_VIDEO_GEN_DEFAULT_MODEL,
  AI_VIDEO_GEN_DEFAULT_RESOLUTION,
  AI_VIDEO_GEN_MODEL_OPTIONS,
  AI_VIDEO_GEN_SUPPORTED_ASPECT_RATIOS,
  AI_VIDEO_GEN_SUPPORTED_RESOLUTIONS,
  normalizeAIVideoGenAspectRatio,
  normalizeAIVideoGenModel,
  normalizeAIVideoGenParameters,
  normalizeAIVideoGenResolution,
} from '@/nodes/ai-video-gen/constants';
import { applyStoryboardShotRuntimeState } from './storyboard-runtime-state';

export interface StoryboardShotDefaults {
  defaultImageModel: AIImageGenNodeModel;
  defaultImageAspectRatio: AIImageGenNodeAspectRatio;
  defaultImageSize: AIImageGenNodeImageSize;
  defaultVideoModel: string;
  defaultVideoDuration: 8;
  defaultVideoAspectRatio: string;
  defaultVideoResolution: string;
}

export interface StoryboardLocalState {
  shots: StoryboardShotData[];
  processedInputFileIds: string[];
}

export interface StoryboardResolvedInputImage {
  sourceNodeId: string;
  sourceFileId: string;
  sourceImageFileId: string;
  sourceNode: FileNodeData;
  fileName: string;
  promptHint?: string;
  order: number;
}

const DEFAULT_IMAGE_MODEL: AIImageGenNodeModel = 'gpt-image-2';
const DEFAULT_IMAGE_ASPECT_RATIO: AIImageGenNodeAspectRatio = 'auto';
const DEFAULT_IMAGE_SIZE: AIImageGenNodeImageSize = '1K';
const DEFAULT_VIDEO_DURATION = 8 as const;

function normalizeStoryboardImageModel(
  value: unknown,
): AIImageGenNodeModel | undefined {
  const normalized = normalizeTrimmedString(value);
  return normalized ? normalizeAIImageGenNodeModel(normalized) : undefined;
}

function normalizeStoryboardImageSize(
  value: unknown,
): AIImageGenNodeImageSize | undefined {
  const normalized = normalizeTrimmedString(value);
  if (!normalized) {
    return undefined;
  }

  return normalized === '1K' || normalized === '2K' || normalized === '4K'
    ? normalized
    : undefined;
}

function normalizeStoryboardVideoModel(value: unknown): string | undefined {
  return normalizeAIVideoGenModel(value) ?? undefined;
}

function normalizeStoryboardVideoResolution(value: unknown): string | undefined {
  return normalizeAIVideoGenResolution(value) ?? undefined;
}

function normalizeStoryboardVideoAspectRatio(value: unknown): string | undefined {
  return normalizeAIVideoGenAspectRatio(value) ?? undefined;
}

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

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.trunc(value);
  return normalized >= 1 ? normalized : undefined;
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : undefined;
}

function createLegacyShotId(raw: Partial<StoryboardShotData>, index: number): string {
  const stableSourceKey = normalizeTrimmedString(raw.sourceFileId)
    ?? normalizeTrimmedString(raw.sourceImageFileId)
    ?? normalizeTrimmedString(raw.imageFileId)
    ?? normalizeTrimmedString(raw.videoFileId);

  return stableSourceKey
    ? `storyboard-shot-${stableSourceKey}`
    : `storyboard-shot-${index + 1}`;
}

export function resolveStoryboardProcessedInputFileId(value: {
  sourceFileId?: unknown;
  sourceImageFileId?: unknown;
}): string | undefined {
  return normalizeTrimmedString(value.sourceFileId)
    ?? normalizeTrimmedString(value.sourceImageFileId);
}

export function isStoryboardShotSourcedFromInput(
  shot: Pick<StoryboardShotData, 'sourceNodeId' | 'sourceFileId' | 'sourceImageFileId'>,
  input: Pick<StoryboardResolvedInputImage, 'sourceNodeId' | 'sourceFileId' | 'sourceImageFileId'>,
): boolean {
  const shotSourceFileId = normalizeTrimmedString(shot.sourceFileId);
  const inputSourceFileId = normalizeTrimmedString(input.sourceFileId);
  if (shotSourceFileId && inputSourceFileId && shotSourceFileId === inputSourceFileId) {
    return true;
  }

  const shotSourceNodeId = normalizeTrimmedString(shot.sourceNodeId);
  const inputSourceNodeId = normalizeTrimmedString(input.sourceNodeId);
  if (shotSourceNodeId && inputSourceNodeId && shotSourceNodeId === inputSourceNodeId) {
    return true;
  }

  const shotSourceImageFileId = normalizeTrimmedString(shot.sourceImageFileId);
  const inputSourceImageFileId = normalizeTrimmedString(input.sourceImageFileId);
  return Boolean(
    !shotSourceFileId
    && shotSourceImageFileId
    && inputSourceImageFileId
    && shotSourceImageFileId === inputSourceImageFileId
  );
}

export function getStoryboardShotDefaults(
  config: Partial<StoryboardConfig> | undefined,
): StoryboardShotDefaults {
  const defaultImageModel = normalizeStoryboardImageModel(config?.defaultImageModel) ?? DEFAULT_IMAGE_MODEL;

  return {
    defaultImageModel,
    defaultImageAspectRatio: normalizeAIImageGenNodeAspectRatio(
      defaultImageModel,
      normalizeTrimmedString(config?.defaultImageAspectRatio) ?? DEFAULT_IMAGE_ASPECT_RATIO,
    ),
    defaultImageSize: normalizeStoryboardImageSize(config?.defaultImageSize) ?? DEFAULT_IMAGE_SIZE,
    defaultVideoModel: normalizeStoryboardVideoModel(config?.batchVideoModel) ?? AI_VIDEO_GEN_DEFAULT_MODEL,
    defaultVideoDuration: DEFAULT_VIDEO_DURATION,
    defaultVideoAspectRatio: normalizeStoryboardVideoAspectRatio(config?.batchVideoAspectRatio) ?? AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO,
    defaultVideoResolution: normalizeStoryboardVideoResolution(config?.batchVideoResolution) ?? AI_VIDEO_GEN_DEFAULT_RESOLUTION,
  };
}

export function normalizeStoryboardProcessedInputFileIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  value.forEach((item) => {
    const fileId = normalizeTrimmedString(item);
    if (!fileId || seen.has(fileId)) {
      return;
    }

    seen.add(fileId);
    normalized.push(fileId);
  });

  return normalized;
}

export function normalizeStoryboardShotData(
  value: Partial<StoryboardShotData>,
  index: number,
  total: number,
  defaults: StoryboardShotDefaults,
): StoryboardShotData {
  const sourceFileId = normalizeTrimmedString(value.sourceFileId);
  const sourceImageFileId = normalizeTrimmedString(value.sourceImageFileId) ?? sourceFileId;

  const imageModel = normalizeStoryboardImageModel(value.imageModel) ?? defaults.defaultImageModel;
  const videoParameters = normalizeAIVideoGenParameters({
    aspectRatio: value.videoAspectRatio ?? defaults.defaultVideoAspectRatio,
    resolution: value.videoResolution ?? defaults.defaultVideoResolution,
  });
  const persistedShot: StoryboardPersistedShotData = {
    id: normalizeTrimmedString(value.id) ?? createLegacyShotId(value, index),
    order: index + 1,
    row: normalizeNonNegativeInteger(value.row) ?? index,
    col: normalizeNonNegativeInteger(value.col) ?? 0,
    originalIndex: normalizePositiveInteger(value.originalIndex) ?? index + 1,
    originalTotal: normalizePositiveInteger(value.originalTotal) ?? total,
    sourceNodeId: normalizeTrimmedString(value.sourceNodeId),
    sourceFileId,
    sourceImageFileId,
    imageFileId: normalizeTrimmedString(value.imageFileId),
    videoFileId: normalizeTrimmedString(value.videoFileId),
    prompt: typeof value.prompt === 'string' ? value.prompt : '',
    imageModel,
    imageAspectRatio: normalizeAIImageGenNodeAspectRatio(
      imageModel,
      normalizeTrimmedString(value.imageAspectRatio) ?? defaults.defaultImageAspectRatio,
    ),
    imageSize: normalizeStoryboardImageSize(value.imageSize) ?? defaults.defaultImageSize,
    videoModel: normalizeStoryboardVideoModel(value.videoModel) ?? defaults.defaultVideoModel,
    videoDuration: DEFAULT_VIDEO_DURATION,
    videoAspectRatio: videoParameters.aspectRatio,
    videoResolution: videoParameters.resolution,
    imageGenStatus: value.imageGenStatus,
    imageGenMessage: normalizeOptionalText(value.imageGenMessage),
    imageGenRunId: normalizeTrimmedString(value.imageGenRunId),
    videoGenStatus: value.videoGenStatus,
    videoProgress: typeof value.videoProgress === 'number' && Number.isFinite(value.videoProgress)
      ? value.videoProgress
      : undefined,
    videoError: normalizeOptionalText(value.videoError),
    videoRunId: normalizeTrimmedString(value.videoRunId),
  };

  return applyStoryboardShotRuntimeState(persistedShot);
}

export function normalizeStoryboardShots(
  value: unknown,
  defaults: StoryboardShotDefaults,
): StoryboardShotData[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sortableShots = value
    .map((item, index) => ({
      raw: (item && typeof item === 'object' && !Array.isArray(item))
        ? item as Partial<StoryboardShotData>
        : {},
      sourceIndex: index,
      requestedOrder: normalizePositiveInteger(
        (item && typeof item === 'object' && !Array.isArray(item))
          ? (item as Partial<StoryboardShotData>).order
          : undefined,
      ) ?? index + 1,
    }))
    .sort((left, right) => {
      if (left.requestedOrder !== right.requestedOrder) {
        return left.requestedOrder - right.requestedOrder;
      }

      return left.sourceIndex - right.sourceIndex;
    });

  return sortableShots.map((shot, index, shots) => (
    normalizeStoryboardShotData(shot.raw, index, shots.length, defaults)
  ));
}

export function normalizeStoryboardLocalState(
  config: Partial<StoryboardConfig> | undefined,
  defaults: StoryboardShotDefaults,
): StoryboardLocalState {
  return {
    shots: normalizeStoryboardShots(config?.shots, defaults),
    processedInputFileIds: normalizeStoryboardProcessedInputFileIds(config?.processedInputFileIds),
  };
}

export function createStoryboardLocalStateKey(state: StoryboardLocalState): string {
  return JSON.stringify(state);
}

export function normalizeStoryboardShotImageConfig(
  shot: Pick<StoryboardShotData, 'imageModel' | 'imageAspectRatio' | 'imageSize'>,
  defaults: Pick<StoryboardShotDefaults, 'defaultImageModel' | 'defaultImageAspectRatio' | 'defaultImageSize'>,
): Pick<StoryboardShotData, 'imageModel' | 'imageAspectRatio' | 'imageSize'> {
  const imageModel = normalizeStoryboardImageModel(shot.imageModel) ?? defaults.defaultImageModel;

  return {
    imageModel,
    imageAspectRatio: normalizeAIImageGenNodeAspectRatio(
      imageModel,
      shot.imageAspectRatio ?? defaults.defaultImageAspectRatio,
    ),
    imageSize: normalizeStoryboardImageSize(shot.imageSize) ?? defaults.defaultImageSize,
  };
}

export function getStoryboardImageModelOptions(): readonly string[] {
  return AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS.map((option) => option.value);
}

export function getStoryboardImageAspectRatioOptions(model: string): readonly string[] {
  return getAIImageGenNodeAspectRatioOptions(normalizeAIImageGenNodeModel(model))
    .map((option) => option.value);
}

export function getStoryboardVideoModelOptions(): readonly string[] {
  return AI_VIDEO_GEN_MODEL_OPTIONS.map((option) => option.value);
}

export function getStoryboardVideoAspectRatioOptions(): readonly string[] {
  return AI_VIDEO_GEN_SUPPORTED_ASPECT_RATIOS;
}

export function getStoryboardVideoResolutionOptions(aspectRatio?: string): readonly string[] {
  const normalizedAspectRatio = normalizeAIVideoGenAspectRatio(aspectRatio) ?? AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO;
  return AI_VIDEO_GEN_SUPPORTED_RESOLUTIONS.filter((resolution) => (
    normalizeAIVideoGenParameters({
      aspectRatio: normalizedAspectRatio,
      resolution,
    }).aspectRatio === normalizedAspectRatio
  ));
}

export function normalizeStoryboardShotVideoConfig(
  shot: {
    videoModel?: unknown;
    videoAspectRatio?: unknown;
    videoResolution?: unknown;
  },
  defaults: Pick<StoryboardShotDefaults, 'defaultVideoModel' | 'defaultVideoAspectRatio' | 'defaultVideoResolution'>,
): {
  videoModel: string;
  videoAspectRatio: string;
  videoResolution: string;
} {
  const videoParameters = normalizeAIVideoGenParameters({
    aspectRatio: shot.videoAspectRatio ?? defaults.defaultVideoAspectRatio,
    resolution: shot.videoResolution ?? defaults.defaultVideoResolution,
  });

  return {
    videoModel: normalizeStoryboardVideoModel(shot.videoModel) ?? defaults.defaultVideoModel,
    videoAspectRatio: videoParameters.aspectRatio,
    videoResolution: videoParameters.resolution,
  };
}
