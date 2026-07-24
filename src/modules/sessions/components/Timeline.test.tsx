import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '../../../core/contracts/sessions';
import { Timeline } from './Timeline';

const events: TimelineEvent[] = [
  {
    id: '1',
    sessionId: 's',
    type: 'user_message',
    timestamp: '2026-01-01T00:00:00Z',
    content: 'User request',
  },
  {
    id: '2',
    sessionId: 's',
    type: 'agent_message',
    timestamp: '2026-01-01T00:01:00Z',
    content: 'Agent response',
  },
  {
    id: '3',
    sessionId: 's',
    type: 'command',
    timestamp: '2026-01-01T00:02:00Z',
    command: 'npm test',
    status: 'passed',
    exitCode: 0,
    outputSummary: '12 passed',
  },
  {
    id: '4',
    sessionId: 's',
    type: 'file_change',
    timestamp: '2026-01-01T00:03:00Z',
    fileChangeId: 'f',
    content: 'Updated a file',
  },
  {
    id: '5',
    sessionId: 's',
    type: 'test',
    timestamp: '2026-01-01T00:04:00Z',
    command: 'vitest',
    status: 'failed',
    passed: 4,
    failed: 1,
  },
  {
    id: '6',
    sessionId: 's',
    type: 'approval',
    timestamp: '2026-01-01T00:05:00Z',
    request: 'Install dependency',
    risk: 'medium',
    decision: 'pending',
  },
  {
    id: '7',
    sessionId: 's',
    type: 'status',
    timestamp: '2026-01-01T00:06:00Z',
    from: 'idle',
    to: 'running',
    content: 'Session started',
  },
];

describe('Timeline', () => {
  it('renders all seven event variants in chronological order', () => {
    render(<Timeline events={[...events].reverse()} />);

    expect(screen.getAllByRole('article')).toHaveLength(7);
    expect(screen.getByText('User request')).toBeVisible();
    expect(screen.getByText('Agent response')).toBeVisible();
    expect(screen.getByText('npm test')).toBeVisible();
    expect(screen.getByText('Updated a file')).toBeVisible();
    expect(screen.getByText('4 passed, 1 failed')).toBeVisible();
    expect(screen.getByText('Install dependency')).toBeVisible();
    expect(screen.getByText('idle to running')).toBeVisible();
  });

  it('bounds large timelines and reveals older batches on demand', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    const manyEvents = Array.from({ length: 500 }, (_, index): TimelineEvent => ({
      id: `event-${index}`,
      sessionId: 's',
      type: 'agent_message',
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      content: `Event ${index}`,
    }));

    render(<Timeline events={manyEvents} />);
    expect(screen.getAllByRole('article')).toHaveLength(100);
    expect(screen.getByText('Event 499')).toBeVisible();
    expect(screen.queryByText('Event 0')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show 100 earlier events' }));
    expect(screen.getAllByRole('article')).toHaveLength(200);
  });
});
