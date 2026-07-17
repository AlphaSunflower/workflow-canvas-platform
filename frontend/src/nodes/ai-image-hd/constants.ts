type AIImageHdNodeOption<T extends string> = {
  value: T;
  label: string;
};

export const AI_IMAGE_HD_DISPLAY_NAME = '图片高清化';
export const AI_IMAGE_HD_ICON = 'HD';
export const AI_IMAGE_HD_COLOR = '#0ea5e9';
export const AI_IMAGE_HD_DESCRIPTION = '最多 10 组，每组 1 张图，运行后每组产出 1 张增强图。';

export const AI_IMAGE_HD_INPUT_PORT_ID = 'image';
export const AI_IMAGE_HD_RESULT_PORT_ID = 'result';
export const AI_IMAGE_HD_MIN_GROUPS = 1;
export const AI_IMAGE_HD_MAX_GROUPS = 10;
export const AI_IMAGE_HD_INPUT_LIMIT_PER_GROUP = 1;

export const AI_IMAGE_HD_NODE_SUPPORTED_MODELS = [
  'gemini-3-pro-image-preview',
  'gpt-image-2',
  'gpt-image-2-vip',
] as const;

export type AIImageHdNodeModel =
  (typeof AI_IMAGE_HD_NODE_SUPPORTED_MODELS)[number];

export const AI_IMAGE_HD_NODE_SUPPORTED_IMAGE_SIZES = [
  '1K',
  '2K',
  '4K',
] as const;

export type AIImageHdNodeImageSize =
  (typeof AI_IMAGE_HD_NODE_SUPPORTED_IMAGE_SIZES)[number];

export const AI_IMAGE_HD_NODE_SUPPORTED_ASPECT_RATIOS = [
  'auto',
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '21:9',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
] as const;

export type AIImageHdNodeAspectRatio =
  (typeof AI_IMAGE_HD_NODE_SUPPORTED_ASPECT_RATIOS)[number];

export const AI_IMAGE_HD_PARAMETERLESS_MODEL = 'gpt-image-2' as const;
export const AI_IMAGE_HD_DEFAULT_MODEL = AI_IMAGE_HD_PARAMETERLESS_MODEL;
export const AI_IMAGE_HD_DEFAULT_IMAGE_SIZE = '1K';
export const AI_IMAGE_HD_DEFAULT_ASPECT_RATIO = '1:1';

export const AI_IMAGE_HD_NODE_MODEL_OPTIONS = [
  { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image Preview' },
  { value: 'gpt-image-2', label: 'GPT Image 2' },
  { value: 'gpt-image-2-vip', label: 'GPT Image 2 VIP' },
] as const satisfies readonly AIImageHdNodeOption<AIImageHdNodeModel>[];

export const AI_IMAGE_HD_NODE_IMAGE_SIZE_OPTIONS = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
] as const satisfies readonly AIImageHdNodeOption<AIImageHdNodeImageSize>[];

export const AI_IMAGE_HD_NODE_ASPECT_RATIO_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '21:9', label: '21:9' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '5:4', label: '5:4' },
  { value: '4:5', label: '4:5' },
] as const satisfies readonly AIImageHdNodeOption<AIImageHdNodeAspectRatio>[];

export const AI_IMAGE_HD_ASPECT_RATIO_OPTIONS =
  AI_IMAGE_HD_NODE_ASPECT_RATIO_OPTIONS;
export const AI_IMAGE_HD_IMAGE_SIZE_OPTIONS =
  AI_IMAGE_HD_NODE_IMAGE_SIZE_OPTIONS;

const AI_IMAGE_HD_NODE_MODEL_ASPECT_RATIOS = {
  'gemini-3-pro-image-preview': AI_IMAGE_HD_NODE_SUPPORTED_ASPECT_RATIOS,
  'gpt-image-2': ['auto'],
  'gpt-image-2-vip': [
    '1:1',
    '16:9',
    '9:16',
    '4:3',
    '3:4',
    '21:9',
    '3:2',
    '2:3',
    '5:4',
    '4:5',
  ],
} as const satisfies Record<
  AIImageHdNodeModel,
  readonly AIImageHdNodeAspectRatio[]
>;

const AI_IMAGE_HD_NODE_MODEL_DEFAULT_ASPECT_RATIOS = {
  'gemini-3-pro-image-preview': 'auto',
  'gpt-image-2': 'auto',
  'gpt-image-2-vip': AI_IMAGE_HD_DEFAULT_ASPECT_RATIO,
} as const satisfies Record<
  AIImageHdNodeModel,
  AIImageHdNodeAspectRatio
>;

const AI_IMAGE_HD_NODE_MODEL_SET = new Set<string>(
  AI_IMAGE_HD_NODE_SUPPORTED_MODELS as readonly string[],
);
const AI_IMAGE_HD_NODE_IMAGE_SIZE_SET = new Set<string>(
  AI_IMAGE_HD_NODE_SUPPORTED_IMAGE_SIZES as readonly string[],
);

export function isAIImageHdNodeModel(
  value: unknown,
): value is AIImageHdNodeModel {
  return typeof value === 'string' && AI_IMAGE_HD_NODE_MODEL_SET.has(value);
}

export function normalizeAIImageHdNodeModel(
  value: unknown,
): AIImageHdNodeModel {
  return isAIImageHdNodeModel(value) ? value : AI_IMAGE_HD_DEFAULT_MODEL;
}

export function isAIImageHdNodeParameterlessModel(value: unknown): value is typeof AI_IMAGE_HD_PARAMETERLESS_MODEL {
  return value === AI_IMAGE_HD_PARAMETERLESS_MODEL;
}

export function isAIImageHdNodeImageSize(
  value: unknown,
): value is AIImageHdNodeImageSize {
  return typeof value === 'string' && AI_IMAGE_HD_NODE_IMAGE_SIZE_SET.has(value);
}

export function normalizeAIImageHdNodeImageSize(
  value: unknown,
): AIImageHdNodeImageSize {
  return isAIImageHdNodeImageSize(value)
    ? value
    : AI_IMAGE_HD_DEFAULT_IMAGE_SIZE;
}

export function getAIImageHdNodeSupportedAspectRatios(
  model: AIImageHdNodeModel,
): readonly AIImageHdNodeAspectRatio[] {
  return AI_IMAGE_HD_NODE_MODEL_ASPECT_RATIOS[model];
}

export function getAIImageHdNodeDefaultAspectRatio(
  model: AIImageHdNodeModel,
): AIImageHdNodeAspectRatio {
  return AI_IMAGE_HD_NODE_MODEL_DEFAULT_ASPECT_RATIOS[model];
}

export function getAIImageHdNodeAspectRatioOptions(
  model: AIImageHdNodeModel,
): readonly AIImageHdNodeOption<AIImageHdNodeAspectRatio>[] {
  const supportedAspectRatios = new Set<string>(
    AI_IMAGE_HD_NODE_MODEL_ASPECT_RATIOS[model] as readonly string[],
  );

  return AI_IMAGE_HD_NODE_ASPECT_RATIO_OPTIONS.filter((option) =>
    supportedAspectRatios.has(option.value),
  );
}

export function isAIImageHdNodeAspectRatio(
  model: AIImageHdNodeModel,
  value: unknown,
): value is AIImageHdNodeAspectRatio {
  return typeof value === 'string'
    && (
      AI_IMAGE_HD_NODE_MODEL_ASPECT_RATIOS[model] as readonly string[]
    ).includes(value);
}

export function normalizeAIImageHdNodeAspectRatio(
  model: AIImageHdNodeModel,
  value: unknown,
): AIImageHdNodeAspectRatio {
  return isAIImageHdNodeAspectRatio(model, value)
    ? value
    : getAIImageHdNodeDefaultAspectRatio(model);
}

export function normalizeAIImageHdNodeConfig(config: {
  model?: unknown;
  imageSize?: unknown;
  aspectRatio?: unknown;
}): {
  model: AIImageHdNodeModel;
  imageSize: AIImageHdNodeImageSize;
  aspectRatio: AIImageHdNodeAspectRatio;
} {
  const model = normalizeAIImageHdNodeModel(config.model);

  return {
    model,
    imageSize: normalizeAIImageHdNodeImageSize(config.imageSize),
    aspectRatio: normalizeAIImageHdNodeAspectRatio(model, config.aspectRatio),
  };
}

export const AI_IMAGE_HD_DEFAULT_SIZE = {
  width: 320,
  height: 296,
} as const;

export const AI_IMAGE_HD_MIN_WIDTH = 320;
export const AI_IMAGE_HD_MIN_HEIGHT = 296;
export const AI_IMAGE_HD_GROUP_STACK_GAP = 10;
export const AI_IMAGE_HD_DEFAULT_GROUP_HEIGHT = 118;
