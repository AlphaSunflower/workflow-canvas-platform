import {
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_VIP_MODEL,
} from "./aiImageGen.ts";

export const WHITE_MODEL_RENDER_NODE_TYPE = "aiModelRenderTransfer" as const;
export const WHITE_MODEL_RENDER_TASK_TYPE = "model-render-transfer" as const;
export const WHITE_MODEL_RENDER_EXECUTION_MODE = "legacy-grouped-task" as const;

export const WHITE_MODEL_RENDER_PROVIDER = "laozhang" as const;
export const WHITE_MODEL_RENDER_MODEL = "gemini-3-pro-image-preview" as const;
export const WHITE_MODEL_RENDER_DEFAULT_MODEL = AI_IMAGE_GEN_GPT_IMAGE_2_MODEL;
export const WHITE_MODEL_RENDER_PIPELINE_VERSION = "v1" as const;
export const WHITE_MODEL_RENDER_PROMPT_VERSION = "v1" as const;

export const WHITE_MODEL_RENDER_DEFAULT_IMAGE_SIZE = "1K" as const;
export const WHITE_MODEL_RENDER_DEFAULT_ASPECT_RATIO_MODE = "1:1" as const;
export const WHITE_MODEL_RENDER_SUPPORTED_MODELS = [
  WHITE_MODEL_RENDER_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_VIP_MODEL,
] as const;

export type WhiteModelRenderSupportedModel =
  (typeof WHITE_MODEL_RENDER_SUPPORTED_MODELS)[number];

export const WHITE_MODEL_RENDER_SUPPORTED_IMAGE_SIZES = [
  "1K",
  "2K",
  "4K",
] as const;

export const WHITE_MODEL_RENDER_SUPPORTED_ASPECT_RATIOS = [
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

export const WHITE_MODEL_RENDER_DEFAULT_TIMEOUT_MS = 1_200_000;

export const WHITE_MODEL_RENDER_PROMPTS = {
  lineart: "生成该输入图片的清晰线稿图，黑线白底，尽量保留结构与边缘。",
  depth: "生成该输入图片的深度图（depth map），灰度表现深度关系，结构清晰。",
  final: [
    "图2、图3、图4是同一个空间的不同表现形式,图2是线稿图，图3是深度图,图4是白模图；另有图1是风格参考图",
    "请参考风格图与图234的空间信息，生成一张效果图",
    "要求硬装表面都按照图1的风格补全，同时严格按照图234的空间信息不改变，图中代表家具的小体块维持白模状态",
    "画面比例维持图4比例不变",
  ].join("\n"),
} as const;

export const WHITE_MODEL_RENDER_FINAL_INPUT_ORDER = [
  "styleReference",
  "lineart",
  "depth",
  "whiteModel",
] as const;
