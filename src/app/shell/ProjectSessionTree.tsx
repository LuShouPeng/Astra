import { ChevronDown, Circle, FolderGit2 } from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { Project } from '../../core/contracts/projects';
import type { AgentSession } from '../../core/contracts/sessions';

const SESSION_RENDER_LIMIT = 30;

export function ProjectSessionTree({
  projects,
  sessions,
}: {
  projects: readonly Project[];
  sessions: readonly AgentSession[];
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  function toggleProject(projectId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  return (
    <nav className="project-tree" aria-label="Project navigation">
      <div className="project-tree__header">
        <span>Projects</span>
        <span>{projects.length}</span>
      </div>
      <div className="project-tree__content" role="tree" aria-label="Projects and sessions">
        {projects.map((project) => {
          const projectSessions = sessions.filter((session) => session.projectId === project.id);
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
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.name}`}
                >
                  <ChevronDown className={isCollapsed ? 'is-collapsed' : ''} size={14} />
                </button>
                <FolderGit2 size={15} aria-hidden="true" />
                <NavLink to={`/projects/${project.id}`}>{project.name}</NavLink>
                <span
                  className={`git-dot git-dot--${project.gitStatus}`}
                  title={`Git: ${project.gitStatus}`}
                />
              </div>
              {!isCollapsed && (
                <div className="project-tree__sessions" role="group">
                  {projectSessions.slice(0, SESSION_RENDER_LIMIT).map((session) => (
                    <div key={session.id} role="treeitem">
                      <NavLink className="project-tree__session" to={`/sessions/${session.id}`}>
                        <Circle
                          className={`session-dot session-dot--${session.status}`}
                          size={7}
                          fill="currentColor"
                        />
                        <span>{session.title}</span>
                        {session.unread && <i aria-label="Unread" />}
                      </NavLink>
                    </div>
                  ))}
                  {projectSessions.length > SESSION_RENDER_LIMIT && (
                    <span className="project-tree__more">
                      {projectSessions.length - SESSION_RENDER_LIMIT} more sessions
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
