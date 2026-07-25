import {
  AlertTriangle,
  GitBranch,
  GitMerge,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { NodeRunStatus, WorkflowDefinition } from '../../../core/contracts/workflows';
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog';
import {
  createDefaultWorkflowService,
  type WorkflowRunProjection,
  type WorkflowService,
} from '../services/workflowService';
import { workflowCopy } from '../workflowCopy';
import { readyNodeIds, skippedNodeIds } from '../model/workflowGraph';

interface RunWorktree {
  id: string;
  branch: string;
  path: string;
}
interface IntegrationEvidence {
  diffStat: string;
  commits: string[];
}
interface RunEventNotification {
  runId: string;
  sequence: number;
  eventJson: string;
}

function latestEventSequence(run: WorkflowRunProjection | null) {
  return run?.events.reduce((latest, event) => Math.max(latest, event.sequence ?? 0), 0) ?? 0;
}

function shortReference(value: string) {
  return value.length > 8 ? `${value.slice(0, 8)}...` : value;
}

export function WorkflowRunPage({ service: supplied }: { service?: WorkflowService }) {
  const service = useMemo(() => supplied ?? createDefaultWorkflowService(), [supplied]);
  const { runId } = useParams();
  const { language } = useI18n();
  const c = workflowCopy(language);
  const desktop = '__TAURI_INTERNALS__' in window;
  const [run, setRun] = useState<WorkflowRunProjection | null>(null);
  const [resolvedRunId, setResolvedRunId] = useState<string>();
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const eventCursor = useRef(0);
  const [error, setError] = useState('');
  const [runWorktree, setRunWorktree] = useState<RunWorktree>();
  const [evidence, setEvidence] = useState<IntegrationEvidence>();
  const [confirmAction, setConfirmAction] = useState<'merge' | 'cleanup'>();
  const loadedRunId = run?.id;
  const loadedRunStatus = run?.status;

  useEffect(() => {
    let disposed = false;
    if (!runId) return () => undefined;
    void service
      .getRun(runId)
      .then((next) => {
        if (disposed) return;
        eventCursor.current = Math.max(eventCursor.current, latestEventSequence(next));
        setRun(next);
        setError(next ? '' : 'The workflow run is unavailable.');
        setResolvedRunId(runId);
      })
      .catch((reason) => {
        if (disposed) return;
        setRun(null);
        setError(reason instanceof Error ? reason.message : String(reason));
        setResolvedRunId(runId);
      });
    return () => {
      disposed = true;
    };
  }, [runId, service]);

  useEffect(() => {
    let disposed = false;
    if (!run?.workflowId) {
      return () => undefined;
    }
    void service
      .list()
      .then((workflows) => {
        if (!disposed) setWorkflow(workflows.find((item) => item.id === run.workflowId) ?? null);
      })
      .catch(() => {
        if (!disposed) setWorkflow(null);
      });
    return () => {
      disposed = true;
    };
  }, [run?.workflowId, service]);

  useEffect(() => {
    if (!desktop || !runId) return () => undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let refreshQueued = false;

    const refreshProjection = async () => {
      try {
        const next = await service.getRun(runId);
        if (disposed) return;
        eventCursor.current = Math.max(eventCursor.current, latestEventSequence(next));
        setRun(next);
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      }
    };

    const queueRefresh = () => {
      if (refreshQueued) return;
      refreshQueued = true;
      void refreshProjection().finally(() => {
        refreshQueued = false;
      });
    };

    void (async () => {
      try {
        unlisten = await listen<RunEventNotification>('orchestration://run-event', (event) => {
          const notification = event.payload;
          if (notification.runId !== runId || notification.sequence <= eventCursor.current) return;
          eventCursor.current = notification.sequence;
          queueRefresh();
        });
        const recovered = await service.listRunEventsAfter(runId, eventCursor.current, 250);
        if (disposed) return;
        if (recovered.length > 0) {
          eventCursor.current = Math.max(
            eventCursor.current,
            ...recovered.map((event) => event.sequence),
          );
          queueRefresh();
        }
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [desktop, runId, service]);

  useEffect(() => {
    if (
      !desktop ||
      !loadedRunId ||
      !loadedRunStatus ||
      ['waiting', 'cancelled'].includes(loadedRunStatus)
    )
      return;
    void invoke<RunWorktree>('orchestration_get_run_worktree', { runId: loadedRunId })
      .then(setRunWorktree)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [desktop, loadedRunId, loadedRunStatus]);

  useEffect(() => {
    if (!desktop || run?.status !== 'completed' || !runWorktree) return;
    void invoke<IntegrationEvidence>('orchestration_get_integration_evidence', { runId: run.id })
      .then(setEvidence)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [desktop, run?.id, run?.status, runWorktree]);

  if (!run) {
    if (resolvedRunId === runId && error) {
      return (
        <div className="workflow-editor__message is-error" role="alert">
          {error}
        </div>
      );
    }
    return <div className="workflow-loading">{c.runTitle}</div>;
  }

  async function decideInitial(approved: boolean) {
    setBusy(true);
    setError('');
    try {
      const next = await service.decideRun(run!.id, approved);
      setRun(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function decideApproval(approvalId: string, approved: boolean) {
    setBusy(true);
    setError('');
    try {
      const next = await service.decideApproval(run!.id, approvalId, approved);
      setRun(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setCancelling(true);
    setError('');
    try {
      setRun(await service.cancelRun(run!.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCancelling(false);
    }
  }

  async function resume() {
    setBusy(true);
    setError('');
    try {
      const next = await service.resumeRun(run!.id);
      setRun(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function simulate(workflow: WorkflowDefinition, currentRun: WorkflowRunProjection) {
    const statuses = Object.fromEntries(
      currentRun.nodeRuns.map((node) => [
        node.nodeId,
        node.status === 'ready' ? 'pending' : node.status,
      ]),
    ) as Record<string, NodeRunStatus>;
    const events = [...currentRun.events];
    const outcomes: Record<string, boolean> = {};
    for (let pass = 0; pass <= workflow.nodes.length; pass += 1) {
      for (const nodeId of skippedNodeIds(workflow, statuses, outcomes)) {
        statuses[nodeId] = 'skipped';
      }
      const ready = readyNodeIds(workflow, statuses, outcomes);
      if (!ready.length) break;
      for (const nodeId of ready) {
        statuses[nodeId] = 'succeeded';
        const node = workflow.nodes.find((item) => item.id === nodeId);
        if (node?.type === 'condition') {
          outcomes[nodeId] = !['false', '0', 'no'].includes(node.expression.trim().toLowerCase());
        }
        events.push({
          at: new Date().toISOString(),
          message: `${node?.name ?? nodeId} completed in simulation mode.`,
        });
      }
    }
    const next: WorkflowRunProjection = {
      ...currentRun,
      status: 'completed',
      nodeRuns: currentRun.nodeRuns.map((node) => ({
        ...node,
        status: statuses[node.nodeId],
      })),
      events,
    };
    await service.persistProjection(next);
    setRun(next);
  }

  async function runSimulation() {
    setBusy(true);
    setError('');
    try {
      const workflow = (await service.list()).find((item) => item.id === run!.workflowId);
      if (!workflow) throw new Error('The workflow definition is unavailable.');
      await simulate(workflow, run!);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function confirmIntegrationAction() {
    if (!run || !confirmAction) return;
    setBusy(true);
    try {
      if (confirmAction === 'merge') {
        const approval = run.mergeApproval;
        if (!approval || approval.status !== 'pending') {
          throw new Error('The final merge approval is unavailable.');
        }
        setRun(await service.decideFinalMerge(run.id, approval.id, true));
      } else {
        await invoke('orchestration_cleanup_run_worktrees', { runId: run.id });
        setRunWorktree(undefined);
      }
      setConfirmAction(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function requestFinalMerge() {
    setBusy(true);
    setError('');
    try {
      setRun(await service.requestFinalMerge(run!.id));
      setConfirmAction('merge');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function rejectFinalMerge() {
    const approval = run?.mergeApproval;
    if (!run || !approval || approval.status !== 'pending') {
      setConfirmAction(undefined);
      return;
    }
    setBusy(true);
    try {
      setRun(await service.decideFinalMerge(run.id, approval.id, false));
      setConfirmAction(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const pendingApprovals = (run.approvals ?? []).filter(
    (approval) => approval.status === 'pending' && approval.capability !== 'worktree',
  );
  const openAttentions = (run.attentions ?? []).filter((attention) => attention.status === 'open');
  const hasReady = run.nodeRuns.some((node) => node.status === 'ready');
  const merged = run.mergeApproval?.status === 'merged';
  const pendingMergeApproval = run.mergeApproval?.status === 'pending';
  const cleanupBlockedByMerge = ['pending', 'approved'].includes(run.mergeApproval?.status ?? '');
  const workflowForRun = workflow?.id === run.workflowId ? workflow : undefined;
  const nodeNames = new Map(workflowForRun?.nodes.map((node) => [node.id, node.name]));

  return (
    <section className="run-page">
      <header className="workflow-page-header">
        <div>
          <span className="eyebrow" title={run.id}>
            {language === 'zh-CN' ? '运行 ' : 'Run '}
            {shortReference(run.id)}
          </span>
          <h1>{c.runTitle}</h1>
          <p>{c.runSummary}</p>
        </div>
        <button
          className="button button--danger"
          disabled={cancelling || ['cancelled', 'completed'].includes(run.status)}
          onClick={() => void cancel()}
        >
          <Square size={15} />
          {c.cancel}
        </button>
      </header>
      {error && (
        <div className="workflow-editor__message is-error" role="alert">
          {error}
        </div>
      )}
      {run.status === 'paused' && openAttentions.length > 0 && (
        <div className="run-approval run-approval--attention" role="alert">
          <div>
            <AlertTriangle size={18} />
            <strong>{language === 'zh-CN' ? '运行需要处理' : 'Run needs attention'}</strong>
            <span>{openAttentions[0]?.summary}</span>
          </div>
          <div>
            <Link className="button button--secondary" to={`/projects/${run.projectId}`}>
              {language === 'zh-CN' ? '查看项目变更' : 'Review project changes'}
            </Link>
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void resume()}
            >
              <RotateCcw size={15} />
              {language === 'zh-CN' ? '解决后继续' : 'Resume after resolution'}
            </button>
          </div>
        </div>
      )}
      {run.status === 'interrupted' && (
        <div className="run-approval">
          <div>
            <RotateCcw size={18} />
            <strong>{language === 'zh-CN' ? '运行已中断' : 'Run interrupted'}</strong>
          </div>
          <button className="button button--primary" disabled={busy} onClick={() => void resume()}>
            {language === 'zh-CN' ? '继续运行' : 'Resume'}
          </button>
        </div>
      )}
      {run.status === 'waiting' &&
        (run.approvals ?? []).some(
          (item) => item.capability === 'worktree' && item.status === 'pending',
        ) && (
          <div className="run-approval">
            <div>
              <ShieldCheck size={18} />
              <strong>{c.waiting}</strong>
              <span>{run.events.at(-1)?.message}</span>
            </div>
            <div>
              <button
                className="button button--secondary"
                disabled={busy}
                onClick={() => void decideInitial(false)}
              >
                {language === 'zh-CN' ? '拒绝' : 'Reject'}
              </button>
              <button
                className="button button--primary"
                disabled={busy}
                onClick={() => void decideInitial(true)}
              >
                {c.approve}
              </button>
            </div>
          </div>
        )}
      {pendingApprovals.map((approval) => (
        <div className="run-approval" key={approval.id}>
          <div>
            <ShieldCheck size={18} />
            <strong>{language === 'zh-CN' ? '节点权限审批' : 'Node permission approval'}</strong>
            <span>{approval.summary}</span>
          </div>
          <div>
            <button
              className="button button--secondary"
              disabled={busy}
              onClick={() => void decideApproval(approval.id, false)}
            >
              {language === 'zh-CN' ? '拒绝' : 'Reject'}
            </button>
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void decideApproval(approval.id, true)}
            >
              {language === 'zh-CN' ? '批准' : 'Approve'}
            </button>
          </div>
        </div>
      ))}
      {hasReady && !desktop && (
        <div className="run-approval">
          <div>
            <Play size={18} />
            <strong>{language === 'zh-CN' ? '节点已就绪' : 'Nodes ready'}</strong>
            <span>
              {language === 'zh-CN'
                ? '启动后将自动推进所有就绪节点，并在隔离 worktree 中遵守并发限制。'
                : 'The scheduler will advance every ready node in isolated worktrees within the concurrency limit.'}
            </span>
          </div>
          <button
            className="button button--primary"
            disabled={busy}
            onClick={() => void runSimulation()}
          >
            <Play size={15} />
            {language === 'zh-CN' ? '启动自动编排' : 'Start orchestration'}
          </button>
        </div>
      )}
      {run.status === 'completed' && desktop && (
        <div className="run-approval">
          <div>
            <GitMerge size={18} />
            <strong>
              {merged
                ? language === 'zh-CN'
                  ? '已合入当前分支'
                  : 'Merged into current branch'
                : language === 'zh-CN'
                  ? '集成结果待确认'
                  : 'Integration ready for review'}
            </strong>
            <span>
              {evidence?.commits.length ?? 0}{' '}
              {language === 'zh-CN' ? '个受管提交' : 'managed commits'}
            </span>
          </div>
          <div>
            <button
              className="button button--secondary"
              disabled={busy || !runWorktree || cleanupBlockedByMerge}
              onClick={() => setConfirmAction('cleanup')}
            >
              <Trash2 size={15} />
              {language === 'zh-CN' ? '清理 worktree' : 'Clean worktrees'}
            </button>
            <button
              className="button button--primary"
              disabled={busy || merged || pendingMergeApproval || !runWorktree}
              onClick={() => void requestFinalMerge()}
            >
              <GitMerge size={15} />
              {language === 'zh-CN' ? '审查并合入' : 'Review and merge'}
            </button>
          </div>
        </div>
      )}
      {run.status === 'completed' && pendingMergeApproval && (
        <div className="run-approval">
          <div>
            <GitMerge size={18} />
            <strong>
              {language === 'zh-CN' ? '最终合并待审批' : 'Final merge approval pending'}
            </strong>
            <span>{run.mergeApproval?.summary}</span>
          </div>
          <div>
            <button
              className="button button--secondary"
              disabled={busy}
              onClick={() => void rejectFinalMerge()}
            >
              {language === 'zh-CN' ? '拒绝' : 'Reject'}
            </button>
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => setConfirmAction('merge')}
            >
              <GitMerge size={15} />
              {language === 'zh-CN' ? '审查并合入' : 'Review and merge'}
            </button>
          </div>
        </div>
      )}
      <div className="run-summary">
        <div>
          <GitBranch size={18} />
          <span>{c.integration}</span>
          <strong>{run.integrationBranch}</strong>
        </div>
        <div>
          <ShieldCheck size={18} />
          <span>{c.approvals}</span>
          <strong>{run.status}</strong>
        </div>
      </div>
      {evidence && (evidence.diffStat || evidence.commits.length > 0) && (
        <section className="run-evidence">
          <h2>{language === 'zh-CN' ? '集成证据' : 'Integration evidence'}</h2>
          <pre>
            {evidence.diffStat || (language === 'zh-CN' ? '无文件差异' : 'No file changes')}
          </pre>
          <ul>
            {evidence.commits.map((commit) => (
              <li key={commit}>
                <code>{commit}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="run-layout">
        <section>
          <h2>{language === 'zh-CN' ? '节点' : 'Nodes'}</h2>
          <div className="run-nodes">
            {run.nodeRuns.map((node) => (
              <article key={node.id}>
                <span className={`run-status run-status--${node.status}`}>{node.status}</span>
                <div className="run-node-main">
                  <strong>{nodeNames.get(node.nodeId) ?? shortReference(node.nodeId)}</strong>
                  <small title={node.nodeId}>
                    {language === 'zh-CN' ? '节点 ID ' : 'ID '}
                    {shortReference(node.nodeId)}
                  </small>
                  <small>
                    {c.attempt} {node.attempt}
                    {node.provider ? ` · ${node.provider}` : ''}
                  </small>
                  {node.externalSessionId && (
                    <small title={node.externalSessionId}>
                      Session · <code>{node.externalSessionId}</code>
                    </small>
                  )}
                  {node.error && <small className="run-node-error">{node.error}</small>}
                  {(run.artifacts ?? [])
                    .filter((artifact) => artifact.nodeRunId === node.id)
                    .map((artifact) => (
                      <small className="run-node-artifact" key={artifact.id} title={artifact.path}>
                        {artifact.kind} · {artifact.byteLength.toLocaleString(language)} B ·{' '}
                        <code>{artifact.contentHash.slice(0, 12)}</code>
                      </small>
                    ))}
                </div>
              </article>
            ))}
          </div>
        </section>
        <aside>
          <h2>{c.log}</h2>
          {run.events.map((event, index) => (
            <p key={`${event.at}-${index}`}>
              <time>{new Date(event.at).toLocaleTimeString(language)}</time>
              {event.message}
            </p>
          ))}
        </aside>
      </div>
      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={
          confirmAction === 'merge'
            ? language === 'zh-CN'
              ? '合入当前分支？'
              : 'Merge into the current branch?'
            : language === 'zh-CN'
              ? '清理运行 worktree？'
              : 'Clean run worktrees?'
        }
        description={
          confirmAction === 'merge'
            ? evidence?.diffStat ||
              (language === 'zh-CN'
                ? '将把隔离集成分支合入当前用户分支。'
                : 'The isolated integration branch will be merged into the current user branch.')
            : language === 'zh-CN'
              ? '未提交改动将被删除；集成和节点分支会保留。'
              : 'Uncommitted worktree changes will be removed; integration and node branches remain.'
        }
        confirmLabel={
          confirmAction === 'merge'
            ? language === 'zh-CN'
              ? '确认合入'
              : 'Merge'
            : language === 'zh-CN'
              ? '确认清理'
              : 'Clean'
        }
        pending={busy}
        onCancel={() => setConfirmAction(undefined)}
        onConfirm={() => void confirmIntegrationAction()}
      />
    </section>
  );
}
