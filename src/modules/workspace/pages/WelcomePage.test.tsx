import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceService } from '../../../core/contracts/workspace';
import { WorkspaceProvider } from '../state/WorkspaceContext';
import { WelcomePage } from './WelcomePage';

const emptyService: WorkspaceService = {
  list: vi.fn(async () => []),
  chooseAndAdd: vi.fn(async () => null),
  open: vi.fn(),
  removeRecent: vi.fn(async () => undefined),
  refreshAvailability: vi.fn(async () => undefined),
};

describe('WelcomePage', () => {
  it('renders the cold-start empty state and primary folder action', async () => {
    render(
      <WorkspaceProvider service={emptyService}>
        <WelcomePage />
      </WorkspaceProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Recent Workspaces' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open Folder' })).toBeEnabled();
    expect(screen.getByText('No recent workspaces')).toBeVisible();
  });

  it('marks missing workspaces, blocks opening, and confirms metadata-only removal', async () => {
    const user = userEvent.setup();
    const missing = {
      id: 'missing',
      name: 'Moved Project',
      rootPath: 'C:\\Code\\Moved Project',
      normalizedPath: 'c:\\code\\moved project',
      createdAt: '2026-07-20T10:00:00.000Z',
      lastOpenedAt: '2026-07-22T10:00:00.000Z',
      status: 'missing' as const,
    };
    const service: WorkspaceService = {
      ...emptyService,
      list: vi.fn(async () => [missing]),
      removeRecent: vi.fn(async () => undefined),
    };
    render(
      <WorkspaceProvider service={service}>
        <WelcomePage />
      </WorkspaceProvider>,
    );

    expect(await screen.findByText('Missing')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open Moved Project' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'More actions for Moved Project' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from Recent' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('will not delete the local folder');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(service.removeRecent).toHaveBeenCalledWith('missing');
  });
});
