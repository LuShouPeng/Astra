import { Check, CheckCheck, Copy, ExternalLink, MessageSquareText, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ReviewStatus } from '../../../core/contracts/changes';
import type { SessionId } from '../../../core/contracts/sessions';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';
import { appEventBus } from '../../../core/events/appEventBus';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { DiffViewer } from './DiffViewer';
import {
  acceptSessionChanges,
  markFileReviewed,
  nextReviewTimestamp,
  requestSessionChanges,
  type ReviewSeverity,
} from '../model/reviewTransitions';
import type { ChangesService } from '../services/changesService';

function statusLabel(status: ReviewStatus) {
  return status.replace('_', ' ');
}

export function ChangesReview({
  sessionId,
  service,
  requestOnOpen = false,
}: {
  sessionId?: SessionId;
  service?: ChangesService;
  requestOnOpen?: boolean;
}) {
  const { snapshot, saveSnapshot, saving } = useWorkbench();
  const availableSessionIds = useMemo(
    () => new Set(snapshot?.fileChanges.map((change) => change.sessionId) ?? []),
    [snapshot?.fileChanges],
  );
  const selectedSessionId =
    sessionId ?? snapshot?.sessions.find((session) => availableSessionIds.has(session.id))?.id;
  const changes = useMemo(
    () => snapshot?.fileChanges.filter((change) => change.sessionId === selectedSessionId) ?? [],
    [selectedSessionId, snapshot?.fileChanges],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(requestOnOpen);
  const [feedback, setFeedback] = useState('');
  const [severity, setSeverity] = useState<ReviewSeverity>('medium');
  const [rerunImmediately, setRerunImmediately] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!snapshot) return <div className="changes-state">Loading changes...</div>;
  const session = snapshot.sessions.find((candidate) => candidate.id === selectedSessionId);
  const selected = changes.find((change) => change.id === selectedId) ?? changes[0];
  const project = snapshot.projects.find((candidate) => candidate.id === session?.projectId);
  const displayOnly = session ? snapshot.providerCapabilities[session.provider].displayOnly : false;
  const canOpenFile = Boolean(
    service && project?.source === 'local' && project.status === 'available' && !selected.binary,
  );

  async function persist(
    next: WorkbenchSnapshot,
    message: string,
    updates: Array<{ id: string; status: ReviewStatus }>,
  ) {
    setError(null);
    try {
      await saveSnapshot(next);
      updates.forEach((update) =>
        appEventBus.emit('review:updated', {
          sessionId: selectedSessionId!,
          fileChangeId: update.id,
          status: update.status,
        }),
      );
      setNotice(message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The review could not be saved.');
    }
  }

  async function acceptAll() {
    if (!selectedSessionId) return;
    const next = acceptSessionChanges(snapshot!, selectedSessionId, nextReviewTimestamp(snapshot!));
    await persist(
      next,
      'Changes accepted',
      changes.map((change) => ({ id: change.id, status: 'accepted' })),
    );
  }

  async function markReviewed() {
    if (!selected) return;
    await persist(markFileReviewed(snapshot!, selected.id), 'Marked reviewed', [
      { id: selected.id, status: 'reviewed' },
    ]);
  }

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    if (!selected || !selectedSessionId) return;
    try {
      const previousStatus = session!.status;
      const next = requestSessionChanges(snapshot!, {
        sessionId: selectedSessionId,
        fileChangeId: selected.id,
        feedback,
        severity,
        rerunImmediately,
        timestamp: nextReviewTimestamp(snapshot!),
      });
      await persist(next, 'Changes requested', [{ id: selected.id, status: 'changes_requested' }]);
      const updated = next.sessions.find((candidate) => candidate.id === selectedSessionId)!;
      if (updated.status !== previousStatus) {
        appEventBus.emit('session:status-changed', { session: updated, previousStatus });
      }
      setDialogOpen(false);
      setFeedback('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The request could not be saved.');
    }
  }

  async function copyDiff() {
    if (!selected.diff || !navigator.clipboard?.writeText) {
      setError('Clipboard access is unavailable.');
      return;
    }
    try {
      await navigator.clipboard.writeText(selected.diff);
      setError(null);
      setNotice('Diff copied');
    } catch {
      setError('The diff could not be copied.');
    }
  }

  async function openFile() {
    if (!service || !project) return;
    try {
      setError(null);
      await service.openFile(project, selected.relativePath);
      setNotice('File opened');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The file could not be opened.');
    }
  }

  if (!session || changes.length === 0) {
    return <div className="changes-empty">No changed files are available for review.</div>;
  }

  return (
    <div className="changes-review">
      <aside className="changes-files" aria-label="Changed files">
        <header>
          <strong>Changed Files</strong>
          <span>{changes.length}</span>
        </header>
        <div role="listbox" aria-label="Changed files">
          {changes.map((change) => (
            <button
              key={change.id}
              role="option"
              aria-selected={change.id === selected?.id}
              onClick={() => {
                setSelectedId(change.id);
                setNotice(null);
              }}
            >
              <span className={`change-kind change-kind--${change.status}`}>
                {change.status[0].toUpperCase()}
              </span>
              <span className="change-file__path">{change.relativePath}</span>
              <small>
                +{change.additions} -{change.deletions}
              </small>
              <span className={`review-state review-state--${change.reviewStatus}`}>
                {statusLabel(change.reviewStatus)}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="diff-panel" aria-label="Diff Viewer">
        <header className="diff-panel__header">
          <div>
            <strong>{selected.relativePath}</strong>
            <span>{selected.status}</span>
          </div>
          <div className="diff-actions">
            <button
              className="button button--compact"
              disabled={saving || selected.binary || !selected.diff}
              onClick={() => void copyDiff()}
            >
              <Copy size={15} aria-hidden="true" />
              Copy Diff
            </button>
            <button
              className="button button--compact"
              disabled={saving || !canOpenFile}
              title={canOpenFile ? undefined : 'Only available for registered local text files'}
              onClick={() => void openFile()}
            >
              <ExternalLink size={15} aria-hidden="true" />
              Open File
            </button>
            <button
              className="button button--compact"
              disabled={saving || displayOnly || selected.reviewStatus === 'reviewed'}
              onClick={() => void markReviewed()}
            >
              <Check size={15} aria-hidden="true" />
              Mark Reviewed
            </button>
            <button
              className="button button--compact"
              disabled={saving || displayOnly}
              onClick={() => void acceptAll()}
            >
              <CheckCheck size={15} aria-hidden="true" />
              Accept Changes
            </button>
            <button
              className="button button--compact button--primary"
              disabled={saving || displayOnly}
              onClick={() => setDialogOpen(true)}
            >
              <MessageSquareText size={15} aria-hidden="true" />
              Request Changes
            </button>
          </div>
        </header>
        {(notice || error) && (
          <div
            className={error ? 'review-feedback review-feedback--error' : 'review-feedback'}
            role={error ? 'alert' : 'status'}
          >
            {error ?? notice}
          </div>
        )}
        <div className="diff-panel__body">
          <DiffViewer change={selected} />
        </div>
        <footer className="diff-panel__footer">
          <span>{statusLabel(selected.reviewStatus)}</span>
          <Link to={`/sessions/${session.id}`}>Open Session</Link>
        </footer>
      </section>
      {dialogOpen && (
        <div className="dialog-backdrop">
          <form
            className="review-dialog"
            aria-label="Request Changes"
            onSubmit={(event) => void submitRequest(event)}
          >
            <button
              className="icon-button review-dialog__close"
              type="button"
              aria-label="Close request"
              onClick={() => setDialogOpen(false)}
            >
              <X size={18} />
            </button>
            <p className="eyebrow">Review feedback</p>
            <h2>Request Changes</h2>
            <label htmlFor="requested-changes">Requested changes</label>
            <textarea
              id="requested-changes"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              rows={5}
              autoFocus
            />
            <label htmlFor="review-severity">Severity</label>
            <select
              id="review-severity"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as ReviewSeverity)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
            <label className="review-rerun">
              <input
                type="checkbox"
                checked={rerunImmediately}
                onChange={(event) => setRerunImmediately(event.target.checked)}
              />
              Rerun the deterministic Agent simulation immediately
            </label>
            <div className="review-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                type="submit"
                disabled={saving || feedback.trim().length === 0}
              >
                Submit request
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
