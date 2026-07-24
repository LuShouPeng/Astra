import { useMemo } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { WorkspaceService } from '../core/contracts/workspace';
import type { Project, ProjectGitSummary } from '../core/contracts/projects';
import { appEventBus } from '../core/events/appEventBus';
import {
  createPrototypeRepository,
  type PrototypeRepository,
} from '../core/data/prototypeRepository';
import { TauriPrototypeStore } from '../core/data/tauriPrototypeStore';
import { WorkbenchProvider, useWorkbench } from '../core/state/WorkbenchContext';
import { CommandCenterPage } from '../modules/command-center';
import { AttentionPage } from '../modules/attention';
import {
  ChangesPage,
  TauriChangesNativeAdapter,
  createChangesService,
  type ChangesService,
} from '../modules/changes';
import { createDemoSnapshot } from '../modules/demo';
import {
  createProjectService,
  ProjectsPage,
  TauriProjectNativeAdapter,
  type ProjectService,
} from '../modules/projects';
import { SessionDetailPage } from '../modules/sessions';
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

function createDefaultChangesService(): ChangesService {
  return createChangesService(new TauriChangesNativeAdapter());
}

function ProjectsRoute({ service }: { service: ProjectService }) {
  const { chooseAndOpen } = useWorkspace();
  const { snapshot, saveSnapshot } = useWorkbench();

  async function addProject() {
    const record = await chooseAndOpen();
    if (!record || !snapshot) return;
    let git: ProjectGitSummary;
    try {
      git = await service.inspectRoot(record.rootPath);
    } catch {
      git = { gitRepository: false, gitStatus: 'unknown' };
    }
    const project: Project = {
      id: record.id,
      name: record.name,
      rootPath: record.rootPath,
      normalizedPath: record.normalizedPath,
      source: 'local',
      status: record.status,
      gitRepository: git.gitRepository,
      branch: git.branch,
      gitStatus: git.gitStatus,
      createdAt: record.createdAt,
      lastActivityAt: record.lastOpenedAt,
    };
    const projects = snapshot.projects.some(
      (item) => item.normalizedPath === project.normalizedPath,
    )
      ? snapshot.projects.map((item) =>
          item.normalizedPath === project.normalizedPath ? project : item,
        )
      : [project, ...snapshot.projects];
    await saveSnapshot({ ...snapshot, projects });
    appEventBus.emit('project:added', project);
  }

  return <ProjectsPage service={service} onAddProject={addProject} />;
}

function AppRouter({
  repository,
  projectService,
  changesService,
}: {
  repository: PrototypeRepository;
  projectService: ProjectService;
  changesService: ChangesService;
}) {
  const { activeWorkspace } = useWorkspace();
  if (resolveAppRoute(activeWorkspace) === 'projects') return <WelcomePage />;

  return (
    <WorkbenchProvider repository={repository}>
      <Routes>
        <Route element={<WorkbenchShell />}>
          <Route index element={<Navigate replace to="/command-center" />} />
          <Route path="command-center" element={<CommandCenterPage />} />
          <Route path="projects" element={<ProjectsRoute service={projectService} />} />
          <Route path="projects/:projectId" element={<ComingSoonPage />} />
          <Route
            path="sessions/:sessionId"
            element={<SessionDetailPage changesService={changesService} />}
          />
          <Route path="attention" element={<AttentionPage />} />
          <Route path="changes" element={<ChangesPage service={changesService} />} />
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
  projectService: suppliedProjectService,
  changesService: suppliedChangesService,
}: {
  service?: WorkspaceService;
  repository?: PrototypeRepository;
  projectService?: ProjectService;
  changesService?: ChangesService;
}) {
  const workspaceService = useMemo(() => service ?? createDefaultService(), [service]);
  const prototypeRepository = useMemo(() => repository ?? createDefaultRepository(), [repository]);
  const projectService = useMemo(
    () => suppliedProjectService ?? createProjectService(new TauriProjectNativeAdapter()),
    [suppliedProjectService],
  );
  const changesService = useMemo(
    () => suppliedChangesService ?? createDefaultChangesService(),
    [suppliedChangesService],
  );
  return (
    <HashRouter>
      <WorkspaceProvider service={workspaceService}>
        <AppRouter
          repository={prototypeRepository}
          projectService={projectService}
          changesService={changesService}
        />
      </WorkspaceProvider>
    </HashRouter>
  );
}
