import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import type { ProjectService } from '../../projects';
import { SessionDetailPage } from './SessionDetailPage';

function createRepository(snapshot = createDemoSnapshot()): PrototypeRepository {
  return {
    load: vi.fn(async () => snapshot),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
  };
}

describe('SessionDetailPage', () => {
  it('exposes complete session metadata and working header shortcuts', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0].source = 'local';
    const projectService: ProjectService = {
      inspectGit: vi.fn(),
      inspectRoot: vi.fn(),
      openDirectory: vi.fn(async () => undefined),
    };
    render(
      <MemoryRouter initialEntries={['/sessions/session-backend-claude']}>
        <WorkbenchProvider repository={createRepository(snapshot)}>
          <Routes>
            <Route
              path="sessions/:sessionId"
              element={<SessionDetailPage projectService={projectService} />}
            />
          </Routes>
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Start time')).toBeVisible();
    expect(screen.getByText('45m')).toBeVisible();
    expect(screen.getByText('Claude', { selector: '.session-header__provider' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(screen.getByLabelText('Follow-up message')).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Review Changes' }));
    expect(screen.getByRole('tab', { name: 'Changes 4' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('button', { name: 'Open Project' }));
    expect(projectService.openDirectory).toHaveBeenCalledWith(snapshot.projects[0]);
  });

  it('approves an available request and stops an active simulation', async () => {
    const user = userEvent.setup();
    const approvalRepository = createRepository();
    const { unmount } = render(
      <MemoryRouter initialEntries={['/sessions/session-frontend-codex']}>
        <WorkbenchProvider repository={approvalRepository}>
          <Routes>
            <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(screen.getByText('running', { selector: '.session-status' })).toBeVisible();
    expect(approvalRepository.save).toHaveBeenCalledOnce();

    unmount();
    const stopRepository = createRepository();
    render(
      <MemoryRouter initialEntries={['/sessions/session-backend-claude']}>
        <WorkbenchProvider repository={stopRepository}>
          <Routes>
            <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(screen.getByText('stopped', { selector: '.session-status' })).toBeVisible();
    expect(await screen.findByText('Session stopped in the local simulation.')).toBeVisible();
    expect(stopRepository.save).toHaveBeenCalledOnce();
  });

  it('renders details and persists a follow-up message', async () => {
    const user = userEvent.setup();
    const repository = createRepository();
    render(
      <MemoryRouter initialEntries={['/sessions/session-backend-codex']}>
        <WorkbenchProvider repository={repository}>
          <Routes>
            <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Add authentication unit tests' }),
    ).toBeVisible();
    await user.type(screen.getByLabelText('Follow-up message'), 'Add an edge-case test.');
    await user.click(screen.getByRole('button', { name: 'Send follow-up' }));

    expect(await screen.findByText('Add an edge-case test.')).toBeVisible();
    expect(screen.getByText('running', { selector: '.session-status' })).toBeVisible();
    expect(repository.save).toHaveBeenCalledOnce();
  });

  it('disables follow-ups for a display-only Gemini session', async () => {
    render(
      <MemoryRouter initialEntries={['/sessions/session-backend-gemini']}>
        <WorkbenchProvider repository={createRepository()}>
          <Routes>
            <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Display only')).toBeVisible();
    expect(screen.getByLabelText('Follow-up message')).toBeDisabled();
  });

  it('deep-links to structured command, test, and context views', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/sessions/session-backend-claude?tab=commands']}>
        <WorkbenchProvider repository={createRepository()}>
          <Routes>
            <Route path="sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('tab', { name: 'Commands 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByText('Found four relevant call sites.')).toBeVisible();
    expect(screen.getByText('Exit code 0')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Tests 1' }));
    expect(screen.getByText('0 passed')).toBeVisible();
    expect(screen.getByText('0 failed')).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Context' }));
    expect(screen.getByText('demo://backend-api')).toBeVisible();
    expect(screen.getByText('Deterministic mock')).toBeVisible();
  });

  it('shows native project-open progress and blocks missing projects', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0].source = 'local';
    let finishOpen: (() => void) | undefined;
    const projectService: ProjectService = {
      inspectGit: vi.fn(),
      inspectRoot: vi.fn(),
      openDirectory: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishOpen = resolve;
          }),
      ),
    };
    const { unmount } = render(
      <MemoryRouter initialEntries={['/sessions/session-backend-claude']}>
        <WorkbenchProvider repository={createRepository(snapshot)}>
          <Routes>
            <Route
              path="sessions/:sessionId"
              element={<SessionDetailPage projectService={projectService} />}
            />
          </Routes>
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Open Project' }));
    expect(screen.getByRole('button', { name: 'Opening Project' })).toBeDisabled();
    finishOpen?.();
    expect(await screen.findByRole('button', { name: 'Open Project' })).toBeEnabled();

    unmount();
    snapshot.projects[0].status = 'missing';
    render(
      <MemoryRouter initialEntries={['/sessions/session-backend-claude']}>
        <WorkbenchProvider repository={createRepository(snapshot)}>
          <Routes>
            <Route
              path="sessions/:sessionId"
              element={<SessionDetailPage projectService={projectService} />}
            />
          </Routes>
        </WorkbenchProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: 'Open Project' })).toBeDisabled();
  });
});
