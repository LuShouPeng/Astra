import { ArrowLeft, ExternalLink, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { GitStatus, ProjectSource, ProjectStatus } from '../../../core/contracts/projects';
import type { TimelineEvent } from '../../../core/contracts/sessions';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { TranslationKey, TranslationParams } from '../../../core/i18n/translations';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import type { ProjectService } from '../services/projectService';

type ProjectTab = 'overview' | 'sessions' | 'changes' | 'activity' | 'configuration';

type Translate = (key: TranslationKey, params?: TranslationParams) => string;

const sessionStatusKeys = {
  idle: 'session.status.idle',
  running: 'session.status.running',
  waiting: 'session.status.waiting',
  completed: 'session.status.completed',
  failed: 'session.status.failed',
  stopped: 'session.status.stopped',
} as const satisfies Record<string, TranslationKey>;

const eventTypeKeys = {
  user_message: 'activity.userMessage',
  agent_message: 'activity.agentMessage',
  command: 'activity.command',
  file_change: 'activity.fileChange',
  test: 'activity.test',
  approval: 'activity.approval',
  status: 'activity.status',
} as const satisfies Record<TimelineEvent['type'], TranslationKey>;

const sourceKeys: Record<ProjectSource, TranslationKey> = {
  local: 'source.local',
  demo: 'source.demo',
};

const projectStatusKeys: Record<ProjectStatus, TranslationKey> = {
  available: 'workspace.available',
  missing: 'workspace.missing',
};

const gitStatusKeys: Record<GitStatus, TranslationKey> = {
  clean: 'git.clean',
  modified: 'git.modified',
  unknown: 'git.unknown',
};

function activityText(event: TimelineEvent, t: Translate): string {
  switch (event.type) {
    case 'user_message':
    case 'agent_message':
    case 'file_change':
    case 'status':
      return event.content;
    case 'command':
      return event.outputSummary ?? event.command;
    case 'test':
      return t('event.testSummary', { passed: event.passed, failed: event.failed });
    case 'approval':
      return event.request;
  }
}

export function ProjectDetailPage({ service }: { service?: ProjectService }) {
  const { language, t, text } = useI18n();
  const { projectId } = useParams();
  const { snapshot } = useWorkbench();
  const [tab, setTab] = useState<ProjectTab>('overview');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!snapshot) return <div className="projects-state">{t('projects.loadingOne')}</div>;
  const project = snapshot.projects.find((candidate) => candidate.id === projectId);
  if (!project)
    return (
      <div className="projects-state" role="alert">
        {t('projects.notFound')}
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
      setError(caught instanceof Error ? text(caught.message) : t('project.openError'));
    } finally {
      setOpening(false);
    }
  }

  const tabs: Array<{ id: ProjectTab; label: string; count?: number }> = [
    { id: 'overview', label: t('project.overview') },
    { id: 'sessions', label: t('projects.sessions'), count: sessions.length },
    { id: 'changes', label: t('project.changes'), count: changes.length },
    { id: 'activity', label: t('projects.activity'), count: activity.length },
    { id: 'configuration', label: t('project.configuration') },
  ];

  return (
    <div className="project-detail">
      <header className="project-detail__header">
        <Link to="/projects" aria-label={t('project.back')}>
          <ArrowLeft size={16} />
        </Link>
        <div>
          <p className="eyebrow">{t('project.kind', { source: t(sourceKeys[project.source]) })}</p>
          <h1>{project.name}</h1>
          <span>
            {project.description ? text(project.description) : t('project.noDescription')}
          </span>
        </div>
        <button
          className="button button--secondary"
          aria-label={t('project.openDirectoryLabel')}
          disabled={!openEnabled || opening}
          title={project.source === 'demo' ? t('project.demoNoDirectory') : undefined}
          onClick={() => void openProject()}
        >
          <FolderOpen size={16} aria-hidden="true" />
          {opening ? t('workspace.opening') : t('project.openButton')}
        </button>
      </header>

      <div className="project-detail__tabs" role="tablist" aria-label={t('project.views')}>
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
          <section className="project-overview" aria-label={t('project.overviewLabel')}>
            <div className="project-metrics">
              <span>
                {t(activeCount === 1 ? 'project.activeSessionOne' : 'project.activeSessionMany', {
                  count: activeCount,
                })}
              </span>
              <span>{t('project.totalSessions', { count: sessions.length })}</span>
              <span>{t('project.changedFileCount', { count: changes.length })}</span>
              <span>{t('project.gitStatus', { status: t(gitStatusKeys[project.gitStatus]) })}</span>
            </div>
            <div className="project-detail__section-heading">
              <h2>{t('project.recentSessions')}</h2>
              <span>{t('common.total', { count: sessions.length })}</span>
            </div>
            <div className="project-detail__rows">
              {[...sessions]
                .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
                .slice(0, 5)
                .map((session) => (
                  <Link key={session.id} to={`/sessions/${session.id}`}>
                    <span>
                      <strong>{text(session.title)}</strong>
                      <small>{session.provider}</small>
                    </span>
                    <span className={`session-status session-status--${session.status}`}>
                      {t(sessionStatusKeys[session.status])}
                    </span>
                  </Link>
                ))}
              {sessions.length === 0 && (
                <p className="project-detail__empty">{t('project.noSessions')}</p>
              )}
            </div>
          </section>
        )}

        {tab === 'sessions' && (
          <section className="project-detail__rows" aria-label={t('project.sessionsLabel')}>
            {sessions.map((session) => (
              <Link key={session.id} to={`/sessions/${session.id}`}>
                <span>
                  <strong>{text(session.title)}</strong>
                  <small>
                    {session.currentAction ? text(session.currentAction) : session.provider}
                  </small>
                </span>
                <span className={`session-status session-status--${session.status}`}>
                  {t(sessionStatusKeys[session.status])}
                </span>
              </Link>
            ))}
            {sessions.length === 0 && (
              <p className="project-detail__empty">{t('project.noSessions')}</p>
            )}
          </section>
        )}

        {tab === 'changes' && (
          <section className="project-detail__rows" aria-label={t('project.changesLabel')}>
            {changes.map((change) => {
              const session = sessions.find((candidate) => candidate.id === change.sessionId);
              return (
                <Link key={change.id} to={`/sessions/${change.sessionId}?tab=changes`}>
                  <span>
                    <strong>{change.relativePath}</strong>
                    <small>{session ? text(session.title) : t('common.unknownSession')}</small>
                  </span>
                  <span>
                    {change.additions > 0 ? `+${change.additions}` : '0'} / -{change.deletions}
                  </span>
                </Link>
              );
            })}
            {changes.length === 0 && (
              <p className="project-detail__empty">{t('project.noChanges')}</p>
            )}
          </section>
        )}

        {tab === 'activity' && (
          <section className="project-detail__rows" aria-label={t('project.activityLabel')}>
            {activity.slice(0, 50).map((event) => (
              <Link key={event.id} to={`/sessions/${event.sessionId}`}>
                <span>
                  <strong>{text(activityText(event, t))}</strong>
                  <small>{t(eventTypeKeys[event.type])}</small>
                </span>
                <time dateTime={event.timestamp}>
                  {new Intl.DateTimeFormat(language, {
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(event.timestamp))}
                </time>
              </Link>
            ))}
            {activity.length === 0 && (
              <p className="project-detail__empty">{t('project.noActivity')}</p>
            )}
          </section>
        )}

        {tab === 'configuration' && (
          <section className="project-configuration" aria-label={t('project.configurationLabel')}>
            <dl>
              <div>
                <dt>{t('project.root')}</dt>
                <dd>{project.rootPath}</dd>
              </div>
              <div>
                <dt>{t('project.source')}</dt>
                <dd>{t(sourceKeys[project.source])}</dd>
              </div>
              <div>
                <dt>{t('project.availability')}</dt>
                <dd>{t(projectStatusKeys[project.status])}</dd>
              </div>
              <div>
                <dt>{t('project.gitRepository')}</dt>
                <dd>{project.gitRepository ? t('common.yes') : t('common.no')}</dd>
              </div>
              <div>
                <dt>{t('projects.branch')}</dt>
                <dd>{project.branch ?? t('common.notAvailable')}</dd>
              </div>
            </dl>
            <Link className="project-configuration__changes" to="/changes">
              {t('project.reviewChanges')} <ExternalLink size={14} aria-hidden="true" />
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
