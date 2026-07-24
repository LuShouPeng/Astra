import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import { AttentionPage } from './AttentionPage';

function repository(): PrototypeRepository {
  return {
    load: vi.fn(async () => createDemoSnapshot()),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
  };
}

describe('AttentionPage', () => {
  it('offers six filters and type-specific actions', async () => {
    const user = userEvent.setup();
    const store = repository();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <AttentionPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Needs Attention' })).toBeVisible();
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(
      screen.getByRole('button', { name: 'Approve Dependency approval required' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry TypeScript typecheck failed' })).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Failures 1' }));
    expect(screen.queryByText('Dependency approval required')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry TypeScript typecheck failed' }));
    expect(await screen.findByText('No open items in this filter.')).toBeVisible();
    expect(store.save).toHaveBeenCalledOnce();
  });
});
