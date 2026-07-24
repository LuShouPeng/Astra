import type { ProviderCapability } from '../../../core/contracts/agents';
import type { Project } from '../../../core/contracts/projects';
import type { AgentSession, CommandEvent, TestEvent } from '../../../core/contracts/sessions';

function duration(value?: number): string {
  return value === undefined ? 'Not recorded' : `${value} ms`;
}

export function TestsView({ events }: { events: readonly TestEvent[] }) {
  if (events.length === 0) return <p className="session-view-empty">No test events recorded.</p>;
  return (
    <section className="session-event-view" aria-label="Session tests">
      {events.map((event) => (
        <article key={event.id}>
          <header>
            <code>{event.command}</code>
            <span data-status={event.status}>{event.status}</span>
          </header>
          <dl>
            <div>
              <dt>Passed</dt>
              <dd>{event.passed} passed</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{event.failed} failed</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{duration(event.durationMs)}</dd>
            </div>
          </dl>
        </article>
      ))}
    </section>
  );
}

export function CommandsView({ events }: { events: readonly CommandEvent[] }) {
  if (events.length === 0) return <p className="session-view-empty">No command events recorded.</p>;
  return (
    <section className="session-event-view" aria-label="Session commands">
      {events.map((event) => (
        <article key={event.id}>
          <header>
            <code>{event.command}</code>
            <span data-status={event.status}>{event.status}</span>
          </header>
          {event.outputSummary && <p>{event.outputSummary}</p>}
          <dl>
            <div>
              <dt>Exit code</dt>
              <dd>
                {event.exitCode === undefined ? 'Not recorded' : `Exit code ${event.exitCode}`}
              </dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{duration(event.durationMs)}</dd>
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
  const runtime = capability.displayOnly
    ? 'Display only'
    : capability.runtimeAvailable
      ? 'Available'
      : 'Deterministic mock';
  return (
    <section className="session-context" aria-label="Session context">
      <dl>
        <div>
          <dt>Provider</dt>
          <dd>{capability.label}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{runtime}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{project?.name ?? 'Unknown project'}</dd>
        </div>
        <div>
          <dt>Project root</dt>
          <dd>{project?.rootPath ?? 'Not available'}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>
            {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
              new Date(session.startedAt),
            )}
          </dd>
        </div>
        <div>
          <dt>Last update</dt>
          <dd>
            {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
              new Date(session.updatedAt),
            )}
          </dd>
        </div>
        <div>
          <dt>Summary</dt>
          <dd>{session.summary ?? 'No summary recorded.'}</dd>
        </div>
      </dl>
    </section>
  );
}
