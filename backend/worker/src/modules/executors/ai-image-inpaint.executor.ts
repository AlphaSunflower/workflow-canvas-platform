import {
  AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO,
  AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE,
  AI_IMAGE_INPAINT_DEFAULT_MASK_MODE,
  AI_IMAGE_INPAINT_DEFAULT_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_INPAINT_NODE_TYPE,
  AI_IMAGE_INPAINT_SUPPORTED_ASPECT_RATIOS,
  AI_IMAGE_INPAINT_SUPPORTED_IMAGE_SIZES,
  AI_IMAGE_INPAINT_SUPPORTED_MODELS,
  isAIImageInpaintMaskMode,
  resolveAIImageGenOutputSize,
  type AIImageInpaintMaskMode,
  type AIImageInpaintSupportedAspectRatio,
  type AIImageInpaintSupportedImageSize,
  type AIImageInpaintSupportedModel,
} from "@newworkflow/backend-shared";
import type { ExecutionTaskRecord } from "../../../../api/src/modules/executions/executions.repository.ts";
import type {
  LaozhangAspectRatio,
  LaozhangImageSize,
} from "../providers/laozhang/laozhang.types.ts";
import { MultiImageGenerateHelper } from "./multi-image-generate.helper.ts";
import type {
  QueueTaskExecutor,
  QueueTaskExecutorInput,
} from "./queue-task-executor.types.ts";

const INVALID_INPUT_ERROR = "INVALID_AI_IMAGE_INPAINT_TASK_INPUT";

export const AI_IMAGE_INPAINT_ORIGINAL_MARKUP_PROMPT_PREFIX = [
  "你将收到两张图片。",
  "第一张图片是原图。",
  "第二张图片是同一张原图，但带有不透明的涂抹标记，用来表示需要重绘的区域。",
  "请仅将涂抹标记视为编辑指令，不要把它当作最终图像中需要保留的内容。",
  "请只根据用户提示词重绘被标记的区域。",
].join(" ");

export const AI_IMAGE_INPAINT_STRONG_MASK_PROMPT_PREFIX = [
  "你将收到两张图片。",
  "第一张图片是原图。",
  "第二张图片是黑白遮罩，其中白色表示需要重绘的区域，黑色表示需要保留的区域。",
  "请仅将遮罩视为编辑指令，不要把它当作最终图像中的可见内容。",
  "请只根据用户提示词重绘白色遮罩区域。",
].join(" ");

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function throwInvalidInput(): never {
  throw new Error(INVALID_INPUT_ERROR);
}

function normalizeModel(value: unknown): AIImageInpaintSupportedModel {
  if (!isNonEmptyString(value)) {
    return AI_IMAGE_INPAINT_DEFAULT_MODEL;
  }

  const trimmed = value.trim();
  if (!(AI_IMAGE_INPAINT_SUPPORTED_MODELS as readonly string[]).includes(trimmed)) {
    throwInvalidInput();
  }

  return trimmed as AIImageInpaintSupportedModel;
}

function normalizeImageSize(value: unknown): AIImageInpaintSupportedImageSize {
  if (!isNonEmptyString(value)) {
    return AI_IMAGE_INPAINT_DEFAULT_IMAGE_SIZE;
  }

  const trimmed = value.trim();
  if (!(AI_IMAGE_INPAINT_SUPPORTED_IMAGE_SIZES as readonly string[]).includes(trimmed)) {
    throwInvalidInput();
  }

  return trimmed as AIImageInpaintSupportedImageSize;
}

function normalizeAspectRatio(value: unknown): AIImageInpaintSupportedAspectRatio {
  if (!isNonEmptyString(value)) {
    return AI_IMAGE_INPAINT_DEFAULT_ASPECT_RATIO;
  }

  const trimmed = value.trim();
  if (!(AI_IMAGE_INPAINT_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(trimmed)) {
    throwInvalidInput();
  }

  return trimmed as AIImageInpaintSupportedAspectRatio;
}

function normalizeMaskMode(value: unknown): AIImageInpaintMaskMode {
  const normalized = isNonEmptyString(value)
    ? value.trim()
    : AI_IMAGE_INPAINT_DEFAULT_MASK_MODE;

  if (!isAIImageInpaintMaskMode(normalized)) {
    throwInvalidInput();
  }

  return normalized;
}

function normalizeGeminiAspectRatio(
  value: AIImageInpaintSupportedAspectRatio,
): LaozhangAspectRatio | undefined {
  return value === "auto" ? undefined : value;
}

export function buildAIImageInpaintPrompt(
  maskMode: AIImageInpaintMaskMode,
  userPrompt: string,
): string {
  const prefix = maskMode === "strong-mask"
    ? AI_IMAGE_INPAINT_STRONG_MASK_PROMPT_PREFIX
    : AI_IMAGE_INPAINT_ORIGINAL_MARKUP_PROMPT_PREFIX;

  return `${prefix}\n\n用户提示词：\n${userPrompt.trim()}`;
}

type AIImageInpaintResolvedInput =
  | {
    userId: string;
    taskId: string;
    taskNo: string;
    prompt: string;
    sourceFileId: string;
    maskFileId: string;
    maskMode: AIImageInpaintMaskMode;
    model: "gpt-image-2-vip";
    resolvedSize: string;
    imageSize: AIImageInpaintSupportedImageSize;
    aspectRatio: Exclude<AIImageInpaintSupportedAspectRatio, "auto">;
  }
  | {
    userId: string;
    taskId: string;
    taskNo: string;
    prompt: string;
    sourceFileId: string;
    maskFileId: string;
    maskMode: AIImageInpaintMaskMode;
    model: typeof AI_IMAGE_GEN_GPT_IMAGE_2_MODEL;
  }
  | {
    userId: string;
    taskId: string;
    taskNo: string;
    prompt: string;
    sourceFileId: string;
    maskFileId: string;
    maskMode: AIImageInpaintMaskMode;
    model: Exclude<AIImageInpaintSupportedModel, typeof AI_IMAGE_GEN_GPT_IMAGE_2_MODEL | "gpt-image-2-vip">;
    imageSize: LaozhangImageSize;
    aspectRatio?: LaozhangAspectRatio;
  };

function buildAIImageInpaintInput(task: ExecutionTaskRecord): AIImageInpaintResolvedInput {
  const taskInput = task.input ?? {};
  const prompt = taskInput.prompt;
  const sourceFileId = taskInput.sourceFileId ?? taskInput.inputFileId;
  const maskFileId = taskInput.maskFileId;

  if (
    !isNonEmptyString(prompt)
    || !isNonEmptyString(sourceFileId)
    || !isNonEmptyString(maskFileId)
    || !isNonEmptyString(task.userId)
  ) {
    throwInvalidInput();
  }

  const model = normalizeModel(
    isNonEmptyString(taskInput.model) ? taskInput.model : task.model,
  );
  const imageSize = normalizeImageSize(taskInput.imageSize);
  const aspectRatio = normalizeAspectRatio(taskInput.aspectRatio);
  const maskMode = normalizeMaskMode(taskInput.maskMode);

  if (model === "gpt-image-2-vip") {
    const resolvedSize = resolveAIImageGenOutputSize(model, imageSize, aspectRatio);
    if (!resolvedSize || aspectRatio === "auto") {
      throwInvalidInput();
    }

    return {
      userId: task.userId.trim(),
      taskId: task.id,
      taskNo: task.taskNo,
      prompt: prompt.trim(),
      sourceFileId: sourceFileId.trim(),
      maskFileId: maskFileId.trim(),
      maskMode,
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
      prompt: prompt.trim(),
      sourceFileId: sourceFileId.trim(),
      maskFileId: maskFileId.trim(),
      maskMode,
      model,
    };
  }

  return {
    userId: task.userId.trim(),
    taskId: task.id,
    taskNo: task.taskNo,
    prompt: prompt.trim(),
    sourceFileId: sourceFileId.trim(),
    maskFileId: maskFileId.trim(),
    maskMode,
    model,
    imageSize: imageSize as LaozhangImageSize,
    aspectRatio: normalizeGeminiAspectRatio(aspectRatio),
  };
}

export class AIImageInpaintTaskExecutor implements QueueTaskExecutor {
  readonly nodeType = AI_IMAGE_INPAINT_NODE_TYPE;

  constructor(private readonly helper: MultiImageGenerateHelper) {}

  async execute(input: QueueTaskExecutorInput): Promise<unknown> {
    const taskInput = buildAIImageInpaintInput(input.task);
    const prompt = buildAIImageInpaintPrompt(taskInput.maskMode, taskInput.prompt);
    const referenceFileIds = [
      taskInput.sourceFileId,
      taskInput.maskFileId,
    ];
    const outputFileName = `${taskInput.taskNo}-image-inpaint.png`;

    if (taskInput.model === "gpt-image-2-vip") {
      return this.helper.execute({
        userId: taskInput.userId,
        taskId: taskInput.taskId,
        taskNo: taskInput.taskNo,
        prompt,
        referenceFileIds,
        model: taskInput.model,
        resolvedSize: taskInput.resolvedSize,
        imageSize: taskInput.imageSize,
        aspectRatio: taskInput.aspectRatio,
        outputFileName,
      });
    }

    if (taskInput.model === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL) {
      return this.helper.execute({
        userId: taskInput.userId,
        taskId: taskInput.taskId,
        taskNo: taskInput.taskNo,
        prompt,
        referenceFileIds,
        model: taskInput.model,
        outputFileName,
      });
    }

    return this.helper.execute({
      userId: taskInput.userId,
      taskId: taskInput.taskId,
      taskNo: taskInput.taskNo,
      prompt,
      referenceFileIds,
      model: taskInput.model,
      imageSize: taskInput.imageSize,
      aspectRatio: taskInput.aspectRatio,
      outputFileName,
    });
  }
}
