import type { AgentKind, AgentRunStatus } from './agents';
import type { WorkspaceId } from './workspace';

export interface TaskSession {
  id: string;
  workspaceId: WorkspaceId;
  title: string;
  agent: AgentKind;
  status: AgentRunStatus;
  createdAt: string;
  updatedAt: string;
}
