import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { createApiServer } from "../api/src/main.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";
import { FilesService } from "../api/src/modules/files/files.service.ts";
import { FilesRepository } from "../api/src/modules/files/files.repository.ts";
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
  cacheControl: string | null;
  etag: string | null;
  lastModified: string | null;
  exposedHeaders: string | null;
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
    lastModified: response.headers.get("last-modified"),
    exposedHeaders: response.headers.get("access-control-expose-headers"),
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

function readPngSize(buffer: Buffer): { width: number; height: number } {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR");

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-files-image-derivative-test-"));
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
      "image-derivative-owner@example.com",
      "owner-pass-123",
      "Derivative Owner",
    );

    const content = createSamplePng(2400, 1200);
    const sha256 = createHash("sha256").update(content).digest("hex");

    const registerResponse = await requestJson<{
      uploadId?: string;
    }>(baseUrl, "/api/v1/files/register", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        sha256,
        size: content.length,
        mimeType: "image/png",
        originalName: "derivative-sample.png",
        fileType: "image",
        sourceType: "input",
      },
    });

    assert.equal(registerResponse.status, 200);
    assert.ok(registerResponse.body.data?.uploadId);

    const uploadResponse = await fetch(
      `${baseUrl}/api/v1/files/upload?uploadId=${encodeURIComponent(registerResponse.body.data!.uploadId!)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${owner.accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: content,
      },
    );
    assert.equal(uploadResponse.status, 200);

    const uploadBody = await uploadResponse.json() as ApiEnvelope<{
      fileId: string;
      file: {
        width: number | null;
        height: number | null;
      };
    }>;

    const fileId = uploadBody.data!.fileId;
    assert.equal(uploadBody.data?.file.width, 2400);
    assert.equal(uploadBody.data?.file.height, 1200);

    const downloadResponse = await requestBuffer(
      baseUrl,
      `/api/v1/files/${fileId}/download`,
      {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    );
    const previewResponse = await requestBuffer(
      baseUrl,
      `/api/v1/files/${fileId}/preview`,
      {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    );
    const thumbnailResponse = await requestBuffer(
      baseUrl,
      `/api/v1/files/${fileId}/thumbnail`,
      {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    );

    assert.equal(downloadResponse.status, 200);
    assert.equal(previewResponse.status, 200);
    assert.equal(thumbnailResponse.status, 200);
    assert.equal(downloadResponse.contentType, "image/png");
    assert.equal(previewResponse.contentType, "image/png");
    assert.equal(thumbnailResponse.contentType, "image/png");
    assert.equal(downloadResponse.cacheControl, "private, max-age=0, must-revalidate");
    assert.equal(previewResponse.cacheControl, "private, max-age=120, stale-while-revalidate=3600");
    assert.equal(thumbnailResponse.cacheControl, "private, max-age=300, stale-while-revalidate=86400");
    assert.ok(downloadResponse.etag);
    assert.ok(previewResponse.etag);
    assert.ok(thumbnailResponse.etag);
    assert.ok(downloadResponse.lastModified);
    assert.ok(previewResponse.lastModified);
    assert.ok(thumbnailResponse.lastModified);
    assert.equal(Buffer.compare(downloadResponse.buffer, content), 0);

    const downloadSize = readPngSize(downloadResponse.buffer);
    const previewSize = readPngSize(previewResponse.buffer);
    const thumbnailSize = readPngSize(thumbnailResponse.buffer);

    assert.deepEqual(downloadSize, { width: 2400, height: 1200 });
    assert.ok(previewSize.width <= 1600);
    assert.ok(previewSize.height <= 1600);
    assert.ok(thumbnailSize.width <= 320);
    assert.ok(thumbnailSize.height <= 320);
    assert.ok(previewSize.width < downloadSize.width);
    assert.ok(thumbnailSize.width < previewSize.width);
    assert.notEqual(Buffer.compare(previewResponse.buffer, downloadResponse.buffer), 0);
    assert.notEqual(Buffer.compare(thumbnailResponse.buffer, previewResponse.buffer), 0);

    const filesRepository = new FilesRepository(rootDir);
    const downloadContent = await filesRepository.readFileContent(fileId, "download");
    const previewContent = await filesRepository.readFileContent(fileId, "preview");
    const thumbnailContent = await filesRepository.readFileContent(fileId, "thumbnail");

    assert.equal(downloadContent?.storageKey.endsWith(`${sha256}.png`), true);
    assert.equal(previewContent?.storageKey.endsWith(`${sha256}.preview.png`), true);
    assert.equal(thumbnailContent?.storageKey.endsWith(`${sha256}.thumbnail.png`), true);
    assert.equal(downloadContent?.byteLength, content.length);
    assert.equal(previewContent?.byteLength, previewResponse.buffer.length);
    assert.equal(thumbnailContent?.byteLength, thumbnailResponse.buffer.length);
    assert.equal(Buffer.compare(downloadContent!.buffer, content), 0);
    assert.equal(Buffer.compare(previewContent!.buffer, previewResponse.buffer), 0);
    assert.equal(Buffer.compare(thumbnailContent!.buffer, thumbnailResponse.buffer), 0);

    const previewNotModified = await requestBuffer(
      baseUrl,
      `/api/v1/files/${fileId}/preview`,
      {
        Authorization: `Bearer ${owner.accessToken}`,
        "If-None-Match": previewResponse.etag!,
      },
    );
    assert.equal(previewNotModified.status, 304);
    assert.equal(previewNotModified.cacheControl, "private, max-age=120, stale-while-revalidate=3600");
    assert.equal(previewNotModified.etag, previewResponse.etag);
    assert.equal(previewNotModified.lastModified, previewResponse.lastModified);
    assert.equal(
      previewNotModified.exposedHeaders,
      "ETag,Last-Modified,Content-Length,Content-Type,Cache-Control",
    );

    const downloadNotModified = await requestBuffer(
      baseUrl,
      `/api/v1/files/${fileId}/download`,
      {
        Authorization: `Bearer ${owner.accessToken}`,
        "If-None-Match": downloadResponse.etag!,
      },
    );
    assert.equal(downloadNotModified.status, 304);
    assert.equal(downloadNotModified.cacheControl, "private, max-age=0, must-revalidate");
    assert.equal(downloadNotModified.etag, downloadResponse.etag);
    assert.equal(downloadNotModified.lastModified, downloadResponse.lastModified);
    assert.equal(
      downloadNotModified.exposedHeaders,
      "ETag,Last-Modified,Content-Length,Content-Type,Cache-Control",
    );

    const thumbnailNotModified = await requestBuffer(
      baseUrl,
      `/api/v1/files/${fileId}/thumbnail`,
      {
        Authorization: `Bearer ${owner.accessToken}`,
        "If-Modified-Since": thumbnailResponse.lastModified!,
      },
    );
    assert.equal(thumbnailNotModified.status, 304);
    assert.equal(thumbnailNotModified.cacheControl, "private, max-age=300, stale-while-revalidate=86400");
    assert.equal(thumbnailNotModified.etag, thumbnailResponse.etag);
    assert.equal(thumbnailNotModified.lastModified, thumbnailResponse.lastModified);
    assert.equal(
      thumbnailNotModified.exposedHeaders,
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
