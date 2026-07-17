import React, { memo, useCallback, useState } from 'react';

import type { AppError, LoginRequest } from '@/types';

interface LoginFormProps {
  busy: boolean;
  error: AppError | null;
  onSubmit: (request: LoginRequest) => Promise<void>;
  onSwitchToRegister: () => void;
}

export const LoginForm = memo(({
  busy,
  error,
  onSubmit,
  onSwitchToRegister,
}: LoginFormProps) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await onSubmit({
      email: email.trim(),
      password,
    });
  }, [email, onSubmit, password]);

  return (
    <form className="user-management-modal__form" onSubmit={(event) => { void handleSubmit(event); }}>
      <div className="user-management-modal__intro">
        <h3>登录账户</h3>
        <p>输入邮箱和密码，使用后端真实认证接口建立当前会话。</p>
      </div>

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
          placeholder="请输入密码"
          autoComplete="current-password"
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
        <button className="btn btn--ghost" type="button" onClick={onSwitchToRegister} disabled={busy}>
          去注册
        </button>
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? '提交中...' : '登录'}
        </button>
      </div>
    </form>
  );
});

LoginForm.displayName = 'LoginForm';
