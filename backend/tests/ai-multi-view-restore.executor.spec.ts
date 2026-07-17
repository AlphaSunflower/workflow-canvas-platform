import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_MULTI_VIEW_RESTORE_WORKFLOW_ID,
  AI_MULTI_VIEW_RESTORE_WORKFLOW_TEMPLATE_KEY,
} from "../shared/src/index.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { AIMultiViewRestoreTaskExecutor } from "../worker/src/modules/executors/ai-multi-view-restore.executor.ts";
import { LocalStorageAdapter } from "../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../worker/src/modules/storage/storage.service.ts";
import { createAIMultiViewRestoreRequest } from "./helpers/execution-request.fixture.ts";

const TEST_WORKFLOW_ID = "workflow-ai-multi-view-restore-executor";

async function registerReadyFile(
  filesRepository: FilesRepository,
  userId: string,
  originalName: string,
  mimeType: string,
  content: string,
): Promise<string> {
  const buffer = Buffer.from(content);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const registerResult = await filesRepository.registerFile({
    userId,
    sha256,
    size: buffer.length,
    mimeType,
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

async function createClaimedTask(input: {
  rootDir: string;
  renderFileId: string;
  referenceFileId: string;
  groupId?: string;
}) {
  const filesRepository = new FilesRepository(input.rootDir);
  const executionsRepository = new ExecutionsRepository(input.rootDir);
  const executionsService = ExecutionsService.fromRoot(input.rootDir);

  const createResult = await executionsService.createExecution(createAIMultiViewRestoreRequest({
    userId: "user-a",
    workflowId: TEST_WORKFLOW_ID,
    nodeType: "aiMultiViewRestore",
    taskType: "multi-view-restore",
    executionMode: "legacy-grouped-task",
    nodeId: "node-multi-view-restore",
    nodeTitle: "Multi View Restore",
    groups: [
      {
        groupId: input.groupId ?? "group-1",
        renderFileId: input.renderFileId,
        referenceFileId: input.referenceFileId,
      },
    ],
  }));

  await executionsRepository.claimQueuedTasks(1);
  const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
  assert.ok(task);

  return {
    filesRepository,
    executionsRepository,
    createResult,
    task: task!,
  };
}

async function runSuccessScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-multi-view-restore-executor-success-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const renderFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "render.png",
      "image/png",
      "render-image-content",
    );
    const referenceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference.jpg",
      "image/jpeg",
      "reference-image-content",
    );

    const prepared = await createClaimedTask({
      rootDir,
      renderFileId,
      referenceFileId,
    });
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));
    const providerCalls: Array<Record<string, unknown>> = [];
    let queryCount = 0;

    const executor = new AIMultiViewRestoreTaskExecutor(
      prepared.executionsRepository,
      prepared.filesRepository,
      {
        async uploadFile(input) {
          providerCalls.push({
            stage: "upload",
            fileName: input.fileName,
            mimeType: input.mimeType,
            text: input.fileBuffer.toString("utf8"),
            snapshotLabel: input.snapshotLabel,
          });

          return {
            fileName: input.snapshotLabel === `${prepared.task.taskNo}-upload-render`
              ? "rh-render-upload.png"
              : "rh-reference-upload.jpg",
          };
        },
        async createWorkflowTask(input) {
          providerCalls.push({
            stage: "create",
            workflowId: input.workflowId,
            nodeInfoList: input.nodeInfoList,
            snapshotLabel: input.snapshotLabel,
          });

          return {
            taskId: "rh-task-mvr-001",
            taskStatus: "QUEUED",
            clientId: "rh-client-mvr-001",
            promptTips: "{\"result\": true, \"error\": null, \"outputs_to_execute\": [\"127\"], \"node_errors\": {}}",
            promptTipsSummary: {
              parseStatus: "parsed",
              result: true,
              outputsToExecute: ["127"],
            },
          };
        },
        async queryTaskResultV2(input) {
          queryCount += 1;
          providerCalls.push({
            stage: "query",
            taskId: input.taskId,
            snapshotLabel: input.snapshotLabel,
          });

          if (queryCount === 1) {
            return {
              taskId: "rh-task-mvr-001",
              taskStatus: "RUNNING",
              clientId: "rh-client-mvr-001",
              promptTips: "{\"result\": true}",
              errorCode: null,
              errorMessage: null,
              results: [],
            };
          }

          return {
            taskId: "rh-task-mvr-001",
            taskStatus: "SUCCESS",
            clientId: "rh-client-mvr-001",
            promptTips: "{\"result\": true}",
            errorCode: null,
            errorMessage: null,
            results: [
              {
                fileUrl: "https://example.test/images/output-127.png",
                fileType: "png",
                nodeId: "127",
                taskCostTime: 12,
              },
              {
                fileUrl: "https://example.test/images/output-999.png",
                fileType: "png",
                nodeId: "999",
                taskCostTime: 12,
              },
            ],
          };
        },
      },
      {
        async buildNodeInfoList(input) {
          providerCalls.push({
            stage: "template",
            templateKey: input.templateKey,
            uploadedFileNames: input.uploadedFileNames,
            snapshotLabel: input.snapshotLabel,
          });

          return {
            workflowId: AI_MULTI_VIEW_RESTORE_WORKFLOW_ID,
            nodeInfoList: [
              {
                nodeId: "124",
                fieldName: "image",
                fieldValue: input.uploadedFileNames?.render ?? "",
              },
              {
                nodeId: "102",
                fieldName: "image",
                fieldValue: input.uploadedFileNames?.reference ?? "",
              },
            ],
            snapshotPath: path.join(rootDir, "node-info-list-success.json"),
          };
        },
      },
      storageService,
      async (input) => {
        assert.equal(String(input), "https://example.test/images/output-127.png");
        return new Response(Buffer.from("multi-view-image-content"), {
          status: 200,
          headers: {
            "Content-Type": "image/png",
          },
        });
      },
      {
        pollIntervalMs: 1,
        maxPollAttempts: 5,
        sleepImpl: async () => {},
      },
    );

    const result = await executor.execute({
      runId: prepared.createResult.runId,
      task: prepared.task,
    });

    await prepared.executionsRepository.markTaskCompleted(prepared.task.id);

    assert.equal(result.providerTaskId, "rh-task-mvr-001");
    assert.equal(result.providerClientId, "rh-client-mvr-001");
    assert.equal(result.renderUploadedFileName, "rh-render-upload.png");
    assert.equal(result.referenceUploadedFileName, "rh-reference-upload.jpg");
    assert.equal(result.resultFileUrl, "https://example.test/images/output-127.png");
    assert.equal(result.resultNodeId, "127");
    assert.ok(result.resultFileId);
    assert.ok(result.resultStorageKey);

    assert.deepEqual(providerCalls, [
      {
        stage: "upload",
        fileName: `${prepared.task.taskNo}-render.png`,
        mimeType: "image/png",
        text: "render-image-content",
        snapshotLabel: `${prepared.task.taskNo}-upload-render`,
      },
      {
        stage: "upload",
        fileName: `${prepared.task.taskNo}-reference.jpg`,
        mimeType: "image/jpeg",
        text: "reference-image-content",
        snapshotLabel: `${prepared.task.taskNo}-upload-reference`,
      },
      {
        stage: "template",
        templateKey: AI_MULTI_VIEW_RESTORE_WORKFLOW_TEMPLATE_KEY,
        uploadedFileNames: {
          render: "rh-render-upload.png",
          reference: "rh-reference-upload.jpg",
        },
        snapshotLabel: `${prepared.task.taskNo}-node-info-list`,
      },
      {
        stage: "create",
        workflowId: AI_MULTI_VIEW_RESTORE_WORKFLOW_ID,
        nodeInfoList: [
          {
            nodeId: "124",
            fieldName: "image",
            fieldValue: "rh-render-upload.png",
          },
          {
            nodeId: "102",
            fieldName: "image",
            fieldValue: "rh-reference-upload.jpg",
          },
        ],
        snapshotLabel: `${prepared.task.taskNo}-create-task`,
      },
      {
        stage: "query",
        taskId: "rh-task-mvr-001",
        snapshotLabel: `${prepared.task.taskNo}-query-result-v2-001`,
      },
      {
        stage: "query",
        taskId: "rh-task-mvr-001",
        snapshotLabel: `${prepared.task.taskNo}-query-result-v2-002`,
      },
    ]);

    const savedTask = await prepared.executionsRepository.getTaskById(prepared.task.id);
    const events = await prepared.executionsRepository.getTaskEvents(prepared.task.id);
    const resultFile = await prepared.filesRepository.findFileById(result.resultFileId);
    const resultContent = await prepared.filesRepository.readFileContent(result.resultFileId);

    assert.equal(savedTask?.resultFileId, result.resultFileId);
    assert.equal(savedTask?.status, "completed");
    assert.equal(savedTask?.currentStep, "final");
    assert.ok(events.some((event) => event.eventType === "step_final_started"));
    assert.ok(events.some((event) =>
      event.eventType === "task_progress"
      && event.message === "双输入 nodeInfoList 已生成。"
    ));
    assert.ok(events.some((event) => event.eventType === "task_artifact_received"));
    assert.ok(events.some((event) =>
      event.eventType === "task_artifact_received"
      && event.payload?.selectedBy === "output-node"
    ));
    assert.ok(events.some((event) => event.eventType === "step_final_completed"));
    assert.ok(events.some((event) => event.eventType === "task_completed"));
    assert.equal(resultFile?.sourceType, "output");
    assert.equal(resultFile?.fileType, "image");
    assert.equal(resultFile?.userId, "user-a");
    assert.ok(resultFile?.downloadUrl);
    assert.equal(resultContent?.buffer.toString("utf8"), "multi-view-image-content");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runFallbackScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-multi-view-restore-executor-fallback-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const renderFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "render.png",
      "image/png",
      "render-image-content",
    );
    const referenceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference.png",
      "image/png",
      "reference-image-content",
    );

    const prepared = await createClaimedTask({
      rootDir,
      renderFileId,
      referenceFileId,
      groupId: "group-fallback",
    });
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));

    const executor = new AIMultiViewRestoreTaskExecutor(
      prepared.executionsRepository,
      prepared.filesRepository,
      {
        async uploadFile(input) {
          return {
            fileName: input.snapshotLabel === `${prepared.task.taskNo}-upload-render`
              ? "render-uploaded.png"
              : "reference-uploaded.png",
          };
        },
        async createWorkflowTask() {
          return {
            taskId: "rh-task-mvr-002",
            taskStatus: "QUEUED",
            clientId: "rh-client-mvr-002",
            promptTips: "{\"result\": true}",
            promptTipsSummary: {
              parseStatus: "parsed",
              result: true,
            },
          };
        },
        async queryTaskResultV2() {
          return {
            taskId: "rh-task-mvr-002",
            taskStatus: "SUCCESS",
            clientId: "rh-client-mvr-002",
            promptTips: "{\"result\": true}",
            errorCode: null,
            errorMessage: null,
            results: [
              {
                fileUrl: "https://example.test/images/only-result.webp",
                fileType: "webp",
                nodeId: "888",
                taskCostTime: 6,
              },
            ],
          };
        },
      },
      {
        async buildNodeInfoList() {
          return {
            workflowId: AI_MULTI_VIEW_RESTORE_WORKFLOW_ID,
            nodeInfoList: [
              {
                nodeId: "124",
                fieldName: "image",
                fieldValue: "render-uploaded.png",
              },
              {
                nodeId: "102",
                fieldName: "image",
                fieldValue: "reference-uploaded.png",
              },
            ],
            snapshotPath: path.join(rootDir, "node-info-list-fallback.json"),
          };
        },
      },
      storageService,
      async (input) => {
        assert.equal(String(input), "https://example.test/images/only-result.webp");
        return new Response(Buffer.from("fallback-image"), {
          status: 200,
          headers: {
            "Content-Type": "image/webp",
          },
        });
      },
      {
        pollIntervalMs: 1,
        maxPollAttempts: 2,
        sleepImpl: async () => {},
      },
    );

    const result = await executor.execute({
      runId: prepared.createResult.runId,
      task: prepared.task,
    });

    assert.equal(result.resultNodeId, "888");
    const events = await prepared.executionsRepository.getTaskEvents(prepared.task.id);
    assert.ok(events.some((event) =>
      event.eventType === "task_artifact_received"
      && event.payload?.selectedBy === "first-result"
    ));
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function runProtocolErrorScenario(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-multi-view-restore-executor-protocol-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const renderFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "render.png",
      "image/png",
      "render-image-content",
    );
    const referenceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "reference.png",
      "image/png",
      "reference-image-content",
    );

    const prepared = await createClaimedTask({
      rootDir,
      renderFileId,
      referenceFileId,
      groupId: "group-error",
    });
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));

    const executor = new AIMultiViewRestoreTaskExecutor(
      prepared.executionsRepository,
      prepared.filesRepository,
      {
        async uploadFile(input) {
          return {
            fileName: input.snapshotLabel === `${prepared.task.taskNo}-upload-render`
              ? "render-uploaded.png"
              : "reference-uploaded.png",
          };
        },
        async createWorkflowTask() {
          return {
            taskId: "rh-task-mvr-003",
            taskStatus: "QUEUED",
            clientId: "rh-client-mvr-003",
            promptTips: "{\"result\": true}",
            promptTipsSummary: {
              parseStatus: "parsed",
              result: true,
            },
          };
        },
        async queryTaskResultV2() {
          return {
            taskId: "rh-task-mvr-003",
            taskStatus: "SUCCESS",
            clientId: "rh-client-mvr-003",
            promptTips: "{\"result\": true}",
            errorCode: null,
            errorMessage: null,
            results: [
              {
                fileUrl: "https://example.test/images/result-a.png",
                fileType: "png",
                nodeId: "888",
                taskCostTime: 8,
              },
              {
                fileUrl: "https://example.test/images/result-b.png",
                fileType: "png",
                nodeId: "999",
                taskCostTime: 8,
              },
            ],
          };
        },
      },
      {
        async buildNodeInfoList() {
          return {
            workflowId: AI_MULTI_VIEW_RESTORE_WORKFLOW_ID,
            nodeInfoList: [
              {
                nodeId: "124",
                fieldName: "image",
                fieldValue: "render-uploaded.png",
              },
              {
                nodeId: "102",
                fieldName: "image",
                fieldValue: "reference-uploaded.png",
              },
            ],
            snapshotPath: path.join(rootDir, "node-info-list-protocol.json"),
          };
        },
      },
      storageService,
      async () => new Response(Buffer.from("unused"), { status: 200 }),
      {
        pollIntervalMs: 1,
        maxPollAttempts: 2,
        sleepImpl: async () => {},
      },
    );

    await assert.rejects(
      () =>
        executor.execute({
          runId: prepared.createResult.runId,
          task: prepared.task,
        }),
      (error: unknown) =>
        Boolean(
          error
          && typeof error === "object"
          && (error as { code?: string }).code === "INVALID_RESPONSE"
          && String((error as { message?: string }).message).includes("127"),
        ),
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

async function run(): Promise<void> {
  await runSuccessScenario();
  await runFallbackScenario();
  await runProtocolErrorScenario();
}

void run();
