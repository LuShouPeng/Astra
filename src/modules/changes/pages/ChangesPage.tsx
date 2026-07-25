import { ChangesReview } from '../components/ChangesReview';
import type { ChangesService } from '../services/changesService';
import { useI18n } from '../../../core/i18n/I18nContext';

export function ChangesPage({ service }: { service?: ChangesService }) {
  const { t } = useI18n();
  return (
    <div className="changes-page">
      <header className="changes-header">
        <div>
          <p className="eyebrow">{t('changes.eyebrow')}</p>
          <h1>{t('changes.pageTitle')}</h1>
        </div>
        <p>{t('changes.prototypeOnly')}</p>
      </header>
      <ChangesReview service={service} />
    </div>
  );
}
