import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../../demo';
import { applyFollowUp, SessionTransitionError } from './sessionTransitions';

describe('applyFollowUp', () => {
  it('records a trimmed message and resumes a non-running session deterministically', () => {
    const snapshot = createDemoSnapshot();
    const next = applyFollowUp(
      snapshot,
      'session-backend-codex',
      '  Add an edge-case test.  ',
      '2026-07-24T15:00:00.000Z',
    );

    expect(next.sessions.find((session) => session.id === 'session-backend-codex')).toMatchObject({
      status: 'running',
      currentAction: 'Processing follow-up request',
      updatedAt: '2026-07-24T15:00:00.000Z',
    });
    expect(next.timelineEvents.slice(-2)).toMatchObject([
      { type: 'user_message', content: 'Add an edge-case test.' },
      { type: 'status', from: 'completed', to: 'running' },
    ]);
    expect(snapshot.sessions[1].status).toBe('completed');
  });

  it('rejects blank follow-ups and display-only providers', () => {
    const snapshot = createDemoSnapshot();
    expect(() => applyFollowUp(snapshot, 'session-backend-claude', '   ', 'now')).toThrow(
      SessionTransitionError,
    );
    expect(() => applyFollowUp(snapshot, 'session-backend-gemini', 'Continue', 'now')).toThrow(
      'display-only',
    );
  });
});
