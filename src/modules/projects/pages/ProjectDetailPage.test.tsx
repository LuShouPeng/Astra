import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import type { ProjectService } from '../services/projectService';
import { ProjectDetailPage } from './ProjectDetailPage';

function repository(snapshot = createDemoSnapshot()): PrototypeRepository {
  return {
    load: vi.fn(async () => snapshot),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
  };
}

const service: ProjectService = {
  inspectGit: vi.fn(),
  inspectRoot: vi.fn(),
  openDirectory: vi.fn(),
};

function renderPage(
  path = '/projects/project-backend-api',
  snapshot = createDemoSnapshot(),
  projectService = service,
) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <WorkbenchProvider repository={repository(snapshot)}>
        <Routes>
          <Route
            path="projects/:projectId"
            element={<ProjectDetailPage service={projectService} />}
          />
        </Routes>
      </WorkbenchProvider>
    </MemoryRouter>,
  );
}

describe('ProjectDetailPage', () => {
  it('renders all project views from the shared snapshot', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'backend-api' })).toBeVisible();
    expect(screen.getByLabelText('Project overview')).toHaveTextContent('1 active Session');
    expect(screen.getByRole('button', { name: 'Open project directory' })).toBeDisabled();

    await user.click(screen.getByRole('tab', { name: 'Sessions 3' }));
    expect(screen.getByRole('link', { name: /Fix intermittent login timeout/ })).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Changes 4' }));
    expect(screen.getByText('src/auth/session.ts')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Activity 6' }));
    expect(screen.getByText('Found four relevant call sites.')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Configuration' }));
    expect(screen.getByText('demo://backend-api')).toBeVisible();
  });

  it('shows a bounded not-found state', async () => {
    renderPage('/projects/missing-project');
    expect(await screen.findByRole('alert')).toHaveTextContent('Project not found');
  });

  it('handles an empty local project and recoverable directory-open failure', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    const project = {
      ...snapshot.projects[0],
      source: 'local' as const,
      description: undefined,
      gitRepository: false,
      branch: undefined,
    };
    snapshot.projects = [project];
    snapshot.sessions = [];
    snapshot.timelineEvents = [];
    snapshot.fileChanges = [];
    snapshot.attentionItems = [];
    snapshot.notifications = [];
    const localService: ProjectService = {
      inspectGit: vi.fn(),
      inspectRoot: vi.fn(),
      openDirectory: vi.fn(async () => Promise.reject(new Error('File manager unavailable.'))),
    };
    renderPage('/projects/project-backend-api', snapshot, localService);

    expect(await screen.findByText('No project description')).toBeVisible();
    expect(screen.getByText('No Sessions recorded for this project.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open project directory' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('File manager unavailable.');
    await user.click(screen.getByRole('tab', { name: 'Changes 0' }));
    expect(screen.getByText('No changed files recorded for this project.')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Activity 0' }));
    expect(screen.getByText('No activity recorded for this project.')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Configuration' }));
    expect(screen.getByText('Not available')).toBeVisible();
  });
});
