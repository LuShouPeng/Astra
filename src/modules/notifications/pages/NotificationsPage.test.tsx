import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import { NotificationsPage } from './NotificationsPage';

function repository(): PrototypeRepository {
  return {
    load: vi.fn(async () => createDemoSnapshot()),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
  };
}

describe('NotificationsPage', () => {
  it('marks all read, clears read notifications, and persists both actions', async () => {
    const user = userEvent.setup();
    const store = repository();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <NotificationsPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByText('0 unread')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear read' }));
    expect(await screen.findByText('No notifications')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open Command Center' })).toHaveAttribute(
      'href',
      '/command-center',
    );
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('marks a notification read before navigating to its typed target', async () => {
    const user = userEvent.setup();
    const store = repository();
    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <WorkbenchProvider repository={store}>
          <Routes>
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="sessions/:sessionId" element={<div>Session target</div>} />
          </Routes>
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Open Codex needs approval' }));
    expect(await screen.findByText('Session target')).toBeVisible();
    expect(store.save).toHaveBeenCalledOnce();
  });
});
