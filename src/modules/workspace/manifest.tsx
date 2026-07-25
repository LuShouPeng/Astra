import { lazy } from 'react';
import { FolderTree } from 'lucide-react';
import type { WorkbenchModule } from '../../core/contracts/workbench';

export const manifest: WorkbenchModule = {
  id: 'workspace',
  title: 'Explorer',
  order: 0,
  icon: FolderTree,
  sidebar: lazy(() => import('./components/WorkspaceExplorerSidebar')),
  main: lazy(() => import('./components/WorkspaceReadyMain')),
  isEnabled: ({ workspace }) => Boolean(workspace),
};
