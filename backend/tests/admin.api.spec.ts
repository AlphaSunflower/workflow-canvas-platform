import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApiServer } from "../api/src/main.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";
import { AccountsStoreRepository } from "../api/src/modules/auth/account.repository.ts";
import { ExecutionQueryService } from "../api/src/modules/executions/execution-query.service.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesService } from "../api/src/modules/files/files.service.ts";
import { WorkflowsService } from "../api/src/modules/workflows/workflows.service.ts";
import { createEnv } from "../shared/src/env.ts";

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  error?: string;
  data?: T;
  timestamp: number;
}

async function requestJson<TResponse>(
  baseUrl: string,
  pathname: string,
  options?: {
    method?: string;
    payload?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{
  status: number;
  body: ApiEnvelope<TResponse>;
}> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options?.method ?? "GET",
    headers: {
      ...(options?.payload !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options?.headers ?? {}),
    },
    ...(options?.payload !== undefined ? { body: JSON.stringify(options.payload) } : {}),
  });

  return {
    status: response.status,
    body: await response.json() as ApiEnvelope<TResponse>,
  };
}

async function registerAccount(
  baseUrl: string,
  input: {
    email: string;
    password: string;
    displayName: string;
  },
): Promise<{
  accessToken: string;
  userId: string;
}> {
  const response = await requestJson<{
    tokens: {
      accessToken: string;
    };
    user: {
      userId: string;
    };
  }>(baseUrl, "/api/v1/auth/register", {
    method: "POST",
    payload: input,
  });

  assert.equal(response.status, 201);
  return {
    accessToken: response.body.data!.tokens.accessToken,
    userId: response.body.data!.user.userId,
  };
}

async function createReadyFile(
  baseUrl: string,
  accessToken: string,
  input: {
    originalName: string;
    content: Buffer | string;
    sourceType?: "input" | "output";
  },
): Promise<string> {
  const buffer = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const registerResponse = await requestJson<{
    uploadId?: string;
    fileId: string;
  }>(baseUrl, "/api/v1/files/register", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    payload: {
      sha256,
      size: buffer.length,
      mimeType: "image/png",
      originalName: input.originalName,
      displayName: input.originalName,
      fileType: "image",
      sourceType: input.sourceType ?? "input",
    },
  });

  assert.equal(registerResponse.status, 200);
  const uploadResponse = await requestJson<{
    fileId: string;
  }>(baseUrl, "/api/v1/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    payload: {
      uploadId: registerResponse.body.data!.uploadId,
      contentBase64: buffer.toString("base64"),
    },
  });

  assert.equal(uploadResponse.status, 200);
  return uploadResponse.body.data!.fileId;
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-admin-api-test-"));
  const originalConfigPath = process.env.BACKEND_CONFIG_PATH;
  const configPath = path.join(rootDir, "backend.config.json");
  let server: ReturnType<typeof createApiServer> | null = null;

  await fs.writeFile(configPath, JSON.stringify({
    persistence: {
      mode: "json",
    },
    runtime: {
      host: "127.0.0.1",
    },
    services: {
      api: {
        port: 0,
      },
    },
    auth: {
      jwt: {
        issuer: "newworkflow-backend-test",
        accessTokenSecret: "test-access-secret",
        accessTokenTtlSeconds: 900,
        refreshTokenSecret: "test-refresh-secret",
        refreshTokenTtlSeconds: 7200,
      },
      session: {
        rotateRefreshTokenOnUse: true,
      },
    },
  }, null, 2), "utf8");

  process.env.BACKEND_CONFIG_PATH = configPath;

  try {
    const env = createEnv("api");
    server = createApiServer(env, {
      rootDir,
      authServiceFactory: () => AuthService.fromRoot(rootDir, env),
      filesServiceFactory: () => FilesService.fromRoot(rootDir),
      workflowsServiceFactory: () => WorkflowsService.fromRoot(rootDir),
      executionsServiceFactory: () => ExecutionsService.fromRoot(rootDir),
      executionQueryServiceFactory: () => ExecutionQueryService.fromRoot(rootDir),
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const accountsRepository = new AccountsStoreRepository(rootDir);
    const admin = await registerAccount(baseUrl, {
      email: "admin@example.com",
      password: "admin-pass-123",
      displayName: "Admin User",
    });
    const member = await registerAccount(baseUrl, {
      email: "member@example.com",
      password: "member-pass-123",
      displayName: "Member User",
    });

    await accountsRepository.updateUser(admin.userId, { role: "admin" });
    const adminLogin = await requestJson<{
      tokens: {
        accessToken: string;
      };
    }>(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      payload: {
        email: "admin@example.com",
        password: "admin-pass-123",
      },
    });
    assert.equal(adminLogin.status, 200);

    const adminHeaders = {
      Authorization: `Bearer ${adminLogin.body.data!.tokens.accessToken}`,
    };
    const memberHeaders = {
      Authorization: `Bearer ${member.accessToken}`,
    };

    const sourceFileId = await createReadyFile(baseUrl, member.accessToken, {
      originalName: "admin-source.png",
      content: "source-content",
      sourceType: "input",
    });
    const resultFileId = await createReadyFile(baseUrl, member.accessToken, {
      originalName: "admin-result.png",
      content: "result-content",
      sourceType: "output",
    });

    const workflowResponse = await requestJson<{ workflowId: string }>(baseUrl, "/api/v1/workflows", {
      method: "POST",
      headers: memberHeaders,
      payload: {
        projectId: "project-admin",
        name: "Admin Workflow",
        nodes: {
          "file-node-1": {
            type: "file",
            fileId: sourceFileId,
          },
        },
        connections: [],
        viewport: {
          x: 0,
          y: 0,
          zoom: 1,
        },
        metadata: {
          nodeCount: 1,
          connectionCount: 0,
        },
        timestamp: 1710000000000,
      },
    });
    assert.equal(workflowResponse.status, 201);
    const workflowId = workflowResponse.body.data!.workflowId;

    const executionResponse = await requestJson<{
      runId: string;
      tasks: Array<{ taskId: string }>;
    }>(baseUrl, "/api/v1/executions", {
      method: "POST",
      headers: memberHeaders,
      payload: {
        workflowId,
        nodeType: "aiImageHd",
        taskType: "image-hd",
        executionMode: "legacy-grouped-task",
        nodeId: "node-admin-1",
        nodeTitle: "Admin Node",
        groups: [{
          groupId: "group-admin-1",
          sourceFileId,
        }],
      },
    });
    assert.equal(executionResponse.status, 201);
    const runId = executionResponse.body.data!.runId;
    const taskId = executionResponse.body.data!.tasks[0]!.taskId;
    const executionsRepository = new ExecutionsRepository(rootDir);
    await executionsRepository.updateTaskResultFile(taskId, resultFileId);

    const memberOverview = await requestJson(baseUrl, "/api/v1/admin/overview", {
      headers: memberHeaders,
    });
    assert.equal(memberOverview.status, 403);
    assert.equal(memberOverview.body.error, "AUTH_FORBIDDEN");

    const overview = await requestJson<{
      files: { total: number };
      workflows: { total: number };
      users: { admins: number; members: number };
    }>(baseUrl, "/api/v1/admin/overview", {
      headers: adminHeaders,
    });
    assert.equal(overview.status, 200);
    assert.ok((overview.body.data?.files.total ?? 0) >= 2);
    assert.ok((overview.body.data?.workflows.total ?? 0) >= 1);
    assert.equal(overview.body.data?.users.admins, 1);
    assert.equal(overview.body.data?.users.members, 1);

    const files = await requestJson<{
      items: Array<{ fileId: string; displayName: string }>;
      total: number;
      page: number;
      pageSize: number;
    }>(baseUrl, "/api/v1/admin/files?page=1&pageSize=1&q=admin", {
      headers: adminHeaders,
    });
    assert.equal(files.status, 200);
    assert.equal(files.body.data?.page, 1);
    assert.equal(files.body.data?.pageSize, 1);
    assert.equal(files.body.data?.items.length, 1);
    assert.ok((files.body.data?.total ?? 0) >= 2);

    const fileUsage = await requestJson<{
      file: { fileId: string };
      workflows: Array<{ workflowId: string }>;
      tasks: Array<{ taskId: string; role: string }>;
    }>(baseUrl, `/api/v1/admin/files/${sourceFileId}`, {
      headers: adminHeaders,
    });
    assert.equal(fileUsage.status, 200);
    assert.equal(fileUsage.body.data?.file.fileId, sourceFileId);
    assert.equal(fileUsage.body.data?.workflows[0]?.workflowId, workflowId);
    assert.equal(fileUsage.body.data?.tasks[0]?.taskId, taskId);

    const executions = await requestJson<{
      items: Array<{ runId: string; workflowId: string | null }>;
      total: number;
    }>(baseUrl, `/api/v1/admin/executions?workflowId=${encodeURIComponent(workflowId)}`, {
      headers: adminHeaders,
    });
    assert.equal(executions.status, 200);
    assert.equal(executions.body.data?.items[0]?.runId, runId);

    const executionDetail = await requestJson<{
      runId: string;
      tasks: Array<{ taskId: string; resultFileId: string | null }>;
      inputFiles: Array<{ fileId: string }>;
      outputFiles: Array<{ fileId: string }>;
    }>(baseUrl, `/api/v1/admin/executions/${runId}`, {
      headers: adminHeaders,
    });
    assert.equal(executionDetail.status, 200);
    assert.equal(executionDetail.body.data?.runId, runId);
    assert.equal(executionDetail.body.data?.tasks[0]?.taskId, taskId);
    assert.ok(executionDetail.body.data?.inputFiles.some((file) => file.fileId === sourceFileId));
    assert.ok(executionDetail.body.data?.outputFiles.some((file) => file.fileId === resultFileId));

    const workflows = await requestJson<{
      items: Array<{ workflowId: string; name: string }>;
      total: number;
    }>(baseUrl, "/api/v1/admin/workflows?q=Admin", {
      headers: adminHeaders,
    });
    assert.equal(workflows.status, 200);
    assert.equal(workflows.body.data?.items[0]?.workflowId, workflowId);

    const workflowDetail = await requestJson<{
      workflowId: string;
      files: Array<{ fileId: string }>;
      tasks: Array<{ taskId: string }>;
    }>(baseUrl, `/api/v1/admin/workflows/${workflowId}`, {
      headers: adminHeaders,
    });
    assert.equal(workflowDetail.status, 200);
    assert.equal(workflowDetail.body.data?.workflowId, workflowId);
    assert.ok(workflowDetail.body.data?.files.some((file) => file.fileId === sourceFileId));
    assert.ok(workflowDetail.body.data?.tasks.some((task) => task.taskId === taskId));

    const users = await requestJson<{
      items: Array<{ userId: string; role: string }>;
      total: number;
    }>(baseUrl, "/api/v1/admin/read/users?role=member", {
      headers: adminHeaders,
    });
    assert.equal(users.status, 200);
    assert.equal(users.body.data?.total, 1);
    assert.equal(users.body.data?.items[0]?.userId, member.userId);

    const storageIssues = await requestJson<{
      items: Array<{ type: string }>;
      total: number;
    }>(baseUrl, "/api/v1/admin/storage/issues", {
      headers: adminHeaders,
    });
    assert.equal(storageIssues.status, 200);
    assert.equal(storageIssues.body.data?.total, 0);

  } finally {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.closeIdleConnections?.();
        server!.closeAllConnections?.();
        server!.close(() => resolve());
      });
    }

    if (originalConfigPath === undefined) {
      delete process.env.BACKEND_CONFIG_PATH;
    } else {
      process.env.BACKEND_CONFIG_PATH = originalConfigPath;
    }

    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

await run();
