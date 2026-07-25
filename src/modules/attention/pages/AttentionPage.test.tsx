import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';
import type { PrototypeRepository } from '../../../core/data/prototypeRepository';
import { WorkbenchProvider } from '../../../core/state/WorkbenchContext';
import { createDemoSnapshot } from '../../demo';
import { AttentionPage } from './AttentionPage';

function repository(snapshot = createDemoSnapshot()): PrototypeRepository {
  return {
    load: vi.fn(async () => snapshot),
    save: vi.fn(async () => undefined),
    reset: vi.fn(async () => createDemoSnapshot()),
    consumeWarning: vi.fn(() => null),
  };
}

describe('AttentionPage', () => {
  it('shows a loading state until the attention snapshot is available', () => {
    const store: PrototypeRepository = {
      load: vi.fn(() => new Promise<WorkbenchSnapshot>(() => undefined)),
      save: vi.fn(async () => undefined),
      reset: vi.fn(async () => createDemoSnapshot()),
      consumeWarning: vi.fn(() => null),
    };
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <AttentionPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Loading attention items...')).toBeVisible();
  });

  it('offers six filters and type-specific actions', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.attentionItems.push(
      {
        id: 'attention-input',
        sessionId: 'session-backend-claude',
        projectId: 'project-backend-api',
        type: 'input',
        priority: 'medium',
        title: 'Clarification required',
        description: 'Reply with the intended timeout behavior.',
        createdAt: '2026-07-24T14:13:00.000Z',
        read: false,
        resolved: false,
      },
      {
        id: 'attention-review',
        sessionId: 'session-backend-claude',
        projectId: 'project-backend-api',
        type: 'review',
        priority: 'high',
        title: 'Changes ready for review',
        description: 'Review four changed files.',
        createdAt: '2026-07-24T14:14:00.000Z',
        read: false,
        resolved: false,
      },
      {
        id: 'attention-completed',
        sessionId: 'session-backend-codex',
        projectId: 'project-backend-api',
        type: 'completed',
        priority: 'low',
        title: 'Session completed',
        description: 'The deterministic task has completed.',
        createdAt: '2026-07-24T14:15:00.000Z',
        read: false,
        resolved: false,
      },
    );
    const store = repository(snapshot);
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <AttentionPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Needs Attention' })).toBeVisible();
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    const queue = screen.getByRole('group', { name: 'Action queue' });
    expect(within(queue).getByRole('button', { name: 'Open 5' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(queue).getByRole('button', { name: 'Resolved 0' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(
      screen.getByRole('button', { name: 'Approve Dependency approval required' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry TypeScript typecheck failed' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Reply Clarification required' })).toHaveAttribute(
      'href',
      '/sessions/session-backend-claude?focus=message',
    );
    expect(
      screen.getByRole('link', { name: 'Open Diff Changes ready for review' }),
    ).toHaveAttribute('href', '/sessions/session-backend-claude?tab=changes');
    expect(
      screen.getByRole('link', { name: 'Request Changes Changes ready for review' }),
    ).toHaveAttribute('href', '/sessions/session-backend-claude?tab=changes&request=changes');
    expect(screen.getByRole('button', { name: 'Accept Changes ready for review' })).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'View Logs TypeScript typecheck failed' }),
    ).toHaveAttribute('href', '/sessions/session-frontend-claude?tab=commands');
    expect(screen.getByRole('button', { name: 'Mark Done Session completed' })).toBeVisible();
    expect(
      screen.getAllByText('Codex', { selector: '.attention-item__agent' }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Add authentication unit tests')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Mark Read/ }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Accept Changes ready for review' }));
    expect(screen.queryByText('Changes ready for review')).not.toBeInTheDocument();
    expect(store.save).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('tab', { name: 'Failures 1' }));
    expect(screen.queryByText('Dependency approval required')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry TypeScript typecheck failed' }));
    expect(await screen.findByText('No open items in this filter.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Return to Command Center' })).toHaveAttribute(
      'href',
      '/command-center',
    );
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('sorts by priority and exposes resolved items', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.attentionItems[0].resolved = true;
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <AttentionPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    const queue = await screen.findByRole('group', { name: 'Action queue' });
    await user.click(await within(queue).findByRole('button', { name: 'Resolved 1' }));
    expect(within(queue).getByRole('button', { name: 'Resolved 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Dependency approval required')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Approve Dependency/ })).not.toBeInTheDocument();
    await user.click(within(queue).getByRole('button', { name: 'Open 1' }));
    expect(within(queue).getByRole('button', { name: 'Open 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('TypeScript typecheck failed')).toBeVisible();
  });

  it('sorts the open queue by priority or recency and handles orphaned attention metadata', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.attentionItems.push(
      {
        id: 'attention-later-high',
        sessionId: 'session-backend-claude',
        projectId: 'project-backend-api',
        type: 'input',
        priority: 'high',
        title: 'Latest high priority input',
        description: 'Confirm the timeout boundary.',
        createdAt: '2026-07-24T14:13:00.000Z',
        read: false,
        resolved: false,
      },
      {
        id: 'attention-orphaned',
        sessionId: 'missing-session',
        projectId: 'missing-project',
        type: 'input',
        priority: 'low',
        title: 'Orphaned input',
        description: 'This item keeps its recovery context visible.',
        createdAt: '2026-07-24T14:00:00.000Z',
        read: false,
        resolved: false,
      },
    );
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(snapshot)}>
          <AttentionPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: 'Needs Attention' });
    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent(
      'TypeScript typecheck failed',
    );
    expect(screen.getAllByRole('heading', { level: 2 })[1]).toHaveTextContent(
      'Latest high priority input',
    );
    expect(screen.getByText('Unknown project')).toBeVisible();
    expect(screen.getByText('Unknown Agent')).toBeVisible();
    expect(screen.getByText(/unknown session/i)).toBeVisible();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'recent');
    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent(
      'Latest high priority input',
    );
  });

  it('rejects an approval, records the updated session state, and keeps resolved entries read-only', async () => {
    const user = userEvent.setup();
    const store = repository();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <AttentionPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Reject Dependency approval required' }),
    );

    expect(screen.queryByText('Dependency approval required')).not.toBeInTheDocument();
    const rejected = vi.mocked(store.save).mock.calls[0]?.[0];
    expect(
      rejected?.sessions.find((session) => session.id === 'session-frontend-codex')?.status,
    ).toBe('stopped');
    expect(
      rejected?.attentionItems.find((item) => item.id === 'attention-frontend-approval'),
    ).toMatchObject({ read: true, resolved: true });

    const queue = screen.getByRole('group', { name: 'Action queue' });
    await user.click(within(queue).getByRole('button', { name: 'Resolved 1' }));
    expect(screen.getByText('Dependency approval required')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Reject Dependency/ })).not.toBeInTheDocument();
  });

  it('approves pending work and dismisses a failure without rewriting the failed session status', async () => {
    const user = userEvent.setup();
    const store = repository();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <AttentionPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Approve Dependency approval required' }),
    );
    expect(
      vi
        .mocked(store.save)
        .mock.calls[0]?.[0].sessions.find((session) => session.id === 'session-frontend-codex')
        ?.status,
    ).toBe('running');

    await user.click(screen.getByRole('button', { name: 'Dismiss TypeScript typecheck failed' }));
    expect(screen.queryByText('TypeScript typecheck failed')).not.toBeInTheDocument();
    expect(
      vi
        .mocked(store.save)
        .mock.calls[1]?.[0].sessions.find((session) => session.id === 'session-frontend-claude')
        ?.status,
    ).toBe('failed');
  });

  it('marks unread attention as read and dismisses completed work without changing its session status', async () => {
    const user = userEvent.setup();
    const snapshot = createDemoSnapshot();
    snapshot.attentionItems.push({
      id: 'attention-completed',
      sessionId: 'session-backend-codex',
      projectId: 'project-backend-api',
      type: 'completed',
      priority: 'low',
      title: 'Completed documentation update',
      description: 'The documentation update is ready for review.',
      createdAt: '2026-07-24T14:15:00.000Z',
      read: false,
      resolved: false,
    });
    const store = repository(snapshot);
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={store}>
          <AttentionPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Mark Read Dependency approval required' }),
    );
    expect(
      screen.queryByRole('button', { name: 'Mark Read Dependency approval required' }),
    ).not.toBeInTheDocument();
    expect(vi.mocked(store.save).mock.calls[0]?.[0].attentionItems[0]).toMatchObject({
      read: true,
      resolved: false,
    });

    await user.click(
      screen.getByRole('button', { name: 'Mark Done Completed documentation update' }),
    );
    expect(screen.queryByText('Completed documentation update')).not.toBeInTheDocument();
    const dismissed = vi.mocked(store.save).mock.calls[1]?.[0];
    expect(
      dismissed?.sessions.find((session) => session.id === 'session-backend-codex')?.status,
    ).toBe('completed');
    expect(
      dismissed?.attentionItems.find((item) => item.id === 'attention-completed'),
    ).toMatchObject({
      resolved: true,
    });
  });

  it('surfaces distinct update, read, and review acceptance errors', async () => {
    const user = userEvent.setup();
    const failedSave = repository();
    vi.mocked(failedSave.save).mockRejectedValueOnce(
      new Error('Attention storage is unavailable.'),
    );
    const { unmount } = render(
      <MemoryRouter>
        <WorkbenchProvider repository={failedSave}>
          <AttentionPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Reject Dependency approval required' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Attention storage is unavailable.');

    unmount();
    const unreadSave = repository();
    vi.mocked(unreadSave.save).mockRejectedValueOnce('browser store rejected the write');
    const unreadRender = render(
      <MemoryRouter>
        <WorkbenchProvider repository={unreadSave}>
          <AttentionPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Mark Read Dependency approval required' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The item could not be marked read.',
    );

    unreadRender.unmount();
    const noChanges = createDemoSnapshot();
    noChanges.attentionItems.push({
      id: 'attention-review-without-changes',
      sessionId: 'session-ai-claude',
      projectId: 'project-ai-service',
      type: 'review',
      priority: 'medium',
      title: 'Review without a diff',
      description: 'This review has no changed files to accept.',
      createdAt: '2026-07-24T14:14:00.000Z',
      read: false,
      resolved: false,
    });
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository(noChanges)}>
          <AttentionPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole('button', { name: 'Accept Review without a diff' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This session has no changes to accept.',
    );
  });

  it('supports keyboard navigation between type filters', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <WorkbenchProvider repository={repository()}>
          <AttentionPage />
        </WorkbenchProvider>
      </MemoryRouter>,
    );

    const allFilter = await screen.findByRole('tab', { name: 'All 2' });
    allFilter.focus();
    await user.keyboard('{ArrowRight}');

    const approvalFilter = screen.getByRole('tab', { name: 'Approvals 1' });
    expect(approvalFilter).toHaveFocus();
    expect(approvalFilter).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(allFilter).toHaveFocus();
    expect(allFilter).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{End}');
    const completedFilter = screen.getByRole('tab', { name: 'Completed 0' });
    expect(completedFilter).toHaveFocus();
    expect(completedFilter).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(allFilter).toHaveFocus();
    expect(allFilter).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('x');
    expect(allFilter).toHaveAttribute('aria-selected', 'true');
  });
});
