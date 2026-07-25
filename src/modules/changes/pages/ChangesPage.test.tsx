import { render, screen } from '@testing-library/react';
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

    await user.click(screen.getByRole('button', { name: 'Request Changes' }));
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
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
});
