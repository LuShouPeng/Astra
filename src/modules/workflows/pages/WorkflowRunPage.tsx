import { GitBranch, ShieldCheck, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useI18n } from '../../../core/i18n/I18nContext';
import {
  createDefaultWorkflowService,
  type WorkflowRunProjection,
  type WorkflowService,
} from '../services/workflowService';
import { workflowCopy } from '../workflowCopy';

export function WorkflowRunPage({ service: supplied }: { service?: WorkflowService }) {
  const service = useMemo(() => supplied ?? createDefaultWorkflowService(), [supplied]);
  const { runId } = useParams();
  const { language } = useI18n();
  const c = workflowCopy(language);
  const [run, setRun] = useState<WorkflowRunProjection | null>(null);
  useEffect(() => {
    if (runId) void service.getRun(runId).then(setRun);
  }, [runId, service]);
  if (!run) return <div className="workflow-loading">{c.runTitle}</div>;
  return (
    <section className="run-page">
      <header className="workflow-page-header">
        <div>
          <span className="eyebrow">{run.id}</span>
          <h1>{c.runTitle}</h1>
          <p>{c.runSummary}</p>
        </div>
        <button className="button button--danger">
          <Square size={15} />
          {c.cancel}
        </button>
      </header>
      <div className="run-summary">
        <div>
          <GitBranch size={18} />
          <span>{c.integration}</span>
          <strong>{run.integrationBranch}</strong>
        </div>
        <div>
          <ShieldCheck size={18} />
          <span>{c.approvals}</span>
          <strong>{c.waiting}</strong>
        </div>
      </div>
      <div className="run-layout">
        <section>
          <h2>Nodes</h2>
          <div className="run-nodes">
            {run.nodeRuns.map((node) => (
              <article key={node.id}>
                <span className={`run-status run-status--${node.status}`}>{node.status}</span>
                <strong>{node.nodeId}</strong>
                <small>
                  {c.attempt} {node.attempt}
                </small>
              </article>
            ))}
          </div>
        </section>
        <aside>
          <h2>{c.log}</h2>
          {run.events.map((event) => (
            <p key={event.at}>
              <time>{new Date(event.at).toLocaleTimeString(language)}</time>
              {event.message}
            </p>
          ))}
        </aside>
      </div>
    </section>
  );
}
