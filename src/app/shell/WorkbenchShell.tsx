import { ArrowLeft, Orbit } from 'lucide-react';
import { getEnabledModules } from '../../core/registry/moduleRegistry';
import { useWorkspace } from '../../modules/workspace/state/WorkspaceContext';
import { ActivityRail } from './ActivityRail';
import { MainSlot } from './MainSlot';
import { SidebarSlot } from './SidebarSlot';
import { StatusBar } from './StatusBar';

export function WorkbenchShell() {
  const { activeWorkspace, closeWorkspace } = useWorkspace();
  if (!activeWorkspace) return null;
  const [activeModule] = getEnabledModules({ workspace: activeWorkspace });
  if (!activeModule) return null;

  return (
    <div className="workbench-shell">
      <header className="title-bar">
        <div className="title-bar__brand">
          <Orbit size={16} aria-hidden="true" />
          <span>Astra Nexus</span>
        </div>
        <div className="title-bar__workspace" title={activeWorkspace.name}>
          {activeWorkspace.name}
        </div>
        <button className="title-bar__back" onClick={closeWorkspace} aria-label="Back to Projects">
          <ArrowLeft size={15} />
          <span>Projects</span>
        </button>
      </header>
      <div className="workbench-shell__body">
        <ActivityRail />
        <SidebarSlot component={activeModule.sidebar} />
        <MainSlot component={activeModule.main} />
      </div>
      <StatusBar workspaceName={activeWorkspace.name} />
    </div>
  );
}
