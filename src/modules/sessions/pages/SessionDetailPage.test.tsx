import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import { SessionDetailPage } from './SessionDetailPage';

function createRepository(): PrototypeRepository {
  return {
    load: vi.fn(async () => createDemoSnapshot()),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
  };
}

describe('SessionDetailPage', () => {
  it('renders details and persists a follow-up message', async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    render(
      <MemoryRouter initialEntries={['/sessions/session-backend-codex']}>
        <WorkbenchProvider repository={repository}>
          <Routes>
            <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Add authentication unit tests' }),
    ).toBeVisible();
    await user.type(screen.getByLabelText('Follow-up message'), 'Add an edge-case test.');
    await user.click(screen.getByRole('button', { name: 'Send follow-up' }));

    expect(await screen.findByText('Add an edge-case test.')).toBeVisible();
    expect(screen.getByText('running', { selector: '.session-status' })).toBeVisible();
    expect(repository.save).toHaveBeenCalledOnce();
  });

  it('disables follow-ups for a display-only Gemini session', async () => {
    render(
      <MemoryRouter initialEntries={['/sessions/session-backend-gemini']}>
        <WorkbenchProvider repository={createRepository()}>
          <Routes>
            <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Display only')).toBeVisible();
    expect(screen.getByLabelText('Follow-up message')).toBeDisabled();
  });
});
