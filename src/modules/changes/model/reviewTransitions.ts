import type { FileChangeId } from '../../../core/contracts/changes';
import type { SessionId, TimelineEvent } from '../../../core/contracts/sessions';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';

export type ReviewSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RequestChangesInput {
  sessionId: SessionId;
  fileChangeId: FileChangeId;
  feedback: string;
  severity: ReviewSeverity;
  rerunImmediately: boolean;
  timestamp: string;
}

function requireSession(snapshot: WorkbenchSnapshot, sessionId: SessionId) {
  const session = snapshot.sessions.find((candidate) => candidate.id === sessionId);
  if (!session) throw new Error('The review session could not be found.');
  return session;
}

function requireChange(snapshot: WorkbenchSnapshot, fileChangeId: FileChangeId) {
  const change = snapshot.fileChanges.find((candidate) => candidate.id === fileChangeId);
  if (!change) throw new Error('The changed file could not be found.');
  return change;
}

function resolveReviewAttention(snapshot: WorkbenchSnapshot, sessionId: SessionId) {
  return snapshot.attentionItems.map((item) =>
    item.sessionId === sessionId && item.type === 'review'
      ? { ...item, read: true, resolved: true }
      : item,
  );
}

export function nextReviewTimestamp(snapshot: WorkbenchSnapshot): string {
  const latest = [
    ...snapshot.sessions.map((session) => session.updatedAt),
    ...snapshot.timelineEvents.map((event) => event.timestamp),
    ...snapshot.attentionItems.map((item) => item.createdAt),
    ...snapshot.notifications.map((notification) => notification.createdAt),
  ]
    .sort()
    .at(-1);
  const next = new Date(latest ?? '2026-01-01T00:00:00.000Z');
  next.setUTCMinutes(next.getUTCMinutes() + 1);
  return next.toISOString();
}

export function markFileReviewed(
  snapshot: WorkbenchSnapshot,
  fileChangeId: FileChangeId,
): WorkbenchSnapshot {
  requireChange(snapshot, fileChangeId);
  return {
    ...snapshot,
    fileChanges: snapshot.fileChanges.map((change) =>
      change.id === fileChangeId ? { ...change, reviewStatus: 'reviewed' } : change,
    ),
  };
}

export function acceptSessionChanges(
  snapshot: WorkbenchSnapshot,
  sessionId: SessionId,
  timestamp: string,
): WorkbenchSnapshot {
  const session = requireSession(snapshot, sessionId);
  if (!snapshot.fileChanges.some((change) => change.sessionId === sessionId)) {
    throw new Error('This session has no changes to accept.');
  }
  const event: TimelineEvent = {
    id: `event-review-accepted-${timestamp}`,
    sessionId,
    type: 'user_message',
    timestamp,
    content: 'Accepted all changes.',
  };
  return {
    ...snapshot,
    sessions: snapshot.sessions.map((candidate) =>
      candidate.id === sessionId
        ? { ...candidate, currentAction: 'Changes accepted', updatedAt: timestamp }
        : candidate,
    ),
    fileChanges: snapshot.fileChanges.map((change) =>
      change.sessionId === sessionId ? { ...change, reviewStatus: 'accepted' } : change,
    ),
    timelineEvents: [...snapshot.timelineEvents, event],
    attentionItems: resolveReviewAttention(snapshot, session.id),
    notifications: snapshot.notifications.map((notification) =>
      notification.sessionId === sessionId ? { ...notification, read: true } : notification,
    ),
  };
}

export function requestSessionChanges(
  snapshot: WorkbenchSnapshot,
  input: RequestChangesInput,
): WorkbenchSnapshot {
  const feedback = input.feedback.trim();
  if (!feedback) throw new Error('Describe the requested changes.');
  const session = requireSession(snapshot, input.sessionId);
  const change = requireChange(snapshot, input.fileChangeId);
  if (change.sessionId !== input.sessionId) {
    throw new Error('The changed file does not belong to this session.');
  }
  const nextStatus = input.rerunImmediately ? 'running' : 'waiting';
  const currentAction = input.rerunImmediately
    ? 'Re-running with requested changes'
    : 'Waiting to rerun requested changes';
  const severity = input.severity[0].toUpperCase() + input.severity.slice(1);
  const events: TimelineEvent[] = [
    {
      id: `event-review-request-${input.timestamp}`,
      sessionId: input.sessionId,
      type: 'user_message',
      timestamp: input.timestamp,
      content: `[${severity}] ${feedback}`,
    },
    {
      id: `event-review-status-${input.timestamp}`,
      sessionId: input.sessionId,
      type: 'status',
      timestamp: input.timestamp,
      from: session.status,
      to: nextStatus,
      content: input.rerunImmediately
        ? 'Review changes requested; deterministic rerun started.'
        : 'Review changes requested; waiting to rerun.',
    },
  ];
  return {
    ...snapshot,
    sessions: snapshot.sessions.map((candidate) =>
      candidate.id === input.sessionId
        ? { ...candidate, status: nextStatus, currentAction, updatedAt: input.timestamp }
        : candidate,
    ),
    fileChanges: snapshot.fileChanges.map((candidate) =>
      candidate.id === input.fileChangeId
        ? { ...candidate, reviewStatus: 'changes_requested' }
        : candidate,
    ),
    timelineEvents: [...snapshot.timelineEvents, ...events],
    attentionItems: resolveReviewAttention(snapshot, input.sessionId),
    notifications: snapshot.notifications.map((notification) =>
      notification.sessionId === input.sessionId ? { ...notification, read: true } : notification,
    ),
  };
}
