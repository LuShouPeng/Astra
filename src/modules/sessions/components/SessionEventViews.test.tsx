import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProviderCapability } from '../../../core/contracts/agents';
import type { CommandEvent, TestEvent } from '../../../core/contracts/sessions';
import { createDemoSnapshot } from '../../demo';
import { CommandsView, ContextView, TestsView } from './SessionEventViews';

describe('SessionEventViews', () => {
  it('renders useful empty states', () => {
    const { rerender } = render(<TestsView events={[]} />);
    expect(screen.getByText('No test events recorded.')).toBeVisible();
    rerender(<CommandsView events={[]} />);
    expect(screen.getByText('No command events recorded.')).toBeVisible();
  });

  it('renders failed and incomplete test and command metadata', () => {
    const tests: TestEvent[] = [
      {
        id: 'test-running',
        sessionId: 'session',
        type: 'test',
        timestamp: '2026-07-24T14:00:00.000Z',
        command: 'npm test',
        status: 'running',
        passed: 0,
        failed: 0,
      },
      {
        id: 'test-failed',
        sessionId: 'session',
        type: 'test',
        timestamp: '2026-07-24T14:01:00.000Z',
        command: 'npm run typecheck',
        status: 'failed',
        passed: 4,
        failed: 1,
        durationMs: 310,
      },
    ];
    const commands: CommandEvent[] = [
      {
        id: 'command-running',
        sessionId: 'session',
        type: 'command',
        timestamp: '2026-07-24T14:02:00.000Z',
        command: 'rg auth src',
        status: 'running',
      },
      {
        id: 'command-failed',
        sessionId: 'session',
        type: 'command',
        timestamp: '2026-07-24T14:03:00.000Z',
        command: 'npm run lint',
        status: 'failed',
        exitCode: 1,
        durationMs: 640,
        outputSummary: 'One lint error.',
      },
    ];

    const { rerender } = render(<TestsView events={tests} />);
    expect(screen.getByText('310 ms')).toBeVisible();
    expect(screen.getByText('Not recorded')).toBeVisible();
    rerender(<CommandsView events={commands} />);
    expect(screen.getByText('One lint error.')).toBeVisible();
    expect(screen.getByText('Exit code 1')).toBeVisible();
    expect(screen.getAllByText('Not recorded')).toHaveLength(2);
  });

  it('labels available, mock, and display-only provider context', () => {
    const snapshot = createDemoSnapshot();
    const session = snapshot.sessions[0];
    const project = snapshot.projects[0];
    const available: ProviderCapability = {
      provider: 'claude',
      label: 'Claude',
      runtimeAvailable: true,
      displayOnly: false,
    };
    const { rerender } = render(
      <ContextView
        session={{ ...session, summary: undefined }}
        project={undefined}
        capability={available}
      />,
    );
    expect(screen.getByText('Available')).toBeVisible();
    expect(screen.getByText('Unknown project')).toBeVisible();
    expect(screen.getByText('No summary recorded.')).toBeVisible();

    rerender(
      <ContextView
        session={session}
        project={project}
        capability={snapshot.providerCapabilities.claude}
      />,
    );
    expect(screen.getByText('Deterministic mock')).toBeVisible();
    const displayOnly: ProviderCapability = { ...snapshot.providerCapabilities.codex, displayOnly: true };
    rerender(
      <ContextView
        session={session}
        project={project}
        capability={displayOnly}
      />,
    );
    expect(screen.getByText('Display only')).toBeVisible();
  });
});
