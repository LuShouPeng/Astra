import { GitBranch, GitMerge, Play, RotateCcw, ShieldCheck, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Channel, invoke } from '@tauri-apps/api/core';
import { useI18n } from '../../../core/i18n/I18nContext';
import type {
  AgentWorkflowNode,
  NodeRun,
  NodeRunStatus,
  WorkflowDefinition,
} from '../../../core/contracts/workflows';
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog';
import {
  createDefaultWorkflowService,
  type WorkflowRunProjection,
  type WorkflowService,
} from '../services/workflowService';
import { workflowCopy } from '../workflowCopy';
import { useWorkspace } from '../../workspace';
import { readyNodeIds, skippedNodeIds } from '../model/workflowGraph';
import { loadProviderPreferences } from '../model/providerPreferences';

interface RunWorktree {
  id: string;
  branch: string;
  path: string;
}
interface NodeWorktree {
  id: string;
  runId: string;
  branch: string;
  path: string;
}
interface ProviderStatus {
  provider: 'claude' | 'codex';
  available: boolean;
  executablePath?: string;
  version?: string;
  reason?: string;
}
interface IntegrationEvidence {
  diffStat: string;
  commits: string[];
}
type ProviderEvent =
  | { event: 'output'; data: { stream: string; text: string } }
  | { event: 'session'; data: { externalSessionId: string } }
  | { event: 'started' | 'completed' | 'failed'; data: Record<string, unknown> };

function effectiveProvider(node: AgentWorkflowNode, providers: ProviderStatus[]) {
  if (node.provider !== 'auto') return node.provider;
  if (providers.some((item) => item.provider === 'codex' && item.available)) return 'codex';
  return 'claude';
}

export function WorkflowRunPage({ service: supplied }: { service?: WorkflowService }) {
  const service = useMemo(() => supplied ?? createDefaultWorkflowService(), [supplied]);
  const { runId } = useParams();
  const { language } = useI18n();
  const c = workflowCopy(language);
  const { activeWorkspace } = useWorkspace();
  const desktop = '__TAURI_INTERNALS__' in window;
  const [run, setRun] = useState<WorkflowRunProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runWorktree, setRunWorktree] = useState<RunWorktree>();
  const [evidence, setEvidence] = useState<IntegrationEvidence>();
  const [confirmAction, setConfirmAction] = useState<'merge' | 'cleanup'>();
  const [merged, setMerged] = useState(false);
  const loadedRunId = run?.id;
  const loadedRunStatus = run?.status;

  useEffect(() => {
    if (runId) void service.getRun(runId).then(setRun);
  }, [runId, service]);

  useEffect(() => {
    if (!desktop || !loadedRunId || !activeWorkspace || loadedRunStatus === 'waiting') return;
    void invoke<RunWorktree>('orchestration_get_run_worktree', {
      repository: activeWorkspace.rootPath,
      runId: loadedRunId,
    })
      .then(setRunWorktree)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [activeWorkspace, desktop, loadedRunId, loadedRunStatus]);

  useEffect(() => {
    if (!desktop || run?.status !== 'completed' || !activeWorkspace || !runWorktree) return;
    void invoke<IntegrationEvidence>('orchestration_get_integration_evidence', {
      repository: activeWorkspace.rootPath,
      run: runWorktree,
    }).then(setEvidence);
  }, [activeWorkspace, desktop, run?.status, runWorktree]);

  if (!run) return <div className="workflow-loading">{c.runTitle}</div>;

  async function decideInitial(approved: boolean) {
    setBusy(true);
    setError('');
    try {
      let worktree: RunWorktree | undefined;
      if (approved && desktop) {
        if (!activeWorkspace) throw new Error('The project workspace is unavailable.');
        worktree = await invoke<RunWorktree>('orchestration_prepare_run_worktree', {
          repository: activeWorkspace.rootPath,
          runId: run!.id,
        });
      }
      const next = await service.decideRun(run!.id, approved);
      if (worktree) setRunWorktree(worktree);
      setRun(worktree ? { ...next, integrationBranch: worktree.branch } : next);
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
      setRun(await service.decideApproval(run!.id, approvalId, approved));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      if (desktop) {
        await invoke('orchestration_cancel_agent', { runId: run!.id }).catch(() => undefined);
      }
      setRun(await service.cancelRun(run!.id));
    } finally {
      setBusy(false);
    }
  }

  async function simulate(workflow: WorkflowDefinition) {
    const statuses = Object.fromEntries(
      run!.nodeRuns.map((node) => [node.nodeId, node.status]),
    ) as Record<string, NodeRunStatus>;
    const events = [...run!.events];
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
      ...run!,
      status: 'completed',
      nodeRuns: run!.nodeRuns.map((node) => ({ ...node, status: statuses[node.nodeId] })),
      events,
    };
    await service.persistProjection(next);
    setRun(next);
  }

  async function executeAgent(
    workflow: WorkflowDefinition,
    nodeRun: NodeRun,
    providers: ProviderStatus[],
  ) {
    const definition = workflow.nodes.find((node) => node.id === nodeRun.nodeId);
    if (!definition || definition.type !== 'agent') throw new Error('Agent node is unavailable.');
    if (!activeWorkspace || !runWorktree) throw new Error('The run worktree is unavailable.');
    const providerName = effectiveProvider(definition, providers);
    const provider = providers.find(
      (item) => item.provider === providerName && item.available && item.executablePath,
    );
    if (!provider?.executablePath) {
      throw new Error(`${providerName} is unavailable. Configure its executable path and sign in.`);
    }
    const nodeWorktree = await invoke<NodeWorktree>('orchestration_prepare_node_worktree', {
      repository: activeWorkspace.rootPath,
      run: runWorktree,
      nodeId: nodeRun.nodeId,
    });
    await invoke('orchestration_update_node_status', {
      runId: run!.id,
      nodeId: nodeRun.nodeId,
      status: 'running',
      worktreePath: nodeWorktree.path,
    });
    const onEvent = new Channel<ProviderEvent>();
    onEvent.onmessage = (event) => {
      if (event.event !== 'output') return;
      setRun((current) =>
        current
          ? {
              ...current,
              events: [
                ...current.events,
                { at: new Date().toISOString(), message: event.data.text },
              ],
            }
          : current,
      );
    };
    const skillContext = definition.skillIds.length
      ? await invoke<string>('orchestration_build_skill_context', {
          runId: run!.id,
          skillIds: definition.skillIds,
        })
      : '';
    await invoke('orchestration_start_agent', {
      input: {
        runId: run!.id,
        nodeId: nodeRun.nodeId,
        provider: providerName,
        providerPath: provider.executablePath,
        cwd: nodeWorktree.path,
        prompt: `${skillContext}${skillContext ? '\n\n' : ''}<astra-task>\n${definition.prompt}\n</astra-task>`,
        timeoutSeconds: definition.timeoutSeconds ?? workflow.settings.defaultTimeoutSeconds,
      },
      onEvent,
    });
    return { definition, nodeRun, nodeWorktree, providerName };
  }

  async function executeReadyBatch() {
    setBusy(true);
    setError('');
    try {
      const workflow = (await service.list()).find((item) => item.id === run!.workflowId);
      if (!workflow) throw new Error('The workflow definition is unavailable.');
      if (!desktop) {
        await simulate(workflow);
        return;
      }
      if (!activeWorkspace || !runWorktree)
        throw new Error('The approved worktree is unavailable.');
      const ready = run!.nodeRuns.filter((node) => node.status === 'ready');
      if (!ready.length) throw new Error('No node is ready to run.');
      const providers = await invoke<ProviderStatus[]>('orchestration_discover_providers', {
        input: loadProviderPreferences(),
      });
      const results = await Promise.allSettled(
        ready.map(async (nodeRun) => {
          const definition = workflow.nodes.find((node) => node.id === nodeRun.nodeId);
          if (!definition) throw new Error('The workflow node is unavailable.');
          if (definition.type === 'mcp_tool') {
            await invoke('orchestration_call_mcp_tool', {
              runId: run!.id,
              nodeId: nodeRun.nodeId,
              serverId: definition.serverId,
              toolName: definition.toolName,
              arguments: definition.arguments,
            });
            return { definition, nodeRun };
          }
          return executeAgent(workflow, nodeRun, providers);
        }),
      );
      const failures: string[] = [];
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        const nodeRun = ready[index];
        const definition = workflow.nodes.find((node) => node.id === nodeRun.nodeId)!;
        if (result.status === 'rejected') {
          const retry = await service.retryNode(
            run!.id,
            nodeRun.nodeId,
            definition.retries ?? workflow.settings.defaultRetries,
          );
          if (!retry)
            failures.push(
              result.reason instanceof Error ? result.reason.message : String(result.reason),
            );
          continue;
        }
        if ('nodeWorktree' in result.value) {
          const commit = await invoke<string>('orchestration_integrate_node', {
            repository: activeWorkspace.rootPath,
            run: runWorktree,
            node: result.value.nodeWorktree,
            workflowId: workflow.id,
          });
          await invoke('orchestration_update_node_evidence', {
            runId: run!.id,
            nodeId: nodeRun.nodeId,
            output: { commit, provider: result.value.providerName },
          });
          await invoke('orchestration_update_node_status', {
            runId: run!.id,
            nodeId: nodeRun.nodeId,
            status: 'succeeded',
            worktreePath: result.value.nodeWorktree.path,
          });
        }
      }
      const next = await service.reconcileRun(run!.id);
      setRun(next);
      if (failures.length) setError(failures.join(' '));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setRun(await service.reconcileRun(run!.id).catch(() => run));
    } finally {
      setBusy(false);
    }
  }

  async function confirmIntegrationAction() {
    if (!activeWorkspace || !runWorktree || !confirmAction) return;
    setBusy(true);
    try {
      if (confirmAction === 'merge') {
        await invoke('orchestration_merge_run', {
          repository: activeWorkspace.rootPath,
          run: runWorktree,
          approved: true,
        });
        setMerged(true);
      } else {
        await invoke('orchestration_cleanup_run_worktrees', {
          repository: activeWorkspace.rootPath,
          runId: run!.id,
          approved: true,
        });
        setRunWorktree(undefined);
      }
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
  const hasReady = run.nodeRuns.some((node) => node.status === 'ready');

  return (
    <section className="run-page">
      <header className="workflow-page-header">
        <div>
          <span className="eyebrow">{run.id}</span>
          <h1>{c.runTitle}</h1>
          <p>{c.runSummary}</p>
        </div>
        <button
          className="button button--danger"
          disabled={busy || ['cancelled', 'completed'].includes(run.status)}
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
      {run.status === 'interrupted' && (
        <div className="run-approval">
          <div>
            <RotateCcw size={18} />
            <strong>{language === 'zh-CN' ? '运行已中断' : 'Run interrupted'}</strong>
          </div>
          <button
            className="button button--primary"
            disabled={busy}
            onClick={() => void service.resumeRun(run.id).then(setRun)}
          >
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
      {hasReady && (
        <div className="run-approval">
          <div>
            <Play size={18} />
            <strong>{language === 'zh-CN' ? '节点已就绪' : 'Nodes ready'}</strong>
            <span>
              {language === 'zh-CN'
                ? '将在隔离 worktree 中按并发限制执行。'
                : 'The ready batch will run in isolated worktrees within the concurrency limit.'}
            </span>
          </div>
          <button
            className="button button--primary"
            disabled={busy}
            onClick={() => void executeReadyBatch()}
          >
            <Play size={15} />
            {language === 'zh-CN' ? '执行就绪批次' : 'Run ready batch'}
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
              disabled={busy || !runWorktree}
              onClick={() => setConfirmAction('cleanup')}
            >
              <Trash2 size={15} />
              {language === 'zh-CN' ? '清理 worktree' : 'Clean worktrees'}
            </button>
            <button
              className="button button--primary"
              disabled={busy || merged || !runWorktree}
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
                <strong>{node.nodeId}</strong>
                <small>
                  {c.attempt} {node.attempt}
                  {node.provider ? ` · ${node.provider}` : ''}
                </small>
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
