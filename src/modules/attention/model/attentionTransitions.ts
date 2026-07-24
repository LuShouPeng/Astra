import type { AttentionItem } from '../../../core/contracts/attention';
import type { SessionStatus, StatusEvent } from '../../../core/contracts/sessions';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';
import { nextSessionTimestamp } from '../../sessions';

export type AttentionAction = 'approve' | 'reject' | 'retry' | 'dismiss';

export class AttentionTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttentionTransitionError';
  }
}

export function markAttentionRead(
  snapshot: WorkbenchSnapshot,
  attentionId: string,
): WorkbenchSnapshot {
  const item = snapshot.attentionItems.find((candidate) => candidate.id === attentionId);
  if (!item || item.resolved) {
    throw new AttentionTransitionError('The selected attention item is no longer available.');
  }
  return {
    ...snapshot,
    attentionItems: snapshot.attentionItems.map((candidate) =>
      candidate.id === attentionId ? { ...candidate, read: true } : candidate,
    ),
  };
}

function targetStatus(item: AttentionItem, action: AttentionAction): SessionStatus | null {
  if (item.type === 'approval' && action === 'approve') return 'running';
  if (item.type === 'approval' && action === 'reject') return 'stopped';
  if (item.type === 'failure' && action === 'retry') return 'running';
  if (action === 'dismiss') return null;
  throw new AttentionTransitionError('This action is not valid for the selected item.');
}

export function resolveAttention(
  snapshot: WorkbenchSnapshot,
  attentionId: string,
  action: AttentionAction,
): WorkbenchSnapshot {
  const next = structuredClone(snapshot);
  const item = next.attentionItems.find((candidate) => candidate.id === attentionId);
  if (!item || item.resolved) {
    throw new AttentionTransitionError('The selected attention item is no longer available.');
  }
  const session = next.sessions.find((candidate) => candidate.id === item.sessionId);
  if (!session) throw new AttentionTransitionError('The related session does not exist.');
  const status = targetStatus(item, action);
  const previousStatus = session.status;
  const timestamp = nextSessionTimestamp(next);

  item.read = true;
  item.resolved = true;
  next.notifications.forEach((notification) => {
    if (notification.sessionId === session.id) notification.read = true;
  });

  if (item.type === 'approval' && (action === 'approve' || action === 'reject')) {
    const approval = next.timelineEvents.find(
      (event) => event.sessionId === session.id && event.type === 'approval',
    );
    if (approval?.type === 'approval') {
      approval.decision = action === 'approve' ? 'approved' : 'rejected';
    }
  }

  if (status) {
    session.status = status;
    session.updatedAt = timestamp;
    session.currentAction =
      action === 'approve'
        ? 'Approval granted; simulation resumed'
        : action === 'retry'
          ? 'Retrying deterministic simulation'
          : 'Approval rejected; simulation stopped';
    const event: StatusEvent = {
      id: `event-${session.id}-attention-${attentionId}`,
      sessionId: session.id,
      type: 'status',
      timestamp,
      from: previousStatus,
      to: status,
      content: session.currentAction,
    };
    next.timelineEvents.push(event);
  }
  return next;
}
