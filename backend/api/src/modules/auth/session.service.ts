import { createHash } from "node:crypto";

import type {
  RefreshTokenPayload,
  RefreshSessionStatus,
} from "@newworkflow/backend-shared/auth";
import type {
  AccountSessionRecord,
  SessionRepository,
} from "./auth.repository.types.ts";
import { TokenService } from "./token.service.ts";

export interface IssueSessionInput {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface SessionVerificationResult {
  session: AccountSessionRecord;
  payload: RefreshTokenPayload;
}

export interface RotateSessionResult extends SessionVerificationResult {
  rotated: boolean;
  refreshToken: string;
}

export interface SessionServiceOptions {
  issuer: string;
  refreshTokenSecret: string;
  refreshTokenTtlSeconds: number;
  rotateRefreshTokenOnUse: boolean;
  sessionRepository: SessionRepository;
}

export class SessionService {
  private readonly sessionRepository: SessionRepository;
  private readonly tokenService: TokenService;
  private readonly rotateRefreshTokenOnUse: boolean;

  constructor(options: SessionServiceOptions) {
    this.sessionRepository = options.sessionRepository;
    this.rotateRefreshTokenOnUse = options.rotateRefreshTokenOnUse;
    this.tokenService = new TokenService({
      issuer: options.issuer,
      accessTokenSecret: "__unused_access_secret__",
      accessTokenTtlSeconds: 60,
      refreshTokenSecret: options.refreshTokenSecret,
      refreshTokenTtlSeconds: options.refreshTokenTtlSeconds,
    });
  }

  async ensureInitialized(): Promise<void> {
    await this.sessionRepository.ensureInitialized();
  }

  async issueRefreshSession(input: IssueSessionInput): Promise<{
    refreshToken: string;
    payload: RefreshTokenPayload;
    session: AccountSessionRecord;
  }> {
    const signed = this.tokenService.signRefreshToken({
      userId: input.userId,
    });
    const session = await this.sessionRepository.createSession({
      sessionId: signed.payload.jti,
      userId: input.userId,
      tokenHash: this.hashRefreshToken(signed.token),
      expiresAt: new Date(signed.payload.exp * 1000).toISOString(),
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
    });

    return {
      refreshToken: signed.token,
      payload: signed.payload,
      session,
    };
  }

  async verifyRefreshSession(refreshToken: string): Promise<SessionVerificationResult> {
    const payload = this.tokenService.verifyRefreshToken(refreshToken);
    const session = await this.sessionRepository.findSessionById(payload.jti);

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    this.assertSessionUsable(session, refreshToken, payload);

    return {
      session,
      payload,
    };
  }

  async rotateRefreshSession(
    refreshToken: string,
    options?: {
      userAgent?: string | null;
      ipAddress?: string | null;
      forceRotate?: boolean;
    },
  ): Promise<RotateSessionResult> {
    const current = await this.verifyRefreshSession(refreshToken);
    const shouldRotate = options?.forceRotate ?? this.rotateRefreshTokenOnUse;

    if (!shouldRotate) {
      return {
        ...current,
        rotated: false,
        refreshToken,
      };
    }

    const signed = this.tokenService.signRefreshToken({
      userId: current.payload.sub,
    });
    const rotated = await this.sessionRepository.rotateSession({
      sessionId: signed.payload.jti,
      previousSessionId: current.session.id,
      userId: current.session.userId,
      tokenHash: this.hashRefreshToken(signed.token),
      expiresAt: new Date(signed.payload.exp * 1000).toISOString(),
      userAgent: options?.userAgent ?? current.session.userAgent,
      ipAddress: options?.ipAddress ?? current.session.ipAddress,
    });

    return {
      session: rotated.nextSession,
      payload: signed.payload,
      rotated: true,
      refreshToken: signed.token,
    };
  }

  async revokeRefreshSession(
    refreshToken: string,
    revokedReason = "manual_logout",
  ): Promise<AccountSessionRecord> {
    const { payload } = await this.verifyRefreshSession(refreshToken);
    return this.sessionRepository.revokeSession(payload.jti, revokedReason);
  }

  async revokeAllUserSessions(
    userId: string,
    revokedReason = "manual_logout_all",
  ): Promise<number> {
    return this.sessionRepository.revokeSessionsByUserId(userId, revokedReason);
  }

  hashRefreshToken(refreshToken: string): string {
    return createHash("sha256").update(refreshToken).digest("hex");
  }

  private assertSessionUsable(
    session: AccountSessionRecord,
    refreshToken: string,
    payload: RefreshTokenPayload,
  ): void {
    const expectedHash = this.hashRefreshToken(refreshToken);

    if (session.tokenHash !== expectedHash) {
      throw new Error("SESSION_TOKEN_MISMATCH");
    }

    if (session.status !== "active") {
      throw new Error(this.mapStatusError(session.status));
    }

    if (Date.parse(session.expiresAt) <= Date.now()) {
      throw new Error("SESSION_EXPIRED");
    }

    if (session.userId !== payload.sub) {
      throw new Error("SESSION_SUBJECT_MISMATCH");
    }
  }

  private mapStatusError(status: RefreshSessionStatus): string {
    switch (status) {
      case "rotated":
        return "SESSION_ROTATED";
      case "revoked":
        return "SESSION_REVOKED";
      case "expired":
        return "SESSION_EXPIRED";
      default:
        return "SESSION_INVALID";
    }
  }
}
