import type {
  AuthApi,
  AuthSuccessResponseData,
  AuthTokenBundle,
  AuthUserProfile,
  LoginRequest,
  LogoutRequest,
  LogoutResponseData,
  RefreshRequest,
  RegisterRequest,
  Result,
} from '../../types';
import { createModuleLogger } from '../../utils';
import { httpClient } from '../client/http-client';

const log = createModuleLogger('auth-api');

export function setAuthAccessToken(accessToken: string | null): void {
  httpClient.setAuthToken(accessToken);
}

export function applyAuthTokenBundle(tokens: Pick<AuthTokenBundle, 'accessToken'> | null | undefined): void {
  httpClient.setAuthToken(tokens?.accessToken ?? null);
}

export async function register(
  request: RegisterRequest
): Promise<Result<AuthSuccessResponseData>> {
  log.info('register', `Registering account: ${request.email}`);

  const result = await httpClient.post<AuthSuccessResponseData>('/api/v1/auth/register', request);
  if (result.success) {
    applyAuthTokenBundle(result.data.tokens);
  }

  return result;
}

export async function login(
  request: LoginRequest
): Promise<Result<AuthSuccessResponseData>> {
  log.info('login', `Logging in account: ${request.email}`);

  const result = await httpClient.post<AuthSuccessResponseData>('/api/v1/auth/login', request);
  if (result.success) {
    applyAuthTokenBundle(result.data.tokens);
  }

  return result;
}

export async function refresh(
  request: RefreshRequest
): Promise<Result<AuthSuccessResponseData>> {
  log.info('refresh', 'Refreshing account session');

  return httpClient.post<AuthSuccessResponseData>('/api/v1/auth/refresh', request, {
    skipAuthRefresh: true,
  });
}

export async function logout(
  request: LogoutRequest
): Promise<Result<LogoutResponseData>> {
  log.info('logout', 'Logging out account session');

  const result = await httpClient.post<LogoutResponseData>('/api/v1/auth/logout', request);
  if (result.success) {
    setAuthAccessToken(null);
  }

  return result;
}

export async function me(): Promise<Result<AuthUserProfile>> {
  log.debug('me', 'Getting current authenticated user');
  return httpClient.get<AuthUserProfile>('/api/v1/auth/me');
}

export const authApi: AuthApi = {
  register,
  login,
  refresh,
  logout,
  me,
};
