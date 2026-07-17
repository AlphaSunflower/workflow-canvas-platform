import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createEnv } from "../shared/src/env.ts";
import { createApiServer } from "../api/src/main.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  error?: string;
  data?: T;
  timestamp: number;
}

async function postJson<TResponse>(
  baseUrl: string,
  pathname: string,
  payload: unknown,
  headers?: Record<string, string>,
): Promise<{
  status: number;
  body: ApiEnvelope<TResponse>;
}> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(payload),
  });

  return {
    status: response.status,
    body: await response.json() as ApiEnvelope<TResponse>,
  };
}

async function getJson<TResponse>(
  baseUrl: string,
  pathname: string,
  headers?: Record<string, string>,
): Promise<{
  status: number;
  body: ApiEnvelope<TResponse>;
}> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: headers ?? {},
  });

  return {
    status: response.status,
    body: await response.json() as ApiEnvelope<TResponse>,
  };
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-auth-api-test-"));
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
    const apiServer = createApiServer(env, {
      authServiceFactory: () => AuthService.fromRoot(rootDir, env),
    });
    server = apiServer;

    await new Promise<void>((resolve) => {
      apiServer.listen(0, "127.0.0.1", () => resolve());
    });

    const address = apiServer.address();

    assert.ok(address && typeof address === "object");

    const baseUrl = `http://127.0.0.1:${address.port}`;

    const registerResponse = await postJson<{
      tokens: {
        accessToken: string;
        refreshToken: string;
        tokenType: string;
        expiresIn: number;
      };
      user: {
        userId: string;
        email: string;
        displayName: string;
        role: string;
        status: string;
      };
    }>(baseUrl, "/api/v1/auth/register", {
      email: "member@example.com",
      password: "password123",
      displayName: "Member User",
    });

    assert.equal(registerResponse.status, 201);
    assert.equal(registerResponse.body.code, 0);
    assert.equal(registerResponse.body.data?.user.email, "member@example.com");
    assert.equal(registerResponse.body.data?.user.role, "member");
    assert.ok(registerResponse.body.data?.tokens.accessToken);
    assert.ok(registerResponse.body.data?.tokens.refreshToken);

    const duplicateRegisterResponse = await postJson(baseUrl, "/api/v1/auth/register", {
      email: "member@example.com",
      password: "password123",
      displayName: "Member User",
    });
    assert.equal(duplicateRegisterResponse.status, 409);
    assert.equal(duplicateRegisterResponse.body.error, "ACCOUNT_EMAIL_CONFLICT");

    const invalidLoginResponse = await postJson(baseUrl, "/api/v1/auth/login", {
      email: "member@example.com",
      password: "wrong-password",
    });
    assert.equal(invalidLoginResponse.status, 401);
    assert.equal(invalidLoginResponse.body.error, "AUTH_INVALID_CREDENTIALS");

    const loginResponse = await postJson<{
      tokens: {
        accessToken: string;
        refreshToken: string;
      };
      user: {
        userId: string;
        email: string;
        displayName: string;
      };
    }>(baseUrl, "/api/v1/auth/login", {
      email: "member@example.com",
      password: "password123",
    });

    assert.equal(loginResponse.status, 200);
    assert.equal(loginResponse.body.code, 0);
    assert.equal(loginResponse.body.data?.user.email, "member@example.com");
    assert.ok(loginResponse.body.data?.tokens.accessToken);
    assert.ok(loginResponse.body.data?.tokens.refreshToken);

    const meUnauthorizedResponse = await getJson(baseUrl, "/api/v1/auth/me");
    assert.equal(meUnauthorizedResponse.status, 401);
    assert.equal(meUnauthorizedResponse.body.error, "AUTHORIZATION_REQUIRED");

    const meResponse = await getJson<{
      userId: string;
      email: string;
      displayName: string;
    }>(baseUrl, "/api/v1/auth/me", {
      Authorization: `Bearer ${loginResponse.body.data!.tokens.accessToken}`,
    });

    assert.equal(meResponse.status, 200);
    assert.equal(meResponse.body.code, 0);
    assert.equal(meResponse.body.data?.email, "member@example.com");

    const refreshResponse = await postJson<{
      tokens: {
        accessToken: string;
        refreshToken: string;
      };
      user: {
        userId: string;
      };
    }>(baseUrl, "/api/v1/auth/refresh", {
      refreshToken: loginResponse.body.data!.tokens.refreshToken,
    });

    assert.equal(refreshResponse.status, 200);
    assert.equal(refreshResponse.body.code, 0);
    assert.notEqual(
      refreshResponse.body.data?.tokens.refreshToken,
      loginResponse.body.data?.tokens.refreshToken,
    );

    const staleRefreshResponse = await postJson(baseUrl, "/api/v1/auth/refresh", {
      refreshToken: loginResponse.body.data!.tokens.refreshToken,
    });
    assert.equal(staleRefreshResponse.status, 401);
    assert.equal(staleRefreshResponse.body.error, "SESSION_ROTATED");

    const logoutResponse = await postJson<{ loggedOut: boolean }>(
      baseUrl,
      "/api/v1/auth/logout",
      {
        refreshToken: refreshResponse.body.data!.tokens.refreshToken,
      },
    );
    assert.equal(logoutResponse.status, 200);
    assert.equal(logoutResponse.body.code, 0);
    assert.equal(logoutResponse.body.data?.loggedOut, true);

    const refreshAfterLogout = await postJson(baseUrl, "/api/v1/auth/refresh", {
      refreshToken: refreshResponse.body.data!.tokens.refreshToken,
    });
    assert.equal(refreshAfterLogout.status, 401);
    assert.equal(refreshAfterLogout.body.error, "SESSION_REVOKED");

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
