import { AlertTriangle, ArrowUpRight, CheckCircle2, Info, Trash2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AppNotification } from '../../../core/contracts/notifications';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { TranslationKey } from '../../../core/i18n/translations';
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

const eventKeys: Record<AppNotification['event'], TranslationKey> = {
  agent_started: 'notification.agentStarted',
  waiting_input: 'notification.waitingInput',
  waiting_approval: 'notification.waitingApproval',
  completed: 'notification.completed',
  failed: 'notification.failed',
  test_failed: 'notification.testFailed',
  review_requested: 'notification.reviewRequested',
};

function notificationTime(timestamp: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function NotificationsPage() {
  const { language, t, text } = useI18n();
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

  if (!snapshot) return <div className="notifications-state">{t('notifications.loading')}</div>;
  const projects = new Map(snapshot.projects.map((project) => [project.id, project.name]));
  const sessions = new Map(snapshot.sessions.map((session) => [session.id, session.title]));

  async function persist(next: WorkbenchSnapshot) {
    try {
      setError(null);
      await saveSnapshot(next);
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : t('notifications.updateError'));
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
          <p className="eyebrow">{t('notifications.eyebrow')}</p>
          <h1>{t('nav.notifications')}</h1>
        </div>
        <strong>{t('notifications.unreadCount', { count: unread.length })}</strong>
      </header>

      <div className="notifications-toolbar">
        <div
          className="notification-filters"
          role="tablist"
          aria-label={t('notifications.filters')}
        >
          <button role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>
            {t('notifications.all')} {sorted.length}
          </button>
          <button
            role="tab"
            aria-selected={filter === 'unread'}
            onClick={() => setFilter('unread')}
          >
            {t('notifications.unread')} {unread.length}
          </button>
        </div>
        <div>
          <button
            className="button button--compact"
            disabled={saving || unread.length === 0}
            onClick={() => void persist(markAllNotificationsRead(snapshot))}
          >
            <CheckCircle2 size={15} aria-hidden="true" />
            {t('notifications.markAllRead')}
          </button>
          <button
            className="button button--compact"
            disabled={saving || !sorted.some((notification) => notification.read)}
            onClick={() => void persist(clearReadNotifications(snapshot))}
          >
            <Trash2 size={15} aria-hidden="true" />
            {t('notifications.clearRead')}
          </button>
        </div>
      </div>

      {error && (
        <div className="notifications-error" role="alert">
          {error}
        </div>
      )}

      <section className="notifications-list" aria-label={t('notifications.history')}>
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
                    <h2>{text(notification.title)}</h2>
                    {!notification.read && <span>{t('notifications.unread')}</span>}
                  </div>
                  <time dateTime={notification.createdAt}>
                    {notificationTime(notification.createdAt, language)}
                  </time>
                </header>
                <p>{text(notification.message)}</p>
                <footer>
                  <span>
                    {projects.get(notification.projectId ?? '') ?? t('notifications.workspace')}
                  </span>
                  {notification.sessionId && (
                    <span>
                      {sessions.has(notification.sessionId)
                        ? text(sessions.get(notification.sessionId)!)
                        : t('common.unknownSession')}
                    </span>
                  )}
                  <span>{t(eventKeys[notification.event])}</span>
                </footer>
              </div>
              <button
                className="icon-button"
                aria-label={t('notifications.openNamed', { name: text(notification.title) })}
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
            <strong>
              {filter === 'unread' ? t('notifications.noUnread') : t('notifications.none')}
            </strong>
            <Link className="button button--secondary" to="/command-center">
              {t('notifications.openCommandCenter')}
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
