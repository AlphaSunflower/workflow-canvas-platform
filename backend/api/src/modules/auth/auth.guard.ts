import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import { sendApiError } from "@newworkflow/backend-shared";
import type { AuthenticatedAccount } from "./auth.service.ts";
import { AuthService } from "./auth.service.ts";
import {
  getCurrentUserContext,
  setCurrentUserContext,
} from "./request-context.ts";

function getAuthorizationHeader(request: IncomingMessage): string | undefined {
  return Array.isArray(request.headers.authorization)
    ? request.headers.authorization[0]
    : request.headers.authorization;
}

function isUnauthorizedError(errorCode: string): boolean {
  return [
    "AUTHORIZATION_REQUIRED",
    "AUTHORIZATION_INVALID",
    "AUTH_ACCOUNT_DISABLED",
    "AUTH_USER_NOT_FOUND",
    "TOKEN_FORMAT_INVALID",
    "TOKEN_HEADER_INVALID",
    "TOKEN_SIGNATURE_INVALID",
    "TOKEN_TYPE_INVALID",
    "TOKEN_ISSUER_INVALID",
    "TOKEN_SUBJECT_INVALID",
    "TOKEN_ID_INVALID",
    "TOKEN_TIME_INVALID",
    "TOKEN_EXPIRED",
  ].includes(errorCode);
}

export function sendUnauthorized(response: ServerResponse, errorCode: string): void {
  const mapped = errorCode === "AUTHORIZATION_REQUIRED"
    ? { code: 40152, message: "缺少 Authorization 头。" }
    : errorCode === "AUTHORIZATION_INVALID"
      ? { code: 40153, message: "Authorization 头格式无效。" }
      : errorCode === "AUTH_ACCOUNT_DISABLED"
        ? { code: 40154, message: "账户已被禁用。" }
        : errorCode === "AUTH_USER_NOT_FOUND"
          ? { code: 40155, message: "当前用户不存在。" }
          : { code: 40156, message: "认证已失效，请重新登录。" };

  sendApiError(response, 401, mapped.code, errorCode, mapped.message);
}

export function sendForbidden(response: ServerResponse): void {
  sendApiError(response, 403, 40361, "AUTH_FORBIDDEN", "当前账户无权执行该操作。");
}

export async function requireAuth(
  request: IncomingMessage,
  response: ServerResponse,
  authService: AuthService,
): Promise<AuthenticatedAccount | null> {
  const cached = getCurrentUserContext(request);

  if (cached) {
    return cached;
  }

  try {
    const authenticated = await authService.authenticateAccessToken(
      getAuthorizationHeader(request),
    );
    setCurrentUserContext(request, authenticated);
    return authenticated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "AUTHORIZATION_INVALID";
    sendUnauthorized(response, isUnauthorizedError(message) ? message : "AUTHORIZATION_INVALID");
    return null;
  }
}

export async function requireAdmin(
  request: IncomingMessage,
  response: ServerResponse,
  authService: AuthService,
): Promise<AuthenticatedAccount | null> {
  const authenticated = await requireAuth(request, response, authService);

  if (!authenticated) {
    return null;
  }

  if (authenticated.user.role !== "admin") {
    sendForbidden(response);
    return null;
  }

  return authenticated;
}
