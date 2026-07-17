import assert from "node:assert/strict";

import { DbExecutionsRepository } from "../api/src/modules/executions/db-executions.repository.ts";
import { ExecutionQueryService } from "../api/src/modules/executions/execution-query.service.ts";
import type { FilesRepository } from "../api/src/modules/files/files.repository.types.ts";
import { WorkflowTaskHistoryRepository } from "../api/src/modules/workflows/workflow-task-history.repository.ts";
import type { WorkflowRepository } from "../api/src/modules/workflows/workflow.repository.types.ts";
import type {
  FileAssetResponse,
  FileRegisterRequest,
  WorkflowDetailResponseData,
  WorkflowSummaryItem,
} from "../shared/src/index.ts";
import { createAIImageHdRequest } from "./helpers/execution-request.fixture.ts";
import {
  InMemoryExecutionsDatabasePool,
  TEST_DATABASE_CONFIG,
} from "./helpers/in-memory-executions-db.ts";

const INPUT_FILE_ID = "11111111-1111-4111-8111-111111111111";
const OUTPUT_FILE_ID = "22222222-2222-4222-8222-222222222222";

function createFile(fileId: string, sourceType: "input" | "output"): FileAssetResponse {
  return {
    fileId,
    userId: "user-db",
    blobId: `blob-${fileId}`,
    originalName: `${sourceType}.png`,
    displayName: `${sourceType}.png`,
    mimeType: "image/png",
    fileType: "image",
    sourceType,
    sha256: sourceType === "input" ? "a".repeat(64) : "b".repeat(64),
    size: 128,
    extension: "png",
    width: 64,
    height: 64,
    duration: null,
    status: "ready",
    createdAt: "2026-05-20T00:00:00.000Z",
    downloadUrl: `/api/v1/files/${fileId}/download`,
    thumbnailUrl: `/api/v1/files/${fileId}/thumbnail`,
    previewUrl: `/api/v1/files/${fileId}/preview`,
  };
}

class StubFilesRepository implements FilesRepository {
  private readonly files = new Map([
    [INPUT_FILE_ID, createFile(INPUT_FILE_ID, "input")],
    [OUTPUT_FILE_ID, createFile(OUTPUT_FILE_ID, "output")],
  ]);

  async ensureInitialized(): Promise<void> {
    return undefined;
  }

  async findBlobBySha256(): Promise<null> {
    return null;
  }

  async registerFile(_input: FileRegisterRequest): Promise<never> {
    throw new Error("NOT_IMPLEMENTED");
  }

  async uploadFile(): Promise<never> {
    throw new Error("NOT_IMPLEMENTED");
  }

  async findFileById(fileId: string): Promise<FileAssetResponse | null> {
    return this.files.get(fileId) ?? null;
  }

  async findFileRecordById(): Promise<null> {
    return null;
  }

  async findPendingUploadById(): Promise<null> {
    return null;
  }

  async findReadyFilesByIds(fileIds: string[]): Promise<FileAssetResponse[]> {
    return this.findFilesByIds(fileIds);
  }

  async findFilesByIds(fileIds: string[]): Promise<FileAssetResponse[]> {
    return fileIds
      .map((fileId) => this.files.get(fileId))
      .filter((file): file is FileAssetResponse => Boolean(file));
  }

  async readFileContent(): Promise<null> {
    return null;
  }
}

class StubWorkflowRepository implements WorkflowRepository {
  async ensureInitialized(): Promise<void> {
    return undefined;
  }

  async listByOwner(): Promise<WorkflowSummaryItem[]> {
    return [];
  }

  async listByOwnerAndContainer(): Promise<WorkflowSummaryItem[]> {
    return [];
  }

  async listAll(): Promise<WorkflowSummaryItem[]> {
    return [];
  }

  async findSummaryById(workflowId: string): Promise<WorkflowSummaryItem | null> {
    return {
      workflowId,
      projectId: "project-db",
      ownerUserId: "user-db",
      name: "DB Workflow",
      groupId: null,
      containerKey: "root",
      isAutoNamed: false,
      nodeCount: 1,
      connectionCount: 0,
      timestamp: 1710000000000,
      version: 1,
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T00:00:00.000Z",
    };
  }

  async findById(): Promise<WorkflowDetailResponseData | null> {
    return null;
  }

  async createWorkflow(): Promise<never> {
    throw new Error("NOT_IMPLEMENTED");
  }

  async updateWorkflow(): Promise<never> {
    throw new Error("NOT_IMPLEMENTED");
  }

  async updateWorkflowMetadata(): Promise<never> {
    throw new Error("NOT_IMPLEMENTED");
  }

  async deleteWorkflow(): Promise<never> {
    throw new Error("NOT_IMPLEMENTED");
  }
}

async function run(): Promise<void> {
  const pool = new InMemoryExecutionsDatabasePool();
  const repository = new DbExecutionsRepository(TEST_DATABASE_CONFIG, { pool });
  const requestPayload = createAIImageHdRequest({
    userId: "user-db",
    workflowId: "workflow-db",
    nodeId: "node-db",
    nodeTitle: "DB Node",
    groups: [{
      groupId: "group-db",
      sourceFileId: INPUT_FILE_ID,
    }],
  });
  const created = await repository.createExecution({
    run: {
      userId: "user-db",
      workflowId: "workflow-db",
      projectId: "project-db",
      nodeType: "aiImageHd",
      taskType: "image-hd",
      executionMode: "legacy-grouped-task",
      nodeId: "node-db",
      nodeTitle: "DB Node",
      provider: "laozhang",
      requestPayload,
    },
    tasks: [{
      workflowId: "workflow-db",
      projectId: "project-db",
      nodeType: "aiImageHd",
      nodeId: "node-db",
      nodeTitle: "DB Node",
      taskType: "image-hd",
      groupId: "group-db",
      groupOrder: 1,
      provider: "laozhang",
      model: "gemini-3-pro-image-preview",
      input: {
        inputFileId: INPUT_FILE_ID,
        sourceFileId: INPUT_FILE_ID,
        imageSize: "1K",
        aspectRatio: "auto",
      },
    }],
  });
  const taskId = created.tasks[0]!.taskId;

  assert.equal(pool.runs.length, 1);
  assert.equal(pool.tasks.length, 1);
  assert.equal(pool.events[0]?.event_type, "task_queued");
  assert.equal(pool.taskFileLinks.some((link) =>
    link.task_id === taskId
    && link.file_id === INPUT_FILE_ID
    && link.role === "input"), true);

  const claimed = await repository.claimQueuedTaskById(taskId);
  assert.equal(claimed?.task.status, "processing");
  assert.equal(claimed?.task.currentAttemptNo, 1);
  assert.equal((await repository.getExecutionRun(created.runId))?.status, "processing");

  await repository.appendTaskEvent({
    taskId,
    attemptNo: 1,
    eventType: "task_progress",
    status: "processing",
    phase: "processing",
    stepType: "final",
    progress: 80,
    message: "db task progressing",
    payload: {
      providerTaskId: "provider-db-1",
    },
  });
  await repository.updateTaskResultFile(taskId, OUTPUT_FILE_ID);
  await repository.markTaskCompleted(taskId);

  const completedRun = await repository.getExecutionRun(created.runId);
  const completedTask = await repository.getTaskById(taskId);
  const events = await repository.getTaskEvents(taskId);
  const links = await repository.getTaskFileLinks(taskId);
  const latestRun = await repository.findLatestCompletedRunForWorkflowNode(
    "workflow-db",
    "node-db",
  );

  assert.equal(completedRun?.status, "completed");
  assert.equal(completedRun?.completedTaskCount, 1);
  assert.equal(completedTask?.status, "completed");
  assert.equal(completedTask?.resultFileId, OUTPUT_FILE_ID);
  assert.equal(events.map((event) => event.eventType).includes("task_completed"), true);
  assert.equal(links.some((link) =>
    link.fileId === OUTPUT_FILE_ID
    && link.role === "output"
    && link.sourceHandle === "resultFileId"), true);
  assert.equal(latestRun?.id, created.runId);

  const queryService = new ExecutionQueryService(
    repository,
    new StubFilesRepository(),
    new StubWorkflowRepository(),
    new WorkflowTaskHistoryRepository("", {
      databaseConfig: TEST_DATABASE_CONFIG,
      pool,
      mode: "db",
    }),
  );
  const runDetail = await queryService.getExecutionRun(created.runId);
  const taskDetail = await queryService.getTaskDetail(taskId);

  assert.equal(runDetail?.tasks[0]?.taskId, taskId);
  assert.equal(taskDetail?.inputFileId, INPUT_FILE_ID);
  assert.equal(taskDetail?.sourceFile?.fileId, INPUT_FILE_ID);
  assert.equal(taskDetail?.resultFileId, OUTPUT_FILE_ID);
  assert.equal(taskDetail?.resultFile?.fileId, OUTPUT_FILE_ID);
  assert.equal(taskDetail?.providerTaskId, "provider-db-1");
  assert.ok(taskDetail?.recentEvents.some((event) => event.eventType === "task_completed"));

  const leasePool = new InMemoryExecutionsDatabasePool();
  const leaseRepository = new DbExecutionsRepository(TEST_DATABASE_CONFIG, { pool: leasePool });
  const leaseRequestPayload = createAIImageHdRequest({
    userId: "user-lease",
    workflowId: "workflow-lease",
    nodeId: "node-lease",
    nodeTitle: "Lease Node",
    groups: [{
      groupId: "group-lease",
      sourceFileId: INPUT_FILE_ID,
    }],
  });
  const leaseCreated = await leaseRepository.createExecution({
    run: {
      userId: "user-lease",
      workflowId: "workflow-lease",
      projectId: "project-lease",
      nodeType: "aiImageHd",
      taskType: "image-hd",
      executionMode: "legacy-grouped-task",
      nodeId: "node-lease",
      nodeTitle: "Lease Node",
      provider: "laozhang",
      requestPayload: leaseRequestPayload,
    },
    tasks: [{
      workflowId: "workflow-lease",
      projectId: "project-lease",
      nodeType: "aiImageHd",
      nodeId: "node-lease",
      nodeTitle: "Lease Node",
      taskType: "image-hd",
      groupId: "group-lease",
      groupOrder: 1,
      provider: "laozhang",
      model: "gemini-3-pro-image-preview",
      input: {
        inputFileId: INPUT_FILE_ID,
        sourceFileId: INPUT_FILE_ID,
      },
    }],
  });
  const leaseTaskId = leaseCreated.tasks[0]!.taskId;
  const leaseClaim = await leaseRepository.claimQueuedTaskById(leaseTaskId, {
    workerId: "worker-a",
    leaseMs: 60_000,
  });

  assert.equal(leaseClaim?.task.claimedBy, "worker-a");
  assert.ok(leaseClaim?.task.leaseUntil);
  assert.equal(leaseClaim?.task.heartbeatAt, leaseClaim?.task.claimedAt);
  assert.equal(leasePool.attempts[0]?.status, "processing");
  assert.equal(await leaseRepository.claimQueuedTaskById(leaseTaskId, {
    workerId: "worker-b",
    leaseMs: 60_000,
  }), null);

  const heartbeatAccepted = await leaseRepository.heartbeatTaskLease({
    taskId: leaseTaskId,
    workerId: "worker-a",
    leaseMs: 120_000,
  });
  const heartbeatedTask = await leaseRepository.getTaskById(leaseTaskId);

  assert.equal(heartbeatAccepted, true);
  assert.equal(await leaseRepository.heartbeatTaskLease({
    taskId: leaseTaskId,
    workerId: "worker-wrong",
    leaseMs: 120_000,
  }), false);
  assert.equal(heartbeatedTask?.claimedBy, "worker-a");
  assert.ok(heartbeatedTask?.leaseUntil);
  assert.ok(Date.parse(heartbeatedTask.leaseUntil) > Date.parse(leaseClaim.task.leaseUntil!));

  const inMemoryLeaseTask = leasePool.tasks.find((task) => task.id === leaseTaskId);
  assert.ok(inMemoryLeaseTask);
  inMemoryLeaseTask.lease_until = new Date(Date.now() - 1_000).toISOString();

  const queuedWithExpiredLease = await leaseRepository.listQueuedTasks(10);
  assert.equal(queuedWithExpiredLease.some((task) => task.id === leaseTaskId), true);
  assert.equal((await leaseRepository.getQueuedTaskStats()).total, 1);

  const recoveredCount = await leaseRepository.recoverExpiredProcessingTasks({
    workerId: "worker-recovery",
    limit: 10,
  });
  const recoveredTask = await leaseRepository.getTaskById(leaseTaskId);

  assert.equal(recoveredCount, 1);
  assert.equal(recoveredTask?.status, "queued");
  assert.equal(recoveredTask?.claimedBy, null);
  assert.equal(recoveredTask?.leaseUntil, null);
  assert.equal(recoveredTask?.lastErrorCode, "TASK_LEASE_EXPIRED");
  assert.ok(leasePool.attempts.some((attempt) =>
    attempt.task_id === leaseTaskId
    && attempt.attempt_no === 1
    && attempt.status === "failed"
    && attempt.error_code === "TASK_LEASE_EXPIRED"));

  const reclaimed = await leaseRepository.claimQueuedTaskById(leaseTaskId, {
    workerId: "worker-b",
    leaseMs: 60_000,
  });

  assert.equal(reclaimed?.task.claimedBy, "worker-b");
  assert.equal(reclaimed?.task.currentAttemptNo, 2);
}

void run();
