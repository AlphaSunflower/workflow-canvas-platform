import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { createApiServer } from "../api/src/main.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";
import { ExecutionQueryService } from "../api/src/modules/executions/execution-query.service.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesService } from "../api/src/modules/files/files.service.ts";
import { WorkflowsService } from "../api/src/modules/workflows/workflows.service.ts";
import { AI_IMAGE_HD_DEFAULT_MODEL } from "../shared/src/constants/aiImageHd.ts";
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
  content: Buffer | string,
): Promise<string> {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
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

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const lengthBuffer = Buffer.alloc(4);
  const crcBuffer = Buffer.alloc(4);

  lengthBuffer.writeUInt32BE(data.length, 0);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function createSamplePng(width: number, height: number): Buffer {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const scanlineLength = 1 + width * 3;
  const raw = Buffer.alloc(scanlineLength * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * scanlineLength;
    raw[rowOffset] = 0;

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * 3;
      raw[pixelOffset] = (x * 7) % 256;
      raw[pixelOffset + 1] = (y * 11) % 256;
      raw[pixelOffset + 2] = 224;
    }
  }

  return Buffer.concat([
    signature,
    createPngChunk("IHDR", ihdr),
    createPngChunk("IDAT", zlib.deflateSync(raw)),
    createPngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function createWorkflow(
  baseUrl: string,
  accessToken: string,
  projectId: string,
  name: string,
): Promise<string> {
  const response = await requestJson<{ workflowId: string }>(baseUrl, "/api/v1/workflows", {
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
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-workflow-task-history-test-"));
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
      "history-owner@example.com",
      "owner-pass-123",
      "History Owner",
    );
    const other = await registerAccount(
      baseUrl,
      "history-other@example.com",
      "other-pass-123",
      "History Other",
    );

    const workflowId = await createWorkflow(
      baseUrl,
      owner.accessToken,
      "project-history",
      "History Workflow",
    );
    const sourceFileId = await createReadyFile(
      baseUrl,
      owner.accessToken,
      "source.png",
      createSamplePng(1600, 900),
    );

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
        nodeId: "node-history-1",
        nodeTitle: "History Node",
        groups: [{
          groupId: "group-history-1",
          sourceFileId,
        }],
      },
    });

    assert.equal(createExecutionResponse.status, 201);
    const runId = createExecutionResponse.body.data!.runId;
    const taskId = createExecutionResponse.body.data!.tasks[0]!.taskId;

    await repository.claimQueuedTaskById(taskId);
    await repository.updateTaskAttempt({
      taskId,
      attemptNo: 1,
      retryCount: 0,
      currentStep: "final",
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    await repository.appendTaskEvent({
      taskId,
      eventType: "task_progress",
      status: "processing",
      phase: "processing",
      stepType: "final",
      progress: 80,
      message: "history task progressing",
      payload: {
        providerTaskId: "provider-task-001",
        providerClientId: "provider-client-001",
      },
    });
    await repository.updateTaskResultFile(taskId, sourceFileId);
    await repository.markTaskCompleted(taskId);

    const listResponse = await requestJson<{
      items: Array<{
        sequence: number;
        taskId: string;
        runId: string;
        runNo: string | null;
        workflowId: string;
        nodeId: string;
        nodeTitle: string;
        nodeType: string;
        taskType: string;
        status: string;
        provider: string | null;
        model: string | null;
        createdAt: string;
        completedAt: string | null;
        groupId: string | null;
        groupOrder: number | null;
        durationMs: number | null;
        input: Record<string, unknown>;
        sourceFileId: string | null;
        inputFileId: string | null;
        prompt: string | null;
        imageSize: string | null;
        aspectRatio: string | null;
        sourceFile: {
          fileId: string;
          downloadUrl?: string;
          thumbnailUrl?: string;
          previewUrl?: string;
        } | null;
        resultFile: {
          fileId: string;
          downloadUrl?: string;
          thumbnailUrl?: string;
          previewUrl?: string;
        } | null;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>(baseUrl, `/api/v1/workflows/${workflowId}/tasks?sortBy=sequence&sortOrder=asc&page=1&pageSize=10`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.body.data?.total, 1);
    assert.equal(listResponse.body.data?.items[0]?.taskId, taskId);
    assert.equal(listResponse.body.data?.items[0]?.runId, runId);
    assert.equal(listResponse.body.data?.items[0]?.runNo, createExecutionResponse.body.data!.runNo);
    assert.equal(listResponse.body.data?.items[0]?.workflowId, workflowId);
    assert.equal(listResponse.body.data?.items[0]?.nodeId, "node-history-1");
    assert.equal(listResponse.body.data?.items[0]?.nodeTitle, "History Node");
    assert.equal(listResponse.body.data?.items[0]?.nodeType, "aiImageHd");
    assert.equal(listResponse.body.data?.items[0]?.taskType, "image-hd");
    assert.equal(listResponse.body.data?.items[0]?.status, "completed");
    assert.equal(listResponse.body.data?.items[0]?.provider, "laozhang");
    assert.equal(listResponse.body.data?.items[0]?.model, AI_IMAGE_HD_DEFAULT_MODEL);
    assert.equal(listResponse.body.data?.items[0]?.groupId, "group-history-1");
    assert.equal(listResponse.body.data?.items[0]?.groupOrder, 1);
    assert.equal(typeof listResponse.body.data?.items[0]?.sequence, "number");
    assert.equal(listResponse.body.data?.items[0]?.input.sourceFileId, sourceFileId);
    assert.equal(listResponse.body.data?.items[0]?.inputFileId, sourceFileId);
    assert.equal(listResponse.body.data?.items[0]?.prompt ?? null, null);
    assert.equal(listResponse.body.data?.items[0]?.imageSize, null);
    assert.equal(listResponse.body.data?.items[0]?.aspectRatio, null);
    assert.equal(typeof listResponse.body.data?.items[0]?.createdAt, "string");
    assert.equal(typeof listResponse.body.data?.items[0]?.completedAt, "string");
    assert.equal(listResponse.body.data?.items[0]?.sourceFileId, sourceFileId);
    assert.equal(listResponse.body.data?.items[0]?.sourceFile?.fileId, sourceFileId);
    assert.equal(listResponse.body.data?.items[0]?.sourceFile?.downloadUrl, `/api/v1/files/${sourceFileId}/download`);
    assert.equal(listResponse.body.data?.items[0]?.sourceFile?.thumbnailUrl, `/api/v1/files/${sourceFileId}/thumbnail`);
    assert.equal(listResponse.body.data?.items[0]?.sourceFile?.previewUrl, `/api/v1/files/${sourceFileId}/preview`);
    assert.equal(listResponse.body.data?.items[0]?.resultFile?.fileId, sourceFileId);
    assert.equal(listResponse.body.data?.items[0]?.resultFile?.downloadUrl, `/api/v1/files/${sourceFileId}/download`);
    assert.equal(listResponse.body.data?.items[0]?.resultFile?.thumbnailUrl, `/api/v1/files/${sourceFileId}/thumbnail`);
    assert.equal(listResponse.body.data?.items[0]?.resultFile?.previewUrl, `/api/v1/files/${sourceFileId}/preview`);

    const detailResponse = await requestJson<{
      taskId: string;
      runNo: string | null;
      workflowId: string;
      nodeType: string;
      taskType: string;
      provider: string | null;
      model: string | null;
      inputFileId: string | null;
      imageSize: string | null;
      aspectRatio: string | null;
      resultFileId: string;
      sourceFileId: string | null;
      sourceFile: {
        fileId: string;
        downloadUrl?: string;
        thumbnailUrl?: string;
        previewUrl?: string;
      } | null;
      resultFile: {
        fileId: string;
        downloadUrl?: string;
        thumbnailUrl?: string;
        previewUrl?: string;
      } | null;
      recentEvents: Array<{
        eventType: string;
      }>;
    }>(baseUrl, `/api/v1/workflows/${workflowId}/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(detailResponse.status, 200);
    assert.equal(detailResponse.body.data?.taskId, taskId);
    assert.equal(detailResponse.body.data?.runNo, createExecutionResponse.body.data!.runNo);
    assert.equal(detailResponse.body.data?.workflowId, workflowId);
    assert.equal(detailResponse.body.data?.nodeType, "aiImageHd");
    assert.equal(detailResponse.body.data?.taskType, "image-hd");
    assert.equal(detailResponse.body.data?.provider, "laozhang");
    assert.equal(detailResponse.body.data?.model, AI_IMAGE_HD_DEFAULT_MODEL);
    assert.equal(detailResponse.body.data?.inputFileId, sourceFileId);
    assert.equal(detailResponse.body.data?.imageSize, null);
    assert.equal(detailResponse.body.data?.aspectRatio, null);
    assert.equal(detailResponse.body.data?.resultFileId, sourceFileId);
    assert.equal(detailResponse.body.data?.sourceFileId, sourceFileId);
    assert.equal(detailResponse.body.data?.sourceFile?.fileId, sourceFileId);
    assert.equal(detailResponse.body.data?.sourceFile?.downloadUrl, `/api/v1/files/${sourceFileId}/download`);
    assert.equal(detailResponse.body.data?.sourceFile?.thumbnailUrl, `/api/v1/files/${sourceFileId}/thumbnail`);
    assert.equal(detailResponse.body.data?.sourceFile?.previewUrl, `/api/v1/files/${sourceFileId}/preview`);
    assert.equal(detailResponse.body.data?.resultFile?.fileId, sourceFileId);
    assert.equal(detailResponse.body.data?.resultFile?.downloadUrl, `/api/v1/files/${sourceFileId}/download`);
    assert.equal(detailResponse.body.data?.resultFile?.thumbnailUrl, `/api/v1/files/${sourceFileId}/thumbnail`);
    assert.equal(detailResponse.body.data?.resultFile?.previewUrl, `/api/v1/files/${sourceFileId}/preview`);
    assert.ok(
      detailResponse.body.data?.recentEvents.some((event) => event.eventType === "task_completed"),
    );

    const eventsResponse = await requestJson<{
      items: Array<{
        eventType: string;
        status: string;
        phase: string;
        payload: Record<string, unknown> | null;
      }>;
      total: number;
    }>(baseUrl, `/api/v1/workflows/${workflowId}/tasks/${taskId}/events?sortOrder=asc`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(eventsResponse.status, 200);
    assert.ok((eventsResponse.body.data?.total ?? 0) >= 4);
    assert.equal(eventsResponse.body.data?.items[0]?.eventType, "task_queued");
    assert.equal(eventsResponse.body.data?.items[0]?.status, "queued");
    assert.equal(eventsResponse.body.data?.items[0]?.phase, "queued");
    assert.ok(
      eventsResponse.body.data?.items.some((event) =>
        event.eventType === "task_progress" && event.payload?.providerTaskId === "provider-task-001"
      ),
    );

    const otherListResponse = await requestJson(baseUrl, `/api/v1/workflows/${workflowId}/tasks`, {
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
      },
    });

    assert.equal(otherListResponse.status, 404);

    const historyIndexPath = path.join(
      rootDir,
      "data",
      "workflows",
      workflowId,
      "task-history",
      "index.json",
    );
    const historyEventsPath = path.join(
      rootDir,
      "data",
      "workflows",
      workflowId,
      "task-history",
      "events",
      `${taskId}.jsonl`,
    );
    const historyIndex = JSON.parse(await fs.readFile(historyIndexPath, "utf8")) as {
      items: Array<{ taskId: string; workflowId: string; sequence: number }>;
    };
    const historyEventsLines = (await fs.readFile(historyEventsPath, "utf8"))
      .split(/\r?\n/u)
      .filter((line) => line.trim().length > 0);

    assert.equal(historyIndex.items.length, 1);
    assert.equal(historyIndex.items[0]?.taskId, taskId);
    assert.equal(historyIndex.items[0]?.workflowId, workflowId);
    assert.equal(historyEventsLines.length >= 4, true);
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
