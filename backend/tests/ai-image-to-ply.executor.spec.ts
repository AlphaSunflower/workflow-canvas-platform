import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_IMAGE_TO_PLY_WORKFLOW_ID,
  AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
} from "../shared/src/index.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { AIImageToPlyTaskExecutor } from "../worker/src/modules/executors/ai-image-to-ply.executor.ts";
import { LocalStorageAdapter } from "../worker/src/modules/storage/local-storage.adapter.ts";
import { StorageService } from "../worker/src/modules/storage/storage.service.ts";
import { createAIImageToPlyRequest } from "./helpers/execution-request.fixture.ts";

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

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-image-to-ply-executor-test-"));
  const testWorkflowId = "workflow-ai-image-to-ply-executor";

  try {
    const filesRepository = new FilesRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = ExecutionsService.fromRoot(rootDir);
    const storageService = new StorageService(new LocalStorageAdapter(rootDir));
    const providerCalls: Array<Record<string, unknown>> = [];
    let queryCount = 0;

    const executor = new AIImageToPlyTaskExecutor(
      executionsRepository,
      filesRepository,
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
            fileName: "runninghub-uploaded-input.png",
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
            taskId: "rh-task-001",
            taskStatus: "QUEUED",
            clientId: "rh-client-001",
            promptTips: "{\"result\": true, \"error\": null, \"outputs_to_execute\": [\"9\"], \"node_errors\": {}}",
            promptTipsSummary: {
              parseStatus: "parsed",
              result: true,
              outputsToExecute: ["9"],
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
              taskId: "rh-task-001",
              taskStatus: "QUEUED",
              clientId: "rh-client-001",
              promptTips: "{\"result\": true}",
              errorCode: null,
              errorMessage: null,
              results: [],
            };
          }

          if (queryCount === 2) {
            return {
              taskId: "rh-task-001",
              taskStatus: "RUNNING",
              clientId: "rh-client-001",
              promptTips: "{\"result\": true}",
              errorCode: null,
              errorMessage: null,
              results: [],
            };
          }

          return {
            taskId: "rh-task-001",
            taskStatus: "SUCCESS",
            clientId: "rh-client-001",
            promptTips: "{\"result\": true}",
            errorCode: null,
            errorMessage: null,
            results: [
              {
                fileUrl: "https://example.test/model/output.ply",
                fileType: "ply",
                nodeId: "5",
                taskCostTime: 18,
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
            uploadedFileName: input.uploadedFileName,
            snapshotLabel: input.snapshotLabel,
          });

          return {
            workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
            nodeInfoList: [
              {
                nodeId: "1",
                fieldName: "image",
                fieldValue: input.uploadedFileName,
              },
            ],
            snapshotPath: path.join(rootDir, "node-info-list.json"),
          };
        },
      },
      storageService,
      async (input) => {
        assert.equal(String(input), "https://example.test/model/output.ply");

        return new Response(Buffer.from("ply-model-content"), {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
          },
        });
      },
      {
        pollIntervalMs: 1,
        maxPollAttempts: 5,
        sleepImpl: async () => {},
      },
    );

    const sourceFileId = await registerReadyFile(
      filesRepository,
      "user-a",
      "source-image.png",
      "image/png",
      "source-image-content",
    );

    const createResult = await executionsService.createExecution(createAIImageToPlyRequest({
      userId: "user-a",
      workflowId: testWorkflowId,
      nodeType: "aiImageToPly",
      taskType: "image-to-ply",
      executionMode: "legacy-grouped-task",
      nodeId: "node-image-to-ply",
      nodeTitle: "Image To PLY",
      groups: [
        {
          groupId: "group-1",
          sourceFileId,
        },
      ],
    }));

    await executionsRepository.claimQueuedTasks(1);

    const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
    assert.ok(task);

    const result = await executor.execute({
      runId: createResult.runId,
      task: task!,
    });

    await executionsRepository.markTaskCompleted(createResult.tasks[0]!.taskId);

    assert.equal(result.providerTaskId, "rh-task-001");
    assert.equal(result.providerClientId, "rh-client-001");
    assert.equal(result.uploadedFileName, "runninghub-uploaded-input.png");
    assert.equal(result.resultFileUrl, "https://example.test/model/output.ply");
    assert.ok(result.resultFileId);
    assert.ok(result.resultStorageKey);

    assert.deepEqual(providerCalls, [
      {
        stage: "upload",
        fileName: `${task!.taskNo}.png`,
        mimeType: "image/png",
        text: "source-image-content",
        snapshotLabel: `${task!.taskNo}-upload`,
      },
      {
        stage: "template",
        templateKey: AI_IMAGE_TO_PLY_WORKFLOW_TEMPLATE_KEY,
        uploadedFileName: "runninghub-uploaded-input.png",
        snapshotLabel: `${task!.taskNo}-node-info-list`,
      },
      {
        stage: "create",
        workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
        nodeInfoList: [
          {
            nodeId: "1",
            fieldName: "image",
            fieldValue: "runninghub-uploaded-input.png",
          },
        ],
        snapshotLabel: `${task!.taskNo}-create-task`,
      },
      {
        stage: "query",
        taskId: "rh-task-001",
        snapshotLabel: `${task!.taskNo}-query-result-v2-001`,
      },
      {
        stage: "query",
        taskId: "rh-task-001",
        snapshotLabel: `${task!.taskNo}-query-result-v2-002`,
      },
      {
        stage: "query",
        taskId: "rh-task-001",
        snapshotLabel: `${task!.taskNo}-query-result-v2-003`,
      },
    ]);

    const savedTask = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
    const events = await executionsRepository.getTaskEvents(createResult.tasks[0]!.taskId);
    const resultFile = await filesRepository.findFileById(result.resultFileId);
    const resultContent = await filesRepository.readFileContent(result.resultFileId);

    assert.equal(savedTask?.resultFileId, result.resultFileId);
    assert.equal(savedTask?.status, "completed");
    assert.equal(savedTask?.currentStep, "final");
    assert.ok(events.some((event) => event.eventType === "step_final_started"));
    assert.ok(events.some((event) => event.eventType === "task_artifact_received"));
    assert.ok(events.some((event) => event.eventType === "step_final_completed"));
    assert.ok(events.some((event) => event.eventType === "task_completed"));
    assert.ok(events.some((event) =>
      event.eventType === "task_progress"
      && event.payload
      && event.payload.pollAttempt === 1,
    ));
    assert.equal(resultFile?.sourceType, "output");
    assert.equal(resultFile?.fileType, "ply");
    assert.equal(resultFile?.userId, "user-a");
    assert.equal(resultFile?.previewUrl, undefined);
    assert.equal(resultContent?.buffer.toString("utf8"), "ply-model-content");

    const invalidTypeExecutor = new AIImageToPlyTaskExecutor(
      executionsRepository,
      filesRepository,
      {
        async uploadFile() {
          return {
            fileName: "runninghub-uploaded-input.png",
          };
        },
        async createWorkflowTask() {
          return {
            taskId: "rh-task-002",
            taskStatus: "QUEUED",
            clientId: "rh-client-002",
            promptTips: "{\"result\": true}",
            promptTipsSummary: {
              parseStatus: "parsed",
              result: true,
            },
          };
        },
        async queryTaskResultV2() {
          return {
            taskId: "rh-task-002",
            taskStatus: "SUCCESS",
            clientId: "rh-client-002",
            promptTips: null,
            errorCode: null,
            errorMessage: null,
            results: [
              {
                fileUrl: "https://example.test/model/output.obj",
                fileType: "obj",
                nodeId: "5",
                taskCostTime: 12,
              },
            ],
          };
        },
      },
      {
        async buildNodeInfoList() {
          return {
            workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
            nodeInfoList: [
              {
                nodeId: "1",
                fieldName: "image",
                fieldValue: "runninghub-uploaded-input.png",
              },
            ],
            snapshotPath: path.join(rootDir, "node-info-list-invalid.json"),
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
        invalidTypeExecutor.execute({
          runId: createResult.runId,
          task: task!,
        }),
      /RUNNINGHUB_RESULT_FILE_TYPE_INVALID/,
    );

    const missingUrlExecutor = new AIImageToPlyTaskExecutor(
      executionsRepository,
      filesRepository,
      {
        async uploadFile() {
          return {
            fileName: "runninghub-uploaded-input.png",
          };
        },
        async createWorkflowTask() {
          return {
            taskId: "rh-task-003",
            taskStatus: "QUEUED",
            clientId: "rh-client-003",
            promptTips: "{\"result\": true}",
            promptTipsSummary: {
              parseStatus: "parsed",
              result: true,
            },
          };
        },
        async queryTaskResultV2() {
          return {
            taskId: "rh-task-003",
            taskStatus: "SUCCESS",
            clientId: "rh-client-003",
            promptTips: null,
            errorCode: null,
            errorMessage: null,
            results: [
              {
                fileUrl: "",
                fileType: "ply",
                nodeId: "5",
                taskCostTime: 7,
              },
            ],
          };
        },
      },
      {
        async buildNodeInfoList() {
          return {
            workflowId: AI_IMAGE_TO_PLY_WORKFLOW_ID,
            nodeInfoList: [
              {
                nodeId: "1",
                fieldName: "image",
                fieldValue: "runninghub-uploaded-input.png",
              },
            ],
            snapshotPath: path.join(rootDir, "node-info-list-missing-url.json"),
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
        missingUrlExecutor.execute({
          runId: createResult.runId,
          task: task!,
        }),
      /RUNNINGHUB_RESULT_FILE_URL_MISSING/,
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
