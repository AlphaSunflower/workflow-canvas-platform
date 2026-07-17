import { memo, useCallback, useEffect, useState } from 'react';

import { usersApi } from '@/api/services/users-api';
import type { AppError, UserItemResponseData } from '@/types';
import { Modal } from '../ui';

interface AdminResetPasswordDialogProps {
  user: UserItemResponseData | null;
  isOpen: boolean;
  onClose: () => void;
  onError: (error: AppError | null) => void;
  onSuccess: (message: string) => void;
}

export const AdminResetPasswordDialog = memo(({
  user,
  isOpen,
  onClose,
  onError,
  onSuccess,
}: AdminResetPasswordDialogProps) => {
  const [newPassword, setNewPassword] = useState('');
  const [revokeExistingSessions, setRevokeExistingSessions] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setNewPassword('');
      setRevokeExistingSessions(true);
    }
  }, [isOpen]);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!user) {
      return;
    }

    setSubmitting(true);
    onError(null);

    const result = await usersApi.resetPassword(user.userId, {
      newPassword,
      revokeExistingSessions,
    });

    setSubmitting(false);

    if (!result.success) {
      onError(result.error);
      return;
    }

    onSuccess(`已重置 ${user.displayName} 的密码，并撤销 ${result.data.revokedSessionCount} 个会话。`);
    onClose();
  }, [newPassword, onClose, onError, onSuccess, revokeExistingSessions, user]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="重置用户密码" size="sm">
      <form className="user-management-modal__form" onSubmit={(event) => { void handleSubmit(event); }}>
        <div className="user-management-modal__intro">
          <h3>管理员重置密码</h3>
          <p>{user ? `为 ${user.displayName} 设置新密码。` : '请选择要重置密码的用户。'}</p>
        </div>

        <label className="user-management-modal__field">
          <span>新密码</span>
          <input
            className="input"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            disabled={submitting}
            required
          />
        </label>

        <label className="user-management-modal__checkbox">
          <input
            type="checkbox"
            checked={revokeExistingSessions}
            onChange={(event) => setRevokeExistingSessions(event.target.checked)}
            disabled={submitting}
          />
          <span>同时撤销该用户当前已有会话</span>
        </label>

        <div className="user-management-modal__actions">
          <button className="btn btn--secondary" type="button" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button className="btn btn--danger" type="submit" disabled={submitting || !user}>
            {submitting ? '提交中...' : '确认重置'}
          </button>
        </div>
      </form>
    </Modal>
  );
});

AdminResetPasswordDialog.displayName = 'AdminResetPasswordDialog';
