import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../../demo';
import { applyFollowUp, SessionTransitionError, stopSession } from './sessionTransitions';

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
    snapshot.providerCapabilities.codex.displayOnly = true;
    expect(() => applyFollowUp(snapshot, 'session-backend-claude', '   ', 'now')).toThrow(
      SessionTransitionError,
    );
    expect(() => applyFollowUp(snapshot, 'session-backend-codex', 'Continue', 'now')).toThrow(
      'display-only',
    );
  });

  it('resolves a related input request when the user replies', () => {
    const snapshot = createDemoSnapshot();
    snapshot.attentionItems.push({
      id: 'attention-input',
      sessionId: 'session-backend-claude',
      projectId: 'project-backend-api',
      type: 'input',
      priority: 'medium',
      title: 'Input required',
      description: 'Clarify the timeout behavior.',
      createdAt: '2026-07-24T14:20:00.000Z',
      read: false,
      resolved: false,
    });

    const next = applyFollowUp(
      snapshot,
      'session-backend-claude',
      'Keep the current public API.',
      '2026-07-24T15:00:00.000Z',
    );

    expect(next.attentionItems.at(-1)).toMatchObject({ read: true, resolved: true });
  });
});

describe('stopSession', () => {
  it('stops an active deterministic session and records the transition', () => {
    const snapshot = createDemoSnapshot();
    const next = stopSession(snapshot, 'session-backend-claude', '2026-07-24T15:00:00.000Z');

    expect(next.sessions.find((session) => session.id === 'session-backend-claude')).toMatchObject({
      status: 'stopped',
      currentAction: 'Stopped by user',
      updatedAt: '2026-07-24T15:00:00.000Z',
    });
    expect(next.timelineEvents.at(-1)).toMatchObject({
      type: 'status',
      from: 'running',
      to: 'stopped',
      content: 'Session stopped in the local simulation.',
    });
    expect(snapshot.sessions[0].status).toBe('running');
  });

  it('rejects completed, display-only, and missing sessions', () => {
    const snapshot = createDemoSnapshot();
    snapshot.providerCapabilities.claude.displayOnly = true;
    expect(() => stopSession(snapshot, 'session-backend-codex', 'now')).toThrow(
      'Only active Sessions can be stopped.',
    );
    expect(() => stopSession(snapshot, 'session-ai-claude', 'now')).toThrow('display-only');
    expect(() => stopSession(snapshot, 'missing', 'now')).toThrow('does not exist');
  });
});
