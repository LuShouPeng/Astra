import type { ActiveWorkspace } from '../core/contracts/workspace';

export type AppRoute = 'projects' | 'workbench';

export function resolveAppRoute(activeWorkspace: ActiveWorkspace | null): AppRoute {
  return activeWorkspace ? 'workbench' : 'projects';
}
