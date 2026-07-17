import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  WHITE_MODEL_RENDER_DEFAULT_MODEL,
} from "../shared/src/index.ts";
import type {
  CreateExecutionRequest,
  WhiteModelRenderCreateExecutionRequest,
} from "../shared/src/types/api/executions.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import {
  buildCreateExecutionStoreInput,
  validateExecutionCreateRequest,
} from "../api/src/modules/executions/execution-node.registry.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { createWhiteModelRenderRequest } from "./helpers/execution-request.fixture.ts";

const TEST_WORKFLOW_ID = "workflow-white-model-render-create";

function assertWhiteModelRenderRequest(
  request: CreateExecutionRequest,
): asserts request is WhiteModelRenderCreateExecutionRequest {
  assert.equal(request.taskType, "model-render-transfer");
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
    nodeType: "aiModelRenderTransfer",
    taskType: "model-render-transfer",
    executionMode: "legacy-grouped-task",
    nodeId: " node-white-model ",
    nodeTitle: " White Model Render ",
    model: "gpt-image-2-vip",
    imageSize: "2K",
    aspectRatio: "16:9",
    groups: [
      {
        groupId: " group-1 ",
        whiteModelFileId: " white-model-file-1 ",
        styleReferenceFileId: " style-reference-file-1 ",
      },
    ],
  });
  assertWhiteModelRenderRequest(validated);

  assert.equal(validated.nodeType, "aiModelRenderTransfer");
  assert.equal(validated.taskType, "model-render-transfer");
  assert.equal(validated.executionMode, "legacy-grouped-task");
  assert.equal(validated.nodeId, "node-white-model");
  assert.equal(validated.nodeTitle, "White Model Render");
  assert.equal(validated.model, "gpt-image-2-vip");
  assert.equal(validated.imageSize, "2K");
  assert.equal(validated.aspectRatio, "16:9");
  assert.equal(validated.groups[0]?.groupId, "group-1");
  assert.equal(validated.groups[0]?.whiteModelFileId, "white-model-file-1");
  assert.equal(validated.groups[0]?.styleReferenceFileId, "style-reference-file-1");

  const storeInput = buildCreateExecutionStoreInput(validated);

  assert.equal(storeInput.run.nodeType, "aiModelRenderTransfer");
  assert.equal(storeInput.run.taskType, "model-render-transfer");
  assert.equal(storeInput.run.userId, null);
  assert.equal(storeInput.run.workflowId, TEST_WORKFLOW_ID);
  assert.equal(storeInput.tasks.length, 1);
  assert.equal(storeInput.tasks[0]?.workflowId, TEST_WORKFLOW_ID);
  assert.equal(storeInput.tasks[0]?.model, "gpt-image-2-vip");
  assert.deepEqual(storeInput.tasks[0]?.input, {
    model: "gpt-image-2-vip",
    imageSize: "2K",
    aspectRatio: "16:9",
    whiteModelFileId: "white-model-file-1",
    styleReferenceFileId: "style-reference-file-1",
  });

  const validatedWithDefaults = validateExecutionCreateRequest({
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiModelRenderTransfer",
    taskType: "model-render-transfer",
    executionMode: "legacy-grouped-task",
    groups: [
      {
        groupId: "group-1",
        whiteModelFileId: "white-model-file-2",
        styleReferenceFileId: "style-reference-file-2",
      },
    ],
  });
  assertWhiteModelRenderRequest(validatedWithDefaults);

  assert.equal(validatedWithDefaults.model, WHITE_MODEL_RENDER_DEFAULT_MODEL);
  assert.equal(Object.prototype.hasOwnProperty.call(validatedWithDefaults, "imageSize"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(validatedWithDefaults, "aspectRatio"), false);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiModelRenderTransfer",
      taskType: "model-render-transfer",
      executionMode: "legacy-grouped-task",
      model: "unsupported-model",
      groups: [
        {
          groupId: "group-1",
          whiteModelFileId: "white-model-file-1",
          styleReferenceFileId: "style-reference-file-1",
        },
      ],
    } as never);
  }, /INVALID_MODEL/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiModelRenderTransfer",
      taskType: "model-render-transfer",
      executionMode: "legacy-grouped-task",
      imageSize: "8K",
      groups: [
        {
          groupId: "group-1",
          whiteModelFileId: "white-model-file-1",
          styleReferenceFileId: "style-reference-file-1",
        },
      ],
    } as never);
  }, /INVALID_IMAGE_SIZE:request/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiModelRenderTransfer",
      taskType: "model-render-transfer",
      executionMode: "legacy-grouped-task",
      aspectRatio: "7:5",
      groups: [
        {
          groupId: "group-1",
          whiteModelFileId: "white-model-file-1",
          styleReferenceFileId: "style-reference-file-1",
        },
      ],
    } as never);
  }, /INVALID_ASPECT_RATIO:request/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiModelRenderTransfer",
      taskType: "model-render-transfer",
      executionMode: "legacy-grouped-task",
      model: "gpt-image-2-vip",
      aspectRatio: "auto",
      groups: [
        {
          groupId: "group-1",
          whiteModelFileId: "white-model-file-1",
          styleReferenceFileId: "style-reference-file-1",
        },
      ],
    } as never);
  }, /INVALID_ASPECT_RATIO:request/);
}

async function runCreateExecutionScenarios(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-white-model-create-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);

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

    const result = await executionsService.createExecution(createWhiteModelRenderRequest({
      userId: "user-a",
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiModelRenderTransfer",
      taskType: "model-render-transfer",
      executionMode: "legacy-grouped-task",
      nodeId: "node-white-model",
      nodeTitle: "White Model Render",
      model: "gpt-image-2-vip",
      imageSize: "4K",
      aspectRatio: "9:16",
      groups: [
        {
          groupId: "group-1",
          whiteModelFileId,
          styleReferenceFileId,
        },
      ],
    }));

    assert.ok(result.runId);
    assert.equal(result.status, "queued");
    assert.equal(result.nodeType, "aiModelRenderTransfer");
    assert.equal(result.taskType, "model-render-transfer");
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0]?.groupId, "group-1");
    assert.equal(result.tasks[0]?.groupOrder, 1);

    const task = await executionsRepository.getTaskById(result.tasks[0]!.taskId);

    assert.ok(task);
    assert.equal(task?.nodeType, "aiModelRenderTransfer");
    assert.equal(task?.taskType, "model-render-transfer");
    assert.equal(task?.model, "gpt-image-2-vip");
    assert.deepEqual(task?.input, {
      model: "gpt-image-2-vip",
      imageSize: "4K",
      aspectRatio: "9:16",
      whiteModelFileId,
      styleReferenceFileId,
    });
    assert.equal(task?.whiteModelFileId, whiteModelFileId);
    assert.equal(task?.styleReferenceFileId, styleReferenceFileId);

    await assert.rejects(() => {
      return executionsService.createExecution(createWhiteModelRenderRequest({
        userId: "user-a",
        workflowId: TEST_WORKFLOW_ID,
        nodeType: "aiModelRenderTransfer",
        taskType: "model-render-transfer",
        executionMode: "legacy-grouped-task",
        nodeId: "node-white-model",
        nodeTitle: "White Model Render",
        groups: [
          {
            groupId: "group-2",
            whiteModelFileId: "file-missing",
            styleReferenceFileId,
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
