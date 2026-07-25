import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { I18nProvider } from '../../../core/i18n/I18nContext';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import { requestSessionChanges } from '../../changes';
import { CommandCenterPage } from './CommandCenterPage';

describe('CommandCenterPage', () => {
  it('shows the complete global dashboard and deep links', async () => {
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };

    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository}>
          <CommandCenterPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Command Center' })).toBeVisible();
    expect(screen.getByText('Astra Nexus')).toBeVisible();
    expect(
      screen.getByText(new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(new Date())),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Create simulated task' })).not.toBeInTheDocument();
    expect(screen.getByText('2', { selector: '[data-status="running"] strong' })).toBeVisible();
    expect(screen.getByText('2', { selector: '[data-status="waiting"] strong' })).toBeVisible();
    expect(screen.getByRole('link', { name: /Running Agents 2/ })).toHaveAttribute(
      'href',
      '/command-center?status=running',
    );
    expect(screen.getByRole('link', { name: /Needs Attention 2/ })).toHaveAttribute(
      'href',
      '/attention',
    );
    expect(screen.getByRole('link', { name: /Completed Today 2/ })).toHaveAttribute(
      'href',
      '/command-center?status=completed',
    );
    expect(screen.getByRole('link', { name: /Failed 1/ })).toHaveAttribute(
      'href',
      '/command-center?status=failed',
    );
    const activeSessions = screen.getByRole('region', { name: 'Active Sessions' });
    expect(
      within(activeSessions).getByRole('link', { name: /Fix intermittent login timeout/ }),
    ).toHaveAttribute('href', '/sessions/session-backend-claude');
    expect(
      within(activeSessions).getByRole('link', {
        name: /Claude.*running.*45m.*4 files.*Reviewing auth service call paths/s,
      }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: /2 items need attention/ })).toHaveAttribute(
      'href',
      '/attention',
    );
    expect(screen.getByRole('heading', { name: 'Active Sessions' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Needs Attention' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Project Matrix' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Recent Activity' })).toBeVisible();
    const attention = screen.getByRole('region', { name: 'Needs Attention' });
    expect(
      within(attention).getByRole('link', { name: /TypeScript typecheck failed/ }),
    ).toHaveAttribute('href', '/sessions/session-frontend-claude');
    expect(screen.getByRole('link', { name: /backend-api.*7 changed/s })).toHaveAttribute(
      'href',
      '/projects/project-backend-api',
    );
    expect(
      screen.getByRole('link', { name: /Approval.*Fix mobile navigation layout/s }),
    ).toHaveAttribute('href', '/sessions/session-frontend-codex');
  });

  it('shows the session result selected from a status metric', async () => {
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };

    render(
      <MemoryRouter initialEntries={['/command-center?status=completed']}>
        <WorkbenchProvider repository={repository}>
          <CommandCenterPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    const sessions = await screen.findByRole('region', { name: 'Completed Sessions' });
    expect(within(sessions).getByText('Add authentication unit tests')).toBeVisible();
    expect(within(sessions).getByText('Update API documentation')).toBeVisible();
    expect(within(sessions).queryByText('Fix intermittent login timeout')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clear status filter' })).toHaveAttribute(
      'href',
      '/command-center',
    );
  });

  it('renders loading and repository error states', async () => {
    const repository: PrototypeRepository = {
      load: vi.fn(async () => Promise.reject(new Error('Storage unavailable.'))),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };

    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository}>
          <CommandCenterPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Loading workbench...')).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable.');
  });

  it('falls back for sessions without optional labels', async () => {
    const snapshot = createDemoSnapshot();
    snapshot.sessions[0].projectId = 'missing-project';
    snapshot.sessions[0].currentAction = undefined;
    const repository: PrototypeRepository = {
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => snapshot),
      consumeWarning: vi.fn(() => null),
    };

    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository}>
          <CommandCenterPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Unknown project/)).toBeVisible();
    expect(screen.getByText('running', { selector: '.session-row__action' })).toBeVisible();
  });

  it('identifies submitted review feedback in recent activity', async () => {
    const timestamp = '2026-07-24T14:30:00.000Z';
    const snapshot = requestSessionChanges(createDemoSnapshot(), {
      sessionId: 'session-backend-claude',
      fileChangeId: 'change-session-timeout',
      feedback: 'Cover timeout boundaries.',
      severity: 'high',
      rerunImmediately: true,
      timestamp,
    });
    const repository: PrototypeRepository = {
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => snapshot),
      consumeWarning: vi.fn(() => null),
    };

    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository}>
          <CommandCenterPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    const activity = await screen.findByRole('region', { name: 'Recent Activity' });
    expect(
      within(activity).getByRole('link', { name: /Review.*Fix intermittent login timeout/s }),
    ).toBeVisible();
  });

  it('localizes built-in session content in Simplified Chinese', async () => {
    localStorage.setItem('astra-nexus.language', 'zh-CN');
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };

    render(
      <I18nProvider>
        <MemoryRouter>
          <WorkbenchProvider repository={repository}>
            <CommandCenterPage />
          </WorkbenchProvider>
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: '控制中心' })).toBeVisible();
    expect(screen.getAllByText('修复间歇性登录超时')[0]).toBeVisible();
    localStorage.clear();
  });
});
