import {
  Bot,
  CheckCircle2,
  FilePenLine,
  MessageSquare,
  ShieldQuestion,
  TerminalSquare,
  TestTube2,
} from 'lucide-react';
import type { TimelineEvent } from '../../../core/contracts/sessions';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { TranslationKey, TranslationParams } from '../../../core/i18n/translations';
import { useState } from 'react';

const EVENT_BATCH_SIZE = 100;

const eventMeta = {
  user_message: { labelKey: 'event.you', icon: MessageSquare },
  agent_message: { labelKey: 'event.agent', icon: Bot },
  command: { labelKey: 'activity.command', icon: TerminalSquare },
  file_change: { labelKey: 'activity.fileChange', icon: FilePenLine },
  test: { labelKey: 'activity.test', icon: TestTube2 },
  approval: { labelKey: 'activity.approval', icon: ShieldQuestion },
  status: { labelKey: 'activity.status', icon: CheckCircle2 },
} as const;

type Translate = (key: TranslationKey, params?: TranslationParams) => string;

const resultKeys = {
  running: 'result.running',
  passed: 'result.passed',
  failed: 'result.failed',
} as const satisfies Record<string, TranslationKey>;

const riskKeys = {
  low: 'risk.low',
  medium: 'risk.medium',
  high: 'risk.high',
} as const satisfies Record<string, TranslationKey>;

const decisionKeys = {
  pending: 'decision.pending',
  approved: 'decision.approved',
  rejected: 'decision.rejected',
} as const satisfies Record<string, TranslationKey>;

const statusKeys = {
  idle: 'session.status.idle',
  running: 'session.status.running',
  waiting: 'session.status.waiting',
  completed: 'session.status.completed',
  failed: 'session.status.failed',
  stopped: 'session.status.stopped',
} as const satisfies Record<string, TranslationKey>;

function EventContent({ event, t }: { event: TimelineEvent; t: Translate }) {
  switch (event.type) {
    case 'user_message':
    case 'agent_message':
    case 'file_change':
      return <p>{event.content}</p>;
    case 'command':
      return (
        <>
          <code>{event.command}</code>
          {event.outputSummary && <p>{event.outputSummary}</p>}
          <small>
            {t(resultKeys[event.status])}
            {event.exitCode !== undefined
              ? ` · ${t('event.exitCodeInline', { code: event.exitCode })}`
              : ''}
          </small>
        </>
      );
    case 'test':
      return (
        <>
          <code>{event.command}</code>
          <p>{t('event.testSummary', { passed: event.passed, failed: event.failed })}</p>
          <small>{t(resultKeys[event.status])}</small>
        </>
      );
    case 'approval':
      return (
        <>
          <p>{event.request}</p>
          <small>
            {t('event.risk', { risk: t(riskKeys[event.risk]) })} · {t(decisionKeys[event.decision])}
          </small>
        </>
      );
    case 'status':
      return (
        <>
          <p>{event.content}</p>
          <small>
            {t('event.statusTransition', {
              from: t(statusKeys[event.from]),
              to: t(statusKeys[event.to]),
            })}
          </small>
        </>
      );
  }
}

export function Timeline({ events }: { events: readonly TimelineEvent[] }) {
  const { language, t } = useI18n();
  const [visibleCount, setVisibleCount] = useState(EVENT_BATCH_SIZE);
  const ordered = [...events].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const visible = ordered.slice(-visibleCount);
  const hiddenCount = Math.max(0, ordered.length - visible.length);
  const nextBatch = Math.min(EVENT_BATCH_SIZE, hiddenCount);
  return (
    <section className="timeline" aria-label={t('event.timeline')}>
      {hiddenCount > 0 && (
        <button
          className="timeline__load-earlier"
          onClick={() => setVisibleCount((current) => current + EVENT_BATCH_SIZE)}
        >
          {t('event.showEarlier', { count: nextBatch })}
        </button>
      )}
      {visible.map((event) => {
        const meta = eventMeta[event.type];
        const Icon = meta.icon;
        return (
          <article className={`timeline-event timeline-event--${event.type}`} key={event.id}>
            <div className="timeline-event__icon">
              <Icon size={15} aria-hidden="true" />
            </div>
            <div className="timeline-event__body">
              <header>
                <strong>{t(meta.labelKey)}</strong>
                <time dateTime={event.timestamp}>
                  {new Intl.DateTimeFormat(language, {
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(event.timestamp))}
                </time>
              </header>
              <EventContent event={event} t={t} />
            </div>
          </article>
        );
      })}
    </section>
  );
}
