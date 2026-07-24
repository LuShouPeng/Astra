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
  it('opens deep-linked sections and applies a persistent theme', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    render(
      <MemoryRouter initialEntries={['/settings?tab=demo']}>
        <WorkbenchProvider repository={repository()}>
          <SettingsPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('tab', { name: 'Demo' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(screen.getByRole('tab', { name: 'General' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('astra-nexus.theme')).toBe('light');
  });

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

    expect(await screen.findByText('System')).toBeVisible();
    expect(screen.getByText('Coming soon')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'About' }));
    expect(screen.getByText('0.1.0')).toBeVisible();
    expect(screen.getByText(/Tauri 2/)).toBeVisible();
  });

  it('controls deterministic demo playback and resets frozen data', async () => {
    const user = userEvent.setup();
    const store = repository();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <SettingsPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Settings' });
    await user.click(screen.getByRole('tab', { name: 'Demo' }));
    expect(screen.getByText('Step 0 of 3')).toBeVisible();
    await user.click(screen.getByRole('radio', { name: '2x' }));
    await user.click(screen.getByRole('button', { name: 'Next demo step' }));
    expect(await screen.findByText('Step 1 of 3')).toBeVisible();
    expect(store.save).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Play demo' }));
    expect(await screen.findByRole('button', { name: 'Pause demo' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Pause demo' }));
    await user.click(screen.getByRole('button', { name: 'Reset Demo Data' }));
    expect(store.reset).toHaveBeenCalledOnce();
    expect(await screen.findByText('Step 0 of 3')).toBeVisible();
  });
});
