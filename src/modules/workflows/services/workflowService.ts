import { invoke } from '@tauri-apps/api/core';
import type { NodeRun, WorkflowDefinition, WorkflowRun } from '../../../core/contracts/workflows';

export interface WorkflowRunProjection extends WorkflowRun {
  nodeRuns: NodeRun[];
  events: Array<{ at: string; message: string }>;
}

export interface WorkflowAdapter {
  list(): Promise<WorkflowDefinition[]>;
  save(workflow: WorkflowDefinition): Promise<void>;
  saveRun(run: WorkflowRunProjection): Promise<void>;
  getRun(id: string): Promise<WorkflowRunProjection | null>;
  decideRun?(id: string, approved: boolean): Promise<void>;
  cancelRun?(id: string): Promise<void>;
}

const WORKFLOWS_KEY = 'astra.workflow.definitions.v1';
const RUNS_KEY = 'astra.workflow.runs.v1';

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
}

interface WorkflowRecord {
  definitionJson: string;
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

  async decideRun(id: string, approved: boolean) {
    await invoke('orchestration_decide_run', { runId: id, approved });
  }

  async cancelRun(id: string) {
    await invoke('orchestration_cancel_run', { runId: id });
  }
}

export function createWorkflowService(adapter: WorkflowAdapter) {
  return {
    list: () => adapter.list(),
    save: (workflow: WorkflowDefinition) => adapter.save(workflow),
    getRun: (id: string) => adapter.getRun(id),
    persistProjection: (run: WorkflowRunProjection) => new BrowserWorkflowAdapter().saveRun(run),
    async decideRun(id: string, approved: boolean) {
      const run = await adapter.getRun(id);
      if (!run) throw new Error('Workflow run was not found.');
      await adapter.decideRun?.(id, approved);
      const next: WorkflowRunProjection = {
        ...run,
        status: approved ? 'queued' : 'cancelled',
        nodeRuns: run.nodeRuns.map((node, index) =>
          index === 0 ? { ...node, status: approved ? 'ready' : 'cancelled' } : node,
        ),
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
        integrationBranch: `astra/run-${runId.slice(-8)}`,
        createdAt: now,
        nodeRuns: workflow.nodes.map((node, index) => ({
          id: `${runId}-${node.id}`,
          runId,
          nodeId: node.id,
          status: index === 0 ? 'waiting_approval' : 'pending',
          attempt: 1,
          provider: node.type === 'agent' && node.provider !== 'auto' ? node.provider : undefined,
        })),
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
