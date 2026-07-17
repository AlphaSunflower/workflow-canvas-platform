import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  bearer,
  cleanupDbE2EContext,
  closeDbApi,
  createDbE2EContext,
  promoteUserToAdmin,
  registerAccount,
  registerAndUploadFile,
  requestJson,
  startDbApi,
} from "./bootstrap-db.ts";
import { DbExecutionsRepository } from "../../api/src/modules/executions/db-executions.repository.ts";

async function exists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(
    () => true,
    () => false,
  );
}

async function run(): Promise<void> {
  const context = await createDbE2EContext("admin_full");
  const api = await startDbApi(context);
  const legacyDataRoot = path.join(context.rootDir, "data");

  try {
    await fs.rm(legacyDataRoot, { recursive: true, force: true });
    assert.equal(await exists(path.join(legacyDataRoot, "accounts-store.json")), false);
    assert.equal(await exists(path.join(legacyDataRoot, "files", "files-store.json")), false);
    assert.equal(await exists(path.join(legacyDataRoot, "executions-store.json")), false);
    assert.equal(await exists(path.join(legacyDataRoot, "workflows", "index.json")), false);

    const admin = await registerAccount(api.baseUrl, {
      email: "admin-full-db@example.com",
      password: "admin-full-db-pass",
      displayName: "Admin Full DB",
    });
    const member = await registerAccount(api.baseUrl, {
      email: "member-full-db@example.com",
      password: "member-full-db-pass",
      displayName: "Member Full DB",
    });
    await promoteUserToAdmin(context, admin.userId);

    const adminLogin = await requestJson<{
      tokens: { accessToken: string };
    }>(api.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      payload: {
        email: "admin-full-db@example.com",
        password: "admin-full-db-pass",
      },
    });
    assert.equal(adminLogin.status, 200);
    const adminHeaders = bearer(adminLogin.body.data!.tokens.accessToken);
    const memberHeaders = bearer(member.accessToken);

    const inputFile = await registerAndUploadFile(api.baseUrl, member.accessToken, {
      originalName: "admin-full-input.png",
      displayName: "Admin Full Input",
      sourceType: "input",
    });
    const outputFile = await registerAndUploadFile(api.baseUrl, member.accessToken, {
      content: "admin-full-output-content",
      originalName: "admin-full-output.bin",
      displayName: "Admin Full Output",
      sourceType: "output",
      fileType: "unknown",
      mimeType: "application/octet-stream",
    });

    const workflowResponse = await requestJson<{ workflowId: string }>(
      api.baseUrl,
      "/api/v1/workflows",
      {
        method: "POST",
        headers: memberHeaders,
        payload: {
          id: "workflow-admin-full-db",
          projectId: "project-admin-full-db",
          name: "Admin Full DB Workflow",
          nodes: {
            "file-node": {
              id: "file-node",
              type: "image",
              fileId: inputFile.fileId,
            },
            "reference-node": {
              id: "reference-node",
              type: "aiImageHd",
              references: [
                {
                  id: "ref-1",
                  fileId: inputFile.fileId,
                },
              ],
            },
          },
          connections: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          metadata: { source: "admin-full-db" },
          timestamp: 1770000500000,
        },
      },
    );
    assert.equal(workflowResponse.status, 201);

    const executionResponse = await requestJson<{
      runId: string;
      tasks: Array<{ taskId: string }>;
    }>(api.baseUrl, "/api/v1/executions", {
      method: "POST",
      headers: memberHeaders,
      payload: {
        workflowId: "workflow-admin-full-db",
        nodeType: "aiImageHd",
        taskType: "image-hd",
        executionMode: "legacy-grouped-task",
        nodeId: "reference-node",
        nodeTitle: "Admin Full HD Node",
        groups: [
          {
            groupId: "group-admin-full",
            sourceFileId: inputFile.fileId,
            imageSize: "1K",
            aspectRatio: "1:1",
          },
        ],
      },
    });
    assert.equal(executionResponse.status, 201);
    const runId = executionResponse.body.data!.runId;
    const taskId = executionResponse.body.data!.tasks[0]!.taskId;
    const executionsRepository = new DbExecutionsRepository(context.databaseConfig);
    assert.ok(await executionsRepository.claimQueuedTaskById(taskId));
    await executionsRepository.updateTaskResultFile(taskId, outputFile.fileId);
    await executionsRepository.appendTaskEvent({
      taskId,
      attemptNo: 1,
      eventType: "step_final_completed",
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 95,
      message: "admin full output linked",
      payload: { resultFileId: outputFile.fileId },
    });
    await executionsRepository.markTaskCompleted(taskId);

    const memberOverview = await requestJson(api.baseUrl, "/api/v1/admin/overview", {
      headers: memberHeaders,
    });
    assert.equal(memberOverview.status, 403);
    assert.equal(memberOverview.body.error, "AUTH_FORBIDDEN");

    const overview = await requestJson<{
      files: { total: number; ready: number };
      workflows: { total: number };
      executions: { totalRuns: number };
      users: { admins: number; members: number };
      storage: { issueCount: number };
    }>(api.baseUrl, "/api/v1/admin/overview", {
      headers: adminHeaders,
    });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data?.files.total, 2);
    assert.equal(overview.body.data?.files.ready, 2);
    assert.equal(overview.body.data?.workflows.total, 1);
    assert.equal(overview.body.data?.executions.totalRuns, 1);
    assert.equal(overview.body.data?.users.admins, 1);
    assert.equal(overview.body.data?.users.members, 1);
    assert.equal(overview.body.data?.storage.issueCount, 0);

    const files = await requestJson<{
      items: Array<{ fileId: string; sourceType: string; displayName: string }>;
      total: number;
      page: number;
      pageSize: number;
    }>(api.baseUrl, "/api/v1/admin/files?page=1&pageSize=10&q=Admin%20Full", {
      headers: adminHeaders,
    });
    assert.equal(files.status, 200);
    assert.equal(files.body.data?.total, 2);
    assert.ok(files.body.data?.items.some((file) => file.fileId === inputFile.fileId && file.sourceType === "input"));
    assert.ok(files.body.data?.items.some((file) => file.fileId === outputFile.fileId && file.sourceType === "output"));

    const inputUsage = await requestJson<{
      file: { fileId: string };
      workflows: Array<{ workflowId: string; nodeId: string | null; role: string }>;
      tasks: Array<{ taskId: string; runId: string | null; role: string }>;
    }>(api.baseUrl, `/api/v1/admin/files/${inputFile.fileId}`, {
      headers: adminHeaders,
    });
    assert.equal(inputUsage.status, 200);
    assert.equal(inputUsage.body.data?.file.fileId, inputFile.fileId);
    assert.ok(inputUsage.body.data?.workflows.some((item) =>
      item.workflowId === "workflow-admin-full-db"
      && item.nodeId === "file-node"
      && item.role === "file-node"));
    assert.ok(inputUsage.body.data?.tasks.some((item) =>
      item.taskId === taskId
      && item.runId === runId
      && item.role === "input"));

    const outputUsage = await requestJson<{
      file: { fileId: string };
      tasks: Array<{ taskId: string; role: string }>;
    }>(api.baseUrl, `/api/v1/admin/files/${outputFile.fileId}`, {
      headers: adminHeaders,
    });
    assert.equal(outputUsage.status, 200);
    assert.ok(outputUsage.body.data?.tasks.some((item) =>
      item.taskId === taskId && item.role === "output"));

    const executions = await requestJson<{
      items: Array<{ runId: string; workflowId: string | null; status: string }>;
      total: number;
    }>(api.baseUrl, "/api/v1/admin/executions?workflowId=workflow-admin-full-db&page=1&pageSize=10", {
      headers: adminHeaders,
    });
    assert.equal(executions.status, 200);
    assert.equal(executions.body.data?.total, 1);
    assert.equal(executions.body.data?.items[0]?.runId, runId);
    assert.equal(executions.body.data?.items[0]?.status, "completed");

    const executionDetail = await requestJson<{
      runId: string;
      status: string;
      tasks: Array<{ taskId: string; resultFileId: string | null }>;
      inputFiles: Array<{ fileId: string }>;
      outputFiles: Array<{ fileId: string }>;
    }>(api.baseUrl, `/api/v1/admin/executions/${runId}`, {
      headers: adminHeaders,
    });
    assert.equal(executionDetail.status, 200);
    assert.equal(executionDetail.body.data?.runId, runId);
    assert.equal(executionDetail.body.data?.status, "completed");
    assert.equal(executionDetail.body.data?.tasks[0]?.taskId, taskId);
    assert.equal(executionDetail.body.data?.tasks[0]?.resultFileId, outputFile.fileId);
    assert.ok(executionDetail.body.data?.inputFiles.some((file) => file.fileId === inputFile.fileId));
    assert.ok(executionDetail.body.data?.outputFiles.some((file) => file.fileId === outputFile.fileId));

    const workflows = await requestJson<{
      items: Array<{ workflowId: string; ownerUserId: string; name: string }>;
      total: number;
    }>(api.baseUrl, `/api/v1/admin/workflows?ownerUserId=${encodeURIComponent(member.userId)}&q=Full`, {
      headers: adminHeaders,
    });
    assert.equal(workflows.status, 200);
    assert.equal(workflows.body.data?.total, 1);
    assert.equal(workflows.body.data?.items[0]?.workflowId, "workflow-admin-full-db");
    assert.equal(workflows.body.data?.items[0]?.ownerUserId, member.userId);

    const workflowDetail = await requestJson<{
      workflowId: string;
      ownerUserId: string;
      workflow: { metadata: Record<string, unknown> };
      files: Array<{ fileId: string }>;
      tasks: Array<{ taskId: string; resultFileId: string | null }>;
    }>(api.baseUrl, "/api/v1/admin/workflows/workflow-admin-full-db", {
      headers: adminHeaders,
    });
    assert.equal(workflowDetail.status, 200);
    assert.equal(workflowDetail.body.data?.workflowId, "workflow-admin-full-db");
    assert.equal(workflowDetail.body.data?.ownerUserId, member.userId);
    assert.equal(workflowDetail.body.data?.workflow.metadata.source, "admin-full-db");
    assert.ok(workflowDetail.body.data?.files.some((file) => file.fileId === inputFile.fileId));
    assert.ok(workflowDetail.body.data?.tasks.some((task) =>
      task.taskId === taskId && task.resultFileId === outputFile.fileId));

    const users = await requestJson<{
      items: Array<{ userId: string; email: string; role: string }>;
      total: number;
    }>(api.baseUrl, "/api/v1/admin/read/users?page=1&pageSize=10", {
      headers: adminHeaders,
    });
    assert.equal(users.status, 200);
    assert.equal(users.body.data?.total, 2);
    assert.ok(users.body.data?.items.some((user) => user.userId === admin.userId && user.role === "admin"));
    assert.ok(users.body.data?.items.some((user) => user.userId === member.userId && user.role === "member"));

    const noIssues = await requestJson<{
      total: number;
      items: Array<{ type: string }>;
    }>(api.baseUrl, "/api/v1/admin/storage/issues", {
      headers: adminHeaders,
    });
    assert.equal(noIssues.status, 200);
    assert.equal(noIssues.body.data?.total, 0);

    const blobRows = await context.pool.query<{ storage_key: string }>(
      "select storage_key from file_blobs where id = $1::uuid",
      [outputFile.file.blobId],
    );
    const storageKey = blobRows.rows[0]!.storage_key;
    await fs.rm(path.join(context.rootDir, "storage", storageKey), { force: true });

    const storageIssues = await requestJson<{
      items: Array<{
        type: string;
        severity: string;
        fileId: string | null;
        blobId: string | null;
        storageKey: string | null;
      }>;
      total: number;
    }>(api.baseUrl, "/api/v1/admin/storage/issues?type=missing_storage_object&severity=error", {
      headers: adminHeaders,
    });
    assert.equal(storageIssues.status, 200);
    assert.equal(storageIssues.body.data?.total, 1);
    assert.equal(storageIssues.body.data?.items[0]?.type, "missing_storage_object");
    assert.equal(storageIssues.body.data?.items[0]?.severity, "error");
    assert.equal(storageIssues.body.data?.items[0]?.fileId, outputFile.fileId);
    assert.equal(storageIssues.body.data?.items[0]?.blobId, outputFile.file.blobId);
    assert.equal(storageIssues.body.data?.items[0]?.storageKey, storageKey);

    assert.equal(await exists(path.join(legacyDataRoot, "accounts-store.json")), false);
    assert.equal(await exists(path.join(legacyDataRoot, "files", "files-store.json")), false);
    assert.equal(await exists(path.join(legacyDataRoot, "executions-store.json")), false);
    assert.equal(await exists(path.join(legacyDataRoot, "workflows", "index.json")), false);
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
