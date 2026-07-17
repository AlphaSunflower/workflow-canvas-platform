import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionQueryService } from "../api/src/modules/executions/execution-query.service.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import {
  createAIImageGenRequest,
  createAIFloorplanColorizeRequest,
  createAIImageHdRequest,
  createAIMultiViewRestoreRequest,
  createWhiteModelRenderRequest,
} from "./helpers/execution-request.fixture.ts";

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

async function runAIImageHdQueryScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-query-ai-image-hd-models-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);
    const sourceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "image-hd-source.png",
      "image-hd-source",
    );

    const createResult = await executionsService.createExecution(createAIImageHdRequest({
      userId: "user-a",
      workflowId: "workflow-query-ai-image-hd",
      model: "gpt-image-2-vip",
      groups: [{
        groupId: "group-1",
        sourceFileId,
        imageSize: "4K",
        aspectRatio: "9:16",
      }],
    }));

    const taskId = createResult.tasks[0]!.taskId;
    const runDetail = await queryService.getExecutionRun(createResult.runId);
    const taskList = await queryService.listTasks({ runId: createResult.runId, page: 1, pageSize: 10 });
    const taskDetail = await queryService.getTaskDetail(taskId);

    assert.equal(runDetail?.tasks[0]?.nodeType, "aiImageHd");
    assert.equal(runDetail?.tasks[0]?.model, "gpt-image-2-vip");
    assert.equal(runDetail?.tasks[0]?.imageSize, "4K");
    assert.equal(runDetail?.tasks[0]?.aspectRatio, "9:16");
    assert.equal(runDetail?.tasks[0]?.inputFileId, sourceFileId);
    assert.equal(taskList.items[0]?.model, "gpt-image-2-vip");
    assert.equal(taskList.items[0]?.imageSize, "4K");
    assert.equal(taskList.items[0]?.aspectRatio, "9:16");
    assert.equal(taskDetail?.model, "gpt-image-2-vip");
    assert.equal(taskDetail?.imageSize, "4K");
    assert.equal(taskDetail?.aspectRatio, "9:16");
    assert.equal(taskDetail?.inputFileId, sourceFileId);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runAIFloorplanColorizeQueryScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-query-floorplan-models-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);
    const sourceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "floorplan-source.png",
      "floorplan-source",
    );

    const createResult = await executionsService.createExecution(createAIFloorplanColorizeRequest({
      userId: "user-a",
      workflowId: "workflow-query-floorplan-colorize",
      model: "gpt-image-2-vip",
      groups: [{
        groupId: "group-1",
        sourceFileId,
        stylePreset: "photoreal-render",
        imageSize: "2K",
        aspectRatio: "3:4",
      }],
    }));

    const taskId = createResult.tasks[0]!.taskId;
    const runDetail = await queryService.getExecutionRun(createResult.runId);
    const taskList = await queryService.listTasks({ runId: createResult.runId, page: 1, pageSize: 10 });
    const taskDetail = await queryService.getTaskDetail(taskId);

    assert.equal(runDetail?.tasks[0]?.nodeType, "aiFloorplanColorize");
    assert.equal(runDetail?.tasks[0]?.model, "gpt-image-2-vip");
    assert.equal(runDetail?.tasks[0]?.stylePreset, "photoreal-render");
    assert.equal(runDetail?.tasks[0]?.imageSize, "2K");
    assert.equal(runDetail?.tasks[0]?.aspectRatio, "3:4");
    assert.equal(taskList.items[0]?.model, "gpt-image-2-vip");
    assert.equal(taskList.items[0]?.stylePreset, "photoreal-render");
    assert.equal(taskDetail?.model, "gpt-image-2-vip");
    assert.equal(taskDetail?.stylePreset, "photoreal-render");
    assert.equal(taskDetail?.imageSize, "2K");
    assert.equal(taskDetail?.aspectRatio, "3:4");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runAIImageGenOfficialQueryScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-query-ai-image-gen-official-"));

  try {
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);

    const createResult = await executionsService.createExecution(createAIImageGenRequest({
      userId: "user-a",
      workflowId: "workflow-query-ai-image-gen-official",
      prompt: "official image prompt",
      model: "gpt-image-2-official",
      imageSize: "2K",
      aspectRatio: "auto",
      quality: "high",
      groups: [{
        groupId: "group-1",
        referenceFileIds: [],
      }],
    }));

    const taskId = createResult.tasks[0]!.taskId;
    const runDetail = await queryService.getExecutionRun(createResult.runId);
    const taskList = await queryService.listTasks({ runId: createResult.runId, page: 1, pageSize: 10 });
    const taskDetail = await queryService.getTaskDetail(taskId);

    assert.equal(runDetail?.tasks[0]?.nodeType, "aiImageGen");
    assert.equal(runDetail?.tasks[0]?.model, "gpt-image-2-official");
    assert.equal(runDetail?.tasks[0]?.imageSize, "2K");
    assert.equal(runDetail?.tasks[0]?.aspectRatio, "auto");
    assert.equal(runDetail?.tasks[0]?.quality, "high");
    assert.equal(runDetail?.tasks[0]?.providerRoute, "sora2official");
    assert.equal(runDetail?.tasks[0]?.providerModel, "gpt-image-2");
    assert.equal(runDetail?.tasks[0]?.resolvedSize, "auto");
    assert.equal(runDetail?.tasks[0]?.referenceFileIds, null);
    assert.equal(taskList.items[0]?.model, "gpt-image-2-official");
    assert.equal(taskList.items[0]?.quality, "high");
    assert.equal(taskList.items[0]?.providerRoute, "sora2official");
    assert.equal(taskList.items[0]?.providerModel, "gpt-image-2");
    assert.equal(taskList.items[0]?.resolvedSize, "auto");
    assert.equal(taskDetail?.model, "gpt-image-2-official");
    assert.equal(taskDetail?.imageSize, "2K");
    assert.equal(taskDetail?.aspectRatio, "auto");
    assert.equal(taskDetail?.quality, "high");
    assert.equal(taskDetail?.providerRoute, "sora2official");
    assert.equal(taskDetail?.providerModel, "gpt-image-2");
    assert.equal(taskDetail?.resolvedSize, "auto");
    assert.equal(taskDetail?.referenceFileIds, null);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runWhiteModelRenderQueryScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-query-white-model-models-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);
    const whiteModelFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "white-model.png",
      "white-model",
    );
    const styleReferenceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "style-reference.png",
      "style-reference",
    );

    const createResult = await executionsService.createExecution(createWhiteModelRenderRequest({
      userId: "user-a",
      workflowId: "workflow-query-white-model-render",
      model: "gpt-image-2-vip",
      imageSize: "2K",
      aspectRatio: "16:9",
      groups: [{
        groupId: "group-1",
        whiteModelFileId,
        styleReferenceFileId,
      }],
    }));

    const taskId = createResult.tasks[0]!.taskId;
    const runDetail = await queryService.getExecutionRun(createResult.runId);
    const taskList = await queryService.listTasks({ runId: createResult.runId, page: 1, pageSize: 10 });
    const taskDetail = await queryService.getTaskDetail(taskId);

    assert.equal(runDetail?.tasks[0]?.nodeType, "aiModelRenderTransfer");
    assert.equal(runDetail?.tasks[0]?.model, "gpt-image-2-vip");
    assert.equal(runDetail?.tasks[0]?.imageSize, "2K");
    assert.equal(runDetail?.tasks[0]?.aspectRatio, "16:9");
    assert.equal(taskList.items[0]?.model, "gpt-image-2-vip");
    assert.equal(taskList.items[0]?.whiteModelFileId, whiteModelFileId);
    assert.equal(taskList.items[0]?.styleReferenceFileId, styleReferenceFileId);
    assert.equal(taskDetail?.model, "gpt-image-2-vip");
    assert.equal(taskDetail?.imageSize, "2K");
    assert.equal(taskDetail?.aspectRatio, "16:9");
    assert.equal(taskDetail?.whiteModelFileId, whiteModelFileId);
    assert.equal(taskDetail?.styleReferenceFileId, styleReferenceFileId);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runAIMultiViewRestoreScopeScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-query-multi-view-scope-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);
    const renderFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "render.png",
      "render",
    );
    const referenceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference.png",
      "reference",
    );

    const createResult = await executionsService.createExecution(createAIMultiViewRestoreRequest({
      userId: "user-a",
      workflowId: "workflow-query-multi-view-scope",
      groups: [{
        groupId: "group-1",
        renderFileId,
        referenceFileId,
      }],
    }));

    const taskDetail = await queryService.getTaskDetail(createResult.tasks[0]!.taskId);

    assert.equal(taskDetail?.nodeType, "aiMultiViewRestore");
    assert.equal(taskDetail?.model, null);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await runAIImageHdQueryScenario();
  await runAIFloorplanColorizeQueryScenario();
  await runAIImageGenOfficialQueryScenario();
  await runWhiteModelRenderQueryScenario();
  await runAIMultiViewRestoreScopeScenario();
}

void run();
