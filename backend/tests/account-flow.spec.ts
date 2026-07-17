import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApiServer } from "../api/src/main.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";
import { ExecutionQueryService } from "../api/src/modules/executions/execution-query.service.ts";
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

async function requestBuffer(
  baseUrl: string,
  pathname: string,
  headers?: Record<string, string>,
): Promise<{
  status: number;
  contentType: string | null;
  buffer: Buffer;
}> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: headers ?? {},
  });

  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

async function createWorkflow(
  baseUrl: string,
  accessToken: string,
): Promise<string> {
  const response = await requestJson<{
    workflowId: string;
  }>(baseUrl, "/api/v1/workflows", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    payload: {
      projectId: "project-account-flow",
      name: "Account Flow Workflow",
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
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-account-flow-test-"));
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

    const registerResponse = await requestJson<{
      tokens: {
        accessToken: string;
        refreshToken: string;
      };
      user: {
        userId: string;
        email: string;
      };
    }>(baseUrl, "/api/v1/auth/register", {
      method: "POST",
      payload: {
        email: "member@example.com",
        password: "member-pass-123",
        displayName: "Member User",
      },
    });
    assert.equal(registerResponse.status, 201);

    const accessToken = registerResponse.body.data!.tokens.accessToken;
    const refreshToken = registerResponse.body.data!.tokens.refreshToken;
    const userId = registerResponse.body.data!.user.userId;

    const meResponse = await requestJson<{
      userId: string;
      email: string;
    }>(baseUrl, "/api/v1/auth/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    assert.equal(meResponse.status, 200);
    assert.equal(meResponse.body.data?.userId, userId);

    const content = Buffer.from("account-flow-input-image");
    const sha256 = createHash("sha256").update(content).digest("hex");

    const registerFileResponse = await requestJson<{
      uploadId?: string;
      file: {
        fileId: string;
        userId: string | null;
        status: string;
      };
    }>(baseUrl, "/api/v1/files/register", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      payload: {
        userId: "spoofed-user-id",
        sha256,
        size: content.length,
        mimeType: "image/png",
        originalName: "account-flow.png",
        fileType: "image",
        sourceType: "input",
      },
    });
    assert.equal(registerFileResponse.status, 200);
    assert.equal(registerFileResponse.body.data?.file.userId, userId);
    assert.equal(registerFileResponse.body.data?.file.status, "pending_upload");

    const uploadFileResponse = await requestJson<{
      fileId: string;
      file: {
        fileId: string;
        userId: string | null;
        status: string;
        downloadUrl?: string;
      };
    }>(baseUrl, "/api/v1/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      payload: {
        uploadId: registerFileResponse.body.data!.uploadId,
        contentBase64: content.toString("base64"),
      },
    });
    assert.equal(uploadFileResponse.status, 200);
    assert.equal(uploadFileResponse.body.data?.file.userId, userId);
    assert.equal(uploadFileResponse.body.data?.file.status, "ready");

    const fileId = uploadFileResponse.body.data!.fileId;
    const workflowId = await createWorkflow(baseUrl, accessToken);

    const createExecutionResponse = await requestJson<{
      runId: string;
      tasks: Array<{
        taskId: string;
      }>;
    }>(baseUrl, "/api/v1/executions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      payload: {
        userId: "spoofed-user-id",
        workflowId,
        nodeType: "aiImageHd",
        taskType: "image-hd",
        executionMode: "legacy-grouped-task",
        nodeId: "node-account-flow",
        nodeTitle: "Account Flow",
        groups: [{
          groupId: "group-flow-1",
          sourceFileId: fileId,
        }],
      },
    });
    assert.equal(createExecutionResponse.status, 201);

    const runId = createExecutionResponse.body.data!.runId;
    const taskId = createExecutionResponse.body.data!.tasks[0]!.taskId;

    const runResponse = await requestJson<{
      runId: string;
      userId: string | null;
      tasks: Array<{
        taskId: string;
        sourceFileId: string | null;
        inputFile?: {
          fileId: string;
          userId: string | null;
        } | null;
      }>;
    }>(baseUrl, `/api/v1/executions/${runId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    assert.equal(runResponse.status, 200);
    assert.equal(runResponse.body.data?.userId, userId);
    assert.equal(runResponse.body.data?.tasks[0]?.taskId, taskId);
    assert.equal(runResponse.body.data?.tasks[0]?.sourceFileId, fileId);
    assert.equal(runResponse.body.data?.tasks[0]?.inputFile?.fileId, fileId);
    assert.equal(runResponse.body.data?.tasks[0]?.inputFile?.userId, userId);

    const taskResponse = await requestJson<{
      taskId: string;
      runId: string;
      sourceFileId: string | null;
      inputFile?: {
        fileId: string;
        userId: string | null;
      } | null;
      recentEvents: Array<{
        taskId: string;
      }>;
    }>(baseUrl, `/api/v1/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    assert.equal(taskResponse.status, 200);
    assert.equal(taskResponse.body.data?.taskId, taskId);
    assert.equal(taskResponse.body.data?.runId, runId);
    assert.equal(taskResponse.body.data?.sourceFileId, fileId);
    assert.equal(taskResponse.body.data?.inputFile?.userId, userId);
    assert.ok((taskResponse.body.data?.recentEvents.length ?? 0) >= 1);

    const taskEventsResponse = await requestJson<{
      total: number;
      items: Array<{
        taskId: string;
      }>;
    }>(baseUrl, `/api/v1/tasks/${taskId}/events`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    assert.equal(taskEventsResponse.status, 200);
    assert.ok((taskEventsResponse.body.data?.total ?? 0) >= 1);
    assert.equal(taskEventsResponse.body.data?.items[0]?.taskId, taskId);

    const listTasksResponse = await requestJson<{
      total: number;
      items: Array<{
        taskId: string;
        runId: string;
      }>;
    }>(baseUrl, `/api/v1/tasks?userId=spoofed-user-id`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    assert.equal(listTasksResponse.status, 200);
    assert.equal(listTasksResponse.body.data?.total, 1);
    assert.equal(listTasksResponse.body.data?.items[0]?.taskId, taskId);

    const fileDetailResponse = await requestJson<{
      fileId: string;
      userId: string | null;
    }>(baseUrl, `/api/v1/files/${fileId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    assert.equal(fileDetailResponse.status, 200);
    assert.equal(fileDetailResponse.body.data?.userId, userId);

    const fileDownloadResponse = await requestBuffer(
      baseUrl,
      `/api/v1/files/${fileId}/download`,
      {
        Authorization: `Bearer ${accessToken}`,
      },
    );
    assert.equal(fileDownloadResponse.status, 200);
    assert.equal(fileDownloadResponse.contentType, "image/png");
    assert.equal(fileDownloadResponse.buffer.toString("utf8"), content.toString("utf8"));

    const refreshResponse = await requestJson<{
      tokens: {
        accessToken: string;
        refreshToken: string;
      };
    }>(baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      payload: {
        refreshToken,
      },
    });
    assert.equal(refreshResponse.status, 200);
    assert.ok(refreshResponse.body.data?.tokens.accessToken);

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
