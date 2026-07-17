import {
  AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS,
  AI_VIDEO_GEN_NODE_TYPE,
  normalizeAIVideoGenParameters,
  normalizeAIVideoGenModel,
} from "@newworkflow/backend-shared";
import type {
  AIVideoGenSupportedAspectRatio,
  AIVideoGenSupportedModel,
  AIVideoGenSupportedResolution,
  AIVideoGenSupportedSize,
} from "@newworkflow/backend-shared";
import type { ExecutionTaskRecord } from "../../../../api/src/modules/executions/executions.repository.ts";
import { VideoGenerateHelper } from "./video-generate.helper.ts";
import type {
  QueueTaskExecutor,
  QueueTaskExecutorInput,
} from "./queue-task-executor.types.ts";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeReferenceFileIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeDuration(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : AI_VIDEO_GEN_DEFAULT_DURATION_SECONDS;
}

function buildAIVideoGenInput(task: ExecutionTaskRecord): {
  userId: string;
  taskId: string;
  taskNo: string;
  prompt: string;
  model: AIVideoGenSupportedModel;
  duration: number;
  aspectRatio: AIVideoGenSupportedAspectRatio;
  resolution: AIVideoGenSupportedResolution;
  size: AIVideoGenSupportedSize;
  metadata?: string;
  referenceFileIds: string[];
} {
  const taskInput = task.input ?? {};
  const prompt = taskInput.prompt;
  const model = normalizeAIVideoGenModel(taskInput.model);
  const duration = normalizeDuration(taskInput.duration);
  const videoParameters = normalizeAIVideoGenParameters({
    aspectRatio: taskInput.aspectRatio,
    resolution: taskInput.resolution,
  });
  const referenceFileIds = normalizeReferenceFileIds(taskInput.referenceFileIds);

  if (!isNonEmptyString(prompt) || !model || !videoParameters || referenceFileIds.length === 0) {
    throw new Error("INVALID_AI_VIDEO_GEN_TASK_INPUT");
  }

  if (!isNonEmptyString(task.userId)) {
    throw new Error("INVALID_AI_VIDEO_GEN_TASK_INPUT");
  }

  return {
    userId: task.userId.trim(),
    taskId: task.id,
    taskNo: task.taskNo,
    prompt: prompt.trim(),
    model,
    duration,
    aspectRatio: videoParameters.aspectRatio,
    resolution: videoParameters.resolution,
    size: videoParameters.size,
    metadata: videoParameters.metadata,
    referenceFileIds,
  };
}

export class AIVideoGenTaskExecutor implements QueueTaskExecutor {
  readonly nodeType = AI_VIDEO_GEN_NODE_TYPE;
  readonly nodeTypes = [AI_VIDEO_GEN_NODE_TYPE, "aiStoryboard"] as const;

  constructor(
    private readonly helper: VideoGenerateHelper,
    private readonly options?: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ) {}

  async execute(input: QueueTaskExecutorInput): Promise<unknown> {
    const taskInput = buildAIVideoGenInput(input.task);

    return this.helper.execute({
      userId: taskInput.userId,
      taskId: taskInput.taskId,
      taskNo: taskInput.taskNo,
      prompt: taskInput.prompt,
      model: taskInput.model,
      duration: taskInput.duration,
      aspectRatio: taskInput.aspectRatio,
      resolution: taskInput.resolution,
      size: taskInput.size,
      metadata: taskInput.metadata,
      referenceFileIds: taskInput.referenceFileIds,
      outputFileName: `${taskInput.taskNo}-ai-video-gen.mp4`,
      pollIntervalMs: this.options?.pollIntervalMs,
      timeoutMs: this.options?.timeoutMs,
    });
  }
}
