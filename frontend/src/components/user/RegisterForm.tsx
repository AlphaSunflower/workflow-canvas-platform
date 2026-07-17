import React, { memo, useCallback, useState } from 'react';

import type { AppError, RegisterRequest } from '@/types';

interface RegisterFormProps {
  busy: boolean;
  error: AppError | null;
  onSubmit: (request: RegisterRequest) => Promise<void>;
  onSwitchToLogin: () => void;
}

export const RegisterForm = memo(({
  busy,
  error,
  onSubmit,
  onSwitchToLogin,
}: RegisterFormProps) => {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await onSubmit({
      displayName: displayName.trim(),
      email: email.trim(),
      password,
    });
  }, [displayName, email, onSubmit, password]);

  return (
    <form className="user-management-modal__form" onSubmit={(event) => { void handleSubmit(event); }}>
      <div className="user-management-modal__intro">
        <h3>注册账户</h3>
        <p>创建真实用户后会直接建立登录态，并接入统一认证上下文。</p>
      </div>

      <label className="user-management-modal__field">
        <span>显示名称</span>
        <input
          className="input"
          type="text"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="输入你的显示名称"
          autoComplete="name"
          disabled={busy}
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
          placeholder="demo@example.com"
          autoComplete="email"
          disabled={busy}
          required
        />
      </label>

      <label className="user-management-modal__field">
        <span>密码</span>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="至少输入一组安全密码"
          autoComplete="new-password"
          disabled={busy}
          required
        />
      </label>

      {error ? (
        <div className="user-management-modal__notice user-management-modal__notice--error" role="alert">
          {error.message}
        </div>
      ) : null}

      <div className="user-management-modal__actions">
        <button className="btn btn--ghost" type="button" onClick={onSwitchToLogin} disabled={busy}>
          去登录
        </button>
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? '提交中...' : '注册并登录'}
        </button>
      </div>
    </form>
  );
});

RegisterForm.displayName = 'RegisterForm';
