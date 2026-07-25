import { Construction } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '../../core/i18n/I18nContext';

export function ComingSoonPage() {
  const { t } = useI18n();
  const location = useLocation();
  const segment = location.pathname.split('/').filter(Boolean)[0] ?? 'page';
  const labels: Record<string, string> = {
    projects: t('nav.projects'),
    sessions: t('placeholder.session'),
    attention: t('nav.attention'),
    changes: t('nav.changes'),
    settings: t('nav.settings'),
  };
  return (
    <div className="route-placeholder">
      <Construction size={24} aria-hidden="true" />
      <h1>{labels[segment] ?? t('placeholder.page')}</h1>
      <p>{t('placeholder.description')}</p>
    </div>
  );
}
