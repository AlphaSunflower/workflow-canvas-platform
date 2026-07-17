import { memo, useEffect, useMemo, useState } from 'react';

import type { AppError, AuthUserProfile, UserItemResponseData } from '@/types';
import { useAuth } from '@/auth';
import { Modal } from '../ui';
import { AdminCreateUserForm } from './AdminCreateUserForm';
import { AdminResetPasswordDialog } from './AdminResetPasswordDialog';
import { AdminUserList } from './AdminUserList';
import { ChangePasswordForm } from './ChangePasswordForm';
import { LoginForm } from './LoginForm';
import { ProfilePanel } from './ProfilePanel';
import { RegisterForm } from './RegisterForm';

type AuthPanelMode = 'login' | 'register';

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UserManagementModal = memo(({
  isOpen,
  onClose,
}: UserManagementModalProps) => {
  const {
    status,
    user,
    login,
    register,
    logout,
    clearSession,
    error,
    clearError,
    isBusy,
  } = useAuth();
  const [mode, setMode] = useState<AuthPanelMode>('login');
  const [profileUser, setProfileUser] = useState<AuthUserProfile | null>(user);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<AppError | null>(null);
  const [adminRefreshKey, setAdminRefreshKey] = useState(0);
  const [resetTargetUser, setResetTargetUser] = useState<UserItemResponseData | null>(null);

  useEffect(() => {
    setProfileUser(user);
  }, [user]);

  useEffect(() => {
    if (!isOpen) {
      clearError();
      setLocalError(null);
      setMode('login');
      setSessionNotice(null);
      setResetTargetUser(null);
    }
  }, [clearError, isOpen]);

  const isAuthenticated = status === 'authenticated' && profileUser !== null;
  const isAdmin = isAuthenticated && profileUser?.role === 'admin';
  const statusText = useMemo(() => {
    if (status === 'restoring') {
      return '正在恢复上次会话...';
    }

    if (status === 'refreshing') {
      return isAuthenticated ? '正在同步账户状态...' : '正在提交账户请求...';
    }

    return null;
  }, [isAuthenticated, status]);

  const handleLogin = async (request: Parameters<typeof login>[0]): Promise<void> => {
    const result = await login(request);
    if (result.success) {
      setSessionNotice(null);
      setLocalError(null);
      onClose();
    }
  };

  const handleRegister = async (request: Parameters<typeof register>[0]): Promise<void> => {
    const result = await register(request);
    if (result.success) {
      setSessionNotice(null);
      setLocalError(null);
      onClose();
    }
  };

  const handleLogout = async (): Promise<void> => {
    await logout();
    setSessionNotice(null);
    setLocalError(null);
    onClose();
  };

  const handlePasswordChanged = (revokedSessionCount: number): void => {
    clearSession();
    clearError();
    setLocalError(null);
    setProfileUser(null);
    setMode('login');
    setSessionNotice(`密码已修改，原会话已失效（撤销 ${revokedSessionCount} 个会话），请重新登录。`);
  };

  const visibleError = localError ?? error;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="账户中心"
        size={isAdmin ? 'xl' : 'sm'}
      >
        <div className="user-management-modal">
          {statusText ? (
            <div className="user-management-modal__notice user-management-modal__notice--info" role="status">
              {statusText}
            </div>
          ) : null}

          {sessionNotice ? (
            <div className="user-management-modal__notice user-management-modal__notice--success" role="status">
              {sessionNotice}
            </div>
          ) : null}

          {isAuthenticated && profileUser ? (
            <>
              <ProfilePanel
                user={profileUser}
                busy={isBusy}
                onProfileUpdated={(nextUser) => {
                  clearError();
                  setLocalError(null);
                  setSessionNotice(null);
                  setProfileUser(nextUser);
                }}
                onError={setLocalError}
              />

              <ChangePasswordForm
                busy={isBusy}
                onError={setLocalError}
                onPasswordChanged={handlePasswordChanged}
              />

              {isAdmin ? (
                <>
                  <AdminCreateUserForm
                    onCreated={(createdUser) => {
                      setLocalError(null);
                      setSessionNotice(`已创建用户 ${createdUser.displayName}。`);
                      setAdminRefreshKey((current) => current + 1);
                    }}
                    onError={setLocalError}
                  />

                  <AdminUserList
                    refreshKey={adminRefreshKey}
                    onError={setLocalError}
                    onResetPassword={(targetUser) => {
                      setLocalError(null);
                      setResetTargetUser(targetUser);
                    }}
                  />
                </>
              ) : null}

              {visibleError ? (
                <div className="user-management-modal__notice user-management-modal__notice--error" role="alert">
                  {visibleError.message}
                </div>
              ) : null}

              <div className="user-management-modal__actions">
                <button className="btn btn--secondary" type="button" onClick={onClose} disabled={isBusy}>
                  关闭
                </button>
                <button className="btn btn--danger" type="button" onClick={() => { void handleLogout(); }} disabled={isBusy}>
                  {isBusy ? '处理中...' : '退出登录'}
                </button>
              </div>
            </>
          ) : mode === 'login' ? (
            <LoginForm
              busy={isBusy}
              error={visibleError}
              onSubmit={handleLogin}
              onSwitchToRegister={() => {
                clearError();
                setLocalError(null);
                setMode('register');
              }}
            />
          ) : (
            <RegisterForm
              busy={isBusy}
              error={visibleError}
              onSubmit={handleRegister}
              onSwitchToLogin={() => {
                clearError();
                setLocalError(null);
                setMode('login');
              }}
            />
          )}
        </div>
      </Modal>

      <AdminResetPasswordDialog
        user={resetTargetUser}
        isOpen={resetTargetUser !== null}
        onClose={() => setResetTargetUser(null)}
        onError={setLocalError}
        onSuccess={(message) => {
          setSessionNotice(message);
          setAdminRefreshKey((current) => current + 1);
        }}
      />
    </>
  );
});

UserManagementModal.displayName = 'UserManagementModal';
