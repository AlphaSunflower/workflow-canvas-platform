import {
  LAOZHANG_OPENAI_IMAGES_GPT_IMAGE_2_OFFICIAL_MODEL,
  LAOZHANG_OPENAI_IMAGES_PROVIDER_MODEL_GPT_IMAGE_2,
  LAOZHANG_OPENAI_IMAGES_QUALITIES,
  type LaozhangOpenAIImagesQuality,
} from "./laozhangOpenAIImages.ts";

export const AI_IMAGE_GEN_NODE_TYPE = "aiImageGen" as const;
export const AI_IMAGE_GEN_TASK_TYPE = "image-gen" as const;
export const AI_IMAGE_GEN_EXECUTION_MODE = "legacy-grouped-task" as const;

export const AI_IMAGE_GEN_PROVIDER = "laozhang" as const;
export const AI_IMAGE_GEN_MODEL = "gemini-3-pro-image-preview" as const;
export const AI_IMAGE_GEN_GPT_IMAGE_2_MODEL = "gpt-image-2" as const;
export const AI_IMAGE_GEN_GPT_IMAGE_2_LEGACY_MODEL = "gpt-image-2-vip" as const;
export const AI_IMAGE_GEN_GPT_IMAGE_2_VIP_MODEL = AI_IMAGE_GEN_GPT_IMAGE_2_LEGACY_MODEL;
export const AI_IMAGE_GEN_DEFAULT_MODEL = AI_IMAGE_GEN_GPT_IMAGE_2_MODEL;
export const AI_IMAGE_GEN_PIPELINE_VERSION = "v1" as const;
export const AI_IMAGE_GEN_PROMPT_VERSION = "v1" as const;

export const AI_IMAGE_GEN_DEFAULT_IMAGE_SIZE = "1K" as const;
export const AI_IMAGE_GEN_DEFAULT_ASPECT_RATIO = "1:1" as const;

export const AI_IMAGE_GEN_SUPPORTED_IMAGE_SIZES = [
  "1K",
  "2K",
  "4K",
] as const;

export type AIImageGenSupportedImageSize =
  (typeof AI_IMAGE_GEN_SUPPORTED_IMAGE_SIZES)[number];

export const AI_IMAGE_GEN_SUPPORTED_ASPECT_RATIOS = [
  "auto",
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "21:9",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
] as const;

export type AIImageGenSupportedAspectRatio =
  (typeof AI_IMAGE_GEN_SUPPORTED_ASPECT_RATIOS)[number];

export const AI_IMAGE_GEN_GPT_IMAGE_2_VIP_SUPPORTED_ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "21:9",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
] as const;

export type AIImageGenGptImage2VipSupportedAspectRatio =
  (typeof AI_IMAGE_GEN_GPT_IMAGE_2_VIP_SUPPORTED_ASPECT_RATIOS)[number];

export const AI_IMAGE_GEN_SUPPORTED_MODELS = [
  AI_IMAGE_GEN_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_VIP_MODEL,
  LAOZHANG_OPENAI_IMAGES_GPT_IMAGE_2_OFFICIAL_MODEL,
] as const;

export type AIImageGenSupportedModel =
  (typeof AI_IMAGE_GEN_SUPPORTED_MODELS)[number];

export const AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL =
  LAOZHANG_OPENAI_IMAGES_GPT_IMAGE_2_OFFICIAL_MODEL;
export const AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL =
  LAOZHANG_OPENAI_IMAGES_PROVIDER_MODEL_GPT_IMAGE_2;

export const AI_IMAGE_GEN_OFFICIAL_QUALITIES = LAOZHANG_OPENAI_IMAGES_QUALITIES;
export const AI_IMAGE_GEN_DEFAULT_OFFICIAL_QUALITY = "auto" as const satisfies AIImageGenOfficialQuality;

export type AIImageGenOfficialQuality = LaozhangOpenAIImagesQuality;

export const AI_IMAGE_GEN_GPT_IMAGE_2_VIP_SIZE_MAP = {
  "1K": {
    "1:1": "1280x1280",
    "16:9": "1280x720",
    "9:16": "720x1280",
    "4:3": "1280x960",
    "3:4": "960x1280",
    "21:9": "1280x544",
    "3:2": "1280x848",
    "2:3": "848x1280",
    "5:4": "1280x1024",
    "4:5": "1024x1280",
  },
  "2K": {
    "1:1": "2048x2048",
    "16:9": "2048x1152",
    "9:16": "1152x2048",
    "4:3": "2048x1536",
    "3:4": "1536x2048",
    "21:9": "2048x864",
    "3:2": "2048x1360",
    "2:3": "1360x2048",
    "5:4": "2048x1632",
    "4:5": "1632x2048",
  },
  "4K": {
    "1:1": "2880x2880",
    "16:9": "3840x2160",
    "9:16": "2160x3840",
    "4:3": "3312x2480",
    "3:4": "2480x3312",
    "21:9": "3840x1632",
    "3:2": "3520x2336",
    "2:3": "2336x3520",
    "5:4": "3216x2560",
    "4:5": "2560x3216",
  },
} as const satisfies Record<
  AIImageGenSupportedImageSize,
  Record<AIImageGenGptImage2VipSupportedAspectRatio, string>
>;

export const AI_IMAGE_GEN_MIN_REFERENCE_COUNT = 1 as const;
export const AI_IMAGE_GEN_MAX_REFERENCE_COUNT = 5 as const;

export interface AIImageGenExecutionGroupInput {
  groupId: string;
  referenceFileIds: string[];
}

export function isAIImageGenSupportedModel(value: unknown): value is AIImageGenSupportedModel {
  return typeof value === "string"
    && (AI_IMAGE_GEN_SUPPORTED_MODELS as readonly string[]).includes(value);
}

export function isAIImageGenOfficialModel(
  value: unknown,
): value is typeof AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL {
  return value === AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL;
}

export function isAIImageGenGptImage2Model(
  value: unknown,
): value is typeof AI_IMAGE_GEN_GPT_IMAGE_2_MODEL {
  return value === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL;
}

export function isAIImageGenGptImage2VipModel(
  value: unknown,
): value is typeof AI_IMAGE_GEN_GPT_IMAGE_2_VIP_MODEL {
  return value === AI_IMAGE_GEN_GPT_IMAGE_2_VIP_MODEL;
}

export function isAIImageGenParameterlessModel(value: unknown): boolean {
  return isAIImageGenGptImage2Model(value);
}

export function isAIImageGenOfficialQuality(
  value: unknown,
): value is AIImageGenOfficialQuality {
  return typeof value === "string"
    && (AI_IMAGE_GEN_OFFICIAL_QUALITIES as readonly string[]).includes(value);
}

export function resolveAIImageGenOutputSize(
  model: AIImageGenSupportedModel,
  imageSize: AIImageGenSupportedImageSize,
  aspectRatio: AIImageGenSupportedAspectRatio,
): string | null {
  if (model === AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL && aspectRatio === "auto") {
    return "auto";
  }

  if (model !== AI_IMAGE_GEN_GPT_IMAGE_2_VIP_MODEL) {
    if (model !== AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL) {
      return null;
    }
  }

  if (!(AI_IMAGE_GEN_GPT_IMAGE_2_VIP_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(aspectRatio)) {
    return null;
  }

  const resolvedAspectRatio = aspectRatio as AIImageGenGptImage2VipSupportedAspectRatio;
  return AI_IMAGE_GEN_GPT_IMAGE_2_VIP_SIZE_MAP[imageSize][resolvedAspectRatio];
}
