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
import { useState } from 'react';

const EVENT_BATCH_SIZE = 100;

const eventMeta = {
  user_message: { label: 'You', icon: MessageSquare },
  agent_message: { label: 'Agent', icon: Bot },
  command: { label: 'Command', icon: TerminalSquare },
  file_change: { label: 'File change', icon: FilePenLine },
  test: { label: 'Test', icon: TestTube2 },
  approval: { label: 'Approval', icon: ShieldQuestion },
  status: { label: 'Status', icon: CheckCircle2 },
} as const;

function EventContent({ event }: { event: TimelineEvent }) {
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
            {event.status}
            {event.exitCode !== undefined ? ` · exit ${event.exitCode}` : ''}
          </small>
        </>
      );
    case 'test':
      return (
        <>
          <code>{event.command}</code>
          <p>
            {event.passed} passed, {event.failed} failed
          </p>
          <small>{event.status}</small>
        </>
      );
    case 'approval':
      return (
        <>
          <p>{event.request}</p>
          <small>
            {event.risk} risk · {event.decision}
          </small>
        </>
      );
    case 'status':
      return (
        <>
          <p>{event.content}</p>
          <small>
            {event.from} to {event.to}
          </small>
        </>
      );
  }
}

export function Timeline({ events }: { events: readonly TimelineEvent[] }) {
  const [visibleCount, setVisibleCount] = useState(EVENT_BATCH_SIZE);
  const ordered = [...events].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const visible = ordered.slice(-visibleCount);
  const hiddenCount = Math.max(0, ordered.length - visible.length);
  const nextBatch = Math.min(EVENT_BATCH_SIZE, hiddenCount);
  return (
    <section className="timeline" aria-label="Session timeline">
      {hiddenCount > 0 && (
        <button
          className="timeline__load-earlier"
          onClick={() => setVisibleCount((current) => current + EVENT_BATCH_SIZE)}
        >
          Show {nextBatch} earlier events
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
                <strong>{meta.label}</strong>
                <time dateTime={event.timestamp}>
                  {new Intl.DateTimeFormat(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(event.timestamp))}
                </time>
              </header>
              <EventContent event={event} />
            </div>
          </article>
        );
      })}
    </section>
  );
}
