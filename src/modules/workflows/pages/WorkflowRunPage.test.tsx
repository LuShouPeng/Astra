import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../core/i18n/I18nContext';
import type { WorkflowDefinition } from '../../../core/contracts/workflows';
import type { WorkflowRunProjection, WorkflowService } from '../services/workflowService';
import { WorkflowRunPage } from './WorkflowRunPage';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('../../workspace', () => ({
  useWorkspace: () => ({
    activeWorkspace: { id: 'workspace-1', name: 'Astra', rootPath: 'C:/repo' },
  }),
}));

const run: WorkflowRunProjection = {
  id: 'run-1',
  workflowId: 'workflow-1',
  workflowVersion: 1,
  projectId: 'project-1',
  status: 'running',
  integrationBranch: 'astra/run-run-1',
  createdAt: '2026-07-25T12:00:00.000Z',
  nodeRuns: [
    {
      id: 'run-1-agent-1',
      runId: 'run-1',
      nodeId: 'agent-1',
      status: 'ready',
      attempt: 1,
    },
  ],
  approvals: [],
  artifacts: [],
  attentions: [],
  events: [{ at: '2026-07-25T12:00:00.000Z', message: 'Run started.', sequence: 1 }],
};

const workflow: WorkflowDefinition = {
  id: 'workflow-1',
  name: 'Release readiness',
  version: 1,
  projectId: 'project-1',
  createdAt: '2026-07-25T12:00:00.000Z',
  updatedAt: '2026-07-25T12:00:00.000Z',
  settings: { maxConcurrency: 1, defaultTimeoutSeconds: 300, defaultRetries: 0 },
  nodes: [
    {
      id: 'agent-1',
      name: 'Assess repository state',
      type: 'agent',
      position: { x: 0, y: 0 },
      provider: 'auto',
      prompt: 'Inspect the current repository state.',
      skillIds: [],
      mcpServerIds: [],
    },
  ],
  edges: [],
};

function renderRunPage(service: WorkflowService) {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/runs/run-1']}>
        <Routes>
          <Route path="/runs/:runId" element={<WorkflowRunPage service={service} />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('WorkflowRunPage desktop coordinator projection', () => {
  let runEventListener:
    | ((event: { payload: { runId: string; sequence: number; eventJson: string } }) => void)
    | undefined;

  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockReset();
    mocks.invoke.mockResolvedValue(undefined);
    mocks.listen.mockImplementation(async (_topic, listener) => {
      runEventListener = listener as typeof runEventListener;
      return () => undefined;
    });
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
  });

  it('keeps the loading state until the initial projection resolves', async () => {
    let resolveRun: (value: WorkflowRunProjection | null) => void = () => undefined;
    const service = {
      getRun: vi.fn(
        () =>
          new Promise<WorkflowRunProjection | null>((resolve) => {
            resolveRun = resolve;
          }),
      ),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
    };

    renderRunPage(service as unknown as WorkflowService);

    expect(screen.getByText('Workflow run')).toHaveClass('workflow-loading');
    act(() => resolveRun(run));
    expect(await screen.findByText('Assess repository state')).toBeVisible();
  });

  it.each([
    ['a missing run', vi.fn(async () => null), 'The workflow run is unavailable.'],
    ['a failed run lookup', vi.fn(async () => Promise.reject(new Error('Run backend unavailable.'))), 'Run backend unavailable.'],
  ])('renders an accessible error for %s', async (_scenario, getRun, message) => {
    const service = {
      getRun,
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
    };

    renderRunPage(service as unknown as WorkflowService);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('Workflow run')).not.toBeInTheDocument();
  });

  it('recovers run events by cursor and does not expose the retired renderer scheduler', async () => {
    const service = {
      getRun: vi.fn(async () => run),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
    } as unknown as WorkflowService;

    renderRunPage(service);

    await waitFor(() => expect(service.listRunEventsAfter).toHaveBeenCalledWith('run-1', 1, 250));
    expect(mocks.listen).toHaveBeenCalledWith('orchestration://run-event', expect.any(Function));
    expect(screen.queryByRole('button', { name: 'Start orchestration' })).not.toBeInTheDocument();
  });

  it('refreshes the durable projection when a new run event arrives', async () => {
    const updatedRun: WorkflowRunProjection = {
      ...run,
      nodeRuns: [{ ...run.nodeRuns[0], status: 'succeeded' }],
      events: [
        ...run.events,
        { at: '2026-07-25T12:01:00.000Z', message: 'Node complete.', sequence: 2 },
      ],
    };
    const service = {
      getRun: vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce(updatedRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
    } as unknown as WorkflowService;

    renderRunPage(service);

    await waitFor(() => expect(runEventListener).toBeDefined());
    act(() => {
      runEventListener?.({
        payload: { runId: 'run-1', sequence: 2, eventJson: '{"type":"node_succeeded"}' },
      });
    });

    await waitFor(() => expect(service.getRun).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('succeeded', { exact: true })).toBeVisible();
  });

  it('disables worktree cleanup while final merge approval is pending', async () => {
    const pendingMergeRun: WorkflowRunProjection = {
      ...run,
      status: 'completed',
      mergeApproval: {
        id: 'merge-1',
        runId: 'run-1',
        status: 'pending',
        summary: 'Review final merge',
      },
    };
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'orchestration_get_run_worktree') {
        return { id: 'run-1', branch: 'astra/run-run-1', path: 'C:/worktrees/run-1' };
      }
      if (command === 'orchestration_get_integration_evidence') {
        return { diffStat: '', commits: [] };
      }
      return undefined;
    });
    const service = {
      getRun: vi.fn(async () => pendingMergeRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
    } as unknown as WorkflowService;

    renderRunPage(service);

    expect(await screen.findByRole('button', { name: 'Clean worktrees' })).toBeDisabled();
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('orchestration_get_run_worktree', {
        runId: 'run-1',
      }),
    );
  });

  it('uses workflow node names while retaining a short node reference', async () => {
    const service = {
      getRun: vi.fn(async () => run),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
    } as unknown as WorkflowService;

    renderRunPage(service);

    expect(await screen.findByText('Assess repository state')).toBeVisible();
    expect(screen.getByText('ID agent-1')).toHaveAttribute('title', 'agent-1');
  });

  it('falls back to a compact node reference when its workflow definition is unavailable', async () => {
    const nodeId = '12345678-1234-1234-1234-123456789abc';
    const runWithoutDefinition: WorkflowRunProjection = {
      ...run,
      nodeRuns: [{ ...run.nodeRuns[0], nodeId }],
    };
    const service = {
      getRun: vi.fn(async () => runWithoutDefinition),
      list: vi.fn(async () => []),
      listRunEventsAfter: vi.fn(async () => []),
    } as unknown as WorkflowService;

    renderRunPage(service);

    expect(await screen.findByText('12345678...')).toBeVisible();
    expect(screen.getByText('ID 12345678...')).toHaveAttribute('title', nodeId);
  });

  it('approves the initial worktree request and updates the durable projection', async () => {
    const user = userEvent.setup();
    const waitingRun: WorkflowRunProjection = {
      ...run,
      status: 'waiting',
      nodeRuns: [{ ...run.nodeRuns[0], status: 'waiting_approval' }],
      approvals: [
        {
          id: 'worktree-approval',
          runId: 'run-1',
          nodeRunId: run.nodeRuns[0].id,
          capability: 'worktree',
          risk: 'medium',
          summary: 'Create the isolated worktree.',
          status: 'pending',
          createdAt: run.createdAt,
        },
      ],
    };
    const approvedRun: WorkflowRunProjection = { ...waitingRun, status: 'queued' };
    const service = {
      getRun: vi.fn(async () => waitingRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
      decideRun: vi.fn(async () => approvedRun),
    };

    renderRunPage(service as unknown as WorkflowService);

    await user.click(await screen.findByRole('button', { name: 'Approve worktree creation' }));

    expect(service.decideRun).toHaveBeenCalledWith('run-1', true);
    expect(await screen.findByText('queued', { exact: true })).toBeVisible();
  });

  it('decides a pending node permission approval', async () => {
    const user = userEvent.setup();
    const nodeApprovalRun: WorkflowRunProjection = {
      ...run,
      nodeRuns: [{ ...run.nodeRuns[0], status: 'waiting_approval' }],
      approvals: [
        {
          id: 'node-approval',
          runId: 'run-1',
          nodeRunId: run.nodeRuns[0].id,
          capability: 'network',
          risk: 'high',
          summary: 'Allow network access for the repository check.',
          status: 'pending',
          createdAt: run.createdAt,
        },
      ],
    };
    const resumedRun: WorkflowRunProjection = {
      ...nodeApprovalRun,
      nodeRuns: [{ ...nodeApprovalRun.nodeRuns[0], status: 'ready' }],
      approvals: [{ ...nodeApprovalRun.approvals![0], status: 'approved' }],
    };
    const service = {
      getRun: vi.fn(async () => nodeApprovalRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
      decideApproval: vi.fn(async () => resumedRun),
    };

    renderRunPage(service as unknown as WorkflowService);

    const approval = await screen.findByText('Allow network access for the repository check.');
    await user.click(within(approval.closest('.run-approval')!).getByRole('button', { name: 'Approve' }));

    expect(service.decideApproval).toHaveBeenCalledWith('run-1', 'node-approval', true);
    expect(await screen.findByText('ready', { exact: true })).toBeVisible();
  });

  it('resumes a paused run after attention is resolved', async () => {
    const user = userEvent.setup();
    const pausedRun: WorkflowRunProjection = {
      ...run,
      status: 'paused',
      attentions: [
        {
          id: 'attention-1',
          runId: 'run-1',
          nodeRunId: run.nodeRuns[0].id,
          kind: 'merge_conflict',
          priority: 'high',
          status: 'open',
          summary: 'Resolve the conflicting project changes.',
          contextJson: '{}',
        },
      ],
    };
    const service = {
      getRun: vi.fn(async () => pausedRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
      resumeRun: vi.fn(async () => ({ ...pausedRun, status: 'running' as const })),
    };

    renderRunPage(service as unknown as WorkflowService);

    expect(await screen.findByRole('link', { name: 'Review project changes' })).toHaveAttribute(
      'href',
      '/projects/project-1',
    );
    await user.click(screen.getByRole('button', { name: 'Resume after resolution' }));

    expect(service.resumeRun).toHaveBeenCalledWith('run-1');
    expect(await screen.findByText('running', { exact: true })).toBeVisible();
  });

  it('cancels a running run and restores the cancel action after an error', async () => {
    const user = userEvent.setup();
    const cancelledRun: WorkflowRunProjection = {
      ...run,
      status: 'cancelled',
      nodeRuns: [{ ...run.nodeRuns[0], status: 'cancelled' }],
    };
    const cancelRun = vi
      .fn()
      .mockRejectedValueOnce(new Error('The coordinator is unavailable.'))
      .mockResolvedValueOnce(cancelledRun);
    const service = {
      getRun: vi.fn(async () => run),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
      cancelRun,
    };

    renderRunPage(service as unknown as WorkflowService);

    const cancel = await screen.findByRole('button', { name: 'Cancel run' });
    await user.click(cancel);
    expect(await screen.findByRole('alert')).toHaveTextContent('The coordinator is unavailable.');
    expect(cancel).toBeEnabled();

    await user.click(cancel);
    expect(cancelRun).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(cancel).toBeDisabled());
  });

  it('simulates ready nodes in the browser adapter and persists the completed projection', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    const user = userEvent.setup();
    const persistProjection = vi.fn(async () => undefined);
    const service = {
      getRun: vi.fn(async () => run),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
      persistProjection,
    };

    renderRunPage(service as unknown as WorkflowService);

    await user.click(await screen.findByRole('button', { name: 'Start orchestration' }));

    await waitFor(() =>
      expect(persistProjection).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
      ),
    );
    expect(await screen.findByText('completed', { exact: true })).toBeVisible();
  });

  it('cleans a completed run worktree only after explicit confirmation', async () => {
    const user = userEvent.setup();
    const completedRun: WorkflowRunProjection = { ...run, status: 'completed' };
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'orchestration_get_run_worktree') {
        return { id: 'run-1', branch: 'astra/run-run-1', path: 'C:/worktrees/run-1' };
      }
      if (command === 'orchestration_get_integration_evidence') {
        return { diffStat: ' src/index.ts | 1 +', commits: ['abc123'] };
      }
      return undefined;
    });
    const service = {
      getRun: vi.fn(async () => completedRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
    };

    renderRunPage(service as unknown as WorkflowService);

    const clean = await screen.findByRole('button', { name: 'Clean worktrees' });
    await waitFor(() => expect(clean).toBeEnabled());
    await user.click(clean);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Clean' }));

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('orchestration_cleanup_run_worktrees', {
        runId: 'run-1',
      }),
    );
    await waitFor(() => expect(clean).toBeDisabled());
  });

  it('requests, confirms, and rejects final merge approvals', async () => {
    const user = userEvent.setup();
    const completedRun: WorkflowRunProjection = { ...run, status: 'completed' };
    const pendingMergeRun: WorkflowRunProjection = {
      ...completedRun,
      mergeApproval: {
        id: 'merge-1',
        runId: 'run-1',
        status: 'pending',
        summary: 'Review the managed commits before merging.',
      },
    };
    const mergedRun: WorkflowRunProjection = {
      ...pendingMergeRun,
      mergeApproval: { ...pendingMergeRun.mergeApproval!, status: 'merged', mergedCommit: 'abc123' },
    };
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'orchestration_get_run_worktree') {
        return { id: 'run-1', branch: 'astra/run-run-1', path: 'C:/worktrees/run-1' };
      }
      if (command === 'orchestration_get_integration_evidence') {
        return { diffStat: '', commits: [] };
      }
      return undefined;
    });
    const requestFinalMerge = vi.fn(async () => pendingMergeRun);
    const decideFinalMerge = vi.fn(async () => mergedRun);
    const service = {
      getRun: vi.fn(async () => completedRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
      requestFinalMerge,
      decideFinalMerge,
    };

    renderRunPage(service as unknown as WorkflowService);

    const review = await screen.findByRole('button', { name: 'Review and merge' });
    await waitFor(() => expect(review).toBeEnabled());
    await user.click(review);
    expect(requestFinalMerge).toHaveBeenCalledWith('run-1');

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Merge' }));

    expect(decideFinalMerge).toHaveBeenCalledWith('run-1', 'merge-1', true);
    expect(await screen.findByText('Merged into current branch')).toBeVisible();
  });

  it('keeps a final merge approval pending when its confirmation dialog is canceled', async () => {
    const user = userEvent.setup();
    const completedRun: WorkflowRunProjection = { ...run, status: 'completed' };
    const pendingMergeRun: WorkflowRunProjection = {
      ...completedRun,
      mergeApproval: {
        id: 'merge-1',
        runId: 'run-1',
        status: 'pending',
        summary: 'Review the managed commits before merging.',
      },
    };
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'orchestration_get_run_worktree') {
        return { id: 'run-1', branch: 'astra/run-run-1', path: 'C:/worktrees/run-1' };
      }
      if (command === 'orchestration_get_integration_evidence') {
        return { diffStat: '', commits: [] };
      }
      return undefined;
    });
    const requestFinalMerge = vi.fn(async () => pendingMergeRun);
    const decideFinalMerge = vi.fn(async () => pendingMergeRun);
    const service = {
      getRun: vi.fn(async () => completedRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
      requestFinalMerge,
      decideFinalMerge,
    };

    renderRunPage(service as unknown as WorkflowService);

    const review = await screen.findByRole('button', { name: 'Review and merge' });
    await waitFor(() => expect(review).toBeEnabled());
    await user.click(review);

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(decideFinalMerge).not.toHaveBeenCalled();
    expect(screen.getByText('Final merge approval pending')).toBeVisible();
  });

  it('replays events persisted after the initial event cursor', async () => {
    const reconciledRun: WorkflowRunProjection = {
      ...run,
      nodeRuns: [{ ...run.nodeRuns[0], status: 'succeeded' }],
      events: [
        ...run.events,
        { at: '2026-07-25T12:02:00.000Z', message: 'Recovered event.', sequence: 2 },
      ],
    };
    const service = {
      getRun: vi.fn().mockResolvedValueOnce(run).mockResolvedValueOnce(reconciledRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => [
        { sequence: 2, eventJson: '{"type":"node_succeeded"}', createdAt: run.createdAt },
      ]),
    };

    renderRunPage(service as unknown as WorkflowService);

    await waitFor(() => expect(service.getRun).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Recovered event.')).toBeVisible();
  });

  it('keeps rendering the projection when definition or event subscriptions fail', async () => {
    mocks.listen.mockRejectedValueOnce(new Error('Event bridge is unavailable.'));
    const service = {
      getRun: vi.fn(async () => run),
      list: vi.fn(async () => Promise.reject(new Error('Definitions unavailable.'))),
      listRunEventsAfter: vi.fn(async () => []),
    };

    renderRunPage(service as unknown as WorkflowService);

    expect(await screen.findByText('agent-1')).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent('Event bridge is unavailable.');
  });

  it('rejects initial and node permission approvals through their explicit actions', async () => {
    const user = userEvent.setup();
    const waitingRun: WorkflowRunProjection = {
      ...run,
      status: 'waiting',
      approvals: [
        {
          id: 'worktree-approval',
          runId: 'run-1',
          nodeRunId: run.nodeRuns[0].id,
          capability: 'worktree',
          risk: 'medium',
          summary: 'Create the isolated worktree.',
          status: 'pending',
          createdAt: run.createdAt,
        },
        {
          id: 'node-approval',
          runId: 'run-1',
          nodeRunId: run.nodeRuns[0].id,
          capability: 'execute',
          risk: 'high',
          summary: 'Allow the verification command.',
          status: 'pending',
          createdAt: run.createdAt,
        },
      ],
    };
    const cancelledRun: WorkflowRunProjection = { ...waitingRun, status: 'cancelled' };
    const service = {
      getRun: vi.fn(async () => waitingRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
      decideRun: vi.fn(async () => cancelledRun),
      decideApproval: vi.fn(async () => cancelledRun),
    };

    renderRunPage(service as unknown as WorkflowService);

    const worktreeApprove = await screen.findByRole('button', { name: 'Approve worktree creation' });
    await user.click(within(worktreeApprove.closest('.run-approval')!).getByRole('button', { name: 'Reject' }));

    expect(service.decideRun).toHaveBeenCalledWith('run-1', false);
    expect(await screen.findByText('cancelled', { exact: true })).toBeVisible();
  });

  it('resumes interrupted runs and surfaces a failed resume without leaving the action busy', async () => {
    const user = userEvent.setup();
    const interruptedRun: WorkflowRunProjection = { ...run, status: 'interrupted' };
    const resumeRun = vi
      .fn()
      .mockRejectedValueOnce(new Error('The runtime cannot resume this run.'))
      .mockResolvedValueOnce({ ...interruptedRun, status: 'running' });
    const service = {
      getRun: vi.fn(async () => interruptedRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
      resumeRun,
    };

    renderRunPage(service as unknown as WorkflowService);

    const resume = await screen.findByRole('button', { name: 'Resume' });
    await user.click(resume);
    expect(await screen.findByRole('alert')).toHaveTextContent('The runtime cannot resume this run.');
    expect(resume).toBeEnabled();

    await user.click(resume);
    expect(resumeRun).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('running', { exact: true })).toBeVisible();
  });

  it.each([
    ['true', 'true-agent', 'false-agent'],
    ['false', 'false-agent', 'true-agent'],
  ])(
    'simulates the %s condition branch and skips only its unreachable node',
    async (expression, succeededNodeId, skippedNodeId) => {
      Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
      const user = userEvent.setup();
      const conditionWorkflow: WorkflowDefinition = {
        ...workflow,
        nodes: [
          { id: 'condition-1', name: 'Tests pass?', type: 'condition', position: { x: 0, y: 0 }, expression },
          {
            id: 'true-agent',
            name: 'Publish results',
            type: 'agent',
            position: { x: 120, y: 0 },
            provider: 'auto',
            prompt: 'Publish the result.',
            skillIds: [],
            mcpServerIds: [],
          },
          {
            id: 'false-agent',
            name: 'Repair results',
            type: 'agent',
            position: { x: 120, y: 140 },
            provider: 'auto',
            prompt: 'Repair the result.',
            skillIds: [],
            mcpServerIds: [],
          },
        ],
        edges: [
          { id: 'condition-true', source: 'condition-1', target: 'true-agent', outcome: 'true' },
          { id: 'condition-false', source: 'condition-1', target: 'false-agent', outcome: 'false' },
        ],
      };
      const conditionRun: WorkflowRunProjection = {
        ...run,
        nodeRuns: conditionWorkflow.nodes.map((node) => ({
          id: `run-1-${node.id}`,
          runId: 'run-1',
          nodeId: node.id,
          status: node.id === 'condition-1' ? 'ready' : 'pending',
          attempt: 1,
        })),
      };
      const persistProjection = vi
        .fn<(projection: WorkflowRunProjection) => Promise<void>>()
        .mockResolvedValue(undefined);
      const service = {
        getRun: vi.fn(async () => conditionRun),
        list: vi.fn(async () => [conditionWorkflow]),
        listRunEventsAfter: vi.fn(async () => []),
        persistProjection,
      };

      renderRunPage(service as unknown as WorkflowService);

      await user.click(await screen.findByRole('button', { name: 'Start orchestration' }));
      await waitFor(() => expect(persistProjection).toHaveBeenCalledOnce());
      const persistedProjection = persistProjection.mock.calls[0]?.[0];
      expect(
        persistedProjection?.nodeRuns.some(
          (nodeRun) => nodeRun.nodeId === succeededNodeId && nodeRun.status === 'succeeded',
        ),
      ).toBe(true);
      expect(
        persistedProjection?.nodeRuns.some(
          (nodeRun) => nodeRun.nodeId === skippedNodeId && nodeRun.status === 'skipped',
        ),
      ).toBe(true);
    },
  );

  it('reports a browser simulation when its workflow definition is no longer available', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    const user = userEvent.setup();
    const service = {
      getRun: vi.fn(async () => run),
      list: vi.fn(async () => []),
      listRunEventsAfter: vi.fn(async () => []),
      persistProjection: vi.fn(async () => undefined),
    };

    renderRunPage(service as unknown as WorkflowService);

    await user.click(await screen.findByRole('button', { name: 'Start orchestration' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The workflow definition is unavailable.');
  });

  it('shows integration evidence and per-node runtime evidence for completed runs', async () => {
    const detailedRun: WorkflowRunProjection = {
      ...run,
      status: 'completed',
      nodeRuns: [
        {
          ...run.nodeRuns[0],
          provider: 'codex',
          externalSessionId: 'session-123456789',
          error: 'The agent reported a failed verification.',
        },
      ],
      artifacts: [
        {
          id: 'artifact-1',
          runId: 'run-1',
          nodeRunId: run.nodeRuns[0].id,
          kind: 'test-report',
          path: 'artifacts/test-report.json',
          contentHash: '1234567890abcdef1234567890abcdef',
          byteLength: 1536,
        },
      ],
    };
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'orchestration_get_run_worktree') {
        return { id: 'run-1', branch: 'astra/run-run-1', path: 'C:/worktrees/run-1' };
      }
      if (command === 'orchestration_get_integration_evidence') {
        return { diffStat: ' src/main.ts | 2 +-', commits: ['abc123'] };
      }
      return undefined;
    });
    const service = {
      getRun: vi.fn(async () => detailedRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
    };

    renderRunPage(service as unknown as WorkflowService);

    expect(await screen.findByText('Integration evidence')).toBeVisible();
    expect(screen.getByText('session-123456789')).toBeVisible();
    expect(screen.getByText('The agent reported a failed verification.')).toBeVisible();
    expect(screen.getByText('1234567890ab')).toBeVisible();
    expect(screen.getByText('abc123')).toBeVisible();
  });

  it('surfaces cleanup and final-merge request failures without changing the run state', async () => {
    const user = userEvent.setup();
    const completedRun: WorkflowRunProjection = { ...run, status: 'completed' };
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'orchestration_get_run_worktree') {
        return { id: 'run-1', branch: 'astra/run-run-1', path: 'C:/worktrees/run-1' };
      }
      if (command === 'orchestration_get_integration_evidence') {
        return { diffStat: '', commits: [] };
      }
      if (command === 'orchestration_cleanup_run_worktrees') {
        throw new Error('Cleanup failed because the worktree is busy.');
      }
      return undefined;
    });
    const service = {
      getRun: vi.fn(async () => completedRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
      requestFinalMerge: vi.fn(async () => Promise.reject(new Error('Merge review is unavailable.'))),
    };

    renderRunPage(service as unknown as WorkflowService);

    const clean = await screen.findByRole('button', { name: 'Clean worktrees' });
    await waitFor(() => expect(clean).toBeEnabled());
    await user.click(clean);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Clean' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cleanup failed because the worktree is busy.',
    );

    const review = screen.getByRole('button', { name: 'Review and merge' });
    await user.click(review);
    expect(await screen.findByRole('alert')).toHaveTextContent('Merge review is unavailable.');
  });

  it('rejects a pending final merge approval only through the explicit reject action', async () => {
    const user = userEvent.setup();
    const pendingMergeRun: WorkflowRunProjection = {
      ...run,
      status: 'completed',
      mergeApproval: {
        id: 'merge-1',
        runId: 'run-1',
        status: 'pending',
        summary: 'Review the managed commits before merging.',
      },
    };
    const rejectedRun: WorkflowRunProjection = {
      ...pendingMergeRun,
      mergeApproval: { ...pendingMergeRun.mergeApproval!, status: 'rejected' },
    };
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'orchestration_get_run_worktree') {
        return { id: 'run-1', branch: 'astra/run-run-1', path: 'C:/worktrees/run-1' };
      }
      if (command === 'orchestration_get_integration_evidence') {
        return { diffStat: '', commits: [] };
      }
      return undefined;
    });
    const decideFinalMerge = vi.fn(async () => rejectedRun);
    const service = {
      getRun: vi.fn(async () => pendingMergeRun),
      list: vi.fn(async () => [workflow]),
      listRunEventsAfter: vi.fn(async () => []),
      decideFinalMerge,
    };

    renderRunPage(service as unknown as WorkflowService);

    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(decideFinalMerge).toHaveBeenCalledWith('run-1', 'merge-1', false);
    expect(await screen.findByText('Integration ready for review')).toBeVisible();
  });
});
