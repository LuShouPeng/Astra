import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../../demo';
import { resolveAttention } from './attentionTransitions';

describe('resolveAttention', () => {
  it('approves a pending request and resumes its session', () => {
    const snapshot = createDemoSnapshot();
    const next = resolveAttention(snapshot, 'attention-frontend-approval', 'approve');

    expect(next.attentionItems[0]).toMatchObject({ read: true, resolved: true });
    expect(next.sessions.find((session) => session.id === 'session-frontend-codex')).toMatchObject({
      status: 'running',
      currentAction: 'Approval granted; simulation resumed',
    });
    expect(next.timelineEvents.find((event) => event.type === 'approval')).toMatchObject({
      decision: 'approved',
    });
    expect(next.timelineEvents.at(-1)).toMatchObject({
      type: 'status',
      from: 'waiting',
      to: 'running',
    });
  });

  it('rejects approvals and retries failures with distinct terminal states', () => {
    const snapshot = createDemoSnapshot();
    const rejected = resolveAttention(snapshot, 'attention-frontend-approval', 'reject');
    expect(rejected.sessions.find((item) => item.id === 'session-frontend-codex')?.status).toBe(
      'stopped',
    );

    const retried = resolveAttention(snapshot, 'attention-frontend-failure', 'retry');
    expect(retried.sessions.find((item) => item.id === 'session-frontend-claude')?.status).toBe(
      'running',
    );
    expect(snapshot.attentionItems[1].resolved).toBe(false);
  });
});
