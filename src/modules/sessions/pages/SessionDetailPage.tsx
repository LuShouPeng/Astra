import { ArrowLeft, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { appEventBus } from '../../../core/events/appEventBus';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { ChangesReview, type ChangesService } from '../../changes';
import { Timeline } from '../components/Timeline';
import { applyFollowUp, nextSessionTimestamp } from '../model/sessionTransitions';

type SessionTab = 'timeline' | 'changes';

export function SessionDetailPage({ changesService }: { changesService?: ChangesService }) {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const { snapshot, saveSnapshot, saving } = useWorkbench();
  const [tab, setTab] = useState<SessionTab>(
    searchParams.get('tab') === 'changes' ? 'changes' : 'timeline',
  );
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
        <button role="tab" aria-selected={tab === 'timeline'} onClick={() => setTab('timeline')}>
          Timeline <span>{events.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>
          Changes <span>{changes.length}</span>
        </button>
      </div>

      <div className={`session-content ${tab === 'changes' ? 'session-content--changes' : ''}`}>
        {tab === 'timeline' ? (
          <Timeline key={session.id} events={events} />
        ) : (
          <ChangesReview sessionId={session.id} service={changesService} />
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
