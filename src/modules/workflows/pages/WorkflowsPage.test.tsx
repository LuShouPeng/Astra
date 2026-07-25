import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../core/i18n/I18nContext';
import type { WorkflowDefinition } from '../../../core/contracts/workflows';
import type { WorkflowService } from '../services/workflowService';
import { WorkflowsPage } from './WorkflowsPage';

describe('WorkflowsPage', () => {
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
});
