import type { AppNotification } from './notificationService';
import { resolveNotificationPath } from './notificationRoutes';

/** Navigation must never wait for a network write to the read receipt. */
export function openNotificationImmediately(
  notification: AppNotification,
  open: (path: string) => void,
  markRead: (id: string) => Promise<unknown>,
  onReadError: (error: unknown) => void = error => console.warn('Notification read receipt failed:', error),
): void {
  const path = resolveNotificationPath(notification);
  if (path) open(path);
  if (!notification.isRead) void Promise.resolve().then(() => markRead(notification.id)).catch(onReadError);
}
