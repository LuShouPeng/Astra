import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinition } from '../../../core/contracts/workflows';
import { I18nProvider } from '../../../core/i18n/I18nContext';
import { createWorkflowDraft } from '../model/workflowPlanner';
import {
  createWorkflowService,
  type WorkflowRunExecutionContext,
} from '../services/workflowService';
import { WorkflowEditorPage } from './WorkflowEditorPage';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  activeWorkspace: undefined as { rootPath: string } | undefined,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('../../workspace', () => ({
  useWorkspace: () => ({ activeWorkspace: mocks.activeWorkspace }),
}));

describe('WorkflowEditorPage', () => {
  afterEach(() => {
    mocks.invoke.mockReset();
    mocks.activeWorkspace = undefined;
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    localStorage.clear();
  });

  it('keeps the loading state until the workflow definition resolves', async () => {
    let resolveWorkflows: (value: ReturnType<typeof createWorkflowDraft>[]) => void = () => undefined;
    const workflow = createWorkflowDraft('project-1', 'Deferred workflow');
    const service = {
      list: vi.fn(
        () =>
          new Promise<ReturnType<typeof createWorkflowDraft>[]>((resolve) => {
            resolveWorkflows = resolve;
          }),
      ),
    };

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service as never} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(screen.getByText('Workflow editor')).toHaveClass('workflow-loading');
    resolveWorkflows([workflow]);
    expect(await screen.findByDisplayValue('Deferred workflow')).toBeVisible();
  });

  it('opens the compact inspector and keeps selected node properties editable', async () => {
    const user = userEvent.setup();
    const workflow = createWorkflowDraft('project-1', 'Compact inspector');
    const service = createWorkflowService({
      list: () => Promise.resolve([workflow]),
      save: () => Promise.resolve(),
      saveRun: () => Promise.resolve(),
      getRun: () => Promise.resolve(null),
      listTemplates: () => Promise.resolve([]),
      saveTemplate: () => Promise.resolve(),
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Compact inspector');
    const inspectorToggle = screen.getByRole('button', { name: 'Inspector' });
    expect(inspectorToggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(inspectorToggle);

    expect(inspectorToggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.workflow-editor')).toHaveClass(
      'workflow-editor--inspector-open',
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(inspectorToggle).toHaveAttribute('aria-expanded', 'false');
    expect(inspectorToggle).toHaveFocus();

    await user.click(screen.getAllByRole('button', { name: /Add$/ })[0]);

    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    const nodeName = within(inspector).getByLabelText('Name');
    await user.clear(nodeName);
    await user.type(nodeName, 'Mobile Agent');

    expect(inspectorToggle).toHaveAttribute('aria-expanded', 'true');
    expect(nodeName).toHaveValue('Mobile Agent');
  });

  it('shows backend validation failures from save', async () => {
    const user = userEvent.setup();
    const workflow = createWorkflowDraft('project-1', 'Validation test');
    const save = vi.fn().mockRejectedValue(new Error('Backend rejected the DAG.'));
    const service = createWorkflowService({
      list: () => Promise.resolve([workflow]),
      save,
      saveRun: () => Promise.resolve(),
      getRun: () => Promise.resolve(null),
      listTemplates: () => Promise.resolve([]),
      saveTemplate: () => Promise.resolve(),
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Validation test');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Backend rejected the DAG.');
    expect(screen.getByRole('status')).toHaveClass('is-error');
    expect(save).toHaveBeenCalledOnce();
  });

  it('uses the application theme tokens for the MiniMap', async () => {
    const workflow = createWorkflowDraft('project-1', 'MiniMap colors');
    const service = createWorkflowService({
      list: () => Promise.resolve([workflow]),
      save: () => Promise.resolve(),
      saveRun: () => Promise.resolve(),
      getRun: () => Promise.resolve(null),
      listTemplates: () => Promise.resolve([]),
      saveTemplate: () => Promise.resolve(),
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    const miniMap = await screen.findByTestId('rf__minimap');
    expect(miniMap).toHaveStyle('--xy-minimap-background-color-props: var(--color-surface)');
    expect(miniMap).toHaveStyle('--xy-minimap-mask-background-color-props: var(--color-overlay)');
  });

  it('edits and persists workflow runtime settings independently of a selected node', async () => {
    const user = userEvent.setup();
    const workflow = createWorkflowDraft('project-1', 'Runtime controls');
    const save = vi.fn().mockResolvedValue(undefined);
    const service = createWorkflowService({
      list: () => Promise.resolve([workflow]),
      save,
      saveRun: () => Promise.resolve(),
      getRun: () => Promise.resolve(null),
      listTemplates: () => Promise.resolve([]),
      saveTemplate: () => Promise.resolve(),
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Runtime controls');
    const concurrency = screen.getByLabelText('Maximum concurrency');
    const timeout = screen.getByLabelText('Default timeout (seconds)');
    const retries = screen.getByLabelText('Default retries');

    await user.clear(concurrency);
    await user.type(concurrency, '3');
    await user.clear(timeout);
    await user.type(timeout, '900');
    await user.clear(retries);
    await user.type(retries, '2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: {
          maxConcurrency: 3,
          defaultTimeoutSeconds: 900,
          defaultRetries: 2,
        },
      }),
    );
  });

  it('keeps out-of-range settings as drafts and restores the persisted value on blur', async () => {
    const user = userEvent.setup();
    const workflow = createWorkflowDraft('project-1', 'Settings boundary');
    const save = vi.fn<(workflow: WorkflowDefinition) => Promise<void>>().mockResolvedValue(undefined);
    const service = createWorkflowService({
      list: () => Promise.resolve([workflow]),
      save,
      saveRun: () => Promise.resolve(),
      getRun: () => Promise.resolve(null),
      listTemplates: () => Promise.resolve([]),
      saveTemplate: () => Promise.resolve(),
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    const concurrency = await screen.findByLabelText('Maximum concurrency');
    await user.clear(concurrency);
    await user.type(concurrency, '9');
    expect(concurrency).toHaveValue(9);
    await user.tab();
    expect(concurrency).toHaveValue(workflow.settings.maxConcurrency);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]?.settings.maxConcurrency).toBe(workflow.settings.maxConcurrency);
  });

  it('validates an invalid graph before saving a template or creating a run', async () => {
    const user = userEvent.setup();
    const workflow = {
      ...createWorkflowDraft('project-1', 'Invalid graph'),
      nodes: [],
      edges: [],
    };
    const saveTemplate = vi.fn().mockResolvedValue(undefined);
    const createRun = vi.fn().mockResolvedValue({ id: 'run-1' });
    const service = {
      list: vi.fn(async () => [workflow]),
      save: vi.fn(async () => undefined),
      saveTemplate,
      createRun,
    };

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service as never} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Invalid graph');
    await user.click(screen.getByRole('button', { name: 'Save template' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Resolve graph issues before running');
    expect(saveTemplate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(createRun).not.toHaveBeenCalled();
  });

  it('saves a valid template and reports a backend template error', async () => {
    const user = userEvent.setup();
    const workflow = createWorkflowDraft('project-1', 'Template workflow');
    const saveTemplate = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Template storage is unavailable.'));
    const service = {
      list: vi.fn(async () => [workflow]),
      save: vi.fn(async () => undefined),
      saveTemplate,
    };

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service as never} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Template workflow');
    const saveTemplateButton = screen.getByRole('button', { name: 'Save template' });
    await user.click(saveTemplateButton);
    expect(await screen.findByRole('status')).toHaveTextContent('Template saved');
    expect(saveTemplate).toHaveBeenCalledOnce();

    await user.click(saveTemplateButton);
    expect(await screen.findByRole('status')).toHaveTextContent('Template storage is unavailable.');
    expect(screen.getByRole('status')).toHaveClass('is-error');
  });

  it('runs a valid browser workflow and navigates to its durable run projection', async () => {
    const user = userEvent.setup();
    const workflow = createWorkflowDraft('project-1', 'Launch workflow');
    const save = vi.fn().mockResolvedValue(undefined);
    const createRun = vi.fn().mockResolvedValue({ id: 'run-42' });
    const service = {
      list: vi.fn(async () => [workflow]),
      save,
      createRun,
    };

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service as never} />}
            />
            <Route path="/runs/:runId" element={<div>Run destination</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Launch workflow');
    await user.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(createRun).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: workflow.id }));
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({ id: workflow.id }), undefined);
    expect(await screen.findByText('Run destination')).toBeVisible();
  });

  it('shows a launch failure without navigating away from the editor', async () => {
    const user = userEvent.setup();
    const workflow = createWorkflowDraft('project-1', 'Failed launch');
    const service = {
      list: vi.fn(async () => [workflow]),
      save: vi.fn(async () => undefined),
      createRun: vi.fn(async () => Promise.reject(new Error('Run creation failed.'))),
    };

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service as never} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Failed launch');
    await user.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Run creation failed.');
    expect(screen.getByDisplayValue('Failed launch')).toBeVisible();
  });

  it('adds condition nodes and supports undoing and redoing the edit', async () => {
    const user = userEvent.setup();
    const workflow = createWorkflowDraft('project-1', 'Node controls');
    const service = createWorkflowService({
      list: () => Promise.resolve([workflow]),
      save: () => Promise.resolve(),
      saveRun: () => Promise.resolve(),
      getRun: () => Promise.resolve(null),
      listTemplates: () => Promise.resolve([]),
      saveTemplate: () => Promise.resolve(),
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Node controls');
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Condition Add' }));
    expect(await screen.findByLabelText('Boolean expression')).toBeVisible();
    await user.type(screen.getByLabelText('Boolean expression'), 'tests_pass');
    await waitFor(() => expect(undo).toBeEnabled());

    await user.click(undo);
    await waitFor(() => expect(redo).toBeEnabled());
    await user.click(redo);
    await waitFor(() => expect(undo).toBeEnabled());
    expect(redo).toBeDisabled();
    expect(screen.queryByLabelText('Boolean expression')).not.toBeInTheDocument();
  });

  it('manages installed skills and enabled MCP servers on an agent node', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'astra.extensions.skills.v1',
      JSON.stringify([
        {
          id: 'review-skill',
          name: 'Code review',
          version: '1.0.0',
          description: 'Review source changes.',
          source: 'catalog',
          contentHash: 'skill-hash',
          installPath: 'skills/review',
          installedAt: '2026-07-25T12:00:00.000Z',
        },
      ]),
    );
    localStorage.setItem(
      'astra.extensions.mcp.v1',
      JSON.stringify([
        {
          id: 'repo-mcp',
          name: 'Repository tools',
          transport: 'stdio',
          command: 'repo-tools',
          args: [],
          secretRefs: {},
          enabled: true,
          source: 'manual',
        },
        {
          id: 'disabled-mcp',
          name: 'Disabled tools',
          transport: 'stdio',
          command: 'disabled-tools',
          args: [],
          secretRefs: {},
          enabled: false,
          source: 'manual',
        },
      ]),
    );
    const workflow = createWorkflowDraft('project-1', 'Capabilities');
    const service = createWorkflowService({
      list: () => Promise.resolve([workflow]),
      save: () => Promise.resolve(),
      saveRun: () => Promise.resolve(),
      getRun: () => Promise.resolve(null),
      listTemplates: () => Promise.resolve([]),
      saveTemplate: () => Promise.resolve(),
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Capabilities');
    await user.click(screen.getByRole('button', { name: 'Agent Add' }));

    const skill = await screen.findByRole('checkbox', { name: 'Code review' });
    const mcp = screen.getByRole('checkbox', { name: 'Repository tools' });
    expect(screen.getByRole('checkbox', { name: /Disabled tools/ })).toBeDisabled();

    await user.click(skill);
    await user.click(mcp);
    expect(skill).toBeChecked();
    expect(mcp).toBeChecked();

    await user.click(skill);
    expect(skill).not.toBeChecked();
  });

  it('attaches capability cards to agents and explains invalid or duplicate attachments', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'astra.extensions.skills.v1',
      JSON.stringify([
        {
          id: 'review-skill',
          name: 'Code review',
          version: '1.0.0',
          description: 'Review source changes.',
          source: 'catalog',
          contentHash: 'skill-hash',
          installPath: 'skills/review',
          installedAt: '2026-07-25T12:00:00.000Z',
        },
      ]),
    );
    const workflow = createWorkflowDraft('project-1', 'Capability cards');
    const service = createWorkflowService({
      list: () => Promise.resolve([workflow]),
      save: () => Promise.resolve(),
      saveRun: () => Promise.resolve(),
      getRun: () => Promise.resolve(null),
      listTemplates: () => Promise.resolve([]),
      saveTemplate: () => Promise.resolve(),
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Capability cards');
    await user.click(screen.getByRole('button', { name: 'Agent Add' }));
    const capability = await screen.findByRole('button', { name: /Code review.*Skill/ });

    await user.click(capability);
    expect(await screen.findByRole('status')).toHaveTextContent('Code review attached to agent');
    await user.click(capability);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'This Agent already has that capability.',
    );

    await user.click(screen.getByRole('button', { name: 'Condition Add' }));
    await user.click(capability);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'MCP and Skills can only be attached to Agent nodes.',
    );
  });

  it('configures approval and join nodes, then duplicates and deletes the selected node', async () => {
    const user = userEvent.setup();
    const workflow = createWorkflowDraft('project-1', 'Node variants');
    const service = createWorkflowService({
      list: () => Promise.resolve([workflow]),
      save: () => Promise.resolve(),
      saveRun: () => Promise.resolve(),
      getRun: () => Promise.resolve(null),
      listTemplates: () => Promise.resolve([]),
      saveTemplate: () => Promise.resolve(),
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Node variants');
    await user.click(screen.getByRole('button', { name: 'Approval Add' }));
    await user.selectOptions(await screen.findByLabelText('Risk'), 'low');
    await user.type(screen.getByLabelText('Approval instructions'), 'Confirm the release evidence.');
    await user.click(screen.getByRole('button', { name: 'Duplicate node' }));
    await user.click(screen.getByRole('button', { name: 'Delete node' }));
    expect(await screen.findByText('Select a node to edit its properties.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Join Add' }));
    const strategy = await screen.findByLabelText('Join strategy');
    await user.selectOptions(strategy, 'any');
    expect(strategy).toHaveValue('any');
  });

  it('applies an automatic layout before persisting the workflow', async () => {
    const user = userEvent.setup();
    const workflow = createWorkflowDraft('project-1', 'Layout workflow');
    const save = vi.fn<(workflow: WorkflowDefinition) => Promise<void>>().mockResolvedValue(undefined);
    const service = createWorkflowService({
      list: () => Promise.resolve([workflow]),
      save,
      saveRun: () => Promise.resolve(),
      getRun: () => Promise.resolve(null),
      listTemplates: () => Promise.resolve([]),
      saveTemplate: () => Promise.resolve(),
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Layout workflow');
    await user.click(screen.getByRole('button', { name: 'Auto layout' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const savedWorkflow = save.mock.calls[0]?.[0];
    expect(
      savedWorkflow?.nodes.some((node) => node.position.x === 80 && node.position.y === 70),
    ).toBe(true);
  });

  it('loads desktop extensions and passes a repository execution context to the run service', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mocks.activeWorkspace = { rootPath: 'C:/repo' };
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'orchestration_list_mcp_servers') {
        return [
          {
            id: 'repo-mcp',
            name: 'Repository tools',
            transport: 'stdio',
            command: 'repo-tools',
            args: [],
            enabled: true,
          },
        ];
      }
      if (command === 'orchestration_list_skills') {
        return [
          {
            id: 'review-skill',
            name: 'Code review',
            version: '1.0.0',
            description: 'Review source changes.',
            source: 'catalog',
            contentHash: 'skill-hash',
          },
        ];
      }
      if (command === 'orchestration_discover_providers') {
        return [{ provider: 'codex', available: true }];
      }
      return undefined;
    });
    const workflow = createWorkflowDraft('project-1', 'Desktop launch');
    const createRun = vi
      .fn<
        (definition: WorkflowDefinition, context?: WorkflowRunExecutionContext) => Promise<{ id: string }>
      >()
      .mockResolvedValue({ id: 'desktop-run' });
    const service = {
      list: vi.fn(async () => [workflow]),
      save: vi.fn(async () => undefined),
      createRun,
    };

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service as never} />}
            />
            <Route path="/runs/:runId" element={<div>Desktop run destination</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Desktop launch');
    expect(await screen.findByRole('button', { name: /Repository tools.*MCP/ })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('orchestration_discover_providers', {
        input: { claudePath: undefined, codexPath: undefined },
      }),
    );
    await waitFor(() => expect(createRun).toHaveBeenCalledOnce());
    const launchCall = createRun.mock.calls[0];
    expect(launchCall?.[0].id).toBe(workflow.id);
    expect(launchCall?.[1]?.repositoryPath).toBe('C:/repo');
    expect(await screen.findByText('Desktop run destination')).toBeVisible();
  });

  it('edits every agent runtime field, validates the graph, and persists the result', async () => {
    const user = userEvent.setup();
    const workflow = createWorkflowDraft('project-1', 'Agent runtime fields');
    const save = vi.fn<(workflow: WorkflowDefinition) => Promise<void>>().mockResolvedValue(undefined);
    const service = createWorkflowService({
      list: () => Promise.resolve([workflow]),
      save,
      saveRun: () => Promise.resolve(),
      getRun: () => Promise.resolve(null),
      listTemplates: () => Promise.resolve([]),
      saveTemplate: () => Promise.resolve(),
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Agent runtime fields');
    await user.click(screen.getByRole('button', { name: 'Agent Add' }));
    await user.selectOptions(screen.getByLabelText('Provider'), 'claude');
    await user.type(screen.getByLabelText('Prompt'), 'Inspect the release evidence.');
    const timeout = screen.getByLabelText('Timeout (seconds)');
    const retries = screen.getByLabelText('Retries');
    await user.clear(timeout);
    await user.type(timeout, '90');
    await user.clear(retries);
    await user.type(retries, '2');

    await user.click(screen.getByRole('button', { name: 'Validate' }));
    expect(await screen.findByRole('status')).toHaveTextContent('DAG is valid');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const savedWorkflow = save.mock.calls[0]?.[0];
    expect(
      savedWorkflow?.nodes.some(
        (node) =>
          node.type === 'agent' &&
          node.provider === 'claude' &&
          node.prompt === 'Inspect the release evidence.' &&
          node.timeoutSeconds === 90 &&
          node.retries === 2,
      ),
    ).toBe(true);
  });

  it('keeps the editor open when desktop provider discovery fails', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mocks.activeWorkspace = { rootPath: 'C:/repo' };
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'orchestration_discover_providers') {
        throw new Error('Provider discovery failed.');
      }
      return [];
    });
    const workflow = createWorkflowDraft('project-1', 'Desktop provider failure');
    const service = {
      list: vi.fn(async () => [workflow]),
      save: vi.fn(async () => undefined),
      createRun: vi.fn(async () => ({ id: 'unexpected-run' })),
    };

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service as never} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Desktop provider failure');
    await user.click(screen.getByRole('button', { name: 'Run' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Provider discovery failed.');
    expect(service.createRun).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Desktop provider failure')).toBeVisible();
  });

  it('routes review-oriented desktop agents to an available fallback provider', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mocks.activeWorkspace = { rootPath: 'C:/repo' };
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'orchestration_discover_providers') {
        return [{ provider: 'codex', available: true }];
      }
      return [];
    });
    const workflow = createWorkflowDraft('project-1', 'Provider fallback');
    const reviewNode = workflow.nodes.find((node) => node.type === 'agent');
    if (reviewNode?.type === 'agent') {
      reviewNode.name = 'Review the implementation';
      reviewNode.prompt = 'Inspect the changes and report risks.';
    }
    const createRun = vi
      .fn<
        (definition: WorkflowDefinition, context?: WorkflowRunExecutionContext) => Promise<{ id: string }>
      >()
      .mockResolvedValue({ id: 'fallback-run' });
    const service = {
      list: vi.fn(async () => [workflow]),
      save: vi.fn(async () => undefined),
      createRun,
    };

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workflows/${workflow.id}`]}>
          <Routes>
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowEditorPage service={service as never} />}
            />
            <Route path="/runs/:runId" element={<div>Fallback run destination</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await screen.findByDisplayValue('Provider fallback');
    await user.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(createRun).toHaveBeenCalledOnce());
    const fallbackCall = createRun.mock.calls[0];
    expect(fallbackCall?.[0].nodes.some((node) => node.type === 'agent' && node.provider === 'codex')).toBe(
      true,
    );
    expect(fallbackCall?.[1]?.repositoryPath).toBe('C:/repo');
    expect(await screen.findByText('Fallback run destination')).toBeVisible();
  });
});
