import { Check, CheckCheck, Copy, ExternalLink, MessageSquareText, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { FileChangeStatus, ReviewStatus } from '../../../core/contracts/changes';
import type { SessionId } from '../../../core/contracts/sessions';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';
import { appEventBus } from '../../../core/events/appEventBus';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { TranslationKey, TranslationParams } from '../../../core/i18n/translations';
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

type Translate = (key: TranslationKey, params?: TranslationParams) => string;

const reviewStatusKeys: Record<ReviewStatus, TranslationKey> = {
  unreviewed: 'changes.review.unreviewed',
  reviewed: 'changes.review.reviewed',
  accepted: 'changes.review.accepted',
  changes_requested: 'changes.review.changesRequested',
};

const fileStatusKeys: Record<FileChangeStatus, TranslationKey> = {
  added: 'changes.status.added',
  modified: 'changes.status.modified',
  deleted: 'changes.status.deleted',
  renamed: 'changes.status.renamed',
};

function statusLabel(status: ReviewStatus, t: Translate) {
  return t(reviewStatusKeys[status]);
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
  const { t, text } = useI18n();
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
  const [line, setLine] = useState<number | null>(null);
  const [severity, setSeverity] = useState<ReviewSeverity>('medium');
  const [rerunImmediately, setRerunImmediately] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nativeAction, setNativeAction] = useState<'copy' | 'open' | null>(null);

  if (!snapshot) return <div className="changes-state">{t('changes.loading')}</div>;
  const session = snapshot.sessions.find((candidate) => candidate.id === selectedSessionId);
  const selected = changes.find((change) => change.id === selectedId) ?? changes[0];
  const project = snapshot.projects.find((candidate) => candidate.id === session?.projectId);
  const displayOnly = session ? snapshot.providerCapabilities[session.provider].displayOnly : false;
  const canOpenFile = Boolean(
    service && project?.source === 'local' && project.status === 'available' && !selected?.binary,
  );

  async function persist(
    next: WorkbenchSnapshot,
    message: string,
    updates: Array<{ id: string; status: ReviewStatus }>,
  ): Promise<boolean> {
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
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : t('changes.saveError'));
      return false;
    }
  }

  async function acceptAll() {
    if (!selectedSessionId) return;
    const next = acceptSessionChanges(snapshot!, selectedSessionId, nextReviewTimestamp(snapshot!));
    await persist(
      next,
      t('changes.accepted'),
      changes.map((change) => ({ id: change.id, status: 'accepted' })),
    );
  }

  async function markReviewed() {
    if (!selected) return;
    await persist(markFileReviewed(snapshot!, selected.id), t('changes.markedReviewed'), [
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
        location: line === null ? undefined : `${selected.relativePath}:${line}`,
      });
      const saved = await persist(next, t('changes.requested'), [
        { id: selected.id, status: 'changes_requested' },
      ]);
      if (!saved) return;
      const updated = next.sessions.find((candidate) => candidate.id === selectedSessionId)!;
      if (updated.status !== previousStatus) {
        appEventBus.emit('session:status-changed', { session: updated, previousStatus });
      }
      setDialogOpen(false);
      setFeedback('');
      setLine(null);
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : t('changes.requestError'));
    }
  }

  async function copyDiff() {
    if (nativeAction) return;
    if (!selected.diff || !navigator.clipboard?.writeText) {
      setError(t('changes.clipboardUnavailable'));
      return;
    }
    setNativeAction('copy');
    try {
      await navigator.clipboard.writeText(selected.diff);
      setError(null);
      setNotice(t('changes.diffCopied'));
    } catch {
      setError(t('changes.copyError'));
    } finally {
      setNativeAction(null);
    }
  }

  async function openFile() {
    if (!service || !project || nativeAction) return;
    setNativeAction('open');
    try {
      setError(null);
      await service.openFile(project, selected.relativePath);
      setNotice(t('changes.fileOpened'));
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : t('changes.openError'));
    } finally {
      setNativeAction(null);
    }
  }

  if (!session || changes.length === 0) {
    return (
      <div className="changes-empty">
        <span>{t('changes.empty')}</span>
        <Link className="button button--secondary" to="/projects">
          {t('changes.browseProjects')}
        </Link>
      </div>
    );
  }

  return (
    <div className="changes-review">
      <aside className="changes-files" aria-label={t('changes.changedFilesLabel')}>
        <header>
          <strong>{t('changes.changedFiles')}</strong>
          <span>{changes.length}</span>
        </header>
        <div role="listbox" aria-label={t('changes.changedFilesLabel')}>
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
                {statusLabel(change.reviewStatus, t)}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="diff-panel" aria-label={t('changes.diffViewer')}>
        <header className="diff-panel__header">
          <div>
            <strong>{selected.relativePath}</strong>
            <span>{t(fileStatusKeys[selected.status])}</span>
          </div>
          <div className="diff-actions">
            <button
              className="button button--compact"
              disabled={saving || Boolean(nativeAction) || selected.binary || !selected.diff}
              onClick={() => void copyDiff()}
            >
              {nativeAction === 'copy' ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <Copy size={15} aria-hidden="true" />
              )}
              {nativeAction === 'copy' ? t('changes.copyingDiff') : t('changes.copyDiff')}
            </button>
            <button
              className="button button--compact"
              disabled={saving || Boolean(nativeAction) || !canOpenFile}
              title={canOpenFile ? undefined : t('changes.localTextOnly')}
              onClick={() => void openFile()}
            >
              {nativeAction === 'open' ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <ExternalLink size={15} aria-hidden="true" />
              )}
              {nativeAction === 'open' ? t('changes.openingFile') : t('changes.openFile')}
            </button>
            <button
              className="button button--compact"
              disabled={saving || displayOnly || selected.reviewStatus === 'reviewed'}
              onClick={() => void markReviewed()}
            >
              <Check size={15} aria-hidden="true" />
              {t('changes.markReviewed')}
            </button>
            <button
              className="button button--compact"
              disabled={saving || displayOnly}
              onClick={() => void acceptAll()}
            >
              <CheckCheck size={15} aria-hidden="true" />
              {t('changes.acceptChanges')}
            </button>
            <button
              className="button button--compact button--primary"
              disabled={saving || displayOnly}
              onClick={() => setDialogOpen(true)}
            >
              <MessageSquareText size={15} aria-hidden="true" />
              {t('changes.requestChanges')}
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
          <DiffViewer
            change={selected}
            onSelectLine={(value) => {
              setLine(value);
              setDialogOpen(true);
            }}
          />
        </div>
        <footer className="diff-panel__footer">
          <span>{statusLabel(selected.reviewStatus, t)}</span>
          <Link to={`/sessions/${session.id}`}>{t('changes.openSession')}</Link>
        </footer>
      </section>
      {dialogOpen && (
        <div className="dialog-backdrop">
          <form
            className="review-dialog"
            aria-label={t('changes.requestChanges')}
            onSubmit={(event) => void submitRequest(event)}
          >
            <button
              className="icon-button review-dialog__close"
              type="button"
              aria-label={t('changes.closeRequest')}
              onClick={() => setDialogOpen(false)}
            >
              <X size={18} />
            </button>
            <p className="eyebrow">{t('changes.reviewFeedback')}</p>
            <h2>{t('changes.requestChanges')}</h2>
            <label htmlFor="review-location">{t('changes.codeLocation')}</label>
            <input
              id="review-location"
              value={line === null ? selected.relativePath : `${selected.relativePath}:${line}`}
              readOnly
            />
            <label htmlFor="requested-changes">{t('changes.requestedChanges')}</label>
            <textarea
              id="requested-changes"
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              rows={5}
              autoFocus
            />
            <label htmlFor="review-severity">{t('changes.severity')}</label>
            <select
              id="review-severity"
              value={severity}
              onChange={(event) => setSeverity(event.target.value as ReviewSeverity)}
            >
              <option value="low">{t('changes.severity.low')}</option>
              <option value="medium">{t('changes.severity.medium')}</option>
              <option value="high">{t('changes.severity.high')}</option>
              <option value="critical">{t('changes.severity.critical')}</option>
            </select>
            <label className="review-rerun">
              <input
                type="checkbox"
                checked={rerunImmediately}
                onChange={(event) => setRerunImmediately(event.target.checked)}
              />
              {t('changes.rerun')}
            </label>
            <div className="review-dialog__actions">
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setDialogOpen(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                className="button button--primary"
                type="submit"
                disabled={saving || feedback.trim().length === 0}
              >
                {t('changes.submitRequest')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
