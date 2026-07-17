import type {
  AccountRole,
  AccountStatus,
} from "../auth.ts";
import type { AuthUserProfile } from "./auth.ts";

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

export interface UserItemResponseData extends AuthUserProfile {}

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
