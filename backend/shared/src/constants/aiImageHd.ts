import {
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_VIP_MODEL,
} from "./aiImageGen.ts";

export const AI_IMAGE_HD_NODE_TYPE = "aiImageHd" as const;
export const AI_IMAGE_HD_TASK_TYPE = "image-hd" as const;
export const AI_IMAGE_HD_EXECUTION_MODE = "legacy-grouped-task" as const;

export const AI_IMAGE_HD_PROVIDER = "laozhang" as const;
export const AI_IMAGE_HD_MODEL = "gemini-3-pro-image-preview" as const;
export const AI_IMAGE_HD_DEFAULT_MODEL = AI_IMAGE_GEN_GPT_IMAGE_2_MODEL;
export const AI_IMAGE_HD_PIPELINE_VERSION = "v1" as const;
export const AI_IMAGE_HD_PROMPT_VERSION = "v1" as const;

export const AI_IMAGE_HD_DEFAULT_IMAGE_SIZE = "1K" as const;
export const AI_IMAGE_HD_DEFAULT_ASPECT_RATIO = "1:1" as const;

export const AI_IMAGE_HD_SUPPORTED_MODELS = [
  AI_IMAGE_HD_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_VIP_MODEL,
] as const;

export type AIImageHdSupportedModel =
  (typeof AI_IMAGE_HD_SUPPORTED_MODELS)[number];

export const AI_IMAGE_HD_SUPPORTED_IMAGE_SIZES = [
  "1K",
  "2K",
  "4K",
] as const;

export const AI_IMAGE_HD_SUPPORTED_ASPECT_RATIOS = [
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

export const AI_IMAGE_HD_PROMPT = "将图片高清化" as const;
