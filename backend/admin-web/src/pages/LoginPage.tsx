import { FormEvent, useEffect, useState } from "react";
import { adminApi, ApiClientError, type AuthUserProfile } from "../api/admin-api.ts";

interface LoginPageProps {
  initialError: string | null;
  onLogin: (user: AuthUserProfile) => void;
}

function getLoginError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return "邮箱或密码不正确。";
    }

    return error.message;
  }

  return error instanceof Error ? error.message : "登录失败。";
}

export function LoginPage({ initialError, onLogin }: LoginPageProps): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  useEffect(() => {
    setError(initialError);
  }, [initialError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await adminApi.login({ email, password });
      if (result.user.role !== "admin") {
        adminApi.clearStoredSession();
        setError("当前账号不是 admin，无法访问中台。");
        return;
      }

      onLogin(result.user);
    } catch (requestError) {
      setError(getLoginError(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div className="login-brand">
          <div className="brand-mark large">NW</div>
          <div>
            <h1>中台管理</h1>
            <p>只读运营排查面板</p>
          </div>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            <span>邮箱</span>
            <input
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
            />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary-button" disabled={submitting} type="submit">
            {submitting ? "登录中" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}
