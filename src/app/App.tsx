import { useMemo } from 'react';
import type { WorkspaceService } from '../core/contracts/workspace';
import { WelcomePage } from '../modules/workspace';
import { createTauriWorkspaceAdapters } from '../modules/workspace/services/workspaceAdapters';
import { createWorkspaceService } from '../modules/workspace/services/workspaceService';
import { WorkspaceProvider, useWorkspace } from '../modules/workspace/state/WorkspaceContext';
import { resolveAppRoute } from './routes';
import { WorkbenchShell } from './shell/WorkbenchShell';

function createDefaultService(): WorkspaceService {
  return createWorkspaceService(createTauriWorkspaceAdapters());
}

function AppRouter() {
  const { activeWorkspace } = useWorkspace();
  return resolveAppRoute(activeWorkspace) === 'workbench' ? <WorkbenchShell /> : <WelcomePage />;
}

export function App({ service }: { service?: WorkspaceService }) {
  const workspaceService = useMemo(() => service ?? createDefaultService(), [service]);
  return (
    <WorkspaceProvider service={workspaceService}>
      <AppRouter />
    </WorkspaceProvider>
  );
}
