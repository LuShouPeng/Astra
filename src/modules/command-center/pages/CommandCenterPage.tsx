import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock3,
  FolderPlus,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AgentSession, SessionStatus, TimelineEvent } from '../../../core/contracts/sessions';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { TranslationKey } from '../../../core/i18n/translations';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { selectCommandCenterSummary } from '../selectors/commandCenterSelectors';

const statusMeta = {
  running: {
    labelKey: 'command.runningAgents',
    icon: CircleDot,
    href: '/command-center?status=running',
  },
  waiting: { labelKey: 'nav.attention', icon: Clock3, href: '/attention' },
  completed: {
    labelKey: 'command.completedToday',
    icon: CheckCircle2,
    href: '/command-center?status=completed',
  },
  failed: { labelKey: 'command.failed', icon: XCircle, href: '/command-center?status=failed' },
} as const;

type FilteredStatus = Extract<SessionStatus, 'running' | 'completed' | 'failed'>;

function filteredStatus(value: string | null): FilteredStatus | null {
  return value === 'running' || value === 'completed' || value === 'failed' ? value : null;
}

function formatElapsed(session: AgentSession): string {
  const end = session.completedAt ?? session.updatedAt;
  const minutes = Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(session.startedAt).getTime()) / 60_000),
  );
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${minutes}m`;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

const activityLabels: Record<TimelineEvent['type'], TranslationKey> = {
  user_message: 'activity.userMessage',
  agent_message: 'activity.agentMessage',
  command: 'activity.command',
  file_change: 'activity.fileChange',
  test: 'activity.test',
  approval: 'activity.approval',
  status: 'activity.status',
};

const sessionStatusKeys: Record<SessionStatus, TranslationKey> = {
  idle: 'session.status.idle',
  running: 'session.status.running',
  waiting: 'session.status.waiting',
  completed: 'session.status.completed',
  failed: 'session.status.failed',
  stopped: 'session.status.stopped',
};

function activityLabel(
  event: TimelineEvent,
  snapshot: NonNullable<ReturnType<typeof useWorkbench>['snapshot']>,
) {
  const isReviewFeedback =
    event.type === 'user_message' &&
    snapshot.notifications.some(
      (notification) =>
        notification.event === 'review_requested' &&
        notification.sessionId === event.sessionId &&
        notification.createdAt === event.timestamp,
    );
  return isReviewFeedback ? 'activity.review' : activityLabels[event.type];
}

export function CommandCenterPage() {
  const { loadState, snapshot, error } = useWorkbench();
  const { language, t, text } = useI18n();
  const [searchParams] = useSearchParams();

  if (loadState === 'loading')
    return <div className="command-center-state">{t('command.loading')}</div>;
  if (!snapshot) {
    return (
      <div className="command-center-state" role="alert">
        {error ?? t('command.unavailable')}
      </div>
    );
  }

  const summary = selectCommandCenterSummary(snapshot);
  const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
  const sessions = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const selectedStatus = filteredStatus(searchParams.get('status'));
  const visibleSessions = selectedStatus
    ? snapshot.sessions
        .filter((session) => session.status === selectedStatus)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 6)
    : summary.activeSessions;
  const selectedStatusLabel = selectedStatus ? t(sessionStatusKeys[selectedStatus]) : null;
  const sessionSectionTitle = selectedStatusLabel
    ? t('command.filteredSessions', {
        status:
          language === 'en'
            ? `${selectedStatusLabel[0].toUpperCase()}${selectedStatusLabel.slice(1)}`
            : selectedStatusLabel,
      })
    : t('command.activeSessions');

  return (
    <div className="command-center">
      <header className="command-center__header">
        <div>
          <p className="eyebrow">Astra Nexus</p>
          <h1>{t('command.title')}</h1>
          <time className="command-center__date" dateTime={new Date().toISOString()}>
            {new Intl.DateTimeFormat(language, { dateStyle: 'full' }).format(new Date())}
          </time>
        </div>
        <div className="command-center__actions">
          <span>{t('command.activeProjects', { count: snapshot.projects.length })}</span>
          <Link className="button button--secondary button--compact" to="/settings?tab=demo">
            <SlidersHorizontal size={15} aria-hidden="true" />
            {t('command.createTask')}
          </Link>
          <Link className="button button--compact" to="/projects">
            <FolderPlus size={15} aria-hidden="true" />
            {t('command.addProject')}
          </Link>
        </div>
      </header>

      <section className="status-grid" aria-label={t('command.statusSummary')}>
        {Object.entries(statusMeta).map(([status, meta]) => {
          const Icon = meta.icon;
          return (
            <Link className="status-metric" data-status={status} key={status} to={meta.href}>
              <span>
                <Icon size={16} aria-hidden="true" />
                {t(meta.labelKey)}
              </span>
              <strong>
                {status === 'waiting'
                  ? summary.openAttentionCount
                  : summary.counts[status as keyof typeof summary.counts]}
              </strong>
            </Link>
          );
        })}
      </section>

      <Link className="attention-strip" to="/attention">
        <AlertTriangle size={18} aria-hidden="true" />
        <span>
          <strong>{t('command.attentionCount', { count: summary.openAttentionCount })}</strong>
          <small>{t('command.attentionDescription')}</small>
        </span>
        <ArrowRight size={17} aria-hidden="true" />
      </Link>

      <section className="dashboard-section" aria-labelledby="active-sessions-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t('command.inProgress')}</p>
            <h2 id="active-sessions-title">{sessionSectionTitle}</h2>
          </div>
          {selectedStatus ? (
            <Link to="/command-center">{t('command.clearFilter')}</Link>
          ) : (
            <span>{t('common.total', { count: summary.sessionTotal })}</span>
          )}
        </div>
        <div className="session-list">
          {visibleSessions.map((session) => (
            <Link className="session-row" key={session.id} to={`/sessions/${session.id}`}>
              <span className={`session-row__status session-row__status--${session.status}`} />
              <span className={`agent-mark agent-mark--${session.provider}`} aria-hidden="true">
                {session.provider[0].toUpperCase()}
              </span>
              <span className="session-row__main">
                <strong>{text(session.title)}</strong>
                <small>
                  {snapshot.providerCapabilities[session.provider].label} /{' '}
                  {projects.get(session.projectId)?.name ?? t('common.unknownProject')} /{' '}
                  {t(sessionStatusKeys[session.status])}
                </small>
              </span>
              <span className="session-row__metrics">
                <small>{formatElapsed(session)}</small>
                <small>
                  {t(session.changedFilesCount === 1 ? 'command.fileOne' : 'command.fileMany', {
                    count: session.changedFilesCount,
                  })}
                </small>
              </span>
              <span className="session-row__action">
                {session.currentAction ? text(session.currentAction) : session.status}
                <ArrowRight size={15} aria-hidden="true" />
              </span>
            </Link>
          ))}
          {visibleSessions.length === 0 && (
            <div className="session-list__empty">{t('command.noMatchingSessions')}</div>
          )}
        </div>
      </section>

      <div className="dashboard-columns">
        <section className="dashboard-section" aria-labelledby="attention-preview-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t('command.actionQueue')}</p>
              <h2 id="attention-preview-title">{t('nav.attention')}</h2>
            </div>
            <Link to="/attention">{t('command.viewAll')}</Link>
          </div>
          <div className="dashboard-list">
            {summary.attentionPreview.map((item) => (
              <Link className="dashboard-row" key={item.id} to={`/sessions/${item.sessionId}`}>
                <span className={`priority-dot priority-dot--${item.priority}`} />
                <span>
                  <strong>{text(item.title)}</strong>
                  <small>{projects.get(item.projectId)?.name ?? t('common.unknownProject')}</small>
                </span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>

        <section className="dashboard-section" aria-labelledby="project-matrix-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{t('command.portfolio')}</p>
              <h2 id="project-matrix-title">{t('command.projectMatrix')}</h2>
            </div>
          </div>
          <div className="project-matrix" aria-label={t('command.projectMatrixLabel')}>
            <div className="project-matrix__header">
              <span>{t('command.project')}</span>
              <span>R</span>
              <span>W</span>
              <span>C</span>
              <span>F</span>
              <span>{t('command.files')}</span>
            </div>
            {summary.projectMatrix.map((row) => (
              <Link
                className="project-matrix__row"
                key={row.projectId}
                to={`/projects/${row.projectId}`}
              >
                <strong>{row.name}</strong>
                <span>{row.running}</span>
                <span>{row.waiting}</span>
                <span>{row.completed}</span>
                <span>{row.failed}</span>
                <span>{t('command.changed', { count: row.changedFiles })}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="dashboard-section" aria-labelledby="recent-activity-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t('command.auditTrail')}</p>
            <h2 id="recent-activity-title">{t('command.recentActivity')}</h2>
          </div>
        </div>
        <div className="activity-list">
          {summary.recentActivity.map((event) => {
            const session = sessions.get(event.sessionId);
            return (
              <Link className="activity-row" key={event.id} to={`/sessions/${event.sessionId}`}>
                <span>{t(activityLabel(event, snapshot))}</span>
                <strong>{session ? text(session.title) : t('common.unknownSession')}</strong>
                <time dateTime={event.timestamp}>
                  {new Intl.DateTimeFormat(language, {
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(event.timestamp))}
                </time>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
