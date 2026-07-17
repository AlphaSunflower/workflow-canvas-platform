import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AuthenticatedAccount } from "../api/src/modules/auth/auth.service.ts";
import { ExecutionQueryService } from "../api/src/modules/executions/execution-query.service.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesService } from "../api/src/modules/files/files.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { WorkflowRepository } from "../api/src/modules/workflows/workflow.repository.ts";

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

async function registerReadyFile(
  filesRepository: FilesRepository,
  userId: string,
  originalName: string,
  content: string,
  sourceType: "input" | "output" = "input",
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
    sourceType,
  });

  if (registerResult.uploadRequired && registerResult.uploadId) {
    await filesRepository.uploadFile(
      registerResult.uploadId,
      buffer.toString("base64"),
    );
  }

  return registerResult.file.fileId;
}

test("execution output ownership keeps task userId and result file userId aligned", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "execution-output-ownership-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const workflowRepository = new WorkflowRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = new ExecutionsService(
      executionsRepository,
      filesRepository,
      workflowRepository,
    );

    await workflowRepository.createWorkflow("user-1", {
      id: "workflow-output-ownership",
      projectId: "project-output-ownership",
      name: "Workflow Output Ownership",
      nodes: {},
      connections: [],
      viewport: {
        x: 0,
        y: 0,
        zoom: 1,
      },
      metadata: {},
      timestamp: Date.now(),
    });

    const referenceFileId = await registerReadyFile(
      filesRepository,
      "user-1",
      "reference.png",
      "reference-content",
    );

    const createResult = await executionsService.createExecutionForActor(
      createAuthenticatedAccount("user-1"),
      {
        workflowId: "workflow-output-ownership",
        nodeType: "aiImageGen",
        taskType: "image-gen",
        executionMode: "legacy-grouped-task",
        nodeId: "node-image-gen",
        nodeTitle: "AI Image Gen",
        prompt: "output owner alignment",
        imageSize: "1K",
        aspectRatio: "1:1",
        groups: [
          {
            groupId: "group-1",
            referenceFileIds: [referenceFileId],
          },
        ],
      },
    );

    const task = await executionsRepository.getTaskById(createResult.tasks[0]!.taskId);
    assert.ok(task);
    assert.equal(task?.userId, "user-1");

    const resultFileId = await registerReadyFile(
      filesRepository,
      "user-1",
      "result.png",
      "result-content",
      "output",
    );

    await executionsRepository.updateTaskResultFile(createResult.tasks[0]!.taskId, resultFileId);

    const resultFile = await filesRepository.findFileById(resultFileId);
    assert.ok(resultFile);
    assert.equal(resultFile?.userId, task?.userId);
    assert.equal(resultFile?.sourceType, "output");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("mis-owned result file is blocked for the task owner and remains readable only by the wrong owner", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "execution-output-misowned-"));

  try {
    const filesRepository = new FilesRepository(rootDir);
    const filesService = new FilesService(filesRepository);
    const workflowRepository = new WorkflowRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const executionsService = new ExecutionsService(
      executionsRepository,
      filesRepository,
      workflowRepository,
    );
    const queryService = ExecutionQueryService.fromRoot(rootDir);

    await workflowRepository.createWorkflow("user-1", {
      id: "workflow-misowned-output",
      projectId: "project-misowned-output",
      name: "Workflow Misowned Output",
      nodes: {},
      connections: [],
      viewport: {
        x: 0,
        y: 0,
        zoom: 1,
      },
      metadata: {},
      timestamp: Date.now(),
    });

    const referenceFileId = await registerReadyFile(
      filesRepository,
      "user-1",
      "reference.png",
      "reference-content",
    );

    const createResult = await executionsService.createExecutionForActor(
      createAuthenticatedAccount("user-1"),
      {
        workflowId: "workflow-misowned-output",
        nodeType: "aiImageGen",
        taskType: "image-gen",
        executionMode: "legacy-grouped-task",
        nodeId: "node-image-gen",
        nodeTitle: "AI Image Gen",
        prompt: "mis-owned output",
        imageSize: "1K",
        aspectRatio: "1:1",
        groups: [
          {
            groupId: "group-1",
            referenceFileIds: [referenceFileId],
          },
        ],
      },
    );

    const wrongOwnerResultFileId = await registerReadyFile(
      filesRepository,
      "user-2",
      "wrong-owner-result.png",
      "wrong-owner-result-content",
      "output",
    );

    await executionsRepository.updateTaskResultFile(
      createResult.tasks[0]!.taskId,
      wrongOwnerResultFileId,
    );
    await executionsRepository.markTaskCompleted(createResult.tasks[0]!.taskId);

    const runDetail = await queryService.getExecutionRunForActor(
      createAuthenticatedAccount("user-1"),
      createResult.runId,
    );
    assert.ok(runDetail);
    assert.equal(runDetail?.tasks[0]?.resultFileId, wrongOwnerResultFileId);
    assert.equal(runDetail?.tasks[0]?.resultFile?.userId, "user-2");

    await assert.rejects(
      () => filesService.downloadFileForActor(
        createAuthenticatedAccount("user-1"),
        wrongOwnerResultFileId,
      ),
      /FILE_ACCESS_FORBIDDEN/,
    );

    const wrongOwnerDownload = await filesService.downloadFileForActor(
      createAuthenticatedAccount("user-2"),
      wrongOwnerResultFileId,
    );
    assert.ok(wrongOwnerDownload);
    assert.equal(wrongOwnerDownload?.buffer.toString("utf8"), "wrong-owner-result-content");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
