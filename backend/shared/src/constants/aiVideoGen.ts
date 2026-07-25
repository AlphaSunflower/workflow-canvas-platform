export const AI_VIDEO_GEN_NODE_TYPE = "aiVideoGen" as const;
export const AI_VIDEO_GEN_TASK_TYPE = "video-gen" as const;
export const AI_VIDEO_GEN_EXECUTION_MODE = "legacy-grouped-task" as const;

export const AI_VIDEO_GEN_PROVIDER = "laozhang-veo" as const;
export const AI_VIDEO_GEN_FAST_MODEL = "veo-3.1-fast-generate-preview" as const;
export const AI_VIDEO_GEN_QUALITY_MODEL = "veo-3.1-generate-preview" as const;
export const AI_VIDEO_GEN_MODEL = AI_VIDEO_GEN_FAST_MODEL;
export const AI_VIDEO_GEN_PIPELINE_VERSION = "v1" as const;
export const AI_VIDEO_GEN_PROMPT_VERSION = "v1" as const;

export const AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS = 8 as const;
export const AI_VIDEO_GEN_SUPPORTED_DURATIONS_SECONDS = [
  4,
  6,
  AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
] as const;

export type AIVideoGenSupportedDurationSeconds =
  (typeof AI_VIDEO_GEN_SUPPORTED_DURATIONS_SECONDS)[number];

export function normalizeAIVideoGenDuration(
  value: unknown,
): AIVideoGenSupportedDurationSeconds | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const truncated = Math.trunc(value);
  return (AI_VIDEO_GEN_SUPPORTED_DURATIONS_SECONDS as readonly number[]).includes(truncated)
    ? (truncated as AIVideoGenSupportedDurationSeconds)
    : null;
}

export const AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO = "16:9" as const;
export const AI_VIDEO_GEN_DEFAULT_RESOLUTION = "720p" as const;
export const AI_VIDEO_GEN_DEFAULT_SIZE = "1280x720" as const;

export const AI_VIDEO_GEN_SUPPORTED_ASPECT_RATIOS = [
  "16:9",
  "9:16",
] as const;

export const AI_VIDEO_GEN_SUPPORTED_RESOLUTIONS = [
  "720p",
  "1080p",
  "4k",
] as const;

export type AIVideoGenSupportedAspectRatio =
  (typeof AI_VIDEO_GEN_SUPPORTED_ASPECT_RATIOS)[number];

export type AIVideoGenSupportedResolution =
  (typeof AI_VIDEO_GEN_SUPPORTED_RESOLUTIONS)[number];

export type AIVideoGenSupportedSize =
  | "1280x720"
  | "720x1280"
  | "1920x1080"
  | "1080x1920"
  | "3840x2160";

export const AI_VIDEO_GEN_SIZE_BY_ASPECT_RATIO_AND_RESOLUTION: Record<
  AIVideoGenSupportedAspectRatio,
  Partial<Record<AIVideoGenSupportedResolution, AIVideoGenSupportedSize>>
> = {
  "16:9": {
    "720p": "1280x720",
    "1080p": "1920x1080",
    "4k": "3840x2160",
  },
  "9:16": {
    "720p": "720x1280",
    "1080p": "1080x1920",
  },
};

export const AI_VIDEO_GEN_SUPPORTED_MODELS = [
  AI_VIDEO_GEN_FAST_MODEL,
  AI_VIDEO_GEN_QUALITY_MODEL,
] as const;

export type AIVideoGenSupportedModel =
  (typeof AI_VIDEO_GEN_SUPPORTED_MODELS)[number];

export const AI_VIDEO_GEN_IMAGE_REFERENCE_MODELS = [
  AI_VIDEO_GEN_FAST_MODEL,
  AI_VIDEO_GEN_QUALITY_MODEL,
] as const satisfies readonly AIVideoGenSupportedModel[];

export const AI_VIDEO_GEN_LEGACY_MODEL_MAP = {
  "veo-3.1-fast": AI_VIDEO_GEN_FAST_MODEL,
  "veo-3.1-fast-fl": AI_VIDEO_GEN_FAST_MODEL,
  "veo-3.1-landscape-fast": AI_VIDEO_GEN_FAST_MODEL,
  "veo-3.1-landscape-fast-fl": AI_VIDEO_GEN_FAST_MODEL,
  "veo-3.1": AI_VIDEO_GEN_QUALITY_MODEL,
  "veo-3.1-fl": AI_VIDEO_GEN_QUALITY_MODEL,
  "veo-3.1-landscape": AI_VIDEO_GEN_QUALITY_MODEL,
  "veo-3.1-landscape-fl": AI_VIDEO_GEN_QUALITY_MODEL,
} as const satisfies Record<string, AIVideoGenSupportedModel>;

export type AIVideoGenLegacyModel =
  keyof typeof AI_VIDEO_GEN_LEGACY_MODEL_MAP;

export type AIVideoGenAcceptedModel =
  | AIVideoGenSupportedModel
  | AIVideoGenLegacyModel;

export function normalizeAIVideoGenModel(
  value: unknown,
): AIVideoGenSupportedModel | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if ((AI_VIDEO_GEN_SUPPORTED_MODELS as readonly string[]).includes(trimmed)) {
    return trimmed as AIVideoGenSupportedModel;
  }

  return AI_VIDEO_GEN_LEGACY_MODEL_MAP[trimmed as AIVideoGenLegacyModel] ?? null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function normalizeAIVideoGenAspectRatio(
  value: unknown,
): AIVideoGenSupportedAspectRatio | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  return (AI_VIDEO_GEN_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(normalized)
    ? normalized as AIVideoGenSupportedAspectRatio
    : null;
}

export function normalizeAIVideoGenResolution(
  value: unknown,
): AIVideoGenSupportedResolution | null {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) {
    return null;
  }

  return (AI_VIDEO_GEN_SUPPORTED_RESOLUTIONS as readonly string[]).includes(normalized)
    ? normalized as AIVideoGenSupportedResolution
    : null;
}

export function resolveAIVideoGenSize(
  input: {
    aspectRatio?: unknown;
    resolution?: unknown;
  },
): AIVideoGenSupportedSize | null {
  const aspectRatio =
    normalizeAIVideoGenAspectRatio(input.aspectRatio)
    ?? AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO;
  const resolution =
    normalizeAIVideoGenResolution(input.resolution)
    ?? AI_VIDEO_GEN_DEFAULT_RESOLUTION;

  return AI_VIDEO_GEN_SIZE_BY_ASPECT_RATIO_AND_RESOLUTION[aspectRatio]?.[resolution]
    ?? null;
}

export function normalizeAIVideoGenParameters(input: {
  aspectRatio?: unknown;
  resolution?: unknown;
  duration?: unknown;
}): {
  aspectRatio: AIVideoGenSupportedAspectRatio;
  resolution: AIVideoGenSupportedResolution;
  size: AIVideoGenSupportedSize;
  duration: AIVideoGenSupportedDurationSeconds;
  metadata?: string;
} | null {
  const aspectRatio =
    normalizeAIVideoGenAspectRatio(input.aspectRatio)
    ?? AI_VIDEO_GEN_DEFAULT_ASPECT_RATIO;
  const resolution =
    normalizeAIVideoGenResolution(input.resolution)
    ?? AI_VIDEO_GEN_DEFAULT_RESOLUTION;
  const duration =
    normalizeAIVideoGenDuration(input.duration)
    ?? AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS;
  const size = resolveAIVideoGenSize({ aspectRatio, resolution });

  if (!size) {
    return null;
  }

  return {
    aspectRatio,
    resolution,
    size,
    duration,
    metadata: JSON.stringify({
      durationSeconds: duration,
      resolution,
      aspectRatio,
    }),
  };
}

export const AI_VIDEO_GEN_MIN_REFERENCE_COUNT = 1 as const;
export const AI_VIDEO_GEN_MAX_REFERENCE_COUNT = 4 as const;
export const AI_VIDEO_GEN_DEFAULT_POLL_INTERVAL_MS = 5000 as const;
export const AI_VIDEO_GEN_DEFAULT_TIMEOUT_MS = 600000 as const;
// Null means no local provider concurrency limit by default.
export const AI_VIDEO_GEN_DEFAULT_MAX_CONCURRENCY = null;
export const AI_VIDEO_GEN_DEFAULT_BASE_URL = "https://api2.laozhang.ai/v1" as const;

export interface AIVideoGenExecutionGroupInput {
  groupId: string;
  referenceFileIds: string[];
}
