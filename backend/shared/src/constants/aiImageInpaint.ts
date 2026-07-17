import {
  AI_IMAGE_GEN_DEFAULT_ASPECT_RATIO,
  AI_IMAGE_GEN_DEFAULT_IMAGE_SIZE,
  AI_IMAGE_GEN_DEFAULT_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL,
  AI_IMAGE_GEN_PROVIDER,
  AI_IMAGE_GEN_SUPPORTED_ASPECT_RATIOS,
  AI_IMAGE_GEN_SUPPORTED_IMAGE_SIZES,
  AI_IMAGE_GEN_SUPPORTED_MODELS,
  type AIImageGenSupportedAspectRatio,
  type AIImageGenSupportedImageSize,
  type AIImageGenSupportedModel,
} from "./aiImageGen.ts";

export const AI_IMAGE_INPAINT_NODE_TYPE = "aiImageInpaint" as const;
export const AI_IMAGE_INPAINT_TASK_TYPE = "image-inpaint" as const;
export const AI_IMAGE_INPAINT_EXECUTION_MODE = "legacy-grouped-task" as const;

export const AI_IMAGE_INPAINT_PROVIDER = AI_IMAGE_GEN_PROVIDER;
export const AI_IMAGE_INPAINT_DEFAULT_MODEL = AI_IMAGE_GEN_DEFAULT_MODEL;
export const AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE = AI_IMAGE_GEN_DEFAULT_IMAGE_SIZE;
export const AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO = AI_IMAGE_GEN_DEFAULT_ASPECT_RATIO;
export const AI_IMAGE_INPAINT_PIPELINE_VERSION = "v1" as const;
export const AI_IMAGE_INPAINT_PROMPT_VERSION = "v1" as const;

export const AI_IMAGE_INPAINT_SUPPORTED_MODELS = AI_IMAGE_GEN_SUPPORTED_MODELS.filter(
  (model) => model !== AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL,
) as readonly Exclude<AIImageGenSupportedModel, typeof AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL>[];
export const AI_IMAGE_INPAINT_SUPPORTED_IMAGE_SIZES = AI_IMAGE_GEN_SUPPORTED_IMAGE_SIZES;
export const AI_IMAGE_INPAINT_SUPPORTED_ASPECT_RATIOS = AI_IMAGE_GEN_SUPPORTED_ASPECT_RATIOS;

export type AIImageInpaintSupportedModel =
  (typeof AI_IMAGE_INPAINT_SUPPORTED_MODELS)[number];
export type AIImageInpaintSupportedImageSize = AIImageGenSupportedImageSize;
export type AIImageInpaintSupportedAspectRatio = AIImageGenSupportedAspectRatio;

export const AI_IMAGE_INPAINT_MASK_MODES = [
  "original-markup",
  "strong-mask",
] as const;

export type AIImageInpaintMaskMode =
  (typeof AI_IMAGE_INPAINT_MASK_MODES)[number];

export const AI_IMAGE_INPAINT_DEFAULT_MASK_MODE = "original-markup" as const satisfies AIImageInpaintMaskMode;
export const AI_IMAGE_INPAINT_GROUP_ID = "main" as const;
export const AI_IMAGE_INPAINT_MIN_GROUP_COUNT = 1 as const;
export const AI_IMAGE_INPAINT_MAX_GROUP_COUNT = 1 as const;

export interface AIImageInpaintExecutionGroupInput {
  groupId: string;
  sourceFileId: string;
  maskFileId: string;
}

export function isAIImageInpaintMaskMode(value: unknown): value is AIImageInpaintMaskMode {
  return typeof value === "string"
    && (AI_IMAGE_INPAINT_MASK_MODES as readonly string[]).includes(value);
}
