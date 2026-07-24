import type { ActiveWorkspace } from '../core/contracts/workspace';

export type AppRoute = 'projects' | 'workbench';

export const workbenchPaths = {
  commandCenter: '/command-center',
  projects: '/projects',
  attention: '/attention',
  changes: '/changes',
  settings: '/settings',
} as const;

export function resolveAppRoute(activeWorkspace: ActiveWorkspace | null): AppRoute {
  return activeWorkspace ? 'workbench' : 'projects';
}
