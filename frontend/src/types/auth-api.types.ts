import type {
  AccountRole,
  AccountStatus,
  Result,
} from './base.types';

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

export interface AuthTokenBundle {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
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

export interface AuthSuccessResponseData {
  tokens: AuthTokenBundle;
  user: AuthUserProfile;
}

export interface LogoutResponseData {
  loggedOut: true;
}

export interface UpdateCurrentUserRequest {
  email?: string;
  displayName?: string;
}

export interface UpdateCurrentUserPasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface UpdateCurrentUserPasswordResponseData {
  passwordUpdated: true;
  revokedSessionCount: number;
}

export interface AdminCreateUserRequest {
  email: string;
  password: string;
  displayName: string;
  role?: AccountRole;
  status?: AccountStatus;
}

export interface UpdateUserStatusRequest {
  status: AccountStatus;
}

export interface AdminResetUserPasswordRequest {
  newPassword: string;
  revokeExistingSessions?: boolean;
}

export type UserItemResponseData = AuthUserProfile;

export interface UserListResponseData {
  items: UserItemResponseData[];
  total: number;
}

export interface UserMutationResponseData {
  user: UserItemResponseData;
}

export interface UserStatusMutationResponseData {
  user: UserItemResponseData;
  revokedSessionCount: number;
}

export interface UserPasswordMutationResponseData {
  user: UserItemResponseData;
  revokedSessionCount: number;
}

export interface AuthApi {
  register: (req: RegisterRequest) => Promise<Result<AuthSuccessResponseData>>;
  login: (req: LoginRequest) => Promise<Result<AuthSuccessResponseData>>;
  refresh: (req: RefreshRequest) => Promise<Result<AuthSuccessResponseData>>;
  logout: (req: LogoutRequest) => Promise<Result<LogoutResponseData>>;
  me: () => Promise<Result<AuthUserProfile>>;
}

export interface UserApi {
  getCurrent: () => Promise<Result<AuthUserProfile>>;
  updateCurrent: (req: UpdateCurrentUserRequest) => Promise<Result<UserMutationResponseData>>;
  updateCurrentPassword: (
    req: UpdateCurrentUserPasswordRequest
  ) => Promise<Result<UpdateCurrentUserPasswordResponseData>>;
  list: () => Promise<Result<UserListResponseData>>;
  create: (req: AdminCreateUserRequest) => Promise<Result<UserMutationResponseData>>;
  updateStatus: (
    userId: string,
    req: UpdateUserStatusRequest
  ) => Promise<Result<UserStatusMutationResponseData>>;
  resetPassword: (
    userId: string,
    req: AdminResetUserPasswordRequest
  ) => Promise<Result<UserPasswordMutationResponseData>>;
}
