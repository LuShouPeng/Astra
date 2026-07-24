import type { NotificationId, NotificationTarget } from '../../../core/contracts/notifications';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';

export function markNotificationRead(
  snapshot: WorkbenchSnapshot,
  notificationId: NotificationId,
): WorkbenchSnapshot {
  if (!snapshot.notifications.some((notification) => notification.id === notificationId)) {
    throw new Error('The notification could not be found.');
  }
  return {
    ...snapshot,
    notifications: snapshot.notifications.map((notification) =>
      notification.id === notificationId ? { ...notification, read: true } : notification,
    ),
  };
}

export function markAllNotificationsRead(snapshot: WorkbenchSnapshot): WorkbenchSnapshot {
  return {
    ...snapshot,
    notifications: snapshot.notifications.map((notification) => ({
      ...notification,
      read: true,
    })),
  };
}

export function clearReadNotifications(snapshot: WorkbenchSnapshot): WorkbenchSnapshot {
  return {
    ...snapshot,
    notifications: snapshot.notifications.filter((notification) => !notification.read),
  };
}

export function notificationTargetPath(target: NotificationTarget | undefined): string | null {
  if (!target) return null;
  switch (target.page) {
    case 'session':
      return target.sessionId ? `/sessions/${target.sessionId}` : null;
    case 'changes':
      return target.sessionId ? `/changes?session=${target.sessionId}` : '/changes';
    case 'attention':
      return '/attention';
    case 'project':
      return target.projectId ? `/projects/${target.projectId}` : '/projects';
  }
}
