import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { ExecutionQueryService } from "../api/src/modules/executions/execution-query.service.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import type { ExecutionTaskEventPayload } from "../shared/src/types/api/execution-query.ts";
import {
  AI_MULTI_VIEW_RESTORE_WORKFLOW_ID,
  AI_MULTI_VIEW_RESTORE_WORKFLOW_TEMPLATE_KEY,
  AI_IMAGE_TO_PLY_WORKFLOW_ID,
  AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
} from "../shared/src/index.ts";
import {
  createAIImageGenRequest,
  createAIImageToPlyRequest,
  createAIMultiViewRestoreRequest,
  createWhiteModelRenderRequest,
} from "./helpers/execution-request.fixture.ts";

const WHITE_MODEL_QUERY_WORKFLOW_ID = "workflow-query-white-model";
const AI_IMAGE_GEN_QUERY_WORKFLOW_ID = "workflow-query-ai-image-gen";
const AI_MULTI_VIEW_RESTORE_QUERY_WORKFLOW_ID = "workflow-query-ai-multi-view-restore";
const AI_IMAGE_TO_PLY_QUERY_WORKFLOW_ID = "workflow-query-ai-image-to-ply";
const RUNNINGHUB_BACKPRESSURE_QUERY_WORKFLOW_ID = "workflow-query-runninghub-backpressure";

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  const crcBuffer = Buffer.alloc(4);

  lengthBuffer.writeUInt32BE(data.length, 0);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function createSamplePng(width: number, height: number): Buffer {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const scanlineLength = 1 + width * 3;
  const raw = Buffer.alloc(scanlineLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * scanlineLength;
    raw[rowOffset] = 0;

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 3;
      raw[pixelOffset] = (x * 7) % 256;
      raw[pixelOffset + 1] = (y * 11) % 256;
      raw[pixelOffset + 2] = 224;
    }
  }

  return Buffer.concat([
    signature,
    createPngChunk("IHDR", ihdr),
    createPngChunk("IDAT", zlib.deflateSync(raw)),
    createPngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function registerReadyFile(
  filesRepository: FilesRepository,
  userId: string,
  originalName: string,
  content: string | Buffer,
): Promise<string> {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
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

async function runWhiteModelQueryScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-execution-query-white-model-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);

    const whiteModelFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "white-model.png",
      "white-model-image",
    );
    const styleFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "style.png",
      "style-image",
    );

    const createResult = await executionsService.createExecution(createWhiteModelRenderRequest({
      userId: "user-a",
      workflowId: WHITE_MODEL_QUERY_WORKFLOW_ID,
      nodeType: "aiModelRenderTransfer",
      taskType: "model-render-transfer",
      executionMode: "legacy-grouped-task",
      nodeId: "node-001",
      nodeTitle: "白模渲染",
      groups: [
        {
          groupId: "group-1",
          whiteModelFileId,
          styleReferenceFileId: styleFileId,
        },
      ],
    }));

    const runDetail = await queryService.getExecutionRun(createResult.runId);

    assert.ok(runDetail);
    assert.equal(runDetail?.runId, createResult.runId);
    assert.equal(runDetail?.tasks.length, 1);
    assert.equal(runDetail?.tasks[0]?.groupId, "group-1");
    assert.equal(runDetail?.tasks[0]?.whiteModelFile?.fileId, whiteModelFileId);
    assert.equal(runDetail?.tasks[0]?.styleReferenceFile?.fileId, styleFileId);
    assert.equal(runDetail?.tasks[0]?.maxRetries, 2);
    assert.equal(runDetail?.tasks[0]?.maxAttempts, 3);

    const taskList = await queryService.listTasks({
      runId: createResult.runId,
      page: 1,
      pageSize: 10,
    });

    assert.equal(taskList.total, 1);
    assert.equal(taskList.items[0]?.runId, createResult.runId);
    assert.equal(taskList.items[0]?.status, "queued");
    assert.equal(taskList.items[0]?.maxAttempts, 3);

    const taskDetail = await queryService.getTaskDetail(createResult.tasks[0]!.taskId);

    assert.ok(taskDetail);
    assert.equal(taskDetail?.taskId, createResult.tasks[0]!.taskId);
    assert.equal(taskDetail?.recentEvents.length, 1);
    assert.equal(taskDetail?.recentEvents[0]?.eventType, "task_queued");
    assert.equal(taskDetail?.recentEvents[0]?.phase, "queued");
    assert.equal(taskDetail?.maxAttempts, 3);

    const taskEvents = await queryService.getTaskEvents(createResult.tasks[0]!.taskId);

    assert.ok(taskEvents);
    assert.equal(taskEvents?.messageType, "task_event");
    assert.equal(taskEvents?.total, 1);
    assert.equal(taskEvents?.items[0]?.taskId, createResult.tasks[0]!.taskId);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runAIImageGenQueryScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-execution-query-ai-image-gen-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);

    const referenceFileId1 = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference-1.png",
      createSamplePng(1200, 900),
    );
    const referenceFileId2 = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference-2.png",
      createSamplePng(1400, 1000),
    );
    const resultFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "result-output.png",
      createSamplePng(1600, 900),
    );

    const createResult = await executionsService.createExecution(createAIImageGenRequest({
      userId: "user-a",
      workflowId: AI_IMAGE_GEN_QUERY_WORKFLOW_ID,
      nodeType: "aiImageGen",
      taskType: "image-gen",
      executionMode: "legacy-grouped-task",
      model: "gpt-image-2-vip",
      nodeId: "node-002",
      nodeTitle: "AI 生图",
      prompt: "节点共享提示词",
      imageSize: "2K",
      aspectRatio: "4:5",
      groups: [
        {
          groupId: "group-gen-1",
          referenceFileIds: [referenceFileId2, referenceFileId1],
        },
      ],
    }));

    const taskId = createResult.tasks[0]!.taskId;

    await executionsRepository.updateTaskResultFile(taskId, resultFileId);
    await executionsRepository.updateTaskAttempt({
      taskId,
      attemptNo: 2,
      retryCount: 1,
      currentStep: "final",
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    await executionsRepository.appendTaskEvent({
      taskId,
      attemptNo: 2,
      eventType: "step_final_started",
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 70,
      message: "AI 生图开始执行",
      payload: {
        prompt: "节点共享提示词",
        referenceFileIds: [referenceFileId2, referenceFileId1],
        model: "gpt-image-2-vip",
        imageSize: "2K",
        aspectRatio: "4:5",
        resolvedSize: "1632x2048",
      },
    });
    await executionsRepository.markTaskCompleted(taskId);

    const runDetail = await queryService.getExecutionRun(createResult.runId);
    const taskList = await queryService.listTasks({
      runId: createResult.runId,
      page: 1,
      pageSize: 10,
    });
    const taskDetail = await queryService.getTaskDetail(taskId);
    const taskEvents = await queryService.getTaskEvents(taskId);

    assert.ok(runDetail);
    assert.equal(runDetail?.tasks.length, 1);
    assert.equal(runDetail?.tasks[0]?.nodeType, "aiImageGen");
    assert.equal(runDetail?.tasks[0]?.taskType, "image-gen");
    assert.equal(runDetail?.tasks[0]?.model, "gpt-image-2-vip");
    assert.equal(runDetail?.tasks[0]?.prompt, "节点共享提示词");
    assert.deepEqual(runDetail?.tasks[0]?.referenceFileIds, [
      referenceFileId2,
      referenceFileId1,
    ]);
    assert.equal(runDetail?.tasks[0]?.imageSize, "2K");
    assert.equal(runDetail?.tasks[0]?.aspectRatio, "4:5");
    assert.equal(runDetail?.tasks[0]?.currentAttemptNo, 2);
    assert.equal(runDetail?.tasks[0]?.retryCount, 1);
    assert.equal(runDetail?.tasks[0]?.resultFileId, resultFileId);
    assert.equal(runDetail?.tasks[0]?.resultFile?.fileId, resultFileId);
    assert.equal(runDetail?.tasks[0]?.resultFile?.userId, "user-a");
    assert.equal(runDetail?.tasks[0]?.resultFile?.downloadUrl, `/api/v1/files/${resultFileId}/download`);
    assert.equal(runDetail?.tasks[0]?.resultFile?.thumbnailUrl, `/api/v1/files/${resultFileId}/thumbnail`);
    assert.equal(runDetail?.tasks[0]?.resultFile?.previewUrl, `/api/v1/files/${resultFileId}/preview`);

    assert.equal(taskList.total, 1);
    assert.equal(taskList.items[0]?.model, "gpt-image-2-vip");
    assert.equal(taskList.items[0]?.prompt, "节点共享提示词");
    assert.deepEqual(taskList.items[0]?.referenceFileIds, [
      referenceFileId2,
      referenceFileId1,
    ]);
    assert.equal(taskList.items[0]?.resultFile?.fileId, resultFileId);
    assert.equal(taskList.items[0]?.resultFile?.userId, "user-a");
    assert.equal(taskList.items[0]?.resultFile?.downloadUrl, `/api/v1/files/${resultFileId}/download`);
    assert.equal(taskList.items[0]?.resultFile?.thumbnailUrl, `/api/v1/files/${resultFileId}/thumbnail`);
    assert.equal(taskList.items[0]?.resultFile?.previewUrl, `/api/v1/files/${resultFileId}/preview`);

    assert.ok(taskDetail);
    assert.equal(taskDetail?.taskId, taskId);
    assert.equal(taskDetail?.model, "gpt-image-2-vip");
    assert.equal(taskDetail?.prompt, "节点共享提示词");
    assert.deepEqual(taskDetail?.referenceFileIds, [
      referenceFileId2,
      referenceFileId1,
    ]);
    assert.equal(taskDetail?.imageSize, "2K");
    assert.equal(taskDetail?.aspectRatio, "4:5");
    assert.equal(taskDetail?.resultFile?.fileId, resultFileId);
    assert.equal(taskDetail?.resultFile?.userId, "user-a");
    assert.equal(taskDetail?.resultFile?.downloadUrl, `/api/v1/files/${resultFileId}/download`);
    assert.equal(taskDetail?.resultFile?.thumbnailUrl, `/api/v1/files/${resultFileId}/thumbnail`);
    assert.equal(taskDetail?.resultFile?.previewUrl, `/api/v1/files/${resultFileId}/preview`);
    assert.equal(taskDetail?.currentStep, "final");
    assert.equal(taskDetail?.currentAttemptNo, 2);
    assert.equal(taskDetail?.retryCount, 1);
    assert.ok(
      taskDetail?.recentEvents.some((event: ExecutionTaskEventPayload) => event.eventType === "step_final_started"),
    );
    assert.ok(
      taskDetail?.recentEvents.some((event: ExecutionTaskEventPayload) => event.eventType === "task_completed"),
    );

    assert.ok(taskEvents);
    assert.equal(taskEvents?.messageType, "task_event");
    assert.ok(
      taskEvents?.items.some((event: ExecutionTaskEventPayload) => event.eventType === "step_final_started"),
    );
    assert.ok(
      taskEvents?.items.some((event: ExecutionTaskEventPayload) => event.eventType === "task_completed"),
    );

    const finalStartedEvent = taskEvents?.items.find(
      (event: ExecutionTaskEventPayload) => event.eventType === "step_final_started",
    );

    assert.deepEqual(finalStartedEvent?.payload?.referenceFileIds, [
      referenceFileId2,
      referenceFileId1,
    ]);
    assert.equal(finalStartedEvent?.payload?.model, "gpt-image-2-vip");
    assert.equal(finalStartedEvent?.payload?.imageSize, "2K");
    assert.equal(finalStartedEvent?.payload?.aspectRatio, "4:5");
    assert.equal(finalStartedEvent?.payload?.resolvedSize, "1632x2048");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await runWhiteModelQueryScenario();
  await runAIImageGenQueryScenario();
  await runAIMultiViewRestoreQueryScenario();
  await runAIImageToPlyQueryScenario();
  await runRunningHubBackpressureQueryScenario();
}

void run();

async function runAIMultiViewRestoreQueryScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-execution-query-ai-multi-view-restore-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);

    const renderFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "render-input.png",
      "multi-view-render",
    );
    const referenceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference-input.png",
      "multi-view-reference",
    );
    const resultFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "multi-view-result.png",
      "multi-view-result",
    );

    const createResult = await executionsService.createExecution(createAIMultiViewRestoreRequest({
      userId: "user-a",
      workflowId: AI_MULTI_VIEW_RESTORE_QUERY_WORKFLOW_ID,
      nodeType: "aiMultiViewRestore",
      taskType: "multi-view-restore",
      executionMode: "legacy-grouped-task",
      nodeId: "node-ai-multi-view-restore",
      nodeTitle: "多视角修复",
      groups: [
        {
          groupId: "group-mvr-1",
          renderFileId,
          referenceFileId,
        },
      ],
    }));

    const taskId = createResult.tasks[0]!.taskId;

    await executionsRepository.updateTaskAttempt({
      taskId,
      attemptNo: 2,
      retryCount: 1,
      currentStep: "final",
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    await executionsRepository.appendTaskEvent({
      taskId,
      attemptNo: 2,
      eventType: "task_progress",
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 55,
      message: "RunningHub 多视角修复任务已创建。",
      payload: {
        providerTaskId: "rh-task-mvr-query-001",
        providerClientId: "rh-client-mvr-query-001",
        workflowId: AI_MULTI_VIEW_RESTORE_WORKFLOW_ID,
        workflowTemplateKey: AI_MULTI_VIEW_RESTORE_WORKFLOW_TEMPLATE_KEY,
      },
    });
    await executionsRepository.appendTaskEvent({
      taskId,
      attemptNo: 2,
      eventType: "task_artifact_received",
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 75,
      message: "已从 RunningHub 收到结果图地址。",
      payload: {
        providerTaskId: "rh-task-mvr-query-001",
        providerClientId: "rh-client-mvr-query-001",
        resultFileUrl: "https://example.test/multi-view/result.png",
        resultNodeId: "127",
        selectedBy: "output-node",
      },
    });
    await executionsRepository.updateTaskResultFile(taskId, resultFileId);
    await executionsRepository.markTaskCompleted(taskId);

    const runDetail = await queryService.getExecutionRun(createResult.runId);
    const taskList = await queryService.listTasks({
      runId: createResult.runId,
      page: 1,
      pageSize: 10,
    });
    const taskDetail = await queryService.getTaskDetail(taskId);
    const taskEvents = await queryService.getTaskEvents(taskId);

    assert.ok(runDetail);
    assert.equal(runDetail?.tasks.length, 1);
    assert.equal(runDetail?.tasks[0]?.nodeType, "aiMultiViewRestore");
    assert.equal(runDetail?.tasks[0]?.taskType, "multi-view-restore");
    assert.equal(runDetail?.tasks[0]?.renderFileId, renderFileId);
    assert.equal(runDetail?.tasks[0]?.referenceFileId, referenceFileId);
    assert.equal(runDetail?.tasks[0]?.workflowId, AI_MULTI_VIEW_RESTORE_QUERY_WORKFLOW_ID);
    assert.equal(
      runDetail?.tasks[0]?.workflowTemplateKey,
      AI_MULTI_VIEW_RESTORE_WORKFLOW_TEMPLATE_KEY,
    );
    assert.equal(runDetail?.tasks[0]?.providerTaskId, "rh-task-mvr-query-001");
    assert.equal(runDetail?.tasks[0]?.providerClientId, "rh-client-mvr-query-001");
    assert.equal(runDetail?.tasks[0]?.renderFile?.fileId, renderFileId);
    assert.equal(runDetail?.tasks[0]?.referenceFile?.fileId, referenceFileId);
    assert.equal(runDetail?.tasks[0]?.resultFile?.fileId, resultFileId);
    assert.equal(runDetail?.tasks[0]?.resultFile?.userId, "user-a");

    assert.equal(taskList.total, 1);
    assert.equal(taskList.items[0]?.renderFileId, renderFileId);
    assert.equal(taskList.items[0]?.referenceFileId, referenceFileId);
    assert.equal(taskList.items[0]?.providerTaskId, "rh-task-mvr-query-001");
    assert.equal(taskList.items[0]?.providerClientId, "rh-client-mvr-query-001");
    assert.equal(taskList.items[0]?.resultFile?.fileId, resultFileId);
    assert.equal(taskList.items[0]?.resultFile?.userId, "user-a");

    assert.ok(taskDetail);
    assert.equal(taskDetail?.taskId, taskId);
    assert.equal(taskDetail?.renderFileId, renderFileId);
    assert.equal(taskDetail?.referenceFileId, referenceFileId);
    assert.equal(taskDetail?.workflowId, AI_MULTI_VIEW_RESTORE_QUERY_WORKFLOW_ID);
    assert.equal(
      taskDetail?.workflowTemplateKey,
      AI_MULTI_VIEW_RESTORE_WORKFLOW_TEMPLATE_KEY,
    );
    assert.equal(taskDetail?.providerTaskId, "rh-task-mvr-query-001");
    assert.equal(taskDetail?.providerClientId, "rh-client-mvr-query-001");
    assert.equal(taskDetail?.renderFile?.fileId, renderFileId);
    assert.equal(taskDetail?.referenceFile?.fileId, referenceFileId);
    assert.equal(taskDetail?.resultFile?.fileId, resultFileId);
    assert.equal(taskDetail?.resultFile?.userId, "user-a");
    assert.equal(taskDetail?.currentAttemptNo, 2);
    assert.equal(taskDetail?.retryCount, 1);
    assert.ok(
      taskDetail?.recentEvents.some((event: ExecutionTaskEventPayload) => event.eventType === "task_artifact_received"),
    );
    assert.ok(
      taskDetail?.recentEvents.some((event: ExecutionTaskEventPayload) => event.eventType === "task_completed"),
    );

    assert.ok(taskEvents);
    assert.ok(taskEvents?.items.some((event: ExecutionTaskEventPayload) => event.eventType === "task_progress"));
    assert.ok(taskEvents?.items.some((event: ExecutionTaskEventPayload) => event.eventType === "task_artifact_received"));
    const providerEvent = taskEvents?.items.find(
      (event: ExecutionTaskEventPayload) =>
        event.eventType === "task_progress"
        && event.payload?.providerTaskId === "rh-task-mvr-query-001",
    );
    assert.equal(providerEvent?.payload?.providerClientId, "rh-client-mvr-query-001");
    assert.equal(providerEvent?.payload?.workflowId, AI_MULTI_VIEW_RESTORE_WORKFLOW_ID);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runAIImageToPlyQueryScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-execution-query-ai-image-to-ply-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);

    const sourceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "source-image-to-ply.png",
      "image-to-ply-input",
    );

    const resultBuffer = Buffer.from("ply\nformat ascii 1.0\nend_header\n");
    const resultSha256 = createHash("sha256").update(resultBuffer).digest("hex");
    const resultRegister = await filesRepository.registerFile({
      userId: "user-a",
      sha256: resultSha256,
      size: resultBuffer.length,
      mimeType: "application/octet-stream",
      originalName: "result-model.ply",
      fileType: "ply",
      sourceType: "output",
    });

    if (resultRegister.uploadRequired && resultRegister.uploadId) {
      await filesRepository.uploadFile(
        resultRegister.uploadId,
        resultBuffer.toString("base64"),
      );
    }

    const createResult = await executionsService.createExecution(createAIImageToPlyRequest({
      userId: "user-a",
      workflowId: AI_IMAGE_TO_PLY_QUERY_WORKFLOW_ID,
      nodeType: "aiImageToPly",
      taskType: "image-to-ply",
      executionMode: "legacy-grouped-task",
      nodeId: "node-ai-image-to-ply",
      nodeTitle: "图片转模型",
      groups: [
        {
          groupId: "group-ply-1",
          sourceFileId,
        },
      ],
    }));

    const taskId = createResult.tasks[0]!.taskId;

    await executionsRepository.updateTaskAttempt({
      taskId,
      attemptNo: 2,
      retryCount: 1,
      currentStep: "final",
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    await executionsRepository.appendTaskEvent({
      taskId,
      attemptNo: 2,
      eventType: "task_progress",
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 50,
      message: "RunningHub 工作流任务已创建。",
      payload: {
        providerTaskId: "rh-task-query-001",
        providerClientId: "rh-client-query-001",
        workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
        workflowTemplateKey: AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
      },
    });
    await executionsRepository.updateTaskResultFile(taskId, resultRegister.file.fileId);
    await executionsRepository.markTaskCompleted(taskId);

    const runDetail = await queryService.getExecutionRun(createResult.runId);
    const taskList = await queryService.listTasks({
      runId: createResult.runId,
      page: 1,
      pageSize: 10,
    });
    const taskDetail = await queryService.getTaskDetail(taskId);
    const taskEvents = await queryService.getTaskEvents(taskId);

    assert.ok(runDetail);
    assert.equal(runDetail?.tasks.length, 1);
    assert.equal(runDetail?.tasks[0]?.nodeType, "aiImageToPly");
    assert.equal(runDetail?.tasks[0]?.taskType, "image-to-ply");
    assert.equal(runDetail?.tasks[0]?.sourceFileId, sourceFileId);
    assert.equal(runDetail?.tasks[0]?.workflowId, AI_IMAGE_TO_PLY_QUERY_WORKFLOW_ID);
    assert.equal(
      runDetail?.tasks[0]?.workflowTemplateKey,
      AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
    );
    assert.equal(runDetail?.tasks[0]?.providerTaskId, "rh-task-query-001");
    assert.equal(runDetail?.tasks[0]?.providerClientId, "rh-client-query-001");
    assert.equal(runDetail?.tasks[0]?.resultFile?.fileType, "ply");
    assert.equal(runDetail?.tasks[0]?.resultFile?.fileId, resultRegister.file.fileId);
    assert.equal(runDetail?.tasks[0]?.resultFile?.userId, "user-a");

    assert.equal(taskList.total, 1);
    assert.equal(taskList.items[0]?.sourceFileId, sourceFileId);
    assert.equal(taskList.items[0]?.workflowId, AI_IMAGE_TO_PLY_QUERY_WORKFLOW_ID);
    assert.equal(taskList.items[0]?.providerTaskId, "rh-task-query-001");
    assert.equal(taskList.items[0]?.providerClientId, "rh-client-query-001");
    assert.equal(taskList.items[0]?.resultFile?.fileType, "ply");
    assert.equal(taskList.items[0]?.resultFile?.userId, "user-a");

    assert.ok(taskDetail);
    assert.equal(taskDetail?.taskId, taskId);
    assert.equal(taskDetail?.sourceFileId, sourceFileId);
    assert.equal(taskDetail?.workflowId, AI_IMAGE_TO_PLY_QUERY_WORKFLOW_ID);
    assert.equal(taskDetail?.workflowTemplateKey, AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY);
    assert.equal(taskDetail?.providerTaskId, "rh-task-query-001");
    assert.equal(taskDetail?.providerClientId, "rh-client-query-001");
    assert.equal(taskDetail?.resultFile?.fileId, resultRegister.file.fileId);
    assert.equal(taskDetail?.resultFile?.fileType, "ply");
    assert.equal(taskDetail?.resultFile?.userId, "user-a");
    assert.equal(taskDetail?.currentAttemptNo, 2);
    assert.equal(taskDetail?.retryCount, 1);
    assert.ok(
      taskDetail?.recentEvents.some((event: ExecutionTaskEventPayload) => event.eventType === "task_progress"),
    );
    assert.ok(
      taskDetail?.recentEvents.some((event: ExecutionTaskEventPayload) => event.eventType === "task_completed"),
    );

    assert.ok(taskEvents);
    assert.ok(taskEvents?.items.some((event: ExecutionTaskEventPayload) => event.eventType === "task_progress"));
    const providerEvent = taskEvents?.items.find(
      (event: ExecutionTaskEventPayload) =>
        event.eventType === "task_progress"
        && event.payload?.providerTaskId === "rh-task-query-001",
    );
    assert.equal(providerEvent?.payload?.providerClientId, "rh-client-query-001");
    assert.equal(providerEvent?.payload?.workflowId, AI_IMAGE_TO_PLY_WORKFLOW_ID);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runRunningHubBackpressureQueryScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-execution-query-runninghub-backpressure-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const queryService = ExecutionQueryService.fromRoot(rootDir);

    const sourceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "runninghub-backpressure.png",
      "runninghub-backpressure-input",
    );

    const createResult = await executionsService.createExecution(createAIImageToPlyRequest({
      userId: "user-a",
      workflowId: RUNNINGHUB_BACKPRESSURE_QUERY_WORKFLOW_ID,
      nodeType: "aiImageToPly",
      taskType: "image-to-ply",
      executionMode: "legacy-grouped-task",
      nodeId: "node-runninghub-backpressure-query",
      nodeTitle: "runninghub backpressure query",
      groups: [
        {
          groupId: "group-backpressure-1",
          sourceFileId,
        },
      ],
    }));

    const taskId = createResult.tasks[0]!.taskId;

    await executionsRepository.claimQueuedTaskById(taskId);
    await executionsRepository.appendTaskEvent({
      taskId,
      attemptNo: 1,
      eventType: "task_retry_scheduled",
      status: "processing",
      phase: "retrying",
      stepType: "final",
      progress: 0,
      message: "RunningHub 队列繁忙，2000ms 后由后端重新排队执行。",
      payload: {
        errorCode: "PROVIDER_ERROR",
        errorMessage: "RunningHub 队列繁忙，等待后端重新调度。",
        providerCode: "task_queue_maxed",
        delayMs: 2000,
        backpressure: true,
      },
    });
    await executionsRepository.requeueTask({
      taskId,
      errorCode: "PROVIDER_ERROR",
      errorMessage: "RunningHub 队列繁忙，等待后端重新调度。",
    });

    const taskDetail = await queryService.getTaskDetail(taskId);
    const taskEvents = await queryService.getTaskEvents(taskId);

    assert.ok(taskDetail);
    assert.equal(taskDetail?.status, "queued");
    assert.equal(taskDetail?.lastErrorCode, "PROVIDER_ERROR");
    assert.equal(taskDetail?.lastErrorMessage, "RunningHub 队列繁忙，等待后端重新调度。");
    assert.ok(
      taskDetail?.recentEvents.some((event: ExecutionTaskEventPayload) =>
        event.eventType === "task_retry_scheduled"
        && event.message?.includes("RunningHub 队列繁忙"),
      ),
    );

    assert.ok(taskEvents);
    const backpressureEvent = taskEvents?.items.find(
      (event: ExecutionTaskEventPayload) =>
        event.eventType === "task_retry_scheduled"
        && event.payload?.providerCode === "task_queue_maxed",
    );

    assert.equal(backpressureEvent?.payload?.backpressure, true);
    assert.equal(backpressureEvent?.payload?.delayMs, 2000);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}
