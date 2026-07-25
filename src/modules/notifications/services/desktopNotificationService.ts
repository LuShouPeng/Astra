import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import type {
  AppNotification,
  NotificationEvent,
  NotificationSettings,
} from '../../../core/contracts/notifications';

export type DesktopNotificationResult = 'sent' | 'disabled' | 'denied';

export interface DesktopNotificationAdapter {
  permission(): Promise<NotificationPermission>;
  send(notification: AppNotification): Promise<void>;
}

export interface DesktopNotificationService {
  notify(
    notification: AppNotification,
    settings: NotificationSettings,
  ): Promise<DesktopNotificationResult>;
}

export class TauriDesktopNotificationAdapter implements DesktopNotificationAdapter {
  async permission(): Promise<NotificationPermission> {
    if (await isPermissionGranted()) return 'granted';
    return await requestPermission();
  }

  send(notification: AppNotification): Promise<void> {
    sendNotification({ title: notification.title, body: notification.message });
    return Promise.resolve();
  }
}

function eventEnabled(event: NotificationEvent, settings: NotificationSettings): boolean {
  switch (event) {
    case 'waiting_input':
    case 'waiting_approval':
      return settings.notifyOnWaiting;
    case 'completed':
      return settings.notifyOnCompleted;
    case 'failed':
    case 'test_failed':
      return settings.notifyOnFailed;
    case 'agent_started':
    case 'review_requested':
      return false;
  }
}

export function createDesktopNotificationService(
  adapter: DesktopNotificationAdapter,
): DesktopNotificationService {
  return {
    async notify(notification, settings) {
      if (!settings.desktopEnabled || !eventEnabled(notification.event, settings)) {
        return 'disabled';
      }
      if ((await adapter.permission()) !== 'granted') return 'denied';
      await adapter.send(notification);
      return 'sent';
    },
  };
}
