import {
  ArrowLeft,
  Check,
  FolderOpen,
  GitCompareArrows,
  MessageSquare,
  Send,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { appEventBus } from '../../../core/events/appEventBus';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { ChangesReview, type ChangesService } from '../../changes';
import { resolveAttention } from '../../attention';
import type { ProjectService } from '../../projects';
import { CommandsView, ContextView, TestsView } from '../components/SessionEventViews';
import { Timeline } from '../components/Timeline';
import { applyFollowUp, nextSessionTimestamp, stopSession } from '../model/sessionTransitions';

type SessionTab = 'timeline' | 'changes' | 'tests' | 'commands' | 'context';

function sessionTab(value: string | null): SessionTab {
  return value === 'changes' || value === 'tests' || value === 'commands' || value === 'context'
    ? value
    : 'timeline';
}

function formatDuration(startedAt: string, endedAt: string): string {
  const minutes = Math.max(
    0,
    Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000),
  );
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${minutes}m`;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

export function SessionDetailPage({
  changesService,
  projectService,
}: {
  changesService?: ChangesService;
  projectService?: ProjectService;
}) {
  const { sessionId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { snapshot, saveSnapshot, saving } = useWorkbench();
  const tab = sessionTab(searchParams.get('tab'));
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [openingProject, setOpeningProject] = useState(false);
  const followUpRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (searchParams.get('focus') === 'message') followUpRef.current?.focus();
  }, [searchParams]);
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
  const approval = snapshot.attentionItems.find(
    (item) => item.sessionId === session.id && item.type === 'approval' && !item.resolved,
  );
  const canStop =
    !capability.displayOnly && (session.status === 'running' || session.status === 'waiting');
  const canOpenProject = Boolean(
    projectService && project?.source === 'local' && project.status === 'available',
  );
  const duration = formatDuration(session.startedAt, session.completedAt ?? session.updatedAt);

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

  async function resolveApproval(action: 'approve' | 'reject') {
    if (!approval) return;
    setError(null);
    try {
      const previousStatus = session!.status;
      const next = resolveAttention(snapshot!, approval.id, action);
      await saveSnapshot(next);
      const updated = next.sessions.find((item) => item.id === session!.id)!;
      appEventBus.emit('attention:resolved', {
        attentionId: approval.id,
        sessionId: session!.id,
      });
      if (updated.status !== previousStatus) {
        appEventBus.emit('session:status-changed', { session: updated, previousStatus });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The approval could not be updated.');
    }
  }

  async function stop() {
    setError(null);
    try {
      const previousStatus = session!.status;
      const next = stopSession(snapshot!, session!.id, nextSessionTimestamp(snapshot!));
      await saveSnapshot(next);
      const updated = next.sessions.find((item) => item.id === session!.id)!;
      appEventBus.emit('session:status-changed', { session: updated, previousStatus });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Session could not be stopped.');
    }
  }

  async function openProject() {
    if (!projectService || !project || openingProject) return;
    setError(null);
    setOpeningProject(true);
    try {
      await projectService.openDirectory(project);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The project directory could not open.');
    } finally {
      setOpeningProject(false);
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
            {project?.name ?? 'Unknown project'} /{' '}
            <span className="session-header__provider">{capability.label}</span>
          </p>
          <h1>{session.title}</h1>
        </div>
        <span className={`session-status session-status--${session.status}`}>{session.status}</span>
        {capability.displayOnly && <span className="display-only-badge">Display only</span>}
      </header>

      <div className="session-header__actions" aria-label="Session actions">
        <button
          className="button button--secondary button--compact"
          type="button"
          disabled={capability.displayOnly}
          onClick={() => followUpRef.current?.focus()}
        >
          <MessageSquare size={15} aria-hidden="true" />
          Send Message
        </button>
        {approval && (
          <>
            <button
              className="button button--primary button--compact"
              type="button"
              disabled={saving}
              onClick={() => void resolveApproval('approve')}
            >
              <Check size={15} aria-hidden="true" />
              Approve
            </button>
            <button
              className="button button--secondary button--compact"
              type="button"
              disabled={saving}
              onClick={() => void resolveApproval('reject')}
            >
              <X size={15} aria-hidden="true" />
              Reject
            </button>
          </>
        )}
        {canStop && (
          <button
            className="button button--secondary button--compact"
            type="button"
            disabled={saving}
            onClick={() => void stop()}
          >
            <Square size={14} aria-hidden="true" />
            Stop
          </button>
        )}
        <button
          className="button button--secondary button--compact"
          type="button"
          disabled={!canOpenProject || openingProject}
          title={canOpenProject ? undefined : 'Only local projects can be opened.'}
          onClick={() => void openProject()}
        >
          {openingProject ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <FolderOpen size={15} aria-hidden="true" />
          )}
          {openingProject ? 'Opening Project' : 'Open Project'}
        </button>
        <button
          className="button button--secondary button--compact"
          type="button"
          onClick={() => selectTab('changes')}
        >
          <GitCompareArrows size={15} aria-hidden="true" />
          Review Changes
        </button>
      </div>

      <div className="session-summary" aria-label="Session summary">
        <span>
          <small>Current action</small>
          {session.currentAction ?? 'No active operation'}
        </span>
        <span>
          <small>Start time</small>
          <time dateTime={session.startedAt}>
            {new Intl.DateTimeFormat('en', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(session.startedAt))}
          </time>
        </span>
        <span>
          <small>Duration</small>
          {duration}
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
        {tab === 'changes' && (
          <ChangesReview
            sessionId={session.id}
            service={changesService}
            requestOnOpen={searchParams.get('request') === 'changes'}
          />
        )}
        {tab === 'tests' && <TestsView events={tests} />}
        {tab === 'commands' && <CommandsView events={commands} />}
        {tab === 'context' && (
          <ContextView session={session} project={project} capability={capability} />
        )}
      </div>

      <form className="follow-up" onSubmit={(event) => void submitFollowUp(event)}>
        <label htmlFor="follow-up-message">Follow-up message</label>
        <textarea
          ref={followUpRef}
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
