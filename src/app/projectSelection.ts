import type { Project } from '../core/contracts/projects';
import type { ActiveWorkspace, WorkspaceRecord } from '../core/contracts/workspace';

function fallbackNormalizedPath(rootPath: string): string {
  return rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Resolves the project that owns an open workspace without conflating the two IDs.
 */
export function selectOrDeriveWorkspaceProject(
  projects: readonly Project[],
  workspace: ActiveWorkspace,
  workspaceRecord?: WorkspaceRecord,
): Project {
  const normalizedPath =
    workspaceRecord?.normalizedPath ?? fallbackNormalizedPath(workspace.rootPath);
  const existing = projects.find(
    (project) =>
      project.source === 'local' &&
      (project.normalizedPath === normalizedPath || project.rootPath === workspace.rootPath),
  );
  if (existing) return existing;

  const createdAt =
    workspaceRecord?.createdAt ?? workspaceRecord?.lastOpenedAt ?? new Date().toISOString();
  return {
    id: `project-${workspace.id}`,
    name: workspace.name,
    rootPath: workspace.rootPath,
    normalizedPath,
    source: 'local',
    status: 'available',
    gitRepository: false,
    gitStatus: 'unknown',
    createdAt,
    lastActivityAt: workspaceRecord?.lastOpenedAt ?? createdAt,
  };
}
