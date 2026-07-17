import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_FLOORPLAN_COLORIZE_DEFAULT_MODEL,
  AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET,
  AI_FLOORPLAN_COLORIZE_STYLE_PROMPTS,
} from "../shared/src/index.ts";
import type {
  AIFloorplanColorizeCreateExecutionRequest,
  CreateExecutionRequest,
} from "../shared/src/types/api/executions.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import {
  buildCreateExecutionStoreInput,
  validateExecutionCreateRequest,
} from "../api/src/modules/executions/execution-node.registry.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { createAIFloorplanColorizeRequest } from "./helpers/execution-request.fixture.ts";

const TEST_WORKFLOW_ID = "workflow-ai-floorplan-colorize-create";

function assertAIFloorplanColorizeRequest(
  request: CreateExecutionRequest,
): asserts request is AIFloorplanColorizeCreateExecutionRequest {
  assert.equal(request.taskType, "floorplan-colorize");
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
    nodeType: "aiFloorplanColorize",
    taskType: "floorplan-colorize",
    executionMode: "legacy-grouped-task",
    nodeId: " node-floorplan ",
    nodeTitle: " AI Floorplan Colorize ",
    model: "gpt-image-2-vip",
    groups: [
      {
        groupId: " group-1 ",
        sourceFileId: " file-source-1 ",
        imageSize: "2K",
        aspectRatio: "4:3",
      },
    ],
  });
  assertAIFloorplanColorizeRequest(validated);

  assert.equal(validated.nodeType, "aiFloorplanColorize");
  assert.equal(validated.taskType, "floorplan-colorize");
  assert.equal(validated.executionMode, "legacy-grouped-task");
  assert.equal(validated.nodeId, "node-floorplan");
  assert.equal(validated.nodeTitle, "AI Floorplan Colorize");
  assert.equal(validated.model, "gpt-image-2-vip");
  assert.equal(validated.groups[0]?.groupId, "group-1");
  assert.equal(validated.groups[0]?.sourceFileId, "file-source-1");
  assert.equal(validated.groups[0]?.stylePreset, AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET);
  assert.equal(validated.groups[0]?.imageSize, "2K");
  assert.equal(validated.groups[0]?.aspectRatio, "4:3");

  const storeInput = buildCreateExecutionStoreInput(validated);

  assert.equal(storeInput.run.nodeType, "aiFloorplanColorize");
  assert.equal(storeInput.run.taskType, "floorplan-colorize");
  assert.equal(storeInput.run.userId, null);
  assert.equal(storeInput.run.workflowId, TEST_WORKFLOW_ID);
  assert.equal(storeInput.tasks.length, 1);
  assert.equal(storeInput.tasks[0]?.workflowId, TEST_WORKFLOW_ID);
  assert.equal(storeInput.tasks[0]?.model, "gpt-image-2-vip");
  assert.deepEqual(storeInput.tasks[0]?.input, {
    model: "gpt-image-2-vip",
    inputFileId: "file-source-1",
    sourceFileId: "file-source-1",
    stylePreset: AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET,
    imageSize: "2K",
    aspectRatio: "4:3",
  });

  const validatedWithDefaults = validateExecutionCreateRequest({
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiFloorplanColorize",
    taskType: "floorplan-colorize",
    executionMode: "legacy-grouped-task",
    groups: [
      {
        groupId: "group-1",
        sourceFileId: "file-source-2",
      },
    ],
  });
  assertAIFloorplanColorizeRequest(validatedWithDefaults);

  assert.equal(validatedWithDefaults.model, AI_FLOORPLAN_COLORIZE_DEFAULT_MODEL);
  assert.equal(validatedWithDefaults.groups[0]?.stylePreset, AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET);
  assert.equal(Object.prototype.hasOwnProperty.call(validatedWithDefaults.groups[0] ?? {}, "imageSize"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(validatedWithDefaults.groups[0] ?? {}, "aspectRatio"), false);
  assert.equal(
    AI_FLOORPLAN_COLORIZE_STYLE_PROMPTS[
      validatedWithDefaults.groups[0]!.stylePreset!
    ].length > 0,
    true,
  );

  const validatedWithExplicitStyle = validateExecutionCreateRequest({
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiFloorplanColorize",
    taskType: "floorplan-colorize",
    executionMode: "legacy-grouped-task",
    model: "gemini-3-pro-image-preview",
    groups: [
      {
        groupId: "group-2",
        sourceFileId: "file-source-4",
        stylePreset: "photoreal-render",
      },
    ],
  });
  assertAIFloorplanColorizeRequest(validatedWithExplicitStyle);

  assert.equal(validatedWithExplicitStyle.groups[0]?.stylePreset, "photoreal-render");

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiFloorplanColorize",
      taskType: "floorplan-colorize",
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
      nodeType: "aiFloorplanColorize",
      taskType: "floorplan-colorize",
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
      nodeType: "aiFloorplanColorize",
      taskType: "floorplan-colorize",
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
      nodeType: "aiFloorplanColorize",
      taskType: "floorplan-colorize",
      executionMode: "legacy-grouped-task",
      groups: [
        {
          groupId: "group-1",
          sourceFileId: "file-source-5",
          stylePreset: "warm",
        },
      ],
    } as never);
  }, /INVALID_STYLE_PRESET:0/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiFloorplanColorize",
      taskType: "floorplan-colorize",
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
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-floorplan-create-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);

    const sourceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "floorplan-source.png",
      "floorplan-source-content",
    );

    const result = await executionsService.createExecution(createAIFloorplanColorizeRequest({
      userId: "user-a",
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiFloorplanColorize",
      taskType: "floorplan-colorize",
      executionMode: "legacy-grouped-task",
      nodeId: "node-floorplan-colorize",
      nodeTitle: "AI Floorplan Colorize",
      model: "gpt-image-2-vip",
      groups: [
        {
          groupId: "group-1",
          sourceFileId,
          imageSize: "2K",
          aspectRatio: "3:4",
        },
      ],
    }));

    assert.ok(result.runId);
    assert.equal(result.status, "queued");
    assert.equal(result.nodeType, "aiFloorplanColorize");
    assert.equal(result.taskType, "floorplan-colorize");
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0]?.groupId, "group-1");
    assert.equal(result.tasks[0]?.groupOrder, 1);

    const task = await executionsRepository.getTaskById(result.tasks[0]!.taskId);

    assert.ok(task);
    assert.equal(task?.nodeType, "aiFloorplanColorize");
    assert.equal(task?.taskType, "floorplan-colorize");
    assert.equal(task?.model, "gpt-image-2-vip");
    assert.deepEqual(task?.input, {
      model: "gpt-image-2-vip",
      inputFileId: sourceFileId,
      sourceFileId,
      stylePreset: AI_FLOORPLAN_COLORIZE_DEFAULT_STYLE_PRESET,
      imageSize: "2K",
      aspectRatio: "3:4",
    });
    assert.equal(task?.whiteModelFileId, null);
    assert.equal(task?.styleReferenceFileId, null);

    const explicitStyleResult = await executionsService.createExecution(createAIFloorplanColorizeRequest({
      userId: "user-a",
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiFloorplanColorize",
      taskType: "floorplan-colorize",
      executionMode: "legacy-grouped-task",
      nodeId: "node-floorplan-colorize-2",
      nodeTitle: "AI Floorplan Colorize 2",
      model: "gemini-3-pro-image-preview",
      groups: [
        {
          groupId: "group-2",
          sourceFileId,
          stylePreset: "photoreal-render",
        },
      ],
    }));

    const explicitTask = await executionsRepository.getTaskById(explicitStyleResult.tasks[0]!.taskId);
    const explicitRun = await executionsRepository.getExecutionRun(explicitStyleResult.runId);
    assert.ok(explicitTask?.input);
    assert.equal(explicitTask?.input.model, "gemini-3-pro-image-preview");
    assert.equal(explicitTask?.input.stylePreset, "photoreal-render");
    assert.equal(
      (explicitRun?.requestPayload as AIFloorplanColorizeCreateExecutionRequest | null)?.model,
      "gemini-3-pro-image-preview",
    );

    await assert.rejects(() => {
      return executionsService.createExecution(createAIFloorplanColorizeRequest({
        userId: "user-a",
        workflowId: TEST_WORKFLOW_ID,
        nodeType: "aiFloorplanColorize",
        taskType: "floorplan-colorize",
        executionMode: "legacy-grouped-task",
        nodeId: "node-floorplan-colorize",
        nodeTitle: "AI Floorplan Colorize",
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
