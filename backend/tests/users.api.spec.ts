import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createEnv } from "../shared/src/env.ts";
import { createApiServer } from "../api/src/main.ts";
import { AccountsStoreRepository } from "../api/src/modules/auth/account.repository.ts";
import { AuditRepository } from "../api/src/modules/auth/audit.repository.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";
import { UsersService } from "../api/src/modules/users/users.service.ts";

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

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-users-api-test-"));
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
    const usersFactory = () => UsersService.fromRoot(rootDir, env);
    const accountsRepository = new AccountsStoreRepository(rootDir);
    const apiServer = createApiServer(env, {
      authServiceFactory: authFactory,
      usersServiceFactory: usersFactory,
    });
    server = apiServer;

    await new Promise<void>((resolve) => {
      apiServer.listen(0, "127.0.0.1", () => resolve());
    });

    const address = apiServer.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const adminRegister = await requestJson<{
      tokens: {
        accessToken: string;
        refreshToken: string;
      };
      user: {
        userId: string;
        role: string;
      };
    }>(baseUrl, "/api/v1/auth/register", {
      method: "POST",
      payload: {
        email: "admin@example.com",
        password: "admin-pass-123",
        displayName: "Admin User",
      },
    });
    assert.equal(adminRegister.status, 201);

    const memberRegister = await requestJson<{
      tokens: {
        accessToken: string;
        refreshToken: string;
      };
      user: {
        userId: string;
        email: string;
        role: string;
      };
    }>(baseUrl, "/api/v1/auth/register", {
      method: "POST",
      payload: {
        email: "member@example.com",
        password: "member-pass-123",
        displayName: "Member User",
      },
    });
    assert.equal(memberRegister.status, 201);

    const adminAccount = await accountsRepository.findUserById(
      adminRegister.body.data!.user.userId,
    );
    assert.ok(adminAccount);
    await accountsRepository.updateUser(
      adminRegister.body.data!.user.userId,
      { role: "admin" },
    );

    const adminLogin = await requestJson<{
      tokens: {
        accessToken: string;
        refreshToken: string;
      };
      user: {
        userId: string;
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

    const memberAccessToken = memberRegister.body.data!.tokens.accessToken;
    const memberRefreshToken = memberRegister.body.data!.tokens.refreshToken;
    const adminAccessToken = adminLogin.body.data!.tokens.accessToken;

    const meResponse = await requestJson<{
      userId: string;
      email: string;
    }>(baseUrl, "/api/v1/users/me", {
      headers: {
        Authorization: `Bearer ${memberAccessToken}`,
      },
    });
    assert.equal(meResponse.status, 200);
    assert.equal(meResponse.body.data?.email, "member@example.com");

    const updateMeResponse = await requestJson<{
      user: {
        email: string;
        displayName: string;
      };
    }>(baseUrl, "/api/v1/users/me", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${memberAccessToken}`,
      },
      payload: {
        email: "member.updated@example.com",
        displayName: "Member Updated",
      },
    });
    assert.equal(updateMeResponse.status, 200);
    assert.equal(updateMeResponse.body.data?.user.email, "member.updated@example.com");
    assert.equal(updateMeResponse.body.data?.user.displayName, "Member Updated");

    const updatePasswordResponse = await requestJson<{
      passwordUpdated: true;
      revokedSessionCount: number;
    }>(baseUrl, "/api/v1/users/me/password", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${memberAccessToken}`,
      },
      payload: {
        currentPassword: "member-pass-123",
        newPassword: "member-pass-456",
      },
    });
    assert.equal(updatePasswordResponse.status, 200);
    assert.equal(updatePasswordResponse.body.data?.passwordUpdated, true);
    assert.ok((updatePasswordResponse.body.data?.revokedSessionCount ?? 0) >= 1);

    const refreshAfterPasswordChange = await requestJson(baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      payload: {
        refreshToken: memberRefreshToken,
      },
    });
    assert.equal(refreshAfterPasswordChange.status, 401);
    assert.equal(refreshAfterPasswordChange.body.error, "SESSION_REVOKED");

    const memberRelogin = await requestJson<{
      tokens: {
        accessToken: string;
        refreshToken: string;
      };
    }>(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      payload: {
        email: "member.updated@example.com",
        password: "member-pass-456",
      },
    });
    assert.equal(memberRelogin.status, 200);

    const forbiddenListUsers = await requestJson(baseUrl, "/api/v1/admin/users", {
      headers: {
        Authorization: `Bearer ${memberRelogin.body.data!.tokens.accessToken}`,
      },
    });
    assert.equal(forbiddenListUsers.status, 403);
    assert.equal(forbiddenListUsers.body.error, "AUTH_FORBIDDEN");

    const adminCreateUser = await requestJson<{
      user: {
        userId: string;
        email: string;
        role: string;
        status: string;
      };
    }>(baseUrl, "/api/v1/admin/users", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
      },
      payload: {
        email: "staff@example.com",
        password: "staff-pass-123",
        displayName: "Staff User",
        role: "member",
        status: "enabled",
      },
    });
    assert.equal(adminCreateUser.status, 201);
    assert.equal(adminCreateUser.body.data?.user.email, "staff@example.com");

    const listUsers = await requestJson<{
      items: Array<{ email: string }>;
      total: number;
    }>(baseUrl, "/api/v1/admin/users", {
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
      },
    });
    assert.equal(listUsers.status, 200);
    assert.ok((listUsers.body.data?.total ?? 0) >= 3);

    const staffLogin = await requestJson<{
      tokens: {
        accessToken: string;
        refreshToken: string;
      };
    }>(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      payload: {
        email: "staff@example.com",
        password: "staff-pass-123",
      },
    });
    assert.equal(staffLogin.status, 200);

    const disableUser = await requestJson<{
      user: {
        status: string;
      };
      revokedSessionCount: number;
    }>(baseUrl, `/api/v1/admin/users/${adminCreateUser.body.data!.user.userId}/status`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
      },
      payload: {
        status: "disabled",
      },
    });
    assert.equal(disableUser.status, 200);
    assert.equal(disableUser.body.data?.user.status, "disabled");
    assert.ok((disableUser.body.data?.revokedSessionCount ?? 0) >= 1);

    const disabledLogin = await requestJson(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      payload: {
        email: "staff@example.com",
        password: "staff-pass-123",
      },
    });
    assert.equal(disabledLogin.status, 401);
    assert.equal(disabledLogin.body.error, "AUTH_ACCOUNT_DISABLED");

    const disabledRefresh = await requestJson(baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      payload: {
        refreshToken: staffLogin.body.data!.tokens.refreshToken,
      },
    });
    assert.equal(disabledRefresh.status, 401);

    const enableUser = await requestJson<{
      user: {
        status: string;
      };
    }>(baseUrl, `/api/v1/admin/users/${adminCreateUser.body.data!.user.userId}/status`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
      },
      payload: {
        status: "enabled",
      },
    });
    assert.equal(enableUser.status, 200);
    assert.equal(enableUser.body.data?.user.status, "enabled");

    const resetPassword = await requestJson<{
      user: {
        userId: string;
      };
      revokedSessionCount: number;
    }>(baseUrl, `/api/v1/admin/users/${adminCreateUser.body.data!.user.userId}/password`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
      },
      payload: {
        newPassword: "staff-pass-456",
        revokeExistingSessions: true,
      },
    });
    assert.equal(resetPassword.status, 200);
    assert.ok((resetPassword.body.data?.revokedSessionCount ?? 0) >= 0);

    const staffRelogin = await requestJson(baseUrl, "/api/v1/auth/login", {
      method: "POST",
      payload: {
        email: "staff@example.com",
        password: "staff-pass-456",
      },
    });
    assert.equal(staffRelogin.status, 200);

    const auditRepository = new AuditRepository(rootDir);
    const staffAuditLogs = await auditRepository.listAuditLogsByTargetId(
      adminCreateUser.body.data!.user.userId,
      20,
    );
    assert.ok(
      staffAuditLogs.some((item) => item.action === "admin_user_created"),
    );
    assert.ok(
      staffAuditLogs.some((item) => item.action === "admin_user_disabled"),
    );
    assert.ok(
      staffAuditLogs.some((item) => item.action === "admin_user_password_reset"),
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
