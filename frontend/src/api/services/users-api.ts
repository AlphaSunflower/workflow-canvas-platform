import type {
  AdminCreateUserRequest,
  AdminResetUserPasswordRequest,
  AuthUserProfile,
  Result,
  UpdateCurrentUserPasswordRequest,
  UpdateCurrentUserPasswordResponseData,
  UpdateCurrentUserRequest,
  UpdateUserStatusRequest,
  UserApi,
  UserListResponseData,
  UserMutationResponseData,
  UserPasswordMutationResponseData,
  UserStatusMutationResponseData,
} from '../../types';
import { createModuleLogger } from '../../utils';
import { httpClient } from '../client/http-client';

const log = createModuleLogger('users-api');

export async function getCurrentUser(): Promise<Result<AuthUserProfile>> {
  log.debug('getCurrentUser', 'Getting current user profile');
  return httpClient.get<AuthUserProfile>('/api/v1/users/me');
}

export async function updateCurrentUser(
  request: UpdateCurrentUserRequest
): Promise<Result<UserMutationResponseData>> {
  log.info('updateCurrentUser', 'Updating current user profile');
  return httpClient.put<UserMutationResponseData>('/api/v1/users/me', request);
}

export async function updateCurrentUserPassword(
  request: UpdateCurrentUserPasswordRequest
): Promise<Result<UpdateCurrentUserPasswordResponseData>> {
  log.info('updateCurrentUserPassword', 'Updating current user password');
  return httpClient.put<UpdateCurrentUserPasswordResponseData>('/api/v1/users/me/password', request);
}

export async function listUsers(): Promise<Result<UserListResponseData>> {
  log.debug('listUsers', 'Listing admin-managed users');
  return httpClient.get<UserListResponseData>('/api/v1/admin/users');
}

export async function createUser(
  request: AdminCreateUserRequest
): Promise<Result<UserMutationResponseData>> {
  log.info('createUser', `Creating managed user: ${request.email}`);
  return httpClient.post<UserMutationResponseData>('/api/v1/admin/users', request);
}

export async function updateUserStatus(
  userId: string,
  request: UpdateUserStatusRequest
): Promise<Result<UserStatusMutationResponseData>> {
  log.info('updateUserStatus', `Updating managed user status: ${userId} -> ${request.status}`);
  return httpClient.put<UserStatusMutationResponseData>(`/api/v1/admin/users/${userId}/status`, request);
}

export async function resetUserPassword(
  userId: string,
  request: AdminResetUserPasswordRequest
): Promise<Result<UserPasswordMutationResponseData>> {
  log.info('resetUserPassword', `Resetting managed user password: ${userId}`);
  return httpClient.put<UserPasswordMutationResponseData>(`/api/v1/admin/users/${userId}/password`, request);
}

export const usersApi: UserApi = {
  getCurrent: getCurrentUser,
  updateCurrent: updateCurrentUser,
  updateCurrentPassword: updateCurrentUserPassword,
  list: listUsers,
  create: createUser,
  updateStatus: updateUserStatus,
  resetPassword: resetUserPassword,
};
