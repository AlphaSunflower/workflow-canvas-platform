import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApiServer } from "../api/src/main.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";
import { FilesService } from "../api/src/modules/files/files.service.ts";
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

async function requestBinaryUpload<TResponse>(
  baseUrl: string,
  uploadId: string,
  buffer: Buffer,
  accessToken: string,
): Promise<{
  status: number;
  body: ApiEnvelope<TResponse>;
}> {
  const response = await fetch(`${baseUrl}/api/v1/files/upload?uploadId=${encodeURIComponent(uploadId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: buffer,
  });

  return {
    status: response.status,
    body: await response.json() as ApiEnvelope<TResponse>,
  };
}

async function requestResource(
  baseUrl: string,
  pathname: string,
  accessToken: string,
): Promise<{
  status: number;
  contentLength: string | null;
  contentType: string | null;
  cacheControl: string | null;
  etag: string | null;
  lastModified: string | null;
  exposedHeaders: string | null;
}> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  await response.arrayBuffer();

  return {
    status: response.status,
    contentLength: response.headers.get("content-length"),
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    exposedHeaders: response.headers.get("access-control-expose-headers"),
  };
}

async function registerAndLogin(
  baseUrl: string,
  email: string,
  password: string,
  displayName: string,
): Promise<{
  accessToken: string;
  userId: string;
}> {
  const registerResponse = await requestJson<{
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

  assert.equal(registerResponse.status, 201);

  return {
    accessToken: registerResponse.body.data!.tokens.accessToken,
    userId: registerResponse.body.data!.user.userId,
  };
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-files-asset-contract-test-"));
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
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const owner = await registerAndLogin(
      baseUrl,
      "asset-owner@example.com",
      "owner-pass-123",
      "Asset Owner",
    );

    const content = SAMPLE_PNG_BUFFER;
    const sha256 = createHash("sha256").update(content).digest("hex");

    const registerResponse = await requestJson<{
      uploadId?: string;
      fileId: string;
    }>(baseUrl, "/api/v1/files/register", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        sha256,
        size: content.length,
        mimeType: "image/png",
        originalName: "asset-contract.png",
        fileType: "image",
        sourceType: "input",
      },
    });

    assert.equal(registerResponse.status, 200);
    assert.ok(registerResponse.body.data?.uploadId);

    const uploadResponse = await requestBinaryUpload<{
      fileId: string;
    }>(
      baseUrl,
      registerResponse.body.data!.uploadId!,
      content,
      owner.accessToken,
    );

    assert.equal(uploadResponse.status, 200);
    const fileId = uploadResponse.body.data!.fileId;

    const getResponse = await requestJson<{
      fileId: string;
      thumbnailUrl?: string;
      previewUrl?: string;
      downloadUrl?: string;
      width: number | null;
      height: number | null;
      thumbnailWidth?: number;
      thumbnailHeight?: number;
      previewWidth?: number;
      previewHeight?: number;
    }>(baseUrl, `/api/v1/files/${fileId}`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.body.data?.fileId, fileId);
    assert.equal(getResponse.body.data?.thumbnailUrl, `/api/v1/files/${fileId}/thumbnail`);
    assert.equal(getResponse.body.data?.previewUrl, `/api/v1/files/${fileId}/preview`);
    assert.equal(getResponse.body.data?.downloadUrl, `/api/v1/files/${fileId}/download`);
    assert.equal(getResponse.body.data?.width, 2);
    assert.equal(getResponse.body.data?.height, 3);
    assert.equal(getResponse.body.data?.thumbnailWidth, 2);
    assert.equal(getResponse.body.data?.thumbnailHeight, 3);
    assert.equal(getResponse.body.data?.previewWidth, 2);
    assert.equal(getResponse.body.data?.previewHeight, 3);

    const thumbnailResource = await requestResource(
      baseUrl,
      `/api/v1/files/${fileId}/thumbnail`,
      owner.accessToken,
    );
    const previewResource = await requestResource(
      baseUrl,
      `/api/v1/files/${fileId}/preview`,
      owner.accessToken,
    );
    const downloadResource = await requestResource(
      baseUrl,
      `/api/v1/files/${fileId}/download`,
      owner.accessToken,
    );

    assert.equal(thumbnailResource.status, 200);
    assert.equal(previewResource.status, 200);
    assert.equal(downloadResource.status, 200);
    assert.equal(thumbnailResource.contentType, "image/png");
    assert.equal(previewResource.contentType, "image/png");
    assert.equal(downloadResource.contentType, "image/png");
    assert.ok(thumbnailResource.contentLength);
    assert.ok(previewResource.contentLength);
    assert.equal(downloadResource.contentLength, String(content.length));
    assert.equal(thumbnailResource.cacheControl, "private, max-age=300, stale-while-revalidate=86400");
    assert.equal(previewResource.cacheControl, "private, max-age=120, stale-while-revalidate=3600");
    assert.equal(downloadResource.cacheControl, "private, max-age=0, must-revalidate");
    assert.ok(thumbnailResource.etag);
    assert.ok(previewResource.etag);
    assert.ok(downloadResource.etag);
    assert.ok(thumbnailResource.lastModified);
    assert.ok(previewResource.lastModified);
    assert.ok(downloadResource.lastModified);
    assert.equal(
      thumbnailResource.exposedHeaders,
      "ETag,Last-Modified,Content-Length,Content-Type,Cache-Control",
    );
    assert.equal(
      previewResource.exposedHeaders,
      "ETag,Last-Modified,Content-Length,Content-Type,Cache-Control",
    );
    assert.equal(
      downloadResource.exposedHeaders,
      "ETag,Last-Modified,Content-Length,Content-Type,Cache-Control",
    );
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
