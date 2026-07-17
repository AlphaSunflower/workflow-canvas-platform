import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  bearer,
  cleanupDbE2EContext,
  closeDbApi,
  createDbE2EContext,
  registerAccount,
  requestJson,
  startDbApi,
} from "./bootstrap-db.ts";

async function run(): Promise<void> {
  const context = await createDbE2EContext("auth");
  const api = await startDbApi(context);

  try {
    await fs.mkdir(path.join(context.rootDir, "data"), { recursive: true });
    await fs.writeFile(
      path.join(context.rootDir, "data", "accounts-store.json"),
      JSON.stringify({
        users: [
          {
            id: "legacy-json-user",
            email: "legacy-json@example.com",
            displayName: "Legacy JSON",
            role: "admin",
            status: "enabled",
          },
        ],
        sessions: [],
        auditLogs: [],
      }),
      "utf8",
    );
    await fs.rm(path.join(context.rootDir, "data", "accounts-store.json"), {
      force: true,
    });

    const adminCreate = await requestJson<{
      user: { userId: string; email: string; role: string };
    }>(api.baseUrl, "/api/v1/auth/register", {
      method: "POST",
      payload: {
        email: "admin-auth-db@example.com",
        password: "admin-auth-pass",
        displayName: "Admin Auth DB",
      },
    });
    assert.equal(adminCreate.status, 201);
    const adminUserId = adminCreate.body.data!.user.userId;

    await context.pool.query(
      "update users set role = 'admin', updated_at = now() where id = $1",
      [adminUserId],
    );

    const adminLogin = await requestJson<{
      tokens: { accessToken: string; refreshToken: string };
      user: { userId: string; email: string; role: string };
    }>(api.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      payload: {
        email: "admin-auth-db@example.com",
        password: "admin-auth-pass",
      },
    });
    assert.equal(adminLogin.status, 200);
    assert.equal(adminLogin.body.data!.user.role, "admin");
    const adminToken = adminLogin.body.data!.tokens.accessToken;

    const member = await registerAccount(api.baseUrl, {
      email: "member-auth-db@example.com",
      password: "member-auth-pass",
      displayName: "Member Auth DB",
    });

    const duplicate = await requestJson(api.baseUrl, "/api/v1/auth/register", {
      method: "POST",
      payload: {
        email: "MEMBER-auth-db@example.com",
        password: "member-auth-pass",
        displayName: "Duplicate Member",
      },
    });
    assert.equal(duplicate.status, 409);

    const memberLogin = await requestJson<{
      tokens: { accessToken: string; refreshToken: string };
      user: { userId: string; role: string };
    }>(api.baseUrl, "/api/v1/auth/login", {
      method: "POST",
      payload: {
        email: "member-auth-db@example.com",
        password: "member-auth-pass",
      },
    });
    assert.equal(memberLogin.status, 200);
    assert.equal(memberLogin.body.data!.user.role, "member");

    const memberRefresh = await requestJson<{
      tokens: { accessToken: string; refreshToken: string };
      user: { userId: string };
    }>(api.baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      payload: {
        refreshToken: memberLogin.body.data!.tokens.refreshToken,
      },
    });
    assert.equal(memberRefresh.status, 200);
    assert.equal(memberRefresh.body.data!.user.userId, member.userId);
    assert.notEqual(
      memberRefresh.body.data!.tokens.refreshToken,
      memberLogin.body.data!.tokens.refreshToken,
    );

    const reusedRefresh = await requestJson(api.baseUrl, "/api/v1/auth/refresh", {
      method: "POST",
      payload: {
        refreshToken: memberLogin.body.data!.tokens.refreshToken,
      },
    });
    assert.equal(reusedRefresh.status, 401);

    const logout = await requestJson<{ loggedOut: boolean }>(api.baseUrl, "/api/v1/auth/logout", {
      method: "POST",
      payload: {
        refreshToken: memberRefresh.body.data!.tokens.refreshToken,
      },
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.body.data!.loggedOut, true);

    const memberAdminList = await requestJson(api.baseUrl, "/api/v1/admin/users", {
      headers: bearer(memberRefresh.body.data!.tokens.accessToken),
    });
    assert.equal(memberAdminList.status, 403);

    const adminList = await requestJson<{
      items: Array<{ userId: string; role: string }>;
      total: number;
    }>(api.baseUrl, "/api/v1/admin/users", {
      headers: bearer(adminToken),
    });
    assert.equal(adminList.status, 200);
    assert.equal(adminList.body.data!.total, 2);
    assert.ok(adminList.body.data!.items.some((user) => user.userId === adminUserId && user.role === "admin"));
    assert.ok(adminList.body.data!.items.some((user) => user.userId === member.userId && user.role === "member"));

    const dbCounts = await context.pool.query<{
      users: number;
      sessions: number;
      audit_logs: number;
      active_sessions: number;
      rotated_sessions: number;
      revoked_sessions: number;
    }>(
      `
        select
          (select count(*)::int from users) as users,
          (select count(*)::int from refresh_tokens) as sessions,
          (select count(*)::int from audit_logs) as audit_logs,
          (select count(*)::int from refresh_tokens where status = 'active') as active_sessions,
          (select count(*)::int from refresh_tokens where status = 'rotated') as rotated_sessions,
          (select count(*)::int from refresh_tokens where status = 'revoked') as revoked_sessions
      `,
    );
    assert.equal(dbCounts.rows[0]?.users, 2);
    assert.ok((dbCounts.rows[0]?.sessions ?? 0) >= 5);
    assert.ok((dbCounts.rows[0]?.audit_logs ?? 0) >= 8);
    assert.ok((dbCounts.rows[0]?.active_sessions ?? 0) >= 2);
    assert.ok((dbCounts.rows[0]?.rotated_sessions ?? 0) >= 1);
    assert.ok((dbCounts.rows[0]?.revoked_sessions ?? 0) >= 1);

    const auditActions = await context.pool.query<{ action: string }>(
      "select action from audit_logs order by created_at asc",
    );
    const actions = auditActions.rows.map((row) => row.action);
    assert.ok(actions.includes("account_registered"));
    assert.ok(actions.includes("session_created"));
    assert.ok(actions.includes("session_refreshed"));
    assert.ok(actions.includes("session_refresh_failed"));
    assert.ok(actions.includes("session_logged_out"));
    assert.ok(actions.includes("admin_users_listed"));

    const legacyStoreStillMissing = await fs.stat(
      path.join(context.rootDir, "data", "accounts-store.json"),
    ).then(
      () => false,
      () => true,
    );
    assert.equal(legacyStoreStillMissing, true);
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
