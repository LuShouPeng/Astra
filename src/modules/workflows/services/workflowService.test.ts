import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowDraft } from '../model/workflowPlanner';
import {
  BrowserWorkflowAdapter,
  createDefaultWorkflowService,
  createWorkflowService,
  TauriWorkflowAdapter,
  type WorkflowAdapter,
  type WorkflowRunProjection,
} from './workflowService';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

describe('workflow service browser fallback', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedInvoke.mockReset();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('persists workflows and creates resumable run projections', async () => {
    const service = createWorkflowService(new BrowserWorkflowAdapter());
    const workflow = createWorkflowDraft('project-1', 'Build');
    await service.save(workflow);
    expect(await service.list()).toEqual([workflow]);

    const run = await service.createRun(workflow);
    expect(run.status).toBe('waiting');
    expect((await service.getRun(run.id))?.nodeRuns).toHaveLength(workflow.nodes.length);
    const approved = await service.decideRun(run.id, true);
    expect(approved.status).toBe('queued');
    expect(approved.nodeRuns[0]?.status).toBe('ready');
    const cancelled = await service.cancelRun(run.id);
    expect(cancelled.status).toBe('cancelled');
  });

  it('selects DAG roots instead of the first array item after offline approval', async () => {
    const service = createWorkflowService(new BrowserWorkflowAdapter());
    const workflow = createWorkflowDraft('project-1', 'Build');
    workflow.nodes = [workflow.nodes[2], workflow.nodes[1], workflow.nodes[0]];
    await service.save(workflow);

    const run = await service.createRun(workflow);
    const approved = await service.decideRun(run.id, true);
    const statuses = Object.fromEntries(
      approved.nodeRuns.map((node) => [node.nodeId, node.status]),
    );

    expect(statuses[workflow.nodes[2].id]).toBe('ready');
    expect(statuses[workflow.nodes[0].id]).toBe('pending');
  });

  it('recovers from corrupt storage and replaces workflows and templates by id', async () => {
    localStorage.setItem('astra.workflow.definitions.v1', '{broken');
    const adapter = new BrowserWorkflowAdapter();
    expect(await adapter.list()).toEqual([]);
    const first = createWorkflowDraft('project-1', 'First');
    const replacement = { ...first, name: 'Replacement' };
    await adapter.save(first);
    await adapter.save(replacement);
    await adapter.saveTemplate(first);
    await adapter.saveTemplate(replacement);
    expect(await adapter.list()).toEqual([replacement]);
    expect(await adapter.listTemplates()).toEqual([replacement]);
    expect(await adapter.getRun('missing')).toBeNull();
  });

  it('handles rejection, missing runs, retries, fallback reconciliation, and resume', async () => {
    const adapter = new BrowserWorkflowAdapter();
    const service = createWorkflowService(adapter);
    const workflow = createWorkflowDraft('project-1', 'Build');
    const run = await service.createRun(workflow);
    const rejected = await service.decideRun(run.id, false);
    expect(rejected.status).toBe('cancelled');
    expect(rejected.nodeRuns[0]?.status).toBe('cancelled');
    expect(await service.reconcileRun(run.id)).toEqual(rejected);
    expect(await service.resumeRun(run.id)).toEqual(rejected);
    expect(await service.retryNode(run.id, 'missing', 1)).toBe(false);
    await expect(service.decideRun('missing', true)).rejects.toThrow('not found');
    await expect(service.cancelRun('missing')).rejects.toThrow('not found');
  });

  it('preserves terminal node statuses while cancelling active work', async () => {
    const adapter = new BrowserWorkflowAdapter();
    const service = createWorkflowService(adapter);
    const workflow = createWorkflowDraft('project-1', 'Build');
    const run = await service.createRun(workflow);
    run.nodeRuns = [
      { ...run.nodeRuns[0], status: 'succeeded' },
      { ...run.nodeRuns[1], status: 'skipped' },
      { ...run.nodeRuns[2], status: 'running' },
    ];
    await adapter.saveRun(run);
    const cancelled = await service.cancelRun(run.id);
    expect(cancelled.nodeRuns.map((node) => node.status)).toEqual([
      'succeeded',
      'skipped',
      'cancelled',
    ]);
  });

  it('requires a completed browser run before creating and deciding a final merge approval', async () => {
    const adapter = new BrowserWorkflowAdapter();
    const service = createWorkflowService(adapter);
    const workflow = createWorkflowDraft('project-1', 'Build');
    const run = await service.createRun(workflow);

    await expect(service.requestFinalMerge(run.id)).rejects.toThrow('Only a completed workflow run');
    await expect(service.requestFinalMerge('missing')).rejects.toThrow('not found');

    const completed = { ...run, status: 'completed' as const };
    await adapter.saveRun(completed);
    const awaitingApproval = await service.requestFinalMerge(run.id);
    const approval = awaitingApproval.mergeApproval!;

    await expect(service.decideFinalMerge(run.id, 'wrong-approval', true)).rejects.toThrow(
      'cannot be decided',
    );
    await expect(service.decideFinalMerge('missing', approval.id, true)).rejects.toThrow('not found');

    const rejected = await service.decideFinalMerge(run.id, approval.id, false);
    expect(rejected.mergeApproval).toMatchObject({ id: approval.id, status: 'rejected' });
    expect(rejected.mergeApproval?.mergedCommit).toBeUndefined();
  });

  it('uses stable browser fallbacks when the coordinator hooks are absent', async () => {
    const adapter = new BrowserWorkflowAdapter();
    const service = createWorkflowService(adapter);
    const workflow = createWorkflowDraft('project-1', 'Build');
    const run = await service.createRun(workflow);

    expect(await service.scheduleRun(run.id)).toEqual(run);
    expect(await service.listRunEventsAfter(run.id, 4)).toEqual([]);
  });

  it('selects the desktop adapter only when the Tauri runtime is present', async () => {
    expect(createDefaultWorkflowService()).toBeDefined();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mockedInvoke.mockResolvedValueOnce([]);
    expect(await createDefaultWorkflowService().list()).toEqual([]);
  });
});

describe('Tauri workflow adapter', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedInvoke.mockReset();
  });

  it('maps workflow and template records and sends structured save inputs', async () => {
    const workflow = createWorkflowDraft('project-1', 'Build');
    mockedInvoke
      .mockResolvedValueOnce([{ definitionJson: JSON.stringify(workflow) }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ definitionJson: JSON.stringify(workflow) }])
      .mockResolvedValueOnce(undefined);
    const adapter = new TauriWorkflowAdapter();
    expect(await adapter.list()).toEqual([workflow]);
    await adapter.save(workflow);
    expect(await adapter.listTemplates()).toEqual([workflow]);
    await adapter.saveTemplate(workflow);
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, 'orchestration_save_workflow', {
      input: {
        id: workflow.id,
        version: workflow.version,
        name: workflow.name,
        projectId: workflow.projectId,
        definitionJson: JSON.stringify(workflow),
      },
    });
    expect(mockedInvoke).toHaveBeenNthCalledWith(4, 'orchestration_save_template', {
      input: {
        id: workflow.id,
        version: workflow.version,
        name: workflow.name,
        projectId: workflow.projectId,
        definitionJson: JSON.stringify(workflow),
      },
    });
  });

  it('hydrates backend run evidence and translates runtime event variants', async () => {
    const adapter = new TauriWorkflowAdapter();
    mockedInvoke.mockResolvedValueOnce({
      run: {
        id: 'run-1',
        workflowId: 'workflow-1',
        workflowVersion: 2,
        projectId: 'project-1',
        status: 'running',
        integrationBranch: 'astra/run-run-1',
      },
      nodes: [
        {
          id: 'node-run-1',
          runId: 'run-1',
          nodeId: 'node-1',
          status: 'succeeded',
          attempt: 1,
          outputJson: '{"ok":true}',
        },
        {
          id: 'node-run-2',
          runId: 'run-1',
          nodeId: 'node-2',
          status: 'pending',
          attempt: 1,
        },
      ],
      approvals: [],
      events: [
        { sequence: 1, eventJson: '{"message":"Ready"}', createdAt: '2026-01-01' },
        {
          sequence: 2,
          eventJson: '{"type":"node_started","nodeId":"node-1"}',
          createdAt: '2026-01-02',
        },
        { sequence: 3, eventJson: 'raw event', createdAt: '2026-01-03' },
      ],
    });
    const projection = await adapter.getRun('run-1');
    expect(projection?.nodeRuns[0]?.output).toEqual({ ok: true });
    expect(projection?.nodeRuns[1]?.output).toBeUndefined();
    expect(projection?.events.map((event) => event.message)).toEqual([
      'Ready',
      'node started · node-1',
      'raw event',
    ]);
  });

  it('sends the immutable desktop execution context when creating a run', async () => {
    const adapter = new TauriWorkflowAdapter();
    const run: WorkflowRunProjection = {
      id: 'run-context',
      workflowId: 'workflow-1',
      workflowVersion: 1,
      projectId: 'project-1',
      status: 'waiting',
      integrationBranch: 'astra/run-run-context',
      createdAt: '2026-01-01',
      nodeRuns: [{ id: 'run-context-agent', runId: 'run-context', nodeId: 'agent', status: 'pending', attempt: 1 }],
      events: [],
    };
    mockedInvoke.mockResolvedValueOnce(undefined);

    await adapter.saveRun(run, {
      repositoryPath: 'C:/projects/astra',
      providerPaths: { codexPath: 'C:/tools/codex.exe' },
    });

    expect(mockedInvoke).toHaveBeenCalledWith('orchestration_create_run', {
      input: {
        id: run.id,
        workflowId: run.workflowId,
        workflowVersion: run.workflowVersion,
        projectId: run.projectId,
        integrationBranch: run.integrationBranch,
        nodeIds: ['agent'],
        executionContext: {
          repositoryPath: 'C:/projects/astra',
          providerPathsJson: '{"codexPath":"C:/tools/codex.exe"}',
        },
      },
    });
  });

  it('rejects Tauri run persistence without a repository execution context', async () => {
    const adapter = new TauriWorkflowAdapter();
    const run: WorkflowRunProjection = {
      id: 'run-missing-context',
      workflowId: 'workflow-1',
      workflowVersion: 1,
      projectId: 'project-1',
      status: 'waiting',
      createdAt: '2026-01-01',
      nodeRuns: [],
      events: [],
    };

    await expect(adapter.saveRun(run)).rejects.toThrow('requires a project repository path');
  });

  it('uses the persisted final-merge approval commands instead of passing Git paths from the page', async () => {
    const adapter = new TauriWorkflowAdapter();
    const backend = {
      run: {
        id: 'run-merge',
        workflowId: 'workflow-1',
        workflowVersion: 1,
        projectId: 'project-1',
        status: 'completed',
      },
      nodes: [],
      approvals: [],
      artifacts: [],
      attentions: [],
      events: [],
      mergeApproval: {
        id: 'merge-1',
        runId: 'run-merge',
        status: 'pending',
        summary: 'Merge reviewed workflow changes.',
      },
    };
    mockedInvoke.mockResolvedValueOnce(backend).mockResolvedValueOnce(undefined).mockResolvedValueOnce(backend);

    expect((await adapter.requestFinalMerge('run-merge'))?.mergeApproval?.id).toBe('merge-1');
    expect(
      (await adapter.decideFinalMerge('run-merge', 'merge-1', true))?.mergeApproval?.status,
    ).toBe('pending');
    expect(mockedInvoke).toHaveBeenNthCalledWith(1, 'orchestration_request_final_merge', {
      runId: 'run-merge',
    });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, 'orchestration_decide_final_merge', {
      approvalId: 'merge-1',
      approved: true,
    });
  });

  it('falls back to the local projection and forwards runtime controls', async () => {
    const adapter = new TauriWorkflowAdapter();
    const local: WorkflowRunProjection = {
      id: 'run-local',
      workflowId: 'workflow-1',
      workflowVersion: 1,
      projectId: 'project-1',
      status: 'waiting',
      createdAt: '2026-01-01',
      nodeRuns: [],
      events: [],
    };
    await new BrowserWorkflowAdapter().saveRun(local);
    mockedInvoke.mockResolvedValueOnce(null);
    expect(await adapter.getRun(local.id)).toEqual(local);

    mockedInvoke.mockResolvedValue(undefined);
    await adapter.decideRun(local.id, true);
    await adapter.cancelRun(local.id);
    await adapter.decideApproval('approval-1', false);
    mockedInvoke.mockResolvedValueOnce(true);
    expect(await adapter.retryNode(local.id, 'node-1', 2)).toBe(true);
    expect(mockedInvoke).toHaveBeenCalledWith('orchestration_cancel_run', { runId: local.id });
  });

  it('uses native reconciliation for approvals and native resume projections', async () => {
    const run: WorkflowRunProjection = {
      id: 'run-1',
      workflowId: 'workflow-1',
      workflowVersion: 1,
      projectId: 'project-1',
      status: 'waiting',
      createdAt: '2026-01-01',
      nodeRuns: [],
      events: [],
    };
    const adapter: WorkflowAdapter = {
      list: async () => [],
      save: async () => undefined,
      saveRun: async () => undefined,
      getRun: async () => run,
      listTemplates: async () => [],
      saveTemplate: async () => undefined,
      decideApproval: vi.fn(async () => undefined),
      reconcileRun: vi.fn(async (): Promise<WorkflowRunProjection> => ({
        ...run,
        status: 'running',
      })),
      resumeRun: vi.fn(async (): Promise<WorkflowRunProjection> => ({ ...run, status: 'queued' })),
    };
    const service = createWorkflowService(adapter);
    expect((await service.decideApproval(run.id, 'approval-1', true)).status).toBe('running');
    expect((await service.resumeRun(run.id)).status).toBe('queued');
    expect(adapter.decideApproval).toHaveBeenCalledWith('approval-1', true);
  });

  it('uses the coordinator for scheduling and recovers persisted events by cursor', async () => {
    const adapter = new TauriWorkflowAdapter();
    const backend = {
      run: {
        id: 'run-events',
        workflowId: 'workflow-1',
        workflowVersion: 1,
        projectId: 'project-1',
        status: 'running',
      },
      nodes: [],
      approvals: [],
      artifacts: [],
      attentions: [],
      events: [],
    };
    mockedInvoke
      .mockResolvedValueOnce([
        {
          sequence: 4,
          eventJson: '{"type":"node_succeeded","nodeId":"agent-1"}',
          createdAt: '2026-07-25T12:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce(backend);

    await expect(adapter.listRunEventsAfter('run-events', 3, 100)).resolves.toEqual([
      {
        sequence: 4,
        eventJson: '{"type":"node_succeeded","nodeId":"agent-1"}',
        createdAt: '2026-07-25T12:00:00.000Z',
      },
    ]);
    expect((await adapter.scheduleRun('run-events'))?.status).toBe('running');
    expect(mockedInvoke).toHaveBeenNthCalledWith(1, 'orchestration_list_run_events_after', {
      runId: 'run-events',
      afterSequence: 3,
      limit: 100,
    });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, 'orchestration_schedule_run', {
      runId: 'run-events',
    });
  });
});
