import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_IMAGE_INPAINT_DEFAULT_MASK_MODE,
  AI_IMAGE_INPAINT_DEFAULT_MODEL,
} from "../shared/src/index.ts";
import type {
  AIImageInpaintCreateExecutionRequest,
  CreateExecutionRequest,
} from "../shared/src/types/api/executions.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import {
  buildCreateExecutionStoreInput,
  collectExecutionInputFileIds,
  validateExecutionCreateRequest,
} from "../api/src/modules/executions/execution-node.registry.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionQueryService } from "../api/src/modules/executions/execution-query.service.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { createAIImageInpaintRequest } from "./helpers/execution-request.fixture.ts";

const TEST_WORKFLOW_ID = "workflow-ai-image-inpaint-create";

function assertAIImageInpaintRequest(
  request: CreateExecutionRequest,
): asserts request is AIImageInpaintCreateExecutionRequest {
  assert.equal(request.taskType, "image-inpaint");
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
    nodeType: "aiImageInpaint",
    taskType: "image-inpaint",
    executionMode: "legacy-grouped-task",
    nodeId: " node-inpaint ",
    nodeTitle: " AI Image Inpaint ",
    prompt: " replace the marked sofa ",
    model: "gpt-image-2-vip",
    imageSize: "2K",
    aspectRatio: "16:9",
    maskMode: "strong-mask",
    groups: [
      {
        groupId: " main ",
        sourceFileId: " source-file-1 ",
        maskFileId: " mask-file-1 ",
      },
    ],
  });
  assertAIImageInpaintRequest(validated);

  assert.equal(validated.nodeType, "aiImageInpaint");
  assert.equal(validated.taskType, "image-inpaint");
  assert.equal(validated.executionMode, "legacy-grouped-task");
  assert.equal(validated.nodeId, "node-inpaint");
  assert.equal(validated.nodeTitle, "AI Image Inpaint");
  assert.equal(validated.prompt, "replace the marked sofa");
  assert.equal(validated.model, "gpt-image-2-vip");
  assert.equal(validated.imageSize, "2K");
  assert.equal(validated.aspectRatio, "16:9");
  assert.equal(validated.maskMode, "strong-mask");
  assert.deepEqual(validated.groups, [
    {
      groupId: "main",
      sourceFileId: "source-file-1",
      maskFileId: "mask-file-1",
    },
  ]);
  assert.deepEqual(collectExecutionInputFileIds(validated), [
    "source-file-1",
    "mask-file-1",
  ]);

  const storeInput = buildCreateExecutionStoreInput(validated);

  assert.equal(storeInput.run.nodeType, "aiImageInpaint");
  assert.equal(storeInput.run.taskType, "image-inpaint");
  assert.equal(storeInput.run.userId, null);
  assert.equal(storeInput.run.workflowId, TEST_WORKFLOW_ID);
  assert.equal(storeInput.tasks.length, 1);
  assert.equal(storeInput.tasks[0]?.workflowId, TEST_WORKFLOW_ID);
  assert.equal(storeInput.tasks[0]?.model, "gpt-image-2-vip");
  assert.deepEqual(storeInput.tasks[0]?.input, {
    prompt: "replace the marked sofa",
    model: "gpt-image-2-vip",
    inputFileId: "source-file-1",
    sourceFileId: "source-file-1",
    maskFileId: "mask-file-1",
    maskMode: "strong-mask",
    imageSize: "2K",
    aspectRatio: "16:9",
  });

  const validatedWithDefaults = validateExecutionCreateRequest({
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiImageInpaint",
    taskType: "image-inpaint",
    executionMode: "legacy-grouped-task",
    prompt: "default inpaint prompt",
    groups: [
      {
        groupId: "main",
        sourceFileId: "source-file-2",
        maskFileId: "mask-file-2",
      },
    ],
  });
  assertAIImageInpaintRequest(validatedWithDefaults);

  assert.equal(validatedWithDefaults.model, AI_IMAGE_INPAINT_DEFAULT_MODEL);
  assert.equal(Object.prototype.hasOwnProperty.call(validatedWithDefaults, "imageSize"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(validatedWithDefaults, "aspectRatio"), false);
  assert.equal(validatedWithDefaults.maskMode, AI_IMAGE_INPAINT_DEFAULT_MASK_MODE);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "   ",
      groups: [
        {
          groupId: "main",
          sourceFileId: "source-file-1",
          maskFileId: "mask-file-1",
        },
      ],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_PROMPT/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      groups: [
        {
          groupId: "main",
          sourceFileId: "source-file-1",
          maskFileId: "mask-file-1",
        },
        {
          groupId: "extra",
          sourceFileId: "source-file-2",
          maskFileId: "mask-file-2",
        },
      ],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_GROUP_COUNT/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      groups: [
        {
          groupId: "main",
          sourceFileId: "   ",
          maskFileId: "mask-file-1",
        },
      ],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_SOURCE_FILE_ID:0/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      groups: [
        {
          groupId: "main",
          sourceFileId: "source-file-1",
          maskFileId: "   ",
        },
      ],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_MASK_FILE_ID:0/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      maskMode: "alpha-mask",
      groups: [
        {
          groupId: "main",
          sourceFileId: "source-file-1",
          maskFileId: "mask-file-1",
        },
      ],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_MASK_MODE/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      model: "unsupported-model",
      groups: [
        {
          groupId: "main",
          sourceFileId: "source-file-1",
          maskFileId: "mask-file-1",
        },
      ],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_MODEL/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      imageSize: "8K",
      groups: [
        {
          groupId: "main",
          sourceFileId: "source-file-1",
          maskFileId: "mask-file-1",
        },
      ],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_IMAGE_SIZE:request/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      aspectRatio: "7:5",
      groups: [
        {
          groupId: "main",
          sourceFileId: "source-file-1",
          maskFileId: "mask-file-1",
        },
      ],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_ASPECT_RATIO:request/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      model: "gpt-image-2-vip",
      aspectRatio: "auto",
      groups: [
        {
          groupId: "main",
          sourceFileId: "source-file-1",
          maskFileId: "mask-file-1",
        },
      ],
    } as never);
  }, /INVALID_AI_IMAGE_INPAINT_ASPECT_RATIO:request/);
}

async function runCreateExecutionScenarios(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-ai-image-inpaint-create-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);

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

    const result = await executionsService.createExecution(createAIImageInpaintRequest({
      userId: "user-a",
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageInpaint",
      taskType: "image-inpaint",
      executionMode: "legacy-grouped-task",
      nodeId: "node-image-inpaint",
      nodeTitle: "AI Image Inpaint",
      prompt: "node shared inpaint prompt",
      model: "gpt-image-2-vip",
      imageSize: "4K",
      aspectRatio: "9:16",
      maskMode: "strong-mask",
      groups: [
        {
          groupId: "main",
          sourceFileId,
          maskFileId,
        },
      ],
    }));

    assert.ok(result.runId);
    assert.equal(result.status, "queued");
    assert.equal(result.nodeType, "aiImageInpaint");
    assert.equal(result.taskType, "image-inpaint");
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0]?.groupId, "main");
    assert.equal(result.tasks[0]?.groupOrder, 1);

    const task = await executionsRepository.getTaskById(result.tasks[0]!.taskId);

    assert.ok(task);
    assert.equal(task?.nodeType, "aiImageInpaint");
    assert.equal(task?.taskType, "image-inpaint");
    assert.equal(task?.model, "gpt-image-2-vip");
    assert.deepEqual(task?.input, {
      prompt: "node shared inpaint prompt",
      model: "gpt-image-2-vip",
      inputFileId: sourceFileId,
      sourceFileId,
      maskFileId,
      maskMode: "strong-mask",
      imageSize: "4K",
      aspectRatio: "9:16",
    });

    const runDetail = await queryService.getExecutionRun(result.runId);
    const detailTask = runDetail?.tasks[0];

    assert.ok(detailTask);
    assert.equal(detailTask?.sourceFileId, sourceFileId);
    assert.equal(detailTask?.maskFileId, maskFileId);
    assert.equal(detailTask?.maskMode, "strong-mask");
    assert.equal(detailTask?.sourceFile?.fileId, sourceFileId);
    assert.equal(detailTask?.maskFile?.fileId, maskFileId);

    await assert.rejects(() => {
      return executionsService.createExecution(createAIImageInpaintRequest({
        userId: "user-a",
        workflowId: TEST_WORKFLOW_ID,
        nodeType: "aiImageInpaint",
        taskType: "image-inpaint",
        executionMode: "legacy-grouped-task",
        nodeId: "node-image-inpaint",
        nodeTitle: "AI Image Inpaint",
        prompt: "node shared inpaint prompt",
        groups: [
          {
            groupId: "main",
            sourceFileId,
            maskFileId: "file-missing-mask",
          },
        ],
      }));
    }, /FILE_NOT_FOUND:file-missing-mask/);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  runValidationScenarios();
  await runCreateExecutionScenarios();
}

void run();
