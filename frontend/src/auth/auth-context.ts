import { createContext } from 'react';
import type {
  AppError,
  AuthSuccessResponseData,
  AuthUserProfile,
  LoginRequest,
  RegisterRequest,
  Result,
} from '@/types';

export type AuthStatus =
  | 'unauthenticated'
  | 'restoring'
  | 'authenticated'
  | 'refreshing';

export interface AuthContextValue {
  status: AuthStatus;
  isAuthenticated: boolean;
  isBusy: boolean;
  user: AuthUserProfile | null;
  error: AppError | null;
  login: (request: LoginRequest) => Promise<Result<AuthSuccessResponseData>>;
  register: (request: RegisterRequest) => Promise<Result<AuthSuccessResponseData>>;
  logout: () => Promise<Result<void>>;
  clearSession: () => void;
  restoreSession: () => Promise<Result<AuthUserProfile | null>>;
  refreshSession: () => Promise<Result<AuthUserProfile | null>>;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
