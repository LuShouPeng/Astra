import { AlertCircle, FolderOpen, Orbit, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { WorkspaceRecord } from '../../../core/contracts/workspace';
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { RecentWorkspaceRow } from '../components/RecentWorkspaceRow';
import { useWorkspace } from '../state/WorkspaceContext';

function LoadingRows() {
  return (
    <div className="recent-skeleton" aria-label="Loading recent workspaces">
      {[0, 1, 2].map((item) => (
        <div className="recent-skeleton__row" key={item}>
          <span />
          <div>
            <span />
            <span />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WelcomePage() {
  const {
    loadState,
    workspaces,
    selectedId,
    pendingAction,
    warning,
    error,
    chooseAndOpen,
    openRecent,
    removeRecent,
    selectWorkspace,
    dismissMessage,
  } = useWorkspace();
  const [removeTarget, setRemoveTarget] = useState<WorkspaceRecord | null>(null);
  const busy = pendingAction !== null;

  return (
    <div className="welcome-page">
      <aside className="welcome-actions">
        <div className="brand-lockup">
          <span className="brand-lockup__mark" aria-hidden="true">
            <Orbit size={26} />
          </span>
          <div>
            <strong>Astra Nexus</strong>
            <span>AI Coding Workbench</span>
          </div>
        </div>
        <div className="welcome-actions__body">
          <p className="eyebrow">Projects</p>
          <h1>Choose your workspace</h1>
          <p>Open a local project and continue in a focused desktop workbench.</p>
          <button
            className="button button--primary button--open-folder"
            onClick={() => void chooseAndOpen()}
            disabled={busy || loadState === 'loading'}
          >
            {pendingAction === 'choose' ? <span className="spinner" /> : <Plus size={18} />}
            {pendingAction === 'choose' ? 'Opening...' : 'Open Folder'}
          </button>
        </div>
        <footer>
          <span>Prototype</span>
          <span>v0.1.0</span>
        </footer>
      </aside>

      <main className="recent-panel">
        <header className="recent-panel__header">
          <div>
            <p className="eyebrow">Local projects</p>
            <h2>Recent Workspaces</h2>
          </div>
          <span>
            {workspaces.length} {workspaces.length === 1 ? 'workspace' : 'workspaces'}
          </span>
        </header>

        {(warning || error) && (
          <div className="notice" role={error ? 'alert' : 'status'}>
            <AlertCircle size={17} aria-hidden="true" />
            <span>{error ?? warning}</span>
            <button className="icon-button" aria-label="Dismiss message" onClick={dismissMessage}>
              <X size={16} />
            </button>
          </div>
        )}

        {loadState === 'loading' ? (
          <LoadingRows />
        ) : workspaces.length === 0 ? (
          <section className="empty-state">
            <div className="empty-state__icon" aria-hidden="true">
              <FolderOpen size={24} />
            </div>
            <h3>No recent workspaces</h3>
            <p>Open a local folder to add it here. Your project files stay untouched.</p>
          </section>
        ) : (
          <section className="recent-list" aria-label="Recent workspace list">
            {workspaces.map((workspace) => (
              <RecentWorkspaceRow
                key={workspace.id}
                workspace={workspace}
                selected={selectedId === workspace.id}
                opening={pendingAction === `open:${workspace.id}`}
                disabled={busy}
                onSelect={() => selectWorkspace(workspace.id)}
                onOpen={() => void openRecent(workspace.id)}
                onRemove={() => setRemoveTarget(workspace)}
              />
            ))}
          </section>
        )}
      </main>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove from Recent?"
        description={`This removes ${removeTarget?.name ?? 'the workspace'} from Astra Nexus only. It will not delete the local folder or any files inside it.`}
        confirmLabel="Remove"
        pending={removeTarget ? pendingAction === `remove:${removeTarget.id}` : false}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (!removeTarget) return;
          void removeRecent(removeTarget.id).then(() => setRemoveTarget(null));
        }}
      />
    </div>
  );
}
