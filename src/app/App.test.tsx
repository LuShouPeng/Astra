import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRecord, WorkspaceService } from '../core/contracts/workspace';
import type { PrototypeRepository } from '../core/data/prototypeRepository';
import type { WorkbenchSnapshot } from '../core/contracts/workbenchData';
import { createDemoSnapshot } from '../modules/demo';
import type { ProjectService } from '../modules/projects';
import { App } from './App';

vi.mock('../modules/workflows/pages/WorkflowEditorPage', () => ({
  WorkflowEditorPage: () => <div>Workflow editor</div>,
}));

afterEach(() => localStorage.clear());

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
  let opened = false;
  return {
    list: vi.fn(async () => (opened ? [record] : [])),
    chooseAndAdd: vi.fn(async () => {
      opened = true;
      return record;
    }),
    open: vi.fn(async () => ({ id: record.id, name: record.name, rootPath: record.rootPath })),
    removeRecent: vi.fn(async () => undefined),
    refreshAvailability: vi.fn(async () => undefined),
  };
}

function desktopActivityRail() {
  const rail = document.querySelector<HTMLElement>('.activity-rail__desktop');
  if (!rail) throw new Error('Desktop activity rail is unavailable.');
  return rail;
}

interface TestRepository extends PrototypeRepository {
  savedSnapshots: WorkbenchSnapshot[];
}

function createRepository(): TestRepository {
  const savedSnapshots: WorkbenchSnapshot[] = [];
  return {
    load: vi.fn(async () => createDemoSnapshot()),
    save: vi.fn(async (snapshot: WorkbenchSnapshot) => {
      savedSnapshots.push(snapshot);
    }),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
    savedSnapshots,
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
    expect(screen.getByRole('link', { name: 'Notifications' })).toHaveTextContent('2');
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
    await user.click(within(desktopActivityRail()).getByRole('link', { name: 'Projects' }));
    await user.click(await screen.findByRole('button', { name: 'Add Project' }));
    expect(await screen.findByText('4 projects')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Astra Nexus' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Add Project' }));
    expect(screen.getByText('4 projects')).toBeVisible();
    expect(repository.save).toHaveBeenCalledTimes(2);
  });

  it('derives a local project before creating a workflow from the active workspace', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const repository = createRepository();
    render(<App service={createService()} repository={repository} />);

    await user.click(await screen.findByRole('button', { name: 'Open Folder' }));
    await user.click(within(desktopActivityRail()).getByRole('link', { name: 'Workflows' }));
    await user.click(await screen.findByRole('button', { name: 'New workflow' }));

    await waitFor(() => {
      expect(localStorage.getItem('astra.workflow.definitions.v1')).toContain(
        '"projectId":"project-astra"',
      );
    });
    await waitFor(() =>
      expect(
        repository.savedSnapshots.some((snapshot) =>
          snapshot.projects.some(
            (project) =>
              project.id === 'project-astra' &&
              project.normalizedPath === record.normalizedPath &&
              project.source === 'local',
          ),
        ),
      ).toBe(true),
    );
  });
});
