import { memo, useMemo } from 'react';

import { useAuth } from '@/auth';
import './CanvasSideNav.css';

interface CanvasSideNavProps {
  showToolbar: boolean;
  showHints: boolean;
  showMinimap: boolean;
  showTaskHistory: boolean;
  onToggleToolbar: () => void;
  onToggleHints: () => void;
  onToggleMinimap: () => void;
  onToggleTaskHistory: () => void;
  onOpenUserManagement: () => void;
}

interface ControlButtonConfig {
  id: string;
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
  icon: JSX.Element;
}

export const CanvasSideNav = memo(({
  showToolbar,
  showHints,
  showMinimap,
  showTaskHistory,
  onToggleToolbar,
  onToggleHints,
  onToggleMinimap,
  onToggleTaskHistory,
  onOpenUserManagement,
}: CanvasSideNavProps) => {
  const { status, user, isAuthenticated } = useAuth();

  const controlButtons: ControlButtonConfig[] = [
    {
      id: 'toolbar',
      label: '工具栏',
      title: showToolbar ? '隐藏工具栏' : '显示工具栏',
      active: showToolbar,
      onClick: onToggleToolbar,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="5" rx="1.5" />
          <rect x="3" y="15" width="18" height="5" rx="1.5" />
        </svg>
      ),
    },
    {
      id: 'hints',
      label: '提示栏',
      title: showHints ? '隐藏提示栏' : '显示提示栏',
      active: showHints,
      onClick: onToggleHints,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 1 1 4 2" />
          <path d="M12 17h.01" />
        </svg>
      ),
    },
    {
      id: 'minimap',
      label: '小地图',
      title: showMinimap ? '隐藏小地图' : '显示小地图',
      active: showMinimap,
      onClick: onToggleMinimap,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 8h3v3H8z" />
          <path d="M13 13h3v3h-3z" />
        </svg>
      ),
    },
    {
      id: 'task-history',
      label: '任务历史',
      title: showTaskHistory ? '隐藏任务历史' : '显示任务历史',
      active: showTaskHistory,
      onClick: onToggleTaskHistory,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 8v5l3 2" />
          <circle cx="12" cy="12" r="9" />
          <path d="M5 5 3 7" />
          <path d="M19 5l2 2" />
        </svg>
      ),
    },
  ];

  const userBadgeText = useMemo(() => {
    if (status === 'restoring') {
      return '...';
    }

    if (status === 'refreshing') {
      return '...';
    }

    if (isAuthenticated && user) {
      return user.displayName.slice(0, 1).toUpperCase();
    }

    return '?';
  }, [isAuthenticated, status, user]);

  const userLabel = isAuthenticated && user ? user.displayName : '账户入口';
  const userMeta = status === 'restoring'
    ? '恢复中'
    : status === 'refreshing'
      ? '同步中'
      : isAuthenticated && user
        ? `${user.role} · 已登录`
        : '未登录';

  return (
    <nav className="canvas-side-nav" aria-label="画布侧边导航">
      <div className="canvas-side-nav__section">
        {controlButtons.map((button) => (
          <button
            key={button.id}
            className={[
              'canvas-side-nav__button',
              button.active ? 'canvas-side-nav__button--active' : 'canvas-side-nav__button--inactive',
            ].join(' ')}
            type="button"
            onClick={button.onClick}
            title={button.title}
            aria-pressed={button.active}
          >
            <span className="canvas-side-nav__icon" aria-hidden="true">
              {button.icon}
            </span>
            <span className="canvas-side-nav__tooltip" role="presentation">
              <span className="canvas-side-nav__tooltip-label">{button.label}</span>
              <span className="canvas-side-nav__tooltip-meta">{button.active ? '已显示' : '已隐藏'}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="canvas-side-nav__spacer" />

      <div className="canvas-side-nav__section canvas-side-nav__section--bottom">
        <button
          className={[
            'canvas-side-nav__button',
            'canvas-side-nav__button--user',
            isAuthenticated ? 'canvas-side-nav__button--user-active' : '',
          ].filter(Boolean).join(' ')}
          type="button"
          onClick={onOpenUserManagement}
          title="打开账户面板"
        >
          <span className="canvas-side-nav__user-badge" aria-hidden="true">
            {userBadgeText}
          </span>
          <span className="canvas-side-nav__tooltip" role="presentation">
            <span className="canvas-side-nav__tooltip-label">{userLabel}</span>
            <span className="canvas-side-nav__tooltip-meta">{userMeta}</span>
          </span>
        </button>
      </div>
    </nav>
  );
});

CanvasSideNav.displayName = 'CanvasSideNav';
