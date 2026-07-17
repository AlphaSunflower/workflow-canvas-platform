import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApiServer } from "../api/src/main.ts";
import { AccountsStoreRepository } from "../api/src/modules/auth/account.repository.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";
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
  email: string,
  password: string,
  displayName: string,
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
    payload: {
      email,
      password,
      displayName,
    },
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
  spoofedUserId: string,
  originalName: string,
  content: string,
): Promise<string> {
  const buffer = Buffer.from(content);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const registerResponse = await requestJson<{
    uploadId?: string;
    fileId: string;
    file: {
      userId: string | null;
    };
  }>(baseUrl, "/api/v1/files/register", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    payload: {
      userId: spoofedUserId,
      sha256,
      size: buffer.length,
      mimeType: "image/png",
      originalName,
      fileType: "image",
      sourceType: "input",
    },
  });

  assert.equal(registerResponse.status, 200);

  const uploadResponse = await requestJson<{
    fileId: string;
    file: {
      status: string;
    };
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
  assert.equal(uploadResponse.body.data?.file.status, "ready");

  return uploadResponse.body.data!.fileId;
}

async function createWorkflow(
  baseUrl: string,
  accessToken: string,
  projectId: string,
  name: string,
): Promise<string> {
  const response = await requestJson<{
    workflowId: string;
  }>(baseUrl, "/api/v1/workflows", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    payload: {
      projectId,
      name,
      nodes: {},
      connections: [],
      viewport: {
        x: 0,
        y: 0,
        zoom: 1,
      },
      metadata: {
        nodeCount: 0,
        connectionCount: 0,
      },
      timestamp: 1710000000000,
    },
  });

  assert.equal(response.status, 201);
  return response.body.data!.workflowId;
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-executions-authz-test-"));
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
    const authFactory = () => AuthService.fromRoot(rootDir, env);
    const filesFactory = () => FilesService.fromRoot(rootDir);
    const workflowsFactory = () => WorkflowsService.fromRoot(rootDir);
    const executionsFactory = () => ExecutionsService.fromRoot(rootDir);
    const executionQueryFactory = () => ExecutionQueryService.fromRoot(rootDir);
    const accountsRepository = new AccountsStoreRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);

    server = createApiServer(env, {
      authServiceFactory: authFactory,
      filesServiceFactory: filesFactory,
      workflowsServiceFactory: workflowsFactory,
      executionsServiceFactory: executionsFactory,
      executionQueryServiceFactory: executionQueryFactory,
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const admin = await registerAccount(baseUrl, "admin@example.com", "admin-pass-123", "Admin");
    const owner = await registerAccount(baseUrl, "owner@example.com", "owner-pass-123", "Owner");
    const other = await registerAccount(baseUrl, "other@example.com", "other-pass-123", "Other");

    await accountsRepository.updateUser(admin.userId, { role: "admin" });

    const adminLogin = await requestJson<{
      tokens: {
        accessToken: string;
      };
      user: {
        role: string;
      };
    }>(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      payload: {
        email: "admin@example.com",
        password: "admin-pass-123",
      },
    });
    assert.equal(adminLogin.status, 200);
    const adminAccessToken = adminLogin.body.data!.tokens.accessToken;

    const ownerWhiteModelFileId = await createReadyFile(
      baseUrl,
      owner.accessToken,
      other.userId,
      "white-model.png",
      "owner-white-model",
    );
    const ownerStyleFileId = await createReadyFile(
      baseUrl,
      owner.accessToken,
      other.userId,
      "style-reference.png",
      "owner-style-reference",
    );
    const otherWhiteModelFileId = await createReadyFile(
      baseUrl,
      other.accessToken,
      owner.userId,
      "other-white-model.png",
      "other-white-model",
    );
    const otherStyleFileId = await createReadyFile(
      baseUrl,
      other.accessToken,
      owner.userId,
      "other-style-reference.png",
      "other-style-reference",
    );
    const ownerWorkflowId = await createWorkflow(
      baseUrl,
      owner.accessToken,
      "project-owner",
      "Owner Workflow",
    );
    const otherWorkflowId = await createWorkflow(
      baseUrl,
      other.accessToken,
      "project-other",
      "Other Workflow",
    );

    const createUnauthorized = await requestJson(baseUrl, "/api/v1/executions", {
      method: "POST",
      payload: {
        userId: owner.userId,
        workflowId: ownerWorkflowId,
        nodeType: "aiModelRenderTransfer",
        taskType: "model-render-transfer",
        executionMode: "legacy-grouped-task",
        groups: [{
          groupId: "group-1",
          whiteModelFileId: ownerWhiteModelFileId,
          styleReferenceFileId: ownerStyleFileId,
        }],
      },
    });
    assert.equal(createUnauthorized.status, 401);
    assert.equal(createUnauthorized.body.error, "AUTHORIZATION_REQUIRED");

    const createUsingOtherFiles = await requestJson(baseUrl, "/api/v1/executions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        userId: other.userId,
        workflowId: otherWorkflowId,
        nodeType: "aiModelRenderTransfer",
        taskType: "model-render-transfer",
        executionMode: "legacy-grouped-task",
        groups: [{
          groupId: "group-cross",
          whiteModelFileId: otherWhiteModelFileId,
          styleReferenceFileId: otherStyleFileId,
        }],
      },
    });
    assert.equal(createUsingOtherFiles.status, 403);
    assert.equal(createUsingOtherFiles.body.error, "AUTH_FORBIDDEN");

    const createOwnerExecution = await requestJson<{
      runId: string;
      tasks: Array<{
        taskId: string;
      }>;
    }>(baseUrl, "/api/v1/executions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        userId: other.userId,
        workflowId: ownerWorkflowId,
        nodeType: "aiModelRenderTransfer",
        taskType: "model-render-transfer",
        executionMode: "legacy-grouped-task",
        nodeId: "node-owner",
        nodeTitle: "Owner Run",
        groups: [{
          groupId: "group-owner",
          whiteModelFileId: ownerWhiteModelFileId,
          styleReferenceFileId: ownerStyleFileId,
        }],
      },
    });
    assert.equal(createOwnerExecution.status, 201);

    const ownerRunId = createOwnerExecution.body.data!.runId;
    const ownerTaskId = createOwnerExecution.body.data!.tasks[0]!.taskId;
    const ownerRunRecord = await executionsRepository.getExecutionRunById(ownerRunId);
    assert.ok(ownerRunRecord);
    assert.equal(ownerRunRecord?.userId, owner.userId);

    const createOtherExecution = await requestJson<{
      runId: string;
      tasks: Array<{
        taskId: string;
      }>;
    }>(baseUrl, "/api/v1/executions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
      },
      payload: {
        userId: owner.userId,
        workflowId: otherWorkflowId,
        nodeType: "aiModelRenderTransfer",
        taskType: "model-render-transfer",
        executionMode: "legacy-grouped-task",
        nodeId: "node-other",
        nodeTitle: "Other Run",
        groups: [{
          groupId: "group-other",
          whiteModelFileId: otherWhiteModelFileId,
          styleReferenceFileId: otherStyleFileId,
        }],
      },
    });
    assert.equal(createOtherExecution.status, 201);

    const otherRunId = createOtherExecution.body.data!.runId;
    const otherTaskId = createOtherExecution.body.data!.tasks[0]!.taskId;

    const ownerRun = await requestJson<{
      runId: string;
      userId: string | null;
    }>(baseUrl, `/api/v1/executions/${ownerRunId}`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });
    assert.equal(ownerRun.status, 200);
    assert.equal(ownerRun.body.data?.userId, owner.userId);

    const otherReadsOwnerRun = await requestJson(baseUrl, `/api/v1/executions/${ownerRunId}`, {
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
      },
    });
    assert.equal(otherReadsOwnerRun.status, 404);
    assert.equal(otherReadsOwnerRun.body.error, "RUN_NOT_FOUND");

    const listOwnerTasks = await requestJson<{
      total: number;
      items: Array<{
        runId: string;
      }>;
    }>(baseUrl, `/api/v1/tasks?userId=${other.userId}`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });
    assert.equal(listOwnerTasks.status, 200);
    assert.equal(listOwnerTasks.body.data?.total, 1);
    assert.equal(listOwnerTasks.body.data?.items[0]?.runId, ownerRunId);

    const otherReadsOwnerTask = await requestJson(baseUrl, `/api/v1/tasks/${ownerTaskId}`, {
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
      },
    });
    assert.equal(otherReadsOwnerTask.status, 404);
    assert.equal(otherReadsOwnerTask.body.error, "TASK_NOT_FOUND");

    const otherReadsOwnerEvents = await requestJson(baseUrl, `/api/v1/tasks/${ownerTaskId}/events`, {
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
      },
    });
    assert.equal(otherReadsOwnerEvents.status, 404);
    assert.equal(otherReadsOwnerEvents.body.error, "TASK_NOT_FOUND");

    const adminReadsOwnerRun = await requestJson<{
      runId: string;
      userId: string | null;
    }>(baseUrl, `/api/v1/executions/${ownerRunId}`, {
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
      },
    });
    assert.equal(adminReadsOwnerRun.status, 200);
    assert.equal(adminReadsOwnerRun.body.data?.userId, owner.userId);

    const adminListsOtherTasks = await requestJson<{
      total: number;
      items: Array<{
        taskId: string;
        runId: string;
      }>;
    }>(baseUrl, `/api/v1/tasks?userId=${other.userId}`, {
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
      },
    });
    assert.equal(adminListsOtherTasks.status, 200);
    assert.equal(adminListsOtherTasks.body.data?.total, 1);
    assert.equal(adminListsOtherTasks.body.data?.items[0]?.taskId, otherTaskId);
    assert.equal(adminListsOtherTasks.body.data?.items[0]?.runId, otherRunId);

    const adminReadsOtherTask = await requestJson<{
      taskId: string;
      runId: string;
    }>(baseUrl, `/api/v1/tasks/${otherTaskId}`, {
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
      },
    });
    assert.equal(adminReadsOtherTask.status, 200);
    assert.equal(adminReadsOtherTask.body.data?.taskId, otherTaskId);

    const adminReadsOtherEvents = await requestJson<{
      total: number;
      items: Array<{
        taskId: string;
      }>;
    }>(baseUrl, `/api/v1/tasks/${otherTaskId}/events`, {
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
      },
    });
    assert.equal(adminReadsOtherEvents.status, 200);
    assert.ok((adminReadsOtherEvents.body.data?.total ?? 0) >= 1);
    assert.equal(adminReadsOtherEvents.body.data?.items[0]?.taskId, otherTaskId);

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

void run();
