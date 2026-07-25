import { FolderOpen, GitBranch, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  GitStatus,
  Project,
  ProjectSort,
  ProjectSource,
} from '../../../core/contracts/projects';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { TranslationKey } from '../../../core/i18n/translations';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { appEventBus } from '../../../core/events/appEventBus';
import { selectProjectCardStats, selectProjects } from '../selectors/projectSelectors';
import type { ProjectService } from '../services/projectService';

const gitStatusKeys: Record<GitStatus, TranslationKey> = {
  clean: 'git.clean',
  modified: 'git.modified',
  unknown: 'git.unknown',
};

const projectSourceKeys: Record<ProjectSource, TranslationKey> = {
  local: 'source.local',
  demo: 'source.demo',
};

export function ProjectsPage({
  service,
  onAddProject,
  addProjectError,
}: {
  service: ProjectService;
  onAddProject?: () => Promise<void>;
  addProjectError?: string | null;
}) {
  const { language, t, text } = useI18n();
  const { snapshot, saveSnapshot, saving } = useWorkbench();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProjectSort>('recent');
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const projects = useMemo(
    () => selectProjects(snapshot?.projects ?? [], search, sort),
    [search, snapshot?.projects, sort],
  );

  async function removeProject() {
    if (!snapshot || !removeTarget) return;
    const next = {
      ...snapshot,
      projects: snapshot.projects.filter((project) => project.id !== removeTarget.id),
      sessions: snapshot.sessions.filter((session) => session.projectId !== removeTarget.id),
      timelineEvents: snapshot.timelineEvents.filter((event) => {
        const session = snapshot.sessions.find((item) => item.id === event.sessionId);
        return session?.projectId !== removeTarget.id;
      }),
      fileChanges: snapshot.fileChanges.filter((change) => {
        const session = snapshot.sessions.find((item) => item.id === change.sessionId);
        return session?.projectId !== removeTarget.id;
      }),
      attentionItems: snapshot.attentionItems.filter((item) => item.projectId !== removeTarget.id),
      notifications: snapshot.notifications.filter(
        (notification) => notification.projectId !== removeTarget.id,
      ),
    };
    try {
      setMessage(null);
      await saveSnapshot(next);
      appEventBus.emit('project:removed', { projectId: removeTarget.id });
      setRemoveTarget(null);
    } catch (error) {
      setMessage(error instanceof Error ? text(error.message) : t('projects.removeError'));
    }
  }

  async function openProject(project: Project) {
    if (openingProjectId) return;
    setMessage(null);
    setOpeningProjectId(project.id);
    try {
      await service.openDirectory(project);
    } catch (error) {
      setMessage(error instanceof Error ? text(error.message) : t('projects.openError'));
    } finally {
      setOpeningProjectId(null);
    }
  }

  async function addProject() {
    if (!onAddProject || adding) return;
    setMessage(null);
    setAdding(true);
    try {
      await onAddProject();
    } catch (error) {
      setMessage(error instanceof Error ? text(error.message) : t('projects.addError'));
    } finally {
      setAdding(false);
    }
  }

  if (!snapshot) return <div className="projects-state">{t('projects.loading')}</div>;

  return (
    <div className="projects-page">
      <header className="projects-page__header">
        <div>
          <p className="eyebrow">{t('projects.registered')}</p>
          <h1>{t('nav.projects')}</h1>
          <span>{t('projects.count', { count: snapshot.projects.length })}</span>
        </div>
        {onAddProject && (
          <button
            className="button button--primary"
            disabled={adding || saving}
            onClick={() => void addProject()}
          >
            {adding ? <span className="spinner" /> : <Plus size={16} aria-hidden="true" />}
            {adding ? t('projects.adding') : t('projects.add')}
          </button>
        )}
      </header>

      <div className="project-toolbar">
        <label className="project-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">{t('projects.search')}</span>
          <input
            type="search"
            aria-label={t('projects.search')}
            placeholder={t('projects.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="project-sort">
          <span>{t('projects.sort')}</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as ProjectSort)}>
            <option value="recent">{t('projects.sortRecent')}</option>
            <option value="name">{t('projects.sortName')}</option>
          </select>
        </label>
      </div>

      {(message || addProjectError) && (
        <div className="project-message" role="alert">
          {message ?? addProjectError}
        </div>
      )}

      <section className="project-grid" aria-label={t('projects.list')}>
        {projects.map((project) => {
          const stats = selectProjectCardStats(snapshot, project.id);
          const opening = openingProjectId === project.id;
          return (
            <article className="project-card" key={project.id}>
              <div className="project-card__heading">
                <div>
                  <Link to={`/projects/${project.id}`}>
                    <h2>{project.name}</h2>
                  </Link>
                  {project.description && <p>{text(project.description)}</p>}
                  <code className="project-card__path" title={project.rootPath}>
                    {project.rootPath}
                  </code>
                </div>
                <span className={`project-source project-source--${project.source}`}>
                  {t(projectSourceKeys[project.source])}
                </span>
              </div>
              <dl className="project-card__meta">
                <div>
                  <dt>{t('projects.branch')}</dt>
                  <dd>
                    <GitBranch size={13} aria-hidden="true" />
                    {project.branch ?? t('projects.notRepository')}
                  </dd>
                </div>
                <div>
                  <dt>{t('projects.git')}</dt>
                  <dd>{t(gitStatusKeys[project.gitStatus])}</dd>
                </div>
                <div>
                  <dt>{t('projects.sessions')}</dt>
                  <dd>{stats.sessionCount}</dd>
                </div>
                <div>
                  <dt>{t('projects.activeAgents')}</dt>
                  <dd>{stats.activeAgentCount}</dd>
                </div>
                <div>
                  <dt>{t('projects.changedFiles')}</dt>
                  <dd>{stats.changedFileCount}</dd>
                </div>
                <div>
                  <dt>{t('projects.activity')}</dt>
                  <dd>
                    <time dateTime={project.lastActivityAt}>
                      {new Intl.DateTimeFormat(language, {
                        month: 'short',
                        day: 'numeric',
                      }).format(new Date(project.lastActivityAt))}
                    </time>
                  </dd>
                </div>
              </dl>
              <div className="project-card__actions">
                <button
                  className="icon-button"
                  aria-label={t(
                    opening ? 'projects.openingDirectoryNamed' : 'projects.openDirectoryNamed',
                    { name: project.name },
                  )}
                  title={opening ? t('projects.openingDirectory') : t('projects.openDirectory')}
                  disabled={
                    Boolean(openingProjectId) ||
                    project.source !== 'local' ||
                    project.status !== 'available'
                  }
                  onClick={() => void openProject(project)}
                >
                  {opening ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : (
                    <FolderOpen size={16} aria-hidden="true" />
                  )}
                </button>
                <button
                  className="icon-button project-card__remove"
                  aria-label={t('projects.removeNamed', { name: project.name })}
                  title={t('projects.removeMetadata')}
                  onClick={() => setRemoveTarget(project)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {projects.length === 0 && (
        <div className="projects-empty">
          <span>{t('projects.noSearchResults')}</span>
          {search && (
            <button className="button button--secondary" onClick={() => setSearch('')}>
              {t('projects.clearSearch')}
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={t('projects.removeTitle')}
        description={t('projects.removeDescription', {
          name: removeTarget?.name ?? t('nav.projects'),
        })}
        confirmLabel={t('workspace.remove')}
        pending={saving}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void removeProject()}
      />
    </div>
  );
}
