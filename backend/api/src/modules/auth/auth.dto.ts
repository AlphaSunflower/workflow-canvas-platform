import type {
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
  RegisterRequest,
} from "@newworkflow/backend-shared/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MIN_PASSWORD_LENGTH = 8;

function assertBody(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("INVALID_BODY");
  }

  return input as Record<string, unknown>;
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

  if (!normalized) {
    throw new Error("INVALID_DISPLAY_NAME");
  }

  if (normalized.length > 80) {
    throw new Error("INVALID_DISPLAY_NAME");
  }

  return normalized;
}

function assertPassword(password: string): string {
  if (!password.trim() || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error("INVALID_PASSWORD");
  }

  return password;
}

function assertToken(value: string, error: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(error);
  }

  return normalized;
}

export function validateRegisterRequest(input: unknown): RegisterRequest {
  const body = assertBody(input);

  return {
    email: normalizeEmail(readRequiredString(body, "email", "INVALID_EMAIL")),
    password: assertPassword(readRequiredString(body, "password", "INVALID_PASSWORD")),
    displayName: normalizeDisplayName(
      readRequiredString(body, "displayName", "INVALID_DISPLAY_NAME"),
    ),
  };
}

export function validateLoginRequest(input: unknown): LoginRequest {
  const body = assertBody(input);

  return {
    email: normalizeEmail(readRequiredString(body, "email", "INVALID_EMAIL")),
    password: assertPassword(readRequiredString(body, "password", "INVALID_PASSWORD")),
  };
}

export function validateRefreshRequest(input: unknown): RefreshRequest {
  const body = assertBody(input);

  return {
    refreshToken: assertToken(
      readRequiredString(body, "refreshToken", "INVALID_REFRESH_TOKEN"),
      "INVALID_REFRESH_TOKEN",
    ),
  };
}

export function validateLogoutRequest(input: unknown): LogoutRequest {
  const body = assertBody(input);

  return {
    refreshToken: assertToken(
      readRequiredString(body, "refreshToken", "INVALID_REFRESH_TOKEN"),
      "INVALID_REFRESH_TOKEN",
    ),
  };
}
