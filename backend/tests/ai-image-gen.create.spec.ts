import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_IMAGE_GEN_DEFAULT_MODEL,
  AI_IMAGE_GEN_DEFAULT_OFFICIAL_QUALITY,
  AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL,
  LAOZHANG_OPENAI_IMAGES_PROVIDER_ROUTE,
} from "../shared/src/index.ts";
import type {
  AIImageGenCreateExecutionRequest,
  CreateExecutionRequest,
} from "../shared/src/types/api/executions.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import {
  buildCreateExecutionStoreInput,
  validateExecutionCreateRequest,
} from "../api/src/modules/executions/execution-node.registry.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { createAIImageGenRequest } from "./helpers/execution-request.fixture.ts";

const TEST_WORKFLOW_ID = "workflow-ai-image-gen-create";

function assertAIImageGenRequest(
  request: CreateExecutionRequest,
): asserts request is AIImageGenCreateExecutionRequest {
  assert.equal(request.taskType, "image-gen");
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
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    nodeId: " node-image-gen ",
    nodeTitle: " AI Image Gen ",
    prompt: " shared prompt ",
    model: "gpt-image-2-vip",
    imageSize: "2K",
    aspectRatio: "16:9",
    groups: [
      {
        groupId: " group-1 ",
        referenceFileIds: [" file-ref-1 ", " file-ref-2 "],
      },
    ],
  });
  assertAIImageGenRequest(validated);

  assert.equal(validated.nodeType, "aiImageGen");
  assert.equal(validated.taskType, "image-gen");
  assert.equal(validated.executionMode, "legacy-grouped-task");
  assert.equal(validated.nodeId, "node-image-gen");
  assert.equal(validated.nodeTitle, "AI Image Gen");
  assert.equal(validated.prompt, "shared prompt");
  assert.equal(validated.model, "gpt-image-2-vip");
  assert.equal(validated.imageSize, "2K");
  assert.equal(validated.aspectRatio, "16:9");
  assert.equal(validated.groups[0]?.groupId, "group-1");
  assert.deepEqual(validated.groups[0]?.referenceFileIds, ["file-ref-1", "file-ref-2"]);

  const storeInput = buildCreateExecutionStoreInput(validated);

  assert.equal(storeInput.run.nodeType, "aiImageGen");
  assert.equal(storeInput.run.taskType, "image-gen");
  assert.equal(storeInput.run.userId, null);
  assert.equal(storeInput.run.workflowId, TEST_WORKFLOW_ID);
  assert.equal(storeInput.tasks.length, 1);
  assert.equal(storeInput.tasks[0]?.workflowId, TEST_WORKFLOW_ID);
  assert.equal(storeInput.tasks[0]?.model, "gpt-image-2-vip");
  assert.deepEqual(storeInput.tasks[0]?.input, {
    prompt: "shared prompt",
    model: "gpt-image-2-vip",
    referenceFileIds: ["file-ref-1", "file-ref-2"],
    imageSize: "2K",
    aspectRatio: "16:9",
  });

  const validatedOfficialAuto = validateExecutionCreateRequest({
    userId: "user-a",
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    nodeId: "node-image-gen",
    nodeTitle: "AI Image Gen",
    prompt: "official prompt",
    model: "gpt-image-2-official",
    imageSize: "2K",
    aspectRatio: "auto",
    quality: "high",
    groups: [
      {
        groupId: "group-1",
        referenceFileIds: ["file-ref-1"],
      },
    ],
  });
  assertAIImageGenRequest(validatedOfficialAuto);

  assert.equal(validatedOfficialAuto.model, "gpt-image-2-official");
  assert.equal(validatedOfficialAuto.imageSize, "2K");
  assert.equal(validatedOfficialAuto.aspectRatio, "auto");
  assert.equal(validatedOfficialAuto.quality, "high");

  const officialAutoStoreInput = buildCreateExecutionStoreInput(validatedOfficialAuto);

  assert.deepEqual(officialAutoStoreInput.tasks[0]?.input, {
    prompt: "official prompt",
    model: "gpt-image-2-official",
    referenceFileIds: ["file-ref-1"],
    imageSize: "2K",
    aspectRatio: "auto",
    quality: "high",
    providerRoute: LAOZHANG_OPENAI_IMAGES_PROVIDER_ROUTE,
    providerModel: AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL,
    resolvedSize: "auto",
  });

  const validatedOfficialWithoutReferences = validateExecutionCreateRequest({
    userId: "user-a",
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    prompt: "official text only prompt",
    model: "gpt-image-2-official",
    imageSize: "2K",
    aspectRatio: "auto",
    quality: "medium",
    groups: [
      {
        groupId: "group-official-text-only",
        referenceFileIds: [],
      },
    ],
  });
  assertAIImageGenRequest(validatedOfficialWithoutReferences);

  assert.deepEqual(validatedOfficialWithoutReferences.groups[0]?.referenceFileIds, []);

  const validatedOfficialWithDefaultQuality = validateExecutionCreateRequest({
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    prompt: "official default quality prompt",
    model: "gpt-image-2-official",
    imageSize: "2K",
    aspectRatio: "16:9",
    groups: [
      {
        groupId: "group-1",
        referenceFileIds: ["file-ref-1"],
      },
    ],
  });
  assertAIImageGenRequest(validatedOfficialWithDefaultQuality);

  assert.equal(validatedOfficialWithDefaultQuality.quality, AI_IMAGE_GEN_DEFAULT_OFFICIAL_QUALITY);

  const officialConcreteStoreInput = buildCreateExecutionStoreInput(validatedOfficialWithDefaultQuality);

  assert.deepEqual(officialConcreteStoreInput.tasks[0]?.input, {
    prompt: "official default quality prompt",
    model: "gpt-image-2-official",
    referenceFileIds: ["file-ref-1"],
    imageSize: "2K",
    aspectRatio: "16:9",
    quality: AI_IMAGE_GEN_DEFAULT_OFFICIAL_QUALITY,
    providerRoute: LAOZHANG_OPENAI_IMAGES_PROVIDER_ROUTE,
    providerModel: AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL,
    resolvedSize: "2048x1152",
  });

  const validatedWithDefaults = validateExecutionCreateRequest({
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    prompt: "default prompt",
    groups: [
      {
        groupId: "group-1",
        referenceFileIds: ["file-ref-1"],
      },
    ],
  });
  assertAIImageGenRequest(validatedWithDefaults);

  assert.equal(validatedWithDefaults.model, AI_IMAGE_GEN_DEFAULT_MODEL);
  assert.equal(Object.prototype.hasOwnProperty.call(validatedWithDefaults, "imageSize"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(validatedWithDefaults, "aspectRatio"), false);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      prompt: "   ",
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: ["file-ref-1"],
        },
      ],
    } as never);
  }, /INVALID_PROMPT/);

  const validatedGptVipTextOnly = validateExecutionCreateRequest({
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    prompt: "gpt image 2 text only prompt",
    model: "gpt-image-2-vip",
    groups: [
      {
        groupId: "group-1",
        referenceFileIds: [],
      },
    ],
  });
  assertAIImageGenRequest(validatedGptVipTextOnly);

  assert.equal(validatedGptVipTextOnly.model, "gpt-image-2-vip");
  assert.deepEqual(validatedGptVipTextOnly.groups[0]?.referenceFileIds, []);

  const validatedGeminiTextOnly = validateExecutionCreateRequest({
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiImageGen",
    taskType: "image-gen",
    executionMode: "legacy-grouped-task",
    prompt: "gemini text only prompt",
    model: "gemini-3-pro-image-preview",
    groups: [
      {
        groupId: "group-1",
        referenceFileIds: [],
      },
    ],
  });
  assertAIImageGenRequest(validatedGeminiTextOnly);

  assert.equal(validatedGeminiTextOnly.model, "gemini-3-pro-image-preview");
  assert.deepEqual(validatedGeminiTextOnly.groups[0]?.referenceFileIds, []);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: ["f1", "f2", "f3", "f4", "f5", "f6"],
        },
      ],
    } as never);
  }, /INVALID_REFERENCE_FILE_COUNT:0/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      imageSize: "8K",
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: ["file-ref-1"],
        },
      ],
    } as never);
  }, /INVALID_IMAGE_SIZE:request/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      aspectRatio: "7:5",
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: ["file-ref-1"],
        },
      ],
    } as never);
  }, /INVALID_ASPECT_RATIO:request/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      model: "unsupported-model",
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: ["file-ref-1"],
        },
      ],
    } as never);
  }, /INVALID_MODEL/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      model: "gpt-image-2-official",
      quality: "ultra",
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: ["file-ref-1"],
        },
      ],
    } as never);
  }, /INVALID_QUALITY/);

  assert.throws(() => {
    validateExecutionCreateRequest({
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      prompt: "test prompt",
      model: "gpt-image-2-vip",
      aspectRatio: "auto",
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: ["file-ref-1"],
        },
      ],
    } as never);
  }, /INVALID_ASPECT_RATIO:request/);
}

async function runCreateExecutionScenarios(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-ai-image-gen-create-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);

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

    const result = await executionsService.createExecution(createAIImageGenRequest({
      userId: "user-a",
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      nodeId: "node-image-gen",
      nodeTitle: "AI Image Gen",
      prompt: "node shared prompt",
      model: "gpt-image-2-vip",
      imageSize: "4K",
      aspectRatio: "9:16",
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: [referenceFileId1, referenceFileId2],
        },
        {
          groupId: "group-2",
          referenceFileIds: [referenceFileId3],
        },
      ],
    }));

    assert.ok(result.runId);
    assert.equal(result.status, "queued");
    assert.equal(result.nodeType, "aiImageGen");
    assert.equal(result.taskType, "image-gen");
    assert.equal(result.tasks.length, 2);
    assert.equal(result.tasks[0]?.groupId, "group-1");
    assert.equal(result.tasks[0]?.groupOrder, 1);
    assert.equal(result.tasks[1]?.groupId, "group-2");
    assert.equal(result.tasks[1]?.groupOrder, 2);

    const task1 = await executionsRepository.getTaskById(result.tasks[0]!.taskId);
    const task2 = await executionsRepository.getTaskById(result.tasks[1]!.taskId);

    assert.ok(task1);
    assert.ok(task2);
    assert.equal(task1?.nodeType, "aiImageGen");
    assert.equal(task1?.taskType, "image-gen");
    assert.equal(task1?.model, "gpt-image-2-vip");
    assert.equal(task2?.model, "gpt-image-2-vip");
    assert.deepEqual(task1?.input, {
      prompt: "node shared prompt",
      model: "gpt-image-2-vip",
      referenceFileIds: [referenceFileId1, referenceFileId2],
      imageSize: "4K",
      aspectRatio: "9:16",
    });
    assert.deepEqual(task2?.input, {
      prompt: "node shared prompt",
      model: "gpt-image-2-vip",
      referenceFileIds: [referenceFileId3],
      imageSize: "4K",
      aspectRatio: "9:16",
    });

    const gptTextOnlyResult = await executionsService.createExecution(createAIImageGenRequest({
      userId: "user-a",
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      nodeId: "node-image-gen-text-only",
      nodeTitle: "AI Image Gen Text Only",
      prompt: "node text only prompt",
      model: "gpt-image-2-vip",
      imageSize: "1K",
      aspectRatio: "1:1",
      groups: [
        {
          groupId: "group-text-only",
          referenceFileIds: [],
        },
      ],
    }));

    assert.equal(gptTextOnlyResult.status, "queued");
    assert.equal(gptTextOnlyResult.tasks.length, 1);

    const gptTextOnlyTask = await executionsRepository.getTaskById(gptTextOnlyResult.tasks[0]!.taskId);

    assert.ok(gptTextOnlyTask);
    assert.equal(gptTextOnlyTask?.model, "gpt-image-2-vip");
    assert.deepEqual(gptTextOnlyTask?.input, {
      prompt: "node text only prompt",
      model: "gpt-image-2-vip",
      referenceFileIds: [],
      imageSize: "1K",
      aspectRatio: "1:1",
    });

    const geminiTextOnlyResult = await executionsService.createExecution(createAIImageGenRequest({
      userId: "user-a",
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      nodeId: "node-image-gen-gemini-text-only",
      nodeTitle: "AI Image Gen Gemini Text Only",
      prompt: "gemini node text only prompt",
      model: "gemini-3-pro-image-preview",
      imageSize: "2K",
      aspectRatio: "auto",
      groups: [
        {
          groupId: "group-gemini-text-only",
          referenceFileIds: [],
        },
      ],
    }));

    assert.equal(geminiTextOnlyResult.status, "queued");
    assert.equal(geminiTextOnlyResult.tasks.length, 1);

    const geminiTextOnlyTask = await executionsRepository.getTaskById(
      geminiTextOnlyResult.tasks[0]!.taskId,
    );

    assert.ok(geminiTextOnlyTask);
    assert.equal(geminiTextOnlyTask?.model, "gemini-3-pro-image-preview");
    assert.deepEqual(geminiTextOnlyTask?.input, {
      prompt: "gemini node text only prompt",
      model: "gemini-3-pro-image-preview",
      referenceFileIds: [],
      imageSize: "2K",
      aspectRatio: "auto",
    });

    const officialResult = await executionsService.createExecution(createAIImageGenRequest({
      userId: "user-a",
      workflowId: TEST_WORKFLOW_ID,
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      nodeId: "node-image-gen-official",
      nodeTitle: "AI Image Gen Official",
      prompt: "official node shared prompt",
      model: "gpt-image-2-official",
      imageSize: "2K",
      aspectRatio: "auto",
      quality: "medium",
      groups: [
        {
          groupId: "group-official",
          referenceFileIds: [],
        },
      ],
    }));

    assert.equal(officialResult.status, "queued");
    assert.equal(officialResult.tasks.length, 1);

    const officialTask = await executionsRepository.getTaskById(officialResult.tasks[0]!.taskId);

    assert.ok(officialTask);
    assert.equal(officialTask?.model, "gpt-image-2-official");
    assert.deepEqual(officialTask?.input, {
      prompt: "official node shared prompt",
      model: "gpt-image-2-official",
      referenceFileIds: [],
      imageSize: "2K",
      aspectRatio: "auto",
      quality: "medium",
      providerRoute: LAOZHANG_OPENAI_IMAGES_PROVIDER_ROUTE,
      providerModel: AI_IMAGE_GEN_GPT_IMAGE_2_OFFICIAL_PROVIDER_MODEL,
      resolvedSize: "auto",
    });

    await assert.rejects(() => {
      return executionsService.createExecution(createAIImageGenRequest({
        userId: "user-a",
        workflowId: TEST_WORKFLOW_ID,
        nodeType: "aiImageGen",
        taskType: "image-gen",
        executionMode: "legacy-grouped-task",
        nodeId: "node-image-gen",
        nodeTitle: "AI Image Gen",
        prompt: "node shared prompt",
        groups: [
          {
            groupId: "group-3",
            referenceFileIds: [referenceFileId1, "file-missing"],
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
