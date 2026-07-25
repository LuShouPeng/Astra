import type { TimelineEvent } from '../../../core/contracts/sessions';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';

export class SessionTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionTransitionError';
  }
}

export function nextSessionTimestamp(snapshot: WorkbenchSnapshot): string {
  const latest = [
    ...snapshot.sessions.map((session) => session.updatedAt),
    ...snapshot.timelineEvents.map((event) => event.timestamp),
  ]
    .sort()
    .at(-1);
  return new Date(new Date(latest ?? '2026-07-24T00:00:00.000Z').getTime() + 60_000).toISOString();
}

export function applyFollowUp(
  snapshot: WorkbenchSnapshot,
  sessionId: string,
  content: string,
  timestamp: string,
): WorkbenchSnapshot {
  const message = content.trim();
  if (!message) throw new SessionTransitionError('Enter a follow-up message.');
  const session = snapshot.sessions.find((item) => item.id === sessionId);
  if (!session) throw new SessionTransitionError('The selected session does not exist.');
  if (snapshot.providerCapabilities[session.provider].displayOnly) {
    throw new SessionTransitionError('This provider is display-only in the prototype.');
  }

  const next = structuredClone(snapshot);
  const nextSession = next.sessions.find((item) => item.id === sessionId)!;
  const sequence = next.timelineEvents.filter((event) => event.sessionId === sessionId).length + 1;
  const newEvents: TimelineEvent[] = [
    {
      id: `event-${sessionId}-follow-up-${sequence}`,
      sessionId,
      type: 'user_message',
      timestamp,
      content: message,
    },
  ];
  if (nextSession.status !== 'running') {
    newEvents.push({
      id: `event-${sessionId}-status-${sequence + 1}`,
      sessionId,
      type: 'status',
      timestamp,
      from: nextSession.status,
      to: 'running',
      content: 'Session resumed for a follow-up request.',
    });
  }
  nextSession.status = 'running';
  nextSession.currentAction = 'Processing follow-up request';
  nextSession.updatedAt = timestamp;
  nextSession.completedAt = undefined;
  nextSession.unread = false;
  next.attentionItems.forEach((item) => {
    if (item.sessionId === sessionId && item.type === 'input' && !item.resolved) {
      item.read = true;
      item.resolved = true;
    }
  });
  next.notifications.forEach((notification) => {
    if (notification.sessionId === sessionId && notification.event === 'waiting_input') {
      notification.read = true;
    }
  });
  next.timelineEvents.push(...newEvents);
  return next;
}

export function stopSession(
  snapshot: WorkbenchSnapshot,
  sessionId: string,
  timestamp: string,
): WorkbenchSnapshot {
  const session = snapshot.sessions.find((item) => item.id === sessionId);
  if (!session) throw new SessionTransitionError('The selected session does not exist.');
  if (snapshot.providerCapabilities[session.provider].displayOnly) {
    throw new SessionTransitionError('This provider is display-only in the prototype.');
  }
  if (session.status !== 'running' && session.status !== 'waiting') {
    throw new SessionTransitionError('Only active Sessions can be stopped.');
  }

  const next = structuredClone(snapshot);
  const nextSession = next.sessions.find((item) => item.id === sessionId)!;
  const previousStatus = nextSession.status;
  nextSession.status = 'stopped';
  nextSession.currentAction = 'Stopped by user';
  nextSession.updatedAt = timestamp;
  nextSession.completedAt = timestamp;
  nextSession.unread = false;
  next.attentionItems.forEach((item) => {
    if (item.sessionId === sessionId && !item.resolved) {
      item.read = true;
      item.resolved = true;
    }
  });
  next.timelineEvents.push({
    id: `event-${sessionId}-stopped-${next.timelineEvents.length + 1}`,
    sessionId,
    type: 'status',
    timestamp,
    from: previousStatus,
    to: 'stopped',
    content: 'Session stopped in the local simulation.',
  });
  return next;
}
