import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionRepository } from "./session.repository.ts";
import { SessionService } from "./session.service.ts";

async function createSessionService(
  rotateRefreshTokenOnUse: boolean,
): Promise<{
  rootDir: string;
  sessionService: SessionService;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "newworkflow-session-service-test-"));
  const sessionService = new SessionService({
    issuer: "newworkflow-backend-test",
    refreshTokenSecret: "test-refresh-secret",
    refreshTokenTtlSeconds: 7200,
    rotateRefreshTokenOnUse,
    sessionRepository: new SessionRepository(rootDir),
  });

  await sessionService.ensureInitialized();

  return {
    rootDir,
    sessionService,
  };
}

test("SessionService rotates refresh token when rotateRefreshTokenOnUse is enabled", async () => {
  const { rootDir, sessionService } = await createSessionService(true);

  try {
    const issuedSession = await sessionService.issueRefreshSession({
      userId: "user-rotate-enabled",
    });

    const rotatedSession = await sessionService.rotateRefreshSession(issuedSession.refreshToken);

    assert.equal(rotatedSession.rotated, true);
    assert.notEqual(rotatedSession.refreshToken, issuedSession.refreshToken);
    assert.equal(rotatedSession.session.rotatedFromSessionId, issuedSession.session.id);

    await assert.rejects(
      sessionService.verifyRefreshSession(issuedSession.refreshToken),
      /SESSION_ROTATED/,
    );
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("SessionService keeps refresh token stable when rotateRefreshTokenOnUse is disabled", async () => {
  const { rootDir, sessionService } = await createSessionService(false);

  try {
    const issuedSession = await sessionService.issueRefreshSession({
      userId: "user-rotate-disabled",
    });

    const refreshResult = await sessionService.rotateRefreshSession(issuedSession.refreshToken);
    const verifiedSession = await sessionService.verifyRefreshSession(issuedSession.refreshToken);

    assert.equal(refreshResult.rotated, false);
    assert.equal(refreshResult.refreshToken, issuedSession.refreshToken);
    assert.equal(refreshResult.session.id, issuedSession.session.id);
    assert.equal(verifiedSession.session.status, "active");
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
