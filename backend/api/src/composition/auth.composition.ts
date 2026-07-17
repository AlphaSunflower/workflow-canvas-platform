import type { ServiceEnv } from "@newworkflow/backend-shared";
import { AuthController } from "../modules/auth/auth.controller.ts";
import { AuthService } from "../modules/auth/auth.service.ts";
import { DbAccountRepository } from "../modules/auth/db-account.repository.ts";
import { DbAuditRepository } from "../modules/auth/db-audit.repository.ts";
import { DbSessionRepository } from "../modules/auth/db-session.repository.ts";
import { JsonAccountRepository } from "../modules/auth/json-account.repository.ts";
import { JsonAuditRepository } from "../modules/auth/json-audit.repository.ts";
import { JsonSessionRepository } from "../modules/auth/json-session.repository.ts";
import { PasswordService } from "../modules/auth/password.service.ts";
import { SessionService } from "../modules/auth/session.service.ts";
import { TokenService } from "../modules/auth/token.service.ts";
import { UsersController } from "../modules/users/users.controller.ts";
import { UsersService } from "../modules/users/users.service.ts";
import type { ApiCompositionContext } from "./api-composition.context.ts";
import {
  requireAuthSecret,
  resolveApiRootDir,
} from "./api-composition.shared.ts";

export interface AuthServiceFactoryInput {
  env: ServiceEnv;
  rootDir?: string;
}

export interface UsersServiceFactoryInput extends AuthServiceFactoryInput {
  authService?: AuthService;
}

function createAccountRepository(input: AuthServiceFactoryInput) {
  if (input.env.persistenceMode === "db") {
    return new DbAccountRepository(input.env.database);
  }

  return new JsonAccountRepository(resolveApiRootDir(input.rootDir));
}

function createAuditRepository(input: AuthServiceFactoryInput) {
  if (input.env.persistenceMode === "db") {
    return new DbAuditRepository(input.env.database);
  }

  return new JsonAuditRepository(resolveApiRootDir(input.rootDir));
}

function createSessionRepository(input: AuthServiceFactoryInput) {
  if (input.env.persistenceMode === "db") {
    return new DbSessionRepository(input.env.database);
  }

  return new JsonSessionRepository(resolveApiRootDir(input.rootDir));
}

export function createAuthService(input: AuthServiceFactoryInput): AuthService {
  const accessTokenSecret = requireAuthSecret(
    input.env.authAccessTokenSecret,
    "AUTH_ACCESS_TOKEN_SECRET_REQUIRED",
  );
  const refreshTokenSecret = requireAuthSecret(
    input.env.authRefreshTokenSecret,
    "AUTH_REFRESH_TOKEN_SECRET_REQUIRED",
  );

  return new AuthService({
    accountsRepository: createAccountRepository(input),
    auditRepository: createAuditRepository(input),
    passwordService: new PasswordService(),
    sessionService: new SessionService({
      issuer: input.env.authIssuer,
      refreshTokenSecret,
      refreshTokenTtlSeconds: input.env.authRefreshTokenTtlSeconds,
      rotateRefreshTokenOnUse: input.env.authRotateRefreshTokenOnUse,
      sessionRepository: createSessionRepository(input),
    }),
    tokenService: new TokenService({
      issuer: input.env.authIssuer,
      accessTokenSecret,
      accessTokenTtlSeconds: input.env.authAccessTokenTtlSeconds,
      refreshTokenSecret,
      refreshTokenTtlSeconds: input.env.authRefreshTokenTtlSeconds,
    }),
    accessTokenTtlSeconds: input.env.authAccessTokenTtlSeconds,
  });
}

export function createUsersService(input: UsersServiceFactoryInput): UsersService {
  const refreshTokenSecret = requireAuthSecret(
    input.env.authRefreshTokenSecret,
    "AUTH_REFRESH_TOKEN_SECRET_REQUIRED",
  );

  return new UsersService({
    authService: input.authService ?? createAuthService(input),
    accountsRepository: createAccountRepository(input),
    auditRepository: createAuditRepository(input),
    passwordService: new PasswordService(),
    sessionService: new SessionService({
      issuer: input.env.authIssuer,
      refreshTokenSecret,
      refreshTokenTtlSeconds: input.env.authRefreshTokenTtlSeconds,
      rotateRefreshTokenOnUse: input.env.authRotateRefreshTokenOnUse,
      sessionRepository: createSessionRepository(input),
    }),
  });
}

export function composeAuthModule(context: ApiCompositionContext) {
  const env = context.requireEnv();
  const authService = context.resolve(
    "authService",
    () => createAuthService({
      env,
      rootDir: context.rootDir,
    }),
  );
  const usersService = context.resolve(
    "usersService",
    () => createUsersService({
      env,
      rootDir: context.rootDir,
      authService,
    }),
  );

  return {
    services: {
      authService,
      usersService,
    },
    controllers: {
      authController: context.resolve(
        "authController",
        () => new AuthController(authService),
      ),
      usersController: context.resolve(
        "usersController",
        () => new UsersController(usersService),
      ),
    },
  };
}
