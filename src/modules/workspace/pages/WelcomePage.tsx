import { AlertCircle, FolderOpen, Orbit, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { WorkspaceRecord } from '../../../core/contracts/workspace';
import { useI18n } from '../../../core/i18n/I18nContext';
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog';
import { RecentWorkspaceRow } from '../components/RecentWorkspaceRow';
import { useWorkspace } from '../state/WorkspaceContext';

function LoadingRows() {
  const { t } = useI18n();
  return (
    <div className="recent-skeleton" aria-label={t('workspace.loadingRecent')}>
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
  const { t } = useI18n();
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
            <span>{t('workspace.productCategory')}</span>
          </div>
        </div>
        <div className="welcome-actions__body">
          <p className="eyebrow">{t('workspace.eyebrow')}</p>
          <h1>{t('workspace.chooseTitle')}</h1>
          <p>{t('workspace.chooseDescription')}</p>
          <button
            className="button button--primary button--open-folder"
            onClick={() => void chooseAndOpen()}
            disabled={busy || loadState === 'loading'}
          >
            {pendingAction === 'choose' ? <span className="spinner" /> : <Plus size={18} />}
            {pendingAction === 'choose' ? t('workspace.opening') : t('workspace.openFolder')}
          </button>
        </div>
        <footer>
          <span>{t('status.localWorkspace')}</span>
          <span>v0.1.0</span>
        </footer>
      </aside>

      <main className="recent-panel">
        <header className="recent-panel__header">
          <div>
            <p className="eyebrow">{t('workspace.localProjects')}</p>
            <h2>{t('workspace.recentTitle')}</h2>
          </div>
          <span>
            {t(workspaces.length === 1 ? 'workspace.countOne' : 'workspace.countMany', {
              count: workspaces.length,
            })}
          </span>
        </header>

        {(warning || error) && (
          <div className="notice" role={error ? 'alert' : 'status'}>
            <AlertCircle size={17} aria-hidden="true" />
            <span>{error ?? warning}</span>
            <button
              className="icon-button"
              aria-label={t('workspace.dismissMessage')}
              onClick={dismissMessage}
            >
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
            <h3>{t('workspace.emptyTitle')}</h3>
            <p>{t('workspace.emptyDescription')}</p>
          </section>
        ) : (
          <section className="recent-list" aria-label={t('workspace.recentList')}>
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
        title={t('workspace.removeTitle')}
        description={t('workspace.removeDescription', {
          name: removeTarget?.name ?? t('workspace.recentTitle'),
        })}
        confirmLabel={t('workspace.remove')}
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
