import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AccountsStoreRepository } from "../api/src/modules/auth/account.repository.ts";
import { PasswordService } from "../api/src/modules/auth/password.service.ts";
import { SessionRepository } from "../api/src/modules/auth/session.repository.ts";
import { SessionService } from "../api/src/modules/auth/session.service.ts";
import { TokenService } from "../api/src/modules/auth/token.service.ts";

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-auth-test-"));
  const accountsRepository = new AccountsStoreRepository(rootDir);
  const sessionRepository = new SessionRepository(rootDir);
  const passwordService = new PasswordService();
  const tokenService = new TokenService({
    issuer: "newworkflow-backend-test",
    accessTokenSecret: "test-access-secret",
    accessTokenTtlSeconds: 900,
    refreshTokenSecret: "test-refresh-secret",
    refreshTokenTtlSeconds: 7200,
  });
  const sessionService = new SessionService({
    issuer: "newworkflow-backend-test",
    refreshTokenSecret: "test-refresh-secret",
    refreshTokenTtlSeconds: 7200,
    rotateRefreshTokenOnUse: true,
    sessionRepository,
  });

  await accountsRepository.ensureInitialized();
  await sessionRepository.ensureInitialized();

  const passwordHash = await passwordService.hashPassword("admin-password");
  assert.notEqual(passwordHash, "admin-password");
  assert.ok(passwordHash.startsWith("scrypt:"));
  assert.equal(await passwordService.verifyPassword("admin-password", passwordHash), true);
  assert.equal(await passwordService.verifyPassword("wrong-password", passwordHash), false);

  const createdUser = await accountsRepository.createUser({
    email: "Admin@Example.com",
    passwordHash,
    displayName: "Admin User",
    role: "admin",
  });

  await assert.rejects(
    accountsRepository.createUser({
      email: "admin@example.com",
      passwordHash,
      displayName: "Duplicate",
      role: "member",
    }),
    /ACCOUNT_EMAIL_CONFLICT/,
  );

  const signedAccessToken = tokenService.signAccessToken({
    userId: createdUser.id,
    role: createdUser.role,
    status: createdUser.status,
  });
  const verifiedAccessToken = tokenService.verifyAccessToken(signedAccessToken.token);

  assert.equal(verifiedAccessToken.sub, createdUser.id);
  assert.equal(verifiedAccessToken.role, "admin");
  assert.equal(verifiedAccessToken.status, "enabled");

  const issuedSession = await sessionService.issueRefreshSession({
    userId: createdUser.id,
    userAgent: "test-agent",
    ipAddress: "127.0.0.1",
  });
  assert.equal(issuedSession.session.userId, createdUser.id);
  assert.notEqual(issuedSession.session.tokenHash, issuedSession.refreshToken);

  const verifiedSession = await sessionService.verifyRefreshSession(issuedSession.refreshToken);
  assert.equal(verifiedSession.session.id, issuedSession.session.id);
  assert.equal(verifiedSession.payload.sub, createdUser.id);

  const rotatedSession = await sessionService.rotateRefreshSession(issuedSession.refreshToken);
  assert.equal(rotatedSession.rotated, true);
  assert.notEqual(rotatedSession.refreshToken, issuedSession.refreshToken);
  assert.equal(rotatedSession.session.rotatedFromSessionId, issuedSession.session.id);

  await assert.rejects(
    sessionService.verifyRefreshSession(issuedSession.refreshToken),
    /SESSION_ROTATED/,
  );

  const activeSessions = await sessionRepository.listSessionsByUserId(createdUser.id);
  assert.equal(activeSessions.length, 2);
  assert.equal(activeSessions[0]?.status, "rotated");
  assert.equal(activeSessions[1]?.status, "active");

  const revokedSession = await sessionService.revokeRefreshSession(
    rotatedSession.refreshToken,
    "manual_logout",
  );
  assert.equal(revokedSession.status, "revoked");

  await assert.rejects(
    sessionService.verifyRefreshSession(rotatedSession.refreshToken),
    /SESSION_REVOKED/,
  );

  const nonRotatingSessionService = new SessionService({
    issuer: "newworkflow-backend-test",
    refreshTokenSecret: "test-refresh-secret",
    refreshTokenTtlSeconds: 7200,
    rotateRefreshTokenOnUse: false,
    sessionRepository,
  });
  const secondIssuedSession = await nonRotatingSessionService.issueRefreshSession({
    userId: createdUser.id,
  });
  const nonRotatedResult = await nonRotatingSessionService.rotateRefreshSession(
    secondIssuedSession.refreshToken,
  );
  assert.equal(nonRotatedResult.rotated, false);
  assert.equal(nonRotatedResult.refreshToken, secondIssuedSession.refreshToken);
  assert.equal(nonRotatedResult.session.id, secondIssuedSession.session.id);

  const revokedCount = await nonRotatingSessionService.revokeAllUserSessions(
    createdUser.id,
    "security_reset",
  );
  assert.equal(revokedCount, 1);

  await assert.rejects(
    nonRotatingSessionService.verifyRefreshSession(secondIssuedSession.refreshToken),
    /SESSION_REVOKED/,
  );

  await fs.rm(rootDir, { recursive: true, force: true });
}

void run();
