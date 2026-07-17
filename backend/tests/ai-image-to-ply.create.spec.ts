import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_IMAGE_TO_PLY_INPUT_FIELD_NAME,
  AI_IMAGE_TO_PLY_INPUT_NODE_ID,
  AI_IMAGE_TO_PLY_OUTPUT_FILE_TYPE,
  AI_IMAGE_TO_PLY_WORKFLOW_ID,
  AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
} from "../shared/src/index.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import {
  buildCreateExecutionStoreInput,
  validateExecutionCreateRequest,
} from "../api/src/modules/executions/execution-node.registry.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { createAIImageToPlyRequest } from "./helpers/execution-request.fixture.ts";

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
    workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
    nodeType: "aiImageToPly",
    taskType: "image-to-ply",
    executionMode: "legacy-grouped-task",
    nodeId: " node-image-to-ply ",
    nodeTitle: " Image To PLY ",
    groups: [
      {
        groupId: " group-1 ",
        sourceFileId: " file-source-1 ",
      },
    ],
  });

  assert.equal(validated.nodeType, "aiImageToPly");
  assert.equal(validated.taskType, "image-to-ply");
  assert.equal(validated.executionMode, "legacy-grouped-task");
  assert.equal(validated.nodeId, "node-image-to-ply");
  assert.equal(validated.nodeTitle, "Image To PLY");
  assert.equal(validated.groups[0]?.groupId, "group-1");
  assert.equal(validated.groups[0]?.sourceFileId, "file-source-1");

  const storeInput = buildCreateExecutionStoreInput(validated);

  assert.equal(storeInput.run.nodeType, "aiImageToPly");
  assert.equal(storeInput.run.taskType, "image-to-ply");
  assert.equal(storeInput.run.provider, "runninghub");
  assert.equal(storeInput.run.userId, null);
  assert.equal(storeInput.run.workflowId, AI_IMAGE_TO_PLY_WORKFLOW_ID);
  assert.equal(storeInput.tasks.length, 1);
  assert.equal(storeInput.tasks[0]?.provider, "runninghub");
  assert.equal(storeInput.tasks[0]?.model, null);
  assert.equal(storeInput.tasks[0]?.workflowId, AI_IMAGE_TO_PLY_WORKFLOW_ID);
  assert.deepEqual(storeInput.tasks[0]?.input, {
    inputFileId: "file-source-1",
    sourceFileId: "file-source-1",
    workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
    workflowTemplateKey: AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
    workflowInputNodeId: AI_IMAGE_TO_PLY_INPUT_NODE_ID,
    workflowInputFieldName: AI_IMAGE_TO_PLY_INPUT_FIELD_NAME,
    outputFileType: AI_IMAGE_TO_PLY_OUTPUT_FILE_TYPE,
  });

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
      nodeType: "aiImageToPly",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      groups: [
        {
          groupId: "group-1",
          sourceFileId: "file-source-1",
        },
      ],
    } as never);
  }, /INVALID_TASK_TYPE/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
      nodeType: "aiImageToPly",
      taskType: "image-to-ply",
      executionMode: "mock",
      groups: [
        {
          groupId: "group-1",
          sourceFileId: "file-source-1",
        },
      ],
    } as never);
  }, /INVALID_EXECUTION_MODE/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
      nodeType: "aiImageToPly",
      taskType: "image-to-ply",
      executionMode: "legacy-grouped-task",
      groups: [],
    } as never);
  }, /INVALID_GROUPS/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
      nodeType: "aiImageToPly",
      taskType: "image-to-ply",
      executionMode: "legacy-grouped-task",
      groups: [
        {
          groupId: "group-1",
          sourceFileId: "   ",
        },
      ],
    } as never);
  }, /INVALID_INPUT_FILE_ID:0/);
}

async function runCreateExecutionScenarios(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-ai-image-to-ply-create-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);

    const sourceFileId1 = await registerReadyFile(
      filesRepository,
      "user-a",
      "source-image-1.png",
      "source-image-content-1",
    );
    const sourceFileId2 = await registerReadyFile(
      filesRepository,
      "user-a",
      "source-image-2.png",
      "source-image-content-2",
    );

    const result = await executionsService.createExecution(createAIImageToPlyRequest({
      userId: "user-a",
      workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
      nodeType: "aiImageToPly",
      taskType: "image-to-ply",
      executionMode: "legacy-grouped-task",
      nodeId: "node-image-to-ply",
      nodeTitle: "Image To PLY",
      groups: [
        {
          groupId: "group-1",
          sourceFileId: sourceFileId1,
        },
        {
          groupId: "group-2",
          sourceFileId: sourceFileId2,
        },
      ],
    }));

    assert.ok(result.runId);
    assert.equal(result.status, "queued");
    assert.equal(result.nodeType, "aiImageToPly");
    assert.equal(result.taskType, "image-to-ply");
    assert.equal(result.tasks.length, 2);
    assert.equal(result.tasks[0]?.groupId, "group-1");
    assert.equal(result.tasks[0]?.groupOrder, 1);
    assert.equal(result.tasks[1]?.groupId, "group-2");
    assert.equal(result.tasks[1]?.groupOrder, 2);

    const task1 = await executionsRepository.getTaskById(result.tasks[0]!.taskId);
    const task2 = await executionsRepository.getTaskById(result.tasks[1]!.taskId);

    assert.ok(task1);
    assert.ok(task2);
    assert.equal(task1?.nodeType, "aiImageToPly");
    assert.equal(task1?.taskType, "image-to-ply");
    assert.equal(task1?.provider, "runninghub");
    assert.equal(task1?.model, null);
    assert.deepEqual(task1?.input, {
      inputFileId: sourceFileId1,
      sourceFileId: sourceFileId1,
      workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
      workflowTemplateKey: AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
      workflowInputNodeId: AI_IMAGE_TO_PLY_INPUT_NODE_ID,
      workflowInputFieldName: AI_IMAGE_TO_PLY_INPUT_FIELD_NAME,
      outputFileType: AI_IMAGE_TO_PLY_OUTPUT_FILE_TYPE,
    });
    assert.deepEqual(task2?.input, {
      inputFileId: sourceFileId2,
      sourceFileId: sourceFileId2,
      workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
      workflowTemplateKey: AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
      workflowInputNodeId: AI_IMAGE_TO_PLY_INPUT_NODE_ID,
      workflowInputFieldName: AI_IMAGE_TO_PLY_INPUT_FIELD_NAME,
      outputFileType: AI_IMAGE_TO_PLY_OUTPUT_FILE_TYPE,
    });

    await assert.rejects(() => {
      return executionsService.createExecution(createAIImageToPlyRequest({
        userId: "user-a",
        workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
        nodeType: "aiImageToPly",
        taskType: "image-to-ply",
        executionMode: "legacy-grouped-task",
        nodeId: "node-image-to-ply",
        nodeTitle: "Image To PLY",
        groups: [
          {
            groupId: "group-3",
            sourceFileId: "file-missing",
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
