import { describe, expect, it } from 'vitest';
import { createPerformanceSnapshot } from './performanceFixtures';

describe('performance fixtures', () => {
  it('creates deterministic snapshots with 100 sessions and 500 events', () => {
    const first = createPerformanceSnapshot();
    const second = createPerformanceSnapshot();

    expect(first).toEqual(second);
    expect(first.sessions).toHaveLength(100);
    expect(first.timelineEvents).toHaveLength(500);
    expect(new Set(first.sessions.map((session) => session.id)).size).toBe(100);
    expect(new Set(first.timelineEvents.map((event) => event.id)).size).toBe(500);
  });
});
