import assert from "node:assert/strict";

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

async function run(): Promise<void> {
  const context = await createDbE2EContext("admin");
  const api = await startDbApi(context);

  try {
    const admin = await registerAccount(api.baseUrl, {
      email: "admin-db-e2e@example.com",
      password: "admin-db-e2e-pass",
      displayName: "Admin DB E2E",
    });
    const member = await registerAccount(api.baseUrl, {
      email: "member-db-e2e@example.com",
      password: "member-db-e2e-pass",
      displayName: "Member DB E2E",
    });
    await promoteUserToAdmin(context, admin.userId);

    const adminLogin = await requestJson<{
      tokens: { accessToken: string };
    }>(api.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      payload: {
        email: "admin-db-e2e@example.com",
        password: "admin-db-e2e-pass",
      },
    });
    assert.equal(adminLogin.status, 200);
    const adminHeaders = bearer(adminLogin.body.data!.tokens.accessToken);
    const memberHeaders = bearer(member.accessToken);

    const inputFile = await registerAndUploadFile(api.baseUrl, member.accessToken, {
      originalName: "admin-input.png",
      sourceType: "input",
    });
    const outputFile = await registerAndUploadFile(api.baseUrl, member.accessToken, {
      content: "admin-output-content",
      originalName: "admin-output.png",
      sourceType: "output",
      fileType: "unknown",
      mimeType: "application/octet-stream",
    });

    const workflowResponse = await requestJson<{ workflowId: string }>(api.baseUrl, "/api/v1/workflows", {
      method: "POST",
      headers: memberHeaders,
      payload: {
        id: "workflow-admin-db-e2e",
        projectId: "project-admin-db-e2e",
        name: "Admin DB E2E Workflow",
        nodes: {
          "file-node": {
            id: "file-node",
            type: "image",
            fileId: inputFile.fileId,
          },
        },
        connections: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        metadata: {},
        timestamp: 1770000200000,
      },
    });
    assert.equal(workflowResponse.status, 201);

    const executionResponse = await requestJson<{
      runId: string;
      tasks: Array<{ taskId: string }>;
    }>(api.baseUrl, "/api/v1/executions", {
      method: "POST",
      headers: memberHeaders,
      payload: {
        workflowId: "workflow-admin-db-e2e",
        nodeType: "aiImageHd",
        taskType: "image-hd",
        executionMode: "legacy-grouped-task",
        nodeId: "hd-node",
        nodeTitle: "Admin HD Node",
        groups: [
          {
            groupId: "group-admin",
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
    await executionsRepository.updateTaskResultFile(taskId, outputFile.fileId);

    const memberOverview = await requestJson(api.baseUrl, "/api/v1/admin/overview", {
      headers: memberHeaders,
    });
    assert.equal(memberOverview.status, 403);

    const overview = await requestJson<{
      files: { total: number };
      workflows: { total: number };
      executions: { totalRuns: number };
      users: { admins: number; members: number };
    }>(api.baseUrl, "/api/v1/admin/overview", {
      headers: adminHeaders,
    });
    assert.equal(overview.status, 200);
    assert.ok((overview.body.data?.files.total ?? 0) >= 2);
    assert.equal(overview.body.data?.workflows.total, 1);
    assert.equal(overview.body.data?.executions.totalRuns, 1);
    assert.equal(overview.body.data?.users.admins, 1);
    assert.equal(overview.body.data?.users.members, 1);

    const files = await requestJson<{
      items: Array<{ fileId: string; displayName: string }>;
      total: number;
      page: number;
      pageSize: number;
    }>(api.baseUrl, "/api/v1/admin/files?page=1&pageSize=1&q=admin", {
      headers: adminHeaders,
    });
    assert.equal(files.status, 200);
    assert.equal(files.body.data?.page, 1);
    assert.equal(files.body.data?.pageSize, 1);
    assert.equal(files.body.data?.items.length, 1);
    assert.ok((files.body.data?.total ?? 0) >= 2);

    const fileUsage = await requestJson<{
      file: { fileId: string };
      workflows: Array<{ workflowId: string; role: string }>;
      tasks: Array<{ taskId: string; role: string }>;
    }>(api.baseUrl, `/api/v1/admin/files/${inputFile.fileId}`, {
      headers: adminHeaders,
    });
    assert.equal(fileUsage.status, 200);
    assert.equal(fileUsage.body.data?.file.fileId, inputFile.fileId);
    assert.ok(fileUsage.body.data?.workflows.some((item) => item.workflowId === "workflow-admin-db-e2e"));
    assert.ok(fileUsage.body.data?.tasks.some((item) => item.taskId === taskId && item.role === "input"));

    const executions = await requestJson<{
      items: Array<{ runId: string; workflowId: string | null }>;
      total: number;
    }>(api.baseUrl, "/api/v1/admin/executions?workflowId=workflow-admin-db-e2e&page=1&pageSize=10", {
      headers: adminHeaders,
    });
    assert.equal(executions.status, 200);
    assert.equal(executions.body.data?.items[0]?.runId, runId);

    const executionDetail = await requestJson<{
      runId: string;
      tasks: Array<{ taskId: string; resultFileId: string | null }>;
      inputFiles: Array<{ fileId: string }>;
      outputFiles: Array<{ fileId: string }>;
    }>(api.baseUrl, `/api/v1/admin/executions/${runId}`, {
      headers: adminHeaders,
    });
    assert.equal(executionDetail.status, 200);
    assert.equal(executionDetail.body.data?.runId, runId);
    assert.equal(executionDetail.body.data?.tasks[0]?.taskId, taskId);
    assert.ok(executionDetail.body.data?.inputFiles.some((file) => file.fileId === inputFile.fileId));
    assert.ok(executionDetail.body.data?.outputFiles.some((file) => file.fileId === outputFile.fileId));

    const workflows = await requestJson<{
      items: Array<{ workflowId: string; name: string }>;
      total: number;
    }>(api.baseUrl, "/api/v1/admin/workflows?q=Admin", {
      headers: adminHeaders,
    });
    assert.equal(workflows.status, 200);
    assert.equal(workflows.body.data?.items[0]?.workflowId, "workflow-admin-db-e2e");

    const workflowDetail = await requestJson<{
      workflowId: string;
      files: Array<{ fileId: string }>;
      tasks: Array<{ taskId: string }>;
    }>(api.baseUrl, "/api/v1/admin/workflows/workflow-admin-db-e2e", {
      headers: adminHeaders,
    });
    assert.equal(workflowDetail.status, 200);
    assert.equal(workflowDetail.body.data?.workflowId, "workflow-admin-db-e2e");
    assert.ok(workflowDetail.body.data?.files.some((file) => file.fileId === inputFile.fileId));
    assert.ok(workflowDetail.body.data?.tasks.some((task) => task.taskId === taskId));

    const users = await requestJson<{
      items: Array<{ userId: string; role: string }>;
      total: number;
    }>(api.baseUrl, "/api/v1/admin/read/users?role=member", {
      headers: adminHeaders,
    });
    assert.equal(users.status, 200);
    assert.equal(users.body.data?.total, 1);
    assert.equal(users.body.data?.items[0]?.userId, member.userId);

    const storageIssues = await requestJson<{
      items: Array<{ type: string }>;
      total: number;
    }>(api.baseUrl, "/api/v1/admin/storage/issues", {
      headers: adminHeaders,
    });
    assert.equal(storageIssues.status, 200);
    assert.equal(storageIssues.body.data?.total, 0);
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
