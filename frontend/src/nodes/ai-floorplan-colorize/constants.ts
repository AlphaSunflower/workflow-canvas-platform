type AIFloorplanColorizeNodeOption<T extends string> = {
  value: T;
  label: string;
};

export const AI_FLOORPLAN_COLORIZE_DISPLAY_NAME = '平面图转彩平';
export const AI_FLOORPLAN_COLORIZE_DESCRIPTION =
  '最多 10 组，每组 1 张平面图，运行后每组产出 1 张彩色平面效果图。';
export const AI_FLOORPLAN_COLORIZE_ICON = 'CLR';
export const AI_FLOORPLAN_COLORIZE_COLOR = '#f97316';

export const AI_FLOORPLAN_COLORIZE_MIN_GROUPS = 1;
export const AI_FLOORPLAN_COLORIZE_MAX_GROUPS = 10;

export const AI_FLOORPLAN_COLORIZE_INPUT_PORT_ID = 'image';
export const AI_FLOORPLAN_COLORIZE_RESULT_PORT_ID = 'result';
export const AI_FLOORPLAN_COLORIZE_INPUT_LABEL = '输入图片';
export const AI_FLOORPLAN_COLORIZE_RESULT_LABEL = '输出结果';
export const AI_FLOORPLAN_COLORIZE_OUTPUT_FILE_SUFFIX = 'floorplan-colorize';
export const AI_FLOORPLAN_COLORIZE_MOCK_PROGRESS_MESSAGES = [
  'Read floorplan',
  'Analyze layout zones',
  'Generate colorized output',
] as const;

export const AI_FLOORPLAN_COLORIZE_PARAMETERLESS_MODEL = 'gpt-image-2' as const;
export const AI_FLOORPLAN_COLORIZE_DEFAULT_MODEL = AI_FLOORPLAN_COLORIZE_PARAMETERLESS_MODEL;
export const AI_FLOORPLAN_COLORIZE_DEFAULT_ASPECT_RATIO = '1:1';
export const AI_FLOORPLAN_COLORIZE_DEFAULT_IMAGE_SIZE = '1K';

export const AI_FLOORPLAN_COLORIZE_STYLE_PRESETS = [
  'three-d-render',
  'photoreal-render',
] as const;

export type AIFloorplanColorizeStylePreset =
  (typeof AI_FLOORPLAN_COLORIZE_STYLE_PRESETS)[number];

export const AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET = 'three-d-render';

export const AI_FLOORPLAN_COLORIZE_SUPPORTED_MODELS = [
  'gemini-3-pro-image-preview',
  'gpt-image-2',
  'gpt-image-2-vip',
] as const;

export type AIFloorplanColorizeModel =
  (typeof AI_FLOORPLAN_COLORIZE_SUPPORTED_MODELS)[number];

export const AI_FLOORPLAN_COLORIZE_SUPPORTED_IMAGE_SIZES = [
  '1K',
  '2K',
  '4K',
] as const;

export type AIFloorplanColorizeImageSize =
  (typeof AI_FLOORPLAN_COLORIZE_SUPPORTED_IMAGE_SIZES)[number];

export const AI_FLOORPLAN_COLORIZE_SUPPORTED_ASPECT_RATIOS = [
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

export type AIFloorplanColorizeAspectRatio =
  (typeof AI_FLOORPLAN_COLORIZE_SUPPORTED_ASPECT_RATIOS)[number];

export const AI_FLOORPLAN_COLORIZE_MODEL_OPTIONS = [
  { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image Preview' },
  { value: 'gpt-image-2', label: 'GPT Image 2' },
  { value: 'gpt-image-2-vip', label: 'GPT Image 2 VIP' },
] as const satisfies readonly AIFloorplanColorizeNodeOption<AIFloorplanColorizeModel>[];

export const AI_FLOORPLAN_COLORIZE_RATIO_OPTIONS = [
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
] as const satisfies readonly AIFloorplanColorizeNodeOption<AIFloorplanColorizeAspectRatio>[];

export const AI_FLOORPLAN_COLORIZE_IMAGE_SIZE_OPTIONS = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
] as const satisfies readonly AIFloorplanColorizeNodeOption<AIFloorplanColorizeImageSize>[];

export const AI_FLOORPLAN_COLORIZE_RESOLUTION_OPTIONS =
  AI_FLOORPLAN_COLORIZE_IMAGE_SIZE_OPTIONS;

export const AI_FLOORPLAN_COLORIZE_STYLE_OPTIONS = [
  { value: 'three-d-render', label: '3D 效果图' },
  { value: 'photoreal-render', label: '写实效果图' },
] as const;

const AI_FLOORPLAN_COLORIZE_MODEL_ASPECT_RATIOS = {
  'gemini-3-pro-image-preview': AI_FLOORPLAN_COLORIZE_SUPPORTED_ASPECT_RATIOS,
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
  AIFloorplanColorizeModel,
  readonly AIFloorplanColorizeAspectRatio[]
>;

const AI_FLOORPLAN_COLORIZE_MODEL_DEFAULT_ASPECT_RATIOS = {
  'gemini-3-pro-image-preview': 'auto',
  'gpt-image-2': 'auto',
  'gpt-image-2-vip': AI_FLOORPLAN_COLORIZE_DEFAULT_ASPECT_RATIO,
} as const satisfies Record<
  AIFloorplanColorizeModel,
  AIFloorplanColorizeAspectRatio
>;

const AI_FLOORPLAN_COLORIZE_MODEL_SET = new Set<string>(
  AI_FLOORPLAN_COLORIZE_SUPPORTED_MODELS as readonly string[],
);
const AI_FLOORPLAN_COLORIZE_IMAGE_SIZE_SET = new Set<string>(
  AI_FLOORPLAN_COLORIZE_SUPPORTED_IMAGE_SIZES as readonly string[],
);

export function isAIFloorplanColorizeModel(
  value: unknown,
): value is AIFloorplanColorizeModel {
  return typeof value === 'string' && AI_FLOORPLAN_COLORIZE_MODEL_SET.has(value);
}

export function normalizeAIFloorplanColorizeModel(
  value: unknown,
): AIFloorplanColorizeModel {
  return isAIFloorplanColorizeModel(value)
    ? value
    : AI_FLOORPLAN_COLORIZE_DEFAULT_MODEL;
}

export function isAIFloorplanColorizeParameterlessModel(value: unknown): value is typeof AI_FLOORPLAN_COLORIZE_PARAMETERLESS_MODEL {
  return value === AI_FLOORPLAN_COLORIZE_PARAMETERLESS_MODEL;
}

export function isAIFloorplanColorizeImageSize(
  value: unknown,
): value is AIFloorplanColorizeImageSize {
  return typeof value === 'string'
    && AI_FLOORPLAN_COLORIZE_IMAGE_SIZE_SET.has(value);
}

export function normalizeAIFloorplanColorizeImageSize(
  value: unknown,
): AIFloorplanColorizeImageSize {
  return isAIFloorplanColorizeImageSize(value)
    ? value
    : AI_FLOORPLAN_COLORIZE_DEFAULT_IMAGE_SIZE;
}

export function getAIFloorplanColorizeAspectRatioOptions(
  model: AIFloorplanColorizeModel,
): readonly AIFloorplanColorizeNodeOption<AIFloorplanColorizeAspectRatio>[] {
  const supportedAspectRatios = new Set<string>(
    AI_FLOORPLAN_COLORIZE_MODEL_ASPECT_RATIOS[model] as readonly string[],
  );

  return AI_FLOORPLAN_COLORIZE_RATIO_OPTIONS.filter((option) =>
    supportedAspectRatios.has(option.value),
  );
}

export function getAIFloorplanColorizeDefaultAspectRatio(
  model: AIFloorplanColorizeModel,
): AIFloorplanColorizeAspectRatio {
  return AI_FLOORPLAN_COLORIZE_MODEL_DEFAULT_ASPECT_RATIOS[model];
}

export function isAIFloorplanColorizeAspectRatio(
  model: AIFloorplanColorizeModel,
  value: unknown,
): value is AIFloorplanColorizeAspectRatio {
  return typeof value === 'string'
    && (
      AI_FLOORPLAN_COLORIZE_MODEL_ASPECT_RATIOS[model] as readonly string[]
    ).includes(value);
}

export function normalizeAIFloorplanColorizeAspectRatio(
  model: AIFloorplanColorizeModel,
  value: unknown,
): AIFloorplanColorizeAspectRatio {
  return isAIFloorplanColorizeAspectRatio(model, value)
    ? value
    : getAIFloorplanColorizeDefaultAspectRatio(model);
}

export function normalizeAIFloorplanColorizeStylePreset(
  value: unknown,
): AIFloorplanColorizeStylePreset {
  if (typeof value !== 'string') {
    return AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET;
  }

  const trimmed = value.trim();
  if (trimmed === 'three-d-render' || trimmed === 'photoreal-render') {
    return trimmed;
  }

  if (trimmed === 'default' || trimmed === 'modern' || trimmed === 'warm') {
    return AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET;
  }

  return AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET;
}

export function normalizeAIFloorplanColorizeConfig(config: {
  model?: unknown;
  imageSize?: unknown;
  aspectRatio?: unknown;
}): {
  model: AIFloorplanColorizeModel;
  imageSize: AIFloorplanColorizeImageSize;
  aspectRatio: AIFloorplanColorizeAspectRatio;
} {
  const model = normalizeAIFloorplanColorizeModel(config.model);

  return {
    model,
    imageSize: normalizeAIFloorplanColorizeImageSize(config.imageSize),
    aspectRatio: normalizeAIFloorplanColorizeAspectRatio(model, config.aspectRatio),
  };
}

export const AI_FLOORPLAN_COLORIZE_DEFAULT_SIZE = {
  width: 320,
  height: 296,
} as const;

export const AI_FLOORPLAN_COLORIZE_MIN_WIDTH = 320;
export const AI_FLOORPLAN_COLORIZE_MIN_HEIGHT = 296;
export const AI_FLOORPLAN_COLORIZE_GROUP_STACK_GAP = 10;
export const AI_FLOORPLAN_COLORIZE_DEFAULT_GROUP_HEIGHT = 118;
