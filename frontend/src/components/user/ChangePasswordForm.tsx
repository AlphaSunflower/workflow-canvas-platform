import { memo, useCallback, useState } from 'react';

import { usersApi } from '@/api/services/users-api';
import type { AppError } from '@/types';

interface ChangePasswordFormProps {
  busy: boolean;
  onError: (error: AppError | null) => void;
  onPasswordChanged: (revokedSessionCount: number) => void;
}

export const ChangePasswordForm = memo(({
  busy,
  onError,
  onPasswordChanged,
}: ChangePasswordFormProps) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    onError(null);

    const result = await usersApi.updateCurrentPassword({
      currentPassword,
      newPassword,
    });

    setSubmitting(false);

    if (!result.success) {
      onError(result.error);
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    onPasswordChanged(result.data.revokedSessionCount);
  }, [currentPassword, newPassword, onError, onPasswordChanged]);

  return (
    <section className="user-management-modal__section">
      <div className="user-management-modal__intro">
        <h3>修改密码</h3>
        <p>修改密码成功后，前端会按后端语义清空当前会话并要求重新登录。</p>
      </div>

      <form className="user-management-modal__form" onSubmit={(event) => { void handleSubmit(event); }}>
        <label className="user-management-modal__field">
          <span>当前密码</span>
          <input
            className="input"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            disabled={busy || submitting}
            required
          />
        </label>

        <label className="user-management-modal__field">
          <span>新密码</span>
          <input
            className="input"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            disabled={busy || submitting}
            required
          />
        </label>

        <div className="user-management-modal__actions">
          <button className="btn btn--danger" type="submit" disabled={busy || submitting}>
            {submitting ? '提交中...' : '更新密码'}
          </button>
        </div>
      </form>
    </section>
  );
});

ChangePasswordForm.displayName = 'ChangePasswordForm';
