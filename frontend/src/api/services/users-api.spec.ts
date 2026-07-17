import test from 'node:test';
import assert from 'node:assert/strict';

import { usersApi } from './users-api';
import { httpClient } from '../client/http-client';
import type { Result } from '@/types';

test('usersApi.list requests admin user list from the expected endpoint', async () => {
  const originalGet = httpClient.get.bind(httpClient);
  let requestedPath = '';

  httpClient.get = async <T>(path: string) => {
    requestedPath = path;
    return {
      success: true,
      data: {
        items: [],
        total: 0,
      },
    } as Result<T>;
  };

  try {
    const result = await usersApi.list();
    assert.equal(result.success, true);
    assert.equal(requestedPath, '/api/v1/admin/users');
  } finally {
    httpClient.get = originalGet;
  }
});

test('usersApi.resetPassword forwards revokeExistingSessions to backend', async () => {
  const originalPut = httpClient.put.bind(httpClient);
  let requestedPath = '';
  let requestedBody: unknown = null;

  httpClient.put = async <T>(path: string, body?: unknown) => {
    requestedPath = path;
    requestedBody = body;
    return {
      success: true,
      data: {
        user: {
          userId: 'user-2',
          email: 'admin-created@example.com',
          displayName: 'Managed User',
          role: 'member',
          status: 'enabled',
          lastLoginAt: null,
          createdAt: '2026-04-09T00:00:00.000Z',
          updatedAt: '2026-04-09T00:00:00.000Z',
        },
        revokedSessionCount: 3,
      },
    } as Result<T>;
  };

  try {
    const result = await usersApi.resetPassword('user-2', {
      newPassword: 'NewPassword!1',
      revokeExistingSessions: true,
    });

    assert.equal(result.success, true);
    assert.equal(requestedPath, '/api/v1/admin/users/user-2/password');
    assert.deepEqual(requestedBody, {
      newPassword: 'NewPassword!1',
      revokeExistingSessions: true,
    });
  } finally {
    httpClient.put = originalPut;
  }
});
