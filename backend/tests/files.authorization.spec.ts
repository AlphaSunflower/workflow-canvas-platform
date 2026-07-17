import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApiServer } from "../api/src/main.ts";
import { AccountsStoreRepository } from "../api/src/modules/auth/account.repository.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";
import { FilesService } from "../api/src/modules/files/files.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
import { ExecutionsRepository } from "../api/src/modules/executions/executions.repository.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { WorkflowRepository } from "../api/src/modules/workflows/workflow.repository.ts";
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

async function requestBuffer(
  baseUrl: string,
  pathname: string,
  headers?: Record<string, string>,
): Promise<{
  status: number;
  contentType: string | null;
  cacheControl: string | null;
  etag: string | null;
  buffer: Buffer;
}> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: headers ?? {},
  });

  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    etag: response.headers.get("etag"),
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

async function registerAndLogin(
  baseUrl: string,
  email: string,
  password: string,
  displayName: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  userId: string;
}> {
  const registerResponse = await requestJson<{
    tokens: {
      accessToken: string;
      refreshToken: string;
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

  assert.equal(registerResponse.status, 201);

  return {
    accessToken: registerResponse.body.data!.tokens.accessToken,
    refreshToken: registerResponse.body.data!.tokens.refreshToken,
    userId: registerResponse.body.data!.user.userId,
  };
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-files-authz-test-"));
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
    const accountsRepository = new AccountsStoreRepository(rootDir);

    server = createApiServer(env, {
      authServiceFactory: authFactory,
      filesServiceFactory: filesFactory,
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const admin = await registerAndLogin(
      baseUrl,
      "admin@example.com",
      "admin-pass-123",
      "Admin User",
    );
    const owner = await registerAndLogin(
      baseUrl,
      "owner@example.com",
      "owner-pass-123",
      "Owner User",
    );
    const other = await registerAndLogin(
      baseUrl,
      "other@example.com",
      "other-pass-123",
      "Other User",
    );

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
    assert.equal(adminLogin.body.data?.user.role, "admin");
    const adminAccessToken = adminLogin.body.data!.tokens.accessToken;

    const content = SAMPLE_PNG_BUFFER;
    const sha256 = createHash("sha256").update(content).digest("hex");

    const unauthorizedRegister = await requestJson(baseUrl, "/api/v1/files/register", {
      method: "POST",
      payload: {
        sha256,
        size: content.length,
        mimeType: "image/png",
        originalName: "owner-image.png",
      },
    });
    assert.equal(unauthorizedRegister.status, 401);
    assert.equal(unauthorizedRegister.body.error, "AUTHORIZATION_REQUIRED");

    const registerResponse = await requestJson<{
      uploadRequired: boolean;
      uploadId?: string;
      fileId: string;
      file: {
        fileId: string;
        userId: string | null;
        status: string;
      };
    }>(baseUrl, "/api/v1/files/register", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        userId: other.userId,
        sha256,
        size: content.length,
        mimeType: "image/png",
        originalName: "owner-image.png",
        fileType: "image",
        sourceType: "input",
      },
    });
    assert.equal(registerResponse.status, 200);
    assert.equal(registerResponse.body.data?.uploadRequired, true);
    assert.equal(registerResponse.body.data?.file.userId, owner.userId);
    assert.equal(registerResponse.body.data?.file.status, "pending_upload");

    const uploadByOther = await requestJson(baseUrl, "/api/v1/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
      },
      payload: {
        uploadId: registerResponse.body.data!.uploadId,
        contentBase64: content.toString("base64"),
      },
    });
    assert.equal(uploadByOther.status, 403);
    assert.equal(uploadByOther.body.error, "AUTH_FORBIDDEN");

    const uploadByOwner = await requestJson<{
      fileId: string;
      file: {
        fileId: string;
        userId: string | null;
        status: string;
      };
    }>(baseUrl, "/api/v1/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        uploadId: registerResponse.body.data!.uploadId,
        contentBase64: content.toString("base64"),
      },
    });
    assert.equal(uploadByOwner.status, 200);
    assert.equal(uploadByOwner.body.data?.file.userId, owner.userId);
    assert.equal(uploadByOwner.body.data?.file.status, "ready");

    const fileId = uploadByOwner.body.data!.fileId;

    for (const variant of ["download", "preview", "thumbnail"] as const) {
      const anonymousResource = await requestJson(
        baseUrl,
        `/api/v1/files/${fileId}/${variant}`,
      );
      assert.equal(anonymousResource.status, 401);
      assert.equal(anonymousResource.body.error, "AUTHORIZATION_REQUIRED");
    }

    const otherGet = await requestJson(baseUrl, `/api/v1/files/${fileId}`, {
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
      },
    });
    assert.equal(otherGet.status, 403);
    assert.equal(otherGet.body.error, "AUTH_FORBIDDEN");

    const otherDownload = await requestJson(baseUrl, `/api/v1/files/${fileId}/download`, {
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
      },
    });
    assert.equal(otherDownload.status, 403);
    assert.equal(otherDownload.body.error, "AUTH_FORBIDDEN");

    const otherPreview = await requestJson(baseUrl, `/api/v1/files/${fileId}/preview`, {
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
      },
    });
    assert.equal(otherPreview.status, 403);
    assert.equal(otherPreview.body.error, "AUTH_FORBIDDEN");

    const otherThumbnail = await requestJson(baseUrl, `/api/v1/files/${fileId}/thumbnail`, {
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
      },
    });
    assert.equal(otherThumbnail.status, 403);
    assert.equal(otherThumbnail.body.error, "AUTH_FORBIDDEN");

    for (const variant of ["download", "preview", "thumbnail"] as const) {
      const missingResource = await requestJson(
        baseUrl,
        `/api/v1/files/missing-file-id/${variant}`,
        {
          headers: {
            Authorization: `Bearer ${owner.accessToken}`,
          },
        },
      );
      assert.equal(missingResource.status, 404);
      assert.equal(missingResource.body.error, "FILE_NOT_FOUND");
    }

    const ownerGet = await requestJson<{
      fileId: string;
      userId: string | null;
      downloadUrl?: string;
      previewUrl?: string;
    }>(baseUrl, `/api/v1/files/${fileId}`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });
    assert.equal(ownerGet.status, 200);
    assert.equal(ownerGet.body.data?.userId, owner.userId);
    assert.ok(ownerGet.body.data?.downloadUrl);
    assert.ok(ownerGet.body.data?.previewUrl);

    const ownerDownload = await requestBuffer(
      baseUrl,
      `/api/v1/files/${fileId}/download`,
      {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    );
    assert.equal(ownerDownload.status, 200);
    assert.equal(ownerDownload.contentType, "image/png");
    assert.equal(ownerDownload.cacheControl, "private, max-age=0, must-revalidate");
    assert.ok(ownerDownload.etag);
    assert.equal(Buffer.compare(ownerDownload.buffer, content), 0);

    const adminGet = await requestJson<{
      fileId: string;
      userId: string | null;
    }>(baseUrl, `/api/v1/files/${fileId}`, {
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
      },
    });
    assert.equal(adminGet.status, 200);
    assert.equal(adminGet.body.data?.userId, owner.userId);

    const adminDownload = await requestBuffer(
      baseUrl,
      `/api/v1/files/${fileId}/download`,
      {
        Authorization: `Bearer ${adminAccessToken}`,
      },
    );
    assert.equal(adminDownload.status, 200);
    assert.equal(adminDownload.cacheControl, "private, max-age=0, must-revalidate");
    assert.ok(adminDownload.etag);
    assert.equal(Buffer.compare(adminDownload.buffer, content), 0);

    const adminPreview = await requestBuffer(
      baseUrl,
      `/api/v1/files/${fileId}/preview`,
      {
        Authorization: `Bearer ${adminAccessToken}`,
      },
    );
    assert.equal(adminPreview.status, 200);
    assert.equal(adminPreview.cacheControl, "private, max-age=120, stale-while-revalidate=3600");
    assert.ok(adminPreview.etag);
    assert.notEqual(Buffer.compare(adminPreview.buffer, content), 0);

    const workflowRepository = new WorkflowRepository(rootDir);
    const executionsRepository = new ExecutionsRepository(rootDir);
    const filesRepository = new FilesRepository(rootDir);
    const filesService = new FilesService(filesRepository);
    const executionsService = new ExecutionsService(
      executionsRepository,
      filesRepository,
      workflowRepository,
    );

    await workflowRepository.createWorkflow(owner.userId, {
      id: "workflow-output-owner",
      projectId: "project-output-owner",
      name: "Output Owner Workflow",
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

    const executionCreate = await executionsService.createExecutionForActor(
      {
        user: {
          userId: owner.userId,
          email: "owner@example.com",
          displayName: "Owner User",
          role: "member",
          status: "enabled",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          lastLoginAt: null,
        },
        accessTokenPayload: {
          userId: owner.userId,
          role: "member",
          status: "enabled",
        },
      },
      {
        workflowId: "workflow-output-owner",
        nodeType: "aiImageGen",
        taskType: "image-gen",
        executionMode: "legacy-grouped-task",
        nodeId: "node-output-owner",
        nodeTitle: "AI Image Gen",
        prompt: "Generate output owner check",
        imageSize: "1K",
        aspectRatio: "1:1",
        groups: [
          {
            groupId: "group-output-owner",
            referenceFileIds: [fileId],
          },
        ],
      },
    );

    const outputBuffer = Buffer.from("execution-output-image");
    const outputSha256 = createHash("sha256").update(outputBuffer).digest("hex");
    const outputRegister = await filesService.registerForActor(
      {
        user: {
          userId: owner.userId,
          email: "owner@example.com",
          displayName: "Owner User",
          role: "member",
          status: "enabled",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          lastLoginAt: null,
        },
        accessTokenPayload: {
          userId: owner.userId,
          role: "member",
          status: "enabled",
        },
      },
      {
        sha256: outputSha256,
        size: outputBuffer.length,
        mimeType: "image/png",
        originalName: "execution-output.png",
        fileType: "image",
        sourceType: "output",
      },
    );

    if (outputRegister.uploadRequired && outputRegister.uploadId) {
      await filesService.uploadBinaryForActor(
        {
          user: {
            userId: owner.userId,
            email: "owner@example.com",
            displayName: "Owner User",
            role: "member",
            status: "enabled",
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
            lastLoginAt: null,
          },
          accessTokenPayload: {
            userId: owner.userId,
            role: "member",
            status: "enabled",
          },
        },
        outputRegister.uploadId,
        outputBuffer,
      );
    }

    await executionsRepository.updateTaskResultFile(
      executionCreate.tasks[0]!.taskId,
      outputRegister.file.fileId,
    );

    const ownerOutputDownload = await requestBuffer(
      baseUrl,
      `/api/v1/files/${outputRegister.file.fileId}/download`,
      {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    );
    assert.equal(ownerOutputDownload.status, 200);

    const otherOutputDownload = await requestJson(
      baseUrl,
      `/api/v1/files/${outputRegister.file.fileId}/download`,
      {
        headers: {
          Authorization: `Bearer ${other.accessToken}`,
        },
      },
    );
    assert.equal(otherOutputDownload.status, 403);
    assert.equal(otherOutputDownload.body.error, "AUTH_FORBIDDEN");

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
