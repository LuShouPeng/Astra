import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../core/i18n/I18nContext';
import type { WorkflowDefinition } from '../../../core/contracts/workflows';
import { createWorkflowDraft } from '../model/workflowPlanner';
import type { WorkflowService } from '../services/workflowService';
import { WorkflowsPage } from './WorkflowsPage';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

describe('WorkflowsPage', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    mockedInvoke.mockReset();
    localStorage.clear();
  });

  it('creates a workflow from a natural-language goal', async () => {
    const user = userEvent.setup();
    const save = vi.fn<(workflow: WorkflowDefinition) => Promise<void>>(async () => undefined);
    const service = {
      list: vi.fn(async () => []),
      save,
      getRun: vi.fn(),
      createRun: vi.fn(),
    } as unknown as WorkflowService;
    render(
      <I18nProvider>
        <MemoryRouter>
          <WorkflowsPage projectId="project-1" service={service} />
        </MemoryRouter>
      </I18nProvider>,
    );
    await user.type(await screen.findByLabelText('Workflow goal'), 'Implement login and tests');
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0].description).toContain('Implement login');
  });

  it('filters persisted workflows, instantiates a template, and creates a blank workflow', async () => {
    const user = userEvent.setup();
    const releaseWorkflow = {
      ...createWorkflowDraft('project-1', 'Release readiness'),
      description: 'Verify the desktop release candidate.',
    };
    const unrelatedWorkflow = {
      ...createWorkflowDraft('project-1', 'Investigate notifications'),
      description: 'Review desktop notification delivery.',
    };
    const template = {
      ...createWorkflowDraft('template-project', 'Reusable release checklist'),
      description: 'Run this before each production release.',
    };
    const save = vi.fn<(workflow: WorkflowDefinition) => Promise<void>>(async () => undefined);
    const service = {
      list: vi.fn(async () => [releaseWorkflow, unrelatedWorkflow]),
      listTemplates: vi.fn(async () => [template]),
      save,
    } as unknown as WorkflowService;
    render(
      <I18nProvider>
        <MemoryRouter>
          <WorkflowsPage projectId="project-1" service={service} />
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByText('Release readiness')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Workflow templates' })).toBeVisible();
    await user.type(screen.getByPlaceholderText('Search'), 'release');
    expect(screen.getByText('Release readiness')).toBeVisible();
    expect(screen.queryByText('Investigate notifications')).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText('Search'));
    await user.click(screen.getByRole('button', { name: 'Reusable release checklist' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Reusable release checklist',
        projectId: 'project-1',
      }),
    );
    expect(save.mock.calls[0]?.[0].id).not.toBe(template.id);

    await user.click(screen.getByRole('button', { name: 'New workflow' }));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0].name).toBe('Untitled workflow');

    await user.type(screen.getByPlaceholderText('Search'), 'does-not-exist');
    expect(screen.getByRole('heading', { name: 'No workflows yet' })).toBeVisible();
  });

  it('uses the native planner result with the configured local provider paths', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    localStorage.setItem(
      'astra.providers.v1',
      JSON.stringify({ claudePath: 'C:\\tools\\claude.exe', codexPath: 'C:\\tools\\codex.exe' }),
    );
    const planned = {
      ...createWorkflowDraft('ignored-project', 'Provider planned workflow'),
      name: 'Provider planned workflow',
      description: 'Produced by the local planner.',
    };
    mockedInvoke.mockResolvedValueOnce(planned);
    const save = vi.fn<(workflow: WorkflowDefinition) => Promise<void>>(async () => undefined);
    const service = {
      list: vi.fn(async () => []),
      listTemplates: vi.fn(async () => []),
      save,
    } as unknown as WorkflowService;
    render(
      <I18nProvider>
        <MemoryRouter>
          <WorkflowsPage projectId="project-1" service={service} />
        </MemoryRouter>
      </I18nProvider>,
    );

    await user.type(
      await screen.findByLabelText('Workflow goal'),
      'Plan a desktop regression pass',
    );
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));

    expect(mockedInvoke).toHaveBeenCalledWith('orchestration_plan_workflow', {
      input: {
        projectId: 'project-1',
        goal: 'Plan a desktop regression pass',
        claudePath: 'C:\\tools\\claude.exe',
        codexPath: 'C:\\tools\\codex.exe',
      },
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Provider planned workflow',
        projectId: 'project-1',
      }),
    );
  });

  it('falls back to an editable local draft when the native planner is unavailable', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mockedInvoke.mockRejectedValueOnce(new Error('Planner connection failed.'));
    const save = vi.fn<(workflow: WorkflowDefinition) => Promise<void>>(async () => undefined);
    const service = {
      list: vi.fn(async () => []),
      listTemplates: vi.fn(async () => []),
      save,
    } as unknown as WorkflowService;
    render(
      <I18nProvider>
        <MemoryRouter>
          <WorkflowsPage projectId="project-1" service={service} />
        </MemoryRouter>
      </I18nProvider>,
    );

    await user.type(await screen.findByLabelText('Workflow goal'), 'Audit release evidence');
    await user.click(screen.getByRole('button', { name: 'Generate draft' }));

    expect(
      await screen.findByText(
        'The planning Provider was unavailable; an offline deterministic draft was generated.',
      ),
    ).toBeVisible();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Generated draft for: Audit release evidence',
        projectId: 'project-1',
      }),
    );
  });
});
