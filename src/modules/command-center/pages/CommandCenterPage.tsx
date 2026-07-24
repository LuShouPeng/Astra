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
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { selectCommandCenterSummary } from '../selectors/commandCenterSelectors';

const statusMeta = {
  running: {
    label: 'Running Agents',
    icon: CircleDot,
    href: '/command-center?status=running',
  },
  waiting: { label: 'Needs Attention', icon: Clock3, href: '/attention' },
  completed: {
    label: 'Completed Today',
    icon: CheckCircle2,
    href: '/command-center?status=completed',
  },
  failed: { label: 'Failed', icon: XCircle, href: '/command-center?status=failed' },
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

const activityLabels: Record<TimelineEvent['type'], string> = {
  user_message: 'User message',
  agent_message: 'Agent message',
  command: 'Command',
  file_change: 'File change',
  test: 'Test',
  approval: 'Approval',
  status: 'Status',
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
  return isReviewFeedback ? 'Review' : activityLabels[event.type];
}

export function CommandCenterPage() {
  const { loadState, snapshot, error } = useWorkbench();
  const [searchParams] = useSearchParams();

  if (loadState === 'loading')
    return <div className="command-center-state">Loading workbench...</div>;
  if (!snapshot) {
    return (
      <div className="command-center-state" role="alert">
        {error ?? 'Workbench data is unavailable.'}
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
  const sessionSectionTitle = selectedStatus
    ? `${selectedStatus[0].toUpperCase()}${selectedStatus.slice(1)} Sessions`
    : 'Active Sessions';

  return (
    <div className="command-center">
      <header className="command-center__header">
        <div>
          <p className="eyebrow">Astra Nexus</p>
          <h1>Command Center</h1>
          <time className="command-center__date" dateTime={new Date().toISOString()}>
            {new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(new Date())}
          </time>
        </div>
        <div className="command-center__actions">
          <span>{snapshot.projects.length} active projects</span>
          <Link className="button button--secondary button--compact" to="/settings?tab=demo">
            <SlidersHorizontal size={15} aria-hidden="true" />
            Create simulated task
          </Link>
          <Link className="button button--compact" to="/projects">
            <FolderPlus size={15} aria-hidden="true" />
            Add project
          </Link>
        </div>
      </header>

      <section className="status-grid" aria-label="Session status summary">
        {Object.entries(statusMeta).map(([status, meta]) => {
          const Icon = meta.icon;
          return (
            <Link className="status-metric" data-status={status} key={status} to={meta.href}>
              <span>
                <Icon size={16} aria-hidden="true" />
                {meta.label}
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
          <strong>{summary.openAttentionCount} items need attention</strong>
          <small>Approvals and failed sessions are waiting for review.</small>
        </span>
        <ArrowRight size={17} aria-hidden="true" />
      </Link>

      <section className="dashboard-section" aria-labelledby="active-sessions-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">In progress</p>
            <h2 id="active-sessions-title">{sessionSectionTitle}</h2>
          </div>
          {selectedStatus ? (
            <Link to="/command-center">Clear status filter</Link>
          ) : (
            <span>{summary.sessionTotal} total</span>
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
                <strong>{session.title}</strong>
                <small>
                  {snapshot.providerCapabilities[session.provider].label} /{' '}
                  {projects.get(session.projectId)?.name ?? 'Unknown project'} / {session.status}
                </small>
              </span>
              <span className="session-row__metrics">
                <small>{formatElapsed(session)}</small>
                <small>
                  {session.changedFilesCount} {session.changedFilesCount === 1 ? 'file' : 'files'}
                </small>
              </span>
              <span className="session-row__action">
                {session.currentAction ?? session.status}
                <ArrowRight size={15} aria-hidden="true" />
              </span>
            </Link>
          ))}
          {visibleSessions.length === 0 && (
            <div className="session-list__empty">No Sessions match this status.</div>
          )}
        </div>
      </section>

      <div className="dashboard-columns">
        <section className="dashboard-section" aria-labelledby="attention-preview-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Action queue</p>
              <h2 id="attention-preview-title">Needs Attention</h2>
            </div>
            <Link to="/attention">View all</Link>
          </div>
          <div className="dashboard-list">
            {summary.attentionPreview.map((item) => (
              <Link className="dashboard-row" key={item.id} to={`/sessions/${item.sessionId}`}>
                <span className={`priority-dot priority-dot--${item.priority}`} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{projects.get(item.projectId)?.name ?? 'Unknown project'}</small>
                </span>
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>

        <section className="dashboard-section" aria-labelledby="project-matrix-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Portfolio</p>
              <h2 id="project-matrix-title">Project Matrix</h2>
            </div>
          </div>
          <div className="project-matrix" aria-label="Project status matrix">
            <div className="project-matrix__header">
              <span>Project</span>
              <span>R</span>
              <span>W</span>
              <span>C</span>
              <span>F</span>
              <span>Files</span>
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
                <span>{row.changedFiles} changed</span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <section className="dashboard-section" aria-labelledby="recent-activity-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Audit trail</p>
            <h2 id="recent-activity-title">Recent Activity</h2>
          </div>
        </div>
        <div className="activity-list">
          {summary.recentActivity.map((event) => {
            const session = sessions.get(event.sessionId);
            return (
              <Link className="activity-row" key={event.id} to={`/sessions/${event.sessionId}`}>
                <span>{activityLabel(event, snapshot)}</span>
                <strong>{session?.title ?? 'Unknown Session'}</strong>
                <time dateTime={event.timestamp}>
                  {new Intl.DateTimeFormat('en', {
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
