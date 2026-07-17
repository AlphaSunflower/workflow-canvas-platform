import type {
  EXECUTION_MODES,
  EXECUTION_PHASES,
  EXECUTION_STATUSES,
  EXECUTION_STEP_TYPES,
  NODE_TASK_TYPES,
  TASK_ATTEMPT_STATUSES,
  TASK_EVENT_TYPES,
} from "../constants/execution.ts";
import type {
  AI_FLOORPLAN_COLORIZE_NODE_TYPE,
  AI_FLOORPLAN_COLORIZE_SUPPORTED_ASPECT_RATIOS,
  AI_FLOORPLAN_COLORIZE_SUPPORTED_IMAGE_SIZES,
} from "../constants/aiFloorplanColorize.ts";
import type {
  AI_MULTI_VIEW_RESTORE_NODE_TYPE,
} from "../constants/aiMultiViewRestore.ts";
import type {
  AI_IMAGE_TO_PLY_NODE_TYPE,
} from "../constants/aiImageToPly.ts";
import type {
  AI_IMAGE_GEN_NODE_TYPE,
  AI_IMAGE_GEN_SUPPORTED_ASPECT_RATIOS,
  AI_IMAGE_GEN_SUPPORTED_IMAGE_SIZES,
} from "../constants/aiImageGen.ts";
import type {
  AI_IMAGE_INPAINT_NODE_TYPE,
  AI_IMAGE_INPAINT_SUPPORTED_ASPECT_RATIOS,
  AI_IMAGE_INPAINT_SUPPORTED_IMAGE_SIZES,
} from "../constants/aiImageInpaint.ts";
import type {
  AI_IMAGE_HD_NODE_TYPE,
  AI_IMAGE_HD_SUPPORTED_ASPECT_RATIOS,
  AI_IMAGE_HD_SUPPORTED_IMAGE_SIZES,
} from "../constants/aiImageHd.ts";
import type {
  AI_VIDEO_GEN_NODE_TYPE,
} from "../constants/aiVideoGen.ts";
import type {
  WHITE_MODEL_RENDER_NODE_TYPE,
  WHITE_MODEL_RENDER_SUPPORTED_ASPECT_RATIOS,
  WHITE_MODEL_RENDER_SUPPORTED_IMAGE_SIZES,
} from "../constants/whiteModelRender.ts";

export type ExecutionNodeType =
  | typeof WHITE_MODEL_RENDER_NODE_TYPE
  | typeof AI_IMAGE_GEN_NODE_TYPE
  | typeof AI_IMAGE_INPAINT_NODE_TYPE
  | "aiStoryboard"
  | typeof AI_IMAGE_HD_NODE_TYPE
  | typeof AI_FLOORPLAN_COLORIZE_NODE_TYPE
  | typeof AI_MULTI_VIEW_RESTORE_NODE_TYPE
  | typeof AI_IMAGE_TO_PLY_NODE_TYPE
  | typeof AI_VIDEO_GEN_NODE_TYPE;

export type NodeTaskType =
  (typeof NODE_TASK_TYPES)[keyof typeof NODE_TASK_TYPES];

export type ExecutionMode =
  (typeof EXECUTION_MODES)[keyof typeof EXECUTION_MODES];

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export type TaskAttemptStatus = (typeof TASK_ATTEMPT_STATUSES)[number];

export type ExecutionStepType = (typeof EXECUTION_STEP_TYPES)[number];

export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export type SharedSupportedImageSize =
  | (typeof WHITE_MODEL_RENDER_SUPPORTED_IMAGE_SIZES)[number]
  | (typeof AI_IMAGE_GEN_SUPPORTED_IMAGE_SIZES)[number]
  | (typeof AI_IMAGE_INPAINT_SUPPORTED_IMAGE_SIZES)[number]
  | (typeof AI_IMAGE_HD_SUPPORTED_IMAGE_SIZES)[number]
  | (typeof AI_FLOORPLAN_COLORIZE_SUPPORTED_IMAGE_SIZES)[number];

export type SharedSupportedAspectRatio =
  | (typeof WHITE_MODEL_RENDER_SUPPORTED_ASPECT_RATIOS)[number]
  | (typeof AI_IMAGE_GEN_SUPPORTED_ASPECT_RATIOS)[number]
  | (typeof AI_IMAGE_INPAINT_SUPPORTED_ASPECT_RATIOS)[number]
  | (typeof AI_IMAGE_HD_SUPPORTED_ASPECT_RATIOS)[number]
  | (typeof AI_FLOORPLAN_COLORIZE_SUPPORTED_ASPECT_RATIOS)[number];
