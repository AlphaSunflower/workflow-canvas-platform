import {
  AI_IMAGE_GEN_NODE_ASPECT_RATIO_OPTIONS,
  AI_IMAGE_GEN_NODE_DEFAULT_ASPECT_RATIO,
  AI_IMAGE_GEN_NODE_DEFAULT_IMAGE_SIZE,
  AI_IMAGE_GEN_NODE_DEFAULT_MODEL,
  AI_IMAGE_GEN_NODE_IMAGE_SIZE_OPTIONS,
  AI_IMAGE_GEN_NODE_SUPPORTED_ASPECT_RATIOS,
  AI_IMAGE_GEN_NODE_SUPPORTED_IMAGE_SIZES,
  AI_IMAGE_GEN_NODE_SUPPORTED_MODELS,
  AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS,
  getAIImageGenNodeAspectRatioOptions,
  isAIImageGenNodeParameterlessModel,
  normalizeAIImageGenNodeConfig,
  normalizeAIImageGenNodeModel,
  type AIImageGenNodeAspectRatio,
  type AIImageGenNodeImageSize,
  type AIImageGenNodeModel,
} from '../ai-image-gen/constants';

type AIImageInpaintNodeOption<T extends string> = {
  value: T;
  label: string;
};

export const AI_IMAGE_INPAINT_DISPLAY_NAME = '图片局部重绘';
export const AI_IMAGE_INPAINT_DESCRIPTION =
  '拖入 1 张原图，在节点内标记区域后按提示词进行局部重绘。';
export const AI_IMAGE_INPAINT_ICON = 'INP';
export const AI_IMAGE_INPAINT_COLOR = '#ef4444';

export const AI_IMAGE_INPAINT_GROUP_ID = 'main';
export const AI_IMAGE_INPAINT_GROUP_LABEL = '原图';
export const AI_IMAGE_INPAINT_INPUT_PORT_ID = 'image';
export const AI_IMAGE_INPAINT_RESULT_PORT_ID = 'result';
export const AI_IMAGE_INPAINT_INPUT_LABEL = '原图';
export const AI_IMAGE_INPAINT_RESULT_LABEL = '重绘结果';
export const AI_IMAGE_INPAINT_INPUT_LIMIT = 1;

export const AI_IMAGE_INPAINT_SUPPORTED_MODELS = AI_IMAGE_GEN_NODE_SUPPORTED_MODELS;
export const AI_IMAGE_INPAINT_SUPPORTED_IMAGE_SIZES = AI_IMAGE_GEN_NODE_SUPPORTED_IMAGE_SIZES;
export const AI_IMAGE_INPAINT_SUPPORTED_ASPECT_RATIOS = AI_IMAGE_GEN_NODE_SUPPORTED_ASPECT_RATIOS;

export type AIImageInpaintNodeModel = AIImageGenNodeModel;
export type AIImageInpaintNodeImageSize = AIImageGenNodeImageSize;
export type AIImageInpaintNodeAspectRatio = AIImageGenNodeAspectRatio;

export const AI_IMAGE_INPAINT_DEFAULT_MODEL = AI_IMAGE_GEN_NODE_DEFAULT_MODEL;
export const AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE = AI_IMAGE_GEN_NODE_DEFAULT_IMAGE_SIZE;
export const AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO = AI_IMAGE_GEN_NODE_DEFAULT_ASPECT_RATIO;

export const AI_IMAGE_INPAINT_NODE_MODEL_OPTIONS = AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS;
export const AI_IMAGE_INPAINT_NODE_IMAGE_SIZE_OPTIONS = AI_IMAGE_GEN_NODE_IMAGE_SIZE_OPTIONS;
export const AI_IMAGE_INPAINT_NODE_ASPECT_RATIO_OPTIONS = AI_IMAGE_GEN_NODE_ASPECT_RATIO_OPTIONS;

export const AI_IMAGE_INPAINT_MASK_MODES = [
  'original-markup',
  'strong-mask',
] as const;

export type AIImageInpaintMaskMode =
  (typeof AI_IMAGE_INPAINT_MASK_MODES)[number];

export const AI_IMAGE_INPAINT_DEFAULT_MASK_MODE = 'original-markup' as const satisfies AIImageInpaintMaskMode;

export const AI_IMAGE_INPAINT_MASK_MODE_OPTIONS = [
  { value: 'original-markup', label: '原图遮罩' },
  { value: 'strong-mask', label: '强遮罩' },
] as const satisfies readonly AIImageInpaintNodeOption<AIImageInpaintMaskMode>[];

const AI_IMAGE_INPAINT_MASK_MODE_SET = new Set<string>(
  AI_IMAGE_INPAINT_MASK_MODES as readonly string[],
);

export function isAIImageInpaintMaskMode(
  value: unknown,
): value is AIImageInpaintMaskMode {
  return typeof value === 'string' && AI_IMAGE_INPAINT_MASK_MODE_SET.has(value);
}

export function normalizeAIImageInpaintMaskMode(
  value: unknown,
): AIImageInpaintMaskMode {
  return isAIImageInpaintMaskMode(value)
    ? value
    : AI_IMAGE_INPAINT_DEFAULT_MASK_MODE;
}

export function normalizeAIImageInpaintNodeModel(
  value: unknown,
): AIImageInpaintNodeModel {
  return normalizeAIImageGenNodeModel(value);
}

export function isAIImageInpaintNodeParameterlessModel(value: unknown): boolean {
  return isAIImageGenNodeParameterlessModel(value);
}

export function getAIImageInpaintNodeAspectRatioOptions(
  model: AIImageInpaintNodeModel,
): readonly AIImageInpaintNodeOption<AIImageInpaintNodeAspectRatio>[] {
  return getAIImageGenNodeAspectRatioOptions(model);
}

export function normalizeAIImageInpaintNodeConfig(config: {
  model?: unknown;
  imageSize?: unknown;
  aspectRatio?: unknown;
}): {
  model: AIImageInpaintNodeModel;
  imageSize: AIImageInpaintNodeImageSize;
  aspectRatio: AIImageInpaintNodeAspectRatio;
} {
  return normalizeAIImageGenNodeConfig(config);
}

export const AI_IMAGE_INPAINT_DEFAULT_SIZE = {
  width: 500,
  height: 460,
} as const;

export const AI_IMAGE_INPAINT_MIN_WIDTH = 420;
export const AI_IMAGE_INPAINT_MIN_HEIGHT = 430;
export const AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT = 360;
export const AI_IMAGE_INPAINT_MIN_EDITOR_HEIGHT = 260;
export const AI_IMAGE_INPAINT_DEFAULT_EDITOR_WIDTH = AI_IMAGE_INPAINT_DEFAULT_SIZE.width;
export const AI_IMAGE_INPAINT_MIN_EDITOR_WIDTH = 220;
export const AI_IMAGE_INPAINT_MAX_EDITOR_WIDTH = 960;
export const AI_IMAGE_INPAINT_BODY_MIN_HEIGHT = 320;
export const AI_IMAGE_INPAINT_EDITOR_FLOAT_GAP = 12;
export const AI_IMAGE_INPAINT_EDITOR_TITLEBAR_HEIGHT = 39;
export const AI_IMAGE_INPAINT_EDITOR_TITLEBAR_GAP = 6;
export const AI_IMAGE_INPAINT_EDITOR_TOOLBAR_HEIGHT = 43;

function normalizePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function normalizeAIImageInpaintEditorHeight(value: unknown): number {
  const numericValue = normalizePositiveNumber(value);
  return Math.max(
    AI_IMAGE_INPAINT_MIN_EDITOR_HEIGHT,
    numericValue ? Math.round(numericValue) : AI_IMAGE_INPAINT_DEFAULT_EDITOR_HEIGHT,
  );
}

export function resolveAIImageInpaintEditorSize(params: {
  editorHeight?: unknown;
  sourceWidth?: unknown;
  sourceHeight?: unknown;
}): {
  width: number;
  height: number;
  totalHeight: number;
  aspectRatio: number | null;
} {
  const preferredHeight = normalizeAIImageInpaintEditorHeight(params.editorHeight);
  const sourceWidth = normalizePositiveNumber(params.sourceWidth);
  const sourceHeight = normalizePositiveNumber(params.sourceHeight);
  const aspectRatio = sourceWidth && sourceHeight
    ? sourceWidth / sourceHeight
    : null;
  if (!sourceWidth || !sourceHeight || !aspectRatio) {
    return {
      width: AI_IMAGE_INPAINT_DEFAULT_EDITOR_WIDTH,
      height: preferredHeight,
      totalHeight: preferredHeight + AI_IMAGE_INPAINT_EDITOR_TOOLBAR_HEIGHT,
      aspectRatio,
    };
  }

  const preferredScale = preferredHeight / sourceHeight;
  const minScale = AI_IMAGE_INPAINT_MIN_EDITOR_WIDTH / sourceWidth;
  const maxScale = AI_IMAGE_INPAINT_MAX_EDITOR_WIDTH / sourceWidth;
  const scale = clampScale(preferredScale, minScale, maxScale);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  return {
    width,
    height,
    totalHeight: height + AI_IMAGE_INPAINT_EDITOR_TOOLBAR_HEIGHT,
    aspectRatio,
  };
}

function clampScale(value: number, min: number, max: number): number {
  if (max < min) {
    return max;
  }

  return Math.max(min, Math.min(max, value));
}
