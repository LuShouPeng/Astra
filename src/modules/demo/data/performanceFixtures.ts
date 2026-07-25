import type { AgentSession, TimelineEvent } from '../../../core/contracts/sessions';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';
import { createDemoSnapshot } from './demoFixtures';

export function createPerformanceSnapshot(): WorkbenchSnapshot {
  const snapshot = createDemoSnapshot();
  const extraSessions: AgentSession[] = Array.from({ length: 94 }, (_, index) => {
    const template = snapshot.sessions[index % snapshot.sessions.length];
    const sequence = index + 7;
    return {
      ...template,
      id: `session-performance-${sequence.toString().padStart(3, '0')}`,
      title: `Performance fixture session ${sequence}`,
      updatedAt: new Date(Date.UTC(2026, 6, 24, 15, sequence)).toISOString(),
      unread: false,
    };
  });
  const extraEvents: TimelineEvent[] = Array.from({ length: 493 }, (_, index) => ({
    id: `event-performance-${(index + 8).toString().padStart(3, '0')}`,
    sessionId: 'session-backend-claude',
    type: 'agent_message',
    timestamp: new Date(Date.UTC(2026, 6, 25, 0, index)).toISOString(),
    content: `Deterministic performance event ${index + 8}`,
  }));
  return {
    ...snapshot,
    sessions: [...snapshot.sessions, ...extraSessions],
    timelineEvents: [...snapshot.timelineEvents, ...extraEvents],
  };
}
