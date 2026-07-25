import { ArrowLeft, Orbit } from 'lucide-react';
import { Outlet, useLocation } from 'react-router-dom';
import { useI18n } from '../../core/i18n/I18nContext';
import { useWorkbench } from '../../core/state/WorkbenchContext';
import { useWorkspace } from '../../modules/workspace/state/WorkspaceContext';
import { ActivityRail } from './ActivityRail';
import { ProjectSessionTree } from './ProjectSessionTree';
import { StatusBar } from './StatusBar';
import { useWorkbenchShortcuts } from './useWorkbenchShortcuts';

export function WorkbenchShell() {
  const { activeWorkspace, closeWorkspace } = useWorkspace();
  if (!activeWorkspace) return null;

  return <WorkbenchShellContent workspaceName={activeWorkspace.name} onClose={closeWorkspace} />;
}

function WorkbenchShellContent({
  workspaceName,
  onClose,
}: {
  workspaceName: string;
  onClose: () => void;
}) {
  const { snapshot, warning, saving } = useWorkbench();
  const { t } = useI18n();
  const location = useLocation();
  const controlPlane = /^\/(workflows|runs|extensions)(\/|$)/.test(location.pathname);
  useWorkbenchShortcuts();

  return (
    <div className="workbench-shell">
      <header className="title-bar">
        <div className="title-bar__brand">
          <Orbit size={16} aria-hidden="true" />
          <span>Astra Nexus</span>
        </div>
        <div className="title-bar__workspace" title={workspaceName}>
          {workspaceName}
        </div>
        <button
          className="title-bar__back"
          onClick={onClose}
          aria-label={t('shell.backToProjects')}
        >
          <ArrowLeft size={15} aria-hidden="true" />
          <span>{t('nav.projects')}</span>
        </button>
      </header>
      <div className={`workbench-shell__body${controlPlane ? ' workbench-shell__body--wide' : ''}`}>
        <ActivityRail />
        {!controlPlane && (
          <aside className="sidebar-slot">
            {snapshot ? (
              <ProjectSessionTree projects={snapshot.projects} sessions={snapshot.sessions} />
            ) : (
              <div className="slot-loading" aria-label={t('shell.loadingProjectTree')} />
            )}
          </aside>
        )}
        <main className="main-slot">
          {warning && (
            <div className="workbench-warning" role="status">
              {warning}
            </div>
          )}
          <Outlet />
        </main>
      </div>
      <StatusBar workspaceName={workspaceName} saving={saving} />
    </div>
  );
}
