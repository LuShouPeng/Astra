import { describe, expect, it } from 'vitest';
import { createDemoSnapshot } from '../../demo';
import { selectCommandCenterSummary } from './commandCenterSelectors';

describe('selectCommandCenterSummary', () => {
  it('derives bounded dashboard sections without owning source data', () => {
    const snapshot = createDemoSnapshot();

    const summary = selectCommandCenterSummary(snapshot);

    expect(summary.counts).toEqual({ running: 2, waiting: 1, completed: 2, failed: 1 });
    expect(summary.openAttentionCount).toBe(2);
    expect(summary.sessionTotal).toBe(6);
    expect(summary.activeSessions.map((session) => session.id)).toEqual([
      'session-backend-claude',
      'session-frontend-codex',
      'session-ai-gemini',
      'session-frontend-claude',
    ]);
    expect(summary.attentionPreview.map((item) => item.id)).toEqual([
      'attention-frontend-failure',
      'attention-frontend-approval',
    ]);
    expect(summary.projectMatrix).toEqual([
      expect.objectContaining({
        projectId: 'project-backend-api',
        running: 1,
        completed: 2,
        changedFiles: 7,
      }),
      expect.objectContaining({
        projectId: 'project-frontend',
        waiting: 1,
        failed: 1,
        changedFiles: 4,
      }),
      expect.objectContaining({
        projectId: 'project-ai-service',
        running: 1,
        changedFiles: 2,
      }),
    ]);
    expect(summary.recentActivity.map((event) => event.id)).toEqual([
      'event-approval-request',
      'event-test-running',
      'event-file-change',
      'event-search-command',
      'event-session-running',
      'event-agent-analysis',
      'event-task-created',
    ]);
  });

  it('ignores non-dashboard statuses and resolved attention', () => {
    const snapshot = createDemoSnapshot();
    snapshot.sessions[0].status = 'idle';
    snapshot.attentionItems[0].resolved = true;

    const summary = selectCommandCenterSummary(snapshot);

    expect(summary.counts.running).toBe(1);
    expect(summary.openAttentionCount).toBe(1);
    expect(summary.attentionPreview).toHaveLength(1);
  });

  it('bounds dense dashboard collections for performance fixtures', () => {
    const snapshot = createDemoSnapshot();
    snapshot.sessions = Array.from({ length: 12 }, (_, index) => ({
      ...snapshot.sessions[0],
      id: `session-${index}`,
      updatedAt: `2026-07-24T15:${String(index).padStart(2, '0')}:00.000Z`,
    }));
    snapshot.attentionItems = Array.from({ length: 8 }, (_, index) => ({
      ...snapshot.attentionItems[0],
      id: `attention-${index}`,
      sessionId: `session-${index}`,
      createdAt: `2026-07-24T15:${String(index).padStart(2, '0')}:00.000Z`,
    }));

    const summary = selectCommandCenterSummary(snapshot);

    expect(summary.activeSessions).toHaveLength(6);
    expect(summary.attentionPreview).toHaveLength(5);
  });
});
