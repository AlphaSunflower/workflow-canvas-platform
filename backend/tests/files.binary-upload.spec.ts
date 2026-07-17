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
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-files-binary-upload-test-"));
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
      "binary-owner@example.com",
      "owner-pass-123",
      "Binary Owner",
    );

    const content = SAMPLE_PNG_BUFFER;
    const sha256 = createHash("sha256").update(content).digest("hex");

    const registerResponse = await requestJson<{
      uploadRequired: boolean;
      uploadId?: string;
      uploadUrl?: string;
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
        sha256,
        size: content.length,
        mimeType: "image/png",
        originalName: "binary-image.png",
        fileType: "image",
        sourceType: "input",
      },
    });

    assert.equal(registerResponse.status, 200);
    assert.equal(registerResponse.body.data?.uploadRequired, true);
    assert.ok(registerResponse.body.data?.uploadId);
    assert.ok(registerResponse.body.data?.uploadUrl);
    assert.equal(registerResponse.body.data?.file.userId, owner.userId);
    assert.equal(registerResponse.body.data?.file.status, "pending_upload");

    const uploadResponse = await requestBinaryUpload<{
      uploadId: string;
      fileId: string;
      file: {
        fileId: string;
        userId: string | null;
        sha256: string | null;
        status: string;
        width: number | null;
        height: number | null;
        downloadUrl?: string;
        thumbnailUrl?: string;
        previewUrl?: string;
      };
    }>(
      baseUrl,
      registerResponse.body.data!.uploadId!,
      content,
      owner.accessToken,
    );

    assert.equal(uploadResponse.status, 200);
    assert.equal(uploadResponse.body.data?.file.userId, owner.userId);
    assert.equal(uploadResponse.body.data?.file.sha256, sha256);
    assert.equal(uploadResponse.body.data?.file.status, "ready");
    assert.equal(uploadResponse.body.data?.file.width, 2);
    assert.equal(uploadResponse.body.data?.file.height, 3);
    assert.ok(uploadResponse.body.data?.file.downloadUrl);
    assert.ok(uploadResponse.body.data?.file.thumbnailUrl);
    assert.ok(uploadResponse.body.data?.file.previewUrl);
    assert.notEqual(
      uploadResponse.body.data?.file.thumbnailUrl,
      uploadResponse.body.data?.file.previewUrl,
    );

    const fileId = uploadResponse.body.data!.fileId;
    const blobPath = path.join(rootDir, "storage", "blobs", sha256.slice(0, 2), `${sha256}.png`);
    const blobContent = await fs.readFile(blobPath);
    assert.equal(Buffer.compare(blobContent, content), 0);

    const previewPath = path.join(rootDir, "storage", "blobs", sha256.slice(0, 2), `${sha256}.preview.png`);
    const thumbnailPath = path.join(rootDir, "storage", "blobs", sha256.slice(0, 2), `${sha256}.thumbnail.png`);
    assert.equal(await fs.stat(previewPath).then(() => true).catch(() => false), true);
    assert.equal(await fs.stat(thumbnailPath).then(() => true).catch(() => false), true);

    const duplicateRegister = await requestJson<{
      uploadRequired: boolean;
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
        sha256,
        size: content.length,
        mimeType: "image/png",
        originalName: "binary-image-copy.png",
        fileType: "image",
        sourceType: "input",
      },
    });

    assert.equal(duplicateRegister.status, 200);
    assert.equal(duplicateRegister.body.data?.uploadRequired, false);
    assert.equal(duplicateRegister.body.data?.fileId, fileId);

    const downloadResponse = await requestBuffer(
      baseUrl,
      `/api/v1/files/${fileId}/download`,
      {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    );
    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadResponse.contentType, "image/png");
    assert.equal(Buffer.compare(downloadResponse.buffer, content), 0);

    await fs.rm(blobPath, { force: true });

    const staleRegister = await requestJson<{
      uploadRequired: boolean;
      uploadId?: string;
      fileId: string;
      file: {
        fileId: string;
        status: string;
      };
    }>(baseUrl, "/api/v1/files/register", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        sha256,
        size: content.length,
        mimeType: "image/png",
        originalName: "binary-image-restored.png",
        fileType: "image",
        sourceType: "input",
      },
    });

    assert.equal(staleRegister.status, 200);
    assert.equal(staleRegister.body.data?.uploadRequired, true);
    assert.ok(staleRegister.body.data?.uploadId);
    assert.equal(staleRegister.body.data?.file.status, "pending_upload");

    const repairedUpload = await requestBinaryUpload<{
      fileId: string;
      file: {
        fileId: string;
        sha256: string | null;
        status: string;
      };
    }>(
      baseUrl,
      staleRegister.body.data!.uploadId!,
      content,
      owner.accessToken,
    );

    assert.equal(repairedUpload.status, 200);
    assert.equal(repairedUpload.body.data?.file.sha256, sha256);
    assert.equal(repairedUpload.body.data?.file.status, "ready");

    const restoredOriginalDownload = await requestBuffer(
      baseUrl,
      `/api/v1/files/${fileId}/download`,
      {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    );
    assert.equal(restoredOriginalDownload.status, 200);
    assert.equal(Buffer.compare(restoredOriginalDownload.buffer, content), 0);
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
