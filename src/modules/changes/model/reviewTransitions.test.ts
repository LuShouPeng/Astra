import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../../demo';
import {
  acceptSessionChanges,
  markFileReviewed,
  nextReviewTimestamp,
  requestSessionChanges,
} from './reviewTransitions';

describe('review transitions', () => {
  it('marks one file reviewed without changing its session', () => {
    const snapshot = createDemoSnapshot();
    const next = markFileReviewed(snapshot, 'change-session-timeout');

    expect(next.fileChanges.find((change) => change.id === 'change-session-timeout')).toMatchObject(
      {
        reviewStatus: 'reviewed',
      },
    );
    expect(next.sessions).toEqual(snapshot.sessions);
  });

  it('accepts every change in a session and records the decision', () => {
    const snapshot = createDemoSnapshot();
    const timestamp = '2026-07-24T14:21:00.000Z';
    const next = acceptSessionChanges(snapshot, 'session-backend-claude', timestamp);

    expect(
      next.fileChanges
        .filter((change) => change.sessionId === 'session-backend-claude')
        .every((change) => change.reviewStatus === 'accepted'),
    ).toBe(true);
    expect(next.sessions.find((session) => session.id === 'session-backend-claude')).toMatchObject({
      currentAction: 'Changes accepted',
      updatedAt: timestamp,
    });
    expect(next.timelineEvents.at(-1)).toMatchObject({
      type: 'user_message',
      content: 'Accepted all changes.',
      timestamp,
    });
  });

  it('requires feedback and records a rerun request in the session timeline', () => {
    const snapshot = createDemoSnapshot();
    expect(() =>
      requestSessionChanges(snapshot, {
        sessionId: 'session-backend-claude',
        fileChangeId: 'change-session-timeout',
        feedback: '   ',
        severity: 'high',
        rerunImmediately: true,
        timestamp: '2026-07-24T14:21:00.000Z',
      }),
    ).toThrow('Describe the requested changes.');

    const completed = {
      ...snapshot,
      sessions: snapshot.sessions.map((session) =>
        session.id === 'session-backend-claude'
          ? { ...session, status: 'completed' as const }
          : session,
      ),
    };
    const timestamp = '2026-07-24T14:21:00.000Z';
    const next = requestSessionChanges(completed, {
      sessionId: 'session-backend-claude',
      fileChangeId: 'change-session-timeout',
      feedback: 'Cover the refresh-token boundary.',
      severity: 'high',
      rerunImmediately: true,
      timestamp,
    });

    expect(next.fileChanges.find((change) => change.id === 'change-session-timeout')).toMatchObject(
      {
        reviewStatus: 'changes_requested',
      },
    );
    expect(next.sessions.find((session) => session.id === 'session-backend-claude')).toMatchObject({
      status: 'running',
      currentAction: 'Re-running with requested changes',
      updatedAt: timestamp,
    });
    expect(next.timelineEvents.slice(-2)).toMatchObject([
      {
        type: 'user_message',
        content: '[High] Cover the refresh-token boundary.',
      },
      {
        type: 'status',
        from: 'completed',
        to: 'running',
      },
    ]);
  });

  it('moves the session to waiting when immediate rerun is disabled', () => {
    const snapshot = createDemoSnapshot();
    const next = requestSessionChanges(snapshot, {
      sessionId: 'session-backend-claude',
      fileChangeId: 'change-session-timeout',
      feedback: 'Keep the public API unchanged.',
      severity: 'medium',
      rerunImmediately: false,
      timestamp: '2026-07-24T14:21:00.000Z',
    });

    expect(next.sessions.find((session) => session.id === 'session-backend-claude')).toMatchObject({
      status: 'waiting',
      currentAction: 'Waiting to rerun requested changes',
    });
  });

  it('rejects missing and cross-session review targets', () => {
    const snapshot = createDemoSnapshot();

    expect(() => markFileReviewed(snapshot, 'missing-change')).toThrow(
      'The changed file could not be found.',
    );
    expect(() =>
      acceptSessionChanges(snapshot, 'missing-session', '2026-07-24T14:21:00.000Z'),
    ).toThrow('The review session could not be found.');
    expect(() =>
      acceptSessionChanges(snapshot, 'session-backend-codex', '2026-07-24T14:21:00.000Z'),
    ).toThrow('This session has no changes to accept.');
    expect(() =>
      requestSessionChanges(snapshot, {
        sessionId: 'session-backend-codex',
        fileChangeId: 'change-session-timeout',
        feedback: 'Add coverage.',
        severity: 'low',
        rerunImmediately: true,
        timestamp: '2026-07-24T14:21:00.000Z',
      }),
    ).toThrow('The changed file does not belong to this session.');
  });

  it('advances the deterministic review clock from an empty snapshot', () => {
    const snapshot = createDemoSnapshot();
    const empty = {
      ...snapshot,
      sessions: [],
      timelineEvents: [],
      attentionItems: [],
      notifications: [],
    };

    expect(nextReviewTimestamp(empty)).toBe('2026-01-01T00:01:00.000Z');
  });
});
