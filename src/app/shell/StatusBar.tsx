import { CircleCheck } from 'lucide-react';
import { useI18n } from '../../core/i18n/I18nContext';

export function StatusBar({ workspaceName, saving }: { workspaceName: string; saving: boolean }) {
  const { t } = useI18n();
  return (
    <footer className="status-bar">
      <span role="status" aria-label={t('status.label')} aria-live="polite">
        {saving ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          <CircleCheck size={13} aria-hidden="true" />
        )}
        {saving ? t('status.saving') : t('status.ready')}
      </span>
      <span className="status-bar__workspace" title={workspaceName}>
        {workspaceName}
      </span>
      <span>{t('status.prototype')}</span>
    </footer>
  );
}
