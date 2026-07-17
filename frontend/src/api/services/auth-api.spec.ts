import test from 'node:test';
import assert from 'node:assert/strict';

import { authApi, setAuthAccessToken } from './auth-api';
import { httpClient } from '../client/http-client';
import type { AuthSuccessResponseData, Result } from '@/types';

function createAuthSuccessResponse(): AuthSuccessResponseData {
  return {
    tokens: {
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      tokenType: 'Bearer',
      expiresIn: 3600,
    },
    user: {
      userId: 'user-1',
      email: 'demo@example.com',
      displayName: 'Demo User',
      role: 'member',
      status: 'enabled',
      lastLoginAt: null,
      createdAt: '2026-04-09T00:00:00.000Z',
      updatedAt: '2026-04-09T00:00:00.000Z',
    },
  };
}

test('authApi.login applies returned access token to http client', async () => {
  const originalPost = httpClient.post.bind(httpClient);
  const originalToken = httpClient.getAuthToken();

  httpClient.post = async <T>() => ({
    success: true,
    data: createAuthSuccessResponse(),
  }) as Result<T>;

  try {
    const result = await authApi.login({
      email: 'demo@example.com',
      password: 'password-1',
    });

    assert.equal(result.success, true);
    assert.equal(httpClient.getAuthToken(), 'access-token-1');
  } finally {
    httpClient.post = originalPost;
    setAuthAccessToken(originalToken);
  }
});

test('authApi.logout clears access token after successful logout', async () => {
  const originalPost = httpClient.post.bind(httpClient);
  const originalToken = httpClient.getAuthToken();
  setAuthAccessToken('stale-access-token');

  httpClient.post = async <T>() => ({
    success: true,
    data: {
      loggedOut: true,
    },
  }) as Result<T>;

  try {
    const result = await authApi.logout({
      refreshToken: 'refresh-token-1',
    });

    assert.equal(result.success, true);
    assert.equal(httpClient.getAuthToken(), null);
  } finally {
    httpClient.post = originalPost;
    setAuthAccessToken(originalToken);
  }
});
