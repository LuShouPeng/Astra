import { FolderOpen, GitBranch, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Project, ProjectSort } from '../../../core/contracts/projects';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { appEventBus } from '../../../core/events/appEventBus';
import { selectProjectCardStats, selectProjects } from '../selectors/projectSelectors';
import type { ProjectService } from '../services/projectService';

export function ProjectsPage({
  service,
  onAddProject,
  addProjectError,
}: {
  service: ProjectService;
  onAddProject?: () => Promise<void>;
  addProjectError?: string | null;
}) {
  const { snapshot, saveSnapshot, saving } = useWorkbench();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProjectSort>('recent');
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
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
    await saveSnapshot(next);
    appEventBus.emit('project:removed', { projectId: removeTarget.id });
    setRemoveTarget(null);
  }

  async function openProject(project: Project) {
    setMessage(null);
    try {
      await service.openDirectory(project);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The project could not be opened.');
    }
  }

  async function addProject() {
    if (!onAddProject || adding) return;
    setMessage(null);
    setAdding(true);
    try {
      await onAddProject();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The project could not be added.');
    } finally {
      setAdding(false);
    }
  }

  if (!snapshot) return <div className="projects-state">Loading projects...</div>;

  return (
    <div className="projects-page">
      <header className="projects-page__header">
        <div>
          <p className="eyebrow">Registered workspaces</p>
          <h1>Projects</h1>
          <span>{snapshot.projects.length} projects</span>
        </div>
        {onAddProject && (
          <button
            className="button button--primary"
            disabled={adding || saving}
            onClick={() => void addProject()}
          >
            {adding ? <span className="spinner" /> : <Plus size={16} aria-hidden="true" />}
            {adding ? 'Adding Project' : 'Add Project'}
          </button>
        )}
      </header>

      <div className="project-toolbar">
        <label className="project-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search projects</span>
          <input
            type="search"
            aria-label="Search projects"
            placeholder="Search projects"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="project-sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as ProjectSort)}>
            <option value="recent">Recent activity</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>

      {(message || addProjectError) && (
        <div className="project-message" role="alert">
          {message ?? addProjectError}
        </div>
      )}

      <section className="project-grid" aria-label="Projects list">
        {projects.map((project) => {
          const stats = selectProjectCardStats(snapshot, project.id);
          return (
            <article className="project-card" key={project.id}>
              <div className="project-card__heading">
                <div>
                  <Link to={`/projects/${project.id}`}>
                    <h2>{project.name}</h2>
                  </Link>
                  {project.description && <p>{project.description}</p>}
                  <code className="project-card__path" title={project.rootPath}>
                    {project.rootPath}
                  </code>
                </div>
                <span className={`project-source project-source--${project.source}`}>
                  {project.source}
                </span>
              </div>
              <dl className="project-card__meta">
                <div>
                  <dt>Branch</dt>
                  <dd>
                    <GitBranch size={13} aria-hidden="true" />
                    {project.branch ?? 'Not a repository'}
                  </dd>
                </div>
                <div>
                  <dt>Git</dt>
                  <dd>{project.gitStatus}</dd>
                </div>
                <div>
                  <dt>Sessions</dt>
                  <dd>{stats.sessionCount}</dd>
                </div>
                <div>
                  <dt>Active Agents</dt>
                  <dd>{stats.activeAgentCount}</dd>
                </div>
                <div>
                  <dt>Changed Files</dt>
                  <dd>{stats.changedFileCount}</dd>
                </div>
                <div>
                  <dt>Activity</dt>
                  <dd>
                    <time dateTime={project.lastActivityAt}>
                      {new Intl.DateTimeFormat(undefined, {
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
                  aria-label={`Open ${project.name} directory`}
                  title="Open directory"
                  disabled={project.source !== 'local' || project.status !== 'available'}
                  onClick={() => void openProject(project)}
                >
                  <FolderOpen size={16} aria-hidden="true" />
                </button>
                <button
                  className="icon-button project-card__remove"
                  aria-label={`Remove ${project.name}`}
                  title="Remove project metadata"
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
          <span>No projects match this search.</span>
          {search && (
            <button className="button button--secondary" onClick={() => setSearch('')}>
              Clear search
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove project?"
        description={`${removeTarget?.name ?? 'This project'} will be removed from Astra Nexus. Files on disk will not be deleted.`}
        confirmLabel="Remove"
        pending={saving}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void removeProject()}
      />
    </div>
  );
}
