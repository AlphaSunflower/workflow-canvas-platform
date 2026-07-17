import { memo, useCallback, useState } from 'react';

import { usersApi } from '@/api/services/users-api';
import type { AccountStatus, AppError, UserItemResponseData } from '@/types';

interface AdminUserStatusToggleProps {
  user: UserItemResponseData;
  onChanged: (user: UserItemResponseData) => void;
  onError: (error: AppError | null) => void;
}

export const AdminUserStatusToggle = memo(({
  user,
  onChanged,
  onError,
}: AdminUserStatusToggleProps) => {
  const [submitting, setSubmitting] = useState(false);

  const handleToggle = useCallback(async (): Promise<void> => {
    const nextStatus: AccountStatus = user.status === 'enabled' ? 'disabled' : 'enabled';
    setSubmitting(true);
    onError(null);

    const result = await usersApi.updateStatus(user.userId, {
      status: nextStatus,
    });

    setSubmitting(false);

    if (!result.success) {
      onError(result.error);
      return;
    }

    onChanged(result.data.user);
  }, [onChanged, onError, user.status, user.userId]);

  return (
    <button
      className={user.status === 'enabled' ? 'btn btn--secondary' : 'btn btn--primary'}
      type="button"
      onClick={() => { void handleToggle(); }}
      disabled={submitting}
    >
      {submitting ? '处理中...' : user.status === 'enabled' ? '禁用' : '启用'}
    </button>
  );
});

AdminUserStatusToggle.displayName = 'AdminUserStatusToggle';
