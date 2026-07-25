import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { I18nProvider } from '../../../core/i18n/I18nContext';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import type { DesktopNotificationService } from '../../notifications';
import { SettingsPage } from './SettingsPage';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

function repository(): PrototypeRepository {
  return {
    load: vi.fn(async () => createDemoSnapshot()),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
  };
}

describe('SettingsPage', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    mockedInvoke.mockReset();
    localStorage.clear();
  });

  it('shows a loading state while settings data is being retrieved', () => {
    const store: PrototypeRepository = {
      load: vi.fn(() => new Promise<WorkbenchSnapshot>(() => undefined)),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <SettingsPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Loading settings...')).toBeVisible();
  });

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

  it('switches and persists the interface language', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    render(
      <MemoryRouter>
        <I18nProvider>
          <WorkbenchProvider repository={repository()}>
            <SettingsPage />
          </WorkbenchProvider>
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('System')).toBeVisible();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'zh-CN');

    expect(await screen.findByRole('heading', { name: '设置' })).toBeVisible();
    expect(screen.getByRole('tab', { name: '通用' })).toBeVisible();
    expect(localStorage.getItem('astra-nexus.language')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
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

  it('shows progress while sending a test desktop notification', async () => {
    const user = userEvent.setup();
    let finishNotification: ((result: 'sent') => void) | undefined;
    const desktop: DesktopNotificationService = {
      notify: vi.fn(
        () =>
          new Promise<'sent'>((resolve) => {
            finishNotification = resolve;
          }),
      ),
    };
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository()}>
          <SettingsPage desktopNotifications={desktop} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('tab', { name: 'Notifications' }));
    await user.click(screen.getByRole('button', { name: 'Send test notification' }));
    expect(screen.getByRole('button', { name: 'Sending notification' })).toBeDisabled();
    finishNotification?.('sent');
    expect(await screen.findByRole('button', { name: 'Send test notification' })).toBeEnabled();
  });

  it.each([
    ['denied', 'Desktop notification permission denied'],
    ['disabled', 'Desktop notifications are disabled'],
  ] as const)('explains when desktop notifications are %s', async (result, message) => {
    const user = userEvent.setup();
    const desktop: DesktopNotificationService = {
      notify: vi.fn(async () => result),
    };
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository()}>
          <SettingsPage desktopNotifications={desktop} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('tab', { name: 'Notifications' }));
    await user.click(screen.getByRole('button', { name: 'Send test notification' }));

    expect(await screen.findByRole('status')).toHaveTextContent(message);
  });

  it('keeps notification controls usable and reports persistence failures', async () => {
    const user = userEvent.setup();
    const store = repository();
    vi.mocked(store.save).mockRejectedValueOnce(new Error('Settings store is unavailable.'));
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <SettingsPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('tab', { name: 'Notifications' }));
    await user.click(screen.getByRole('checkbox', { name: 'Notify on Failed' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Settings store is unavailable.');
    expect(screen.getByRole('checkbox', { name: 'Notify on Failed' })).toBeEnabled();
  });

  it('reports desktop notification transport errors without leaving a sending state behind', async () => {
    const user = userEvent.setup();
    const desktop: DesktopNotificationService = {
      notify: vi.fn(async () => Promise.reject(new Error('Operating system unavailable.'))),
    };
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository()}>
          <SettingsPage desktopNotifications={desktop} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('tab', { name: 'Notifications' }));
    await user.click(screen.getByRole('button', { name: 'Send test notification' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The desktop notification could not be sent.',
    );
    expect(screen.getByRole('button', { name: 'Send test notification' })).toBeEnabled();
  });

  it('runs simulated provider diagnostics and persists manual CLI paths', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository()}>
          <SettingsPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Settings' });
    await user.type(
      screen.getByRole('textbox', { name: 'claude executable path' }),
      ' C:\\Tools\\claude.exe ',
    );
    await user.click(screen.getByRole('button', { name: 'Run diagnostics' }));

    expect((await screen.findAllByText('Simulation mode')).length).toBe(2);
    expect(JSON.parse(localStorage.getItem('astra.providers.v1') ?? '{}')).toEqual({
      claudePath: 'C:\\Tools\\claude.exe',
    });
  });

  it('renders native provider diagnostics and preserves a useful backend error', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mockedInvoke.mockResolvedValueOnce([
      { provider: 'claude', available: true, version: '2.1.0' },
      { provider: 'codex', available: false, reason: 'Codex CLI is not installed.' },
    ]);
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository()}>
          <SettingsPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Run diagnostics' }));
    expect(await screen.findByText('2.1.0')).toBeVisible();
    expect(screen.getByText('Codex CLI is not installed.')).toBeVisible();
    expect(mockedInvoke).toHaveBeenCalledWith('orchestration_discover_providers', { input: {} });

    mockedInvoke.mockRejectedValueOnce(new Error('Provider discovery failed.'));
    await user.click(screen.getByRole('button', { name: 'Run diagnostics' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider discovery failed.');
  });
});
