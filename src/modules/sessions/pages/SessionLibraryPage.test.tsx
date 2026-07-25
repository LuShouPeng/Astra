import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import { SessionLibraryPage } from './SessionLibraryPage';

function repository(snapshot = createDemoSnapshot()): PrototypeRepository {
  return {
    load: vi.fn(async () => snapshot),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
  };
}

function renderLibrary(store: PrototypeRepository) {
  return render(
    <MemoryRouter>
      <WorkbenchProvider repository={store}>
        <SessionLibraryPage />
      </WorkbenchProvider>
    </MemoryRouter>,
  );
}

describe('SessionLibraryPage', () => {
  it('shows a loading state until the session snapshot is available', () => {
    const store: PrototypeRepository = {
      load: vi.fn(() => new Promise<WorkbenchSnapshot>(() => undefined)),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };

    renderLibrary(store);

    expect(screen.getByText('Loading Session library...')).toBeVisible();
  });

  it('searches activity, archives a matching session, and restores it from the archive', async () => {
    const user = userEvent.setup();
    const store = repository();
    renderLibrary(store);

    expect(await screen.findByRole('heading', { name: 'Session Library' })).toBeVisible();
    const search = screen.getByPlaceholderText('Search Sessions, summaries, and activity');
    await user.type(search, 'call sites');

    const matchingSession = screen.getByRole('link', { name: 'Fix intermittent login timeout' });
    expect(matchingSession).toHaveAttribute('href', '/sessions/session-backend-claude');
    const sessionCard = matchingSession.closest('article');
    expect(sessionCard).not.toBeNull();
    expect(within(sessionCard!).getByText(/Found four relevant call sites\./)).toBeVisible();

    await user.click(within(sessionCard!).getByRole('button', { name: 'Archive' }));
    expect(store.save).toHaveBeenCalledOnce();
    expect(await within(sessionCard!).findByRole('button', { name: 'Restore' })).toBeVisible();

    await user.clear(search);
    await user.click(screen.getByRole('tab', { name: 'Archived' }));
    expect(screen.getByRole('tab', { name: 'Archived' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('link', { name: 'Fix intermittent login timeout' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(store.save).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('tab', { name: 'Active' }));
    const restoredSession = await screen.findByRole('link', {
      name: 'Fix intermittent login timeout',
    });
    expect(
      within(restoredSession.closest('article')!).getByRole('button', { name: 'Archive' }),
    ).toBeVisible();
  });

  it('switches archive scopes and gives a clear empty result for a non-matching search', async () => {
    const user = userEvent.setup();
    renderLibrary(repository());

    await screen.findByRole('heading', { name: 'Session Library' });
    await user.click(screen.getByRole('tab', { name: 'Archived' }));
    expect(screen.getByText('No Sessions match this search.')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Active' }));
    expect(screen.getByRole('tab', { name: 'Active' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('6 Sessions')).toBeVisible();

    await user.type(
      screen.getByPlaceholderText('Search Sessions, summaries, and activity'),
      'no such run',
    );
    expect(screen.getByText('No Sessions match this search.')).toBeVisible();
  });
});
