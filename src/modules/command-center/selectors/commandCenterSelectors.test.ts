import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../../demo';
import { selectCommandCenterSummary } from './commandCenterSelectors';

describe('selectCommandCenterSummary', () => {
  it('derives status counts and recent sessions without owning source data', () => {
    const snapshot = createDemoSnapshot();

    const summary = selectCommandCenterSummary(snapshot);

    expect(summary.counts).toEqual({ running: 2, waiting: 1, completed: 2, failed: 1 });
    expect(summary.openAttentionCount).toBe(2);
    expect(summary.recentSessions.map((session) => session.id)).toEqual([
      'session-backend-claude',
      'session-frontend-codex',
      'session-ai-gemini',
      'session-frontend-claude',
      'session-backend-codex',
      'session-backend-gemini',
    ]);
  });

  it('ignores non-dashboard statuses and resolved attention', () => {
    const snapshot = createDemoSnapshot();
    snapshot.sessions[0].status = 'idle';
    snapshot.attentionItems[0].resolved = true;

    const summary = selectCommandCenterSummary(snapshot);

    expect(summary.counts.running).toBe(1);
    expect(summary.openAttentionCount).toBe(1);
  });
});
