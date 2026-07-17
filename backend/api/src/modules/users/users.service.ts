import type {
  AdminCreateUserRequest,
  AdminResetUserPasswordRequest,
  UpdateCurrentUserPasswordRequest,
  UpdateCurrentUserPasswordResponseData,
  UpdateCurrentUserRequest,
  UpdateUserStatusRequest,
  UserItemResponseData,
  UserListResponseData,
  UserMutationResponseData,
  UserPasswordMutationResponseData,
  UserStatusMutationResponseData,
} from "@newworkflow/backend-shared/api";
import type {
  AccountRepository,
  AccountUserRecord,
  AuditRepository,
} from "../auth/auth.repository.types.ts";
import { AuthService } from "../auth/auth.service.ts";
import { PasswordService } from "../auth/password.service.ts";
import { SessionService } from "../auth/session.service.ts";

export class UsersService {
  readonly authService: AuthService;
  private readonly accountsRepository: AccountRepository;
  private readonly auditRepository: AuditRepository;
  private readonly passwordService: PasswordService;
  private readonly sessionService: SessionService;

  constructor(options: {
    authService: AuthService;
    accountsRepository: AccountRepository;
    auditRepository: AuditRepository;
    passwordService: PasswordService;
    sessionService: SessionService;
  }) {
    this.authService = options.authService;
    this.accountsRepository = options.accountsRepository;
    this.auditRepository = options.auditRepository;
    this.passwordService = options.passwordService;
    this.sessionService = options.sessionService;
  }

  async getCurrentUser(currentUserId: string): Promise<UserItemResponseData> {
    await this.ensureInitialized();
    const user = await this.accountsRepository.findUserById(currentUserId);

    if (!user) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }

    return this.toUserItem(user);
  }

  async updateCurrentUser(
    currentUserId: string,
    request: UpdateCurrentUserRequest,
  ): Promise<UserMutationResponseData> {
    await this.ensureInitialized();
    const existingUser = await this.accountsRepository.findUserById(currentUserId);

    if (!existingUser) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }

    const updatedUser = await this.accountsRepository.updateUser(currentUserId, {
      ...(request.email ? { email: request.email } : {}),
      ...(request.displayName ? { displayName: request.displayName } : {}),
    });

    await this.auditRepository.createAuditLog({
      actorUserId: existingUser.id,
      actorRole: existingUser.role,
      action: "user_profile_updated",
      targetType: "user",
      targetId: existingUser.id,
      payload: {
        changedFields: Object.keys(request),
      },
    });

    return {
      user: this.toUserItem(updatedUser),
    };
  }

  async updateCurrentUserPassword(
    currentUserId: string,
    request: UpdateCurrentUserPasswordRequest,
  ): Promise<UpdateCurrentUserPasswordResponseData> {
    await this.ensureInitialized();
    const user = await this.accountsRepository.findUserById(currentUserId);

    if (!user) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }

    const passwordValid = await this.passwordService.verifyPassword(
      request.currentPassword,
      user.passwordHash,
    );

    if (!passwordValid) {
      throw new Error("AUTH_INVALID_CREDENTIALS");
    }

    const nextPasswordHash = await this.passwordService.hashPassword(request.newPassword);
    await this.accountsRepository.updateUser(user.id, {
      passwordHash: nextPasswordHash,
    });
    const revokedSessionCount = await this.sessionService.revokeAllUserSessions(
      user.id,
      "password_changed",
    );

    await this.auditRepository.createAuditLog({
      actorUserId: user.id,
      actorRole: user.role,
      action: "user_password_updated",
      targetType: "user",
      targetId: user.id,
      payload: {
        revokedSessionCount,
      },
    });

    return {
      passwordUpdated: true,
      revokedSessionCount,
    };
  }

  async listUsers(actorUserId: string): Promise<UserListResponseData> {
    await this.ensureInitialized();
    const actor = await this.getRequiredActor(actorUserId);
    const users = await this.accountsRepository.listUsers();

    await this.auditRepository.createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: "admin_users_listed",
      targetType: "user",
      targetId: null,
    });

    return {
      items: users.map((item) => this.toUserItem(item)),
      total: users.length,
    };
  }

  async createUser(
    actorUserId: string,
    request: AdminCreateUserRequest,
  ): Promise<UserMutationResponseData> {
    await this.ensureInitialized();
    const actor = await this.getRequiredActor(actorUserId);
    const passwordHash = await this.passwordService.hashPassword(request.password);
    const createdUser = await this.accountsRepository.createUser({
      email: request.email,
      passwordHash,
      displayName: request.displayName,
      role: request.role ?? "member",
      status: request.status ?? "enabled",
    });

    await this.auditRepository.createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: "admin_user_created",
      targetType: "user",
      targetId: createdUser.id,
      payload: {
        email: createdUser.email,
        role: createdUser.role,
        status: createdUser.status,
      },
    });

    return {
      user: this.toUserItem(createdUser),
    };
  }

  async updateUserStatus(
    actorUserId: string,
    userId: string,
    request: UpdateUserStatusRequest,
  ): Promise<UserStatusMutationResponseData> {
    await this.ensureInitialized();
    const actor = await this.getRequiredActor(actorUserId);
    const user = await this.accountsRepository.findUserById(userId);

    if (!user) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }

    if (user.id === actor.id && request.status === "disabled") {
      throw new Error("ADMIN_SELF_DISABLE_FORBIDDEN");
    }

    const updatedUser = await this.accountsRepository.updateUser(userId, {
      status: request.status,
    });
    const revokedSessionCount = request.status === "disabled"
      ? await this.sessionService.revokeAllUserSessions(userId, "account_disabled")
      : 0;

    await this.auditRepository.createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: request.status === "disabled"
        ? "admin_user_disabled"
        : "admin_user_enabled",
      targetType: "user",
      targetId: updatedUser.id,
      payload: {
        revokedSessionCount,
      },
    });

    return {
      user: this.toUserItem(updatedUser),
      revokedSessionCount,
    };
  }

  async resetUserPassword(
    actorUserId: string,
    userId: string,
    request: AdminResetUserPasswordRequest,
  ): Promise<UserPasswordMutationResponseData> {
    await this.ensureInitialized();
    const actor = await this.getRequiredActor(actorUserId);
    const user = await this.accountsRepository.findUserById(userId);

    if (!user) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }

    const nextPasswordHash = await this.passwordService.hashPassword(request.newPassword);
    const updatedUser = await this.accountsRepository.updateUser(user.id, {
      passwordHash: nextPasswordHash,
    });
    const revokedSessionCount = request.revokeExistingSessions === false
      ? 0
      : await this.sessionService.revokeAllUserSessions(user.id, "password_reset");

    await this.auditRepository.createAuditLog({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: "admin_user_password_reset",
      targetType: "user",
      targetId: updatedUser.id,
      payload: {
        revokedSessionCount,
      },
    });

    return {
      user: this.toUserItem(updatedUser),
      revokedSessionCount,
    };
  }

  private async ensureInitialized(): Promise<void> {
    await this.accountsRepository.ensureInitialized();
    await this.auditRepository.ensureInitialized();
    await this.sessionService.ensureInitialized();
  }

  private async getRequiredActor(userId: string): Promise<AccountUserRecord> {
    const actor = await this.accountsRepository.findUserById(userId);

    if (!actor) {
      throw new Error("ACCOUNT_NOT_FOUND");
    }

    return actor;
  }

  private toUserItem(user: AccountUserRecord): UserItemResponseData {
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
}
