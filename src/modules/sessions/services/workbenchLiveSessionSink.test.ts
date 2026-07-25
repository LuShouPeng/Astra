import { describe, expect, it, vi } from 'vitest';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';
import type { AgentSession, TimelineEvent } from '../../../core/contracts/sessions';
import type { SnapshotMutator } from '../../../core/state/WorkbenchContext';
import { createWorkbenchLiveSessionSink } from './workbenchLiveSessionSink';

function baseSnapshot(): WorkbenchSnapshot {
  return {
    schemaVersion: 1,
    projects: [],
    sessions: [],
    timelineEvents: [],
    fileChanges: [],
    attentionItems: [],
    notifications: [],
    notificationSettings: {} as WorkbenchSnapshot['notificationSettings'],
    demo: {} as WorkbenchSnapshot['demo'],
    providerCapabilities: {} as WorkbenchSnapshot['providerCapabilities'],
  };
}

function liveSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'live-1',
    projectId: 'proj-1',
    provider: 'claude',
    title: 'Live run',
    status: 'running',
    startedAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    changedFilesCount: 0,
    testStatus: 'not_run',
    unread: false,
    origin: 'live',
    ...overrides,
  };
}

/** 捕获 updateSnapshot：立即对给定快照跑 mutator，返回结果与 persist 标志。 */
function harness(initial: WorkbenchSnapshot) {
  let current = initial;
  const persistFlags: boolean[] = [];
  const updateSnapshot = vi.fn((mutate: SnapshotMutator, options?: { persist?: boolean }) => {
    current = mutate(current);
    persistFlags.push(options?.persist ?? false);
  });
  const sink = createWorkbenchLiveSessionSink(updateSnapshot);
  return { sink, persistFlags, snapshot: () => current };
}

describe('createWorkbenchLiveSessionSink', () => {
  it('prepends a created session and forwards persist flag', () => {
    const { sink, snapshot, persistFlags } = harness(baseSnapshot());
    const session = liveSession();

    sink.apply({ kind: 'session-created', session }, { persist: true });

    expect(snapshot().sessions).toEqual([session]);
    expect(persistFlags).toEqual([true]);
  });

  it('replaces an existing session on re-create instead of duplicating', () => {
    const { sink, snapshot } = harness({ ...baseSnapshot(), sessions: [liveSession()] });

    sink.apply(
      { kind: 'session-created', session: liveSession({ status: 'completed' }) },
      { persist: true },
    );

    expect(snapshot().sessions).toHaveLength(1);
    expect(snapshot().sessions[0].status).toBe('completed');
  });

  it('appends timeline events as memory-only when persist is false', () => {
    const { sink, snapshot, persistFlags } = harness(baseSnapshot());
    const event: TimelineEvent = {
      id: 'evt-1',
      sessionId: 'live-1',
      timestamp: '2026-07-25T00:00:01.000Z',
      type: 'agent_message',
      content: 'hello',
    };

    sink.apply({ kind: 'timeline-event', event }, { persist: false });

    expect(snapshot().timelineEvents).toEqual([event]);
    expect(persistFlags).toEqual([false]);
  });

  it('dedupes timeline events by id', () => {
    const event: TimelineEvent = {
      id: 'evt-1',
      sessionId: 'live-1',
      timestamp: '2026-07-25T00:00:01.000Z',
      type: 'agent_message',
      content: 'first',
    };
    const { sink, snapshot } = harness({ ...baseSnapshot(), timelineEvents: [event] });

    sink.apply(
      { kind: 'timeline-event', event: { ...event, content: 'updated' } },
      { persist: false },
    );

    expect(snapshot().timelineEvents).toHaveLength(1);
    expect((snapshot().timelineEvents[0] as { content: string }).content).toBe('updated');
  });

  it('patches status, currentAction and completedAt on the target session only', () => {
    const { sink, snapshot } = harness({
      ...baseSnapshot(),
      sessions: [liveSession({ id: 'live-1' }), liveSession({ id: 'live-2' })],
    });

    sink.apply(
      {
        kind: 'session-status',
        sessionId: 'live-1',
        status: 'completed',
        currentAction: undefined,
        completedAt: '2026-07-25T00:05:00.000Z',
      },
      { persist: true },
    );

    const [first, second] = snapshot().sessions;
    expect(first.status).toBe('completed');
    expect(first.completedAt).toBe('2026-07-25T00:05:00.000Z');
    expect(first.updatedAt).toBe('2026-07-25T00:05:00.000Z');
    expect(second.status).toBe('running');
  });
});
