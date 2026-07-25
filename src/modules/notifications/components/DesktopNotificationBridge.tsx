import { useEffect } from 'react';
import { appEventBus } from '../../../core/events/appEventBus';
import { useI18n } from '../../../core/i18n/I18nContext';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import type { DesktopNotificationService } from '../services/desktopNotificationService';

export function DesktopNotificationBridge({ service }: { service: DesktopNotificationService }) {
  const { text } = useI18n();
  const { snapshot } = useWorkbench();

  useEffect(() => {
    if (!snapshot) return;
    return appEventBus.subscribe('notification:created', (notification) => {
      void service.notify(
        {
          ...notification,
          title: text(notification.title),
          message: text(notification.message),
        },
        snapshot.notificationSettings,
      );
    });
  }, [service, snapshot, text]);

  return null;
}
