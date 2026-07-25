import {
  AlertTriangle,
  Check,
  CheckCheck,
  ExternalLink,
  FileDiff,
  MessageSquareReply,
  RotateCcw,
  ScrollText,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AttentionType } from '../../../core/contracts/attention';
import { appEventBus } from '../../../core/events/appEventBus';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { TranslationKey } from '../../../core/i18n/translations';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { acceptSessionChanges, nextReviewTimestamp } from '../../changes';
import {
  markAttentionRead,
  resolveAttention,
  type AttentionAction,
} from '../model/attentionTransitions';

type AttentionFilter = 'all' | AttentionType;
type AttentionQueue = 'open' | 'resolved';
const priorityRank = { critical: 4, high: 3, medium: 2, low: 1 } as const;

const filters: Array<{ id: AttentionFilter; labelKey: TranslationKey }> = [
  { id: 'all', labelKey: 'attention.filter.all' },
  { id: 'approval', labelKey: 'attention.filter.approval' },
  { id: 'input', labelKey: 'attention.filter.input' },
  { id: 'review', labelKey: 'attention.filter.review' },
  { id: 'failure', labelKey: 'attention.filter.failure' },
  { id: 'completed', labelKey: 'attention.filter.completed' },
];

const typeKeys: Record<AttentionType, TranslationKey> = {
  approval: 'attention.type.approval',
  input: 'attention.type.input',
  review: 'attention.type.review',
  failure: 'attention.type.failure',
  completed: 'attention.type.completed',
};

export function AttentionPage() {
  const { language, t, text } = useI18n();
  const { snapshot, saveSnapshot, saving } = useWorkbench();
  const [filter, setFilter] = useState<AttentionFilter>('all');
  const [queue, setQueue] = useState<AttentionQueue>('open');
  const [sort, setSort] = useState<'priority' | 'recent'>('priority');
  const [error, setError] = useState<string | null>(null);
  const openItems = useMemo(
    () => snapshot?.attentionItems.filter((item) => !item.resolved) ?? [],
    [snapshot?.attentionItems],
  );
  const queueItems = (snapshot?.attentionItems ?? []).filter(
    (item) => item.resolved === (queue === 'resolved'),
  );
  const visibleItems = queueItems
    .filter((item) => filter === 'all' || item.type === filter)
    .sort((left, right) =>
      sort === 'priority'
        ? priorityRank[right.priority] - priorityRank[left.priority] ||
          right.createdAt.localeCompare(left.createdAt)
        : right.createdAt.localeCompare(left.createdAt),
    );

  async function act(attentionId: string, action: AttentionAction) {
    if (!snapshot) return;
    const item = snapshot.attentionItems.find((candidate) => candidate.id === attentionId);
    const session = snapshot.sessions.find((candidate) => candidate.id === item?.sessionId);
    try {
      setError(null);
      const next = resolveAttention(snapshot, attentionId, action);
      await saveSnapshot(next);
      appEventBus.emit('attention:resolved', { attentionId, sessionId: item!.sessionId });
      if (session) {
        const updated = next.sessions.find((candidate) => candidate.id === session.id)!;
        if (updated.status !== session.status) {
          appEventBus.emit('session:status-changed', {
            session: updated,
            previousStatus: session.status,
          });
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : t('attention.updateError'));
    }
  }

  async function markRead(attentionId: string) {
    if (!snapshot) return;
    try {
      setError(null);
      await saveSnapshot(markAttentionRead(snapshot, attentionId));
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : t('attention.markReadError'));
    }
  }

  async function acceptReview(attentionId: string, sessionId: string) {
    if (!snapshot) return;
    try {
      setError(null);
      const next = acceptSessionChanges(snapshot, sessionId, nextReviewTimestamp(snapshot));
      await saveSnapshot(next);
      next.fileChanges
        .filter((change) => change.sessionId === sessionId)
        .forEach((change) =>
          appEventBus.emit('review:updated', {
            sessionId,
            fileChangeId: change.id,
            status: 'accepted',
          }),
        );
      appEventBus.emit('attention:resolved', { attentionId, sessionId });
    } catch (caught) {
      setError(caught instanceof Error ? text(caught.message) : t('attention.acceptError'));
    }
  }

  if (!snapshot) return <div className="attention-state">{t('attention.loading')}</div>;
  const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
  const sessions = new Map(snapshot.sessions.map((session) => [session.id, session]));

  return (
    <div className="attention-page">
      <header className="attention-header">
        <div>
          <p className="eyebrow">{t('attention.actionQueue')}</p>
          <h1>{t('nav.attention')}</h1>
        </div>
        <span>{t('attention.openCount', { count: openItems.length })}</span>
      </header>
      <div className="attention-tabs" role="tablist" aria-label={t('attention.filters')}>
        <button role="tab" aria-selected={queue === 'open'} onClick={() => setQueue('open')}>
          {t('attention.open')} {openItems.length}
        </button>
        <button
          role="tab"
          aria-selected={queue === 'resolved'}
          onClick={() => setQueue('resolved')}
        >
          {t('attention.resolved')} {snapshot.attentionItems.length - openItems.length}
        </button>
        {filters.map((option) => {
          const count =
            option.id === 'all'
              ? queueItems.length
              : queueItems.filter((item) => item.type === option.id).length;
          return (
            <button
              key={option.id}
              role="tab"
              aria-selected={filter === option.id}
              onClick={() => setFilter(option.id)}
            >
              {t(option.labelKey)} {count}
            </button>
          );
        })}
        <label className="attention-sort">
          <span>{t('attention.sort')}</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="priority">{t('attention.sortPriority')}</option>
            <option value="recent">{t('attention.sortRecent')}</option>
          </select>
        </label>
      </div>
      {error && (
        <div className="attention-error" role="alert">
          {error}
        </div>
      )}
      <section className="attention-list" aria-label={t('attention.openItems')}>
        {visibleItems.map((item) => (
          <article className={`attention-item attention-item--${item.priority}`} key={item.id}>
            <AlertTriangle size={18} aria-hidden="true" />
            <div className="attention-item__body">
              <div>
                <span>{t(typeKeys[item.type])}</span>
                <small>{projects.get(item.projectId)?.name ?? t('common.unknownProject')}</small>
                <small className="attention-item__agent">
                  {sessions.get(item.sessionId)
                    ? snapshot.providerCapabilities[sessions.get(item.sessionId)!.provider].label
                    : t('attention.unknownAgent')}
                </small>
              </div>
              <h2>{text(item.title)}</h2>
              <p>{text(item.description)}</p>
              <div className="attention-item__meta">
                <span>
                  {sessions.has(item.sessionId)
                    ? text(sessions.get(item.sessionId)!.title)
                    : t('common.unknownSession')}
                </span>
                <time dateTime={item.createdAt}>
                  {new Intl.DateTimeFormat(language, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(item.createdAt))}
                </time>
              </div>
            </div>
            <div className="attention-item__actions">
              {!item.resolved && (
                <>
                  {item.type === 'approval' && (
                    <>
                      <button
                        className="button button--primary"
                        disabled={saving}
                        aria-label={t('attention.approveNamed', { name: text(item.title) })}
                        onClick={() => void act(item.id, 'approve')}
                      >
                        <Check size={15} />
                        {t('session.approve')}
                      </button>
                      <button
                        className="button button--secondary"
                        disabled={saving}
                        aria-label={t('attention.rejectNamed', { name: text(item.title) })}
                        onClick={() => void act(item.id, 'reject')}
                      >
                        <X size={15} />
                        {t('session.reject')}
                      </button>
                      <Link
                        className="button button--secondary"
                        aria-label={t('attention.viewSessionNamed', { name: text(item.title) })}
                        to={`/sessions/${item.sessionId}`}
                      >
                        <ExternalLink size={15} aria-hidden="true" />
                        {t('attention.viewSession')}
                      </Link>
                    </>
                  )}
                  {item.type === 'input' && (
                    <>
                      <Link
                        className="button button--primary"
                        aria-label={t('attention.replyNamed', { name: text(item.title) })}
                        to={`/sessions/${item.sessionId}?focus=message`}
                      >
                        <MessageSquareReply size={15} aria-hidden="true" />
                        {t('attention.reply')}
                      </Link>
                      <Link
                        className="button button--secondary"
                        aria-label={t('attention.viewSessionNamed', { name: text(item.title) })}
                        to={`/sessions/${item.sessionId}`}
                      >
                        <ExternalLink size={15} aria-hidden="true" />
                        {t('attention.viewSession')}
                      </Link>
                    </>
                  )}
                  {item.type === 'review' && (
                    <>
                      <Link
                        className="button button--secondary"
                        aria-label={t('attention.openDiffNamed', { name: text(item.title) })}
                        to={`/sessions/${item.sessionId}?tab=changes`}
                      >
                        <FileDiff size={15} aria-hidden="true" />
                        {t('attention.openDiff')}
                      </Link>
                      <button
                        className="button button--primary"
                        disabled={saving}
                        aria-label={t('attention.acceptNamed', { name: text(item.title) })}
                        onClick={() => void acceptReview(item.id, item.sessionId)}
                      >
                        <CheckCheck size={15} aria-hidden="true" />
                        {t('attention.accept')}
                      </button>
                      <Link
                        className="button button--secondary"
                        aria-label={t('attention.requestNamed', { name: text(item.title) })}
                        to={`/sessions/${item.sessionId}?tab=changes&request=changes`}
                      >
                        <MessageSquareReply size={15} aria-hidden="true" />
                        {t('changes.requestChanges')}
                      </Link>
                    </>
                  )}
                  {item.type === 'failure' && (
                    <>
                      <button
                        className="button button--primary"
                        disabled={saving}
                        aria-label={t('attention.retryNamed', { name: text(item.title) })}
                        onClick={() => void act(item.id, 'retry')}
                      >
                        <RotateCcw size={15} aria-hidden="true" />
                        {t('attention.retry')}
                      </button>
                      <Link
                        className="button button--secondary"
                        aria-label={t('attention.viewLogsNamed', { name: text(item.title) })}
                        to={`/sessions/${item.sessionId}?tab=commands`}
                      >
                        <ScrollText size={15} aria-hidden="true" />
                        {t('attention.viewLogs')}
                      </Link>
                      <button
                        className="button button--secondary"
                        disabled={saving}
                        aria-label={t('attention.dismissNamed', { name: text(item.title) })}
                        onClick={() => void act(item.id, 'dismiss')}
                      >
                        {t('attention.dismiss')}
                      </button>
                    </>
                  )}
                  {item.type === 'completed' && (
                    <>
                      <Link
                        className="button button--secondary"
                        aria-label={t('attention.reviewNamed', { name: text(item.title) })}
                        to={`/sessions/${item.sessionId}?tab=changes`}
                      >
                        <FileDiff size={15} aria-hidden="true" />
                        {t('session.reviewChanges')}
                      </Link>
                      <button
                        className="button button--primary"
                        disabled={saving}
                        aria-label={t('attention.markDoneNamed', { name: text(item.title) })}
                        onClick={() => void act(item.id, 'dismiss')}
                      >
                        <Check size={15} aria-hidden="true" />
                        {t('attention.markDone')}
                      </button>
                    </>
                  )}
                  {!item.read && (
                    <button
                      className="button button--secondary"
                      disabled={saving}
                      aria-label={t('attention.markReadNamed', { name: text(item.title) })}
                      onClick={() => void markRead(item.id)}
                    >
                      {t('attention.markRead')}
                    </button>
                  )}
                </>
              )}
            </div>
          </article>
        ))}
      </section>
      {visibleItems.length === 0 && (
        <div className="attention-empty">
          <span>{t('attention.empty')}</span>
          <Link className="button button--secondary" to="/command-center">
            {t('attention.return')}
          </Link>
        </div>
      )}
    </div>
  );
}
