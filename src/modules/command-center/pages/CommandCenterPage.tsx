import { AlertTriangle, ArrowRight, CheckCircle2, CircleDot, Clock3, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { selectCommandCenterSummary } from '../selectors/commandCenterSelectors';

const statusMeta = {
  running: { label: 'Running', icon: CircleDot },
  waiting: { label: 'Waiting', icon: Clock3 },
  completed: { label: 'Completed', icon: CheckCircle2 },
  failed: { label: 'Failed', icon: XCircle },
} as const;

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

  return (
    <div className="command-center">
      <header className="command-center__header">
        <div>
          <p className="eyebrow">Workspace overview</p>
          <h1>Command Center</h1>
        </div>
        <span>{snapshot.projects.length} active projects</span>
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

      <section className="recent-sessions" aria-labelledby="recent-sessions-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Latest activity</p>
            <h2 id="recent-sessions-title">Recent sessions</h2>
          </div>
          <span>{summary.sessionTotal} total</span>
        </div>
        <div className="session-list">
          {summary.recentSessions.map((session) => (
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
    </div>
  );
}
