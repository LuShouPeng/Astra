import { Archive, ArchiveRestore, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../../core/i18n/I18nContext';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import {
  searchSessionLibrary,
  setSessionArchived,
  type SessionLibraryScope,
} from '../model/sessionLibrary';

export function SessionLibraryPage() {
  const { t, text } = useI18n();
  const { snapshot, saveSnapshot, saving } = useWorkbench();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SessionLibraryScope>('all');
  const results = useMemo(
    () => (snapshot ? searchSessionLibrary(snapshot, query, scope) : []),
    [query, scope, snapshot],
  );
  if (!snapshot) return <div className="session-library-state">{t('sessionLibrary.loading')}</div>;

  return (
    <div className="session-library-page">
      <header className="session-library-header">
        <div>
          <p className="eyebrow">{t('sessionLibrary.eyebrow')}</p>
          <h1>{t('nav.sessionLibrary')}</h1>
        </div>
        <strong>{t('sessionLibrary.count', { count: results.length })}</strong>
      </header>
      <div className="session-library-toolbar">
        <label>
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">{t('sessionLibrary.search')}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('sessionLibrary.search')}
          />
        </label>
        <div role="tablist" aria-label={t('sessionLibrary.scope')}>
          {(['all', 'active', 'archived'] as const).map((value) => (
            <button
              key={value}
              role="tab"
              aria-selected={scope === value}
              onClick={() => setScope(value)}
            >
              {t(`sessionLibrary.${value}`)}
            </button>
          ))}
        </div>
      </div>
      <section className="session-library-results" aria-label={t('sessionLibrary.results')}>
        {results.map(({ session, projectName, matchingExcerpt }) => (
          <article key={session.id}>
            <div>
              <span>{projectName}</span>
              <span>{snapshot.providerCapabilities[session.provider].label}</span>
              <span>{t(`session.status.${session.status}`)}</span>
            </div>
            <h2>
              <Link to={`/sessions/${session.id}`}>{text(session.title)}</Link>
            </h2>
            <p>{text(matchingExcerpt ?? session.summary ?? t('session.noSummary'))}</p>
            <footer>
              <time dateTime={session.updatedAt}>
                {new Date(session.updatedAt).toLocaleString()}
              </time>
              <button
                className="button button--compact"
                disabled={saving}
                onClick={() =>
                  void saveSnapshot(setSessionArchived(snapshot, session.id, !session.archived))
                }
              >
                {session.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                {t(session.archived ? 'sessionLibrary.restore' : 'sessionLibrary.archive')}
              </button>
            </footer>
          </article>
        ))}
        {results.length === 0 && (
          <div className="session-library-empty">{t('sessionLibrary.empty')}</div>
        )}
      </section>
    </div>
  );
}
