import type { AgentSession, SessionStatus } from '../../../core/contracts/sessions';
import type { AttentionItem } from '../../../core/contracts/attention';
import type { TimelineEvent } from '../../../core/contracts/sessions';
import type { WorkbenchSnapshot } from '../../../core/contracts/workbenchData';

export interface ProjectMatrixRow {
  projectId: string;
  name: string;
  running: number;
  waiting: number;
  completed: number;
  failed: number;
  changedFiles: number;
}

export interface CommandCenterSummary {
  counts: Record<'running' | 'waiting' | 'completed' | 'failed', number>;
  openAttentionCount: number;
  activeSessions: AgentSession[];
  attentionPreview: AttentionItem[];
  projectMatrix: ProjectMatrixRow[];
  recentActivity: TimelineEvent[];
  sessionTotal: number;
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

  const sessionsByProject = new Map<string, AgentSession[]>();
  for (const session of snapshot.sessions) {
    const projectSessions = sessionsByProject.get(session.projectId) ?? [];
    projectSessions.push(session);
    sessionsByProject.set(session.projectId, projectSessions);
  }

  const priorityRank: Record<AttentionItem['priority'], number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  return {
    counts,
    openAttentionCount: snapshot.attentionItems.filter((item) => !item.resolved).length,
    activeSessions: snapshot.sessions
      .filter((session) => ['running', 'waiting', 'failed'].includes(session.status))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 6),
    attentionPreview: snapshot.attentionItems
      .filter((item) => !item.resolved)
      .sort(
        (left, right) =>
          priorityRank[right.priority] - priorityRank[left.priority] ||
          right.createdAt.localeCompare(left.createdAt),
      )
      .slice(0, 5),
    projectMatrix: [...snapshot.projects]
      .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))
      .map((project) => {
        const projectSessions = sessionsByProject.get(project.id) ?? [];
        return {
          projectId: project.id,
          name: project.name,
          running: projectSessions.filter((session) => session.status === 'running').length,
          waiting: projectSessions.filter((session) => session.status === 'waiting').length,
          completed: projectSessions.filter((session) => session.status === 'completed').length,
          failed: projectSessions.filter((session) => session.status === 'failed').length,
          changedFiles: projectSessions.reduce(
            (total, session) => total + session.changedFilesCount,
            0,
          ),
        };
      }),
    recentActivity: [...snapshot.timelineEvents]
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, 7),
    sessionTotal: snapshot.sessions.length,
  };
}
