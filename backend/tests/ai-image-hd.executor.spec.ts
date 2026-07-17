import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_IMAGE_HD_PROMPT,
} from "../shared/src/index.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { SingleImageGenerateHelper } from "../worker/src/modules/executors/single-image-generate.helper.ts";
import { AIImageHdTaskExecutor } from "../worker/src/modules/executors/ai-image-hd.executor.ts";
import { LocalStorageAdapter } from "../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../worker/src/modules/storage/storage.service.ts";
import { createAIImageHdRequest } from "./helpers/execution-request.fixture.ts";

const TEST_WORKFLOW_ID = "workflow-ai-image-hd-executor";

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
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-image-hd-executor-test-"));

  try {
    await runGeminiScenario(rootDir);
    await runGptScenario(rootDir);
    await runTaskModelFallbackScenario(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runGeminiScenario(rootDir: string): Promise<void> {
  const filesRepository = new FilesRepository(rootDir);
  const executionsRepository = new ExecutionsRepository(rootDir);
  const executionsService = ExecutionsService.fromRoot(rootDir);
  const storageService = new StorageService(new LocalStorageAdapter(rootDir));
  const providerCalls: Array<Record<string, unknown>> = [];

  const helper = new SingleImageGenerateHelper(
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
          imagesText: input.images.map((item) =>
            Buffer.from(item.dataBase64, "base64").toString("utf8")
          ),
        });

        return {
          imageBase64: Buffer.from("image-hd-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIImageHdTaskExecutor(helper);

  const sourceFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "source-hd.png",
    "source-image-hd-content",
  );

  const createResult = await executionsService.createExecution(createAIImageHdRequest({
    userId: "user-a",
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiImageHd",
    taskType: "image-hd",
    executionMode: "legacy-grouped-task",
    nodeId: "node-image-hd",
    nodeTitle: "AI Image HD",
    groups: [
      {
        groupId: "group-1",
        sourceFileId,
        imageSize: "4K",
        aspectRatio: "16:9",
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
  assert.equal(providerCalls[0]?.prompt, AI_IMAGE_HD_PROMPT);
  assert.equal(providerCalls[0]?.imageSize, "4K");
  assert.equal(providerCalls[0]?.aspectRatio, "16:9");
  assert.equal(providerCalls[0]?.size, undefined);
  assert.equal(providerCalls[0]?.snapshotLabel, `${task!.taskNo}-single-image`);
  assert.deepEqual(providerCalls[0]?.imagesText, ["source-image-hd-content"]);

  const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
  const startEvent = events.find((event) => event.eventType === "step_final_started");
  assert.equal(startEvent?.payload?.model, "gemini-3-pro-image-preview");
  assert.equal(startEvent?.payload?.imageSize, "4K");
  assert.equal(startEvent?.payload?.aspectRatio, "16:9");
  assert.equal(startEvent?.payload?.resolvedSize, null);
}

async function runGptScenario(rootDir: string): Promise<void> {
  const filesRepository = new FilesRepository(rootDir);
  const executionsRepository = new ExecutionsRepository(rootDir);
  const executionsService = ExecutionsService.fromRoot(rootDir);
  const storageService = new StorageService(new LocalStorageAdapter(rootDir));
  const providerCalls: Array<Record<string, unknown>> = [];

  const helper = new SingleImageGenerateHelper(
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
          imagesText: input.images.map((item) =>
            Buffer.from(item.dataBase64, "base64").toString("utf8")
          ),
        });

        return {
          imageBase64: Buffer.from("image-hd-gpt-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIImageHdTaskExecutor(helper);

  const sourceFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "source-hd-gpt.png",
    "source-image-hd-gpt-content",
  );

  const createResult = await executionsService.createExecution(createAIImageHdRequest({
    userId: "user-a",
    workflowId: `${TEST_WORKFLOW_ID}-gpt`,
    nodeType: "aiImageHd",
    taskType: "image-hd",
    executionMode: "legacy-grouped-task",
    nodeId: "node-image-hd-gpt",
    nodeTitle: "AI Image HD GPT",
    model: "gpt-image-2-vip",
    groups: [
      {
        groupId: "group-1",
        sourceFileId,
        imageSize: "2K",
        aspectRatio: "16:9",
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

  const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
  const startEvent = events.find((event) => event.eventType === "step_final_started");
  assert.equal(startEvent?.payload?.model, "gpt-image-2-vip");
  assert.equal(startEvent?.payload?.imageSize, "2K");
  assert.equal(startEvent?.payload?.aspectRatio, "16:9");
  assert.equal(startEvent?.payload?.resolvedSize, "2048x1152");
}

async function runTaskModelFallbackScenario(rootDir: string): Promise<void> {
  const filesRepository = new FilesRepository(rootDir);
  const executionsRepository = new ExecutionsRepository(rootDir);
  const executionsService = ExecutionsService.fromRoot(rootDir);
  const storageService = new StorageService(new LocalStorageAdapter(rootDir));
  const providerCalls: Array<Record<string, unknown>> = [];

  const helper = new SingleImageGenerateHelper(
    executionsRepository,
    filesRepository,
    {
      async generateImage(input) {
        providerCalls.push({
          model: input.model,
          size: input.size,
        });

        return {
          imageBase64: Buffer.from("image-hd-gpt-fallback-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIImageHdTaskExecutor(helper);

  const sourceFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "source-hd-fallback.png",
    "source-image-hd-fallback-content",
  );

  const createResult = await executionsService.createExecution(createAIImageHdRequest({
    userId: "user-a",
    workflowId: `${TEST_WORKFLOW_ID}-fallback`,
    nodeType: "aiImageHd",
    taskType: "image-hd",
    executionMode: "legacy-grouped-task",
    nodeId: "node-image-hd-fallback",
    nodeTitle: "AI Image HD Fallback",
    model: "gpt-image-2-vip",
    groups: [
      {
        groupId: "group-1",
        sourceFileId,
        imageSize: "1K",
        aspectRatio: "4:3",
      },
    ],
  }));

  await executionsRepository.claimQueuedTasks(1);

  const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
  assert.ok(task);

  await executor.execute({
    runId: createResult.runId,
    task: {
      ...task!,
      input: {
        ...(task!.input ?? {}),
        model: "",
      },
    },
  });

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0]?.model, "gpt-image-2-vip");
  assert.equal(providerCalls[0]?.size, "1280x960");
}

void run();
