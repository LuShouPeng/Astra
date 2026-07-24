import { ArrowLeft, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { appEventBus } from '../../../core/events/appEventBus';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { ChangesReview, type ChangesService } from '../../changes';
import { CommandsView, ContextView, TestsView } from '../components/SessionEventViews';
import { Timeline } from '../components/Timeline';
import { applyFollowUp, nextSessionTimestamp } from '../model/sessionTransitions';

type SessionTab = 'timeline' | 'changes' | 'tests' | 'commands' | 'context';

function sessionTab(value: string | null): SessionTab {
  return value === 'changes' || value === 'tests' || value === 'commands' || value === 'context'
    ? value
    : 'timeline';
}

export function SessionDetailPage({ changesService }: { changesService?: ChangesService }) {
  const { sessionId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { snapshot, saveSnapshot, saving } = useWorkbench();
  const tab = sessionTab(searchParams.get('tab'));
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!snapshot) return <div className="session-state">Loading session...</div>;
  const session = snapshot.sessions.find((item) => item.id === sessionId);
  if (!session)
    return (
      <div className="session-state" role="alert">
        Session not found.
      </div>
    );
  const project = snapshot.projects.find((item) => item.id === session.projectId);
  const capability = snapshot.providerCapabilities[session.provider];
  const events = snapshot.timelineEvents.filter((event) => event.sessionId === session.id);
  const changes = snapshot.fileChanges.filter((change) => change.sessionId === session.id);
  const tests = events.filter((event) => event.type === 'test');
  const commands = events.filter((event) => event.type === 'command');

  function selectTab(nextTab: SessionTab) {
    setSearchParams(nextTab === 'timeline' ? {} : { tab: nextTab }, { replace: true });
  }

  async function submitFollowUp(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const next = applyFollowUp(snapshot!, session!.id, message, nextSessionTimestamp(snapshot!));
      const previousStatus = session!.status;
      await saveSnapshot(next);
      const updated = next.sessions.find((item) => item.id === session!.id)!;
      appEventBus.emit('session:status-changed', { session: updated, previousStatus });
      setMessage('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The follow-up could not be saved.');
    }
  }

  return (
    <div className="session-page">
      <header className="session-header">
        <Link
          className="session-header__back"
          to="/command-center"
          aria-label="Back to Command Center"
        >
          <ArrowLeft size={16} />
        </Link>
        <div className="session-header__title">
          <p>
            {project?.name ?? 'Unknown project'} · {capability.label}
          </p>
          <h1>{session.title}</h1>
        </div>
        <span className={`session-status session-status--${session.status}`}>{session.status}</span>
        {capability.displayOnly && <span className="display-only-badge">Display only</span>}
      </header>

      <div className="session-summary" aria-label="Session summary">
        <span>
          <small>Current action</small>
          {session.currentAction ?? 'No active operation'}
        </span>
        <span>
          <small>Files changed</small>
          {session.changedFilesCount}
        </span>
        <span>
          <small>Tests</small>
          {session.testStatus.replace('_', ' ')}
        </span>
      </div>

      <div className="session-tabs" role="tablist" aria-label="Session views">
        <button role="tab" aria-selected={tab === 'timeline'} onClick={() => selectTab('timeline')}>
          Timeline <span>{events.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'changes'} onClick={() => selectTab('changes')}>
          Changes <span>{changes.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'tests'} onClick={() => selectTab('tests')}>
          Tests <span>{tests.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'commands'} onClick={() => selectTab('commands')}>
          Commands <span>{commands.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'context'} onClick={() => selectTab('context')}>
          Context
        </button>
      </div>

      <div className={`session-content ${tab === 'changes' ? 'session-content--changes' : ''}`}>
        {tab === 'timeline' && <Timeline key={session.id} events={events} />}
        {tab === 'changes' && <ChangesReview sessionId={session.id} service={changesService} />}
        {tab === 'tests' && <TestsView events={tests} />}
        {tab === 'commands' && <CommandsView events={commands} />}
        {tab === 'context' && (
          <ContextView session={session} project={project} capability={capability} />
        )}
      </div>

      <form className="follow-up" onSubmit={(event) => void submitFollowUp(event)}>
        <label htmlFor="follow-up-message">Follow-up message</label>
        <textarea
          id="follow-up-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          disabled={capability.displayOnly || saving}
          rows={2}
        />
        <button
          className="button button--primary"
          type="submit"
          aria-label="Send follow-up"
          disabled={capability.displayOnly || saving || message.trim().length === 0}
        >
          <Send size={16} aria-hidden="true" />
          Send
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </div>
  );
}
