import React, { memo, useCallback } from 'react';

import { shouldIgnoreGlobalKeyboardShortcut } from '@/utils';

interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
  icon?: React.ReactNode;
}

export const Button = memo<ButtonProps>(({ children, variant = 'primary', size = 'md', disabled = false, loading = false, onClick, className = '', title, icon }): JSX.Element => {
  const baseClasses = 'btn';
  const variantClasses = `btn--${variant}`;
  const sizeClasses = `btn--${size}`;
  const disabledClasses = disabled || loading ? 'btn--disabled' : '';

  return (
    <button className={`${baseClasses} ${variantClasses} ${sizeClasses} ${disabledClasses} ${className}`.trim()} disabled={disabled || loading} onClick={onClick} title={title}>
      {loading ? <span className="spinner spinner--sm" /> : <>{icon}{children}</>}
    </button>
  );
});
Button.displayName = 'Button';

interface IconButtonProps {
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
  className?: string;
}

export const IconButton = memo<IconButtonProps>(({ icon, onClick, disabled = false, active = false, size = 'md', title, className = '' }): JSX.Element => {
  const baseClasses = 'icon-btn';
  const sizeClasses = `icon-btn--${size}`;
  const activeClasses = active ? 'icon-btn--active' : '';

  return <button className={`${baseClasses} ${sizeClasses} ${activeClasses} ${className}`.trim()} disabled={disabled} onClick={onClick} title={title}>{icon}</button>;
});
IconButton.displayName = 'IconButton';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
}

export const Modal = memo<ModalProps>(({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  footer,
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
}): JSX.Element | null => {
  const handleBackdropClick = useCallback((event: React.MouseEvent): void => {
    if (closeOnBackdrop && event.target === event.currentTarget) {
      onClose();
    }
  }, [closeOnBackdrop, onClose]);

  React.useEffect((): (() => void) => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  React.useEffect((): (() => void) => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (shouldIgnoreGlobalKeyboardShortcut(event)) {
        return;
      }

      if (closeOnEscape && event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeOnEscape, isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal__backdrop" onClick={handleBackdropClick}>
      <div className={`modal modal--${size}`}>
        {title && (
          <div className="modal__header">
            <h2 className="modal__title">{title}</h2>
            {showCloseButton ? (
              <button className="modal__close" onClick={onClose}>×</button>
            ) : null}
          </div>
        )}
        <div className="modal__content custom-scrollbar">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
});
Modal.displayName = 'Modal';

interface NotificationProps {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  onClose: () => void;
}

const notificationIcons: Record<NotificationProps['type'], string> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
};

export const Notification = memo<NotificationProps>(({ type, title, message, onClose }): JSX.Element => {
  return (
    <div className={`notification notification--${type} animate-slide-up`}>
      <span className="notification__icon">{notificationIcons[type]}</span>
      <div className="notification__content">
        <div className="notification__title">{title}</div>
        {message && <div className="notification__message">{message}</div>}
      </div>
      <button className="notification__close" onClick={onClose}>×</button>
    </div>
  );
});
Notification.displayName = 'Notification';

interface NotificationItem {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
}

interface NotificationContainerProps {
  notifications: NotificationItem[];
  onHide: (id: string) => void;
  className?: string;
}

export const NotificationContainer = memo<NotificationContainerProps>(({ notifications, onHide, className }): JSX.Element => {
  const containerClassName = ['notification-container', className].filter(Boolean).join(' ');

  return <div className={containerClassName}>{notifications.map((notification) => <Notification key={notification.id} id={notification.id} type={notification.type} title={notification.title} message={notification.message} onClose={() => onHide(notification.id)} />)}</div>;
});
NotificationContainer.displayName = 'NotificationContainer';
