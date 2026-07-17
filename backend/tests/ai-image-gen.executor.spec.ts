import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { AIImageGenTaskExecutor } from "../worker/src/modules/executors/ai-image-gen.executor.ts";
import { MultiImageGenerateHelper } from "../worker/src/modules/executors/multi-image-generate.helper.ts";
import { LocalStorageAdapter } from "../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../worker/src/modules/storage/storage.service.ts";
import { createAIImageGenRequest } from "./helpers/execution-request.fixture.ts";

const TEST_WORKFLOW_ID = "workflow-ai-image-gen-executor";

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
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-image-gen-executor-test-"));

  try {
    await runGeminiScenario(rootDir);
    await runGeminiTextOnlyScenario(rootDir);
    await runGptScenario(rootDir);
    await runGptTextOnlyScenario(rootDir);
    await runOfficialGenerateScenario(rootDir);
    await runOfficialEditNotImplementedScenario(rootDir);
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
          imagesText: input.images.map((item) =>
            Buffer.from(item.dataBase64, "base64").toString("utf8")
          ),
        });

        return {
          imageBase64: Buffer.from("ai-image-gen-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIImageGenTaskExecutor(helper);

  const referenceFileId1 = await registerReadyFile(
    filesRepository,
    "user-a",
    "reference-1.png",
    "reference-image-content-1",
  );
  const referenceFileId2 = await registerReadyFile(
    filesRepository,
    "user-a",
    "reference-2.png",
    "reference-image-content-2",
  );
  const referenceFileId3 = await registerReadyFile(
    filesRepository,
    "user-a",
    "reference-3.png",
    "reference-image-content-3",
  );

  const createResult = await executionsService.createExecution(createAIImageGenRequest({
    userId: "user-a",
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    nodeId: "node-ai-image-gen",
    nodeTitle: "AI 鐢熷浘",
    prompt: "鑺傜偣鍏变韩鎻愮ず璇?",
    imageSize: "4K",
    aspectRatio: "16:9",
    groups: [
      {
        groupId: "group-1",
        referenceFileIds: [referenceFileId2, referenceFileId1, referenceFileId3],
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
  assert.deepEqual(providerCalls[0]?.imagesText, [
    "reference-image-content-2",
    "reference-image-content-1",
    "reference-image-content-3",
  ]);

  const savedTask = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
  const resultFileId = (result as { resultFileId: string }).resultFileId;
  const resultFile = await filesRepository.findFileById(resultFileId);
  const resultContent = await filesRepository.readFileContent(resultFileId);

  assert.equal(savedTask?.resultFileId, resultFileId);
  assert.equal(savedTask?.status, "completed");
  assert.equal(resultFile?.sourceType, "output");
  assert.equal(resultFile?.userId, "user-a");
  assert.equal(resultContent?.buffer.toString("utf8"), "ai-image-gen-result");
}

async function runGeminiTextOnlyScenario(rootDir: string): Promise<void> {
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
          imageCount: input.images.length,
        });

        return {
          imageBase64: Buffer.from("ai-image-gen-gemini-text-only-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIImageGenTaskExecutor(helper);

  const createResult = await executionsService.createExecution(createAIImageGenRequest({
    userId: "user-a",
    workflowId: `${TEST_WORKFLOW_ID}-gemini-text-only`,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    nodeId: "node-ai-image-gen-gemini-text-only",
    nodeTitle: "AI Image Gen Gemini Text Only",
    model: "gemini-3-pro-image-preview",
    prompt: "gemini image text only prompt",
    imageSize: "2K",
    aspectRatio: "auto",
    groups: [
      {
        groupId: "group-gemini-text-only-1",
        referenceFileIds: [],
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
  assert.equal(providerCalls[0]?.imageSize, "2K");
  assert.equal(providerCalls[0]?.aspectRatio, undefined);
  assert.equal(providerCalls[0]?.size, undefined);
  assert.equal(providerCalls[0]?.imageCount, 0);
  assert.equal(providerCalls[0]?.snapshotLabel, `${task!.taskNo}-multi-image`);

  const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
  const startEvent = events.find((event) => event.eventType === "step_final_started");
  const savedTask = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
  const resultFileId = (result as { resultFileId: string }).resultFileId;
  const resultContent = await filesRepository.readFileContent(resultFileId);

  assert.deepEqual(startEvent?.payload?.referenceFileIds, []);
  assert.equal(savedTask?.resultFileId, resultFileId);
  assert.equal(savedTask?.status, "completed");
  assert.equal(resultContent?.buffer.toString("utf8"), "ai-image-gen-gemini-text-only-result");
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
          snapshotLabel: input.snapshotLabel,
          imagesText: input.images.map((item) =>
            Buffer.from(item.dataBase64, "base64").toString("utf8")
          ),
        });

        return {
          imageBase64: Buffer.from("ai-image-gen-gpt-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIImageGenTaskExecutor(helper);

  const referenceFileId1 = await registerReadyFile(
    filesRepository,
    "user-a",
    "reference-gpt-1.png",
    "reference-gpt-content-1",
  );
  const referenceFileId2 = await registerReadyFile(
    filesRepository,
    "user-a",
    "reference-gpt-2.png",
    "reference-gpt-content-2",
  );

  const createResult = await executionsService.createExecution(createAIImageGenRequest({
    userId: "user-a",
    workflowId: `${TEST_WORKFLOW_ID}-gpt`,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    nodeId: "node-ai-image-gen-gpt",
    nodeTitle: "AI 鐢熷浘 GPT",
    model: "gpt-image-2-vip",
    prompt: "gpt image prompt",
    imageSize: "2K",
    aspectRatio: "16:9",
    groups: [
      {
        groupId: "group-gpt-1",
        referenceFileIds: [referenceFileId1, referenceFileId2],
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
  assert.equal(providerCalls[0]?.model, "gpt-image-2-vip");
  assert.equal(providerCalls[0]?.imageSize, undefined);
  assert.equal(providerCalls[0]?.aspectRatio, undefined);
  assert.equal(providerCalls[0]?.size, "2048x1152");
  assert.equal(providerCalls[0]?.snapshotLabel, `${task!.taskNo}-multi-image`);
  assert.deepEqual(providerCalls[0]?.imagesText, [
    "reference-gpt-content-1",
    "reference-gpt-content-2",
  ]);

  const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
  const startEvent = events.find((event) => event.eventType === "step_final_started");

  assert.equal(startEvent?.payload?.model, "gpt-image-2-vip");
  assert.equal(startEvent?.payload?.imageSize, "2K");
  assert.equal(startEvent?.payload?.aspectRatio, "16:9");
  assert.equal(startEvent?.payload?.resolvedSize, "2048x1152");
}

async function runOfficialGenerateScenario(rootDir: string): Promise<void> {
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
        const inputRecord = input as unknown as Record<string, unknown>;
        providerCalls.push({
          model: input.model,
          providerModel: inputRecord.providerModel,
          prompt: input.prompt,
          imageSize: input.imageSize,
          aspectRatio: input.aspectRatio,
          size: input.size,
          quality: inputRecord.quality,
          snapshotLabel: input.snapshotLabel,
          imageCount: input.images.length,
        });

        return {
          imageBase64: Buffer.from("ai-image-gen-official-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIImageGenTaskExecutor(helper);

  const createResult = await executionsService.createExecution(createAIImageGenRequest({
    userId: "user-a",
    workflowId: `${TEST_WORKFLOW_ID}-official`,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    nodeId: "node-ai-image-gen-official",
    nodeTitle: "AI Image Gen Official",
    model: "gpt-image-2-official",
    prompt: "official image prompt",
    imageSize: "2K",
    aspectRatio: "auto",
    quality: "high",
    groups: [
      {
        groupId: "group-official-1",
        referenceFileIds: [],
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
  assert.equal(providerCalls[0]?.model, "gpt-image-2-official");
  assert.equal(providerCalls[0]?.providerModel, "gpt-image-2");
  assert.equal(providerCalls[0]?.imageSize, undefined);
  assert.equal(providerCalls[0]?.aspectRatio, undefined);
  assert.equal(providerCalls[0]?.size, "auto");
  assert.equal(providerCalls[0]?.quality, "high");
  assert.equal(providerCalls[0]?.imageCount, 0);
  assert.equal(providerCalls[0]?.snapshotLabel, `${task!.taskNo}-multi-image`);

  const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
  const startEvent = events.find((event) => event.eventType === "step_final_started");
  const savedTask = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
  const resultFileId = (result as { resultFileId: string }).resultFileId;
  const resultFile = await filesRepository.findFileById(resultFileId);
  const resultContent = await filesRepository.readFileContent(resultFileId);

  assert.equal(startEvent?.payload?.model, "gpt-image-2-official");
  assert.equal(startEvent?.payload?.quality, "high");
  assert.equal(startEvent?.payload?.providerRoute, "sora2official");
  assert.equal(startEvent?.payload?.providerModel, "gpt-image-2");
  assert.equal(startEvent?.payload?.resolvedSize, "auto");
  assert.equal(savedTask?.resultFileId, resultFileId);
  assert.equal(savedTask?.status, "completed");
  assert.equal(resultFile?.sourceType, "output");
  assert.equal(resultContent?.buffer.toString("utf8"), "ai-image-gen-official-result");
}

async function runGptTextOnlyScenario(rootDir: string): Promise<void> {
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
          imageCount: input.images.length,
        });

        return {
          imageBase64: Buffer.from("ai-image-gen-gpt-text-only-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIImageGenTaskExecutor(helper);

  const createResult = await executionsService.createExecution(createAIImageGenRequest({
    userId: "user-a",
    workflowId: `${TEST_WORKFLOW_ID}-gpt-text-only`,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    nodeId: "node-ai-image-gen-gpt-text-only",
    nodeTitle: "AI Image Gen GPT Text Only",
    model: "gpt-image-2-vip",
    prompt: "gpt image text only prompt",
    imageSize: "1K",
    aspectRatio: "1:1",
    groups: [
      {
        groupId: "group-gpt-text-only-1",
        referenceFileIds: [],
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
  assert.equal(providerCalls[0]?.model, "gpt-image-2-vip");
  assert.equal(providerCalls[0]?.imageSize, undefined);
  assert.equal(providerCalls[0]?.aspectRatio, undefined);
  assert.equal(providerCalls[0]?.size, "1280x1280");
  assert.equal(providerCalls[0]?.imageCount, 0);
  assert.equal(providerCalls[0]?.snapshotLabel, `${task!.taskNo}-multi-image`);

  const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
  const startEvent = events.find((event) => event.eventType === "step_final_started");
  const savedTask = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
  const resultFileId = (result as { resultFileId: string }).resultFileId;
  const resultContent = await filesRepository.readFileContent(resultFileId);

  assert.deepEqual(startEvent?.payload?.referenceFileIds, []);
  assert.equal(startEvent?.payload?.resolvedSize, "1280x1280");
  assert.equal(savedTask?.resultFileId, resultFileId);
  assert.equal(savedTask?.status, "completed");
  assert.equal(resultContent?.buffer.toString("utf8"), "ai-image-gen-gpt-text-only-result");
}

async function runOfficialEditNotImplementedScenario(rootDir: string): Promise<void> {
  const filesRepository = new FilesRepository(rootDir);
  const executionsRepository = new ExecutionsRepository(rootDir);
  const executionsService = ExecutionsService.fromRoot(rootDir);
  const storageService = new StorageService(new LocalStorageAdapter(rootDir));

  const helper = new MultiImageGenerateHelper(
    executionsRepository,
    filesRepository,
    {
      async generateImage() {
        throw new Error("SHOULD_NOT_CALL_PROVIDER");
      },
    },
    storageService,
  );
  const executor = new AIImageGenTaskExecutor(helper);
  const referenceFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "reference-official-edit.png",
    "reference-official-edit-content",
  );

  const createResult = await executionsService.createExecution(createAIImageGenRequest({
    userId: "user-a",
    workflowId: `${TEST_WORKFLOW_ID}-official-edit`,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    nodeId: "node-ai-image-gen-official-edit",
    nodeTitle: "AI Image Gen Official Edit",
    model: "gpt-image-2-official",
    prompt: "official edit prompt",
    imageSize: "2K",
    aspectRatio: "16:9",
    quality: "medium",
    groups: [
      {
        groupId: "group-official-edit-1",
        referenceFileIds: [referenceFileId],
      },
    ],
  }));

  await executionsRepository.claimQueuedTasks(1);

  const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
  assert.ok(task);

  await assert.rejects(
    () => executor.execute({
      runId: createResult.runId,
      task: task!,
    }),
    /GPT_IMAGE_2_OFFICIAL_IMAGE_EDIT_NOT_IMPLEMENTED/,
  );
}

async function runTaskModelFallbackScenario(rootDir: string): Promise<void> {
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
          size: input.size,
          imagesText: input.images.map((item) =>
            Buffer.from(item.dataBase64, "base64").toString("utf8")
          ),
        });

        return {
          imageBase64: Buffer.from("ai-image-gen-gpt-fallback-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIImageGenTaskExecutor(helper);

  const referenceFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "reference-gpt-fallback.png",
    "reference-gpt-fallback-content",
  );

  const createResult = await executionsService.createExecution(createAIImageGenRequest({
    userId: "user-a",
    workflowId: `${TEST_WORKFLOW_ID}-gpt-fallback`,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    nodeId: "node-ai-image-gen-gpt-fallback",
    nodeTitle: "AI 閻㈢喎娴?GPT fallback",
    model: "gpt-image-2-vip",
    prompt: "gpt image prompt fallback",
    imageSize: "1K",
    aspectRatio: "4:3",
    groups: [
      {
        groupId: "group-gpt-fallback-1",
        referenceFileIds: [referenceFileId],
      },
    ],
  }));

  await executionsRepository.claimQueuedTasks(1);

  const taskId = createResult.tasks[0]!.taskId;
  const task = await executionsRepository.getTaskById(taskId);
  assert.ok(task);

  const fallbackTask = {
    ...task!,
    input: {
      ...(task!.input ?? {}),
      model: "",
    },
  };

  await executor.execute({
    runId: createResult.runId,
    task: fallbackTask,
  });

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0]?.model, "gpt-image-2-vip");
  assert.equal(providerCalls[0]?.size, "1280x960");
  assert.deepEqual(providerCalls[0]?.imagesText, [
    "reference-gpt-fallback-content",
  ]);
}

void run();
