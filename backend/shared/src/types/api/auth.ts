import type {
  AccountRole,
  AccountStatus,
} from "../auth.ts";

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface LogoutRequest {
  refreshToken: string;
}

export interface AuthUserProfile {
  userId: string;
  email: string;
  displayName: string;
  role: AccountRole;
  status: AccountStatus;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokenBundle {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

export interface AuthSuccessResponseData {
  tokens: AuthTokenBundle;
  user: AuthUserProfile;
}
