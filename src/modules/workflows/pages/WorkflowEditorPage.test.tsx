import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../core/i18n/I18nContext';
import { createWorkflowDraft } from '../model/workflowPlanner';
import { createWorkflowService } from '../services/workflowService';
import { WorkflowEditorPage } from './WorkflowEditorPage';

describe('WorkflowEditorPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows backend validation failures from save', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
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
});
