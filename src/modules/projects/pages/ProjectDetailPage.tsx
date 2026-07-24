import { ArrowLeft, ExternalLink, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { TimelineEvent } from '../../../core/contracts/sessions';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import type { ProjectService } from '../services/projectService';

type ProjectTab = 'overview' | 'sessions' | 'changes' | 'activity' | 'configuration';

function activityText(event: TimelineEvent): string {
  switch (event.type) {
    case 'user_message':
    case 'agent_message':
    case 'file_change':
    case 'status':
      return event.content;
    case 'command':
      return event.outputSummary ?? event.command;
    case 'test':
      return `${event.passed} passed, ${event.failed} failed`;
    case 'approval':
      return event.request;
  }
}

export function ProjectDetailPage({ service }: { service?: ProjectService }) {
  const { projectId } = useParams();
  const { snapshot } = useWorkbench();
  const [tab, setTab] = useState<ProjectTab>('overview');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!snapshot) return <div className="projects-state">Loading project...</div>;
  const project = snapshot.projects.find((candidate) => candidate.id === projectId);
  if (!project)
    return (
      <div className="projects-state" role="alert">
        Project not found.
      </div>
    );

  const sessions = snapshot.sessions.filter((session) => session.projectId === project.id);
  const sessionIds = new Set(sessions.map((session) => session.id));
  const changes = snapshot.fileChanges.filter((change) => sessionIds.has(change.sessionId));
  const activity = snapshot.timelineEvents
    .filter((event) => sessionIds.has(event.sessionId))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const activeCount = sessions.filter(
    (session) => session.status === 'running' || session.status === 'waiting',
  ).length;
  const openEnabled =
    project.source === 'local' && project.status === 'available' && Boolean(service);

  async function openProject() {
    if (!service) return;
    setError(null);
    setOpening(true);
    try {
      await service.openDirectory(project!);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Project directory could not be opened.');
    } finally {
      setOpening(false);
    }
  }

  const tabs: Array<{ id: ProjectTab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'sessions', label: 'Sessions', count: sessions.length },
    { id: 'changes', label: 'Changes', count: changes.length },
    { id: 'activity', label: 'Activity', count: activity.length },
    { id: 'configuration', label: 'Configuration' },
  ];

  return (
    <div className="project-detail">
      <header className="project-detail__header">
        <Link to="/projects" aria-label="Back to Projects">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <p className="eyebrow">{project.source} project</p>
          <h1>{project.name}</h1>
          <span>{project.description ?? 'No project description'}</span>
        </div>
        <button
          className="button button--secondary"
          aria-label="Open project directory"
          disabled={!openEnabled || opening}
          title={project.source === 'demo' ? 'Demo projects have no local directory' : undefined}
          onClick={() => void openProject()}
        >
          <FolderOpen size={16} aria-hidden="true" />
          {opening ? 'Opening...' : 'Open folder'}
        </button>
      </header>

      <div className="project-detail__tabs" role="tablist" aria-label="Project views">
        {tabs.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.count !== undefined ? ` ${item.count}` : ''}
          </button>
        ))}
      </div>

      {error && (
        <p className="project-detail__error" role="alert">
          {error}
        </p>
      )}
      <div className="project-detail__content">
        {tab === 'overview' && (
          <section className="project-overview" aria-label="Project overview">
            <div className="project-metrics">
              <span>
                <strong>{activeCount}</strong> active {activeCount === 1 ? 'Session' : 'Sessions'}
              </span>
              <span>
                <strong>{sessions.length}</strong> total Sessions
              </span>
              <span>
                <strong>{changes.length}</strong> changed files
              </span>
              <span>
                <strong>{project.gitStatus}</strong> Git status
              </span>
            </div>
            <div className="project-detail__section-heading">
              <h2>Recent Sessions</h2>
              <span>{sessions.length} total</span>
            </div>
            <div className="project-detail__rows">
              {[...sessions]
                .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
                .slice(0, 5)
                .map((session) => (
                  <Link key={session.id} to={`/sessions/${session.id}`}>
                    <span>
                      <strong>{session.title}</strong>
                      <small>{session.provider}</small>
                    </span>
                    <span className={`session-status session-status--${session.status}`}>
                      {session.status}
                    </span>
                  </Link>
                ))}
              {sessions.length === 0 && (
                <p className="project-detail__empty">No Sessions recorded for this project.</p>
              )}
            </div>
          </section>
        )}

        {tab === 'sessions' && (
          <section className="project-detail__rows" aria-label="Project Sessions">
            {sessions.map((session) => (
              <Link key={session.id} to={`/sessions/${session.id}`}>
                <span>
                  <strong>{session.title}</strong>
                  <small>{session.currentAction ?? session.provider}</small>
                </span>
                <span className={`session-status session-status--${session.status}`}>
                  {session.status}
                </span>
              </Link>
            ))}
            {sessions.length === 0 && (
              <p className="project-detail__empty">No Sessions recorded for this project.</p>
            )}
          </section>
        )}

        {tab === 'changes' && (
          <section className="project-detail__rows" aria-label="Project changes">
            {changes.map((change) => {
              const session = sessions.find((candidate) => candidate.id === change.sessionId);
              return (
                <Link key={change.id} to={`/sessions/${change.sessionId}?tab=changes`}>
                  <span>
                    <strong>{change.relativePath}</strong>
                    <small>{session?.title ?? 'Unknown Session'}</small>
                  </span>
                  <span>
                    {change.additions > 0 ? `+${change.additions}` : '0'} / -{change.deletions}
                  </span>
                </Link>
              );
            })}
            {changes.length === 0 && (
              <p className="project-detail__empty">No changed files recorded for this project.</p>
            )}
          </section>
        )}

        {tab === 'activity' && (
          <section className="project-detail__rows" aria-label="Project activity">
            {activity.slice(0, 50).map((event) => (
              <Link key={event.id} to={`/sessions/${event.sessionId}`}>
                <span>
                  <strong>{activityText(event)}</strong>
                  <small>{event.type.replace('_', ' ')}</small>
                </span>
                <time dateTime={event.timestamp}>
                  {new Intl.DateTimeFormat(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(event.timestamp))}
                </time>
              </Link>
            ))}
            {activity.length === 0 && (
              <p className="project-detail__empty">No activity recorded for this project.</p>
            )}
          </section>
        )}

        {tab === 'configuration' && (
          <section className="project-configuration" aria-label="Project configuration">
            <dl>
              <div>
                <dt>Root</dt>
                <dd>{project.rootPath}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{project.source}</dd>
              </div>
              <div>
                <dt>Availability</dt>
                <dd>{project.status}</dd>
              </div>
              <div>
                <dt>Git repository</dt>
                <dd>{project.gitRepository ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{project.branch ?? 'Not available'}</dd>
              </div>
            </dl>
            <Link className="project-configuration__changes" to="/changes">
              Review project changes <ExternalLink size={14} aria-hidden="true" />
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
