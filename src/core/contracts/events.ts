import type { AttentionItem } from './attention';
import type { ReviewStatus } from './changes';
import type { AppNotification } from './notifications';
import type { Project } from './projects';
import type { AgentSession, SessionStatus } from './sessions';
import type { ActiveWorkspace, WorkspaceId } from './workspace';

export interface AppEventMap {
  'workspace:opened': ActiveWorkspace;
  'workspace:closed': { workspaceId: WorkspaceId };
  'project:added': Project;
  'project:removed': { projectId: string };
  'session:selected': { projectId: string; sessionId: string };
  'session:status-changed': {
    session: AgentSession;
    previousStatus: SessionStatus;
  };
  'attention:created': AttentionItem;
  'attention:resolved': { attentionId: string; sessionId: string };
  'notification:created': AppNotification;
  'review:updated': { sessionId: string; fileChangeId: string; status: ReviewStatus };
  'demo:reset': { timestamp: string };
}
