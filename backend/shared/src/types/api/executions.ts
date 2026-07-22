import type {
  AIFloorplanColorizeStylePreset,
  AIFloorplanColorizeSupportedModel,
  AI_FLOORPLAN_COLORIZE_EXECUTION_MODE,
  AI_FLOORPLAN_COLORIZE_NODE_TYPE,
  AI_FLOORPLAN_COLORIZE_TASK_TYPE,
} from "../../constants/aiFloorplanColorize.ts";
import type {
  AI_MULTI_VIEW_RESTORE_EXECUTION_MODE,
  AI_MULTI_VIEW_RESTORE_NODE_TYPE,
  AI_MULTI_VIEW_RESTORE_TASK_TYPE,
} from "../../constants/aiMultiViewRestore.ts";
import type {
  AI_IMAGE_TO_PLY_EXECUTION_MODE,
  AI_IMAGE_TO_PLY_NODE_TYPE,
  AI_IMAGE_TO_PLY_TASK_TYPE,
} from "../../constants/aiImageToPly.ts";
import type {
  AI_IMAGE_GEN_EXECUTION_MODE,
  AI_IMAGE_GEN_NODE_TYPE,
  AIImageGenOfficialQuality,
  AIImageGenSupportedModel,
  AI_IMAGE_GEN_TASK_TYPE,
} from "../../constants/aiImageGen.ts";
import type {
  AI_IMAGE_INPAINT_EXECUTION_MODE,
  AI_IMAGE_INPAINT_NODE_TYPE,
  AI_IMAGE_INPAINT_TASK_TYPE,
  AIImageInpaintMaskMode,
  AIImageInpaintSupportedModel,
} from "../../constants/aiImageInpaint.ts";
import type {
  AI_IMAGE_HD_EXECUTION_MODE,
  AI_IMAGE_HD_NODE_TYPE,
  AI_IMAGE_HD_TASK_TYPE,
  AIImageHdSupportedModel,
} from "../../constants/aiImageHd.ts";
import type {
  AIVideoGenAcceptedModel,
  AIVideoGenSupportedAspectRatio,
  AIVideoGenSupportedDurationSeconds,
  AIVideoGenSupportedResolution,
  AIVideoGenSupportedSize,
  AI_VIDEO_GEN_EXECUTION_MODE,
  AI_VIDEO_GEN_NODE_TYPE,
  AI_VIDEO_GEN_TASK_TYPE,
} from "../../constants/aiVideoGen.ts";
import type {
  WHITE_MODEL_RENDER_EXECUTION_MODE,
  WHITE_MODEL_RENDER_NODE_TYPE,
  WHITE_MODEL_RENDER_TASK_TYPE,
  WhiteModelRenderSupportedModel,
} from "../../constants/whiteModelRender.ts";
import type {
  ExecutionMode,
  ExecutionNodeType,
  ExecutionStatus,
  NodeTaskType,
  SharedSupportedAspectRatio,
  SharedSupportedImageSize,
} from "../execution.ts";
import type { DatabaseHealth } from "../../db/db-config.ts";

export interface WhiteModelRenderExecutionGroup {
  groupId: string;
  whiteModelFileId: string;
  styleReferenceFileId: string;
}

export interface SourceImageExecutionGroup {
  groupId: string;
  sourceFileId: string;
  imageSize?: SharedSupportedImageSize;
  aspectRatio?: SharedSupportedAspectRatio;
}

export interface AIFloorplanColorizeExecutionGroup {
  groupId: string;
  sourceFileId: string;
  stylePreset?: AIFloorplanColorizeStylePreset;
  imageSize?: SharedSupportedImageSize;
  aspectRatio?: SharedSupportedAspectRatio;
}

export interface AIImageGenExecutionGroup {
  groupId: string;
  referenceFileIds: string[];
}

export interface AIImageInpaintExecutionGroup {
  groupId: string;
  sourceFileId: string;
  maskFileId: string;
}

export type AIImageGenExecutionNodeType =
  | typeof AI_IMAGE_GEN_NODE_TYPE
  | "aiStoryboard";

export interface AIImageToPlyExecutionGroup {
  groupId: string;
  sourceFileId: string;
}

export interface AIMultiViewRestoreExecutionGroup {
  groupId: string;
  renderFileId: string;
  referenceFileId: string;
}

export interface AIVideoGenExecutionGroup {
  groupId: string;
  referenceFileIds: string[];
}

export interface WhiteModelRenderCreateExecutionRequest {
  userId?: string;
  workflowId: string;
  nodeType: typeof WHITE_MODEL_RENDER_NODE_TYPE;
  taskType: typeof WHITE_MODEL_RENDER_TASK_TYPE;
  executionMode: typeof WHITE_MODEL_RENDER_EXECUTION_MODE;
  nodeId?: string;
  nodeTitle?: string;
  model?: WhiteModelRenderSupportedModel;
  imageSize?: SharedSupportedImageSize;
  aspectRatio?: SharedSupportedAspectRatio;
  groups: WhiteModelRenderExecutionGroup[];
}

export interface AIImageHdCreateExecutionRequest {
  userId?: string;
  workflowId: string;
  nodeType: typeof AI_IMAGE_HD_NODE_TYPE;
  taskType: typeof AI_IMAGE_HD_TASK_TYPE;
  executionMode: typeof AI_IMAGE_HD_EXECUTION_MODE;
  nodeId?: string;
  nodeTitle?: string;
  model?: AIImageHdSupportedModel;
  groups: SourceImageExecutionGroup[];
}

export interface AIImageGenCreateExecutionRequest {
  userId?: string;
  workflowId: string;
  nodeType: AIImageGenExecutionNodeType;
  taskType: typeof AI_IMAGE_GEN_TASK_TYPE;
  executionMode: typeof AI_IMAGE_GEN_EXECUTION_MODE;
  nodeId?: string;
  nodeTitle?: string;
  prompt: string;
  model?: AIImageGenSupportedModel;
  imageSize?: SharedSupportedImageSize;
  aspectRatio?: SharedSupportedAspectRatio;
  quality?: AIImageGenOfficialQuality;
  groups: AIImageGenExecutionGroup[];
}

export interface AIImageInpaintCreateExecutionRequest {
  userId?: string;
  workflowId: string;
  nodeType: typeof AI_IMAGE_INPAINT_NODE_TYPE;
  taskType: typeof AI_IMAGE_INPAINT_TASK_TYPE;
  executionMode: typeof AI_IMAGE_INPAINT_EXECUTION_MODE;
  nodeId?: string;
  nodeTitle?: string;
  prompt: string;
  model?: AIImageInpaintSupportedModel;
  imageSize?: SharedSupportedImageSize;
  aspectRatio?: SharedSupportedAspectRatio;
  maskMode: AIImageInpaintMaskMode;
  groups: AIImageInpaintExecutionGroup[];
}

export interface AIFloorplanColorizeCreateExecutionRequest {
  userId?: string;
  workflowId: string;
  nodeType: typeof AI_FLOORPLAN_COLORIZE_NODE_TYPE;
  taskType: typeof AI_FLOORPLAN_COLORIZE_TASK_TYPE;
  executionMode: typeof AI_FLOORPLAN_COLORIZE_EXECUTION_MODE;
  nodeId?: string;
  nodeTitle?: string;
  model?: AIFloorplanColorizeSupportedModel;
  groups: AIFloorplanColorizeExecutionGroup[];
}

export interface AIImageToPlyCreateExecutionRequest {
  userId?: string;
  workflowId: string;
  nodeType: typeof AI_IMAGE_TO_PLY_NODE_TYPE;
  taskType: typeof AI_IMAGE_TO_PLY_TASK_TYPE;
  executionMode: typeof AI_IMAGE_TO_PLY_EXECUTION_MODE;
  nodeId?: string;
  nodeTitle?: string;
  groups: AIImageToPlyExecutionGroup[];
}

export interface AIMultiViewRestoreCreateExecutionRequest {
  userId?: string;
  workflowId: string;
  nodeType: typeof AI_MULTI_VIEW_RESTORE_NODE_TYPE;
  taskType: typeof AI_MULTI_VIEW_RESTORE_TASK_TYPE;
  executionMode: typeof AI_MULTI_VIEW_RESTORE_EXECUTION_MODE;
  nodeId?: string;
  nodeTitle?: string;
  groups: AIMultiViewRestoreExecutionGroup[];
}

export interface AIVideoGenCreateExecutionRequest {
  userId?: string;
  workflowId: string;
  nodeType: typeof AI_VIDEO_GEN_NODE_TYPE | "aiStoryboard";
  taskType: typeof AI_VIDEO_GEN_TASK_TYPE;
  executionMode: typeof AI_VIDEO_GEN_EXECUTION_MODE;
  nodeId?: string;
  nodeTitle?: string;
  prompt: string;
  model: AIVideoGenAcceptedModel;
  duration: AIVideoGenSupportedDurationSeconds;
  aspectRatio?: AIVideoGenSupportedAspectRatio;
  resolution?: AIVideoGenSupportedResolution;
  size?: AIVideoGenSupportedSize;
  groups: AIVideoGenExecutionGroup[];
}

export type CreateExecutionRequest =
  | WhiteModelRenderCreateExecutionRequest
  | AIImageGenCreateExecutionRequest
  | AIImageInpaintCreateExecutionRequest
  | AIImageHdCreateExecutionRequest
  | AIFloorplanColorizeCreateExecutionRequest
  | AIMultiViewRestoreCreateExecutionRequest
  | AIImageToPlyCreateExecutionRequest
  | AIVideoGenCreateExecutionRequest;

export interface CreateExecutionTaskResponse {
  taskId: string;
  taskNo: string;
  groupId: string | null;
  groupOrder: number | null;
  status: ExecutionStatus;
}

export interface CreateExecutionResponseData {
  runId: string;
  runNo: string;
  nodeType: ExecutionNodeType | string;
  taskType: NodeTaskType;
  executionMode: ExecutionMode | string;
  status: ExecutionStatus;
  tasks: CreateExecutionTaskResponse[];
}

export interface ApiHealthResponseData {
  service: "backend-api";
  status: "ok" | "degraded";
  port: number;
  persistenceMode: "json" | "db";
  database: DatabaseHealth;
  timestamp: string;
}

export interface WorkerProviderSchedulingHealth {
  active: number;
  max: number | null;
  available: number | null;
  queued: number;
  lastBackpressureAt: string | null;
  lastBackpressureCode: string | null;
  lastDispatchKickAt: string | null;
}

export interface WorkerSchedulingHealthResponseData {
  service: "backend-worker";
  status: "ok" | "degraded";
  port: number;
  persistenceMode: "json" | "db";
  database: DatabaseHealth;
  pollIntervalMs: number;
  runninghubMaxConcurrency: number | null;
  execution: {
    status: "idle" | "running" | "stopped";
    isPolling: boolean;
    pendingPoll: boolean;
    lastPollAt: string | null;
    lastPollFinishedAt: string | null;
    lastPollClaimedCount: number;
    lastKickAt: string | null;
    lastErrorMessage: string | null;
  };
  queue: {
    activeTaskCount: number;
    maxConcurrency: number | null;
    queuedTaskCount: number;
    queuedTaskCountByProvider: Record<string, number>;
    lastScanLimit: number;
    lastCandidateCount: number;
    lastProviderSkippedCount: number;
    lastClaimedCount: number;
    lastProviderSlotSkippedTaskId: string | null;
    lastProviderSlotSkippedTaskNo: string | null;
    lastProviderSlotSkippedProvider: string | null;
    lastProviderSlotSkippedAt: string | null;
    lastDispatchKickScheduledAt: string | null;
    lastProviderBackpressure: {
      taskId: string;
      taskNo: string;
      provider: string;
      providerCode: string | null;
      errorCode: string;
      errorMessage: string;
      occurredAt: string;
    } | null;
    providerConcurrency: {
      providers: Record<string, {
        active: number;
        max: number | null;
        available: number | null;
      }>;
    };
  };
  scheduling: Record<string, WorkerProviderSchedulingHealth>;
  timestamp: string;
}
