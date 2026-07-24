import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import type { DesktopNotificationService } from '../../notifications';
import { SettingsPage } from './SettingsPage';

function repository(): PrototypeRepository {
  return {
    load: vi.fn(async () => createDemoSnapshot()),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
  };
}

describe('SettingsPage', () => {
  it('persists notification rules and triggers the desktop adapter', async () => {
    const user = userEvent.setup();
    const store = repository();
    const desktop: DesktopNotificationService = {
      notify: vi.fn(async () => 'sent' as const),
    };
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <SettingsPage desktopNotifications={desktop} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Notifications' }));
    await user.click(screen.getByRole('checkbox', { name: 'Notify on Completed' }));
    expect(store.save).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Send test notification' }));
    expect(desktop.notify).toHaveBeenCalledOnce();
    expect(await screen.findByRole('status')).toHaveTextContent('Desktop notification sent');
  });

  it('shows general and about product metadata without live controls', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository()}>
          <SettingsPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Dark')).toBeVisible();
    expect(screen.getByText('Coming soon')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'About' }));
    expect(screen.getByText('0.1.0')).toBeVisible();
    expect(screen.getByText(/Tauri 2/)).toBeVisible();
  });
});
