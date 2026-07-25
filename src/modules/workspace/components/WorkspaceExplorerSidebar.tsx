import { ChevronDown, Folder } from 'lucide-react';
import { useI18n } from '../../../core/i18n/I18nContext';
import { useWorkspace } from '../state/WorkspaceContext';

export default function WorkspaceExplorerSidebar() {
  const { activeWorkspace } = useWorkspace();
  const { t } = useI18n();
  if (!activeWorkspace) return null;

  return (
    <section className="explorer-sidebar" aria-label={t('workspace.explorer')}>
      <header className="explorer-sidebar__header">{t('workspace.explorerTitle')}</header>
      <div className="explorer-sidebar__section-title" title={activeWorkspace.name}>
        {activeWorkspace.name}
      </div>
      <div className="explorer-sidebar__root" title={activeWorkspace.rootPath}>
        <ChevronDown size={14} aria-hidden="true" />
        <Folder size={16} aria-hidden="true" />
        <span>{activeWorkspace.name}</span>
      </div>
    </section>
  );
}
