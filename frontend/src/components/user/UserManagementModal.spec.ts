import test from 'node:test';
import assert from 'node:assert/strict';

import { createAuthenticationRequiredError, getAuthenticationErrorFeedback } from '@/auth';
import { createError } from '@/utils';

test('user management auth feedback marks unauthenticated actions as login-required', () => {
  const error = createAuthenticationRequiredError('打开账户中心');
  const feedback = getAuthenticationErrorFeedback(error, '打开账户中心');

  assert.deepEqual(feedback, {
    title: '需要登录',
    message: '请先登录后再打开账户中心',
  });
});

test('user management auth feedback marks permission errors as forbidden', () => {
  const feedback = getAuthenticationErrorFeedback(
    createError('PERMISSION_ERROR', '当前账户无权执行管理员操作', {
      module: 'user-management-modal.spec',
      operation: 'permission-feedback',
      timestamp: Date.now(),
    }),
    '执行管理员操作',
  );

  assert.deepEqual(feedback, {
    title: '无权限访问',
    message: '当前账户无权执行管理员操作',
  });
});
