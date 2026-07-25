import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';
import type { AgentSession, TimelineEvent } from '../../../core/contracts/sessions';
import type { SnapshotMutator } from '../../../core/state/WorkbenchContext';
import type { LiveSessionSink, LiveSessionUpdate } from './liveSessionService';

/**
 * 把 WorkbenchContext.updateSnapshot 适配成 liveSessionService 期望的 sink。
 * 三类更新映射到快照的不可变改写：
 *  - session-created：追加/替换 sessions 条目
 *  - timeline-event：追加时间线事件
 *  - session-status：就地 patch 目标 session 的状态字段并同步 updatedAt
 *
 * persist 语义原样透传给 updateSnapshot：关键节点落盘，高频事件仅进内存 [C2]。
 */
export function createWorkbenchLiveSessionSink(
  updateSnapshot: (mutate: SnapshotMutator, options?: { persist?: boolean }) => void,
): LiveSessionSink {
  return {
    apply(update: LiveSessionUpdate, options: { persist: boolean }): void {
      updateSnapshot((snapshot) => mutate(snapshot, update), { persist: options.persist });
    },
  };
}

function mutate(snapshot: WorkbenchSnapshot, update: LiveSessionUpdate): WorkbenchSnapshot {
  switch (update.kind) {
    case 'session-created':
      return { ...snapshot, sessions: upsertSession(snapshot.sessions, update.session) };
    case 'timeline-event':
      return { ...snapshot, timelineEvents: appendEvent(snapshot.timelineEvents, update.event) };
    case 'session-status':
      return {
        ...snapshot,
        sessions: snapshot.sessions.map((session) =>
          session.id === update.sessionId
            ? {
                ...session,
                status: update.status,
                currentAction: update.currentAction,
                completedAt: update.completedAt ?? session.completedAt,
                updatedAt: update.completedAt ?? session.updatedAt,
              }
            : session,
        ),
      };
  }
}

function upsertSession(sessions: AgentSession[], session: AgentSession): AgentSession[] {
  const exists = sessions.some((item) => item.id === session.id);
  return exists
    ? sessions.map((item) => (item.id === session.id ? session : item))
    : [session, ...sessions];
}

function appendEvent(events: TimelineEvent[], event: TimelineEvent): TimelineEvent[] {
  // 同 id 去重（重放 / 重复投递保护），否则追加到末尾。
  return events.some((item) => item.id === event.id)
    ? events.map((item) => (item.id === event.id ? event : item))
    : [...events, event];
}
