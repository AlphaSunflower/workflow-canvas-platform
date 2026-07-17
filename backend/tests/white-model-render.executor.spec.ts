import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { IntermediateArtifactRepository } from "../worker/src/modules/intermediate/intermediate-artifact.repository.ts";
import { IntermediateArtifactService } from "../worker/src/modules/intermediate/intermediate-artifact.service.ts";
import { IntermediateLockService } from "../worker/src/modules/intermediate/intermediate-lock.service.ts";
import { WhiteModelRenderExecutor } from "../worker/src/modules/executors/white-model-render.executor.ts";
import { LocalStorageAdapter } from "../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../worker/src/modules/storage/storage.service.ts";
import { createWhiteModelRenderRequest } from "./helpers/execution-request.fixture.ts";

const TEST_WORKFLOW_ID = "workflow-white-model-render-executor";

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
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "white-model-executor-test-"));

  try {
    await runGeminiScenario(rootDir);
    await runGptScenario(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

function createExecutor(rootDir: string, providerCalls: Array<Record<string, unknown>>) {
  const filesRepository = new FilesRepository(rootDir);
  const executionsRepository = new ExecutionsRepository(rootDir);
  const executionsService = ExecutionsService.fromRoot(rootDir);
  const intermediateArtifactService = new IntermediateArtifactService(
    new IntermediateArtifactRepository(rootDir),
    filesRepository,
    new IntermediateLockService(),
  );
  const storageService = new StorageService(new LocalStorageAdapter(rootDir));
  const providerClient = {
    async generateImage(input: {
      prompt: string;
      model?: string;
      imageSize?: string;
      aspectRatio?: string;
      size?: string;
      images: Array<{
        mimeType: string;
        dataBase64: string;
      }>;
      snapshotLabel?: string;
    }) {
      providerCalls.push({
        model: input.model,
        imageSize: input.imageSize,
        aspectRatio: input.aspectRatio,
        size: input.size,
        snapshotLabel: input.snapshotLabel,
        imagesText: input.images.map((item) =>
          Buffer.from(item.dataBase64, "base64").toString("utf8")
        ),
      });

      if (input.snapshotLabel?.endsWith("-lineart")) {
        return {
          imageBase64: Buffer.from("lineart-result").toString("base64"),
          mimeType: "image/png",
        };
      }

      if (input.snapshotLabel?.endsWith("-depth")) {
        return {
          imageBase64: Buffer.from("depth-result").toString("base64"),
          mimeType: "image/png",
        };
      }

      return {
        imageBase64: Buffer.from("final-result").toString("base64"),
        mimeType: "image/png",
      };
    },
  };

  return {
    filesRepository,
    executionsRepository,
    executionsService,
    executor: new WhiteModelRenderExecutor(
      executionsRepository,
      filesRepository,
      intermediateArtifactService,
      providerClient,
      storageService,
    ),
  };
}

async function runGeminiScenario(rootDir: string): Promise<void> {
  const providerCalls: Array<Record<string, unknown>> = [];
  const {
    filesRepository,
    executionsRepository,
    executionsService,
    executor,
  } = createExecutor(rootDir, providerCalls);

  const whiteModelFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "white-model.png",
    "white-model-content",
  );
  const styleReferenceFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "style-reference.png",
    "style-reference-content",
  );

  const createResult = await executionsService.createExecution(createWhiteModelRenderRequest({
    userId: "user-a",
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiModelRenderTransfer",
    taskType: "model-render-transfer",
    executionMode: "legacy-grouped-task",
    nodeId: "node-white-model",
    nodeTitle: "white-model-render",
    model: "gemini-3-pro-image-preview",
    imageSize: "2K",
    aspectRatio: "3:4",
    groups: [
      {
        groupId: "group-1",
        whiteModelFileId,
        styleReferenceFileId,
      },
    ],
  }));

  await executionsRepository.claimQueuedTasks(1);

  const result = await executor.execute({
    userId: "user-a",
    runId: createResult.runId,
    taskId: createResult.tasks[0]!.taskId,
    taskNo: createResult.tasks[0]!.taskNo,
    whiteModelFileId,
    styleReferenceFileId,
    model: "gemini-3-pro-image-preview",
    imageSize: "2K",
    aspectRatio: "3:4",
  });

  await executionsRepository.markTaskCompleted(createResult.tasks[0]!.taskId);

  assert.ok(result.resultFileId);
  assert.equal(providerCalls.length, 3);
  assert.equal(providerCalls[0]?.model, "gemini-3-pro-image-preview");
  assert.equal(providerCalls[0]?.imageSize, "2K");
  assert.equal(providerCalls[0]?.aspectRatio, "3:4");
  assert.equal(providerCalls[0]?.size, undefined);
  assert.equal(providerCalls[2]?.snapshotLabel, `${createResult.tasks[0]!.taskNo}-final`);
  assert.deepEqual(providerCalls[2]?.imagesText, [
    "style-reference-content",
    "lineart-result",
    "depth-result",
    "white-model-content",
  ]);

  const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
  const finalStartedEvent = events.find((event) => event.eventType === "step_final_started");
  assert.equal(finalStartedEvent?.payload?.model, "gemini-3-pro-image-preview");
  assert.equal(finalStartedEvent?.payload?.imageSize, "2K");
  assert.equal(finalStartedEvent?.payload?.aspectRatio, "3:4");
  assert.equal(finalStartedEvent?.payload?.resolvedSize, null);
}

async function runGptScenario(rootDir: string): Promise<void> {
  const providerCalls: Array<Record<string, unknown>> = [];
  const {
    filesRepository,
    executionsRepository,
    executionsService,
    executor,
  } = createExecutor(rootDir, providerCalls);

  const whiteModelFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "white-model-gpt.png",
    "white-model-gpt-content",
  );
  const styleReferenceFileId = await registerReadyFile(
    filesRepository,
    "user-a",
    "style-reference-gpt.png",
    "style-reference-gpt-content",
  );

  const createResult = await executionsService.createExecution(createWhiteModelRenderRequest({
    userId: "user-a",
    workflowId: `${TEST_WORKFLOW_ID}-gpt`,
    nodeType: "aiModelRenderTransfer",
    taskType: "model-render-transfer",
    executionMode: "legacy-grouped-task",
    nodeId: "node-white-model-gpt",
    nodeTitle: "white-model-render-gpt",
    model: "gpt-image-2-vip",
    imageSize: "4K",
    aspectRatio: "4:5",
    groups: [
      {
        groupId: "group-1",
        whiteModelFileId,
        styleReferenceFileId,
      },
    ],
  }));

  await executionsRepository.claimQueuedTasks(1);

  await executor.execute({
    userId: "user-a",
    runId: createResult.runId,
    taskId: createResult.tasks[0]!.taskId,
    taskNo: createResult.tasks[0]!.taskNo,
    whiteModelFileId,
    styleReferenceFileId,
    model: "gpt-image-2-vip",
    imageSize: "4K",
    aspectRatio: "4:5",
  });

  assert.equal(providerCalls.length, 3);
  assert.equal(providerCalls[0]?.model, "gpt-image-2-vip");
  assert.equal(providerCalls[0]?.imageSize, undefined);
  assert.equal(providerCalls[0]?.aspectRatio, undefined);
  assert.equal(providerCalls[0]?.size, "2560x3216");
  assert.equal(providerCalls[1]?.size, "2560x3216");
  assert.equal(providerCalls[2]?.size, "2560x3216");

  const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
  const finalStartedEvent = events.find((event) => event.eventType === "step_final_started");
  assert.equal(finalStartedEvent?.payload?.model, "gpt-image-2-vip");
  assert.equal(finalStartedEvent?.payload?.imageSize, "4K");
  assert.equal(finalStartedEvent?.payload?.aspectRatio, "4:5");
  assert.equal(finalStartedEvent?.payload?.resolvedSize, "2560x3216");
}

void run();
