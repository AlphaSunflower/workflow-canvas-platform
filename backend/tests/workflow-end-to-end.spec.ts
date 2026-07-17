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
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { FilesService } from "../api/src/modules/files/files.service.ts";
import { WorkflowsService } from "../api/src/modules/workflows/workflows.service.ts";
import { createEnv } from "../shared/src/env.ts";

const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAF0lEQVR4nGP8z8DAwMDAxMDA8J8BAM4FA/2wE8sAAAAASUVORK5CYII=";
const SAMPLE_PNG_BUFFER = Buffer.from(SAMPLE_PNG_BASE64, "base64");

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

async function uploadBinary<TResponse>(
  baseUrl: string,
  pathname: string,
  buffer: Buffer,
  headers?: Record<string, string>,
): Promise<{
  status: number;
  body: ApiEnvelope<TResponse>;
}> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      ...(headers ?? {}),
    },
    body: buffer,
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
  content: Buffer | string,
): Promise<{
  fileId: string;
  sha256: string;
}> {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const registerResponse = await requestJson<{
    uploadId?: string;
    fileId: string;
    uploadRequired: boolean;
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
  assert.equal(registerResponse.body.data?.uploadRequired, true);
  const uploadId = registerResponse.body.data?.uploadId;
  assert.ok(uploadId);

  const uploadResponse = await uploadBinary<{
    uploadId: string;
    fileId: string;
    file: {
      status: string;
    };
  }>(
    baseUrl,
    `/api/v1/files/upload?uploadId=${encodeURIComponent(uploadId!)}`,
    buffer,
    {
      Authorization: `Bearer ${accessToken}`,
    },
  );

  assert.equal(uploadResponse.status, 200);
  assert.equal(uploadResponse.body.data?.uploadId, uploadId);
  assert.equal(uploadResponse.body.data?.file.status, "ready");

  return {
    fileId: uploadResponse.body.data!.fileId,
    sha256,
  };
}

async function createWorkflow(
  baseUrl: string,
  accessToken: string,
  payload: {
    projectId: string;
    name: string;
    nodes: Record<string, unknown>;
    connections: unknown[];
  },
): Promise<string> {
  const response = await requestJson<{ workflowId: string }>(baseUrl, "/api/v1/workflows", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    payload: {
      ...payload,
      viewport: {
        x: 32,
        y: 48,
        zoom: 1.1,
      },
      metadata: {
        nodeCount: Object.keys(payload.nodes).length,
        connectionCount: payload.connections.length,
      },
      timestamp: 1710000000000,
    },
  });

  assert.equal(response.status, 201);
  return response.body.data!.workflowId;
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-workflow-end-to-end-test-"));
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
    const executionsRepository = new ExecutionsRepository(rootDir);
    const filesRepository = new FilesRepository(rootDir);

    const owner = await registerAccount(
      baseUrl,
      "workflow-e2e-owner@example.com",
      "owner-pass-123",
      "Workflow E2E Owner",
    );

    const { fileId, sha256 } = await createReadyFile(
      baseUrl,
      owner.accessToken,
      "input.png",
      SAMPLE_PNG_BUFFER,
    );

    const workflowId = await createWorkflow(baseUrl, owner.accessToken, {
      projectId: "project-e2e",
      name: "Workflow E2E",
      nodes: {
        "node-file-1": {
          id: "node-file-1",
          type: "image",
          title: "Input Image",
          fileId,
          previewUrl: "blob:temporary-preview",
          localState: {
            uploadStatus: "ready",
          },
        },
      },
      connections: [],
    });

    const workflowDetailResponse = await requestJson<{
      workflowId: string;
      workflow: {
        nodes: Record<string, {
          fileId?: string;
          fileName?: string;
          previewUrl?: string;
          localState?: unknown;
        }>;
      };
    }>(baseUrl, `/api/v1/workflows/${workflowId}`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(workflowDetailResponse.status, 200);
    assert.equal(workflowDetailResponse.body.data?.workflowId, workflowId);
    assert.equal(workflowDetailResponse.body.data?.workflow.nodes["node-file-1"]?.fileId, fileId);
    assert.equal(
      workflowDetailResponse.body.data?.workflow.nodes["node-file-1"]?.fileName,
      "input.png",
    );
    assert.equal(
      workflowDetailResponse.body.data?.workflow.nodes["node-file-1"]?.previewUrl,
      `/api/v1/files/${fileId}/preview`,
    );
    assert.equal(
      "localState" in (workflowDetailResponse.body.data?.workflow.nodes["node-file-1"] ?? {}),
      false,
    );

    const bindingsPath = path.join(
      rootDir,
      "data",
      "workflows",
      workflowId,
      "files.json",
    );
    const bindingsBeforeUpdate = JSON.parse(await fs.readFile(bindingsPath, "utf8")) as {
      items: Array<{ nodeId: string; fileId: string }>;
    };
    assert.equal(bindingsBeforeUpdate.items.length, 1);
    assert.equal(bindingsBeforeUpdate.items[0]?.fileId, fileId);

    const updateWorkflowResponse = await requestJson<{
      workflowId: string;
    }>(baseUrl, `/api/v1/workflows/${workflowId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        workflowId,
        projectId: "project-e2e",
        name: "Workflow E2E",
        nodes: {
          "node-file-1": {
            id: "node-file-1",
            type: "image",
            title: "Input Image",
          },
        },
        connections: [],
        viewport: {
          x: 64,
          y: 72,
          zoom: 1.25,
        },
        metadata: {
          nodeCount: 1,
          connectionCount: 0,
        },
        timestamp: 1710000001000,
      },
    });

    assert.equal(updateWorkflowResponse.status, 200);

    const bindingsAfterUpdate = JSON.parse(await fs.readFile(bindingsPath, "utf8")) as {
      items: Array<{ nodeId: string; fileId: string }>;
    };
    assert.equal(bindingsAfterUpdate.items.length, 0);

    const fileRecord = await filesRepository.findFileRecordById(fileId);
    const fileAsset = await filesRepository.findFileById(fileId);
    assert.ok(fileRecord);
    assert.ok(fileAsset);
    assert.equal(fileAsset?.status, "ready");
    assert.equal(fileAsset?.sha256, sha256);

    const storedFileContent = await filesRepository.readFileContent(fileId);
    assert.ok(storedFileContent);
    assert.equal(storedFileContent?.mimeType, "image/png");
    assert.deepEqual(storedFileContent?.buffer, SAMPLE_PNG_BUFFER);

    const createExecutionResponse = await requestJson<{
      runId: string;
      runNo: string;
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
        nodeId: "node-execution-1",
        nodeTitle: "Execution Node",
        groups: [{
          groupId: "group-e2e-1",
          sourceFileId: fileId,
        }],
      },
    });

    assert.equal(createExecutionResponse.status, 201);
    const runId = createExecutionResponse.body.data!.runId;
    const taskId = createExecutionResponse.body.data!.tasks[0]!.taskId;

    await executionsRepository.claimQueuedTaskById(taskId);
    await executionsRepository.updateTaskAttempt({
      taskId,
      attemptNo: 1,
      retryCount: 0,
      currentStep: "final",
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    await executionsRepository.appendTaskEvent({
      taskId,
      eventType: "task_progress",
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 60,
      message: "workflow end-to-end progressing",
      payload: {
        workflowId,
        stage: "provider-processing",
      },
    });
    await executionsRepository.updateTaskResultFile(taskId, fileId);
    await executionsRepository.markTaskCompleted(taskId);

    const taskListResponse = await requestJson<{
      items: Array<{
        taskId: string;
        runId: string;
        runNo: string | null;
        workflowId: string;
        nodeId: string;
        nodeTitle: string;
        input: Record<string, unknown>;
        sourceFileId: string | null;
        sourceFile: {
          fileId: string;
        } | null;
        resultFileId: string | null;
        resultFile: {
          fileId: string;
        } | null;
      }>;
      total: number;
    }>(baseUrl, `/api/v1/workflows/${workflowId}/tasks?sortBy=sequence&sortOrder=asc&page=1&pageSize=10`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(taskListResponse.status, 200);
    assert.equal(taskListResponse.body.data?.total, 1);
    assert.equal(taskListResponse.body.data?.items[0]?.taskId, taskId);
    assert.equal(taskListResponse.body.data?.items[0]?.runId, runId);
    assert.equal(taskListResponse.body.data?.items[0]?.runNo, createExecutionResponse.body.data!.runNo);
    assert.equal(taskListResponse.body.data?.items[0]?.workflowId, workflowId);
    assert.equal(taskListResponse.body.data?.items[0]?.nodeId, "node-execution-1");
    assert.equal(taskListResponse.body.data?.items[0]?.nodeTitle, "Execution Node");
    assert.equal(taskListResponse.body.data?.items[0]?.input.sourceFileId, fileId);
    assert.equal(taskListResponse.body.data?.items[0]?.sourceFileId, fileId);
    assert.equal(taskListResponse.body.data?.items[0]?.sourceFile?.fileId, fileId);
    assert.equal(taskListResponse.body.data?.items[0]?.resultFileId, fileId);
    assert.equal(taskListResponse.body.data?.items[0]?.resultFile?.fileId, fileId);

    const taskDetailResponse = await requestJson<{
      taskId: string;
      runNo: string | null;
      workflowId: string;
      resultFileId: string | null;
      sourceFileId: string | null;
      sourceFile: {
        fileId: string;
      } | null;
      resultFile: {
        fileId: string;
      } | null;
      recentEvents: Array<{ eventType: string }>;
    }>(baseUrl, `/api/v1/workflows/${workflowId}/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(taskDetailResponse.status, 200);
    assert.equal(taskDetailResponse.body.data?.taskId, taskId);
    assert.equal(taskDetailResponse.body.data?.runNo, createExecutionResponse.body.data!.runNo);
    assert.equal(taskDetailResponse.body.data?.workflowId, workflowId);
    assert.equal(taskDetailResponse.body.data?.resultFileId, fileId);
    assert.equal(taskDetailResponse.body.data?.sourceFileId, fileId);
    assert.equal(taskDetailResponse.body.data?.sourceFile?.fileId, fileId);
    assert.equal(taskDetailResponse.body.data?.resultFile?.fileId, fileId);
    assert.ok(
      taskDetailResponse.body.data?.recentEvents.some((event) => event.eventType === "task_completed"),
    );

    const taskEventsResponse = await requestJson<{
      items: Array<{
        eventType: string;
        payload: Record<string, unknown> | null;
      }>;
      total: number;
    }>(baseUrl, `/api/v1/workflows/${workflowId}/tasks/${taskId}/events?sortOrder=asc`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(taskEventsResponse.status, 200);
    assert.ok((taskEventsResponse.body.data?.total ?? 0) >= 4);
    assert.equal(taskEventsResponse.body.data?.items[0]?.eventType, "task_queued");
    assert.ok(
      taskEventsResponse.body.data?.items.some((event) =>
        event.eventType === "task_progress" && event.payload?.workflowId === workflowId
      ),
    );

    const taskHistoryIndexPath = path.join(
      rootDir,
      "data",
      "workflows",
      workflowId,
      "task-history",
      "index.json",
    );
    const taskHistoryEventsPath = path.join(
      rootDir,
      "data",
      "workflows",
      workflowId,
      "task-history",
      "events",
      `${taskId}.jsonl`,
    );
    const taskHistoryIndex = JSON.parse(await fs.readFile(taskHistoryIndexPath, "utf8")) as {
      items: Array<{ taskId: string; workflowId: string }>;
    };
    const taskHistoryEvents = (await fs.readFile(taskHistoryEventsPath, "utf8"))
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0);

    assert.equal(taskHistoryIndex.items.length, 1);
    assert.equal(taskHistoryIndex.items[0]?.taskId, taskId);
    assert.equal(taskHistoryIndex.items[0]?.workflowId, workflowId);
    assert.equal(taskHistoryEvents.length >= 4, true);
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
