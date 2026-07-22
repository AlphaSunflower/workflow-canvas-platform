import {
  AI_IMAGE_GEN_DEFAULT_ASPECT_RATIO,
  AI_IMAGE_GEN_DEFAULT_IMAGE_SIZE,
  AI_IMAGE_GEN_DEFAULT_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_MODEL,
  AI_IMAGE_GEN_DEFAULT_OFFICIAL_QUALITY,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL,
  AI_IMAGE_GEN_NODE_TYPE,
  LAOZHANG_OPENAI_IMAGES_PROVIDER_ROUTE,
  isAIImageGenSupportedModel,
  isAIImageGenOfficialQuality,
  resolveAIImageGenOutputSize,
  type AIImageGenOfficialQuality,
  type AIImageGenSupportedAspectRatio,
  type AIImageGenSupportedImageSize,
  type AIImageGenSupportedModel,
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeModel(value: unknown): AIImageGenSupportedModel {
  if (!isNonEmptyString(value)) {
    return AI_IMAGE_GEN_DEFAULT_MODEL;
  }

  const trimmed = value.trim();
  return isAIImageGenSupportedModel(trimmed)
    ? trimmed
    : AI_IMAGE_GEN_DEFAULT_MODEL;
}

function normalizeImageSize(value: unknown): AIImageGenSupportedImageSize {
  return isNonEmptyString(value)
    ? value.trim() as AIImageGenSupportedImageSize
    : AI_IMAGE_GEN_DEFAULT_IMAGE_SIZE;
}

function normalizeAspectRatio(value: unknown): AIImageGenSupportedAspectRatio {
  return isNonEmptyString(value)
    ? value.trim() as AIImageGenSupportedAspectRatio
    : AI_IMAGE_GEN_DEFAULT_ASPECT_RATIO;
}

function normalizeOfficialQuality(value: unknown): AIImageGenOfficialQuality {
  return isAIImageGenOfficialQuality(value)
    ? value
    : AI_IMAGE_GEN_DEFAULT_OFFICIAL_QUALITY;
}

function normalizeGeminiAspectRatio(
  value: AIImageGenSupportedAspectRatio,
): LaozhangAspectRatio | undefined {
  return value === "auto" ? undefined : value;
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

type AIImageGenResolvedInput =
  | {
    userId: string;
    taskId: string;
    taskNo: string;
    prompt: string;
    referenceFileIds: string[];
    model: "gpt-image-2-vip";
    resolvedSize: string;
    imageSize: AIImageGenSupportedImageSize;
    aspectRatio: Exclude<AIImageGenSupportedAspectRatio, "auto">;
  }
  | {
    userId: string;
    taskId: string;
    taskNo: string;
    prompt: string;
    referenceFileIds: string[];
    model: typeof AI_IMAGE_GEN_GPT_IMAGE_2_MODEL;
  }
  | {
    userId: string;
    taskId: string;
    taskNo: string;
    prompt: string;
    referenceFileIds: [];
    model: typeof AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL;
    providerRoute: typeof LAOZHANG_OPENAI_IMAGES_PROVIDER_ROUTE;
    providerModel: typeof AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL;
    quality: AIImageGenOfficialQuality;
    resolvedSize: string;
    imageSize: AIImageGenSupportedImageSize;
    aspectRatio: AIImageGenSupportedAspectRatio;
  }
  | {
    userId: string;
    taskId: string;
    taskNo: string;
    prompt: string;
    referenceFileIds: string[];
    model: Exclude<AIImageGenSupportedModel, typeof AI_IMAGE_GEN_GPT_IMAGE_2_MODEL | "gpt-image-2-vip" | typeof AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL>;
    imageSize: LaozhangImageSize;
    aspectRatio?: LaozhangAspectRatio;
  };

function buildAIImageGenInput(task: ExecutionTaskRecord): AIImageGenResolvedInput {
  const taskInput = task.input ?? {};
  const prompt = taskInput.prompt;
  const referenceFileIds = normalizeReferenceFileIds(taskInput.referenceFileIds);

  if (!isNonEmptyString(prompt)) {
    throw new Error("INVALID_AI_IMAGE_GEN_TASK_INPUT");
  }

  if (!isNonEmptyString(task.userId)) {
    throw new Error("INVALID_AI_IMAGE_GEN_TASK_INPUT");
  }

  const model = normalizeModel(
    isNonEmptyString(taskInput.model) ? taskInput.model : task.model,
  );
  const imageSize = normalizeImageSize(taskInput.imageSize);
  const aspectRatio = normalizeAspectRatio(taskInput.aspectRatio);

  if (model === "gpt-image-2-vip") {
    const resolvedSize = resolveAIImageGenOutputSize(model, imageSize, aspectRatio);
    if (!resolvedSize || aspectRatio === "auto") {
      throw new Error("INVALID_AI_IMAGE_GEN_TASK_INPUT");
    }

    return {
      userId: task.userId.trim(),
      taskId: task.id,
      taskNo: task.taskNo,
      prompt: prompt.trim(),
      referenceFileIds,
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
      referenceFileIds,
      model,
    };
  }

  if (model === AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL) {
    if (referenceFileIds.length > 0) {
      throw new Error("GPT_IMAGE_2_OFFICIAL_IMAGE_EDIT_NOT_IMPLEMENTED");
    }

    const resolvedSize = isNonEmptyString(taskInput.resolvedSize)
      ? taskInput.resolvedSize.trim()
      : resolveAIImageGenOutputSize(model, imageSize, aspectRatio);
    if (!resolvedSize) {
      throw new Error("INVALID_AI_IMAGE_GEN_TASK_INPUT");
    }

    return {
      userId: task.userId.trim(),
      taskId: task.id,
      taskNo: task.taskNo,
      prompt: prompt.trim(),
      referenceFileIds: [],
      model,
      providerRoute: LAOZHANG_OPENAI_IMAGES_PROVIDER_ROUTE,
      providerModel: AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL,
      quality: normalizeOfficialQuality(taskInput.quality),
      resolvedSize,
      imageSize,
      aspectRatio,
    };
  }

  return {
    userId: task.userId.trim(),
    taskId: task.id,
    taskNo: task.taskNo,
    prompt: prompt.trim(),
    referenceFileIds,
    model,
    imageSize: imageSize as LaozhangImageSize,
    aspectRatio: normalizeGeminiAspectRatio(aspectRatio),
  };
}

export class AIImageGenTaskExecutor implements QueueTaskExecutor {
  readonly nodeType = AI_IMAGE_GEN_NODE_TYPE;
  readonly nodeTypes = [AI_IMAGE_GEN_NODE_TYPE, "aiStoryboard"] as const;
  readonly taskTypes = ["image-gen"] as const;

  constructor(private readonly helper: MultiImageGenerateHelper) {}

  async execute(input: QueueTaskExecutorInput): Promise<unknown> {
    const taskInput = buildAIImageGenInput(input.task);

    if (taskInput.model === "gpt-image-2-vip") {
      return this.helper.execute({
        userId: taskInput.userId,
        taskId: taskInput.taskId,
        taskNo: taskInput.taskNo,
        prompt: taskInput.prompt,
        referenceFileIds: taskInput.referenceFileIds,
        model: taskInput.model,
        resolvedSize: taskInput.resolvedSize,
        imageSize: taskInput.imageSize,
        aspectRatio: taskInput.aspectRatio,
        outputFileName: `${taskInput.taskNo}-ai-image-gen.png`,
      });
    }

    if (taskInput.model === AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_MODEL) {
      return this.helper.execute({
        userId: taskInput.userId,
        taskId: taskInput.taskId,
        taskNo: taskInput.taskNo,
        prompt: taskInput.prompt,
        referenceFileIds: [],
        model: taskInput.model,
        providerRoute: taskInput.providerRoute,
        providerModel: taskInput.providerModel,
        quality: taskInput.quality,
        resolvedSize: taskInput.resolvedSize,
        imageSize: taskInput.imageSize,
        aspectRatio: taskInput.aspectRatio,
        outputFileName: `${taskInput.taskNo}-ai-image-gen.png`,
      });
    }

    if (taskInput.model === AI_IMAGE_GEN_GPT_IMAGE_2_MODEL) {
      return this.helper.execute({
        userId: taskInput.userId,
        taskId: taskInput.taskId,
        taskNo: taskInput.taskNo,
        prompt: taskInput.prompt,
        referenceFileIds: taskInput.referenceFileIds,
        model: taskInput.model,
        outputFileName: `${taskInput.taskNo}-ai-image-gen.png`,
      });
    }

    return this.helper.execute({
      userId: taskInput.userId,
      taskId: taskInput.taskId,
      taskNo: taskInput.taskNo,
      prompt: taskInput.prompt,
      referenceFileIds: taskInput.referenceFileIds,
      model: taskInput.model,
      imageSize: taskInput.imageSize,
      aspectRatio: taskInput.aspectRatio,
      outputFileName: `${taskInput.taskNo}-ai-image-gen.png`,
    });
  }
}
