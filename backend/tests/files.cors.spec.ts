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
const DEV_ORIGIN = "http://localhost:3000";
const DEV_LOOPBACK_ORIGIN = "http://127.0.0.1:3000";

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

async function registerAndLogin(baseUrl: string): Promise<{ accessToken: string }> {
  const response = await requestJson<{
    tokens: {
      accessToken: string;
    };
  }>(baseUrl, "/api/v1/auth/register", {
    method: "POST",
    payload: {
      email: "cors-owner@example.com",
      password: "owner-pass-123",
      displayName: "Cors Owner",
    },
  });

  assert.equal(response.status, 201);
  return {
    accessToken: response.body.data!.tokens.accessToken,
  };
}

async function registerAndLoginWithEmail(
  baseUrl: string,
  email: string,
): Promise<{ accessToken: string }> {
  const response = await requestJson<{
    tokens: {
      accessToken: string;
    };
  }>(baseUrl, "/api/v1/auth/register", {
    method: "POST",
    payload: {
      email,
      password: "owner-pass-123",
      displayName: email,
    },
  });

  assert.equal(response.status, 201);
  return {
    accessToken: response.body.data!.tokens.accessToken,
  };
}

async function createReadyImageFile(baseUrl: string, accessToken: string): Promise<string> {
  const sha256 = createHash("sha256").update(SAMPLE_PNG_BUFFER).digest("hex");
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
      size: SAMPLE_PNG_BUFFER.length,
      mimeType: "image/png",
      originalName: "cors.png",
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
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: SAMPLE_PNG_BUFFER,
    },
  );
  const uploadBody = await uploadResponse.json() as ApiEnvelope<{ fileId: string }>;

  assert.equal(uploadResponse.status, 200);
  return uploadBody.data!.fileId;
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-files-cors-test-"));
  const originalConfigPath = process.env.BACKEND_CONFIG_PATH;
  const configPath = path.join(rootDir, "backend.config.json");
  let server: ReturnType<typeof createApiServer> | null = null;

  await fs.writeFile(configPath, JSON.stringify({
    persistence: {
      mode: "json",
    },
    runtime: {
      host: "127.0.0.1",
      nodeEnv: "development",
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
    const owner = await registerAndLogin(baseUrl);
    const other = await registerAndLoginWithEmail(baseUrl, "cors-other@example.com");
    const fileId = await createReadyImageFile(baseUrl, owner.accessToken);

    for (const origin of [DEV_ORIGIN, DEV_LOOPBACK_ORIGIN]) {
      const preflightResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}/download`, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization,content-type,if-none-match,if-modified-since",
        },
      });

      assert.equal(preflightResponse.status, 204);
      assert.equal(preflightResponse.headers.get("access-control-allow-origin"), origin);
      assert.match(preflightResponse.headers.get("access-control-allow-methods") ?? "", /\bGET\b/);
      assert.match(preflightResponse.headers.get("access-control-allow-headers") ?? "", /\bAuthorization\b/);
      assert.match(preflightResponse.headers.get("access-control-allow-headers") ?? "", /\bIf-None-Match\b/);
      assert.match(preflightResponse.headers.get("access-control-allow-headers") ?? "", /\bIf-Modified-Since\b/);
      assert.match(preflightResponse.headers.get("access-control-expose-headers") ?? "", /\bETag\b/);
    }

    const downloadResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}/download`, {
      headers: {
        Origin: DEV_ORIGIN,
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });
    await downloadResponse.arrayBuffer();

    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadResponse.headers.get("access-control-allow-origin"), DEV_ORIGIN);
    assert.match(downloadResponse.headers.get("access-control-expose-headers") ?? "", /\bContent-Length\b/);
    assert.ok(downloadResponse.headers.get("etag"));
    assert.ok(downloadResponse.headers.get("last-modified"));
    assert.ok(downloadResponse.headers.get("content-length"));
    assert.ok(downloadResponse.headers.get("cache-control"));
    assert.equal(downloadResponse.headers.get("content-type"), "image/png");

    const unauthorizedResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}/download`, {
      headers: {
        Origin: DEV_ORIGIN,
      },
    });
    assert.equal(unauthorizedResponse.status, 401);
    assert.equal(unauthorizedResponse.headers.get("access-control-allow-origin"), DEV_ORIGIN);

    const forbiddenResponse = await fetch(`${baseUrl}/api/v1/files/${fileId}/download`, {
      headers: {
        Origin: DEV_ORIGIN,
        Authorization: `Bearer ${other.accessToken}`,
      },
    });
    const forbiddenBody = await forbiddenResponse.json() as ApiEnvelope<unknown>;
    assert.equal(forbiddenResponse.status, 403);
    assert.equal(forbiddenBody.error, "AUTH_FORBIDDEN");
    assert.equal(forbiddenResponse.headers.get("access-control-allow-origin"), DEV_ORIGIN);
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
