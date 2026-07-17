import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_IMAGE_HD_DEFAULT_MODEL,
} from "../shared/src/index.ts";
import type {
  AIImageHdCreateExecutionRequest,
  CreateExecutionRequest,
} from "../shared/src/types/api/executions.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import {
  buildCreateExecutionStoreInput,
  validateExecutionCreateRequest,
} from "../api/src/modules/executions/execution-node.registry.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { createAIImageHdRequest } from "./helpers/execution-request.fixture.ts";

const TEST_WORKFLOW_ID = "workflow-ai-image-hd-create";

function assertAIImageHdRequest(
  request: CreateExecutionRequest,
): asserts request is AIImageHdCreateExecutionRequest {
  assert.equal(request.taskType, "image-hd");
}

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

function runValidationScenarios(): void {
  const validated = validateExecutionCreateRequest({
    userId: " user-a ",
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiImageHd",
    taskType: "image-hd",
    executionMode: "legacy-grouped-task",
    nodeId: " node-hd ",
    nodeTitle: " AI Image HD ",
    model: "gpt-image-2-vip",
    groups: [
      {
        groupId: " group-1 ",
        sourceFileId: " file-source-1 ",
        imageSize: "2K",
        aspectRatio: "16:9",
      },
    ],
  });
  assertAIImageHdRequest(validated);

  assert.equal(validated.nodeType, "aiImageHd");
  assert.equal(validated.taskType, "image-hd");
  assert.equal(validated.executionMode, "legacy-grouped-task");
  assert.equal(validated.nodeId, "node-hd");
  assert.equal(validated.nodeTitle, "AI Image HD");
  assert.equal(validated.model, "gpt-image-2-vip");
  assert.equal(validated.groups[0]?.groupId, "group-1");
  assert.equal(validated.groups[0]?.sourceFileId, "file-source-1");
  assert.equal(validated.groups[0]?.imageSize, "2K");
  assert.equal(validated.groups[0]?.aspectRatio, "16:9");

  const storeInput = buildCreateExecutionStoreInput(validated);

  assert.equal(storeInput.run.nodeType, "aiImageHd");
  assert.equal(storeInput.run.taskType, "image-hd");
  assert.equal(storeInput.run.userId, null);
  assert.equal(storeInput.run.workflowId, TEST_WORKFLOW_ID);
  assert.equal(storeInput.tasks.length, 1);
  assert.equal(storeInput.tasks[0]?.workflowId, TEST_WORKFLOW_ID);
  assert.equal(storeInput.tasks[0]?.model, "gpt-image-2-vip");
  assert.deepEqual(storeInput.tasks[0]?.input, {
    model: "gpt-image-2-vip",
    inputFileId: "file-source-1",
    sourceFileId: "file-source-1",
    imageSize: "2K",
    aspectRatio: "16:9",
  });

  const validatedWithDefaults = validateExecutionCreateRequest({
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiImageHd",
    taskType: "image-hd",
    executionMode: "legacy-grouped-task",
    groups: [
      {
        groupId: "group-1",
        sourceFileId: "file-source-2",
      },
    ],
  });
  assertAIImageHdRequest(validatedWithDefaults);

  assert.equal(validatedWithDefaults.model, AI_IMAGE_HD_DEFAULT_MODEL);
  assert.equal(Object.prototype.hasOwnProperty.call(validatedWithDefaults.groups[0] ?? {}, "imageSize"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(validatedWithDefaults.groups[0] ?? {}, "aspectRatio"), false);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageHd",
      taskType: "image-hd",
      executionMode: "legacy-grouped-task",
      model: "unsupported-model",
      groups: [
        {
          groupId: "group-1",
          sourceFileId: "file-source-1",
        },
      ],
    } as never);
  }, /INVALID_MODEL/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageHd",
      taskType: "image-hd",
      executionMode: "legacy-grouped-task",
      groups: [
        {
          groupId: "group-1",
          sourceFileId: "file-source-3",
          imageSize: "8K",
        },
      ],
    } as never);
  }, /INVALID_IMAGE_SIZE:0/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageHd",
      taskType: "image-hd",
      executionMode: "legacy-grouped-task",
      groups: [
        {
          groupId: "group-1",
          sourceFileId: "file-source-3",
          aspectRatio: "7:5",
        },
      ],
    } as never);
  }, /INVALID_ASPECT_RATIO:0/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageHd",
      taskType: "image-hd",
      executionMode: "legacy-grouped-task",
      model: "gpt-image-2-vip",
      groups: [
        {
          groupId: "group-1",
          sourceFileId: "file-source-3",
          aspectRatio: "auto",
        },
      ],
    } as never);
  }, /INVALID_ASPECT_RATIO:0/);
}

async function runCreateExecutionScenarios(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-ai-image-hd-create-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);

    const sourceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "source-image.png",
      "source-image-content",
    );

    const result = await executionsService.createExecution(createAIImageHdRequest({
      userId: "user-a",
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageHd",
      taskType: "image-hd",
      executionMode: "legacy-grouped-task",
      nodeId: "node-image-hd",
      nodeTitle: "AI Image HD",
      model: "gpt-image-2-vip",
      groups: [
        {
          groupId: "group-1",
          sourceFileId,
          imageSize: "4K",
          aspectRatio: "9:16",
        },
      ],
    }));

    assert.ok(result.runId);
    assert.equal(result.status, "queued");
    assert.equal(result.nodeType, "aiImageHd");
    assert.equal(result.taskType, "image-hd");
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0]?.groupId, "group-1");
    assert.equal(result.tasks[0]?.groupOrder, 1);

    const task = await executionsRepository.getTaskById(result.tasks[0]!.taskId);

    assert.ok(task);
    assert.equal(task?.nodeType, "aiImageHd");
    assert.equal(task?.taskType, "image-hd");
    assert.equal(task?.model, "gpt-image-2-vip");
    assert.deepEqual(task?.input, {
      model: "gpt-image-2-vip",
      inputFileId: sourceFileId,
      sourceFileId,
      imageSize: "4K",
      aspectRatio: "9:16",
    });
    assert.equal(task?.whiteModelFileId, null);
    assert.equal(task?.styleReferenceFileId, null);

    await assert.rejects(() => {
      return executionsService.createExecution(createAIImageHdRequest({
        userId: "user-a",
        workflowId: TEST_WORKFLOW_ID,
        nodeType: "aiImageHd",
        taskType: "image-hd",
        executionMode: "legacy-grouped-task",
        nodeId: "node-image-hd",
        nodeTitle: "AI Image HD",
        groups: [
          {
            groupId: "group-2",
            sourceFileId: "file-missing",
            imageSize: "1K",
            aspectRatio: "auto",
          },
        ],
      }));
    }, /FILE_NOT_FOUND:file-missing/);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  runValidationScenarios();
  await runCreateExecutionScenarios();
}

void run();
