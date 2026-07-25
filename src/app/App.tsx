import { lazy, Suspense, useEffect, useMemo, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { Project, ProjectGitSummary } from '../core/contracts/projects';
import type { WorkspaceService } from '../core/contracts/workspace';
import {
  createPrototypeRepository,
  type PrototypeRepository,
} from '../core/data/prototypeRepository';
import { TauriPrototypeStore } from '../core/data/tauriPrototypeStore';
import { appEventBus } from '../core/events/appEventBus';
import { I18nProvider } from '../core/i18n/I18nContext';
import { startThemePreference } from '../core/preferences/appearance';
import { WorkbenchProvider, useWorkbench } from '../core/state/WorkbenchContext';
import { AttentionPage } from '../modules/attention';
import {
  ChangesPage,
  createChangesService,
  TauriChangesNativeAdapter,
  type ChangesService,
} from '../modules/changes';
import { CommandCenterPage } from '../modules/command-center';
import { createDemoSnapshot } from '../modules/demo';
import {
  createDesktopNotificationService,
  DesktopNotificationBridge,
  NotificationsPage,
  TauriDesktopNotificationAdapter,
  type DesktopNotificationService,
} from '../modules/notifications';
import {
  createProjectService,
  ProjectDetailPage,
  ProjectsPage,
  TauriProjectNativeAdapter,
  type ProjectService,
} from '../modules/projects';
import { SessionDetailPage, SessionLibraryPage } from '../modules/sessions';
import { SettingsPage } from '../modules/settings';
import { WelcomePage } from '../modules/workspace';
import { createTauriWorkspaceAdapters } from '../modules/workspace/services/workspaceAdapters';
import { createWorkspaceService } from '../modules/workspace/services/workspaceService';
import { WorkspaceProvider, useWorkspace } from '../modules/workspace/state/WorkspaceContext';
import { resolveAppRoute } from './routes';
import { WorkbenchShell } from './shell/WorkbenchShell';

const WorkflowsPage = lazy(() =>
  import('../modules/workflows/pages/WorkflowsPage').then((module) => ({
    default: module.WorkflowsPage,
  })),
);
const WorkflowEditorPage = lazy(() =>
  import('../modules/workflows/pages/WorkflowEditorPage').then((module) => ({
    default: module.WorkflowEditorPage,
  })),
);
const WorkflowRunPage = lazy(() =>
  import('../modules/workflows/pages/WorkflowRunPage').then((module) => ({
    default: module.WorkflowRunPage,
  })),
);
const ExtensionsPage = lazy(() =>
  import('../modules/extensions/pages/ExtensionsPage').then((module) => ({
    default: module.ExtensionsPage,
  })),
);

function lazyPage(page: ReactNode) {
  return <Suspense fallback={<div className="slot-loading" />}>{page}</Suspense>;
}

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

function createDefaultDesktopNotificationService(): DesktopNotificationService {
  return createDesktopNotificationService(new TauriDesktopNotificationAdapter());
}

function ProjectsRoute({ service }: { service: ProjectService }) {
  const { chooseAndOpen, error: addProjectError } = useWorkspace();
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

  return (
    <ProjectsPage service={service} onAddProject={addProject} addProjectError={addProjectError} />
  );
}

function AppRouter({
  repository,
  projectService,
  changesService,
  desktopNotifications,
}: {
  repository: PrototypeRepository;
  projectService: ProjectService;
  changesService: ChangesService;
  desktopNotifications: DesktopNotificationService;
}) {
  const { activeWorkspace } = useWorkspace();
  if (resolveAppRoute(activeWorkspace) === 'projects') return <WelcomePage />;
  const workspaceId = activeWorkspace!.id;

  return (
    <WorkbenchProvider repository={repository}>
      <DesktopNotificationBridge service={desktopNotifications} />
      <Routes>
        <Route element={<WorkbenchShell />}>
          <Route index element={<Navigate replace to="/command-center" />} />
          <Route path="command-center" element={<CommandCenterPage />} />
          <Route path="projects" element={<ProjectsRoute service={projectService} />} />
          <Route path="workflows" element={lazyPage(<WorkflowsPage projectId={workspaceId} />)} />
          <Route path="workflows/:workflowId" element={lazyPage(<WorkflowEditorPage />)} />
          <Route path="runs/:runId" element={lazyPage(<WorkflowRunPage />)} />
          <Route path="extensions" element={lazyPage(<ExtensionsPage />)} />
          <Route
            path="projects/:projectId"
            element={<ProjectDetailPage service={projectService} />}
          />
          <Route
            path="sessions/:sessionId"
            element={
              <SessionDetailPage changesService={changesService} projectService={projectService} />
            }
          />
          <Route path="sessions" element={<SessionLibraryPage />} />
          <Route path="attention" element={<AttentionPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="changes" element={<ChangesPage service={changesService} />} />
          <Route
            path="settings"
            element={<SettingsPage desktopNotifications={desktopNotifications} />}
          />
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
  desktopNotifications: suppliedDesktopNotifications,
}: {
  service?: WorkspaceService;
  repository?: PrototypeRepository;
  projectService?: ProjectService;
  changesService?: ChangesService;
  desktopNotifications?: DesktopNotificationService;
}) {
  useEffect(() => startThemePreference(), []);
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
  const desktopNotifications = useMemo(
    () => suppliedDesktopNotifications ?? createDefaultDesktopNotificationService(),
    [suppliedDesktopNotifications],
  );

  return (
    <I18nProvider>
      <HashRouter>
        <WorkspaceProvider service={workspaceService}>
          <AppRouter
            repository={prototypeRepository}
            projectService={projectService}
            changesService={changesService}
            desktopNotifications={desktopNotifications}
          />
        </WorkspaceProvider>
      </HashRouter>
    </I18nProvider>
  );
}
