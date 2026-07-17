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
}> {
  const response = await requestJson<{
    tokens: {
      accessToken: string;
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
  };
}

async function createReadyFile(
  baseUrl: string,
  accessToken: string,
  originalName: string,
  contentBase64: string,
): Promise<string> {
  const buffer = Buffer.from(contentBase64, "base64");
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
      sourceType: "output",
    },
  });

  assert.equal(registerResponse.status, 200);

  if (!registerResponse.body.data?.uploadId) {
    return registerResponse.body.data!.fileId;
  }

  const uploadResponse = await fetch(
    `${baseUrl}/api/v1/files/upload?uploadId=${encodeURIComponent(registerResponse.body.data!.uploadId!)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    },
  );

  assert.equal(uploadResponse.status, 200);
  const uploadBody = await uploadResponse.json() as ApiEnvelope<{
    fileId: string;
  }>;

  return uploadBody.data!.fileId;
}

async function createWorkflow(
  baseUrl: string,
  accessToken: string,
  projectId: string,
): Promise<string> {
  const response = await requestJson<{ workflowId: string }>(baseUrl, "/api/v1/workflows", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    payload: {
      projectId,
      name: "Reconcile Workflow",
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
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-executions-reconcile-api-"));
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
      "reconcile-owner@example.com",
      "owner-pass-123",
      "Reconcile Owner",
    );
    const workflowId = await createWorkflow(baseUrl, owner.accessToken, "project-reconcile");
    const tinyPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0l8AAAAASUVORK5CYII=";
    const referenceFileId = await createReadyFile(
      baseUrl,
      owner.accessToken,
      "reconcile-reference.png",
      tinyPngBase64,
    );

    const createExecutionResponse = await requestJson<{
      runId: string;
      tasks: Array<{ taskId: string }>;
    }>(baseUrl, "/api/v1/executions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        workflowId,
        nodeType: "aiImageGen",
        taskType: "image-gen",
        executionMode: "legacy-grouped-task",
        nodeId: "node-reconcile-1",
        nodeTitle: "Reconcile Node",
        prompt: "generate",
        imageSize: "2K",
        aspectRatio: "4:5",
        groups: [{
          groupId: "group-1",
          referenceFileIds: [referenceFileId],
        }],
      },
    });

    assert.equal(createExecutionResponse.status, 201);
    const taskId = createExecutionResponse.body.data!.tasks[0]!.taskId;
    const resultFileId = await createReadyFile(
      baseUrl,
      owner.accessToken,
      "reconcile-result.png",
      tinyPngBase64,
    );

    await repository.updateTaskResultFile(taskId, resultFileId);
    await repository.markTaskCompleted(taskId);

    const reconcileResponse = await requestJson<{
      runId: string;
      tasks: Array<{
        taskId: string;
        providerTaskId: string | null;
        providerClientId: string | null;
        inputFile: unknown | null;
        sourceFile: unknown | null;
        renderFile: unknown | null;
        referenceFile: unknown | null;
        whiteModelFile: unknown | null;
        styleReferenceFile: unknown | null;
        resultFile: {
          fileId: string;
          downloadUrl?: string;
          thumbnailUrl?: string;
          previewUrl?: string;
        } | null;
      }>;
    }>(baseUrl, `/api/v1/workflows/${workflowId}/executions/reconcile?nodeId=node-reconcile-1`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(reconcileResponse.status, 200);
    assert.equal(reconcileResponse.body.data?.runId, createExecutionResponse.body.data?.runId);
    assert.equal(reconcileResponse.body.data?.tasks[0]?.taskId, taskId);
    assert.equal(reconcileResponse.body.data?.tasks[0]?.providerTaskId, null);
    assert.equal(reconcileResponse.body.data?.tasks[0]?.providerClientId, null);
    assert.equal(reconcileResponse.body.data?.tasks[0]?.resultFile?.fileId, resultFileId);
    assert.equal(reconcileResponse.body.data?.tasks[0]?.resultFile?.downloadUrl, `/api/v1/files/${resultFileId}/download`);
    assert.equal(reconcileResponse.body.data?.tasks[0]?.resultFile?.thumbnailUrl, `/api/v1/files/${resultFileId}/thumbnail`);
    assert.equal(reconcileResponse.body.data?.tasks[0]?.resultFile?.previewUrl, `/api/v1/files/${resultFileId}/preview`);
    assert.equal(reconcileResponse.body.data?.tasks[0]?.inputFile, null);
    assert.equal(reconcileResponse.body.data?.tasks[0]?.sourceFile, null);
    assert.equal(reconcileResponse.body.data?.tasks[0]?.renderFile, null);
    assert.equal(reconcileResponse.body.data?.tasks[0]?.referenceFile, null);
    assert.equal(reconcileResponse.body.data?.tasks[0]?.whiteModelFile, null);
    assert.equal(reconcileResponse.body.data?.tasks[0]?.styleReferenceFile, null);
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
