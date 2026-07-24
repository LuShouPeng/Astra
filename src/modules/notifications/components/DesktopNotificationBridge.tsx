import { useEffect } from 'react';
import { appEventBus } from '../../../core/events/appEventBus';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import type { DesktopNotificationService } from '../services/desktopNotificationService';

export function DesktopNotificationBridge({ service }: { service: DesktopNotificationService }) {
  const { snapshot } = useWorkbench();

  useEffect(() => {
    if (!snapshot) return;
    return appEventBus.subscribe('notification:created', (notification) => {
      void service.notify(notification, snapshot.notificationSettings);
    });
  }, [service, snapshot]);

  return null;
}
