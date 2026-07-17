import {
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  WHITE_MODEL_RENDER_DEFAULT_ASPECT_RATIO_MODE,
  WHITE_MODEL_RENDER_DEFAULT_IMAGE_SIZE,
  WHITE_MODEL_RENDER_DEFAULT_MODEL,
  WHITE_MODEL_RENDER_NODE_TYPE,
} from "@newworkflow/backend-shared";
import type { ExecutionTaskRecord } from "../../../../api/src/modules/executions/executions.repository.ts";
import type {
  WhiteModelRenderExecutorInput,
  WhiteModelRenderExecutorResult,
} from "./white-model-render.types.ts";
import { WhiteModelRenderExecutor } from "./white-model-render.executor.ts";
import type {
  QueueTaskExecutor,
  QueueTaskExecutorInput,
} from "./queue-task-executor.types.ts";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeModel(value: unknown): "gemini-3-pro-image-preview" | "gpt-image-2" | "gpt-image-2-vip" {
  if (!isNonEmptyString(value)) {
    return WHITE_MODEL_RENDER_DEFAULT_MODEL;
  }

  const trimmed = value.trim();
  if (trimmed === "gemini-3-pro-image-preview") {
    return trimmed;
  }

  if (trimmed === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL) {
    return trimmed;
  }

  return trimmed === "gpt-image-2-vip"
    ? trimmed
    : WHITE_MODEL_RENDER_DEFAULT_MODEL;
}

function normalizeImageSize(value: unknown): "1K" | "2K" | "4K" {
  return isNonEmptyString(value)
    ? value.trim() as "1K" | "2K" | "4K"
    : WHITE_MODEL_RENDER_DEFAULT_IMAGE_SIZE;
}

function normalizeAspectRatio(
  value: unknown,
): "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "21:9" | "3:2" | "2:3" | "5:4" | "4:5" {
  return isNonEmptyString(value)
    ? value.trim() as "auto" | "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "21:9" | "3:2" | "2:3" | "5:4" | "4:5"
    : WHITE_MODEL_RENDER_DEFAULT_ASPECT_RATIO_MODE;
}

function buildWhiteModelInput(task: ExecutionTaskRecord): WhiteModelRenderExecutorInput {
  const taskInput = task.input ?? {};
  const whiteModelFileId = taskInput.whiteModelFileId ?? task.whiteModelFileId;
  const styleReferenceFileId =
    taskInput.styleReferenceFileId ?? task.styleReferenceFileId;

  if (!isNonEmptyString(whiteModelFileId)) {
    throw new Error("INVALID_WHITE_MODEL_TASK_INPUT");
  }

  if (!isNonEmptyString(styleReferenceFileId)) {
    throw new Error("INVALID_WHITE_MODEL_TASK_INPUT");
  }

  if (!isNonEmptyString(task.userId)) {
    throw new Error("INVALID_WHITE_MODEL_TASK_INPUT");
  }

  const model = normalizeModel(isNonEmptyString(taskInput.model) ? taskInput.model : task.model);

  return {
    userId: task.userId.trim(),
    runId: task.runId,
    taskId: task.id,
    taskNo: task.taskNo,
    whiteModelFileId: whiteModelFileId.trim(),
    styleReferenceFileId: styleReferenceFileId.trim(),
    model,
    ...(model === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL
      ? {}
      : {
          imageSize: normalizeImageSize(taskInput.imageSize),
          aspectRatio: normalizeAspectRatio(taskInput.aspectRatio),
        }),
  };
}

export class WhiteModelRenderTaskExecutor implements QueueTaskExecutor {
  readonly nodeType = WHITE_MODEL_RENDER_NODE_TYPE;

  constructor(private readonly executor: WhiteModelRenderExecutor) {}

  async execute(
    input: QueueTaskExecutorInput,
  ): Promise<WhiteModelRenderExecutorResult> {
    return this.executor.execute(buildWhiteModelInput(input.task));
  }
}
