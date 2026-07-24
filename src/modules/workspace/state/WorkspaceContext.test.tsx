import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  ActiveWorkspace,
  WorkspaceRecord,
  WorkspaceService,
} from '../../../core/contracts/workspace';
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext';

const record: WorkspaceRecord = {
  id: 'one',
  name: 'One',
  rootPath: 'C:\\One',
  normalizedPath: 'c:\\one',
  createdAt: '2026-07-20T10:00:00.000Z',
  lastOpenedAt: '2026-07-24T10:00:00.000Z',
  status: 'available',
};

const active: ActiveWorkspace = { id: record.id, name: record.name, rootPath: record.rootPath };

function createService(overrides: Partial<WorkspaceService> = {}): WorkspaceService {
  return {
    list: () => Promise.resolve([record]),
    chooseAndAdd: () => Promise.resolve(record),
    open: () => Promise.resolve(active),
    removeRecent: () => Promise.resolve(),
    refreshAvailability: () => Promise.resolve(),
    ...overrides,
  };
}

function Harness() {
  const workspace = useWorkspace();
  return (
    <div>
      <span data-testid="load-state">{workspace.loadState}</span>
      <span data-testid="active">{workspace.activeWorkspace?.name ?? 'none'}</span>
      <span data-testid="selected">{workspace.selectedId ?? 'none'}</span>
      <span data-testid="count">{workspace.workspaces.length}</span>
      {workspace.warning && <span role="status">{workspace.warning}</span>}
      {workspace.error && <span role="alert">{workspace.error}</span>}
      <button onClick={() => void workspace.chooseAndOpen()}>Choose</button>
      <button onClick={() => void workspace.openRecent(record.id)}>Open recent</button>
      <button onClick={() => void workspace.removeRecent(record.id)}>Remove recent</button>
      <button onClick={() => workspace.selectWorkspace(record.id)}>Select</button>
      <button onClick={workspace.closeWorkspace}>Close</button>
      <button onClick={workspace.dismissMessage}>Dismiss</button>
    </div>
  );
}

describe('WorkspaceContext', () => {
  it('loads warnings, selects, opens, closes, and removes through the service boundary', async () => {
    const user = userEvent.setup();
    const service = Object.assign(createService(), {
      consumeWarning: vi.fn(() => ({ message: 'Recovered recent workspace data.' })),
    });
    render(
      <WorkspaceProvider service={service}>
        <Harness />
      </WorkspaceProvider>,
    );

    expect(await screen.findByTestId('load-state')).toHaveTextContent('ready');
    expect(screen.getByRole('status')).toHaveTextContent('Recovered');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Select' }));
    expect(screen.getByTestId('selected')).toHaveTextContent('one');
    await user.click(screen.getByRole('button', { name: 'Open recent' }));
    expect(await screen.findByTestId('active')).toHaveTextContent('One');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('active')).toHaveTextContent('none');

    await user.click(screen.getByRole('button', { name: 'Remove recent' }));
    expect(service.removeRecent).toBeDefined();
  });

  it('treats a cancelled picker as a no-op', async () => {
    const user = userEvent.setup();
    const service = createService({ chooseAndAdd: () => Promise.resolve(null) });
    render(
      <WorkspaceProvider service={service}>
        <Harness />
      </WorkspaceProvider>,
    );
    await screen.findByText('ready');

    await user.click(screen.getByRole('button', { name: 'Choose' }));

    expect(screen.getByTestId('active')).toHaveTextContent('none');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces initialization and operation failures without crashing', async () => {
    const failingRefresh = createService({
      refreshAvailability: () => Promise.reject(new Error('Store unavailable')),
    });
    const { unmount } = render(
      <WorkspaceProvider service={failingRefresh}>
        <Harness />
      </WorkspaceProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Store unavailable');
    unmount();

    const user = userEvent.setup();
    const failingOperations = createService({
      chooseAndAdd: () => Promise.reject(new Error('Picker failed')),
      open: () => Promise.reject(new Error('Folder missing')),
      removeRecent: () => Promise.reject(new Error('Save failed')),
    });
    render(
      <WorkspaceProvider service={failingOperations}>
        <Harness />
      </WorkspaceProvider>,
    );
    await screen.findByText('ready');

    await user.click(screen.getByRole('button', { name: 'Choose' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Picker failed');
    await user.click(screen.getByRole('button', { name: 'Open recent' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Folder missing');
    await user.click(screen.getByRole('button', { name: 'Remove recent' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
  });
});
