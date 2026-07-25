import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceRecord } from '../../../core/contracts/workspace';
import { RecentWorkspaceRow } from './RecentWorkspaceRow';

const workspace: WorkspaceRecord = {
  id: 'one',
  name: 'Project One',
  rootPath: 'C:\\Projects\\One',
  normalizedPath: 'c:\\projects\\one',
  createdAt: '2026-07-20T10:00:00.000Z',
  lastOpenedAt: '2026-07-24T10:00:00.000Z',
  status: 'available',
};

function renderRow(overrides: Partial<WorkspaceRecord> = {}) {
  const handlers = { onSelect: vi.fn(), onOpen: vi.fn(), onRemove: vi.fn() };
  render(
    <RecentWorkspaceRow
      workspace={{ ...workspace, ...overrides }}
      selected={false}
      opening={false}
      disabled={false}
      {...handlers}
    />,
  );
  return handlers;
}

describe('RecentWorkspaceRow', () => {
  it('supports selection, double-click, Enter, and the remove menu', async () => {
    const user = userEvent.setup();
    const handlers = renderRow();
    const row = screen.getByRole('article');

    await user.click(row);
    await user.dblClick(row);
    row.focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'More actions for Project One' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from Recent' }));

    expect(handlers.onSelect).toHaveBeenCalled();
    expect(handlers.onOpen).toHaveBeenCalledTimes(2);
    expect(handlers.onRemove).toHaveBeenCalledOnce();
  });

  it('does not open a missing workspace from double-click or Enter', async () => {
    const user = userEvent.setup();
    const handlers = renderRow({ status: 'missing' });
    const row = screen.getByRole('article');

    await user.dblClick(row);
    row.focus();
    await user.keyboard('{Enter}');

    expect(handlers.onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open Project One' })).toBeDisabled();
  });
});
