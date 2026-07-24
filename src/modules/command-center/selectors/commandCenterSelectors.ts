import type { AgentSession, SessionStatus } from '../../../core/contracts/sessions';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';

export interface CommandCenterSummary {
  counts: Record<'running' | 'waiting' | 'completed' | 'failed', number>;
  openAttentionCount: number;
  recentSessions: AgentSession[];
}

const countedStatuses = [
  'running',
  'waiting',
  'completed',
  'failed',
] as const satisfies readonly SessionStatus[];

export function selectCommandCenterSummary(snapshot: WorkbenchSnapshot): CommandCenterSummary {
  const counts = Object.fromEntries(
    countedStatuses.map((status) => [status, 0]),
  ) as CommandCenterSummary['counts'];
  for (const session of snapshot.sessions) {
    if (session.status in counts) counts[session.status as keyof typeof counts] += 1;
  }

  return {
    counts,
    openAttentionCount: snapshot.attentionItems.filter((item) => !item.resolved).length,
    recentSessions: [...snapshot.sessions].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    ),
  };
}
