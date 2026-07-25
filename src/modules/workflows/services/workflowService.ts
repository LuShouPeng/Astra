import { invoke } from '@tauri-apps/api/core';
import type {
  ApprovalRequest,
  NodeRun,
  WorkflowDefinition,
  WorkflowRun,
} from '../../../core/contracts/workflows';
import { readyNodeIds } from '../model/workflowGraph';

export interface WorkflowRunProjection extends WorkflowRun {
  nodeRuns: NodeRun[];
  approvals?: ApprovalRequest[];
  artifacts?: WorkflowArtifact[];
  events: Array<{ at: string; message: string }>;
}

export interface WorkflowArtifact {
  id: string;
  runId: string;
  nodeRunId?: string;
  kind: string;
  path: string;
  contentHash: string;
  byteLength: number;
}

export interface WorkflowAdapter {
  list(): Promise<WorkflowDefinition[]>;
  save(workflow: WorkflowDefinition): Promise<void>;
  saveRun(run: WorkflowRunProjection): Promise<void>;
  getRun(id: string): Promise<WorkflowRunProjection | null>;
  decideRun?(id: string, approved: boolean): Promise<void>;
  cancelRun?(id: string): Promise<void>;
  reconcileRun?(id: string): Promise<WorkflowRunProjection>;
  decideApproval?(id: string, approved: boolean): Promise<void>;
  retryNode?(runId: string, nodeId: string, maxRetries: number): Promise<boolean>;
  resumeRun?(id: string): Promise<WorkflowRunProjection>;
  listTemplates(): Promise<WorkflowDefinition[]>;
  saveTemplate(workflow: WorkflowDefinition): Promise<void>;
}

const WORKFLOWS_KEY = 'astra.workflow.definitions.v1';
const RUNS_KEY = 'astra.workflow.runs.v1';
const TEMPLATES_KEY = 'astra.workflow.templates.v1';

function readArray<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as T[];
  } catch {
    return [];
  }
}

export class BrowserWorkflowAdapter implements WorkflowAdapter {
  list() {
    return Promise.resolve(readArray<WorkflowDefinition>(WORKFLOWS_KEY));
  }

  async save(workflow: WorkflowDefinition) {
    const next = (await this.list()).filter((item) => item.id !== workflow.id);
    localStorage.setItem(WORKFLOWS_KEY, JSON.stringify([workflow, ...next]));
  }

  saveRun(run: WorkflowRunProjection) {
    const next = readArray<WorkflowRunProjection>(RUNS_KEY).filter((item) => item.id !== run.id);
    localStorage.setItem(RUNS_KEY, JSON.stringify([run, ...next]));
    return Promise.resolve();
  }

  getRun(id: string) {
    return Promise.resolve(
      readArray<WorkflowRunProjection>(RUNS_KEY).find((run) => run.id === id) ?? null,
    );
  }

  listTemplates() {
    return Promise.resolve(readArray<WorkflowDefinition>(TEMPLATES_KEY));
  }

  async saveTemplate(workflow: WorkflowDefinition) {
    const next = (await this.listTemplates()).filter((item) => item.id !== workflow.id);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify([workflow, ...next]));
  }
}

interface WorkflowRecord {
  definitionJson: string;
}
interface WorkflowTemplateRecord {
  definitionJson: string;
}

interface BackendRunProjection {
  run: {
    id: string;
    workflowId: string;
    workflowVersion: number;
    projectId: string;
    status: WorkflowRun['status'];
    integrationBranch?: string;
  };
  nodes: Array<
    NodeRun & {
      outputJson?: string;
      externalSessionId?: string;
      error?: string;
    }
  >;
  approvals: ApprovalRequest[];
  artifacts: WorkflowArtifact[];
  events: Array<{ sequence: number; eventJson: string; createdAt: string }>;
}

function eventMessage(eventJson: string): string {
  try {
    const event = JSON.parse(eventJson) as Record<string, unknown>;
    if (typeof event.message === 'string') return event.message;
    const type = typeof event.type === 'string' ? event.type.replaceAll('_', ' ') : 'runtime event';
    const node = typeof event.nodeId === 'string' ? ` · ${event.nodeId}` : '';
    return `${type}${node}`;
  } catch {
    return eventJson;
  }
}

export class TauriWorkflowAdapter extends BrowserWorkflowAdapter {
  override async list(): Promise<WorkflowDefinition[]> {
    const records = await invoke<WorkflowRecord[]>('orchestration_list_workflows');
    return records.map((record) => JSON.parse(record.definitionJson) as WorkflowDefinition);
  }

  override async save(workflow: WorkflowDefinition): Promise<void> {
    await invoke('orchestration_save_workflow', {
      input: {
        id: workflow.id,
        version: workflow.version,
        name: workflow.name,
        projectId: workflow.projectId,
        definitionJson: JSON.stringify(workflow),
      },
    });
  }

  override async listTemplates() {
    const records = await invoke<WorkflowTemplateRecord[]>('orchestration_list_templates');
    return records.map((record) => JSON.parse(record.definitionJson) as WorkflowDefinition);
  }

  override async saveTemplate(workflow: WorkflowDefinition) {
    await invoke('orchestration_save_template', {
      input: {
        id: workflow.id,
        version: workflow.version,
        name: workflow.name,
        projectId: workflow.projectId,
        definitionJson: JSON.stringify(workflow),
      },
    });
  }

  override async saveRun(run: WorkflowRunProjection): Promise<void> {
    await invoke('orchestration_create_run', {
      input: {
        id: run.id,
        workflowId: run.workflowId,
        workflowVersion: run.workflowVersion,
        projectId: run.projectId,
        integrationBranch: run.integrationBranch,
        nodeIds: run.nodeRuns.map((node) => node.nodeId),
      },
    });
    await super.saveRun(run);
  }

  private async projection(id: string, command = 'orchestration_get_run') {
    const [backend, local] = await Promise.all([
      invoke<BackendRunProjection | null>(command, { runId: id }),
      super.getRun(id),
    ]);
    if (!backend) return local;
    return {
      ...(local ?? {
        id: backend.run.id,
        workflowId: backend.run.workflowId,
        workflowVersion: backend.run.workflowVersion,
        projectId: backend.run.projectId,
        createdAt: new Date().toISOString(),
        events: [],
      }),
      ...backend.run,
      nodeRuns: backend.nodes.map((node) => ({
        ...node,
        output: node.outputJson
          ? (JSON.parse(node.outputJson) as Record<string, unknown>)
          : undefined,
      })),
      approvals: backend.approvals,
      artifacts: backend.artifacts,
      events: backend.events.map((event) => ({
        at: event.createdAt,
        message: eventMessage(event.eventJson),
      })),
    } satisfies WorkflowRunProjection;
  }

  override getRun(id: string) {
    return this.projection(id);
  }

  reconcileRun(id: string) {
    return this.projection(id, 'orchestration_reconcile_run') as Promise<WorkflowRunProjection>;
  }

  async decideRun(id: string, approved: boolean) {
    await invoke('orchestration_decide_run', { runId: id, approved });
  }

  async cancelRun(id: string) {
    await invoke('orchestration_cancel_run', { runId: id });
  }

  async decideApproval(id: string, approved: boolean) {
    await invoke('orchestration_decide_approval', { approvalId: id, approved });
  }

  retryNode(runId: string, nodeId: string, maxRetries: number) {
    return invoke<boolean>('orchestration_retry_node', { runId, nodeId, maxRetries });
  }

  resumeRun(id: string) {
    return this.projection(id, 'orchestration_resume_run') as Promise<WorkflowRunProjection>;
  }
}

export function createWorkflowService(adapter: WorkflowAdapter) {
  return {
    list: () => adapter.list(),
    save: (workflow: WorkflowDefinition) => adapter.save(workflow),
    listTemplates: () => adapter.listTemplates(),
    saveTemplate: (workflow: WorkflowDefinition) => adapter.saveTemplate(workflow),
    getRun: (id: string) => adapter.getRun(id),
    persistProjection: (run: WorkflowRunProjection) => new BrowserWorkflowAdapter().saveRun(run),
    async decideRun(id: string, approved: boolean) {
      const run = await adapter.getRun(id);
      if (!run) throw new Error('Workflow run was not found.');
      await adapter.decideRun?.(id, approved);
      if (approved && adapter.reconcileRun) {
        const reconciled = await adapter.reconcileRun(id);
        await new BrowserWorkflowAdapter().saveRun(reconciled);
        return reconciled;
      }
      let nodeRuns: NodeRun[];
      if (approved) {
        const workflow = (await adapter.list()).find((item) => item.id === run.workflowId);
        const pending = Object.fromEntries(
          run.nodeRuns.map((node) => [node.nodeId, 'pending' as const]),
        );
        const ready = new Set(
          workflow ? readyNodeIds(workflow, pending) : [run.nodeRuns[0]?.nodeId],
        );
        nodeRuns = run.nodeRuns.map((node) => ({
          ...node,
          status: ready.has(node.nodeId) ? 'ready' : 'pending',
        }));
      } else {
        nodeRuns = run.nodeRuns.map((node) =>
          ['succeeded', 'skipped'].includes(node.status) ? node : { ...node, status: 'cancelled' },
        );
      }
      const next: WorkflowRunProjection = {
        ...run,
        status: approved ? 'queued' : 'cancelled',
        nodeRuns,
        events: [
          ...run.events,
          {
            at: new Date().toISOString(),
            message: approved ? 'Worktree creation approved.' : 'Run rejected.',
          },
        ],
      };
      await new BrowserWorkflowAdapter().saveRun(next);
      return next;
    },
    async reconcileRun(id: string) {
      if (!adapter.reconcileRun) {
        const run = await adapter.getRun(id);
        if (!run) throw new Error('Workflow run was not found.');
        return run;
      }
      const next = await adapter.reconcileRun(id);
      await new BrowserWorkflowAdapter().saveRun(next);
      return next;
    },
    async decideApproval(id: string, approvalId: string, approved: boolean) {
      await adapter.decideApproval?.(approvalId, approved);
      return this.reconcileRun(id);
    },
    retryNode: (runId: string, nodeId: string, maxRetries: number) =>
      adapter.retryNode?.(runId, nodeId, maxRetries) ?? Promise.resolve(false),
    async resumeRun(id: string) {
      if (!adapter.resumeRun) return this.reconcileRun(id);
      const next = await adapter.resumeRun(id);
      await new BrowserWorkflowAdapter().saveRun(next);
      return next;
    },
    async cancelRun(id: string) {
      const run = await adapter.getRun(id);
      if (!run) throw new Error('Workflow run was not found.');
      await adapter.cancelRun?.(id);
      const next: WorkflowRunProjection = {
        ...run,
        status: 'cancelled',
        nodeRuns: run.nodeRuns.map((node) => ({
          ...node,
          status: ['succeeded', 'skipped'].includes(node.status) ? node.status : 'cancelled',
        })),
        events: [
          ...run.events,
          {
            at: new Date().toISOString(),
            message: 'Run cancelled; uncommitted changes were preserved.',
          },
        ],
      };
      await new BrowserWorkflowAdapter().saveRun(next);
      return next;
    },
    async createRun(workflow: WorkflowDefinition): Promise<WorkflowRunProjection> {
      const now = new Date().toISOString();
      const runId = `run-${crypto.randomUUID()}`;
      const run: WorkflowRunProjection = {
        id: runId,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        projectId: workflow.projectId,
        status: 'waiting',
        integrationBranch: `astra/run-${runId}`,
        createdAt: now,
        nodeRuns: workflow.nodes.map((node, index) => ({
          id: `${runId}-${node.id}`,
          runId,
          nodeId: node.id,
          status: index === 0 ? 'waiting_approval' : 'pending',
          attempt: 1,
          provider: node.type === 'agent' && node.provider !== 'auto' ? node.provider : undefined,
        })),
        approvals: [
          {
            id: `approval-${runId}`,
            runId,
            nodeRunId: `${runId}-${workflow.nodes[0].id}`,
            capability: 'worktree',
            risk: 'medium',
            summary: 'Create isolated integration and Agent worktrees.',
            status: 'pending',
            createdAt: now,
          },
        ],
        events: [{ at: now, message: 'Run created. Worktree creation requires approval.' }],
      };
      await adapter.saveRun(run);
      return run;
    },
  };
}

export type WorkflowService = ReturnType<typeof createWorkflowService>;

export function createDefaultWorkflowService(): WorkflowService {
  const isTauri = '__TAURI_INTERNALS__' in window;
  return createWorkflowService(isTauri ? new TauriWorkflowAdapter() : new BrowserWorkflowAdapter());
}
