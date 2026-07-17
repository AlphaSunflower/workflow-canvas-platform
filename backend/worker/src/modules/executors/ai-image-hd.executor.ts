import {
  AI_IMAGE_HD_DEFAULT_ASPECT_RATIO,
  AI_IMAGE_HD_DEFAULT_IMAGE_SIZE,
  AI_IMAGE_HD_DEFAULT_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_HD_NODE_TYPE,
  AI_IMAGE_HD_PROMPT,
  AI_IMAGE_HD_SUPPORTED_MODELS,
  resolveAIImageGenOutputSize,
  type AIImageGenSupportedAspectRatio,
  type AIImageGenSupportedImageSize,
  type AIImageHdSupportedModel,
} from "@newworkflow/backend-shared";
import type { ExecutionTaskRecord } from "../../../../api/src/modules/executions/executions.repository.ts";
import type {
  LaozhangAspectRatio,
} from "../providers/laozhang/laozhang.types.ts";
import { SingleImageGenerateHelper } from "./single-image-generate.helper.ts";
import type {
  QueueTaskExecutor,
  QueueTaskExecutorInput,
} from "./queue-task-executor.types.ts";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeModel(value: unknown): AIImageHdSupportedModel {
  if (!isNonEmptyString(value)) {
    return AI_IMAGE_HD_DEFAULT_MODEL;
  }

  const trimmed = value.trim();
  return (AI_IMAGE_HD_SUPPORTED_MODELS as readonly string[]).includes(trimmed)
    ? trimmed as AIImageHdSupportedModel
    : AI_IMAGE_HD_DEFAULT_MODEL;
}

function normalizeImageSize(value: unknown): AIImageGenSupportedImageSize {
  return isNonEmptyString(value)
    ? value.trim() as AIImageGenSupportedImageSize
    : AI_IMAGE_HD_DEFAULT_IMAGE_SIZE;
}

function normalizeAspectRatio(value: unknown): AIImageGenSupportedAspectRatio {
  return isNonEmptyString(value)
    ? value.trim() as AIImageGenSupportedAspectRatio
    : AI_IMAGE_HD_DEFAULT_ASPECT_RATIO;
}

function normalizeGeminiAspectRatio(
  value: AIImageGenSupportedAspectRatio,
): LaozhangAspectRatio | undefined {
  return value === "auto" ? undefined : value;
}

type AIImageHdResolvedInput =
  | {
    userId: string;
    taskId: string;
    taskNo: string;
    sourceFileId: string;
    model: "gpt-image-2-vip";
    resolvedSize: string;
    imageSize: AIImageGenSupportedImageSize;
    aspectRatio: LaozhangAspectRatio;
  }
  | {
    userId: string;
    taskId: string;
    taskNo: string;
    sourceFileId: string;
    model: typeof AI_IMAGE_GEN_GPT_IMAGE_2_MODEL;
  }
  | {
    userId: string;
    taskId: string;
    taskNo: string;
    sourceFileId: string;
    model: "gemini-3-pro-image-preview";
    imageSize: AIImageGenSupportedImageSize;
    aspectRatio?: LaozhangAspectRatio;
  };

function buildAIImageHdInput(task: ExecutionTaskRecord): AIImageHdResolvedInput {
  const taskInput = task.input ?? {};
  const inputFileId = taskInput.inputFileId ?? taskInput.sourceFileId;

  if (!isNonEmptyString(inputFileId)) {
    throw new Error("INVALID_AI_IMAGE_HD_TASK_INPUT");
  }

  if (!isNonEmptyString(task.userId)) {
    throw new Error("INVALID_AI_IMAGE_HD_TASK_INPUT");
  }

  const model = normalizeModel(
    isNonEmptyString(taskInput.model) ? taskInput.model : task.model,
  );
  const imageSize = normalizeImageSize(taskInput.imageSize);
  const aspectRatio = normalizeAspectRatio(taskInput.aspectRatio);

  if (model === "gpt-image-2-vip") {
    const resolvedSize = resolveAIImageGenOutputSize(model, imageSize, aspectRatio);
    if (!resolvedSize || aspectRatio === "auto") {
      throw new Error("INVALID_AI_IMAGE_HD_TASK_INPUT");
    }

    return {
      userId: task.userId.trim(),
      taskId: task.id,
      taskNo: task.taskNo,
      sourceFileId: inputFileId.trim(),
      model,
      resolvedSize,
      imageSize,
      aspectRatio,
    };
  }

  if (model === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL) {
    return {
      userId: task.userId.trim(),
      taskId: task.id,
      taskNo: task.taskNo,
      sourceFileId: inputFileId.trim(),
      model,
    };
  }

  return {
    userId: task.userId.trim(),
    taskId: task.id,
    taskNo: task.taskNo,
    sourceFileId: inputFileId.trim(),
    model,
    imageSize,
    aspectRatio: normalizeGeminiAspectRatio(aspectRatio),
  };
}

export class AIImageHdTaskExecutor implements QueueTaskExecutor {
  readonly nodeType = AI_IMAGE_HD_NODE_TYPE;

  constructor(private readonly helper: SingleImageGenerateHelper) {}

  async execute(input: QueueTaskExecutorInput): Promise<unknown> {
    const taskInput = buildAIImageHdInput(input.task);

    if (taskInput.model === "gpt-image-2-vip") {
      return this.helper.execute({
        userId: taskInput.userId,
        taskId: taskInput.taskId,
        taskNo: taskInput.taskNo,
        sourceFileId: taskInput.sourceFileId,
        prompt: AI_IMAGE_HD_PROMPT,
        model: taskInput.model,
        resolvedSize: taskInput.resolvedSize,
        imageSize: taskInput.imageSize,
        aspectRatio: taskInput.aspectRatio,
        outputFileName: `${taskInput.taskNo}-image-hd.png`,
      });
    }

    if (taskInput.model === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL) {
      return this.helper.execute({
        userId: taskInput.userId,
        taskId: taskInput.taskId,
        taskNo: taskInput.taskNo,
        sourceFileId: taskInput.sourceFileId,
        prompt: AI_IMAGE_HD_PROMPT,
        model: taskInput.model,
        outputFileName: `${taskInput.taskNo}-image-hd.png`,
      });
    }

    return this.helper.execute({
      userId: taskInput.userId,
      taskId: taskInput.taskId,
      taskNo: taskInput.taskNo,
      sourceFileId: taskInput.sourceFileId,
      prompt: AI_IMAGE_HD_PROMPT,
      model: taskInput.model,
      imageSize: taskInput.imageSize,
      aspectRatio: taskInput.aspectRatio,
      outputFileName: `${taskInput.taskNo}-image-hd.png`,
    });
  }
}
