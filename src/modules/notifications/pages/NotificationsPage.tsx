import { AlertTriangle, ArrowUpRight, CheckCircle2, Info, Trash2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AppNotification } from '../../../core/contracts/notifications';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import {
  clearReadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationTargetPath,
} from '../model/notificationTransitions';

const toneIcons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;

function notificationTime(timestamp: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const { snapshot, saveSnapshot, saving } = useWorkbench();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [error, setError] = useState<string | null>(null);
  const sorted = useMemo(
    () =>
      [...(snapshot?.notifications ?? [])].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    [snapshot?.notifications],
  );
  const unread = sorted.filter((notification) => !notification.read);
  const visible = filter === 'unread' ? unread : sorted;

  if (!snapshot) return <div className="notifications-state">Loading notifications...</div>;
  const projects = new Map(snapshot.projects.map((project) => [project.id, project.name]));
  const sessions = new Map(snapshot.sessions.map((session) => [session.id, session.title]));

  async function persist(next: WorkbenchSnapshot) {
    try {
      setError(null);
      await saveSnapshot(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Notifications could not be updated.');
    }
  }

  async function openNotification(notification: AppNotification) {
    const target = notificationTargetPath(notification.target);
    if (!notification.read) {
      await persist(markNotificationRead(snapshot!, notification.id));
    }
    if (target) void navigate(target);
  }

  return (
    <div className="notifications-page">
      <header className="notifications-header">
        <div>
          <p className="eyebrow">Activity inbox</p>
          <h1>Notifications</h1>
        </div>
        <strong>{unread.length} unread</strong>
      </header>

      <div className="notifications-toolbar">
        <div className="notification-filters" role="tablist" aria-label="Notification filters">
          <button role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>
            All {sorted.length}
          </button>
          <button
            role="tab"
            aria-selected={filter === 'unread'}
            onClick={() => setFilter('unread')}
          >
            Unread {unread.length}
          </button>
        </div>
        <div>
          <button
            className="button button--compact"
            disabled={saving || unread.length === 0}
            onClick={() => void persist(markAllNotificationsRead(snapshot))}
          >
            <CheckCircle2 size={15} aria-hidden="true" />
            Mark all read
          </button>
          <button
            className="button button--compact"
            disabled={saving || !sorted.some((notification) => notification.read)}
            onClick={() => void persist(clearReadNotifications(snapshot))}
          >
            <Trash2 size={15} aria-hidden="true" />
            Clear read
          </button>
        </div>
      </div>

      {error && (
        <div className="notifications-error" role="alert">
          {error}
        </div>
      )}

      <section className="notifications-list" aria-label="Notification history">
        {visible.map((notification) => {
          const Icon = toneIcons[notification.tone];
          return (
            <article
              className={`notification-item notification-item--${notification.tone}${notification.read ? '' : ' notification-item--unread'}`}
              key={notification.id}
            >
              <div className="notification-item__icon">
                <Icon size={18} aria-hidden="true" />
              </div>
              <div className="notification-item__body">
                <header>
                  <div>
                    <h2>{notification.title}</h2>
                    {!notification.read && <span>Unread</span>}
                  </div>
                  <time dateTime={notification.createdAt}>
                    {notificationTime(notification.createdAt)}
                  </time>
                </header>
                <p>{notification.message}</p>
                <footer>
                  <span>{projects.get(notification.projectId ?? '') ?? 'Workspace'}</span>
                  {notification.sessionId && (
                    <span>{sessions.get(notification.sessionId) ?? 'Unknown Session'}</span>
                  )}
                  <span>{notification.event.replaceAll('_', ' ')}</span>
                </footer>
              </div>
              <button
                className="icon-button"
                aria-label={`Open ${notification.title}`}
                disabled={saving}
                onClick={() => void openNotification(notification)}
              >
                <ArrowUpRight size={18} aria-hidden="true" />
              </button>
            </article>
          );
        })}
        {visible.length === 0 && (
          <div className="notifications-empty">
            <CheckCircle2 size={24} aria-hidden="true" />
            <strong>{filter === 'unread' ? 'No unread notifications' : 'No notifications'}</strong>
            <Link className="button button--secondary" to="/command-center">
              Open Command Center
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
