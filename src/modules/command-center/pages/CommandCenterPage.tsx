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
import { Link } from 'react-router-dom';
import type { TimelineEvent } from '../../../core/contracts/sessions';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { selectCommandCenterSummary } from '../selectors/commandCenterSelectors';

const statusMeta = {
  running: { label: 'Running', icon: CircleDot },
  waiting: { label: 'Waiting', icon: Clock3 },
  completed: { label: 'Completed', icon: CheckCircle2 },
  failed: { label: 'Failed', icon: XCircle },
} as const;

const activityLabels: Record<TimelineEvent['type'], string> = {
  user_message: 'User message',
  agent_message: 'Agent message',
  command: 'Command',
  file_change: 'File change',
  test: 'Test',
  approval: 'Approval',
  status: 'Status',
};

export function CommandCenterPage() {
  const { loadState, snapshot, error } = useWorkbench();

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

  return (
    <div className="command-center">
      <header className="command-center__header">
        <div>
          <p className="eyebrow">Workspace overview</p>
          <h1>Command Center</h1>
        </div>
        <div className="command-center__actions">
          <span>{snapshot.projects.length} active projects</span>
          <Link className="button button--secondary button--compact" to="/settings">
            <SlidersHorizontal size={15} aria-hidden="true" />
            Demo controls
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
            <article className="status-metric" data-status={status} key={status}>
              <span>
                <Icon size={16} aria-hidden="true" />
                {meta.label}
              </span>
              <strong>{summary.counts[status as keyof typeof summary.counts]}</strong>
            </article>
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
            <h2 id="active-sessions-title">Active Sessions</h2>
          </div>
          <span>{summary.sessionTotal} total</span>
        </div>
        <div className="session-list">
          {summary.activeSessions.map((session) => (
            <Link className="session-row" key={session.id} to={`/sessions/${session.id}`}>
              <span className={`session-row__status session-row__status--${session.status}`} />
              <span className="session-row__main">
                <strong>{session.title}</strong>
                <small>
                  {projects.get(session.projectId)?.name ?? 'Unknown project'} · {session.provider}
                </small>
              </span>
              <span className="session-row__action">
                {session.currentAction ?? session.status}
                <ArrowRight size={15} aria-hidden="true" />
              </span>
            </Link>
          ))}
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
                <span>{activityLabels[event.type]}</span>
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
