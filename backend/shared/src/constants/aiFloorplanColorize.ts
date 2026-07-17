import {
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_VIP_MODEL,
} from "./aiImageGen.ts";

export const AI_FLOORPLAN_COLORIZE_NODE_TYPE = "aiFloorplanColorize" as const;
export const AI_FLOORPLAN_COLORIZE_TASK_TYPE = "floorplan-colorize" as const;
export const AI_FLOORPLAN_COLORIZE_EXECUTION_MODE = "legacy-grouped-task" as const;

export const AI_FLOORPLAN_COLORIZE_PROVIDER = "laozhang" as const;
export const AI_FLOORPLAN_COLORIZE_MODEL = "gemini-3-pro-image-preview" as const;
export const AI_FLOORPLAN_COLORIZE_DEFAULT_MODEL = AI_IMAGE_GEN_GPT_IMAGE_2_MODEL;
export const AI_FLOORPLAN_COLORIZE_PIPELINE_VERSION = "v1" as const;
export const AI_FLOORPLAN_COLORIZE_PROMPT_VERSION = "v2" as const;

export const AI_FLOORPLAN_COLORIZE_DEFAULT_IMAGE_SIZE = "1K" as const;
export const AI_FLOORPLAN_COLORIZE_DEFAULT_ASPECT_RATIO = "1:1" as const;
export const AI_FLOORPLAN_COLORIZE_SUPPORTED_MODELS = [
  AI_FLOORPLAN_COLORIZE_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_VIP_MODEL,
] as const;
export type AIFloorplanColorizeSupportedModel =
  (typeof AI_FLOORPLAN_COLORIZE_SUPPORTED_MODELS)[number];
export const AI_FLOORPLAN_COLORIZE_STYLE_PRESETS = [
  "three-d-render",
  "photoreal-render",
] as const;
export type AIFloorplanColorizeStylePreset =
  (typeof AI_FLOORPLAN_COLORIZE_STYLE_PRESETS)[number];
export const AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET =
  "three-d-render" as const;

export const AI_FLOORPLAN_COLORIZE_SUPPORTED_IMAGE_SIZES = [
  "1K",
  "2K",
  "4K",
] as const;

export const AI_FLOORPLAN_COLORIZE_SUPPORTED_ASPECT_RATIOS = [
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

export const AI_FLOORPLAN_COLORIZE_STYLE_PROMPTS: Record<
  AIFloorplanColorizeStylePreset,
  string
> = {
  "three-d-render": "将平面图转化为一张90度正上方俯视效果图。写实3D风格，展现墙体和家具的立体厚度。根据平面图生成现代风格效果鸟瞰图。柔和顶部漫射光，软阴影。图中元素保持不变。",
  "photoreal-render": "将这张平面图变成真实渲染风格图片，从顶部俯视房屋，将家具和地面变成写实风格，家具在地面上留下真实的阴影。背景保留白色。",
} as const;

// Deprecated: keep as a compatibility alias until executors switch to stylePreset-based lookup.
export const AI_FLOORPLAN_COLORIZE_PROMPT =
  AI_FLOORPLAN_COLORIZE_STYLE_PROMPTS[
    AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET
  ];
