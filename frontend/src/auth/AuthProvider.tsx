import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { authApi, applyAuthTokenBundle, httpClient, setAuthAccessToken, websocketClient } from '@/api';
import type {
  AppError,
  AuthSuccessResponseData,
  AuthUserProfile,
  LoginRequest,
  RegisterRequest,
  Result,
} from '@/types';
import { createError, createModuleLogger, generateUUID } from '@/utils';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';
import {
  clearStoredSession,
  getActiveRefreshLock,
  getStoredRefreshToken,
  releaseRefreshLock,
  setStoredRefreshToken,
  tryAcquireRefreshLock,
  type SessionRefreshLockRecord,
} from './session-storage';
import {
  analyzeRefreshFailure,
  annotateRefreshFailure,
  type RefreshFailureRecord,
} from './refresh-error-policy';
import {
  createRefreshSucceededEvent,
  createSessionChannel,
  type SessionChannelController,
  type SessionChannelEvent,
} from './session-channel';
import {
  computeAccessTokenExpiresAt,
  computeRefreshAt,
  computeRefreshDelayMs,
  shouldRefreshNow,
} from './session-expiry';
import { clearFileResourceSessionState } from '@/services/file-resource/file-resource-session';
const log = createModuleLogger('auth-provider');

interface AuthProviderProps {
  children: ReactNode;
}

type ProactiveRefreshTrigger = 'timer' | 'focus' | 'visibility' | 'pageshow';

const CROSS_TAB_REFRESH_LOCK_TTL_MS = 15_000;
const CROSS_TAB_REFRESH_WAIT_TIMEOUT_MS = 20_000;

function toVoidResult(result: Result<unknown>): Result<void> {
  if (!result.success) {
    return { success: false, error: result.error };
  }

  return { success: true, data: undefined };
}

export function AuthProvider({ children }: AuthProviderProps): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('restoring');
  const [user, setUser] = useState<AuthUserProfile | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const tabIdRef = useRef<string>(generateUUID());
  const userRef = useRef<AuthUserProfile | null>(null);
  const accessTokenExpiresAtRef = useRef<number | null>(null);
  const accessTokenRefreshAtRef = useRef<number | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const proactiveRefreshInFlightRef = useRef<Promise<Result<AuthUserProfile | null>> | null>(null);
  const proactiveRefreshCheckRef = useRef<((trigger: ProactiveRefreshTrigger) => void) | null>(null);
  const lastRefreshFailureRef = useRef<RefreshFailureRecord | null>(null);
  const restoreInFlightRef = useRef<Promise<Result<AuthUserProfile | null>> | null>(null);
  const sessionChannelRef = useRef<SessionChannelController | null>(null);
  const refreshBroadcastWaitersRef = useRef(
    new Map<string, {
      resolve: (event: SessionChannelEvent) => void;
      reject: (error: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }>(),
  );

  const resolveRefreshBroadcastWaiters = useCallback((event: SessionChannelEvent) => {
    refreshBroadcastWaitersRef.current.forEach((waiter, key) => {
      if (event.type !== 'logout' && event.requestId !== key) {
        return;
      }

      clearTimeout(waiter.timeoutId);
      waiter.resolve(event);
      refreshBroadcastWaitersRef.current.delete(key);
    });
  }, []);

  const rejectRefreshBroadcastWaiters = useCallback((message: string) => {
    refreshBroadcastWaitersRef.current.forEach((waiter, key) => {
      clearTimeout(waiter.timeoutId);
      waiter.reject(new Error(message));
      refreshBroadcastWaitersRef.current.delete(key);
    });
  }, []);

  const waitForRefreshBroadcast = useCallback((requestId: string): Promise<SessionChannelEvent> => {
    return new Promise<SessionChannelEvent>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        refreshBroadcastWaitersRef.current.delete(requestId);
        reject(new Error('Cross-tab refresh wait timed out'));
      }, CROSS_TAB_REFRESH_WAIT_TIMEOUT_MS);

      refreshBroadcastWaitersRef.current.set(requestId, {
        resolve,
        reject,
        timeoutId,
      });
    });
  }, []);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const scheduleProactiveRefresh = useCallback((refreshAt: number) => {
    clearRefreshTimer();

    if (!Number.isFinite(refreshAt)) {
      return;
    }

    const delayMs = computeRefreshDelayMs(refreshAt);
    refreshTimerRef.current = setTimeout(() => {
      proactiveRefreshCheckRef.current?.('timer');
    }, delayMs);
  }, [clearRefreshTimer]);

  const clearAccessTokenIfExpired = useCallback(() => {
    const expiresAt = accessTokenExpiresAtRef.current;

    if (expiresAt === null || expiresAt <= Date.now()) {
      accessTokenExpiresAtRef.current = null;
      setAuthAccessToken(null);
    }
  }, []);

  const applyAuthenticatedState = useCallback((payload: AuthSuccessResponseData): AuthUserProfile => {
    const accessTokenExpiresAt = computeAccessTokenExpiresAt(payload.tokens.expiresIn);
    const accessTokenRefreshAt = computeRefreshAt(accessTokenExpiresAt, payload.tokens.expiresIn);
    accessTokenExpiresAtRef.current = accessTokenExpiresAt;
    accessTokenRefreshAtRef.current = accessTokenRefreshAt;
    applyAuthTokenBundle(payload.tokens);
    setStoredRefreshToken(payload.tokens.refreshToken);
    scheduleProactiveRefresh(accessTokenRefreshAt);
    userRef.current = payload.user;
    setUser(payload.user);
    setError(null);
    lastRefreshFailureRef.current = null;
    setStatus('authenticated');
    return payload.user;
  }, [scheduleProactiveRefresh]);

  const clearSessionState = useCallback(() => {
    clearRefreshTimer();
    accessTokenExpiresAtRef.current = null;
    accessTokenRefreshAtRef.current = null;
    proactiveRefreshInFlightRef.current = null;
    rejectRefreshBroadcastWaiters('Session cleared');
    websocketClient.disconnect();
    clearStoredSession();
    setAuthAccessToken(null);
    clearFileResourceSessionState();
    userRef.current = null;
    setUser(null);
    setStatus('unauthenticated');
  }, [clearRefreshTimer, rejectRefreshBroadcastWaiters]);

  const handleRefreshFailure = useCallback(async (nextError: AppError) => {
    const analysis = analyzeRefreshFailure(nextError);
    const annotatedError = annotateRefreshFailure(nextError, analysis);
    lastRefreshFailureRef.current = analysis;

    log.warn('handleRefreshFailure', 'Authentication refresh failed', {
      code: analysis.errorCode,
      disposition: analysis.disposition,
      statusCode: analysis.statusCode,
    });

    if (analysis.disposition === 'soft') {
      clearAccessTokenIfExpired();
      setError(annotatedError);
      setStatus((previousStatus) => {
        const currentUser = userRef.current;
        if (previousStatus === 'unauthenticated' || previousStatus === 'restoring') {
          return currentUser ? 'authenticated' : previousStatus;
        }

        return currentUser ? 'authenticated' : 'unauthenticated';
      });
      return;
    }

    clearSessionState();
    setError(annotatedError);
  }, [clearAccessTokenIfExpired, clearSessionState]);

  const applyCrossTabRefreshSuccess = useCallback((event: Extract<SessionChannelEvent, { type: 'refresh_succeeded' }>) => {
    const accessTokenExpiresAt = event.payload.expiresAt;
    const accessTokenRefreshAt = computeRefreshAt(accessTokenExpiresAt, event.payload.expiresIn);

    accessTokenExpiresAtRef.current = accessTokenExpiresAt;
    accessTokenRefreshAtRef.current = accessTokenRefreshAt;
    setAuthAccessToken(event.payload.accessToken);
    setStoredRefreshToken(event.payload.refreshToken);
    scheduleProactiveRefresh(accessTokenRefreshAt);
    userRef.current = event.payload.user;
    setUser(event.payload.user);
    setError(null);
    lastRefreshFailureRef.current = null;
    setStatus('authenticated');
  }, [scheduleProactiveRefresh]);

  const broadcastSessionEvent = useCallback((event: SessionChannelEvent) => {
    sessionChannelRef.current?.postEvent(event);
  }, []);

  const buildRefreshLockRecord = useCallback((requestId: string, occurredAt = Date.now()): SessionRefreshLockRecord => ({
    ownerTabId: tabIdRef.current,
    requestId,
    acquiredAt: occurredAt,
    expiresAt: occurredAt + CROSS_TAB_REFRESH_LOCK_TTL_MS,
  }), []);

  const refreshWithOwnedLock = useCallback(async (
    refreshToken: string,
    nextStatus: Extract<AuthStatus, 'restoring' | 'refreshing'>,
    requestId: string,
  ): Promise<Result<AuthUserProfile | null>> => {
    setStatus(nextStatus);
    setError(null);
    broadcastSessionEvent({
      type: 'refresh_started',
      sourceTabId: tabIdRef.current,
      requestId,
      occurredAt: Date.now(),
    });

    const refreshResult = await authApi.refresh({ refreshToken });

    if (!refreshResult.success) {
      releaseRefreshLock(tabIdRef.current, requestId);
      const analysis = analyzeRefreshFailure(refreshResult.error);
      const annotatedError = annotateRefreshFailure(refreshResult.error, analysis);
      lastRefreshFailureRef.current = analysis;

      log.warn('refreshWithOwnedLock', 'Session refresh failed', {
        code: analysis.errorCode,
        disposition: analysis.disposition,
        statusCode: analysis.statusCode,
      });

      if (analysis.disposition === 'hard') {
        clearSessionState();
        broadcastSessionEvent({
          type: 'logout',
          sourceTabId: tabIdRef.current,
          requestId,
          occurredAt: Date.now(),
        });
      } else {
        clearAccessTokenIfExpired();
        setStatus((previousStatus) => {
          const currentUser = userRef.current;
          if (previousStatus === 'restoring') {
            return currentUser ? 'authenticated' : 'unauthenticated';
          }

          return currentUser ? 'authenticated' : previousStatus;
        });
      }

      setError(annotatedError);
      return { success: false, error: annotatedError };
    }

    if (getStoredRefreshToken() !== refreshToken) {
      releaseRefreshLock(tabIdRef.current, requestId);
      return { success: true, data: userRef.current };
    }

    const userProfile = applyAuthenticatedState(refreshResult.data);
    broadcastSessionEvent(
      createRefreshSucceededEvent(
        refreshResult.data,
        tabIdRef.current,
        requestId,
      ),
    );
    releaseRefreshLock(tabIdRef.current, requestId);

    return {
      success: true,
      data: userProfile,
    };
  }, [
    applyAuthenticatedState,
    broadcastSessionEvent,
    clearAccessTokenIfExpired,
    clearSessionState,
  ]);

  const waitForCrossTabRefreshResult = useCallback(async (
    nextStatus: Extract<AuthStatus, 'restoring' | 'refreshing'>,
    activeLock: SessionRefreshLockRecord,
  ): Promise<Result<AuthUserProfile | null>> => {
    setStatus(nextStatus);
    setError(null);

    try {
      const event = await waitForRefreshBroadcast(activeLock.requestId);

      if (event.type === 'logout') {
        clearSessionState();
        return { success: true, data: null };
      }

      if (event.type === 'refresh_succeeded') {
        applyCrossTabRefreshSuccess(event);
        return { success: true, data: event.payload.user };
      }

      return {
        success: false,
        error: createError('UNKNOWN_ERROR', 'Unexpected cross-tab refresh event', {
          module: 'auth-provider',
          operation: 'waitForCrossTabRefreshResult',
          timestamp: Date.now(),
        }),
      };
    } catch (waitError) {
      const message = waitError instanceof Error ? waitError.message : 'Timed out waiting for refresh';
      const error = createError('TIMEOUT_ERROR', message, {
        module: 'auth-provider',
        operation: 'waitForCrossTabRefreshResult',
        timestamp: Date.now(),
      });

      setError(error);
      setStatus(userRef.current ? 'authenticated' : 'unauthenticated');
      return { success: false, error };
    }
  }, [applyCrossTabRefreshSuccess, clearSessionState, waitForRefreshBroadcast]);

  const restoreWithRefreshToken = useCallback(
    async (
      nextStatus: Extract<AuthStatus, 'restoring' | 'refreshing'>,
    ): Promise<Result<AuthUserProfile | null>> => {
      const refreshToken = getStoredRefreshToken();

      if (!refreshToken) {
        clearSessionState();
        setError(null);
        return { success: true, data: null };
      }

      const requestId = generateUUID();
      const lockRecord = buildRefreshLockRecord(requestId);

      if (tryAcquireRefreshLock(lockRecord)) {
        return refreshWithOwnedLock(refreshToken, nextStatus, requestId);
      }

      const activeLock = getActiveRefreshLock();
      if (activeLock) {
        return waitForCrossTabRefreshResult(nextStatus, activeLock);
      }

      const latestRefreshToken = getStoredRefreshToken();
      if (!latestRefreshToken) {
        clearSessionState();
        setError(null);
        return { success: true, data: null };
      }

      if (latestRefreshToken !== refreshToken) {
        return { success: true, data: userRef.current };
      }

      if (tryAcquireRefreshLock(lockRecord)) {
        return refreshWithOwnedLock(latestRefreshToken, nextStatus, requestId);
      }

      const retriedLock = getActiveRefreshLock();
      if (retriedLock) {
        return waitForCrossTabRefreshResult(nextStatus, retriedLock);
      }

      return refreshWithOwnedLock(latestRefreshToken, nextStatus, requestId);
    },
    [buildRefreshLockRecord, clearSessionState, refreshWithOwnedLock, waitForCrossTabRefreshResult]
  );

  const restoreSession = useCallback(async (): Promise<Result<AuthUserProfile | null>> => {
    if (!restoreInFlightRef.current) {
      restoreInFlightRef.current = restoreWithRefreshToken('restoring').finally(() => {
        restoreInFlightRef.current = null;
      });
    }

    return restoreInFlightRef.current;
  }, [restoreWithRefreshToken]);

  const refreshSession = useCallback(async (): Promise<Result<AuthUserProfile | null>> => {
    if (!proactiveRefreshInFlightRef.current) {
      proactiveRefreshInFlightRef.current = restoreWithRefreshToken('refreshing').finally(() => {
        proactiveRefreshInFlightRef.current = null;
      });
    }

    return proactiveRefreshInFlightRef.current;
  }, [restoreWithRefreshToken]);

  const runProactiveRefreshCheck = useCallback((trigger: ProactiveRefreshTrigger): void => {
    const refreshToken = getStoredRefreshToken();
    const refreshAt = accessTokenRefreshAtRef.current;

    if (!refreshToken || refreshAt === null) {
      clearRefreshTimer();
      return;
    }

    if (!shouldRefreshNow(refreshAt)) {
      scheduleProactiveRefresh(refreshAt);
      return;
    }

    clearRefreshTimer();
    log.debug('runProactiveRefreshCheck', 'Refreshing access token proactively', {
      trigger,
      refreshAt,
    });

    const refreshPromise = refreshSession().finally(() => {
      const nextRefreshAt = accessTokenRefreshAtRef.current;
      if (
        nextRefreshAt !== null
        && getStoredRefreshToken()
        && !shouldRefreshNow(nextRefreshAt)
      ) {
        scheduleProactiveRefresh(nextRefreshAt);
      }
    });

    void refreshPromise;
  }, [clearRefreshTimer, refreshSession, scheduleProactiveRefresh]);

  proactiveRefreshCheckRef.current = runProactiveRefreshCheck;

  const login = useCallback(async (
    request: LoginRequest
  ): Promise<Result<AuthSuccessResponseData>> => {
    setStatus('refreshing');
    setError(null);
    const result = await authApi.login(request);

    if (!result.success) {
      setError(result.error);
      setStatus(userRef.current ? 'authenticated' : 'unauthenticated');
      return result;
    }

    applyAuthenticatedState(result.data);
    return result;
  }, [applyAuthenticatedState]);

  const register = useCallback(async (
    request: RegisterRequest
  ): Promise<Result<AuthSuccessResponseData>> => {
    setStatus('refreshing');
    setError(null);
    const result = await authApi.register(request);

    if (!result.success) {
      setError(result.error);
      setStatus(userRef.current ? 'authenticated' : 'unauthenticated');
      return result;
    }

    applyAuthenticatedState(result.data);
    return result;
  }, [applyAuthenticatedState]);

  const logout = useCallback(async (): Promise<Result<void>> => {
    const refreshToken = getStoredRefreshToken();
    const requestId = generateUUID();

    setStatus('refreshing');
    setError(null);

    if (!refreshToken) {
      clearSessionState();
      broadcastSessionEvent({
        type: 'logout',
        sourceTabId: tabIdRef.current,
        requestId,
        occurredAt: Date.now(),
      });
      return { success: true, data: undefined };
    }

    const result = await authApi.logout({ refreshToken });
    clearSessionState();
    releaseRefreshLock(tabIdRef.current);
    broadcastSessionEvent({
      type: 'logout',
      sourceTabId: tabIdRef.current,
      requestId,
      occurredAt: Date.now(),
    });

    if (!result.success) {
      return toVoidResult(result);
    }

    return { success: true, data: undefined };
  }, [broadcastSessionEvent, clearSessionState]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    const sessionChannel = createSessionChannel();
    sessionChannelRef.current = sessionChannel;

    const unsubscribe = sessionChannel.subscribe((event) => {
      if (event.sourceTabId === tabIdRef.current) {
        return;
      }

      if (event.type === 'refresh_succeeded') {
        applyCrossTabRefreshSuccess(event);
        resolveRefreshBroadcastWaiters(event);
        return;
      }

      if (event.type === 'logout') {
        releaseRefreshLock(tabIdRef.current);
        resolveRefreshBroadcastWaiters(event);
        clearSessionState();
      }
    });

    return () => {
      unsubscribe();
      sessionChannel.close();
      sessionChannelRef.current = null;
    };
  }, [applyCrossTabRefreshSuccess, clearSessionState, resolveRefreshBroadcastWaiters]);

  useEffect(() => {
    httpClient.setAuthLifecycleHandlers({
      refreshAuth: async () => {
        const result = await refreshSession();
        if (!result.success) {
          return result;
        }

        const accessToken = httpClient.getAuthToken();
        if (!accessToken) {
          return {
            success: false,
            error: createError('AUTH_ERROR', 'Access token missing after refresh', {
              module: 'auth-provider',
              operation: 'refreshAuth',
              timestamp: Date.now(),
            }),
          };
        }

        return {
          success: true,
          data: {
            accessToken,
          },
        };
      },
      onAuthRefreshFailure: handleRefreshFailure,
    });

    return () => {
      httpClient.setAuthLifecycleHandlers(null);
    };
  }, [handleRefreshFailure, refreshSession]);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    const handleFocus = (): void => {
      runProactiveRefreshCheck('focus');
    };
    const handlePageShow = (): void => {
      runProactiveRefreshCheck('pageshow');
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      runProactiveRefreshCheck('visibility');
    };

    if (typeof window.addEventListener === 'function') {
      window.addEventListener('focus', handleFocus);
      window.addEventListener('pageshow', handlePageShow);
    }

    if (typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('pageshow', handlePageShow);
      }

      if (typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [runProactiveRefreshCheck]);

  useEffect(() => {
    return () => {
      clearRefreshTimer();
      proactiveRefreshCheckRef.current = null;
      proactiveRefreshInFlightRef.current = null;
      rejectRefreshBroadcastWaiters('Auth provider unmounted');
    };
  }, [clearRefreshTimer, rejectRefreshBroadcastWaiters]);

  useEffect(() => {
    websocketClient.setAuthTokenProvider(() => httpClient.getAuthToken());

    return () => {
      websocketClient.setAuthTokenProvider(null);
      websocketClient.disconnect();
    };
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      void websocketClient.connect();
      return;
    }

    if (status === 'unauthenticated') {
      websocketClient.disconnect();
    }
  }, [status]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    isAuthenticated: status === 'authenticated',
    isBusy: status === 'restoring' || status === 'refreshing',
    user,
    error,
    login,
    register,
    logout,
    clearSession: clearSessionState,
    restoreSession,
    refreshSession,
    clearError,
  }), [
    clearSessionState,
    clearError,
    error,
    login,
    logout,
    refreshSession,
    register,
    restoreSession,
    status,
    user,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
