import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET,
  AI_FLOORPLAN_COLORIZE_PROMPT_VERSION,
  AI_FLOORPLAN_COLORIZE_STYLE_PROMPTS,
} from "../shared/src/index.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { SingleImageGenerateHelper } from "../worker/src/modules/executors/single-image-generate.helper.ts";
import { AIFloorplanColorizeTaskExecutor } from "../worker/src/modules/executors/ai-floorplan-colorize.executor.ts";
import { LocalStorageAdapter } from "../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../worker/src/modules/storage/storage.service.ts";
import { createAIFloorplanColorizeRequest } from "./helpers/execution-request.fixture.ts";

const TEST_WORKFLOW_ID = "workflow-ai-floorplan-colorize-executor";

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
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "floorplan-colorize-executor-test-"));

  try {
    await runGeminiScenario(rootDir);
    await runGptScenario(rootDir);
    await runInvalidStyleScenario(rootDir);
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
          imageBase64: Buffer.from("floorplan-colorize-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIFloorplanColorizeTaskExecutor(helper);

  const sourceFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "source-floorplan.png",
    "source-floorplan-content",
  );

  const createResult = await executionsService.createExecution(createAIFloorplanColorizeRequest({
    userId: "user-a",
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiFloorplanColorize",
    taskType: "floorplan-colorize",
    executionMode: "legacy-grouped-task",
    nodeId: "node-floorplan-colorize",
    nodeTitle: "Floorplan Colorize",
    groups: [
      {
        groupId: "group-1",
        sourceFileId,
        imageSize: "2K",
        aspectRatio: "3:4",
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
  assert.equal(
    providerCalls[0]?.prompt,
    AI_FLOORPLAN_COLORIZE_STYLE_PROMPTS[AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET],
  );
  assert.equal(providerCalls[0]?.model, "gemini-3-pro-image-preview");
  assert.equal(providerCalls[0]?.imageSize, "2K");
  assert.equal(providerCalls[0]?.aspectRatio, "3:4");
  assert.equal(providerCalls[0]?.size, undefined);

  const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
  const startEvent = events.find((event) => event.eventType === "step_final_started");
  assert.deepEqual(startEvent?.payload, {
    sourceFileId,
    model: "gemini-3-pro-image-preview",
    imageSize: "2K",
    aspectRatio: "3:4",
    resolvedSize: null,
    stylePreset: AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET,
    promptVersion: AI_FLOORPLAN_COLORIZE_PROMPT_VERSION,
  });
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
        });

        return {
          imageBase64: Buffer.from("floorplan-colorize-gpt-result").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIFloorplanColorizeTaskExecutor(helper);

  const sourceFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "source-floorplan-gpt.png",
    "source-floorplan-gpt-content",
  );

  const createResult = await executionsService.createExecution(createAIFloorplanColorizeRequest({
    userId: "user-a",
    workflowId: `${TEST_WORKFLOW_ID}-gpt`,
    nodeType: "aiFloorplanColorize",
    taskType: "floorplan-colorize",
    executionMode: "legacy-grouped-task",
    nodeId: "node-floorplan-colorize-gpt",
    nodeTitle: "Floorplan Colorize GPT",
    model: "gpt-image-2-vip",
    groups: [
      {
        groupId: "group-1",
        sourceFileId,
        stylePreset: "photoreal-render",
        imageSize: "4K",
        aspectRatio: "4:5",
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
  assert.equal(providerCalls[0]?.size, "2560x3216");

  const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
  const startEvent = events.find((event) => event.eventType === "step_final_started");
  assert.deepEqual(startEvent?.payload, {
    sourceFileId,
    model: "gpt-image-2-vip",
    imageSize: "4K",
    aspectRatio: "4:5",
    resolvedSize: "2560x3216",
    stylePreset: "photoreal-render",
    promptVersion: AI_FLOORPLAN_COLORIZE_PROMPT_VERSION,
  });
}

async function runInvalidStyleScenario(rootDir: string): Promise<void> {
  const filesRepository = new FilesRepository(rootDir);
  const executionsRepository = new ExecutionsRepository(rootDir);
  const storageService = new StorageService(new LocalStorageAdapter(rootDir));

  const helper = new SingleImageGenerateHelper(
    executionsRepository,
    filesRepository,
    {
      async generateImage() {
        return {
          imageBase64: Buffer.from("noop").toString("base64"),
          mimeType: "image/png",
        };
      },
    },
    storageService,
  );
  const executor = new AIFloorplanColorizeTaskExecutor(helper);

  await assert.rejects(
    executor.execute({
      runId: "run-invalid-style",
      task: {
        id: "task-invalid-style",
        runId: "run-invalid-style",
        taskNo: "TASK-INVALID",
        nodeType: "aiFloorplanColorize",
        taskType: "floorplan-colorize",
        provider: "laozhang",
        status: "queued",
        currentStep: null,
        currentAttemptNo: 1,
        retryCount: 0,
        maxRetries: 2,
        groupOrder: 1,
        userId: "user-a",
        workflowId: "workflow-invalid-style",
        projectId: null,
        nodeId: "node-invalid-style",
        nodeTitle: "Invalid Style",
        groupId: "group-invalid-style",
        model: "gemini-3-pro-image-preview",
        input: {
          sourceFileId: "file-1",
          stylePreset: "warm",
          imageSize: "1K",
          aspectRatio: "1:1",
        },
        resultFileId: null,
        claimedBy: null,
        claimedAt: null,
        leaseUntil: null,
        heartbeatAt: null,
        attemptStartedAt: null,
        whiteModelFileId: null,
        styleReferenceFileId: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    }),
    /INVALID_AI_FLOORPLAN_COLORIZE_STYLE_PRESET/,
  );
}

void run();
