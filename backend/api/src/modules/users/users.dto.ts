import type {
  AdminCreateUserRequest,
  AdminResetUserPasswordRequest,
  UpdateCurrentUserPasswordRequest,
  UpdateCurrentUserRequest,
  UpdateUserStatusRequest,
} from "@newworkflow/backend-shared/api";
import type {
  AccountRole,
  AccountStatus,
} from "@newworkflow/backend-shared/auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MIN_PASSWORD_LENGTH = 8;

function assertBody(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("INVALID_BODY");
  }

  return input as Record<string, unknown>;
}

function readOptionalString(
  input: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = input[field];
  return typeof value === "string" ? value : undefined;
}

function readRequiredString(
  input: Record<string, unknown>,
  field: string,
  error: string,
): string {
  const value = input[field];

  if (typeof value !== "string") {
    throw new Error(error);
  }

  return value;
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();

  if (!EMAIL_PATTERN.test(normalized)) {
    throw new Error("INVALID_EMAIL");
  }

  return normalized;
}

function normalizeDisplayName(displayName: string): string {
  const normalized = displayName.trim();

  if (!normalized || normalized.length > 80) {
    throw new Error("INVALID_DISPLAY_NAME");
  }

  return normalized;
}

function normalizePassword(password: string, error = "INVALID_PASSWORD"): string {
  if (!password.trim() || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(error);
  }

  return password;
}

function normalizeRole(role: unknown): AccountRole {
  if (role === undefined) {
    return "member";
  }

  if (role !== "member" && role !== "admin") {
    throw new Error("INVALID_ROLE");
  }

  return role;
}

function normalizeStatus(status: unknown): AccountStatus {
  if (status === undefined) {
    return "enabled";
  }

  if (status !== "enabled" && status !== "disabled") {
    throw new Error("INVALID_STATUS");
  }

  return status;
}

function normalizeUserId(userId: string): string {
  const normalized = userId.trim();

  if (!normalized) {
    throw new Error("INVALID_USER_ID");
  }

  return normalized;
}

export function validateUpdateCurrentUserRequest(input: unknown): UpdateCurrentUserRequest {
  const body = assertBody(input);
  const email = readOptionalString(body, "email");
  const displayName = readOptionalString(body, "displayName");

  if (email === undefined && displayName === undefined) {
    throw new Error("INVALID_BODY");
  }

  return {
    ...(email !== undefined ? { email: normalizeEmail(email) } : {}),
    ...(displayName !== undefined ? { displayName: normalizeDisplayName(displayName) } : {}),
  };
}

export function validateUpdateCurrentUserPasswordRequest(
  input: unknown,
): UpdateCurrentUserPasswordRequest {
  const body = assertBody(input);

  return {
    currentPassword: normalizePassword(
      readRequiredString(body, "currentPassword", "INVALID_CURRENT_PASSWORD"),
      "INVALID_CURRENT_PASSWORD",
    ),
    newPassword: normalizePassword(
      readRequiredString(body, "newPassword", "INVALID_NEW_PASSWORD"),
      "INVALID_NEW_PASSWORD",
    ),
  };
}

export function validateAdminCreateUserRequest(input: unknown): AdminCreateUserRequest {
  const body = assertBody(input);

  return {
    email: normalizeEmail(readRequiredString(body, "email", "INVALID_EMAIL")),
    password: normalizePassword(readRequiredString(body, "password", "INVALID_PASSWORD")),
    displayName: normalizeDisplayName(
      readRequiredString(body, "displayName", "INVALID_DISPLAY_NAME"),
    ),
    role: normalizeRole(body.role),
    status: normalizeStatus(body.status),
  };
}

export function validateUpdateUserStatusRequest(input: unknown): UpdateUserStatusRequest {
  const body = assertBody(input);

  return {
    status: normalizeStatus(body.status),
  };
}

export function validateAdminResetUserPasswordRequest(
  input: unknown,
): AdminResetUserPasswordRequest {
  const body = assertBody(input);
  const revokeExistingSessions = body.revokeExistingSessions;

  if (
    revokeExistingSessions !== undefined
    && typeof revokeExistingSessions !== "boolean"
  ) {
    throw new Error("INVALID_REVOKE_EXISTING_SESSIONS");
  }

  return {
    newPassword: normalizePassword(
      readRequiredString(body, "newPassword", "INVALID_NEW_PASSWORD"),
      "INVALID_NEW_PASSWORD",
    ),
    revokeExistingSessions: revokeExistingSessions ?? true,
  };
}

export function validateUserIdParam(userId: string): string {
  return normalizeUserId(userId);
}
