import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import {
  readJsonBody,
  sendApiError,
  sendApiSuccess,
} from "@newworkflow/backend-shared";
import {
  validateLoginRequest,
  validateLogoutRequest,
  validateRefreshRequest,
  validateRegisterRequest,
} from "./auth.dto.ts";
import { requireAuth } from "./auth.guard.ts";
import { AuthService } from "./auth.service.ts";
import { getCurrentUserContext } from "./request-context.ts";

function mapAuthError(error: string): {
  statusCode: number;
  code: number;
  message: string;
  errorCode?: string;
} {
  switch (error) {
    case "INVALID_BODY":
      return { statusCode: 400, code: 40051, message: "请求体必须为 JSON 对象。" };
    case "INVALID_EMAIL":
      return { statusCode: 400, code: 40052, message: "email 格式不正确。" };
    case "INVALID_PASSWORD":
      return { statusCode: 400, code: 40053, message: "password 至少 8 位且不能为空。" };
    case "INVALID_DISPLAY_NAME":
      return { statusCode: 400, code: 40054, message: "displayName 不能为空且长度不能超过 80。" };
    case "INVALID_REFRESH_TOKEN":
      return { statusCode: 400, code: 40055, message: "refreshToken 不能为空。" };
    case "ACCOUNT_EMAIL_CONFLICT":
      return { statusCode: 409, code: 40951, message: "邮箱已被注册。" };
    case "AUTH_INVALID_CREDENTIALS":
      return { statusCode: 401, code: 40151, message: "邮箱或密码错误。" };
    case "AUTH_ACCOUNT_DISABLED":
      return { statusCode: 401, code: 40154, message: "账户已被禁用。" };
    case "AUTH_USER_NOT_FOUND":
      return { statusCode: 401, code: 40155, message: "当前用户不存在。" };
    case "TOKEN_FORMAT_INVALID":
    case "TOKEN_HEADER_INVALID":
    case "TOKEN_SIGNATURE_INVALID":
    case "TOKEN_TYPE_INVALID":
    case "TOKEN_ISSUER_INVALID":
    case "TOKEN_SUBJECT_INVALID":
    case "TOKEN_ID_INVALID":
    case "TOKEN_TIME_INVALID":
    case "TOKEN_EXPIRED":
    case "SESSION_NOT_FOUND":
    case "SESSION_TOKEN_MISMATCH":
    case "SESSION_ROTATED":
    case "SESSION_REVOKED":
    case "SESSION_EXPIRED":
    case "SESSION_INVALID":
    case "SESSION_SUBJECT_MISMATCH":
      return { statusCode: 401, code: 40156, message: "认证已失效，请重新登录。" };
    case "AUTH_ACCESS_TOKEN_SECRET_REQUIRED":
    case "AUTH_REFRESH_TOKEN_SECRET_REQUIRED":
      return { statusCode: 500, code: 50051, message: "认证模块尚未完成服务端配置。" };
    default:
      return {
        statusCode: 500,
        code: 50052,
        message: "认证接口内部错误。",
        errorCode: "INTERNAL_ERROR",
      };
  }
}

export class AuthController {
  private readonly authService: AuthService;

  constructor(authService: AuthService) {
    this.authService = authService;
  }

  async register(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const body = await readJsonBody(request);
      const validated = validateRegisterRequest(body);
      const result = await this.getAuthService().register(
        validated,
        this.getAuthService().getRequestContext(request),
      );
      sendApiSuccess(response, result, 201);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async login(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const body = await readJsonBody(request);
      const validated = validateLoginRequest(body);
      const result = await this.getAuthService().login(
        validated,
        this.getAuthService().getRequestContext(request),
      );
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async refresh(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const body = await readJsonBody(request);
      const validated = validateRefreshRequest(body);
      const result = await this.getAuthService().refresh(
        validated,
        this.getAuthService().getRequestContext(request),
      );
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async logout(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const body = await readJsonBody(request);
      const validated = validateLogoutRequest(body);
      await this.getAuthService().logout(validated);
      sendApiSuccess(response, { loggedOut: true });
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async me(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getAuthService());

      if (!authenticated) {
        return;
      }

      sendApiSuccess(response, getCurrentUserContext(request)?.user ?? authenticated.user);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  private getAuthService(): AuthService {
    return this.authService;
  }

  private handleError(response: ServerResponse, error: unknown): void {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const mapped = mapAuthError(message);

    sendApiError(
      response,
      mapped.statusCode,
      mapped.code,
      mapped.errorCode ?? message,
      mapped.message,
    );
  }
}
