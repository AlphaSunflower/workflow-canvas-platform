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
  requireAdmin,
  requireAuth,
} from "../auth/auth.guard.ts";
import { getCurrentUserContext } from "../auth/request-context.ts";
import {
  validateAdminCreateUserRequest,
  validateAdminResetUserPasswordRequest,
  validateUpdateCurrentUserPasswordRequest,
  validateUpdateCurrentUserRequest,
  validateUpdateUserStatusRequest,
  validateUserIdParam,
} from "./users.dto.ts";
import { UsersService } from "./users.service.ts";

function mapUsersError(error: string): {
  statusCode: number;
  code: number;
  message: string;
} {
  switch (error) {
    case "INVALID_BODY":
      return { statusCode: 400, code: 40061, message: "请求体必须为 JSON 对象。" };
    case "INVALID_EMAIL":
      return { statusCode: 400, code: 40062, message: "email 格式不正确。" };
    case "INVALID_DISPLAY_NAME":
      return { statusCode: 400, code: 40063, message: "displayName 不能为空且长度不能超过 80。" };
    case "INVALID_PASSWORD":
      return { statusCode: 400, code: 40064, message: "password 至少 8 位且不能为空。" };
    case "INVALID_CURRENT_PASSWORD":
      return { statusCode: 400, code: 40065, message: "currentPassword 至少 8 位且不能为空。" };
    case "INVALID_NEW_PASSWORD":
      return { statusCode: 400, code: 40066, message: "newPassword 至少 8 位且不能为空。" };
    case "INVALID_ROLE":
      return { statusCode: 400, code: 40067, message: "role 仅支持 member/admin。" };
    case "INVALID_STATUS":
      return { statusCode: 400, code: 40068, message: "status 仅支持 enabled/disabled。" };
    case "INVALID_USER_ID":
      return { statusCode: 400, code: 40069, message: "userId 不能为空。" };
    case "INVALID_REVOKE_EXISTING_SESSIONS":
      return { statusCode: 400, code: 40070, message: "revokeExistingSessions 必须为布尔值。" };
    case "ACCOUNT_EMAIL_CONFLICT":
      return { statusCode: 409, code: 40961, message: "邮箱已被注册。" };
    case "ACCOUNT_NOT_FOUND":
      return { statusCode: 404, code: 40461, message: "未找到对应用户。" };
    case "AUTH_INVALID_CREDENTIALS":
      return { statusCode: 401, code: 40161, message: "当前密码错误。" };
    case "ADMIN_SELF_DISABLE_FORBIDDEN":
      return { statusCode: 400, code: 40071, message: "管理员不能禁用自己的账户。" };
    default:
      return { statusCode: 500, code: 50061, message: "用户接口内部错误。" };
  }
}

export class UsersController {
  private readonly usersService: UsersService;

  constructor(usersService: UsersService) {
    this.usersService = usersService;
  }

  async getCurrentUser(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(request, response, this.getUsersService().authService);

      if (!authenticated) {
        return;
      }

      sendApiSuccess(response, getCurrentUserContext(request)?.user ?? authenticated.user);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async updateCurrentUser(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(
        request,
        response,
        this.getUsersService().authService,
      );

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateUpdateCurrentUserRequest(body);
      const result = await this.getUsersService().updateCurrentUser(
        authenticated.user.userId,
        validated,
      );
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async updateCurrentUserPassword(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAuth(
        request,
        response,
        this.getUsersService().authService,
      );

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateUpdateCurrentUserPasswordRequest(body);
      const result = await this.getUsersService().updateCurrentUserPassword(
        authenticated.user.userId,
        validated,
      );
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async listUsers(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAdmin(
        request,
        response,
        this.getUsersService().authService,
      );

      if (!authenticated) {
        return;
      }

      const result = await this.getUsersService().listUsers(authenticated.user.userId);
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async createUser(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const authenticated = await requireAdmin(
        request,
        response,
        this.getUsersService().authService,
      );

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateAdminCreateUserRequest(body);
      const result = await this.getUsersService().createUser(
        authenticated.user.userId,
        validated,
      );
      sendApiSuccess(response, result, 201);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async updateUserStatus(
    request: IncomingMessage,
    response: ServerResponse,
    userId: string,
  ): Promise<void> {
    try {
      const authenticated = await requireAdmin(
        request,
        response,
        this.getUsersService().authService,
      );

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateUpdateUserStatusRequest(body);
      const validatedUserId = validateUserIdParam(userId);
      const result = await this.getUsersService().updateUserStatus(
        authenticated.user.userId,
        validatedUserId,
        validated,
      );
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async resetUserPassword(
    request: IncomingMessage,
    response: ServerResponse,
    userId: string,
  ): Promise<void> {
    try {
      const authenticated = await requireAdmin(
        request,
        response,
        this.getUsersService().authService,
      );

      if (!authenticated) {
        return;
      }

      const body = await readJsonBody(request);
      const validated = validateAdminResetUserPasswordRequest(body);
      const validatedUserId = validateUserIdParam(userId);
      const result = await this.getUsersService().resetUserPassword(
        authenticated.user.userId,
        validatedUserId,
        validated,
      );
      sendApiSuccess(response, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  private getUsersService(): UsersService {
    return this.usersService;
  }

  private handleError(response: ServerResponse, error: unknown): void {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const mapped = mapUsersError(message);

    sendApiError(response, mapped.statusCode, mapped.code, message, mapped.message);
  }
}
