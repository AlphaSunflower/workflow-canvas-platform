type AIImageGenNodeOption<T extends string> = {
  value: T;
  label: string;
};

export const AI_IMAGE_GEN_NODE_SUPPORTED_MODELS = [
  'gemini-3-pro-image-preview',
  'gpt-image-2',
  'gpt-image-2-vip',
  'gpt-image-2-official',
] as const;

export type AIImageGenNodeModel =
  (typeof AI_IMAGE_GEN_NODE_SUPPORTED_MODELS)[number];

export const AI_IMAGE_GEN_NODE_SUPPORTED_IMAGE_SIZES = [
  '1K',
  '2K',
  '4K',
] as const;

export type AIImageGenNodeImageSize =
  (typeof AI_IMAGE_GEN_NODE_SUPPORTED_IMAGE_SIZES)[number];

export const AI_IMAGE_GEN_NODE_SUPPORTED_ASPECT_RATIOS = [
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

export type AIImageGenNodeAspectRatio =
  (typeof AI_IMAGE_GEN_NODE_SUPPORTED_ASPECT_RATIOS)[number];

export const AI_IMAGE_GEN_NODE_OFFICIAL_QUALITIES = [
  'auto',
  'low',
  'medium',
  'high',
] as const;

export type AIImageGenNodeOfficialQuality =
  (typeof AI_IMAGE_GEN_NODE_OFFICIAL_QUALITIES)[number];

export const AI_IMAGE_GEN_NODE_GPT_IMAGE_2_MODEL = 'gpt-image-2' as const;
export const AI_IMAGE_GEN_NODE_GPT_IMAGE_2_VIP_MODEL = 'gpt-image-2-vip' as const;
export const AI_IMAGE_GEN_NODE_DEFAULT_MODEL = AI_IMAGE_GEN_NODE_GPT_IMAGE_2_MODEL;
export const AI_IMAGE_GEN_NODE_DEFAULT_IMAGE_SIZE = '1K';
export const AI_IMAGE_GEN_NODE_DEFAULT_ASPECT_RATIO = '1:1';
export const AI_IMAGE_GEN_NODE_OFFICIAL_MODEL = 'gpt-image-2-official' as const;
export const AI_IMAGE_GEN_NODE_DEFAULT_OFFICIAL_QUALITY = 'auto' as const;

export const AI_IMAGE_GEN_NODE_MODEL_OPTIONS = [
  { value: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image Preview' },
  { value: 'gpt-image-2', label: 'GPT Image 2' },
  { value: 'gpt-image-2-vip', label: 'GPT Image 2 VIP' },
  { value: 'gpt-image-2-official', label: 'GPT Image 2 Official' },
] as const satisfies readonly AIImageGenNodeOption<AIImageGenNodeModel>[];

export const AI_IMAGE_GEN_NODE_VISIBLE_MODEL_OPTIONS = AI_IMAGE_GEN_NODE_MODEL_OPTIONS.filter(
  (option) => option.value !== AI_IMAGE_GEN_NODE_OFFICIAL_MODEL,
);

export const AI_IMAGE_GEN_NODE_IMAGE_SIZE_OPTIONS = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
] as const satisfies readonly AIImageGenNodeOption<AIImageGenNodeImageSize>[];

export const AI_IMAGE_GEN_NODE_ASPECT_RATIO_OPTIONS = [
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
] as const satisfies readonly AIImageGenNodeOption<AIImageGenNodeAspectRatio>[];

export const AI_IMAGE_GEN_NODE_OFFICIAL_QUALITY_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const satisfies readonly AIImageGenNodeOption<AIImageGenNodeOfficialQuality>[];

const AI_IMAGE_GEN_NODE_MODEL_ASPECT_RATIOS = {
  'gemini-3-pro-image-preview': AI_IMAGE_GEN_NODE_SUPPORTED_ASPECT_RATIOS,
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
  'gpt-image-2-official': AI_IMAGE_GEN_NODE_SUPPORTED_ASPECT_RATIOS,
} as const satisfies Record<
  AIImageGenNodeModel,
  readonly AIImageGenNodeAspectRatio[]
>;

const AI_IMAGE_GEN_NODE_MODEL_DEFAULT_ASPECT_RATIOS = {
  'gemini-3-pro-image-preview': 'auto',
  'gpt-image-2': 'auto',
  'gpt-image-2-vip': '1:1',
  'gpt-image-2-official': 'auto',
} as const satisfies Record<
  AIImageGenNodeModel,
  AIImageGenNodeAspectRatio
>;

const AI_IMAGE_GEN_NODE_MODEL_SET = new Set<string>(
  AI_IMAGE_GEN_NODE_SUPPORTED_MODELS as readonly string[],
);
const AI_IMAGE_GEN_NODE_IMAGE_SIZE_SET = new Set<string>(
  AI_IMAGE_GEN_NODE_SUPPORTED_IMAGE_SIZES as readonly string[],
);
const AI_IMAGE_GEN_NODE_OFFICIAL_QUALITY_SET = new Set<string>(
  AI_IMAGE_GEN_NODE_OFFICIAL_QUALITIES as readonly string[],
);

export function isAIImageGenNodeModel(value: unknown): value is AIImageGenNodeModel {
  return typeof value === 'string' && AI_IMAGE_GEN_NODE_MODEL_SET.has(value);
}

export function normalizeAIImageGenNodeModel(value: unknown): AIImageGenNodeModel {
  return isAIImageGenNodeModel(value) ? value : AI_IMAGE_GEN_NODE_DEFAULT_MODEL;
}

export function isAIImageGenNodeOfficialModel(value: unknown): value is typeof AI_IMAGE_GEN_NODE_OFFICIAL_MODEL {
  return value === AI_IMAGE_GEN_NODE_OFFICIAL_MODEL;
}

export function isAIImageGenNodeParameterlessModel(value: unknown): value is typeof AI_IMAGE_GEN_NODE_GPT_IMAGE_2_MODEL {
  return value === AI_IMAGE_GEN_NODE_GPT_IMAGE_2_MODEL;
}

export function isAIImageGenNodeImageSize(value: unknown): value is AIImageGenNodeImageSize {
  return typeof value === 'string' && AI_IMAGE_GEN_NODE_IMAGE_SIZE_SET.has(value);
}

export function normalizeAIImageGenNodeImageSize(value: unknown): AIImageGenNodeImageSize {
  return isAIImageGenNodeImageSize(value)
    ? value
    : AI_IMAGE_GEN_NODE_DEFAULT_IMAGE_SIZE;
}

export function isAIImageGenNodeOfficialQuality(value: unknown): value is AIImageGenNodeOfficialQuality {
  return typeof value === 'string' && AI_IMAGE_GEN_NODE_OFFICIAL_QUALITY_SET.has(value);
}

export function normalizeAIImageGenNodeOfficialQuality(value: unknown): AIImageGenNodeOfficialQuality {
  return isAIImageGenNodeOfficialQuality(value)
    ? value
    : AI_IMAGE_GEN_NODE_DEFAULT_OFFICIAL_QUALITY;
}

export function getAIImageGenNodeSupportedAspectRatios(
  model: AIImageGenNodeModel,
): readonly AIImageGenNodeAspectRatio[] {
  return AI_IMAGE_GEN_NODE_MODEL_ASPECT_RATIOS[model];
}

export function getAIImageGenNodeDefaultAspectRatio(
  model: AIImageGenNodeModel,
): AIImageGenNodeAspectRatio {
  return AI_IMAGE_GEN_NODE_MODEL_DEFAULT_ASPECT_RATIOS[model];
}

export function getAIImageGenNodeAspectRatioOptions(
  model: AIImageGenNodeModel,
): readonly AIImageGenNodeOption<AIImageGenNodeAspectRatio>[] {
  const supportedAspectRatios = new Set<string>(
    AI_IMAGE_GEN_NODE_MODEL_ASPECT_RATIOS[model] as readonly string[],
  );

  return AI_IMAGE_GEN_NODE_ASPECT_RATIO_OPTIONS.filter((option) =>
    supportedAspectRatios.has(option.value),
  );
}

export function isAIImageGenNodeAspectRatio(
  model: AIImageGenNodeModel,
  value: unknown,
): value is AIImageGenNodeAspectRatio {
  return typeof value === 'string'
    && (
      AI_IMAGE_GEN_NODE_MODEL_ASPECT_RATIOS[model] as readonly string[]
    ).includes(value);
}

export function normalizeAIImageGenNodeAspectRatio(
  model: AIImageGenNodeModel,
  value: unknown,
): AIImageGenNodeAspectRatio {
  return isAIImageGenNodeAspectRatio(model, value)
    ? value
    : getAIImageGenNodeDefaultAspectRatio(model);
}

export function normalizeAIImageGenNodeConfig(config: {
  model?: unknown;
  imageSize?: unknown;
  aspectRatio?: unknown;
  quality?: unknown;
}): {
  model: AIImageGenNodeModel;
  imageSize: AIImageGenNodeImageSize;
  aspectRatio: AIImageGenNodeAspectRatio;
  quality?: AIImageGenNodeOfficialQuality;
} {
  const model = normalizeAIImageGenNodeModel(config.model);
  const imageSize = normalizeAIImageGenNodeImageSize(config.imageSize);
  const aspectRatio = normalizeAIImageGenNodeAspectRatio(model, config.aspectRatio);

  return {
    model,
    imageSize,
    aspectRatio,
    ...(isAIImageGenNodeOfficialModel(model)
      ? { quality: normalizeAIImageGenNodeOfficialQuality(config.quality) }
      : {}),
  };
}
