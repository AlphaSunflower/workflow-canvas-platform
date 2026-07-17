import type { AuthSuccessResponseData, AuthUserProfile } from '@/types';

const SESSION_CHANNEL_NAME = 'newworkflow.auth.session';
const SESSION_STORAGE_EVENT_KEY = 'newworkflow.auth.session-event';

export type SessionChannelEvent =
  | {
    type: 'refresh_started';
    sourceTabId: string;
    requestId: string;
    occurredAt: number;
  }
  | {
    type: 'refresh_succeeded';
    sourceTabId: string;
    requestId: string;
    occurredAt: number;
    payload: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      expiresAt: number;
      user: AuthUserProfile;
    };
  }
  | {
    type: 'logout';
    sourceTabId: string;
    requestId: string;
    occurredAt: number;
  };

export interface SessionChannelController {
  postEvent: (event: SessionChannelEvent) => void;
  subscribe: (listener: (event: SessionChannelEvent) => void) => () => void;
  close: () => void;
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function canUseBroadcastChannel(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

function isSessionChannelEvent(value: unknown): value is SessionChannelEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const event = value as Partial<SessionChannelEvent>;
  if (
    typeof event.type !== 'string'
    || typeof event.sourceTabId !== 'string'
    || typeof event.requestId !== 'string'
    || typeof event.occurredAt !== 'number'
  ) {
    return false;
  }

  if (event.type === 'refresh_succeeded') {
    const payload = event.payload;
    return typeof payload?.accessToken === 'string'
      && typeof payload?.refreshToken === 'string'
      && typeof payload?.expiresIn === 'number'
      && typeof payload?.expiresAt === 'number'
      && typeof payload?.user === 'object'
      && payload.user !== null;
  }

  return event.type === 'refresh_started' || event.type === 'logout';
}

function parseSessionChannelEvent(rawValue: string | null): SessionChannelEvent | null {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return isSessionChannelEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createRefreshSucceededEvent(
  payload: AuthSuccessResponseData,
  sourceTabId: string,
  requestId: string,
  occurredAt = Date.now(),
): SessionChannelEvent {
  const expiresAt = occurredAt + (payload.tokens.expiresIn * 1000);
  return {
    type: 'refresh_succeeded',
    sourceTabId,
    requestId,
    occurredAt,
    payload: {
      accessToken: payload.tokens.accessToken,
      refreshToken: payload.tokens.refreshToken,
      expiresIn: payload.tokens.expiresIn,
      expiresAt,
      user: payload.user,
    },
  };
}

export function createSessionChannel(): SessionChannelController {
  const listeners = new Set<(event: SessionChannelEvent) => void>();
  const broadcastChannel = canUseBroadcastChannel()
    ? new BroadcastChannel(SESSION_CHANNEL_NAME)
    : null;

  const emit = (event: SessionChannelEvent): void => {
    listeners.forEach((listener) => {
      listener(event);
    });
  };

  const handleBroadcastMessage = (event: MessageEvent<unknown>): void => {
    if (isSessionChannelEvent(event.data)) {
      emit(event.data);
    }
  };

  const handleStorageEvent = (event: StorageEvent): void => {
    if (event.key !== SESSION_STORAGE_EVENT_KEY) {
      return;
    }

    const parsed = parseSessionChannelEvent(event.newValue);
    if (parsed) {
      emit(parsed);
    }
  };

  if (broadcastChannel) {
    broadcastChannel.addEventListener('message', handleBroadcastMessage);
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', handleStorageEvent);
  }

  return {
    postEvent: (event): void => {
      if (broadcastChannel) {
        broadcastChannel.postMessage(event);
      }

      if (canUseStorage()) {
        const serialized = JSON.stringify(event);
        window.localStorage.setItem(SESSION_STORAGE_EVENT_KEY, serialized);
        window.localStorage.removeItem(SESSION_STORAGE_EVENT_KEY);
      }
    },
    subscribe: (listener): (() => void) => {
      listeners.add(listener);

      return (): void => {
        listeners.delete(listener);
      };
    },
    close: (): void => {
      listeners.clear();

      if (broadcastChannel) {
        broadcastChannel.removeEventListener('message', handleBroadcastMessage);
        broadcastChannel.close();
      }

      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('storage', handleStorageEvent);
      }
    },
  };
}
