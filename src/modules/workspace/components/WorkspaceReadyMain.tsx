import { FolderCheck } from 'lucide-react';
import { useI18n } from '../../../core/i18n/I18nContext';
import { useWorkspace } from '../state/WorkspaceContext';

export default function WorkspaceReadyMain() {
  const { activeWorkspace } = useWorkspace();
  const { t } = useI18n();
  if (!activeWorkspace) return null;

  return (
    <main className="workspace-ready">
      <div className="workspace-ready__mark" aria-hidden="true">
        <FolderCheck size={28} />
      </div>
      <h1>{t('workspace.ready')}</h1>
      <p>{activeWorkspace.name}</p>
      <code title={activeWorkspace.rootPath}>{activeWorkspace.rootPath}</code>
    </main>
  );
}
