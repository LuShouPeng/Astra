import { ArrowLeft, Orbit } from 'lucide-react';
import { Outlet } from 'react-router-dom';
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
        <button className="title-bar__back" onClick={onClose} aria-label="Back to Projects">
          <ArrowLeft size={15} aria-hidden="true" />
          <span>Projects</span>
        </button>
      </header>
      <div className="workbench-shell__body">
        <ActivityRail />
        <aside className="sidebar-slot">
          {snapshot ? (
            <ProjectSessionTree projects={snapshot.projects} sessions={snapshot.sessions} />
          ) : (
            <div className="slot-loading" aria-label="Loading project tree" />
          )}
        </aside>
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
