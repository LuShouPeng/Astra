import { GitBranch, Play, ShieldCheck, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Channel, invoke } from '@tauri-apps/api/core';
import { useI18n } from '../../../core/i18n/I18nContext';
import type { NodeRunStatus } from '../../../core/contracts/workflows';
import {
  createDefaultWorkflowService,
  type WorkflowRunProjection,
  type WorkflowService,
} from '../services/workflowService';
import { workflowCopy } from '../workflowCopy';
import { useWorkspace } from '../../workspace';
import { readyNodeIds } from '../model/workflowGraph';

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
}
type ProviderEvent =
  | { event: 'output'; data: { stream: string; text: string } }
  | { event: 'session'; data: { externalSessionId: string } }
  | { event: 'started' | 'completed' | 'failed'; data: Record<string, unknown> };

export function WorkflowRunPage({ service: supplied }: { service?: WorkflowService }) {
  const service = useMemo(() => supplied ?? createDefaultWorkflowService(), [supplied]);
  const { runId } = useParams();
  const { language } = useI18n();
  const c = workflowCopy(language);
  const { activeWorkspace } = useWorkspace();
  const [run, setRun] = useState<WorkflowRunProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runWorktree, setRunWorktree] = useState<RunWorktree>();
  useEffect(() => {
    if (runId) void service.getRun(runId).then(setRun);
  }, [runId, service]);
  if (!run) return <div className="workflow-loading">{c.runTitle}</div>;
  async function decide(approved: boolean) {
    if (!run) return;
    setBusy(true);
    setError('');
    try {
      let worktree: RunWorktree | undefined;
      if (approved && '__TAURI_INTERNALS__' in window) {
        if (!activeWorkspace) throw new Error('The project workspace is unavailable.');
        worktree = await invoke<RunWorktree>('orchestration_prepare_run_worktree', {
          repository: activeWorkspace.rootPath,
          runId: run.id,
        });
      }
      const next = await service.decideRun(run.id, approved);
      if (worktree) setRunWorktree(worktree);
      setRun(worktree ? { ...next, integrationBranch: worktree.branch } : next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The run decision failed.');
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!run) return;
    setBusy(true);
    try {
      setRun(await service.cancelRun(run.id));
    } finally {
      setBusy(false);
    }
  }
  async function startReadyNode() {
    if (!run) return;
    setBusy(true);
    setError('');
    try {
      const workflow = (await service.list()).find((item) => item.id === run.workflowId);
      if (!workflow) throw new Error('The workflow definition is unavailable.');
      const ready = run.nodeRuns.find((node) => node.status === 'ready');
      if (!ready) throw new Error('No node is ready to run.');
      const definitionNode = workflow.nodes.find((node) => node.id === ready.nodeId);
      if (!definitionNode) throw new Error('The workflow node is unavailable.');

      if (!('__TAURI_INTERNALS__' in window)) {
        const statuses: Record<string, NodeRunStatus> = Object.fromEntries(
          run.nodeRuns.map((node) => [
            node.nodeId,
            node.nodeId === ready.nodeId ? 'succeeded' : node.status,
          ]),
        );
        const nextReady = readyNodeIds(workflow, statuses);
        const next: WorkflowRunProjection = {
          ...run,
          status: nextReady.length ? 'running' : 'completed',
          nodeRuns: run.nodeRuns.map((node) =>
            node.nodeId === ready.nodeId
              ? { ...node, status: 'succeeded' }
              : nextReady.includes(node.nodeId)
                ? { ...node, status: 'ready' }
                : node,
          ),
          events: [
            ...run.events,
            {
              at: new Date().toISOString(),
              message: `${definitionNode.name} completed in simulation mode.`,
            },
          ],
        };
        await service.persistProjection(next);
        setRun(next);
        return;
      }

      if (definitionNode.type !== 'agent')
        throw new Error('This node type requires its dedicated runtime.');
      if (!activeWorkspace || !runWorktree)
        throw new Error('The approved run worktree is unavailable.');
      if (ready.provider !== 'claude' && ready.provider !== 'codex')
        throw new Error('No executable Provider was routed to this node.');
      const providers = await invoke<ProviderStatus[]>('orchestration_discover_providers', {
        input: {},
      });
      const provider = providers.find(
        (item) => item.provider === ready.provider && item.available && item.executablePath,
      );
      if (!provider?.executablePath)
        throw new Error(
          `${ready.provider} is not available. Configure its executable path and sign in first.`,
        );
      const nodeWorktree = await invoke<NodeWorktree>('orchestration_prepare_node_worktree', {
        repository: activeWorkspace.rootPath,
        run: runWorktree,
        nodeId: ready.nodeId,
      });
      await invoke('orchestration_update_node_status', {
        runId: run.id,
        nodeId: ready.nodeId,
        status: 'running',
        worktreePath: nodeWorktree.path,
      });
      const running: WorkflowRunProjection = {
        ...run,
        status: 'running',
        nodeRuns: run.nodeRuns.map((node) =>
          node.id === ready.id
            ? { ...node, status: 'running', worktreePath: nodeWorktree.path }
            : node,
        ),
        events: [
          ...run.events,
          {
            at: new Date().toISOString(),
            message: `${ready.provider} started ${definitionNode.name}.`,
          },
        ],
      };
      setRun(running);
      await service.persistProjection(running);
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
      await invoke('orchestration_start_agent', {
        input: {
          runId: ready.id,
          provider: ready.provider,
          providerPath: provider.executablePath,
          cwd: nodeWorktree.path,
          prompt: definitionNode.prompt,
        },
        onEvent,
      });
      await invoke('orchestration_integrate_node', {
        repository: activeWorkspace.rootPath,
        run: runWorktree,
        node: nodeWorktree,
        workflowId: workflow.id,
      });
      await invoke('orchestration_update_node_status', {
        runId: run.id,
        nodeId: ready.nodeId,
        status: 'succeeded',
        worktreePath: nodeWorktree.path,
      });
      const succeeded: WorkflowRunProjection = {
        ...running,
        nodeRuns: running.nodeRuns.map((node) =>
          node.id === ready.id ? { ...node, status: 'succeeded' } : node,
        ),
        events: [
          ...running.events,
          {
            at: new Date().toISOString(),
            message: `${definitionNode.name} committed and integrated.`,
          },
        ],
      };
      await service.persistProjection(succeeded);
      setRun(succeeded);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
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
          disabled={busy || run.status === 'cancelled'}
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
      {run.status === 'waiting' && (
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
              onClick={() => void decide(false)}
            >
              {language === 'zh-CN' ? '拒绝' : 'Reject'}
            </button>
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void decide(true)}
            >
              {c.approve}
            </button>
          </div>
        </div>
      )}
      {(run.status === 'queued' || run.status === 'running') &&
        run.nodeRuns.some((node) => node.status === 'ready') && (
          <div className="run-approval">
            <div>
              <Play size={18} />
              <strong>{language === 'zh-CN' ? '节点已就绪' : 'Node ready'}</strong>
              <span>
                {language === 'zh-CN'
                  ? '启动将允许 Provider 在隔离 worktree 中执行。'
                  : 'Starting allows the Provider to execute inside its isolated worktree.'}
              </span>
            </div>
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void startReadyNode()}
            >
              <Play size={15} />
              {language === 'zh-CN' ? '批准并启动 Agent' : 'Approve and start Agent'}
            </button>
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
          <strong>{run.status === 'waiting' ? c.waiting : run.status}</strong>
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
