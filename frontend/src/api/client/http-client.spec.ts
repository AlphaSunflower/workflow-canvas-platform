import test from 'node:test';
import assert from 'node:assert/strict';

import { createHttpClient } from './http-client';
import { createError } from '@/utils';

test('http client retries once after auth refresh and reuses single-flight refresh promise', async () => {
  const client = createHttpClient({
    baseURL: 'http://localhost:3100',
  });

  let requestCount = 0;
  let refreshCount = 0;
  const authorizationHeaders: string[] = [];
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (_input: unknown, init?: RequestInit) => {
      requestCount += 1;
      authorizationHeaders.push(String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ''));

      if (requestCount <= 2) {
        return new Response(JSON.stringify({
          code: 'AUTH_ERROR',
          message: 'token expired',
        }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        });
      }

      return new Response(JSON.stringify({
        code: 200,
        message: 'ok',
        data: {
          ok: true,
        },
        timestamp: Date.now(),
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    },
  });

  client.setAuthLifecycleHandlers({
    refreshAuth: async () => {
      refreshCount += 1;
      client.setAuthToken(`refreshed-token-${refreshCount}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      return {
        success: true,
        data: {
          accessToken: `refreshed-token-${refreshCount}`,
        },
      };
    },
    onAuthRefreshFailure: () => undefined,
  });
  client.setAuthToken('expired-token');

  try {
    const [firstResult, secondResult] = await Promise.all([
      client.get<{ ok: true }>('/api/v1/protected'),
      client.get<{ ok: true }>('/api/v1/protected'),
    ]);

    assert.equal(firstResult.success, true);
    assert.equal(secondResult.success, true);
    assert.equal(refreshCount, 1);
    assert.equal(requestCount, 4);
    assert.equal(authorizationHeaders[0], 'Bearer expired-token');
    assert.equal(authorizationHeaders[1], 'Bearer expired-token');
    assert.equal(authorizationHeaders[2], 'Bearer refreshed-token-1');
    assert.equal(authorizationHeaders[3], 'Bearer refreshed-token-1');
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});

test('http client clears session through auth failure callback when refresh fails', async () => {
  const client = createHttpClient({
    baseURL: 'http://localhost:3100',
  });

  const originalFetch = globalThis.fetch;
  let refreshFailureCode = '';

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => new Response(JSON.stringify({
      code: 'AUTH_ERROR',
      message: 'token expired',
    }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
      },
    }),
  });

  client.setAuthLifecycleHandlers({
    refreshAuth: async () => ({
      success: false,
      error: createError('AUTH_ERROR', 'refresh failed', {
        module: 'http-client.spec',
        operation: 'refreshAuth',
        timestamp: Date.now(),
      }),
    }),
    onAuthRefreshFailure: (error) => {
      refreshFailureCode = error.code;
      client.clearAuthToken();
    },
  });
  client.setAuthToken('expired-token');

  try {
    const result = await client.get('/api/v1/protected');
    assert.equal(result.success, false);
    assert.equal(refreshFailureCode, 'AUTH_ERROR');
    assert.equal(client.getAuthToken(), null);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});

test('http client keeps auth token when refresh fails softly and callback does not clear session', async () => {
  const client = createHttpClient({
    baseURL: 'http://localhost:3100',
  });

  const originalFetch = globalThis.fetch;
  let refreshFailureCode = '';

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => new Response(JSON.stringify({
      code: 'AUTH_ERROR',
      message: 'token expired',
    }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
      },
    }),
  });

  client.setAuthLifecycleHandlers({
    refreshAuth: async () => ({
      success: false,
      error: createError('NETWORK_ERROR', 'refresh network failed', {
        module: 'http-client.spec',
        operation: 'refreshAuth',
        timestamp: Date.now(),
      }),
    }),
    onAuthRefreshFailure: (error) => {
      refreshFailureCode = error.code;
    },
  });
  client.setAuthToken('still-valid-token');

  try {
    const result = await client.get('/api/v1/protected');
    assert.equal(result.success, false);
    assert.equal(refreshFailureCode, 'NETWORK_ERROR');
    assert.equal(client.getAuthToken(), 'still-valid-token');
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});

test('http client marks abort refresh failure as timeout error', async () => {
  const client = createHttpClient({
    baseURL: 'http://localhost:3100',
    timeout: 1,
  });

  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (_input: unknown, init?: RequestInit) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
      return new Response();
    },
  });

  try {
    const result = await client.get('/api/v1/protected');
    assert.equal(result.success, false);

    if (result.success) {
      throw new Error('Expected timeout error result');
    }

    assert.equal(result.error.code, 'TIMEOUT_ERROR');
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});

test('http client includes request diagnostics for network failures without leaking tokens', async () => {
  const client = createHttpClient({
    baseURL: 'http://127.0.0.1:3100',
  });
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        origin: 'http://localhost:3000',
      },
    },
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  client.setAuthToken('secret-token');

  try {
    const result = await client.getBlob('/api/v1/files/file-1/download');
    assert.equal(result.success, false);
    if (result.success) {
      throw new Error('Expected network failure.');
    }

    assert.equal(result.error.code, 'NETWORK_ERROR');
    assert.equal(result.error.context?.url, 'http://127.0.0.1:3100/api/v1/files/file-1/download');
    assert.equal(result.error.context?.baseURL, 'http://127.0.0.1:3100');
    assert.equal(result.error.context?.path, '/api/v1/files/file-1/download');
    assert.equal(result.error.context?.method, 'GET');
    assert.equal(result.error.context?.isCrossOrigin, true);
    assert.equal(result.error.context?.hasAuthToken, true);
    assert.equal(JSON.stringify(result.error.context).includes('secret-token'), false);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('http client uses same-origin relative file routes when base url is empty', async () => {
  const client = createHttpClient({
    baseURL: '',
  });
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const requestedUrls: string[] = [];

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        origin: 'http://localhost:3000',
      },
    },
  });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), {
        status: 200,
      });
    },
  });

  try {
    const result = await client.getBlob('/api/v1/files/file-same-origin/download');

    assert.equal(result.success, true);
    assert.deepEqual(requestedUrls, ['/api/v1/files/file-same-origin/download']);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('http client stores bounded response body snippets for failed file responses', async () => {
  const client = createHttpClient({
    baseURL: '',
  });
  const originalFetch = globalThis.fetch;
  const longBody = `{"code":40042,"error":"INVALID_FILE","message":"${'x'.repeat(3000)}"}`;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => new Response(longBody, {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    }),
  });

  try {
    const result = await client.getBlob('/api/v1/files/file-long/download');
    assert.equal(result.success, false);
    if (result.success) {
      throw new Error('Expected failed file response.');
    }

    assert.equal(result.error.context?.status, 400);
    assert.equal(result.error.context?.backendCode, 40042);
    assert.equal(result.error.context?.bodyLength, longBody.length);
    assert.equal(result.error.context?.bodyTruncated, true);
    assert.equal(typeof result.error.context?.bodySnippet, 'string');
    assert.equal((result.error.context?.bodySnippet as string).length, 2048);
    assert.equal('body' in (result.error.context ?? {}), false);
    assert.equal(result.error.message.length, 515);
    assert.equal(result.error.message.endsWith('...'), true);
    assert.equal(result.error.context?.errorMessageLength, 3000);
    assert.equal(result.error.context?.errorMessageTruncated, true);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});

test('http client can suppress expected GET error logging while preserving diagnostics', async () => {
  const client = createHttpClient({});
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => new Response(JSON.stringify({
      code: 40441,
      error: 'RUN_NOT_FOUND',
      message: 'Execution run not found.',
    }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
      },
    }),
  });

  try {
    const result = await client.get('/api/v1/workflows/workflow-1/executions/reconcile', {
      nodeId: 'node-1',
    }, {
      suppressErrorLog: true,
    });

    assert.equal(result.success, false);
    if (result.success) {
      throw new Error('Expected request to fail');
    }

    assert.equal(result.error.code, 'RUN_NOT_FOUND');
    assert.equal(result.error.message, 'Execution run not found.');
    assert.equal(result.error.context?.status, 404);
    assert.equal(result.error.context?.backendCode, 40441);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});

test('http client redacts tokens from failed response diagnostics', async () => {
  const client = createHttpClient({
    baseURL: '',
  });
  const originalFetch = globalThis.fetch;
  const responseBody = JSON.stringify({
    code: 40042,
    error: 'INVALID_FILE',
    message: 'Bearer secret-token failed',
    accessToken: 'secret-token',
    errors: {
      url: '/api/v1/files/file/download?token=secret-token',
    },
  });

  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => new Response(responseBody, {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    }),
  });

  try {
    const result = await client.getBlob('/api/v1/files/file-token/download');
    assert.equal(result.success, false);
    if (result.success) {
      throw new Error('Expected failed file response.');
    }

    const serializedContext = JSON.stringify(result.error.context);
    assert.equal(result.error.message.includes('secret-token'), false);
    assert.equal(serializedContext.includes('secret-token'), false);
    assert.equal(serializedContext.includes('[REDACTED]'), true);
    assert.equal(serializedContext.includes('[REDACTED]]'), false);
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  }
});
