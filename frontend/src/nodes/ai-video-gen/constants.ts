export const AI_VIDEO_GEN_FAST_MODEL = 'veo-3.1-fast-generate-preview' as const;
export const AI_VIDEO_GEN_QUALITY_MODEL = 'veo-3.1-generate-preview' as const;
export const AI_VIDEO_GEN_DEFAULT_MODEL = AI_VIDEO_GEN_FAST_MODEL;
export const AI_VIDEO_GEN_DURATION_SECONDS = 8 as const;
export const AI_VIDEO_GEN_PROVIDER = 'laozhang-veo' as const;
export const AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO = '16:9' as const;
export const AI_VIDEO_GEN_DEFAULT_RESOLUTION = '720p' as const;
export const AI_VIDEO_GEN_DEFAULT_SIZE = '1280x720' as const;

export const AI_VIDEO_GEN_SUPPORTED_MODELS = [
  AI_VIDEO_GEN_FAST_MODEL,
  AI_VIDEO_GEN_QUALITY_MODEL,
] as const;

export const AI_VIDEO_GEN_MODEL_OPTIONS = [
  { value: AI_VIDEO_GEN_FAST_MODEL, label: 'Veo 3.1 Fast' },
  { value: AI_VIDEO_GEN_QUALITY_MODEL, label: 'Veo 3.1 Quality' },
] as const;

export const AI_VIDEO_GEN_SUPPORTED_ASPECT_RATIOS = [
  '16:9',
  '9:16',
] as const;

export const AI_VIDEO_GEN_ASPECT_RATIO_OPTIONS = [
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
] as const;

export const AI_VIDEO_GEN_SUPPORTED_RESOLUTIONS = [
  '720p',
  '1080p',
  '4k',
] as const;

export const AI_VIDEO_GEN_RESOLUTION_OPTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' },
] as const;

const AI_VIDEO_GEN_LEGACY_MODEL_MAP = {
  'veo-3.1-fast': AI_VIDEO_GEN_FAST_MODEL,
  'veo-3.1-fast-fl': AI_VIDEO_GEN_FAST_MODEL,
  'veo-3.1-landscape-fast': AI_VIDEO_GEN_FAST_MODEL,
  'veo-3.1-landscape-fast-fl': AI_VIDEO_GEN_FAST_MODEL,
  'veo-3.1': AI_VIDEO_GEN_QUALITY_MODEL,
  'veo-3.1-fl': AI_VIDEO_GEN_QUALITY_MODEL,
  'veo-3.1-landscape': AI_VIDEO_GEN_QUALITY_MODEL,
  'veo-3.1-landscape-fl': AI_VIDEO_GEN_QUALITY_MODEL,
} as const;

export type AIVideoGenSupportedModel = typeof AI_VIDEO_GEN_SUPPORTED_MODELS[number];
export type AIVideoGenSupportedAspectRatio = typeof AI_VIDEO_GEN_SUPPORTED_ASPECT_RATIOS[number];
export type AIVideoGenSupportedResolution = typeof AI_VIDEO_GEN_SUPPORTED_RESOLUTIONS[number];
export type AIVideoGenSupportedSize =
  | '1280x720'
  | '720x1280'
  | '1920x1080'
  | '1080x1920'
  | '3840x2160';

export const AI_VIDEO_GEN_SIZE_BY_ASPECT_RATIO_AND_RESOLUTION: Record<
  AIVideoGenSupportedAspectRatio,
  Partial<Record<AIVideoGenSupportedResolution, AIVideoGenSupportedSize>>
> = {
  '16:9': {
    '720p': '1280x720',
    '1080p': '1920x1080',
    '4k': '3840x2160',
  },
  '9:16': {
    '720p': '720x1280',
    '1080p': '1080x1920',
  },
};

function normalizeTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

export function isAIVideoGenSupportedModel(value: unknown): value is AIVideoGenSupportedModel {
  return typeof value === 'string'
    && (AI_VIDEO_GEN_SUPPORTED_MODELS as readonly string[]).includes(value);
}

export function normalizeAIVideoGenModel(value: unknown): AIVideoGenSupportedModel | null {
  const normalized = normalizeTrimmedString(value);
  if (!normalized) {
    return null;
  }

  if (isAIVideoGenSupportedModel(normalized)) {
    return normalized;
  }

  return AI_VIDEO_GEN_LEGACY_MODEL_MAP[normalized as keyof typeof AI_VIDEO_GEN_LEGACY_MODEL_MAP] ?? null;
}

export function normalizeAIVideoGenDuration(value: unknown): typeof AI_VIDEO_GEN_DURATION_SECONDS | null {
  return value === AI_VIDEO_GEN_DURATION_SECONDS ? AI_VIDEO_GEN_DURATION_SECONDS : null;
}

export function normalizeAIVideoGenAspectRatio(value: unknown): AIVideoGenSupportedAspectRatio | null {
  const normalized = normalizeTrimmedString(value);
  if (!normalized) {
    return null;
  }

  return (AI_VIDEO_GEN_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(normalized)
    ? normalized as AIVideoGenSupportedAspectRatio
    : null;
}

export function normalizeAIVideoGenResolution(value: unknown): AIVideoGenSupportedResolution | null {
  const normalized = normalizeTrimmedString(value)?.toLowerCase();
  if (!normalized) {
    return null;
  }

  return (AI_VIDEO_GEN_SUPPORTED_RESOLUTIONS as readonly string[]).includes(normalized)
    ? normalized as AIVideoGenSupportedResolution
    : null;
}

export function resolveAIVideoGenSize(input: {
  aspectRatio?: unknown;
  resolution?: unknown;
}): AIVideoGenSupportedSize | null {
  const aspectRatio = normalizeAIVideoGenAspectRatio(input.aspectRatio) ?? AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO;
  const resolution = normalizeAIVideoGenResolution(input.resolution) ?? AI_VIDEO_GEN_DEFAULT_RESOLUTION;

  return AI_VIDEO_GEN_SIZE_BY_ASPECT_RATIO_AND_RESOLUTION[aspectRatio]?.[resolution] ?? null;
}

export function normalizeAIVideoGenParameters(input: {
  aspectRatio?: unknown;
  resolution?: unknown;
}): {
  aspectRatio: AIVideoGenSupportedAspectRatio;
  resolution: AIVideoGenSupportedResolution;
  size: AIVideoGenSupportedSize;
} {
  const requestedResolution = normalizeAIVideoGenResolution(input.resolution) ?? AI_VIDEO_GEN_DEFAULT_RESOLUTION;
  const requestedAspectRatio = normalizeAIVideoGenAspectRatio(input.aspectRatio) ?? AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO;
  const aspectRatio = requestedResolution === '4k' ? '16:9' : requestedAspectRatio;
  const size =
    resolveAIVideoGenSize({ aspectRatio, resolution: requestedResolution })
    ?? AI_VIDEO_GEN_DEFAULT_SIZE;

  return {
    aspectRatio,
    resolution: requestedResolution,
    size,
  };
}

export function getAIVideoGenResolutionOptions(
  aspectRatio: unknown,
): ReadonlyArray<{ value: AIVideoGenSupportedResolution; label: string }> {
  const normalizedAspectRatio = normalizeAIVideoGenAspectRatio(aspectRatio) ?? AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO;

  return AI_VIDEO_GEN_RESOLUTION_OPTIONS.filter((option) => (
    Boolean(AI_VIDEO_GEN_SIZE_BY_ASPECT_RATIO_AND_RESOLUTION[normalizedAspectRatio]?.[option.value])
  ));
}
