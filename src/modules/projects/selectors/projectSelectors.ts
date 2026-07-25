import type { Project, ProjectId, ProjectSort } from '../../../core/contracts/projects';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';

export interface ProjectCardStats {
  sessionCount: number;
  activeAgentCount: number;
  changedFileCount: number;
}

export function selectProjectCardStats(
  snapshot: WorkbenchSnapshot,
  projectId: ProjectId,
): ProjectCardStats {
  const sessions = snapshot.sessions.filter((session) => session.projectId === projectId);
  return {
    sessionCount: sessions.length,
    activeAgentCount: sessions.filter(
      (session) => session.status === 'running' || session.status === 'waiting',
    ).length,
    changedFileCount: sessions.reduce((total, session) => total + session.changedFilesCount, 0),
  };
}

export function selectProjects(
  projects: readonly Project[],
  search: string,
  sort: ProjectSort,
): Project[] {
  const query = search.trim().toLocaleLowerCase();
  return projects
    .filter((project) =>
      [project.name, project.description, project.branch]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(query)),
    )
    .sort((left, right) =>
      sort === 'name'
        ? left.name.localeCompare(right.name)
        : right.lastActivityAt.localeCompare(left.lastActivityAt),
    );
}
