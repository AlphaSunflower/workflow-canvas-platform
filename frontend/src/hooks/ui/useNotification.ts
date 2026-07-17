import { useCallback, useMemo, useState } from 'react';
import { createModuleLogger, generateUUID } from '@/utils';

const log = createModuleLogger('useNotification');

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
  isRead: boolean;
  timestamp: number;
}

export type NotificationType = Notification['type'];

export interface UseNotificationOptions {
  maxVisible?: number;
  defaultDuration?: number;
  onNotificationShow?: (notification: Notification) => void;
  onNotificationHide?: (notificationId: string) => void;
}

export interface UseNotificationReturn {
  notifications: Notification[];
  visibleNotifications: Notification[];
  hasNotifications: boolean;
  unreadCount: number;
  show: (type: NotificationType, title: string, message?: string, options?: Partial<Notification>) => string;
  showSuccess: (title: string, message?: string) => string;
  showError: (title: string, message?: string) => string;
  showWarning: (title: string, message?: string) => string;
  showInfo: (title: string, message?: string) => string;
  hide: (notificationId: string) => void;
  hideAll: () => void;
  markAsRead: (notificationId: string) => void;
  markAllAsRead: () => void;
  remove: (notificationId: string) => void;
  clear: () => void;
  getNotification: (notificationId: string) => Notification | undefined;
}

const DEFAULT_MAX_VISIBLE = 5;
const DEFAULT_DURATION = 5000;

export function useNotification(options: UseNotificationOptions = {}): UseNotificationReturn {
  const { maxVisible = DEFAULT_MAX_VISIBLE, defaultDuration = DEFAULT_DURATION, onNotificationShow, onNotificationHide } = options;
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const hide = useCallback((notificationId: string): void => {
    setNotifications((prev) => prev.filter((notification) => notification.id !== notificationId));
    onNotificationHide?.(notificationId);
    log.debug('hide', `Notification hidden: ${notificationId}`);
  }, [onNotificationHide]);

  const show = useCallback((type: NotificationType, title: string, message?: string, notificationOptions?: Partial<Notification>): string => {
    const id = generateUUID();
    const now = Date.now();
    const notification: Notification = {
      id,
      type,
      title,
      message,
      duration: notificationOptions?.duration ?? defaultDuration,
      isRead: false,
      timestamp: now,
    };

    setNotifications((prev) => [notification, ...prev]);
    onNotificationShow?.(notification);
    log.debug('show', `Notification shown: ${title}`);

    if (notification.duration && notification.duration > 0) {
      setTimeout(() => {
        hide(id);
      }, notification.duration);
    }

    return id;
  }, [defaultDuration, hide, onNotificationShow]);

  const hideAll = useCallback((): void => {
    setNotifications([]);
    log.debug('hideAll', 'All notifications hidden');
  }, []);

  const showSuccess = useCallback((title: string, message?: string): string => show('success', title, message), [show]);
  const showError = useCallback((title: string, message?: string): string => show('error', title, message), [show]);
  const showWarning = useCallback((title: string, message?: string): string => show('warning', title, message), [show]);
  const showInfo = useCallback((title: string, message?: string): string => show('info', title, message), [show]);

  const markAsRead = useCallback((notificationId: string): void => {
    setNotifications((prev) => prev.map((notification) => notification.id === notificationId ? { ...notification, isRead: true } : notification));
  }, []);

  const markAllAsRead = useCallback((): void => {
    setNotifications((prev) => prev.map((notification) => ({ ...notification, isRead: true })));
  }, []);

  const remove = useCallback((notificationId: string): void => {
    setNotifications((prev) => prev.filter((notification) => notification.id !== notificationId));
  }, []);

  const clear = useCallback((): void => {
    setNotifications([]);
  }, []);

  const getNotification = useCallback((notificationId: string): Notification | undefined => {
    return notifications.find((notification) => notification.id === notificationId);
  }, [notifications]);

  const visibleNotifications = useMemo(() => notifications.slice(0, maxVisible), [notifications, maxVisible]);
  const unreadCount = useMemo(() => notifications.filter((notification) => !notification.isRead).length, [notifications]);

  return useMemo(() => ({
    notifications,
    visibleNotifications,
    hasNotifications: notifications.length > 0,
    unreadCount,
    show,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    hide,
    hideAll,
    markAsRead,
    markAllAsRead,
    remove,
    clear,
    getNotification,
  }), [notifications, visibleNotifications, unreadCount, show, showSuccess, showError, showWarning, showInfo, hide, hideAll, markAsRead, markAllAsRead, remove, clear, getNotification]);
}
