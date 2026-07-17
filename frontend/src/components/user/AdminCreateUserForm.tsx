import { memo, useCallback, useState } from 'react';

import { usersApi } from '@/api/services/users-api';
import type { AccountRole, AppError, UserItemResponseData } from '@/types';

interface AdminCreateUserFormProps {
  onCreated: (user: UserItemResponseData) => void;
  onError: (error: AppError | null) => void;
}

export const AdminCreateUserForm = memo(({
  onCreated,
  onError,
}: AdminCreateUserFormProps) => {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AccountRole>('member');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    onError(null);

    const result = await usersApi.create({
      displayName: displayName.trim(),
      email: email.trim(),
      password,
      role,
      status: 'enabled',
    });

    setSubmitting(false);

    if (!result.success) {
      onError(result.error);
      return;
    }

    setDisplayName('');
    setEmail('');
    setPassword('');
    setRole('member');
    onCreated(result.data.user);
  }, [displayName, email, onCreated, onError, password, role]);

  return (
    <section className="user-management-modal__section">
      <div className="user-management-modal__intro">
        <h3>创建用户</h3>
        <p>管理员可以直接创建新账户，并指定初始角色。</p>
      </div>

      <form className="user-management-modal__form" onSubmit={(event) => { void handleSubmit(event); }}>
        <label className="user-management-modal__field">
          <span>显示名称</span>
          <input className="input" type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required disabled={submitting} />
        </label>

        <label className="user-management-modal__field">
          <span>邮箱</span>
          <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={submitting} />
        </label>

        <label className="user-management-modal__field">
          <span>初始密码</span>
          <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={submitting} />
        </label>

        <label className="user-management-modal__field">
          <span>角色</span>
          <select className="input" value={role} onChange={(event) => setRole(event.target.value as AccountRole)} disabled={submitting}>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </label>

        <div className="user-management-modal__actions">
          <button className="btn btn--primary" type="submit" disabled={submitting}>
            {submitting ? '创建中...' : '创建用户'}
          </button>
        </div>
      </form>
    </section>
  );
});

AdminCreateUserForm.displayName = 'AdminCreateUserForm';
