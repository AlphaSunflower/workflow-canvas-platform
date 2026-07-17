import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApiServer } from "../api/src/main.ts";
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
  originalName: string,
  content: string,
): Promise<string> {
  const buffer = Buffer.from(content);
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
      originalName,
      displayName: originalName,
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
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-executions-workflow-binding-test-"));
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
    const repository = new ExecutionsRepository(rootDir);

    const owner = await registerAccount(
      baseUrl,
      "workflow-owner@example.com",
      "owner-pass-123",
      "Workflow Owner",
    );
    const other = await registerAccount(
      baseUrl,
      "workflow-other@example.com",
      "other-pass-123",
      "Workflow Other",
    );

    const workflowId = await createWorkflow(
      baseUrl,
      owner.accessToken,
      "project-binding",
      "Binding Workflow",
    );

    const ownerFileId = await createReadyFile(
      baseUrl,
      owner.accessToken,
      "source.png",
      "workflow-owner-source",
    );

    const createExecutionResponse = await requestJson<{
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
        workflowId,
        nodeType: "aiImageHd",
        taskType: "image-hd",
        executionMode: "legacy-grouped-task",
        nodeId: "node-bind-1",
        nodeTitle: "Binding Node",
        groups: [{
          groupId: "group-bind-1",
          sourceFileId: ownerFileId,
        }],
      },
    });

    assert.equal(createExecutionResponse.status, 201);
    const runId = createExecutionResponse.body.data!.runId;
    const taskId = createExecutionResponse.body.data!.tasks[0]!.taskId;

    const runRecord = await repository.getExecutionRunById(runId);
    const taskRecord = await repository.getTaskById(taskId);

    assert.ok(runRecord);
    assert.equal(runRecord?.workflowId, workflowId);
    assert.equal(runRecord?.projectId, "project-binding");
    assert.equal(runRecord?.nodeId, "node-bind-1");
    assert.equal(runRecord?.nodeTitle, "Binding Node");

    assert.ok(taskRecord);
    assert.equal(taskRecord?.workflowId, workflowId);
    assert.equal(taskRecord?.projectId, "project-binding");
    assert.equal(taskRecord?.nodeId, "node-bind-1");
    assert.equal(taskRecord?.nodeTitle, "Binding Node");

    const runDetail = await requestJson<{
      workflowId: string | null;
      projectId: string | null;
      tasks: Array<{
        workflowId: string | null;
        projectId: string | null;
      }>;
    }>(baseUrl, `/api/v1/executions/${runId}`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(runDetail.status, 200);
    assert.equal(runDetail.body.data?.workflowId, workflowId);
    assert.equal(runDetail.body.data?.projectId, "project-binding");
    assert.equal(runDetail.body.data?.tasks[0]?.workflowId, workflowId);
    assert.equal(runDetail.body.data?.tasks[0]?.projectId, "project-binding");

    const otherAttempt = await requestJson(baseUrl, "/api/v1/executions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
      },
      payload: {
        workflowId,
        nodeType: "aiImageHd",
        taskType: "image-hd",
        executionMode: "legacy-grouped-task",
        nodeId: "node-bind-2",
        nodeTitle: "Other Node",
        groups: [{
          groupId: "group-bind-2",
          sourceFileId: ownerFileId,
        }],
      },
    });

    assert.equal(otherAttempt.status, 403);
    assert.equal(otherAttempt.body.error, "AUTH_FORBIDDEN");
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
