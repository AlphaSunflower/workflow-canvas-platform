import test from 'node:test';
import assert from 'node:assert/strict';

import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';
import type { AuthContextValue } from './auth-context';
import { authApi, httpClient, websocketClient } from '@/api';
import { clearStoredSession, getStoredRefreshToken, setStoredRefreshToken } from './session-storage';
import type { AuthSuccessResponseData, Result } from '@/types';
import { createError } from '@/utils';
import {
  cacheBackendFileBinding,
  getCachedBackendFileBinding,
} from '@/services/backendFileService';
import { imageOriginalSourceRegistry } from '@/services/image/image-original-source-registry';
import {
  fileManifestStore,
  fileResourceLeaseManager,
} from '@/services/file-resource';
import { clearFileResourceSessionState } from '@/services/file-resource/file-resource-session';

function createAuthSuccessResponse(): AuthSuccessResponseData {
  return {
    tokens: {
      accessToken: 'access-token-provider',
      refreshToken: 'refresh-token-provider',
      tokenType: 'Bearer',
      expiresIn: 3600,
    },
    user: {
      userId: 'user-auth-provider',
      email: 'provider@example.com',
      displayName: 'Provider User',
      role: 'admin',
      status: 'enabled',
      lastLoginAt: null,
      createdAt: '2026-04-09T00:00:00.000Z',
      updatedAt: '2026-04-09T00:00:00.000Z',
    },
  };
}

function installDom(): {
  container: {
    nodeType: number;
    ownerDocument: unknown;
    nodeName: string;
    tagName: string;
    namespaceURI: string;
    childNodes: unknown[];
    addEventListener: (type: string, handler: EventListener) => void;
    removeEventListener: (type: string, handler: EventListener) => void;
    appendChild: () => void;
    insertBefore: () => void;
    removeChild: () => void;
  };
  cleanup: () => void;
  dispatchWindowEvent: (type: string, event: { key?: string | null; newValue?: string | null }) => void;
} {
  const bodyStyle = { overflow: '' };
  const documentListeners = new Map<string, Set<EventListener>>();
  const windowListeners = new Map<string, Set<EventListener>>();
  const body = {
    nodeType: 1,
    nodeName: 'BODY',
    tagName: 'BODY',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: null as unknown,
    style: bodyStyle,
    childNodes: [] as unknown[],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    appendChild: () => undefined,
    insertBefore: () => undefined,
    removeChild: () => undefined,
  };
  const documentStub = {
    nodeType: 9,
    body,
    documentElement: {
      nodeType: 1,
      nodeName: 'HTML',
      tagName: 'HTML',
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      ownerDocument: null as unknown,
    },
    createElement: () => ({ nodeType: 1 }),
    createTextNode: (text: string) => ({
      nodeType: 3,
      nodeName: '#text',
      textContent: text,
      nodeValue: text,
      ownerDocument: documentStub,
    }),
    getElementById: () => null,
    addEventListener: (type: string, handler: EventListener) => {
      if (!documentListeners.has(type)) {
        documentListeners.set(type, new Set());
      }
      documentListeners.get(type)?.add(handler);
    },
    removeEventListener: (type: string, handler: EventListener) => {
      documentListeners.get(type)?.delete(handler);
    },
    visibilityState: 'visible',
  };
  const localStorageMap = new Map<string, string>();
  const windowStub = {
    document: documentStub,
    HTMLElement: function HTMLElement() {
      return undefined;
    },
    HTMLIFrameElement: function HTMLIFrameElement() {
      return undefined;
    },
    addEventListener: (type: string, handler: EventListener) => {
      if (!windowListeners.has(type)) {
        windowListeners.set(type, new Set());
      }
      windowListeners.get(type)?.add(handler);
    },
    removeEventListener: (type: string, handler: EventListener) => {
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
  };

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: windowStub,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: documentStub,
  });
  body.ownerDocument = documentStub;
  documentStub.documentElement.ownerDocument = documentStub;

  const container = {
    nodeType: 1,
    ownerDocument: documentStub,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    childNodes: [] as unknown[],
    addEventListener: (type: string, handler: EventListener) => {
      documentStub.addEventListener(type, handler);
    },
    removeEventListener: (type: string, handler: EventListener) => {
      documentStub.removeEventListener(type, handler);
    },
    appendChild: (...children: unknown[]) => {
      container.childNodes.push(...children);
    },
    insertBefore: (...children: unknown[]) => {
      container.childNodes.unshift(...children);
    },
    removeChild: () => undefined,
  };

  return {
    container,
    dispatchWindowEvent: (type, event) => {
      windowListeners.get(type)?.forEach((handler) => {
        handler(event as never);
      });
    },
    cleanup: () => {
      if (previousWindow === undefined) {
        // @ts-expect-error restore optional global
        delete globalThis.window;
      } else {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: previousWindow,
        });
      }

      if (previousDocument === undefined) {
        // @ts-expect-error restore optional global
        delete globalThis.document;
      } else {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: previousDocument,
        });
      }
    },
  };
}

function flushEffects(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function seedFileResourceSessionState(): void {
  const node = {
    id: {
      value: 'node-auth-session-resource',
      display: '#81001',
    },
    fileId: 'file-auth-session-resource',
  };
  cacheBackendFileBinding(node, {
    backendFileId: 'backend-auth-session-resource',
    sha256: 'sha-auth-session-resource',
    size: 9,
    updatedAt: Date.now(),
  }, {
    workflowId: 'workflow-auth-session',
    authScope: 'account-auth-session',
  });
  imageOriginalSourceRegistry.registerLocalFile(
    node.id.value,
    node.fileId,
    new File(['auth-original'], 'auth-original.png', { type: 'image/png' }),
    {
      workflowId: 'workflow-auth-session',
      authScope: 'account-auth-session',
    },
  );
  fileResourceLeaseManager.acquireLease({
    workflowId: 'workflow-auth-session',
    nodeId: node.id.value,
    fileId: node.fileId,
    authScope: 'account-auth-session',
    variant: 'original',
  }, 'viewer', 'auth-session-viewer');
}

function hasSeededFileResourceSessionState(): boolean {
  const node = {
    id: {
      value: 'node-auth-session-resource',
      display: '#81001',
    },
    fileId: 'file-auth-session-resource',
  };
  return Boolean(getCachedBackendFileBinding(node, {
    workflowId: 'workflow-auth-session',
    authScope: 'account-auth-session',
  }))
    || Boolean(imageOriginalSourceRegistry.getFile(node.id.value, node.fileId, {
      workflowId: 'workflow-auth-session',
      authScope: 'account-auth-session',
    }))
    || fileResourceLeaseManager.getLeaseCount({
      workflowId: 'workflow-auth-session',
      nodeId: node.id.value,
      fileId: node.fileId,
      authScope: 'account-auth-session',
      variant: 'original',
    }) > 0
    || fileManifestStore.get({
      workflowId: 'workflow-auth-session',
      nodeId: node.id.value,
      fileId: node.fileId,
      authScope: 'account-auth-session',
      variant: 'original',
    }) !== null;
}

test('AuthProvider restores session and connects websocket through session-managed token provider', async () => {
  const dom = installDom();
  const originalRefresh = authApi.refresh;
  const originalConnect = websocketClient.connect.bind(websocketClient);
  const originalDisconnect = websocketClient.disconnect.bind(websocketClient);
  const originalSetProvider = websocketClient.setAuthTokenProvider.bind(websocketClient);
  const originalToken = httpClient.getAuthToken();

  let observedProviderToken: string | null = null;
  let connectCount = 0;
  let disconnectCount = 0;
  let snapshot: AuthContextValue | null = null;

  authApi.refresh = async () => ({
    success: true,
    data: createAuthSuccessResponse(),
  }) as Result<AuthSuccessResponseData>;
  websocketClient.setAuthTokenProvider = (provider) => {
    observedProviderToken = provider?.() ?? null;
    originalSetProvider(provider);
  };
  websocketClient.connect = async () => {
    connectCount += 1;
    observedProviderToken = httpClient.getAuthToken();
    return {
      success: true,
      data: undefined,
    };
  };
  websocketClient.disconnect = () => {
    disconnectCount += 1;
  };

  function Probe(): JSX.Element {
    snapshot = useAuth();
    return <div>probe</div>;
  }

  setStoredRefreshToken('refresh-token-provider');
  clearFileResourceSessionState();
  seedFileResourceSessionState();
  assert.equal(hasSeededFileResourceSessionState(), true);

  try {
    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );

      await flushEffects();
      await flushEffects();
      await flushEffects();
    });

    assert.ok(snapshot !== null);
    if (!snapshot) {
      throw new Error('Expected auth snapshot to be available');
    }

    const authSnapshot: AuthContextValue = snapshot;
    assert.equal(authSnapshot.status, 'authenticated');
    assert.equal(authSnapshot.user?.email, 'provider@example.com');
    assert.equal(observedProviderToken, 'access-token-provider');
    assert.equal(connectCount >= 1, true);

    await act(async () => {
      root.unmount();
      await flushEffects();
    });
    assert.equal(disconnectCount >= 1, true);
  } finally {
    authApi.refresh = originalRefresh;
    websocketClient.connect = originalConnect;
    websocketClient.disconnect = originalDisconnect;
    websocketClient.setAuthTokenProvider = originalSetProvider;
    httpClient.setAuthToken(originalToken);
    clearStoredSession();
    dom.cleanup();
  }
});

test('AuthProvider keeps refresh token on temporary refresh failure', async () => {
  const dom = installDom();
  const originalRefresh = authApi.refresh;
  const originalToken = httpClient.getAuthToken();
  let snapshot: AuthContextValue | null = null;

  authApi.refresh = async () => ({
    success: false,
    error: createError('NETWORK_ERROR', 'network failed', {
      module: 'auth-provider.spec',
      operation: 'refresh',
      timestamp: Date.now(),
    }),
  });

  function Probe(): JSX.Element {
    snapshot = useAuth();
    return <div>probe</div>;
  }

  setStoredRefreshToken('refresh-token-provider');
  clearFileResourceSessionState();
  seedFileResourceSessionState();
  assert.equal(hasSeededFileResourceSessionState(), true);

  try {
    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );

      await flushEffects();
      await flushEffects();
      await flushEffects();
    });

    assert.ok(snapshot !== null);
    if (!snapshot) {
      throw new Error('Expected auth snapshot to be available');
    }

    const authSnapshot: AuthContextValue = snapshot;
    assert.equal(authSnapshot.status, 'unauthenticated');
    assert.equal(getStoredRefreshToken(), 'refresh-token-provider');
    assert.equal(authSnapshot.error?.context?.refreshFailureDisposition, 'soft');
    assert.equal(hasSeededFileResourceSessionState(), true);

    await act(async () => {
      root.unmount();
      await flushEffects();
    });
  } finally {
    authApi.refresh = originalRefresh;
    httpClient.setAuthToken(originalToken);
    clearStoredSession();
    clearFileResourceSessionState();
    dom.cleanup();
  }
});

test('AuthProvider clears session on invalid refresh token', async () => {
  const dom = installDom();
  const originalRefresh = authApi.refresh;
  const originalToken = httpClient.getAuthToken();
  let snapshot: AuthContextValue | null = null;

  authApi.refresh = async () => ({
    success: false,
    error: createError('AUTH_ERROR', 'session rotated', {
      module: 'auth-provider.spec',
      operation: 'refresh',
      timestamp: Date.now(),
      context: {
        backendError: 'SESSION_ROTATED',
        status: 401,
      },
    }),
  });

  function Probe(): JSX.Element {
    snapshot = useAuth();
    return <div>probe</div>;
  }

  setStoredRefreshToken('refresh-token-provider');
  clearFileResourceSessionState();
  seedFileResourceSessionState();
  assert.equal(hasSeededFileResourceSessionState(), true);

  try {
    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );

      await flushEffects();
      await flushEffects();
      await flushEffects();
    });

    assert.ok(snapshot !== null);
    if (!snapshot) {
      throw new Error('Expected auth snapshot to be available');
    }

    const authSnapshot: AuthContextValue = snapshot;
    assert.equal(authSnapshot.status, 'unauthenticated');
    assert.equal(getStoredRefreshToken(), null);
    assert.equal(authSnapshot.error?.context?.refreshFailureDisposition, 'hard');
    assert.equal(hasSeededFileResourceSessionState(), false);

    await act(async () => {
      root.unmount();
      await flushEffects();
    });
  } finally {
    authApi.refresh = originalRefresh;
    httpClient.setAuthToken(originalToken);
    clearStoredSession();
    clearFileResourceSessionState();
    dom.cleanup();
  }
});

test('AuthProvider synchronizes logout from another tab via storage event', async () => {
  const dom = installDom();
  const originalRefresh = authApi.refresh;
  const originalToken = httpClient.getAuthToken();
  let snapshot: AuthContextValue | null = null;

  authApi.refresh = async () => ({
    success: true,
    data: createAuthSuccessResponse(),
  }) as Result<AuthSuccessResponseData>;

  function Probe(): JSX.Element {
    snapshot = useAuth();
    return <div>probe</div>;
  }

  setStoredRefreshToken('refresh-token-provider');

  try {
    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );

      await flushEffects();
      await flushEffects();
      await flushEffects();
    });

    assert.ok(snapshot !== null);
    if (!snapshot) {
      throw new Error('Expected auth snapshot to be available');
    }
    assert.equal((snapshot as AuthContextValue).status, 'authenticated');

    await act(async () => {
      dom.dispatchWindowEvent('storage', {
        key: 'newworkflow.auth.session-event',
        newValue: JSON.stringify({
          type: 'logout',
          sourceTabId: 'other-tab',
          requestId: 'logout-request-1',
          occurredAt: Date.now(),
        }),
      });
      await flushEffects();
    });

    assert.ok(snapshot !== null);
    if (!snapshot) {
      throw new Error('Expected auth snapshot to be available');
    }
    assert.equal((snapshot as AuthContextValue).status, 'unauthenticated');
    assert.equal(getStoredRefreshToken(), null);
    assert.equal(hasSeededFileResourceSessionState(), false);

    await act(async () => {
      root.unmount();
      await flushEffects();
    });
  } finally {
    authApi.refresh = originalRefresh;
    httpClient.setAuthToken(originalToken);
    clearStoredSession();
    clearFileResourceSessionState();
    dom.cleanup();
  }
});

test('AuthProvider proactively refreshes before access token expiry window', async () => {
  const dom = installDom();
  const originalRefresh = authApi.refresh;
  const originalToken = httpClient.getAuthToken();
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalDateNow = Date.now;
  let snapshot: AuthContextValue | null = null;
  let refreshCount = 0;
  let nextTimerId = 1;
  let now = originalDateNow();
  const scheduledTimers = new Map<number, () => void>();

  authApi.refresh = async () => {
    refreshCount += 1;
    return {
      success: true,
      data: createAuthSuccessResponse(),
    } as Result<AuthSuccessResponseData>;
  };

  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    value: ((callback: () => void, delay?: number) => {
      if (typeof delay === 'number' && delay > 0) {
        const timerId = nextTimerId;
        nextTimerId += 1;
        scheduledTimers.set(timerId, callback);
        return timerId as ReturnType<typeof setTimeout>;
      }

      return originalSetTimeout(callback, delay);
    }) as typeof setTimeout,
  });
  Object.defineProperty(globalThis, 'clearTimeout', {
    configurable: true,
    value: ((timerId: ReturnType<typeof setTimeout>) => {
      if (typeof timerId === 'number') {
        scheduledTimers.delete(timerId);
        return;
      }

      originalClearTimeout(timerId);
    }) as typeof clearTimeout,
  });
  Object.defineProperty(Date, 'now', {
    configurable: true,
    value: () => now,
  });

  function Probe(): JSX.Element {
    snapshot = useAuth();
    return <div>probe</div>;
  }

  setStoredRefreshToken('refresh-token-provider');

  try {
    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );

      await flushEffects();
      await flushEffects();
      await flushEffects();
      await flushEffects();
    });

    assert.ok(snapshot !== null);
    if (!snapshot) {
      throw new Error('Expected auth snapshot to be available');
    }

    assert.equal(refreshCount, 1);
    assert.equal(scheduledTimers.size >= 1, true);

    const [firstScheduledTimer] = scheduledTimers.values();
    if (!firstScheduledTimer) {
      throw new Error('Expected proactive refresh timer to be scheduled');
    }

    scheduledTimers.clear();
    now += 3_300_000;

    await act(async () => {
      firstScheduledTimer();
      await flushEffects();
      await flushEffects();
      await flushEffects();
    });

    const authSnapshot: AuthContextValue = snapshot;
    assert.equal(authSnapshot.status, 'authenticated');
    assert.equal(refreshCount, 2);

    await act(async () => {
      root.unmount();
      await flushEffects();
    });
  } finally {
    authApi.refresh = originalRefresh;
    httpClient.setAuthToken(originalToken);
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      value: originalSetTimeout,
    });
    Object.defineProperty(globalThis, 'clearTimeout', {
      configurable: true,
      value: originalClearTimeout,
    });
    Object.defineProperty(Date, 'now', {
      configurable: true,
      value: originalDateNow,
    });
    clearStoredSession();
    dom.cleanup();
  }
});

test('AuthProvider applies refresh success broadcast from another tab after initial restore', async () => {
  const dom = installDom();
  const originalRefresh = authApi.refresh;
  const originalToken = httpClient.getAuthToken();
  let snapshot: AuthContextValue | null = null;
  const eventOccurredAt = Date.now();

  authApi.refresh = async () => ({
    success: true,
    data: createAuthSuccessResponse(),
  }) as Result<AuthSuccessResponseData>;

  function Probe(): JSX.Element {
    snapshot = useAuth();
    return <div>probe</div>;
  }

  setStoredRefreshToken('refresh-token-provider');

  try {
    const root = createRoot(dom.container as never);
    await act(async () => {
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );

      await flushEffects();
      await flushEffects();
      await flushEffects();
    });

    await act(async () => {
      dom.dispatchWindowEvent('storage', {
        key: 'newworkflow.auth.session-event',
        newValue: JSON.stringify({
          type: 'refresh_succeeded',
          sourceTabId: 'other-tab',
          requestId: 'refresh-request-1',
          occurredAt: eventOccurredAt,
          payload: {
            accessToken: 'broadcast-access-token',
            refreshToken: 'broadcast-refresh-token',
            expiresIn: 3600,
            expiresAt: eventOccurredAt + 3_600_000,
            user: createAuthSuccessResponse().user,
          },
        }),
      });
      await flushEffects();
    });

    assert.ok(snapshot !== null);
    if (!snapshot) {
      throw new Error('Expected auth snapshot to be available');
    }

    const authSnapshot: AuthContextValue = snapshot;
    assert.equal(authSnapshot.status, 'authenticated');
    assert.equal(authSnapshot.user?.email, 'provider@example.com');
    assert.equal(httpClient.getAuthToken(), 'broadcast-access-token');
    assert.equal(getStoredRefreshToken(), 'broadcast-refresh-token');

    await act(async () => {
      root.unmount();
      await flushEffects();
    });
  } finally {
    authApi.refresh = originalRefresh;
    httpClient.setAuthToken(originalToken);
    clearStoredSession();
    dom.cleanup();
  }
});
