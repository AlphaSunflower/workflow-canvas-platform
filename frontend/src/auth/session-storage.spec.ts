import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearStoredSession,
  getActiveRefreshLock,
  getStoredRefreshToken,
  releaseRefreshLock,
  setStoredRefreshToken,
  tryAcquireRefreshLock,
  type SessionRefreshLockRecord,
} from './session-storage';

function installStorageWindow(): () => void {
  const localStorageMap = new Map<string, string>();
  const previousWindow = globalThis.window;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
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

  return () => {
    if (previousWindow === undefined) {
      // @ts-expect-error restore optional global
      delete globalThis.window;
      return;
    }

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  };
}

function createLock(ownerTabId: string, requestId: string, acquiredAt = 10_000): SessionRefreshLockRecord {
  return {
    ownerTabId,
    requestId,
    acquiredAt,
    expiresAt: acquiredAt + 15_000,
  };
}

test('session-storage stores refresh token in localStorage', () => {
  const cleanup = installStorageWindow();

  try {
    setStoredRefreshToken('refresh-token-1');
    assert.equal(getStoredRefreshToken(), 'refresh-token-1');

    clearStoredSession();
    assert.equal(getStoredRefreshToken(), null);
  } finally {
    cleanup();
  }
});

test('session-storage refresh lock only allows one active owner at a time', () => {
  const cleanup = installStorageWindow();

  try {
    const lockA = createLock('tab-a', 'request-a');
    const lockB = createLock('tab-b', 'request-b');

    assert.equal(tryAcquireRefreshLock(lockA, lockA.acquiredAt), true);
    assert.equal(tryAcquireRefreshLock(lockB, lockB.acquiredAt), false);
    assert.deepEqual(getActiveRefreshLock(lockA.acquiredAt), lockA);

    releaseRefreshLock('tab-a', 'request-a');
    assert.equal(getActiveRefreshLock(lockA.acquiredAt), null);
    assert.equal(tryAcquireRefreshLock(lockB, lockB.acquiredAt), true);
  } finally {
    cleanup();
  }
});
