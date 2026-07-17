import type { AIConfig } from '@/types';

type ModelRenderTransferNodeOption<T extends string> = {
  value: T;
  label: string;
};

export const MODEL_RENDER_TRANSFER_MIN_GROUPS = 1;
export const MODEL_RENDER_TRANSFER_MAX_GROUPS = 10;

export const MODEL_RENDER_TRANSFER_WHITE_MODEL_PORT_ID = 'white-model';
export const MODEL_RENDER_TRANSFER_STYLE_REFERENCE_PORT_ID = 'style-reference';
export const MODEL_RENDER_TRANSFER_RESULT_PORT_ID = 'result';

export const MODEL_RENDER_TRANSFER_DISPLAY_NAME = '白模图迁移渲染';
export const MODEL_RENDER_TRANSFER_ICON = 'WMR';
export const MODEL_RENDER_TRANSFER_COLOR = '#f59e0b';
export const MODEL_RENDER_TRANSFER_DESCRIPTION =
  '最多 10 组，每组 1 张白模图加 1 张风格参考图，运行后每组产出 1 张迁移渲染结果。';

export const MODEL_RENDER_TRANSFER_NODE_SUPPORTED_MODELS = [
  'gemini-3-pro-image-preview',
  'gpt-image-2',
  'gpt-image-2-vip',
] as const;

export type ModelRenderTransferNodeModel =
  (typeof MODEL_RENDER_TRANSFER_NODE_SUPPORTED_MODELS)[number];

export const MODEL_RENDER_TRANSFER_NODE_SUPPORTED_IMAGE_SIZES = [
  '1K',
  '2K',
  '4K',
] as const;

export type ModelRenderTransferNodeImageSize =
  (typeof MODEL_RENDER_TRANSFER_NODE_SUPPORTED_IMAGE_SIZES)[number];

export const MODEL_RENDER_TRANSFER_NODE_SUPPORTED_ASPECT_RATIOS = [
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

export type ModelRenderTransferNodeAspectRatio =
  (typeof MODEL_RENDER_TRANSFER_NODE_SUPPORTED_ASPECT_RATIOS)[number];

export const MODEL_RENDER_TRANSFER_PARAMETERLESS_MODEL = 'gpt-image-2' as const;
export const MODEL_RENDER_TRANSFER_DEFAULT_MODEL = MODEL_RENDER_TRANSFER_PARAMETERLESS_MODEL;
export const MODEL_RENDER_TRANSFER_DEFAULT_IMAGE_SIZE = '1K';
export const MODEL_RENDER_TRANSFER_DEFAULT_ASPECT_RATIO = '1:1';

export const MODEL_RENDER_TRANSFER_NODE_MODEL_OPTIONS = [
  { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image Preview' },
  { value: 'gpt-image-2', label: 'GPT Image 2' },
  { value: 'gpt-image-2-vip', label: 'GPT Image 2 VIP' },
] as const satisfies readonly ModelRenderTransferNodeOption<ModelRenderTransferNodeModel>[];

export const MODEL_RENDER_TRANSFER_NODE_IMAGE_SIZE_OPTIONS = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
] as const satisfies readonly ModelRenderTransferNodeOption<ModelRenderTransferNodeImageSize>[];

export const MODEL_RENDER_TRANSFER_NODE_ASPECT_RATIO_OPTIONS = [
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
] as const satisfies readonly ModelRenderTransferNodeOption<ModelRenderTransferNodeAspectRatio>[];

const MODEL_RENDER_TRANSFER_NODE_MODEL_ASPECT_RATIOS = {
  'gemini-3-pro-image-preview': MODEL_RENDER_TRANSFER_NODE_SUPPORTED_ASPECT_RATIOS,
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
  ModelRenderTransferNodeModel,
  readonly ModelRenderTransferNodeAspectRatio[]
>;

const MODEL_RENDER_TRANSFER_NODE_MODEL_DEFAULT_ASPECT_RATIOS = {
  'gemini-3-pro-image-preview': 'auto',
  'gpt-image-2': 'auto',
  'gpt-image-2-vip': MODEL_RENDER_TRANSFER_DEFAULT_ASPECT_RATIO,
} as const satisfies Record<
  ModelRenderTransferNodeModel,
  ModelRenderTransferNodeAspectRatio
>;

const MODEL_RENDER_TRANSFER_NODE_MODEL_SET = new Set<string>(
  MODEL_RENDER_TRANSFER_NODE_SUPPORTED_MODELS as readonly string[],
);
const MODEL_RENDER_TRANSFER_NODE_IMAGE_SIZE_SET = new Set<string>(
  MODEL_RENDER_TRANSFER_NODE_SUPPORTED_IMAGE_SIZES as readonly string[],
);

export function isModelRenderTransferNodeModel(
  value: unknown,
): value is ModelRenderTransferNodeModel {
  return typeof value === 'string'
    && MODEL_RENDER_TRANSFER_NODE_MODEL_SET.has(value);
}

export function normalizeModelRenderTransferNodeModel(
  value: unknown,
): ModelRenderTransferNodeModel {
  return isModelRenderTransferNodeModel(value)
    ? value
    : MODEL_RENDER_TRANSFER_DEFAULT_MODEL;
}

export function isModelRenderTransferParameterlessModel(value: unknown): value is typeof MODEL_RENDER_TRANSFER_PARAMETERLESS_MODEL {
  return value === MODEL_RENDER_TRANSFER_PARAMETERLESS_MODEL;
}

export function isModelRenderTransferNodeImageSize(
  value: unknown,
): value is ModelRenderTransferNodeImageSize {
  return typeof value === 'string'
    && MODEL_RENDER_TRANSFER_NODE_IMAGE_SIZE_SET.has(value);
}

export function normalizeModelRenderTransferNodeImageSize(
  value: unknown,
): ModelRenderTransferNodeImageSize {
  return isModelRenderTransferNodeImageSize(value)
    ? value
    : MODEL_RENDER_TRANSFER_DEFAULT_IMAGE_SIZE;
}

export function getModelRenderTransferNodeAspectRatioOptions(
  model: ModelRenderTransferNodeModel,
): readonly ModelRenderTransferNodeOption<ModelRenderTransferNodeAspectRatio>[] {
  const supportedAspectRatios = new Set<string>(
    MODEL_RENDER_TRANSFER_NODE_MODEL_ASPECT_RATIOS[model] as readonly string[],
  );

  return MODEL_RENDER_TRANSFER_NODE_ASPECT_RATIO_OPTIONS.filter((option) =>
    supportedAspectRatios.has(option.value),
  );
}

export function getModelRenderTransferNodeDefaultAspectRatio(
  model: ModelRenderTransferNodeModel,
): ModelRenderTransferNodeAspectRatio {
  return MODEL_RENDER_TRANSFER_NODE_MODEL_DEFAULT_ASPECT_RATIOS[model];
}

export function isModelRenderTransferNodeAspectRatio(
  model: ModelRenderTransferNodeModel,
  value: unknown,
): value is ModelRenderTransferNodeAspectRatio {
  return typeof value === 'string'
    && (
      MODEL_RENDER_TRANSFER_NODE_MODEL_ASPECT_RATIOS[model] as readonly string[]
    ).includes(value);
}

export function normalizeModelRenderTransferNodeAspectRatio(
  model: ModelRenderTransferNodeModel,
  value: unknown,
): ModelRenderTransferNodeAspectRatio {
  return isModelRenderTransferNodeAspectRatio(model, value)
    ? value
    : getModelRenderTransferNodeDefaultAspectRatio(model);
}

export function normalizeModelRenderTransferNodeConfig(config: {
  model?: unknown;
  imageSize?: unknown;
  aspectRatio?: unknown;
}): {
  model: ModelRenderTransferNodeModel;
  imageSize: ModelRenderTransferNodeImageSize;
  aspectRatio: ModelRenderTransferNodeAspectRatio;
} {
  const model = normalizeModelRenderTransferNodeModel(config.model);

  return {
    model,
    imageSize: normalizeModelRenderTransferNodeImageSize(config.imageSize),
    aspectRatio: normalizeModelRenderTransferNodeAspectRatio(model, config.aspectRatio),
  };
}

export const MODEL_RENDER_TRANSFER_DEFAULT_SIZE = {
  width: 320,
  height: 296,
} as const;

export const MODEL_RENDER_TRANSFER_DEFAULT_CONFIG: AIConfig = {
  model: MODEL_RENDER_TRANSFER_DEFAULT_MODEL,
  provider: 'laozhang',
  imageSize: MODEL_RENDER_TRANSFER_DEFAULT_IMAGE_SIZE,
  aspectRatio: MODEL_RENDER_TRANSFER_DEFAULT_ASPECT_RATIO,
  steps: undefined,
  strength: undefined,
  cfgScale: undefined,
  width: undefined,
  height: undefined,
  resolutionPreset: undefined,
};
