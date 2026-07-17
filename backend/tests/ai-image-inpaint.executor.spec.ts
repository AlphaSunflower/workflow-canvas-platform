import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import {
  AI_IMAGE_INPAINT_ORIGINAL_MARKUP_PROMPT_PREFIX,
  AI_IMAGE_INPAINT_STRONG_MASK_PROMPT_PREFIX,
  AIImageInpaintTaskExecutor,
} from "../worker/src/modules/executors/ai-image-inpaint.executor.ts";
import { MultiImageGenerateHelper } from "../worker/src/modules/executors/multi-image-generate.helper.ts";
import { LocalStorageAdapter } from "../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../worker/src/modules/storage/storage.service.ts";
import { createAIImageInpaintRequest } from "./helpers/execution-request.fixture.ts";

const TEST_WORKFLOW_ID = "workflow-ai-image-inpaint-executor";

async function registerReadyFile(
  filesRepository: FilesRepository,
  userId: string,
  originalName: string,
  content: string,
): Promise<string> {
  const buffer = Buffer.from(content);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const registerResult = await filesRepository.registerFile({
    userId,
    sha256,
    size: buffer.length,
    mimeType: "image/png",
    originalName,
    fileType: "image",
    sourceType: "input",
  });

  if (registerResult.uploadRequired && registerResult.uploadId) {
    await filesRepository.uploadFile(
      registerResult.uploadId,
      buffer.toString("base64"),
    );
  }

  return registerResult.file.fileId;
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-image-inpaint-executor-test-"));

  try {
    await runOriginalMarkupScenario(rootDir);
    await runStrongMaskScenario(rootDir);
    await runGptScenario(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runOriginalMarkupScenario(rootDir: string): Promise<void> {
  const filesRepository = new FilesRepository(rootDir);
  const executionsRepository = new ExecutionsRepository(rootDir);
  const executionsService = ExecutionsService.fromRoot(rootDir);
  const storageService = new StorageService(new LocalStorageAdapter(rootDir));
  const providerCalls: Array<Record<string, unknown>> = [];

  const helper = new MultiImageGenerateHelper(
    executionsRepository,
    filesRepository,
    {
      async generateImage(input) {
        providerCalls.push({
          model: input.model,
          prompt: input.prompt,
          imageSize: input.imageSize,
          aspectRatio: input.aspectRatio,
          size: input.size,
          snapshotLabel: input.snapshotLabel,
          hasNativeMask: Object.hasOwn(input as unknown as Record<string, unknown>, "mask"),
          imagesText: input.images.map((item) =>
            Buffer.from(item.dataBase64, "base64").toString("utf8")
          ),
        });

        return {
          imageBase64: Buffer.from("ai-image-inpaint-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIImageInpaintTaskExecutor(helper);

  const sourceFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "source-inpaint.png",
    "source-image-content",
  );
  const maskFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "markup-inpaint.png",
    "markup-image-content",
  );

  const createResult = await executionsService.createExecution(createAIImageInpaintRequest({
    userId: "user-a",
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiImageInpaint",
    taskType: "image-inpaint",
    executionMode: "legacy-grouped-task",
    nodeId: "node-ai-image-inpaint",
    nodeTitle: "AI Image Inpaint",
    prompt: "replace the sofa with a green lounge chair",
    model: "gemini-3-pro-image-preview",
    imageSize: "4K",
    aspectRatio: "16:9",
    maskMode: "original-markup",
    groups: [
      {
        groupId: "main",
        sourceFileId,
        maskFileId,
      },
    ],
  }));

  await executionsRepository.claimQueuedTasks(1);

  const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
  assert.ok(task);

  const result = await executor.execute({
    runId: createResult.runId,
    task: task!,
  });

  await executionsRepository.markTaskCompleted(createResult.tasks[0]!.taskId);

  assert.ok(result);
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0]?.model, "gemini-3-pro-image-preview");
  assert.equal(providerCalls[0]?.imageSize, "4K");
  assert.equal(providerCalls[0]?.aspectRatio, "16:9");
  assert.equal(providerCalls[0]?.size, undefined);
  assert.equal(providerCalls[0]?.snapshotLabel, `${task!.taskNo}-multi-image`);
  assert.equal(providerCalls[0]?.hasNativeMask, false);
  assert.deepEqual(providerCalls[0]?.imagesText, [
    "source-image-content",
    "markup-image-content",
  ]);
  assert.equal((providerCalls[0]?.imagesText as unknown[] | undefined)?.length, 2);
  assert.ok(
    (providerCalls[0]?.prompt as string).includes(AI_IMAGE_INPAINT_ORIGINAL_MARKUP_PROMPT_PREFIX),
  );
  assert.ok(
    (providerCalls[0]?.prompt as string).includes(
      "用户提示词：\nreplace the sofa with a green lounge chair",
    ),
  );
  assert.equal(
    (providerCalls[0]?.prompt as string).includes("Preserve the unmarked areas"),
    false,
  );

  const savedTask = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
  const resultFileId = (result as { resultFileId: string }).resultFileId;
  const resultFile = await filesRepository.findFileById(resultFileId);
  const resultContent = await filesRepository.readFileContent(resultFileId);

  assert.equal(savedTask?.resultFileId, resultFileId);
  assert.equal(savedTask?.status, "completed");
  assert.equal(resultFile?.sourceType, "output");
  assert.equal(resultFile?.fileType, "image");
  assert.equal(resultFile?.userId, "user-a");
  assert.equal(resultFile?.originalName, `${task!.taskNo}-image-inpaint.png`);
  assert.equal(resultContent?.buffer.toString("utf8"), "ai-image-inpaint-result");
}

async function runStrongMaskScenario(rootDir: string): Promise<void> {
  const filesRepository = new FilesRepository(rootDir);
  const executionsRepository = new ExecutionsRepository(rootDir);
  const executionsService = ExecutionsService.fromRoot(rootDir);
  const storageService = new StorageService(new LocalStorageAdapter(rootDir));
  const providerCalls: Array<Record<string, unknown>> = [];

  const helper = new MultiImageGenerateHelper(
    executionsRepository,
    filesRepository,
    {
      async generateImage(input) {
        providerCalls.push({
          prompt: input.prompt,
          hasNativeMask: Object.hasOwn(input as unknown as Record<string, unknown>, "mask"),
          imagesText: input.images.map((item) =>
            Buffer.from(item.dataBase64, "base64").toString("utf8")
          ),
        });

        return {
          imageBase64: Buffer.from("ai-image-inpaint-strong-mask-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIImageInpaintTaskExecutor(helper);

  const sourceFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "source-strong-mask.png",
    "source-strong-mask-content",
  );
  const maskFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "strong-mask.png",
    "black-white-mask-content",
  );

  const createResult = await executionsService.createExecution(createAIImageInpaintRequest({
    userId: "user-a",
    workflowId: `${TEST_WORKFLOW_ID}-strong-mask`,
    nodeType: "aiImageInpaint",
    taskType: "image-inpaint",
    executionMode: "legacy-grouped-task",
    nodeId: "node-ai-image-inpaint-strong-mask",
    nodeTitle: "AI Image Inpaint Strong Mask",
    prompt: "add a built-in bookshelf",
    model: "gemini-3-pro-image-preview",
    maskMode: "strong-mask",
    groups: [
      {
        groupId: "main",
        sourceFileId,
        maskFileId,
      },
    ],
  }));

  await executionsRepository.claimQueuedTasks(1);

  const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
  assert.ok(task);

  await executor.execute({
    runId: createResult.runId,
    task: task!,
  });

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0]?.hasNativeMask, false);
  assert.deepEqual(providerCalls[0]?.imagesText, [
    "source-strong-mask-content",
    "black-white-mask-content",
  ]);
  assert.equal((providerCalls[0]?.imagesText as unknown[] | undefined)?.length, 2);
  assert.ok(
    (providerCalls[0]?.prompt as string).includes(AI_IMAGE_INPAINT_STRONG_MASK_PROMPT_PREFIX),
  );
  assert.ok(
    !(providerCalls[0]?.prompt as string).includes(AI_IMAGE_INPAINT_ORIGINAL_MARKUP_PROMPT_PREFIX),
  );
  assert.ok(
    (providerCalls[0]?.prompt as string).includes("用户提示词：\nadd a built-in bookshelf"),
  );
  assert.equal(
    (providerCalls[0]?.prompt as string).includes("Preserve the black masked area"),
    false,
  );
}

async function runGptScenario(rootDir: string): Promise<void> {
  const filesRepository = new FilesRepository(rootDir);
  const executionsRepository = new ExecutionsRepository(rootDir);
  const executionsService = ExecutionsService.fromRoot(rootDir);
  const storageService = new StorageService(new LocalStorageAdapter(rootDir));
  const providerCalls: Array<Record<string, unknown>> = [];

  const helper = new MultiImageGenerateHelper(
    executionsRepository,
    filesRepository,
    {
      async generateImage(input) {
        providerCalls.push({
          model: input.model,
          prompt: input.prompt,
          imageSize: input.imageSize,
          aspectRatio: input.aspectRatio,
          size: input.size,
          hasNativeMask: Object.hasOwn(input as unknown as Record<string, unknown>, "mask"),
          imagesText: input.images.map((item) =>
            Buffer.from(item.dataBase64, "base64").toString("utf8")
          ),
        });

        return {
          imageBase64: Buffer.from("ai-image-inpaint-gpt-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIImageInpaintTaskExecutor(helper);

  const sourceFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "source-gpt.png",
    "source-gpt-content",
  );
  const maskFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "markup-gpt.png",
    "markup-gpt-content",
  );

  const createResult = await executionsService.createExecution(createAIImageInpaintRequest({
    userId: "user-a",
    workflowId: `${TEST_WORKFLOW_ID}-gpt`,
    nodeType: "aiImageInpaint",
    taskType: "image-inpaint",
    executionMode: "legacy-grouped-task",
    nodeId: "node-ai-image-inpaint-gpt",
    nodeTitle: "AI Image Inpaint GPT",
    prompt: "make the countertop marble",
    model: "gpt-image-2-vip",
    imageSize: "2K",
    aspectRatio: "16:9",
    maskMode: "original-markup",
    groups: [
      {
        groupId: "main",
        sourceFileId,
        maskFileId,
      },
    ],
  }));

  await executionsRepository.claimQueuedTasks(1);

  const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
  assert.ok(task);

  await executor.execute({
    runId: createResult.runId,
    task: task!,
  });

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0]?.model, "gpt-image-2-vip");
  assert.equal(providerCalls[0]?.imageSize, undefined);
  assert.equal(providerCalls[0]?.aspectRatio, undefined);
  assert.equal(providerCalls[0]?.size, "2048x1152");
  assert.equal(providerCalls[0]?.hasNativeMask, false);
  assert.deepEqual(providerCalls[0]?.imagesText, [
    "source-gpt-content",
    "markup-gpt-content",
  ]);

  const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
  const startEvent = events.find((event) => event.eventType === "step_final_started");

  assert.equal(startEvent?.payload?.model, "gpt-image-2-vip");
  assert.equal(startEvent?.payload?.imageSize, "2K");
  assert.equal(startEvent?.payload?.aspectRatio, "16:9");
  assert.equal(startEvent?.payload?.resolvedSize, "2048x1152");
  assert.deepEqual(startEvent?.payload?.referenceFileIds, [
    sourceFileId,
    maskFileId,
  ]);
}

void run();
