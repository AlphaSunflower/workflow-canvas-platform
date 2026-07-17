import test from 'node:test';
import assert from 'node:assert/strict';

import { createRefreshSucceededEvent, createSessionChannel, type SessionChannelEvent } from './session-channel';
import type { AuthSuccessResponseData } from '@/types';

function createAuthSuccessResponse(): AuthSuccessResponseData {
  return {
    tokens: {
      accessToken: 'access-token-cross-tab',
      refreshToken: 'refresh-token-cross-tab',
      tokenType: 'Bearer',
      expiresIn: 3600,
    },
    user: {
      userId: 'user-cross-tab',
      email: 'cross-tab@example.com',
      displayName: 'Cross Tab User',
      role: 'admin',
      status: 'enabled',
      lastLoginAt: null,
      createdAt: '2026-04-09T00:00:00.000Z',
      updatedAt: '2026-04-09T00:00:00.000Z',
    },
  };
}

function installStorageEventWindow(): {
  dispatchStorageEvent: (event: { key: string | null; newValue: string | null }) => void;
  cleanup: () => void;
} {
  const windowListeners = new Map<string, Set<(event: { key: string | null; newValue: string | null }) => void>>();
  const localStorageMap = new Map<string, string>();
  const previousWindow = globalThis.window;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: (type: string, handler: (event: { key: string | null; newValue: string | null }) => void) => {
        if (!windowListeners.has(type)) {
          windowListeners.set(type, new Set());
        }
        windowListeners.get(type)?.add(handler);
      },
      removeEventListener: (type: string, handler: (event: { key: string | null; newValue: string | null }) => void) => {
        windowListeners.get(type)?.delete(handler);
      },
      localStorage: {
        getItem: (key: string) => localStorageMap.get(key) ?? null,
        setItem: (key: string, value: string) => {
          localStorageMap.set(key, value);
        },
        removeItem: (key: string) => {
          localStorageMap.delete(key);
        },
      },
    },
  });

  return {
    dispatchStorageEvent: (event) => {
      windowListeners.get('storage')?.forEach((listener) => {
        listener(event);
      });
    },
    cleanup: () => {
      if (previousWindow === undefined) {
        // @ts-expect-error restore optional global
        delete globalThis.window;
        return;
      }

      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      });
    },
  };
}

test('session-channel receives storage fallback events', () => {
  const env = installStorageEventWindow();
  const sessionChannel = createSessionChannel();
  const receivedEvents: SessionChannelEvent[] = [];

  try {
    const unsubscribe = sessionChannel.subscribe((event) => {
      receivedEvents.push(event);
    });

    const refreshSucceededEvent = createRefreshSucceededEvent(
      createAuthSuccessResponse(),
      'tab-a',
      'request-a',
      50_000,
    );

    env.dispatchStorageEvent({
      key: 'newworkflow.auth.session-event',
      newValue: JSON.stringify(refreshSucceededEvent),
    });

    assert.equal(receivedEvents.length, 1);
    assert.deepEqual(receivedEvents[0], refreshSucceededEvent);

    unsubscribe();
  } finally {
    sessionChannel.close();
    env.cleanup();
  }
});
