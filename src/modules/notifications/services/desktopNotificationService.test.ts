import { describe, expect, it, vi } from 'vitest';
import { createDemoSnapshot } from '../../demo';
import {
  createDesktopNotificationService,
  type DesktopNotificationAdapter,
} from './desktopNotificationService';

function adapter(permission: NotificationPermission = 'granted'): DesktopNotificationAdapter {
  return {
    permission: vi.fn(async () => permission),
    send: vi.fn(async () => undefined),
  };
}

describe('desktop notification service', () => {
  it('sends configured waiting, completed, and failure events', async () => {
    const snapshot = createDemoSnapshot();
    const native = adapter();
    const service = createDesktopNotificationService(native);

    await expect(
      service.notify(snapshot.notifications[0], snapshot.notificationSettings),
    ).resolves.toBe('sent');
    expect(native.send).toHaveBeenCalledWith(snapshot.notifications[0]);
  });

  it('does not request permission for disabled event rules', async () => {
    const snapshot = createDemoSnapshot();
    const native = adapter();
    const service = createDesktopNotificationService(native);

    await expect(
      service.notify(
        { ...snapshot.notifications[0], event: 'completed' },
        { ...snapshot.notificationSettings, notifyOnCompleted: false },
      ),
    ).resolves.toBe('disabled');
    expect(native.permission).not.toHaveBeenCalled();
  });

  it('keeps app notifications available when desktop permission is denied', async () => {
    const snapshot = createDemoSnapshot();
    const native = adapter('denied');
    const service = createDesktopNotificationService(native);

    await expect(
      service.notify(snapshot.notifications[1], snapshot.notificationSettings),
    ).resolves.toBe('denied');
    expect(native.send).not.toHaveBeenCalled();
  });

  it('suppresses desktop events outside the three configured rule groups', async () => {
    const snapshot = createDemoSnapshot();
    const native = adapter();
    const service = createDesktopNotificationService(native);

    await expect(
      service.notify(
        { ...snapshot.notifications[0], event: 'agent_started' },
        snapshot.notificationSettings,
      ),
    ).resolves.toBe('disabled');
    await expect(
      service.notify(snapshot.notifications[0], {
        ...snapshot.notificationSettings,
        desktopEnabled: false,
      }),
    ).resolves.toBe('disabled');
    expect(native.permission).not.toHaveBeenCalled();
  });
});
