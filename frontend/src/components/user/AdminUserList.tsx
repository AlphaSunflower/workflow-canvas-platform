import { memo, useEffect, useState } from 'react';

import { usersApi } from '@/api/services/users-api';
import type { AppError, UserItemResponseData } from '@/types';
import { AdminUserStatusToggle } from './AdminUserStatusToggle';

interface AdminUserListProps {
  onError: (error: AppError | null) => void;
  onResetPassword: (user: UserItemResponseData) => void;
  refreshKey?: number;
}

export const AdminUserList = memo(({
  onError,
  onResetPassword,
  refreshKey = 0,
}: AdminUserListProps) => {
  const [users, setUsers] = useState<UserItemResponseData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const run = async (): Promise<void> => {
      setLoading(true);
      onError(null);

      const result = await usersApi.list();
      if (!active) {
        return;
      }

      setLoading(false);

      if (!result.success) {
        onError(result.error);
        return;
      }

      setUsers(result.data.items);
    };

    void run();

    return (): void => {
      active = false;
    };
  }, [onError, refreshKey]);

  return (
    <section className="user-management-modal__section">
      <div className="user-management-modal__intro">
        <h3>用户列表</h3>
        <p>展示当前账户、角色、状态和最近登录时间，管理员可直接执行禁用与重置密码。</p>
      </div>

      <div className="user-management-modal__admin-list">
        {loading ? (
          <div className="user-management-modal__notice user-management-modal__notice--info">正在加载用户列表...</div>
        ) : users.length === 0 ? (
          <div className="user-management-modal__notice user-management-modal__notice--info">暂无用户数据。</div>
        ) : users.map((item) => (
          <div key={item.userId} className="user-management-modal__admin-row">
            <div className="user-management-modal__admin-summary">
              <strong>{item.displayName}</strong>
              <span>{item.email}</span>
              <span>{item.role} · {item.status}</span>
              <span>最后登录：{item.lastLoginAt ?? '暂无'}</span>
            </div>

            <div className="user-management-modal__admin-actions">
              <AdminUserStatusToggle
                user={item}
                onChanged={(nextUser) => {
                  setUsers((current) => current.map((user) => (
                    user.userId === nextUser.userId ? nextUser : user
                  )));
                }}
                onError={onError}
              />
              <button className="btn btn--ghost" type="button" onClick={() => onResetPassword(item)}>
                重置密码
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
});

AdminUserList.displayName = 'AdminUserList';
