import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import zlib from "node:zlib";

import { WorkflowRepository } from "../workflows/workflow.repository.ts";
import { ExecutionsRepository } from "./executions.repository.ts";
import { FilesRepository } from "../files/files.repository.ts";
import { WorkflowTaskHistoryRepository } from "../workflows/workflow-task-history.repository.ts";
import { ExecutionQueryService } from "./execution-query.service.ts";
import type { AuthenticatedAccount } from "../auth/auth.service.ts";
import type { AIVideoGenCreateExecutionRequest } from "@newworkflow/backend-shared/api";

function createAuthenticatedAccount(userId: string): AuthenticatedAccount {
  return {
      user: {
        userId,
        email: `${userId}@example.com`,
        displayName: userId,
        role: "member",
        status: "enabled",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        lastLoginAt: null,
      },
      accessTokenPayload: {
        userId,
        role: "member",
        status: "enabled",
      },
    };
}

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

test("ExecutionQueryService returns the latest completed run for a workflow node reconcile query", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "execution-query-service-"));

  try {
    const workflowRepository = new WorkflowRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const filesRepository = new FilesRepository(rootDir);
    const workflowTaskHistoryRepository = new WorkflowTaskHistoryRepository(rootDir);
    const service = new ExecutionQueryService(
      executionsRepository,
      filesRepository,
      workflowRepository,
      workflowTaskHistoryRepository,
    );

    await workflowRepository.createWorkflow("user-1", {
      id: "workflow-1",
      projectId: "project-1",
      name: "Workflow 1",
      nodes: {
        "100": {
          id: "100",
          type: "aiVideoGen",
        },
      },
      connections: [],
      viewport: {
        x: 0,
        y: 0,
        zoom: 1,
      },
      metadata: {},
      timestamp: Date.now(),
    });

    const requestPayload: AIVideoGenCreateExecutionRequest = {
      workflowId: "workflow-1",
      nodeType: "aiVideoGen",
      taskType: "video-gen",
      executionMode: "legacy-grouped-task",
      nodeId: "100",
      nodeTitle: "AI Video Gen",
      prompt: "Create a demo video",
      model: "veo-3.1-fast-generate-preview",
      duration: 8,
      groups: [{
        groupId: "group-1",
        referenceFileIds: ["file-ref-1"],
      }],
    };

    const olderRun = await executionsRepository.createExecution({
      run: {
        userId: "user-1",
        workflowId: "workflow-1",
        projectId: "project-1",
        nodeType: "aiVideoGen",
        taskType: "video-gen",
        executionMode: "legacy-grouped-task",
        nodeId: "100",
        nodeTitle: "AI Video Gen",
        provider: "laozhang-veo",
        requestPayload,
      },
      tasks: [{
        workflowId: "workflow-1",
        projectId: "project-1",
        nodeType: "aiVideoGen",
        nodeId: "100",
        nodeTitle: "AI Video Gen",
        taskType: "video-gen",
        groupId: "group-1",
        groupOrder: 0,
        provider: "laozhang-veo",
        model: "veo-3.1-fast-generate-preview",
        input: {
          prompt: "older",
        },
      }],
    });
    const newerRun = await executionsRepository.createExecution({
      run: {
        userId: "user-1",
        workflowId: "workflow-1",
        projectId: "project-1",
        nodeType: "aiVideoGen",
        taskType: "video-gen",
        executionMode: "legacy-grouped-task",
        nodeId: "100",
        nodeTitle: "AI Video Gen",
        provider: "laozhang-veo",
        requestPayload: {
          ...requestPayload,
          groups: [{
            groupId: "group-2",
            referenceFileIds: ["file-ref-2"],
          }],
        },
      },
      tasks: [{
        workflowId: "workflow-1",
        projectId: "project-1",
        nodeType: "aiVideoGen",
        nodeId: "100",
        nodeTitle: "AI Video Gen",
        taskType: "video-gen",
        groupId: "group-2",
        groupOrder: 1,
        provider: "laozhang-veo",
        model: "veo-3.1-fast-generate-preview",
        input: {
          prompt: "newer",
        },
      }],
    });

    await executionsRepository.updateTaskResultFile(olderRun.tasks[0].taskId, "file-older");
    await executionsRepository.markTaskCompleted(olderRun.tasks[0].taskId);

    await new Promise((resolve) => setTimeout(resolve, 10));

    await executionsRepository.updateTaskResultFile(newerRun.tasks[0].taskId, "file-newer");
    await executionsRepository.markTaskCompleted(newerRun.tasks[0].taskId);

    const result = await service.getLatestCompletedWorkflowNodeRunForActor(
      createAuthenticatedAccount("user-1"),
      "workflow-1",
      "100",
    );

    assert.ok(result);
    assert.equal(result?.runId, newerRun.runId);
    assert.equal(result?.tasks.length, 1);
    assert.equal(result?.tasks[0]?.groupId, "group-2");
    assert.equal(result?.tasks[0]?.resultFileId, "file-newer");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("ExecutionQueryService reconcile query hydrates preview fields without provider event payload lookups", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "execution-query-service-reconcile-preview-"));

  try {
    const workflowRepository = new WorkflowRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const filesRepository = new FilesRepository(rootDir);
    const workflowTaskHistoryRepository = new WorkflowTaskHistoryRepository(rootDir);
    const service = new ExecutionQueryService(
      executionsRepository,
      filesRepository,
      workflowRepository,
      workflowTaskHistoryRepository,
    );

    await workflowRepository.createWorkflow("user-1", {
      id: "workflow-reconcile-preview-1",
      projectId: "project-1",
      name: "Workflow Reconcile Preview 1",
      nodes: {
        "300": {
          id: "300",
          type: "aiImageGen",
        },
      },
      connections: [],
      viewport: {
        x: 0,
        y: 0,
        zoom: 1,
      },
      metadata: {},
      timestamp: Date.now(),
    });

    const resultBuffer = createSamplePng(1600, 900);
    const resultFile = await filesRepository.registerFile({
      userId: "user-1",
      sha256: createHash("sha256").update(resultBuffer).digest("hex"),
      size: resultBuffer.length,
      mimeType: "image/png",
      originalName: "reconcile-result.png",
      fileType: "image",
      sourceType: "output",
    });

    if (resultFile.uploadRequired && resultFile.uploadId) {
      await filesRepository.uploadFile(resultFile.uploadId, resultBuffer.toString("base64"));
    }

    const created = await executionsRepository.createExecution({
      run: {
        userId: "user-1",
        workflowId: "workflow-reconcile-preview-1",
        projectId: "project-1",
        nodeType: "aiImageGen",
        taskType: "image-gen",
        executionMode: "legacy-grouped-task",
        nodeId: "300",
        nodeTitle: "Reconcile Image Node",
        provider: "laozhang",
        requestPayload: {
          workflowId: "workflow-reconcile-preview-1",
          nodeType: "aiImageGen",
          taskType: "image-gen",
          executionMode: "legacy-grouped-task",
          nodeId: "300",
          nodeTitle: "Reconcile Image Node",
          prompt: "preview only",
          groups: [{ groupId: "group-1", referenceFileIds: [] }],
        },
      },
      tasks: [{
        workflowId: "workflow-reconcile-preview-1",
        projectId: "project-1",
        nodeType: "aiImageGen",
        nodeId: "300",
        nodeTitle: "Reconcile Image Node",
        taskType: "image-gen",
        groupId: "group-1",
        groupOrder: 0,
        provider: "laozhang",
        model: "gpt-image-2-vip",
        input: {
          prompt: "preview only",
        },
      }],
    });

    const taskId = created.tasks[0]!.taskId;
    await executionsRepository.updateTaskResultFile(taskId, resultFile.file.fileId);
    await executionsRepository.markTaskCompleted(taskId);

    let getTaskEventsCallCount = 0;
    const originalGetTaskEvents = executionsRepository.getTaskEvents.bind(executionsRepository);
    executionsRepository.getTaskEvents = (async (
      ...args: Parameters<ExecutionsRepository["getTaskEvents"]>
    ) => {
      getTaskEventsCallCount += 1;
      return originalGetTaskEvents(...args);
    }) as ExecutionsRepository["getTaskEvents"];

    let findFilesByIdsCallCount = 0;
    const originalFindFilesByIds = filesRepository.findFilesByIds.bind(filesRepository);
    filesRepository.findFilesByIds = (async (
      ...args: Parameters<FilesRepository["findFilesByIds"]>
    ) => {
      findFilesByIdsCallCount += 1;
      return originalFindFilesByIds(...args);
    }) as FilesRepository["findFilesByIds"];

    const result = await service.getLatestCompletedWorkflowNodeRunForActor(
      createAuthenticatedAccount("user-1"),
      "workflow-reconcile-preview-1",
      "300",
    );

    assert.ok(result);
    assert.equal(result?.tasks.length, 1);
    assert.equal(result?.tasks[0]?.resultFile?.fileId, resultFile.file.fileId);
    assert.equal(result?.tasks[0]?.resultFile?.downloadUrl, `/api/v1/files/${resultFile.file.fileId}/download`);
    assert.equal(result?.tasks[0]?.resultFile?.thumbnailUrl, `/api/v1/files/${resultFile.file.fileId}/thumbnail`);
    assert.equal(result?.tasks[0]?.resultFile?.previewUrl, `/api/v1/files/${resultFile.file.fileId}/preview`);
    assert.equal(result?.tasks[0]?.providerTaskId, null);
    assert.equal(result?.tasks[0]?.providerClientId, null);
    assert.equal(result?.tasks[0]?.inputFile, null);
    assert.equal(result?.tasks[0]?.sourceFile, null);
    assert.equal(result?.tasks[0]?.renderFile, null);
    assert.equal(result?.tasks[0]?.referenceFile, null);
    assert.equal(result?.tasks[0]?.whiteModelFile, null);
    assert.equal(result?.tasks[0]?.styleReferenceFile, null);
    assert.equal(getTaskEventsCallCount, 0);
    assert.equal(findFilesByIdsCallCount, 1);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("ExecutionQueryService hydrates workflow task history summary fields from stored input and provider events", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "execution-query-service-history-"));

  try {
    const workflowRepository = new WorkflowRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const filesRepository = new FilesRepository(rootDir);
    const workflowTaskHistoryRepository = new WorkflowTaskHistoryRepository(rootDir);
    const service = new ExecutionQueryService(
      executionsRepository,
      filesRepository,
      workflowRepository,
      workflowTaskHistoryRepository,
    );

    await workflowRepository.createWorkflow("user-1", {
      id: "workflow-history-1",
      projectId: "project-1",
      name: "Workflow History 1",
      nodes: {
        "200": {
          id: "200",
          type: "aiImageGen",
        },
      },
      connections: [],
      viewport: {
        x: 0,
        y: 0,
        zoom: 1,
      },
      metadata: {},
      timestamp: Date.now(),
    });

    const referenceBuffer = createSamplePng(1200, 900);
    const referenceFile = await filesRepository.registerFile({
      userId: "user-1",
      sha256: createHash("sha256").update(referenceBuffer).digest("hex"),
      size: referenceBuffer.length,
      mimeType: "image/png",
      originalName: "reference.png",
      fileType: "image",
      sourceType: "input",
    });

    if (referenceFile.uploadRequired && referenceFile.uploadId) {
      await filesRepository.uploadFile(referenceFile.uploadId, referenceBuffer.toString("base64"));
    }

    const resultBuffer = createSamplePng(1600, 900);
    const resultFile = await filesRepository.registerFile({
      userId: "user-1",
      sha256: createHash("sha256").update(resultBuffer).digest("hex"),
      size: resultBuffer.length,
      mimeType: "image/png",
      originalName: "result.png",
      fileType: "image",
      sourceType: "output",
    });

    if (resultFile.uploadRequired && resultFile.uploadId) {
      await filesRepository.uploadFile(resultFile.uploadId, resultBuffer.toString("base64"));
    }

    const created = await executionsRepository.createExecution({
      run: {
        userId: "user-1",
        workflowId: "workflow-history-1",
        projectId: "project-1",
        nodeType: "aiImageGen",
        taskType: "image-gen",
        executionMode: "legacy-grouped-task",
        nodeId: "200",
        nodeTitle: "Image Gen Node",
        provider: "laozhang",
        requestPayload: {
          workflowId: "workflow-history-1",
          nodeType: "aiImageGen",
          taskType: "image-gen",
          executionMode: "legacy-grouped-task",
          nodeId: "200",
          nodeTitle: "Image Gen Node",
          prompt: "generate room",
          imageSize: "2K",
          aspectRatio: "4:5",
          groups: [{ groupId: "group-1", referenceFileIds: [referenceFile.file.fileId] }],
        },
      },
      tasks: [{
        workflowId: "workflow-history-1",
        projectId: "project-1",
        nodeType: "aiImageGen",
        nodeId: "200",
        nodeTitle: "Image Gen Node",
        taskType: "image-gen",
        groupId: "group-1",
        groupOrder: 0,
        provider: "laozhang",
        model: "gpt-image-2-vip",
        input: {
          model: "gpt-image-2-vip",
          prompt: "generate room",
          referenceFileIds: [referenceFile.file.fileId],
          imageSize: "2K",
          aspectRatio: "4:5",
        },
      }],
    });

    const taskId = created.tasks[0]!.taskId;
    const taskRecord = await executionsRepository.getTaskById(taskId);

    if (!taskRecord) {
      throw new Error("Expected task record to exist.");
    }

    await workflowTaskHistoryRepository.recordExecutionCreated(
      {
        id: created.runId,
        runNo: created.runNo,
        userId: "user-1",
        workflowId: "workflow-history-1",
        projectId: "project-1",
        nodeType: "aiImageGen",
        taskType: "image-gen",
        executionMode: "legacy-grouped-task",
        nodeId: "200",
        nodeTitle: "Image Gen Node",
        provider: "laozhang",
        status: "queued",
        totalTaskCount: 1,
        completedTaskCount: 0,
        failedTaskCount: 0,
        createdAt: taskRecord.createdAt,
        startedAt: null,
        completedAt: null,
        resultSummary: null,
        requestPayload: {
          workflowId: "workflow-history-1",
          nodeType: "aiImageGen",
          taskType: "image-gen",
          executionMode: "legacy-grouped-task",
          nodeId: "200",
          nodeTitle: "Image Gen Node",
          prompt: "generate room",
          imageSize: "2K",
          aspectRatio: "4:5",
          groups: [{ groupId: "group-1", referenceFileIds: [referenceFile.file.fileId] }],
        },
      },
      [taskRecord],
      [{
        id: "event-queued-1",
        runId: created.runId,
        taskId,
        eventType: "task_queued",
        attemptNo: null,
        status: "queued",
        phase: "queued",
        stepType: null,
        progress: 0,
        message: "queued",
        payload: null,
        createdAt: taskRecord.createdAt,
      }],
    );

    await executionsRepository.updateTaskResultFile(taskId, resultFile.file.fileId);
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
      progress: 72,
      message: "provider running",
      payload: {
        providerTaskId: "provider-task-1",
        providerClientId: "provider-client-1",
      },
    });
    await executionsRepository.markTaskCompleted(taskId);

    const updatedTask = await executionsRepository.getTaskById(taskId);
    if (!updatedTask) {
      throw new Error("Expected updated task record to exist.");
    }

    await workflowTaskHistoryRepository.syncTask(updatedTask);
    await workflowTaskHistoryRepository.appendTaskEvent(updatedTask, {
      id: "event-provider-1",
      runId: created.runId,
      taskId,
      eventType: "step_final_started",
      attemptNo: 2,
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 72,
      message: "provider running",
      payload: {
        providerTaskId: "provider-task-1",
        providerClientId: "provider-client-1",
      },
      createdAt: new Date(Date.parse(taskRecord.createdAt) + 1_000).toISOString(),
    });

    const list = await service.listWorkflowTasksForActor(
      createAuthenticatedAccount("user-1"),
      "workflow-history-1",
      {
        page: 1,
        pageSize: 10,
      },
    );
    const detail = await service.getWorkflowTaskDetailForActor(
      createAuthenticatedAccount("user-1"),
      "workflow-history-1",
      taskId,
    );
    const events = await service.getWorkflowTaskEventsForActor(
      createAuthenticatedAccount("user-1"),
      "workflow-history-1",
      taskId,
      { page: 1, pageSize: 10, sortOrder: "asc" },
    );

    assert.ok(list);
    assert.equal(list?.items[0]?.taskId, taskId);
    assert.equal(list?.items[0]?.nodeType, "aiImageGen");
    assert.equal(list?.items[0]?.taskType, "image-gen");
    assert.equal(list?.items[0]?.provider, "laozhang");
    assert.equal(list?.items[0]?.model, "gpt-image-2-vip");
    assert.equal(list?.items[0]?.inputFileId, null);
    assert.equal(list?.items[0]?.sourceFileId, null);
    assert.equal(list?.items[0]?.prompt, "generate room");
    assert.deepEqual(list?.items[0]?.referenceFileIds, [referenceFile.file.fileId]);
    assert.equal(list?.items[0]?.imageSize, "2K");
    assert.equal(list?.items[0]?.aspectRatio, "4:5");
    assert.equal(list?.items[0]?.providerTaskId, "provider-task-1");
    assert.equal(list?.items[0]?.providerClientId, "provider-client-1");
    assert.equal(list?.items[0]?.resultFile?.fileId, resultFile.file.fileId);
    assert.equal(list?.items[0]?.resultFile?.downloadUrl, `/api/v1/files/${resultFile.file.fileId}/download`);
    assert.equal(list?.items[0]?.resultFile?.thumbnailUrl, `/api/v1/files/${resultFile.file.fileId}/thumbnail`);
    assert.equal(list?.items[0]?.resultFile?.previewUrl, `/api/v1/files/${resultFile.file.fileId}/preview`);

    assert.ok(detail);
    assert.equal(detail?.taskId, taskId);
    assert.equal(detail?.model, "gpt-image-2-vip");
    assert.equal(detail?.prompt, "generate room");
    assert.deepEqual(detail?.referenceFileIds, [referenceFile.file.fileId]);
    assert.equal(detail?.providerTaskId, "provider-task-1");
    assert.equal(detail?.providerClientId, "provider-client-1");
    assert.equal(detail?.resultFile?.downloadUrl, `/api/v1/files/${resultFile.file.fileId}/download`);
    assert.equal(detail?.resultFile?.thumbnailUrl, `/api/v1/files/${resultFile.file.fileId}/thumbnail`);
    assert.equal(detail?.resultFile?.previewUrl, `/api/v1/files/${resultFile.file.fileId}/preview`);
    assert.ok(detail?.recentEvents.some((event) => event.eventType === "step_final_started"));

    assert.ok(events);
    assert.equal(events?.messageType, "task_event");
    assert.ok(events?.items.some((event) => event.payload?.providerTaskId === "provider-task-1"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("ExecutionQueryService exposes aiImageInpaint source and mask input fields", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "execution-query-service-inpaint-"));

  try {
    const workflowRepository = new WorkflowRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const filesRepository = new FilesRepository(rootDir);
    const workflowTaskHistoryRepository = new WorkflowTaskHistoryRepository(rootDir);
    const service = new ExecutionQueryService(
      executionsRepository,
      filesRepository,
      workflowRepository,
      workflowTaskHistoryRepository,
    );

    const sourceBuffer = createSamplePng(1280, 720);
    const sourceFile = await filesRepository.registerFile({
      userId: "user-1",
      sha256: createHash("sha256").update(sourceBuffer).digest("hex"),
      size: sourceBuffer.length,
      mimeType: "image/png",
      originalName: "source.png",
      fileType: "image",
      sourceType: "input",
    });

    if (sourceFile.uploadRequired && sourceFile.uploadId) {
      await filesRepository.uploadFile(sourceFile.uploadId, sourceBuffer.toString("base64"));
    }

    const maskBuffer = createSamplePng(1280, 720);
    const maskFile = await filesRepository.registerFile({
      userId: "user-1",
      sha256: createHash("sha256").update(maskBuffer).digest("hex"),
      size: maskBuffer.length,
      mimeType: "image/png",
      originalName: "mask.png",
      fileType: "image",
      sourceType: "input",
    });

    if (maskFile.uploadRequired && maskFile.uploadId) {
      await filesRepository.uploadFile(maskFile.uploadId, maskBuffer.toString("base64"));
    }

    const created = await executionsRepository.createExecution({
      run: {
        userId: "user-1",
        workflowId: "workflow-inpaint-1",
        projectId: "project-1",
        nodeType: "aiImageInpaint",
        taskType: "image-inpaint",
        executionMode: "legacy-grouped-task",
        nodeId: "400",
        nodeTitle: "Image Inpaint Node",
        provider: "laozhang",
        requestPayload: {
          workflowId: "workflow-inpaint-1",
          nodeType: "aiImageInpaint",
          taskType: "image-inpaint",
          executionMode: "legacy-grouped-task",
          nodeId: "400",
          nodeTitle: "Image Inpaint Node",
          prompt: "replace marked area",
          model: "gemini-3-pro-image-preview",
          imageSize: "1K",
          aspectRatio: "auto",
          maskMode: "strong-mask",
          groups: [{
            groupId: "main",
            sourceFileId: sourceFile.file.fileId,
            maskFileId: maskFile.file.fileId,
          }],
        },
      },
      tasks: [{
        workflowId: "workflow-inpaint-1",
        projectId: "project-1",
        nodeType: "aiImageInpaint",
        nodeId: "400",
        nodeTitle: "Image Inpaint Node",
        taskType: "image-inpaint",
        groupId: "main",
        groupOrder: 1,
        provider: "laozhang",
        model: "gemini-3-pro-image-preview",
        input: {
          prompt: "replace marked area",
          model: "gemini-3-pro-image-preview",
          inputFileId: sourceFile.file.fileId,
          sourceFileId: sourceFile.file.fileId,
          maskFileId: maskFile.file.fileId,
          maskMode: "strong-mask",
          imageSize: "1K",
          aspectRatio: "auto",
        },
      }],
    });

    const detail = await service.getTaskDetail(created.tasks[0]!.taskId);

    assert.ok(detail);
    assert.equal(detail?.nodeType, "aiImageInpaint");
    assert.equal(detail?.taskType, "image-inpaint");
    assert.equal(detail?.sourceFileId, sourceFile.file.fileId);
    assert.equal(detail?.maskFileId, maskFile.file.fileId);
    assert.equal(detail?.maskMode, "strong-mask");
    assert.equal(detail?.prompt, "replace marked area");
    assert.equal(detail?.imageSize, "1K");
    assert.equal(detail?.aspectRatio, "auto");
    assert.equal(detail?.sourceFile?.fileId, sourceFile.file.fileId);
    assert.equal(detail?.maskFile?.fileId, maskFile.file.fileId);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
