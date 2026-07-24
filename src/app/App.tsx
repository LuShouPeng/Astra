import { useMemo } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { WorkspaceService } from '../core/contracts/workspace';
import {
  createPrototypeRepository,
  type PrototypeRepository,
} from '../core/data/prototypeRepository';
import { TauriPrototypeStore } from '../core/data/tauriPrototypeStore';
import { WorkbenchProvider } from '../core/state/WorkbenchContext';
import { CommandCenterPage } from '../modules/command-center';
import { createDemoSnapshot } from '../modules/demo';
import { WelcomePage } from '../modules/workspace';
import { createTauriWorkspaceAdapters } from '../modules/workspace/services/workspaceAdapters';
import { createWorkspaceService } from '../modules/workspace/services/workspaceService';
import { WorkspaceProvider, useWorkspace } from '../modules/workspace/state/WorkspaceContext';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { resolveAppRoute } from './routes';
import { WorkbenchShell } from './shell/WorkbenchShell';

function createDefaultService(): WorkspaceService {
  return createWorkspaceService(createTauriWorkspaceAdapters());
}

function createDefaultRepository(): PrototypeRepository {
  return createPrototypeRepository({
    store: new TauriPrototypeStore(),
    createFallback: createDemoSnapshot,
  });
}

function AppRouter({ repository }: { repository: PrototypeRepository }) {
  const { activeWorkspace } = useWorkspace();
  if (resolveAppRoute(activeWorkspace) === 'projects') return <WelcomePage />;

  return (
    <WorkbenchProvider repository={repository}>
      <Routes>
        <Route element={<WorkbenchShell />}>
          <Route index element={<Navigate replace to="/command-center" />} />
          <Route path="command-center" element={<CommandCenterPage />} />
          <Route path="projects" element={<ComingSoonPage />} />
          <Route path="projects/:projectId" element={<ComingSoonPage />} />
          <Route path="sessions/:sessionId" element={<ComingSoonPage />} />
          <Route path="attention" element={<ComingSoonPage />} />
          <Route path="changes" element={<ComingSoonPage />} />
          <Route path="settings" element={<ComingSoonPage />} />
          <Route path="*" element={<Navigate replace to="/command-center" />} />
        </Route>
      </Routes>
    </WorkbenchProvider>
  );
}

export function App({
  service,
  repository,
}: {
  service?: WorkspaceService;
  repository?: PrototypeRepository;
}) {
  const workspaceService = useMemo(() => service ?? createDefaultService(), [service]);
  const prototypeRepository = useMemo(() => repository ?? createDefaultRepository(), [repository]);
  return (
    <HashRouter>
      <WorkspaceProvider service={workspaceService}>
        <AppRouter repository={prototypeRepository} />
      </WorkspaceProvider>
    </HashRouter>
  );
}
