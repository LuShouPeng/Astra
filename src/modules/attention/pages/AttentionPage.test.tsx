import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
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
});
