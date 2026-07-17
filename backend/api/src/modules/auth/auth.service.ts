import type {
  AuthSuccessResponseData,
  AuthTokenBundle,
  AuthUserProfile,
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
  RegisterRequest,
} from "@newworkflow/backend-shared/api";
import type { IncomingMessage } from "node:http";
import type {
  AccountRepository,
  AccountUserRecord,
  AuditRepository,
} from "./auth.repository.types.ts";
import { PasswordService } from "./password.service.ts";
import { SessionService } from "./session.service.ts";
import { TokenService } from "./token.service.ts";

export interface AuthRequestContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface AuthenticatedAccount {
  user: AuthUserProfile;
  accessTokenPayload: {
    userId: string;
    role: AuthUserProfile["role"];
    status: AuthUserProfile["status"];
  };
}

function createRequestContext(request?: IncomingMessage): AuthRequestContext {
  return {
    userAgent: typeof request?.headers["user-agent"] === "string"
      ? request.headers["user-agent"]
      : null,
    ipAddress: request?.socket.remoteAddress ?? null,
  };
}

function parseBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader) {
    throw new Error("AUTHORIZATION_REQUIRED");
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/u);

  if (scheme !== "Bearer" || !token) {
    throw new Error("AUTHORIZATION_INVALID");
  }

  return token;
}

export class AuthService {
  private readonly accountsRepository: AccountRepository;
  private readonly auditRepository: AuditRepository;
  private readonly passwordService: PasswordService;
  private readonly sessionService: SessionService;
  private readonly tokenService: TokenService;
  private readonly accessTokenTtlSeconds: number;

  constructor(options: {
    accountsRepository: AccountRepository;
    auditRepository: AuditRepository;
    passwordService: PasswordService;
    sessionService: SessionService;
    tokenService: TokenService;
    accessTokenTtlSeconds: number;
  }) {
    this.accountsRepository = options.accountsRepository;
    this.auditRepository = options.auditRepository;
    this.passwordService = options.passwordService;
    this.sessionService = options.sessionService;
    this.tokenService = options.tokenService;
    this.accessTokenTtlSeconds = options.accessTokenTtlSeconds;
  }

  async register(
    request: RegisterRequest,
    context: AuthRequestContext = {},
  ): Promise<AuthSuccessResponseData> {
    await this.ensureInitialized();

    const existingUser = await this.accountsRepository.findUserByEmail(request.email);

    if (existingUser) {
      throw new Error("ACCOUNT_EMAIL_CONFLICT");
    }

    const passwordHash = await this.passwordService.hashPassword(request.password);
    const user = await this.accountsRepository.createUser({
      email: request.email,
      passwordHash,
      displayName: request.displayName,
      role: "member",
    });

    await this.auditRepository.createAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: "account_registered",
      targetType: "user",
      targetId: user.id,
      payload: {
        email: user.email,
      },
    });

    return this.createAuthenticatedResponse(user, context, true);
  }

  async login(
    request: LoginRequest,
    context: AuthRequestContext = {},
  ): Promise<AuthSuccessResponseData> {
    await this.ensureInitialized();

    const user = await this.accountsRepository.findUserByEmail(request.email);

    if (!user) {
      throw new Error("AUTH_INVALID_CREDENTIALS");
    }

    if (user.status !== "enabled") {
      throw new Error("AUTH_ACCOUNT_DISABLED");
    }

    const passwordValid = await this.passwordService.verifyPassword(
      request.password,
      user.passwordHash,
    );

    if (!passwordValid) {
      throw new Error("AUTH_INVALID_CREDENTIALS");
    }

    return this.createAuthenticatedResponse(user, context, true);
  }

  async refresh(
    request: RefreshRequest,
    context: AuthRequestContext = {},
  ): Promise<AuthSuccessResponseData> {
    await this.ensureInitialized();

    let rotated: Awaited<ReturnType<SessionService["rotateRefreshSession"]>>;

    try {
      rotated = await this.sessionService.rotateRefreshSession(request.refreshToken, {
        userAgent: context.userAgent ?? null,
        ipAddress: context.ipAddress ?? null,
      });
    } catch (error) {
      await this.auditRefreshFailure(request.refreshToken, error, context);
      throw error;
    }

    const user = await this.accountsRepository.findUserById(rotated.payload.sub);

    if (!user) {
      throw new Error("AUTH_USER_NOT_FOUND");
    }

    if (user.status !== "enabled") {
      await this.sessionService.revokeRefreshSession(
        rotated.refreshToken,
        "account_disabled",
      ).catch(() => undefined);
      throw new Error("AUTH_ACCOUNT_DISABLED");
    }

    const accessToken = this.tokenService.signAccessToken({
      userId: user.id,
      role: user.role,
      status: user.status,
    });

    await this.auditRepository.createAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: "session_refreshed",
      targetType: "session",
      targetId: rotated.session.id,
      payload: {
        rotated: rotated.rotated,
      },
    });

    return {
      tokens: this.toTokenBundle(accessToken.token, rotated.refreshToken),
      user: this.toUserProfile(user),
    };
  }

  async logout(request: LogoutRequest): Promise<void> {
    await this.ensureInitialized();

    try {
      const verification = await this.sessionService.verifyRefreshSession(request.refreshToken);
      await this.sessionService.revokeRefreshSession(request.refreshToken, "manual_logout");
      const user = await this.accountsRepository.findUserById(verification.payload.sub);

      await this.auditRepository.createAuditLog({
        actorUserId: user?.id ?? verification.payload.sub,
        actorRole: user?.role ?? null,
        action: "session_logged_out",
        targetType: "session",
        targetId: verification.session.id,
      });
    } catch (error) {
      if (error instanceof Error && this.isRefreshUnauthorizedError(error.message)) {
        return;
      }

      throw error;
    }
  }

  async getCurrentUser(authorizationHeader: string | undefined): Promise<AuthUserProfile> {
    await this.ensureInitialized();
    const accessToken = parseBearerToken(authorizationHeader);
    const payload = this.tokenService.verifyAccessToken(accessToken);
    const user = await this.accountsRepository.findUserById(payload.sub);

    if (!user) {
      throw new Error("AUTH_USER_NOT_FOUND");
    }

    if (user.status !== "enabled") {
      throw new Error("AUTH_ACCOUNT_DISABLED");
    }

    return this.toUserProfile(user);
  }

  async authenticateAccessToken(
    authorizationHeader: string | undefined,
  ): Promise<AuthenticatedAccount> {
    await this.ensureInitialized();
    const accessToken = parseBearerToken(authorizationHeader);
    const payload = this.tokenService.verifyAccessToken(accessToken);
    const user = await this.accountsRepository.findUserById(payload.sub);

    if (!user) {
      throw new Error("AUTH_USER_NOT_FOUND");
    }

    if (user.status !== "enabled") {
      throw new Error("AUTH_ACCOUNT_DISABLED");
    }

    return {
      user: this.toUserProfile(user),
      accessTokenPayload: {
        userId: payload.sub,
        role: payload.role,
        status: payload.status,
      },
    };
  }

  getRequestContext(request: IncomingMessage): AuthRequestContext {
    return createRequestContext(request);
  }

  private async ensureInitialized(): Promise<void> {
    await this.accountsRepository.ensureInitialized();
    await this.sessionService.ensureInitialized();
    await this.auditRepository.ensureInitialized();
  }

  private async createAuthenticatedResponse(
    user: AccountUserRecord,
    context: AuthRequestContext,
    updateLastLoginAt: boolean,
  ): Promise<AuthSuccessResponseData> {
    const lastLoginAt = new Date().toISOString();
    const persistedUser = updateLastLoginAt
      ? await this.accountsRepository.updateUser(user.id, {
        lastLoginAt,
      })
      : user;
    const accessToken = this.tokenService.signAccessToken({
      userId: persistedUser.id,
      role: persistedUser.role,
      status: persistedUser.status,
    });
    const refreshSession = await this.sessionService.issueRefreshSession({
      userId: persistedUser.id,
      userAgent: context.userAgent ?? null,
      ipAddress: context.ipAddress ?? null,
    });

    await this.auditRepository.createAuditLog({
      actorUserId: persistedUser.id,
      actorRole: persistedUser.role,
      action: "session_created",
      targetType: "session",
      targetId: refreshSession.session.id,
      payload: {
        reason: updateLastLoginAt ? "login_or_register" : "session_create",
      },
    });

    return {
      tokens: this.toTokenBundle(accessToken.token, refreshSession.refreshToken),
      user: this.toUserProfile(persistedUser),
    };
  }

  private toTokenBundle(accessToken: string, refreshToken: string): AuthTokenBundle {
    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: this.accessTokenTtlSeconds,
    };
  }

  private toUserProfile(user: AccountUserRecord): AuthUserProfile {
    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private isRefreshUnauthorizedError(errorCode: string): boolean {
    return [
      "TOKEN_FORMAT_INVALID",
      "TOKEN_HEADER_INVALID",
      "TOKEN_SIGNATURE_INVALID",
      "TOKEN_TYPE_INVALID",
      "TOKEN_ISSUER_INVALID",
      "TOKEN_SUBJECT_INVALID",
      "TOKEN_ID_INVALID",
      "TOKEN_TIME_INVALID",
      "TOKEN_EXPIRED",
      "SESSION_NOT_FOUND",
      "SESSION_TOKEN_MISMATCH",
      "SESSION_ROTATED",
      "SESSION_REVOKED",
      "SESSION_EXPIRED",
      "SESSION_INVALID",
      "SESSION_SUBJECT_MISMATCH",
    ].includes(errorCode);
  }

  private async auditRefreshFailure(
    refreshToken: string,
    error: unknown,
    context: AuthRequestContext,
  ): Promise<void> {
    const reason = error instanceof Error ? error.message : "UNKNOWN_REFRESH_ERROR";

    await this.auditRepository.createAuditLog({
      actorUserId: null,
      actorRole: null,
      action: "session_refresh_failed",
      targetType: "session",
      targetId: null,
      payload: {
        reason,
        isUnauthorizedRefreshFailure: this.isRefreshUnauthorizedError(reason),
        refreshTokenHash: this.sessionService.hashRefreshToken(refreshToken),
        userAgent: context.userAgent ?? null,
        ipAddress: context.ipAddress ?? null,
      },
    }).catch(() => undefined);
  }
}
