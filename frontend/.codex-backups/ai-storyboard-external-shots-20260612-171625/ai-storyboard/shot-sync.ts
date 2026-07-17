import type { StoryboardConfig, StoryboardShotData } from '@/types';
import type {
  StoryboardLocalState,
  StoryboardResolvedInputImage,
  StoryboardShotDefaults,
} from './types';
import {
  createStoryboardLocalStateKey,
  normalizeStoryboardShotImageConfig,
  isStoryboardShotSourcedFromInput,
  normalizeStoryboardLocalState,
  normalizeStoryboardProcessedInputFileIds,
  normalizeStoryboardShots,
  resolveStoryboardProcessedInputFileId,
} from './types';

function createShotId(input: StoryboardResolvedInputImage): string {
  return `storyboard-shot-${input.sourceFileId}`;
}

function createOriginalLayoutShot(
  input: StoryboardResolvedInputImage,
  index: number,
  total: number,
  defaults: StoryboardShotDefaults,
): StoryboardShotData {
  const normalizedImageConfig = normalizeStoryboardShotImageConfig({
    imageModel: defaults.defaultImageModel,
    imageAspectRatio: defaults.defaultImageAspectRatio,
    imageSize: defaults.defaultImageSize,
  }, defaults);

  return {
    id: createShotId(input),
    order: index + 1,
    row: index,
    col: 0,
    originalIndex: index + 1,
    originalTotal: total,
    sourceNodeId: input.sourceNodeId,
    sourceFileId: input.sourceFileId,
    sourceImageFileId: input.sourceImageFileId,
    imageFileId: undefined,
    videoFileId: undefined,
    prompt: input.promptHint ?? '',
    imageModel: normalizedImageConfig.imageModel,
    imageAspectRatio: normalizedImageConfig.imageAspectRatio,
    imageSize: normalizedImageConfig.imageSize,
    videoModel: defaults.defaultVideoModel,
    videoDuration: defaults.defaultVideoDuration,
    videoAspectRatio: defaults.defaultVideoAspectRatio,
    videoResolution: defaults.defaultVideoResolution,
    imageGenStatus: 'idle',
    imageGenMessage: undefined,
    imageGenRunId: undefined,
    videoGenStatus: 'idle',
    videoProgress: undefined,
    videoError: undefined,
    videoRunId: undefined,
  };
}

export function mergeStoryboardShotsFromInputs(
  currentState: StoryboardLocalState,
  inputs: StoryboardResolvedInputImage[],
  defaults: StoryboardShotDefaults,
): StoryboardLocalState {
  const nextProcessedFileIds = normalizeStoryboardProcessedInputFileIds([
    ...currentState.processedInputFileIds,
    ...inputs
      .map((input) => resolveStoryboardProcessedInputFileId(input))
      .filter((fileId): fileId is string => typeof fileId === 'string' && fileId.length > 0),
  ]);

  const existingShots = normalizeStoryboardShots(currentState.shots, defaults);
  const pendingInputs = inputs.filter((input) => {
    const processedInputFileId = resolveStoryboardProcessedInputFileId(input);
    if (processedInputFileId && currentState.processedInputFileIds.includes(processedInputFileId)) {
      return false;
    }

    return !existingShots.some((shot) => isStoryboardShotSourcedFromInput(shot, input));
  });
  if (pendingInputs.length === 0) {
    return {
      shots: existingShots,
      processedInputFileIds: nextProcessedFileIds,
    };
  }

  const totalAfterAppend = existingShots.length + pendingInputs.length;
  const appendedShots = pendingInputs
    .map((input, index) => (
      createOriginalLayoutShot(input, existingShots.length + index, totalAfterAppend, defaults)
    ));

  const mergedShots = normalizeStoryboardShots(
    [...existingShots, ...appendedShots].map((shot, index) => ({
      ...shot,
      order: index + 1,
      row: index,
      col: 0,
      originalIndex: shot.originalIndex ?? index + 1,
      originalTotal: totalAfterAppend,
    })),
    defaults,
  );

  return {
    shots: mergedShots,
    processedInputFileIds: nextProcessedFileIds,
  };
}

export function buildStoryboardConfigPatch(
  config: Partial<StoryboardConfig> | undefined,
  state: StoryboardLocalState,
): Partial<StoryboardConfig> {
  return {
    ...config,
    shots: state.shots,
    processedInputFileIds: state.processedInputFileIds,
  };
}

export function getStoryboardExternalState(
  config: Partial<StoryboardConfig> | undefined,
  defaults: StoryboardShotDefaults,
): StoryboardLocalState {
  return normalizeStoryboardLocalState(config, defaults);
}

export function isStoryboardLocalStateEqual(
  left: StoryboardLocalState,
  right: StoryboardLocalState,
): boolean {
  return createStoryboardLocalStateKey(left) === createStoryboardLocalStateKey(right);
}
