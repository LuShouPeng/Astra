import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../../demo';
import {
  clearReadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationTargetPath,
} from './notificationTransitions';

describe('notification transitions', () => {
  it('marks one or all notifications read without mutating the source snapshot', () => {
    const snapshot = createDemoSnapshot();
    const one = markNotificationRead(snapshot, 'notification-frontend-waiting');
    const all = markAllNotificationsRead(snapshot);

    expect(one.notifications[0].read).toBe(true);
    expect(one.notifications[1].read).toBe(false);
    expect(all.notifications.every((notification) => notification.read)).toBe(true);
    expect(snapshot.notifications.every((notification) => !notification.read)).toBe(true);
  });

  it('clears only notifications already marked read', () => {
    const snapshot = markNotificationRead(createDemoSnapshot(), 'notification-frontend-waiting');
    const next = clearReadNotifications(snapshot);

    expect(next.notifications.map((notification) => notification.id)).toEqual([
      'notification-frontend-failed',
    ]);
  });

  it('resolves every typed target to an application route', () => {
    expect(notificationTargetPath({ page: 'session', sessionId: 'session-1' })).toBe(
      '/sessions/session-1',
    );
    expect(notificationTargetPath({ page: 'changes', sessionId: 'session-1' })).toBe(
      '/changes?session=session-1',
    );
    expect(notificationTargetPath({ page: 'attention' })).toBe('/attention');
    expect(notificationTargetPath({ page: 'project', projectId: 'project-1' })).toBe(
      '/projects/project-1',
    );
    expect(notificationTargetPath(undefined)).toBeNull();
    expect(notificationTargetPath({ page: 'session' })).toBeNull();
    expect(notificationTargetPath({ page: 'changes' })).toBe('/changes');
    expect(notificationTargetPath({ page: 'project' })).toBe('/projects');
  });

  it('rejects unknown notification identifiers', () => {
    expect(() => markNotificationRead(createDemoSnapshot(), 'missing')).toThrow(
      'The notification could not be found.',
    );
  });
});
