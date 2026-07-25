import { ChevronDown, Circle, Folder, PanelsTopLeft } from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { Project } from '../../core/contracts/projects';
import type { AgentSession } from '../../core/contracts/sessions';
import { useI18n } from '../../core/i18n/I18nContext';

const SESSION_RENDER_LIMIT = 30;

export function ProjectSessionTree({
  workspaceName,
  projects,
  sessions,
}: {
  workspaceName: string;
  projects: readonly Project[];
  sessions: readonly AgentSession[];
}) {
  const { t, text } = useI18n();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);

  function toggleProject(projectId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  return (
    <nav className="project-tree" aria-label={t('tree.navigation')}>
      <div className="project-tree__header">
        <span>{t('nav.projects')}</span>
        <span>{projects.length}</span>
      </div>
      <div className="project-tree__content" role="tree" aria-label={t('tree.projectsAndSessions')}>
        <div
          className="project-tree__workspace"
          role="treeitem"
          aria-expanded={!workspaceCollapsed}
          aria-label={workspaceName}
        >
          <div className="project-tree__workspace-row">
            <button
              className="project-tree__toggle"
              onClick={() => setWorkspaceCollapsed((value) => !value)}
              aria-label={t(workspaceCollapsed ? 'tree.expand' : 'tree.collapse', {
                name: workspaceName,
              })}
            >
              <ChevronDown className={workspaceCollapsed ? 'is-collapsed' : ''} size={14} />
            </button>
            <PanelsTopLeft size={15} aria-hidden="true" />
            <strong title={workspaceName}>{workspaceName}</strong>
            <span>{projects.length}</span>
          </div>
          {!workspaceCollapsed && (
            <div className="project-tree__directories" role="group">
              {projects.map((project) => {
                const projectSessions = sessions.filter(
                  (session) => session.projectId === project.id,
                );
                const isCollapsed = collapsed.has(project.id);
                return (
                  <div
                    className="project-tree__project"
                    key={project.id}
                    role="treeitem"
                    aria-expanded={!isCollapsed}
                  >
                    <div className="project-tree__project-row">
                      <button
                        className="project-tree__toggle"
                        onClick={() => toggleProject(project.id)}
                        aria-label={t(isCollapsed ? 'tree.expand' : 'tree.collapse', {
                          name: project.name,
                        })}
                      >
                        <ChevronDown className={isCollapsed ? 'is-collapsed' : ''} size={14} />
                      </button>
                      <Folder size={15} aria-hidden="true" />
                      <NavLink to={`/projects/${project.id}`}>{project.name}</NavLink>
                      <span
                        className={`git-dot git-dot--${project.gitStatus}`}
                        title={t('tree.git', { status: project.gitStatus })}
                      />
                    </div>
                    {!isCollapsed && (
                      <div className="project-tree__sessions" role="group">
                        {projectSessions.slice(0, SESSION_RENDER_LIMIT).map((session) => (
                          <div key={session.id} role="treeitem">
                            <NavLink
                              className="project-tree__session"
                              to={`/sessions/${session.id}`}
                            >
                              <Circle
                                className={`session-dot session-dot--${session.status}`}
                                size={7}
                                fill="currentColor"
                              />
                              <span>{text(session.title)}</span>
                              {session.unread && <i aria-label={t('tree.unread')} />}
                            </NavLink>
                          </div>
                        ))}
                        {projectSessions.length > SESSION_RENDER_LIMIT && (
                          <span className="project-tree__more">
                            {t('tree.moreSessions', {
                              count: projectSessions.length - SESSION_RENDER_LIMIT,
                            })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
