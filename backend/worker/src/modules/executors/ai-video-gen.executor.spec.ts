import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ExecutionsRepository } from "../../../../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../../../../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../../../../api/src/modules/files/files.repository.ts";
import { WorkflowRepository } from "../../../../api/src/modules/workflows/workflow.repository.ts";
import { AIVideoGenTaskExecutor } from "./ai-video-gen.executor.ts";
import { VideoGenerateHelper } from "./video-generate.helper.ts";
import { LocalStorageAdapter } from "../storage/local-storage.adapter.ts";
import { StorageService } from "../storage/storage.service.ts";

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

test("AIVideoGenTaskExecutor polls provider, downloads mp4 and registers video output asset", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-video-gen-executor-test-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const workflowRepository = new WorkflowRepository(rootDir);
    const executionsService = new ExecutionsService(
      executionsRepository,
      filesRepository,
      workflowRepository,
    );
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));
    const providerCalls: Array<{ type: string; payload: Record<string, unknown> }> = [];
    let statusPollCount = 0;

    const helper = new VideoGenerateHelper(
      executionsRepository,
      filesRepository,
      {
        async createVideoTask(input) {
          providerCalls.push({
            type: "create",
            payload: {
              prompt: input.prompt,
              model: input.model,
              duration: input.duration,
              aspectRatio: input.aspectRatio,
              resolution: input.resolution,
              size: input.size,
              referenceCount: input.inputReferences?.length ?? 0,
              contents: (input.inputReferences ?? []).map((item) => item.buffer.toString("utf8")),
            },
          });

          return {
            id: "provider-video-1",
            status: "queued",
            snapshotPath: path.join(rootDir, "create.json"),
          };
        },
        async getVideoTask(input) {
          statusPollCount += 1;
          providerCalls.push({
            type: "status",
            payload: {
              videoId: input.videoId,
            },
          });

          return {
            id: input.videoId,
            status: statusPollCount === 1 ? "in_progress" : "completed",
            videoUrl: null,
            errorCode: null,
            errorMessage: null,
            snapshotPath: path.join(rootDir, "status.json"),
          };
        },
        async getVideoContent(input) {
          providerCalls.push({
            type: "content",
            payload: {
              videoId: input.videoId,
            },
          });

          return {
            id: input.videoId,
            status: "completed",
            url: "https://cdn.example.test/video-result.mp4",
            duration: 8,
            resolution: "1920x1080",
            snapshotPath: path.join(rootDir, "content.json"),
          };
        },
        async downloadVideo(input) {
          providerCalls.push({
            type: "download",
            payload: {
              url: input.url,
            },
          });

          return {
            buffer: Buffer.from("video-result-binary"),
            mimeType: "video/mp4",
            size: Buffer.byteLength("video-result-binary"),
            snapshotPath: path.join(rootDir, "download.json"),
          };
        },
      },
      storageService,
      {
        pollIntervalMs: 1,
        timeoutMs: 5000,
        sleepImpl: async () => undefined,
      },
    );
    const executor = new AIVideoGenTaskExecutor(helper);

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

    const createResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-ai-video-gen",
      nodeType: "aiVideoGen",
      taskType: "video-gen",
      executionMode: "legacy-grouped-task",
      nodeId: "node-ai-video-gen",
      nodeTitle: "AI Video Gen",
      prompt: "Create a smooth product demo video",
      model: "veo-3.1-fast-generate-preview",
      duration: 8,
      aspectRatio: "9:16",
      resolution: "1080p",
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: [referenceFileId2, referenceFileId1],
        },
      ],
    });

    await executionsRepository.claimQueuedTasks(1);
    const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
    assert.ok(task);

    const result = await executor.execute({
      runId: createResult.runId,
      task: task!,
    }) as {
      providerVideoId: string;
      resultFileId: string;
      resultStorageKey: string;
    };

    await executionsRepository.markTaskCompleted(createResult.tasks[0]!.taskId);

    assert.equal(result.providerVideoId, "provider-video-1");
    assert.ok(result.resultFileId);
    assert.ok(result.resultStorageKey);
    assert.deepEqual(
      providerCalls.map((item) => item.type),
      ["create", "status", "status", "content", "download"],
    );
    assert.deepEqual(providerCalls[0]?.payload, {
      prompt: "Create a smooth product demo video",
      model: "veo-3.1-fast-generate-preview",
      duration: 8,
      aspectRatio: "9:16",
      resolution: "1080p",
      size: "1080x1920",
      referenceCount: 2,
      contents: [
        "reference-image-content-2",
        "reference-image-content-1",
      ],
    });

    const savedTask = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
    const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
    const resultFile = await filesRepository.findFileById(result.resultFileId);
    const resultContent = await filesRepository.readFileContent(result.resultFileId);

    assert.equal(savedTask?.resultFileId, result.resultFileId);
    assert.equal(savedTask?.status, "completed");
    assert.equal(resultFile?.fileType, "video");
    assert.equal(resultFile?.sourceType, "output");
    assert.equal(resultFile?.userId, "user-a");
    assert.equal(resultFile?.duration, 8);
    assert.equal(resultContent?.buffer.toString("utf8"), "video-result-binary");
    assert.ok(events.some((event) => event.eventType === "step_final_started"));
    assert.ok(events.some((event) => event.eventType === "task_artifact_received"));
    assert.ok(events.some((event) => event.eventType === "step_final_completed"));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("AIVideoGenTaskExecutor prefers content endpoint over status videoUrl", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-video-gen-status-url-test-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const workflowRepository = new WorkflowRepository(rootDir);
    const executionsService = new ExecutionsService(
      executionsRepository,
      filesRepository,
      workflowRepository,
    );
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));
    const providerCalls: Array<{ type: string; payload: Record<string, unknown> }> = [];

    const helper = new VideoGenerateHelper(
      executionsRepository,
      filesRepository,
      {
        async createVideoTask(input) {
          providerCalls.push({
            type: "create",
            payload: {
              prompt: input.prompt,
              model: input.model,
            },
          });

          return {
            id: "provider-video-status-url",
            status: "queued",
            snapshotPath: path.join(rootDir, "create.json"),
          };
        },
        async getVideoTask(input) {
          providerCalls.push({
            type: "status",
            payload: {
              videoId: input.videoId,
            },
          });

          return {
            id: input.videoId,
            status: "completed",
            videoUrl: "https://cdn.example.test/status-video.mp4",
            errorCode: null,
            errorMessage: null,
            snapshotPath: path.join(rootDir, "status.json"),
          };
        },
        async getVideoContent(input) {
          providerCalls.push({
            type: "content",
            payload: {
              videoId: input.videoId,
            },
          });

          return {
            id: input.videoId,
            status: "completed",
            url: "https://cdn.example.test/content-video.mp4",
            duration: 8,
            resolution: "1280x720",
            snapshotPath: path.join(rootDir, "content.json"),
          };
        },
        async downloadVideo(input) {
          providerCalls.push({
            type: "download",
            payload: {
              url: input.url,
            },
          });

          return {
            buffer: Buffer.from("content-video-binary"),
            mimeType: "video/mp4",
            size: Buffer.byteLength("content-video-binary"),
            snapshotPath: path.join(rootDir, "download.json"),
          };
        },
      },
      storageService,
      {
        pollIntervalMs: 1,
        timeoutMs: 5000,
        sleepImpl: async () => undefined,
      },
    );
    const executor = new AIVideoGenTaskExecutor(helper);

    const referenceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference-1.png",
      "reference-image-content-1",
    );

    const createResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-ai-storyboard-video",
      nodeType: "aiStoryboard",
      taskType: "video-gen",
      executionMode: "legacy-grouped-task",
      nodeId: "node-ai-storyboard",
      nodeTitle: "AI Storyboard",
      prompt: "Storyboard shot prompt",
      model: "veo-3.1-fast-generate-preview",
      duration: 8,
      groups: [
        {
          groupId: "storyboard-shot-1",
          referenceFileIds: [referenceFileId],
        },
      ],
    });

    await executionsRepository.claimQueuedTasks(1);
    const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
    assert.ok(task);

    const result = await executor.execute({
      runId: createResult.runId,
      task: task!,
    }) as {
      providerVideoId: string;
      resultFileId: string;
      resultStorageKey: string;
    };

    await executionsRepository.markTaskCompleted(createResult.tasks[0]!.taskId);

    const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
    const artifactEvent = events.find((event) => event.eventType === "task_artifact_received");
    const resultContent = await filesRepository.readFileContent(result.resultFileId);

    assert.equal(result.providerVideoId, "provider-video-status-url");
    assert.equal(resultContent?.buffer.toString("utf8"), "content-video-binary");
    assert.deepEqual(
      providerCalls.map((item) => item.type),
      ["create", "status", "content", "download"],
    );
    assert.equal(providerCalls[3]?.payload?.url, "https://cdn.example.test/content-video.mp4");
    assert.equal(artifactEvent?.payload?.resolvedFrom, "content");
    assert.equal(
      artifactEvent?.payload?.resultUrl,
      "https://cdn.example.test/content-video.mp4",
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("AIVideoGenTaskExecutor falls back to status videoUrl when content endpoint fails", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-video-gen-status-url-fallback-test-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const workflowRepository = new WorkflowRepository(rootDir);
    const executionsService = new ExecutionsService(
      executionsRepository,
      filesRepository,
      workflowRepository,
    );
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));
    const providerCalls: string[] = [];

    const helper = new VideoGenerateHelper(
      executionsRepository,
      filesRepository,
      {
        async createVideoTask() {
          providerCalls.push("create");
          return {
            id: "provider-video-status-url-fallback",
            status: "queued",
            snapshotPath: path.join(rootDir, "create.json"),
          };
        },
        async getVideoTask(input) {
          providerCalls.push("status");
          return {
            id: input.videoId,
            status: "completed",
            videoUrl: "https://cdn.example.test/status-video.mp4",
            errorCode: null,
            errorMessage: null,
            snapshotPath: path.join(rootDir, "status.json"),
          };
        },
        async getVideoContent() {
          providerCalls.push("content");
          throw new Error("content unavailable");
        },
        async downloadVideo(input) {
          providerCalls.push(`download:${input.url}`);
          return {
            buffer: Buffer.from("status-video-binary"),
            mimeType: "video/mp4",
            size: Buffer.byteLength("status-video-binary"),
            snapshotPath: path.join(rootDir, "download.json"),
          };
        },
      },
      storageService,
      {
        pollIntervalMs: 1,
        timeoutMs: 5000,
        sleepImpl: async () => undefined,
      },
    );
    const executor = new AIVideoGenTaskExecutor(helper);
    const referenceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference-1.png",
      "reference-image-content-1",
    );

    const createResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-ai-storyboard-video",
      nodeType: "aiStoryboard",
      taskType: "video-gen",
      executionMode: "legacy-grouped-task",
      nodeId: "node-ai-storyboard",
      nodeTitle: "AI Storyboard",
      prompt: "Storyboard shot prompt",
      model: "veo-3.1-fast-generate-preview",
      duration: 8,
      groups: [
        {
          groupId: "storyboard-shot-1",
          referenceFileIds: [referenceFileId],
        },
      ],
    });

    await executionsRepository.claimQueuedTasks(1);
    const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
    assert.ok(task);

    const result = await executor.execute({
      runId: createResult.runId,
      task: task!,
    }) as {
      resultFileId: string;
    };
    await executionsRepository.markTaskCompleted(createResult.tasks[0]!.taskId);

    const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
    const artifactEvent = events.find((event) => event.eventType === "task_artifact_received");
    const resultContent = await filesRepository.readFileContent(result.resultFileId);

    assert.deepEqual(providerCalls, [
      "create",
      "status",
      "content",
      "download:https://cdn.example.test/status-video.mp4",
    ]);
    assert.equal(resultContent?.buffer.toString("utf8"), "status-video-binary");
    assert.equal(artifactEvent?.payload?.resolvedFrom, "status-fallback");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("AIVideoGenTaskExecutor retries content endpoint while completed video is still materializing", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-video-gen-content-ready-retry-test-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const workflowRepository = new WorkflowRepository(rootDir);
    const executionsService = new ExecutionsService(
      executionsRepository,
      filesRepository,
      workflowRepository,
    );
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));
    const providerCalls: string[] = [];
    const sleepCalls: number[] = [];
    let contentAttempt = 0;

    const helper = new VideoGenerateHelper(
      executionsRepository,
      filesRepository,
      {
        async createVideoTask() {
          providerCalls.push("create");
          return {
            id: "provider-video-content-ready-delay",
            status: "queued",
            snapshotPath: path.join(rootDir, "create.json"),
          };
        },
        async getVideoTask(input) {
          providerCalls.push("status");
          return {
            id: input.videoId,
            status: "completed",
            videoUrl: null,
            errorCode: null,
            errorMessage: null,
            snapshotPath: path.join(rootDir, "status.json"),
          };
        },
        async getVideoContent(input) {
          contentAttempt += 1;
          providerCalls.push(`content:${contentAttempt}`);
          if (contentAttempt === 1) {
            throw {
              code: "VALIDATION_ERROR",
              message: "Laozhang Veo rejected request parameters.",
              category: "common",
              retryable: false,
              provider: "laozhang-veo",
              details: {
                httpStatus: 400,
                responseBody: "{\"error\":\"task status is IN_PROGRESS, not completed\"}",
                snapshotPath: path.join(rootDir, "content-not-ready.json"),
              },
            };
          }

          return {
            id: input.videoId,
            status: "completed",
            url: "https://cdn.example.test/materialized-video.mp4",
            duration: 8,
            resolution: "1280x720",
            snapshotPath: path.join(rootDir, "content-ready.json"),
          };
        },
        async downloadVideo(input) {
          providerCalls.push(`download:${input.url}`);
          return {
            buffer: Buffer.from("materialized-video-binary"),
            mimeType: "video/mp4",
            size: Buffer.byteLength("materialized-video-binary"),
            snapshotPath: path.join(rootDir, "download.json"),
          };
        },
      },
      storageService,
      {
        pollIntervalMs: 1,
        timeoutMs: 60_000,
        sleepImpl: async (ms) => {
          sleepCalls.push(ms);
        },
      },
    );
    const executor = new AIVideoGenTaskExecutor(helper);
    const referenceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference-1.png",
      "reference-image-content-1",
    );

    const createResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-ai-video-gen",
      nodeType: "aiVideoGen",
      taskType: "video-gen",
      executionMode: "legacy-grouped-task",
      nodeId: "node-ai-video-gen",
      nodeTitle: "AI Video Gen",
      prompt: "Create a smooth product demo video",
      model: "veo-3.1-fast-generate-preview",
      duration: 8,
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: [referenceFileId],
        },
      ],
    });

    await executionsRepository.claimQueuedTasks(1);
    const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
    assert.ok(task);

    const result = await executor.execute({
      runId: createResult.runId,
      task: task!,
    }) as {
      resultFileId: string;
    };
    await executionsRepository.markTaskCompleted(createResult.tasks[0]!.taskId);

    const resultContent = await filesRepository.readFileContent(result.resultFileId);
    const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
    const retryEvent = events.find((event) => (
      event.eventType === "task_progress"
      && event.payload?.contentAttempt === 2
    ));

    assert.deepEqual(providerCalls, [
      "create",
      "status",
      "content:1",
      "content:2",
      "download:https://cdn.example.test/materialized-video.mp4",
    ]);
    assert.deepEqual(sleepCalls, [10_000]);
    assert.equal(resultContent?.buffer.toString("utf8"), "materialized-video-binary");
    assert.equal(retryEvent?.payload?.delayMs, 10_000);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("AIVideoGenTaskExecutor treats provider failed status without details as retryable", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-video-gen-provider-failed-retry-test-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const workflowRepository = new WorkflowRepository(rootDir);
    const executionsService = new ExecutionsService(
      executionsRepository,
      filesRepository,
      workflowRepository,
    );
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));
    let createAttempt = 0;

    const helper = new VideoGenerateHelper(
      executionsRepository,
      filesRepository,
      {
        async createVideoTask() {
          createAttempt += 1;
          return {
            id: `provider-video-${createAttempt}`,
            status: "queued",
            snapshotPath: path.join(rootDir, `create-${createAttempt}.json`),
          };
        },
        async getVideoTask(input) {
          if (input.videoId === "provider-video-1") {
            return {
              id: input.videoId,
              status: "failed",
              videoUrl: null,
              errorCode: null,
              errorMessage: null,
              snapshotPath: path.join(rootDir, "status-provider-failed.json"),
            };
          }

          return {
            id: input.videoId,
            status: "completed",
            videoUrl: null,
            errorCode: null,
            errorMessage: null,
            snapshotPath: path.join(rootDir, "status-completed.json"),
          };
        },
        async getVideoContent(input) {
          return {
            id: input.videoId,
            status: "completed",
            url: "https://cdn.example.test/retried-video.mp4",
            duration: 8,
            resolution: "1280x720",
            snapshotPath: path.join(rootDir, "content.json"),
          };
        },
        async downloadVideo() {
          return {
            buffer: Buffer.from("retried-video-binary"),
            mimeType: "video/mp4",
            size: Buffer.byteLength("retried-video-binary"),
            snapshotPath: path.join(rootDir, "download.json"),
          };
        },
      },
      storageService,
      {
        pollIntervalMs: 1,
        timeoutMs: 60_000,
        sleepImpl: async () => undefined,
      },
    );
    const executor = new AIVideoGenTaskExecutor(helper);
    const referenceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference-1.png",
      "reference-image-content-1",
    );

    const createResult = await executionsService.createExecution({
      userId: "user-a",
      workflowId: "workflow-ai-video-gen",
      nodeType: "aiVideoGen",
      taskType: "video-gen",
      executionMode: "legacy-grouped-task",
      nodeId: "node-ai-video-gen",
      nodeTitle: "AI Video Gen",
      prompt: "Create a smooth product demo video",
      model: "veo-3.1-fast-generate-preview",
      duration: 8,
      groups: [
        {
          groupId: "group-1",
          referenceFileIds: [referenceFileId],
        },
      ],
    });

    await executionsRepository.claimQueuedTasks(1);
    const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
    assert.ok(task);

    await assert.rejects(
      () => executor.execute({
        runId: createResult.runId,
        task: task!,
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "PROVIDER_ERROR");
        assert.equal((error as { retryable?: boolean }).retryable, true);
        assert.equal((error as { providerCode?: string }).providerCode, "LAOZHANG_VEO_TASK_FAILED");
        return true;
      },
    );

    const result = await executor.execute({
      runId: createResult.runId,
      task: task!,
    }) as {
      resultFileId: string;
    };

    const resultContent = await filesRepository.readFileContent(result.resultFileId);

    assert.equal(createAttempt, 2);
    assert.equal(resultContent?.buffer.toString("utf8"), "retried-video-binary");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("AIVideoGenTaskExecutor rejects invalid task input early", async () => {
  const helper = {
    async execute() {
      throw new Error("should not reach helper");
    },
  } as unknown as VideoGenerateHelper;
  const executor = new AIVideoGenTaskExecutor(helper);

  await assert.rejects(
    () => executor.execute({
      runId: "run-invalid",
      task: {
        id: "task-invalid",
        taskNo: "TASK-INVALID",
        runId: "run-invalid",
        userId: "user-a",
        workflowId: null,
        projectId: null,
        nodeType: "aiVideoGen",
        nodeId: "node-invalid",
        nodeTitle: "AI Video Gen",
        taskType: "video-gen",
        groupId: "group-1",
        groupOrder: 1,
        provider: "laozhang-veo",
        model: "veo-3.1-fast-generate-preview",
        input: {
          prompt: "   ",
          model: "veo-3.1-fast-generate-preview",
          duration: 8,
          referenceFileIds: [],
        },
        status: "queued",
        currentStep: null,
        currentAttemptNo: 0,
        retryCount: 0,
        maxRetries: 2,
        lastErrorCode: null,
        lastErrorMessage: null,
        resultFileId: null,
        claimedBy: null,
        claimedAt: null,
        leaseUntil: null,
        heartbeatAt: null,
        attemptStartedAt: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        whiteModelFileId: null,
        styleReferenceFileId: null,
      },
    }),
    /INVALID_AI_VIDEO_GEN_TASK_INPUT/,
  );
});
