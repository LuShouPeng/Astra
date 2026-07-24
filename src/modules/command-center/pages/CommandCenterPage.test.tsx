import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
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
    expect(screen.getByText('2', { selector: '[data-status="running"] strong' })).toBeVisible();
    expect(screen.getByText('1', { selector: '[data-status="waiting"] strong' })).toBeVisible();
    const activeSessions = screen.getByRole('region', { name: 'Active Sessions' });
    expect(
      within(activeSessions).getByRole('link', { name: /Fix intermittent login timeout/ }),
    ).toHaveAttribute('href', '/sessions/session-backend-claude');
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
});
