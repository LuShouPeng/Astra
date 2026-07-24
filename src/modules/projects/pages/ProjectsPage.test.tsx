import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import { createProjectService, type ProjectNativeAdapter } from '../services/projectService';
import { ProjectsPage } from './ProjectsPage';

describe('ProjectsPage', () => {
  it('shows every project-card field required by the PRD', async () => {
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };
    const adapter: ProjectNativeAdapter = {
      gitSummary: vi.fn(),
      openDirectory: vi.fn(),
    };

    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository}>
          <ProjectsPage service={createProjectService(adapter)} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    const heading = await screen.findByRole('heading', { name: 'backend-api' });
    const card = heading.closest('article');
    expect(card).not.toBeNull();
    const project = within(card!);
    expect(project.getByText('demo://backend-api')).toBeVisible();
    expect(project.getByText('Active Agents').nextElementSibling).toHaveTextContent('1');
    expect(project.getByText('Changed Files').nextElementSibling).toHaveTextContent('7');
  });

  it('filters, sorts, and removes registry metadata after confirmation', async () => {
    const user = userEvent.setup();
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };
    const adapter: ProjectNativeAdapter = {
      gitSummary: vi.fn(),
      openDirectory: vi.fn(),
    };

    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository}>
          <ProjectsPage service={createProjectService(adapter)} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeVisible();
    await user.type(screen.getByRole('searchbox', { name: 'Search projects' }), 'frontend');
    expect(screen.getByRole('heading', { name: 'frontend' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'backend-api' })).not.toBeInTheDocument();

    await user.clear(screen.getByRole('searchbox', { name: 'Search projects' }));
    await user.click(screen.getByRole('button', { name: 'Remove backend-api' }));
    expect(screen.getByRole('alertdialog', { name: 'Remove project?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('2 projects')).toBeVisible();
    expect(repository.save).toHaveBeenCalledOnce();
  });

  it('shows empty search and recoverable directory-open errors', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0] = { ...snapshot.projects[0], source: 'local' };
    const repository: PrototypeRepository = {
      load: vi.fn(async () => snapshot),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => snapshot),
      consumeWarning: vi.fn(() => null),
    };
    const adapter: ProjectNativeAdapter = {
      gitSummary: vi.fn(),
      openDirectory: vi.fn(async () => Promise.reject(new Error('File manager unavailable.'))),
    };
    const onAddProject = vi.fn(async () => undefined);
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository}>
          <ProjectsPage service={createProjectService(adapter)} onAddProject={onAddProject} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Add Project' }));
    expect(onAddProject).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Open backend-api directory' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('File manager unavailable.');

    await user.type(screen.getByRole('searchbox', { name: 'Search projects' }), 'no-match');
    expect(screen.getByText('No projects match this search.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('heading', { name: 'backend-api' })).toBeVisible();
  });

  it('shows feedback while adding a project and exposes picker failures', async () => {
    const user = userEvent.setup();
    let finishAdd: (() => void) | undefined;
    const onAddProject = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishAdd = resolve;
        }),
    );
    const repository: PrototypeRepository = {
      load: vi.fn(async () => createDemoSnapshot()),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };
    const adapter: ProjectNativeAdapter = {
      gitSummary: vi.fn(),
      openDirectory: vi.fn(),
    };

    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository}>
          <ProjectsPage
            service={createProjectService(adapter)}
            onAddProject={onAddProject}
            addProjectError="The folder picker could not be opened."
          />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The folder picker could not be opened.',
    );
    await user.click(screen.getByRole('button', { name: 'Add Project' }));
    expect(screen.getByRole('button', { name: 'Adding Project' })).toBeDisabled();
    finishAdd?.();
    expect(await screen.findByRole('button', { name: 'Add Project' })).toBeEnabled();
  });
});
