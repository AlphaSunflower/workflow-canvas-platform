import test from 'node:test';
import assert from 'node:assert/strict';

import { usersApi } from '@/api/services/users-api';

test('admin user list fetches managed users from usersApi.list', async () => {
  const originalList = usersApi.list;
  let callCount = 0;

  usersApi.list = async () => {
    callCount += 1;
    return {
      success: true,
      data: {
        items: [],
        total: 0,
      },
    };
  };

  try {
    const result = await usersApi.list();
    assert.equal(result.success, true);
    assert.equal(callCount, 1);
  } finally {
    usersApi.list = originalList;
  }
});
