import {
  AI_FLOORPLAN_COLORIZE_DEFAULT_ASPECT_RATIO,
  AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET,
  AI_FLOORPLAN_COLORIZE_DEFAULT_IMAGE_SIZE,
  AI_FLOORPLAN_COLORIZE_DEFAULT_MODEL,
  AI_FLOORPLAN_COLORIZE_NODE_TYPE,
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_FLOORPLAN_COLORIZE_PROMPT_VERSION,
  AI_FLOORPLAN_COLORIZE_STYLE_PRESETS,
  AI_FLOORPLAN_COLORIZE_STYLE_PROMPTS,
  AI_FLOORPLAN_COLORIZE_SUPPORTED_MODELS,
  resolveAIImageGenOutputSize,
  type AIFloorplanColorizeStylePreset,
  type AIFloorplanColorizeSupportedModel,
  type AIImageGenSupportedAspectRatio,
  type AIImageGenSupportedImageSize,
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

function normalizeModel(value: unknown): AIFloorplanColorizeSupportedModel {
  if (!isNonEmptyString(value)) {
    return AI_FLOORPLAN_COLORIZE_DEFAULT_MODEL;
  }

  const trimmed = value.trim();
  return (AI_FLOORPLAN_COLORIZE_SUPPORTED_MODELS as readonly string[]).includes(trimmed)
    ? trimmed as AIFloorplanColorizeSupportedModel
    : AI_FLOORPLAN_COLORIZE_DEFAULT_MODEL;
}

function normalizeImageSize(value: unknown): AIImageGenSupportedImageSize {
  return isNonEmptyString(value)
    ? value.trim() as AIImageGenSupportedImageSize
    : AI_FLOORPLAN_COLORIZE_DEFAULT_IMAGE_SIZE;
}

function normalizeAspectRatio(value: unknown): AIImageGenSupportedAspectRatio {
  return isNonEmptyString(value)
    ? value.trim() as AIImageGenSupportedAspectRatio
    : AI_FLOORPLAN_COLORIZE_DEFAULT_ASPECT_RATIO;
}

function normalizeGeminiAspectRatio(
  value: AIImageGenSupportedAspectRatio,
): LaozhangAspectRatio | undefined {
  return value === "auto" ? undefined : value;
}

function normalizeStylePreset(value: unknown): AIFloorplanColorizeStylePreset {
  if (!isNonEmptyString(value)) {
    return AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET;
  }

  const trimmed = value.trim();
  if ((AI_FLOORPLAN_COLORIZE_STYLE_PRESETS as readonly string[]).includes(trimmed)) {
    return trimmed as AIFloorplanColorizeStylePreset;
  }

  throw new Error("INVALID_AI_FLOORPLAN_COLORIZE_STYLE_PRESET");
}

function resolvePrompt(stylePreset: AIFloorplanColorizeStylePreset): string {
  const prompt = AI_FLOORPLAN_COLORIZE_STYLE_PROMPTS[stylePreset];

  if (!isNonEmptyString(prompt)) {
    throw new Error("AI_FLOORPLAN_COLORIZE_PROMPT_NOT_FOUND");
  }

  return prompt;
}

type AIFloorplanColorizeResolvedInput =
  | {
    userId: string;
    taskId: string;
    taskNo: string;
    sourceFileId: string;
    stylePreset: AIFloorplanColorizeStylePreset;
    prompt: string;
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
    stylePreset: AIFloorplanColorizeStylePreset;
    prompt: string;
    model: typeof AI_IMAGE_GEN_GPT_IMAGE_2_MODEL;
  }
  | {
    userId: string;
    taskId: string;
    taskNo: string;
    sourceFileId: string;
    stylePreset: AIFloorplanColorizeStylePreset;
    prompt: string;
    model: "gemini-3-pro-image-preview";
    imageSize: AIImageGenSupportedImageSize;
    aspectRatio?: LaozhangAspectRatio;
  };

function buildAIFloorplanColorizeInput(task: ExecutionTaskRecord): AIFloorplanColorizeResolvedInput {
  const taskInput = task.input ?? {};
  const inputFileId = taskInput.inputFileId ?? taskInput.sourceFileId;

  if (!isNonEmptyString(inputFileId)) {
    throw new Error("INVALID_AI_FLOORPLAN_COLORIZE_TASK_INPUT");
  }

  if (!isNonEmptyString(task.userId)) {
    throw new Error("INVALID_AI_FLOORPLAN_COLORIZE_TASK_INPUT");
  }

  const stylePreset = normalizeStylePreset(taskInput.stylePreset);
  const model = normalizeModel(
    isNonEmptyString(taskInput.model) ? taskInput.model : task.model,
  );
  const imageSize = normalizeImageSize(taskInput.imageSize);
  const aspectRatio = normalizeAspectRatio(taskInput.aspectRatio);

  if (model === "gpt-image-2-vip") {
    const resolvedSize = resolveAIImageGenOutputSize(model, imageSize, aspectRatio);
    if (!resolvedSize || aspectRatio === "auto") {
      throw new Error("INVALID_AI_FLOORPLAN_COLORIZE_TASK_INPUT");
    }

    return {
      userId: task.userId.trim(),
      taskId: task.id,
      taskNo: task.taskNo,
      sourceFileId: inputFileId.trim(),
      stylePreset,
      prompt: resolvePrompt(stylePreset),
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
      stylePreset,
      prompt: resolvePrompt(stylePreset),
      model,
    };
  }

  return {
    userId: task.userId.trim(),
    taskId: task.id,
    taskNo: task.taskNo,
    sourceFileId: inputFileId.trim(),
    stylePreset,
    prompt: resolvePrompt(stylePreset),
    model,
    imageSize,
    aspectRatio: normalizeGeminiAspectRatio(aspectRatio),
  };
}

export class AIFloorplanColorizeTaskExecutor implements QueueTaskExecutor {
  readonly nodeType = AI_FLOORPLAN_COLORIZE_NODE_TYPE;

  constructor(private readonly helper: SingleImageGenerateHelper) {}

  async execute(input: QueueTaskExecutorInput): Promise<unknown> {
    const taskInput = buildAIFloorplanColorizeInput(input.task);
    const sharedMetadata = {
      stylePreset: taskInput.stylePreset,
      promptVersion: AI_FLOORPLAN_COLORIZE_PROMPT_VERSION,
    };

    if (taskInput.model === "gpt-image-2-vip") {
      return this.helper.execute({
        userId: taskInput.userId,
        taskId: taskInput.taskId,
        taskNo: taskInput.taskNo,
        sourceFileId: taskInput.sourceFileId,
        prompt: taskInput.prompt,
        model: taskInput.model,
        resolvedSize: taskInput.resolvedSize,
        imageSize: taskInput.imageSize,
        aspectRatio: taskInput.aspectRatio,
        outputFileName: `${taskInput.taskNo}-floorplan-colorize.png`,
        metadata: sharedMetadata,
      });
    }

    if (taskInput.model === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL) {
      return this.helper.execute({
        userId: taskInput.userId,
        taskId: taskInput.taskId,
        taskNo: taskInput.taskNo,
        sourceFileId: taskInput.sourceFileId,
        prompt: taskInput.prompt,
        model: taskInput.model,
        outputFileName: `${taskInput.taskNo}-floorplan-colorize.png`,
        metadata: sharedMetadata,
      });
    }

    return this.helper.execute({
      userId: taskInput.userId,
      taskId: taskInput.taskId,
      taskNo: taskInput.taskNo,
      sourceFileId: taskInput.sourceFileId,
      prompt: taskInput.prompt,
      model: taskInput.model,
      imageSize: taskInput.imageSize,
      aspectRatio: taskInput.aspectRatio,
      outputFileName: `${taskInput.taskNo}-floorplan-colorize.png`,
      metadata: sharedMetadata,
    });
  }
}
