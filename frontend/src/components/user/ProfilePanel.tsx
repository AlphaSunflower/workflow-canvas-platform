import { memo, useCallback, useEffect, useState } from 'react';

import { usersApi } from '@/api/services/users-api';
import type { AppError, AuthUserProfile } from '@/types';

interface ProfilePanelProps {
  user: AuthUserProfile;
  busy: boolean;
  onProfileUpdated: (user: AuthUserProfile) => void;
  onError: (error: AppError | null) => void;
}

export const ProfilePanel = memo(({
  user,
  busy,
  onProfileUpdated,
  onError,
}: ProfilePanelProps) => {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(user.displayName);
    setEmail(user.email);
  }, [user.displayName, user.email]);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    onError(null);

    const result = await usersApi.updateCurrent({
      displayName: displayName.trim(),
      email: email.trim(),
    });

    setSubmitting(false);

    if (!result.success) {
      onError(result.error);
      return;
    }

    onProfileUpdated(result.data.user);
    setNotice('个人资料已更新。');
  }, [displayName, email, onError, onProfileUpdated]);

  return (
    <section className="user-management-modal__section">
      <div className="user-management-modal__intro">
        <h3>个人资料</h3>
        <p>可以修改当前账户的显示名称和邮箱，角色与状态由后端账户体系决定。</p>
      </div>

      <div className="user-management-modal__profile">
        <div className="user-management-modal__avatar" aria-hidden="true">
          {user.displayName.slice(0, 1).toUpperCase()}
        </div>

        <div className="user-management-modal__details">
          <div className="user-management-modal__item">
            <span className="user-management-modal__item-label">角色</span>
            <span className="user-management-modal__item-value">{user.role}</span>
          </div>
          <div className="user-management-modal__item">
            <span className="user-management-modal__item-label">状态</span>
            <span className="user-management-modal__item-value">{user.status}</span>
          </div>
          <div className="user-management-modal__item">
            <span className="user-management-modal__item-label">最近登录</span>
            <span className="user-management-modal__item-value">{user.lastLoginAt ?? '暂无'}</span>
          </div>
        </div>
      </div>

      <form className="user-management-modal__form" onSubmit={(event) => { void handleSubmit(event); }}>
        <label className="user-management-modal__field">
          <span>显示名称</span>
          <input
            className="input"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={busy || submitting}
            required
          />
        </label>

        <label className="user-management-modal__field">
          <span>邮箱</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy || submitting}
            required
          />
        </label>

        {notice ? (
          <div className="user-management-modal__notice user-management-modal__notice--success" role="status">
            {notice}
          </div>
        ) : null}

        <div className="user-management-modal__actions">
          <button className="btn btn--primary" type="submit" disabled={busy || submitting}>
            {submitting ? '保存中...' : '保存资料'}
          </button>
        </div>
      </form>
    </section>
  );
});

ProfilePanel.displayName = 'ProfilePanel';
