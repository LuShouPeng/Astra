import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceRecord, WorkspaceService } from '../core/contracts/workspace';
import type { PrototypeRepository } from '../core/data/prototypeRepository';
import { createDemoSnapshot } from '../modules/demo';
import type { ProjectService } from '../modules/projects';
import { App } from './App';

const record: WorkspaceRecord = {
  id: 'astra',
  name: 'Astra Nexus',
  rootPath: 'C:\\Code\\Astra Nexus',
  normalizedPath: 'c:\\code\\astra nexus',
  createdAt: '2026-07-24T10:00:00.000Z',
  lastOpenedAt: '2026-07-24T10:00:00.000Z',
  status: 'available',
};

function createService(): WorkspaceService {
  return {
    list: vi.fn(async () => []),
    chooseAndAdd: vi.fn(async () => record),
    open: vi.fn(async () => ({ id: record.id, name: record.name, rootPath: record.rootPath })),
    removeRecent: vi.fn(async () => undefined),
    refreshAvailability: vi.fn(async () => undefined),
  };
}

function createRepository(): PrototypeRepository {
  return {
    load: vi.fn(async () => createDemoSnapshot()),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
  };
}

describe('App workspace flow', () => {
  it('opens a valid folder into a shell showing workspace name and path', async () => {
    const user = userEvent.setup();
    render(<App service={createService()} repository={createRepository()} />);

    await user.click(await screen.findByRole('button', { name: 'Open Folder' }));

    expect(await screen.findByRole('heading', { name: 'Command Center' })).toBeVisible();
    expect(screen.getAllByText('Astra Nexus').length).toBeGreaterThan(0);
    expect(screen.getByRole('navigation', { name: 'Workbench activities' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Back to Projects' })).toBeVisible();
  });

  it('returns from the shell to Projects and clears active workspace', async () => {
    const user = userEvent.setup();
    render(<App service={createService()} repository={createRepository()} />);
    await user.click(await screen.findByRole('button', { name: 'Open Folder' }));

    await user.click(await screen.findByRole('button', { name: 'Back to Projects' }));

    expect(await screen.findByRole('heading', { name: 'Recent Workspaces' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Command Center' })).not.toBeInTheDocument();
  });

  it('adds a local project and updates it without creating a duplicate', async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    const projectService: ProjectService = {
      inspectGit: vi.fn(),
      inspectRoot: vi.fn(async () => ({
        gitRepository: true,
        branch: 'main',
        gitStatus: 'clean' as const,
      })),
      openDirectory: vi.fn(),
    };
    render(
      <App service={createService()} repository={repository} projectService={projectService} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Open Folder' }));
    await user.click(await screen.findByRole('link', { name: 'Projects' }));
    await user.click(await screen.findByRole('button', { name: 'Add Project' }));
    expect(await screen.findByText('4 projects')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Astra Nexus' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Add Project' }));
    expect(screen.getByText('4 projects')).toBeVisible();
    expect(repository.save).toHaveBeenCalledTimes(2);
  });
});
