import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import type { ChangesService } from '../services/changesService';
import { ChangesPage } from './ChangesPage';

function repository(snapshot = createDemoSnapshot()): PrototypeRepository {
  return {
    load: vi.fn(async () => snapshot),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
  };
}

function createChangesService(): ChangesService {
  return {
    list: vi.fn(),
    diff: vi.fn(),
    openFile: vi.fn(),
    commit: vi.fn(async () => ({ commitId: 'a1b2c3d4', branch: 'main' })),
    checkout: vi.fn(),
    merge: vi.fn(async () => ({ success: true, conflicts: [] })),
    reset: vi.fn(),
    worktreeList: vi.fn(),
    worktreeCreate: vi.fn(),
    worktreeRemove: vi.fn(),
  };
}

describe('ChangesPage', () => {
  it('offers a next step when no changes are available', async () => {
    const snapshot = createDemoSnapshot();
    snapshot.fileChanges = [];
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('No changed files are available for review.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Browse Projects' })).toHaveAttribute(
      'href',
      '/projects',
    );
  });

  it('switches files, validates feedback, and persists a review request', async () => {
    const user = userEvent.setup();
    const store = repository();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <ChangesPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Review Changes' })).toBeVisible();
    expect(screen.getAllByRole('option')).toHaveLength(4);
    expect(screen.getByText('-const timeout = 5000;')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy Diff' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open File' })).toBeDisabled();

    await user.click(screen.getByRole('option', { name: /docs\/auth-flow\.png/ }));
    expect(screen.getByText('Binary preview unavailable')).toBeVisible();
    await user.click(screen.getByRole('option', { name: /src\/auth\/session\.ts/ }));

    await user.click(screen.getByRole('row', { name: 'Comment on new line 12' }));
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
    expect(screen.getByLabelText('Code location')).toHaveValue('src/auth/session.ts:12');
    await user.type(screen.getByLabelText('Requested changes'), 'Cover refresh token expiry.');
    await user.selectOptions(screen.getByLabelText('Severity'), 'high');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(store.save).toHaveBeenCalledOnce();
    expect(await screen.findByText('Changes requested')).toBeVisible();
  });

  it('marks a file reviewed and accepts every session change', async () => {
    const user = userEvent.setup();
    const store = repository();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <ChangesPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Review Changes' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Mark Reviewed' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Marked reviewed');
    expect(screen.getByRole('button', { name: 'Mark Reviewed' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Accept Changes' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Changes accepted');
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('copies a text diff and can close the request dialog', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository()}>
          <ChangesPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'Copy Diff' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Copy Diff' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('-const timeout = 5000;'));
    expect(await screen.findByRole('status')).toHaveTextContent('Diff copied');

    await user.click(screen.getByRole('button', { name: 'Request Changes' }));
    await user.click(screen.getByRole('button', { name: 'Close request' }));
    expect(screen.queryByRole('form', { name: 'Request Changes' })).not.toBeInTheDocument();
  });

  it('keeps review feedback available when persistence fails', async () => {
    const user = userEvent.setup();
    const store = repository();
    vi.mocked(store.save).mockRejectedValueOnce(new Error('Prototype store unavailable.'));
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <ChangesPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Request Changes' }));
    await user.type(screen.getByLabelText('Requested changes'), 'Keep this feedback for retry.');
    await user.click(screen.getByRole('button', { name: 'Submit request' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Prototype store unavailable.');
    expect(screen.getByRole('form', { name: 'Request Changes' })).toBeVisible();
    expect(screen.getByLabelText('Requested changes')).toHaveValue('Keep this feedback for retry.');
  });

  it('prevents duplicate clipboard writes while copying a diff', async () => {
    const user = userEvent.setup();
    let finishCopy: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve;
        }),
    );
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository()}>
          <ChangesPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Copy Diff' }));
    expect(screen.getByRole('button', { name: 'Copying Diff' })).toBeDisabled();
    finishCopy?.();
    expect(await screen.findByRole('button', { name: 'Copy Diff' })).toBeEnabled();
  });

  it('shows progress while opening a registered local file', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0].source = 'local';
    let finishOpen: (() => void) | undefined;
    const service: ChangesService = {
      list: vi.fn(),
      diff: vi.fn(),
      openFile: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishOpen = resolve;
          }),
      ),
      commit: vi.fn(),
      checkout: vi.fn(),
      merge: vi.fn(),
      reset: vi.fn(),
      worktreeList: vi.fn(),
      worktreeCreate: vi.fn(),
      worktreeRemove: vi.fn(),
    };
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesPage service={service} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Open File' }));
    expect(screen.getByRole('button', { name: 'Opening File' })).toBeDisabled();
    finishOpen?.();
    expect(await screen.findByRole('button', { name: 'Open File' })).toBeEnabled();
  });

  it('lists only usable local Git repositories and commits against the selected project', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0] = { ...snapshot.projects[0], source: 'local', rootPath: 'C:\\work\\api' };
    snapshot.projects[1] = {
      ...snapshot.projects[1],
      source: 'local',
      rootPath: 'C:\\work\\web',
      normalizedPath: 'c:\\work\\web',
    };
    snapshot.projects[2] = {
      ...snapshot.projects[2],
      source: 'local',
      gitRepository: false,
      rootPath: 'C:\\work\\not-a-repository',
    };
    const service = createChangesService();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesPage service={service} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    const projectPicker = await screen.findByLabelText('Git project');
    expect(projectPicker.querySelectorAll('option')).toHaveLength(2);
    expect(projectPicker).toHaveTextContent('backend-api');
    expect(projectPicker).toHaveTextContent('frontend');
    expect(projectPicker).not.toHaveTextContent('ai-service');

    await user.selectOptions(projectPicker, snapshot.projects[1].id);
    await user.click(screen.getByRole('button', { name: 'Commit' }));
    await user.type(screen.getByLabelText('Commit message'), 'Prepare the web release');
    await user.click(screen.getByRole('button', { name: 'Commit changes' }));

    await waitFor(() =>
      expect(service.commit).toHaveBeenCalledWith(snapshot.projects[1], {
        message: 'Prepare the web release',
      }),
    );
  });

  it('requires an explicit confirmation before performing a hard reset', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0] = { ...snapshot.projects[0], source: 'local', rootPath: 'C:\\work\\api' };
    const service = createChangesService();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesPage service={service} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Reset' }));
    await user.selectOptions(screen.getByLabelText('Reset type'), 'hard');
    await user.click(screen.getByRole('button', { name: 'Reset to HEAD' }));

    expect(service.reset).not.toHaveBeenCalled();
    expect(
      screen.getByRole('alertdialog', { name: 'Discard all uncommitted changes?' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() =>
      expect(service.reset).toHaveBeenCalledWith(snapshot.projects[0], { resetType: 'hard' }),
    );
  });

  it('creates a branch from the selected local repository and trims its name', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0] = { ...snapshot.projects[0], source: 'local', rootPath: 'C:\\work\\api' };
    const service = createChangesService();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesPage service={service} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Checkout' }));
    const branchName = screen.getByLabelText('Branch name');
    const checkoutForm = branchName.closest('form');
    expect(checkoutForm).not.toBeNull();
    await user.type(branchName, '  release/2026-07  ');
    await user.click(screen.getByRole('checkbox', { name: 'Create a new branch' }));
    await user.click(within(checkoutForm!).getByRole('button', { name: 'Checkout' }));

    await waitFor(() =>
      expect(service.checkout).toHaveBeenCalledWith(snapshot.projects[0], {
        branchName: 'release/2026-07',
        createNew: true,
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Checked out release/2026-07');
  });

  it('keeps the user on the Changes page when a merge reports conflicts', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0] = { ...snapshot.projects[0], source: 'local', rootPath: 'C:\\work\\api' };
    const service = createChangesService();
    service.merge = vi.fn(async () => ({ success: false, conflicts: ['README.md', 'src/app.ts'] }));
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesPage service={service} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Merge' }));
    const branchName = screen.getByLabelText('Branch to merge');
    const mergeForm = branchName.closest('form');
    expect(mergeForm).not.toBeNull();
    await user.type(branchName, ' feature/accessibility ');
    await user.click(within(mergeForm!).getByRole('button', { name: 'Merge' }));

    await waitFor(() =>
      expect(service.merge).toHaveBeenCalledWith(snapshot.projects[0], {
        branchName: 'feature/accessibility',
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Merge conflicts detected in: README.md, src/app.ts',
    );
  });

  it('performs a non-destructive reset without requiring the hard-reset confirmation', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0] = { ...snapshot.projects[0], source: 'local', rootPath: 'C:\\work\\api' };
    const service = createChangesService();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesPage service={service} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Reset' }));
    await user.selectOptions(screen.getByLabelText('Reset type'), 'soft');
    await user.click(screen.getByRole('button', { name: 'Reset to HEAD' }));

    await waitFor(() =>
      expect(service.reset).toHaveBeenCalledWith(snapshot.projects[0], { resetType: 'soft' }),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Reset to HEAD (Soft (keep changes staged))');
  });

  it('keeps the branch input available when checkout fails', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0] = { ...snapshot.projects[0], source: 'local', rootPath: 'C:\\work\\api' };
    const service = createChangesService();
    service.checkout = vi.fn(async () => {
      throw new Error('Branch protection rejected checkout.');
    });
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesPage service={service} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Checkout' }));
    const branchName = screen.getByLabelText('Branch name');
    const checkoutForm = branchName.closest('form');
    expect(checkoutForm).not.toBeNull();
    await user.type(branchName, 'protected/main');
    await user.click(within(checkoutForm!).getByRole('button', { name: 'Checkout' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Branch protection rejected checkout.');
    expect(branchName).toHaveValue('protected/main');
  });

  it('summarizes a successful merge and closes its form', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0] = { ...snapshot.projects[0], source: 'local', rootPath: 'C:\\work\\api' };
    const service = createChangesService();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesPage service={service} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Merge' }));
    const branchName = screen.getByLabelText('Branch to merge');
    const mergeForm = branchName.closest('form');
    expect(mergeForm).not.toBeNull();
    await user.type(branchName, 'feature/release-notes');
    await user.click(within(mergeForm!).getByRole('button', { name: 'Merge' }));

    await waitFor(() =>
      expect(service.merge).toHaveBeenCalledWith(snapshot.projects[0], {
        branchName: 'feature/release-notes',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Merged feature/release-notes');
    expect(screen.queryByLabelText('Branch to merge')).not.toBeInTheDocument();
  });

  it('reports reset errors after a non-destructive reset attempt', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0] = { ...snapshot.projects[0], source: 'local', rootPath: 'C:\\work\\api' };
    const service = createChangesService();
    service.reset = vi.fn(async () => {
      throw new Error('Index is locked.');
    });
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesPage service={service} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Reset' }));
    await user.click(screen.getByRole('button', { name: 'Reset to HEAD' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Index is locked.');
    expect(screen.getByLabelText('Reset type')).toHaveValue('mixed');
  });

  it('does not reset when the hard-reset confirmation is cancelled', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0] = { ...snapshot.projects[0], source: 'local', rootPath: 'C:\\work\\api' };
    const service = createChangesService();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesPage service={service} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Reset' }));
    await user.selectOptions(screen.getByLabelText('Reset type'), 'hard');
    await user.click(screen.getByRole('button', { name: 'Reset to HEAD' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Discard all uncommitted changes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(service.reset).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Reset type')).toHaveValue('hard');
  });

  it('keeps a commit message available when committing changes fails', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.projects[0] = { ...snapshot.projects[0], source: 'local', rootPath: 'C:\\work\\api' };
    const service = createChangesService();
    service.commit = vi.fn(async () => {
      throw new Error('A Git identity is required.');
    });
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesPage service={service} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Commit' }));
    const commitMessage = screen.getByLabelText('Commit message');
    await user.type(commitMessage, 'Prepare release');
    await user.click(screen.getByRole('button', { name: 'Commit changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A Git identity is required.');
    expect(commitMessage).toHaveValue('Prepare release');
  });

  it('does not render Git operations for non-Git or missing projects', async () => {
    const snapshot = createDemoSnapshot();
    snapshot.projects = snapshot.projects.map((project) => ({
      ...project,
      source: 'local' as const,
      status: 'missing' as const,
      gitRepository: false,
    }));
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <ChangesPage service={createChangesService()} />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Review Changes' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Commit' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Git operations')).not.toBeInTheDocument();
  });
});
