import { AlertTriangle, Check, ExternalLink, RotateCcw, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AttentionType } from '../../../core/contracts/attention';
import { appEventBus } from '../../../core/events/appEventBus';
import { useWorkbench } from '../../../core/state/WorkbenchContext';
import { resolveAttention, type AttentionAction } from '../model/attentionTransitions';

type AttentionFilter = 'all' | AttentionType;

const filters: Array<{ id: AttentionFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'approval', label: 'Approvals' },
  { id: 'input', label: 'Input' },
  { id: 'review', label: 'Review' },
  { id: 'failure', label: 'Failures' },
  { id: 'completed', label: 'Completed' },
];

export function AttentionPage() {
  const { snapshot, saveSnapshot, saving } = useWorkbench();
  const [filter, setFilter] = useState<AttentionFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const openItems = useMemo(
    () => snapshot?.attentionItems.filter((item) => !item.resolved) ?? [],
    [snapshot?.attentionItems],
  );
  const visibleItems = openItems.filter((item) => filter === 'all' || item.type === filter);

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
      setError(
        caught instanceof Error ? caught.message : 'The attention item could not be updated.',
      );
    }
  }

  if (!snapshot) return <div className="attention-state">Loading attention items...</div>;
  const projects = new Map(snapshot.projects.map((project) => [project.id, project]));

  return (
    <div className="attention-page">
      <header className="attention-header">
        <div>
          <p className="eyebrow">Action queue</p>
          <h1>Needs Attention</h1>
        </div>
        <span>{openItems.length} open</span>
      </header>
      <div className="attention-tabs" role="tablist" aria-label="Attention filters">
        {filters.map((option) => {
          const count =
            option.id === 'all'
              ? openItems.length
              : openItems.filter((item) => item.type === option.id).length;
          return (
            <button
              key={option.id}
              role="tab"
              aria-selected={filter === option.id}
              onClick={() => setFilter(option.id)}
            >
              {option.label} {count}
            </button>
          );
        })}
      </div>
      {error && (
        <div className="attention-error" role="alert">
          {error}
        </div>
      )}
      <section className="attention-list" aria-label="Open attention items">
        {visibleItems.map((item) => (
          <article className={`attention-item attention-item--${item.priority}`} key={item.id}>
            <AlertTriangle size={18} aria-hidden="true" />
            <div className="attention-item__body">
              <div>
                <span>{item.type}</span>
                <small>{projects.get(item.projectId)?.name ?? 'Unknown project'}</small>
              </div>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
            </div>
            <div className="attention-item__actions">
              {item.type === 'approval' && (
                <>
                  <button
                    className="button button--primary"
                    disabled={saving}
                    aria-label={`Approve ${item.title}`}
                    onClick={() => void act(item.id, 'approve')}
                  >
                    <Check size={15} />
                    Approve
                  </button>
                  <button
                    className="button button--secondary"
                    disabled={saving}
                    aria-label={`Reject ${item.title}`}
                    onClick={() => void act(item.id, 'reject')}
                  >
                    <X size={15} />
                    Reject
                  </button>
                </>
              )}
              {item.type === 'failure' && (
                <button
                  className="button button--primary"
                  disabled={saving}
                  aria-label={`Retry ${item.title}`}
                  onClick={() => void act(item.id, 'retry')}
                >
                  <RotateCcw size={15} />
                  Retry
                </button>
              )}
              <Link
                className="button button--secondary"
                to={
                  item.type === 'review'
                    ? `/sessions/${item.sessionId}?tab=changes`
                    : `/sessions/${item.sessionId}`
                }
              >
                <ExternalLink size={15} />
                Open
              </Link>
              {item.type !== 'approval' && (
                <button
                  className="button button--secondary"
                  disabled={saving}
                  aria-label={`Dismiss ${item.title}`}
                  onClick={() => void act(item.id, 'dismiss')}
                >
                  Dismiss
                </button>
              )}
            </div>
          </article>
        ))}
      </section>
      {visibleItems.length === 0 && (
        <div className="attention-empty">No open items in this filter.</div>
      )}
    </div>
  );
}
