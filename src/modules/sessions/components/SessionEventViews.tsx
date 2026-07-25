import type { ProviderCapability } from '../../../core/contracts/agents';
import type { Project } from '../../../core/contracts/projects';
import type { AgentSession, CommandEvent, TestEvent } from '../../../core/contracts/sessions';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { TranslationKey, TranslationParams } from '../../../core/i18n/translations';

type Translate = (key: TranslationKey, params?: TranslationParams) => string;

const resultKeys = {
  running: 'result.running',
  passed: 'result.passed',
  failed: 'result.failed',
} as const satisfies Record<string, TranslationKey>;

function duration(value: number | undefined, t: Translate): string {
  return value === undefined ? t('session.notRecorded') : `${value} ms`;
}

export function TestsView({ events }: { events: readonly TestEvent[] }) {
  const { t } = useI18n();
  if (events.length === 0) return <p className="session-view-empty">{t('session.noTestEvents')}</p>;
  return (
    <section className="session-event-view" aria-label={t('session.testsLabel')}>
      {events.map((event) => (
        <article key={event.id}>
          <header>
            <code>{event.command}</code>
            <span data-status={event.status}>{t(resultKeys[event.status])}</span>
          </header>
          <dl>
            <div>
              <dt>{t('session.passed')}</dt>
              <dd>{t('session.passedCount', { count: event.passed })}</dd>
            </div>
            <div>
              <dt>{t('session.failedLabel')}</dt>
              <dd>{t('session.failedCount', { count: event.failed })}</dd>
            </div>
            <div>
              <dt>{t('session.duration')}</dt>
              <dd>{duration(event.durationMs, t)}</dd>
            </div>
          </dl>
        </article>
      ))}
    </section>
  );
}

export function CommandsView({ events }: { events: readonly CommandEvent[] }) {
  const { t, text } = useI18n();
  if (events.length === 0)
    return <p className="session-view-empty">{t('session.noCommandEvents')}</p>;
  return (
    <section className="session-event-view" aria-label={t('session.commandsLabel')}>
      {events.map((event) => (
        <article key={event.id}>
          <header>
            <code>{event.command}</code>
            <span data-status={event.status}>{t(resultKeys[event.status])}</span>
          </header>
          {event.outputSummary && <p>{text(event.outputSummary)}</p>}
          <dl>
            <div>
              <dt>{t('session.exitCode')}</dt>
              <dd>
                {event.exitCode === undefined
                  ? t('session.notRecorded')
                  : t('session.exitCodeValue', { code: event.exitCode })}
              </dd>
            </div>
            <div>
              <dt>{t('session.duration')}</dt>
              <dd>{duration(event.durationMs, t)}</dd>
            </div>
          </dl>
        </article>
      ))}
    </section>
  );
}

export function ContextView({
  session,
  project,
  capability,
}: {
  session: AgentSession;
  project?: Project;
  capability: ProviderCapability;
}) {
  const { language, t, text } = useI18n();
  const runtime = capability.displayOnly
    ? t('runtime.displayOnly')
    : capability.runtimeAvailable
      ? t('runtime.available')
      : t('runtime.mock');
  return (
    <section className="session-context" aria-label={t('session.contextLabel')}>
      <dl>
        <div>
          <dt>{t('session.provider')}</dt>
          <dd>{capability.label}</dd>
        </div>
        <div>
          <dt>{t('session.runtime')}</dt>
          <dd>{runtime}</dd>
        </div>
        <div>
          <dt>{t('session.project')}</dt>
          <dd>{project?.name ?? t('common.unknownProject')}</dd>
        </div>
        <div>
          <dt>{t('session.projectRoot')}</dt>
          <dd>{project?.rootPath ?? t('common.notAvailable')}</dd>
        </div>
        <div>
          <dt>{t('session.started')}</dt>
          <dd>
            {new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
              new Date(session.startedAt),
            )}
          </dd>
        </div>
        <div>
          <dt>{t('session.lastUpdate')}</dt>
          <dd>
            {new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
              new Date(session.updatedAt),
            )}
          </dd>
        </div>
        <div>
          <dt>{t('session.summaryLabel')}</dt>
          <dd>{session.summary ? text(session.summary) : t('session.noSummary')}</dd>
        </div>
      </dl>
    </section>
  );
}
