import type { AgentOutputEvent, AgentRunStatus } from './agents';
import type { ActiveWorkspace, WorkspaceId } from './workspace';

export interface AppEventMap {
  'workspace:opened': ActiveWorkspace;
  'workspace:closed': { workspaceId: WorkspaceId };
  'agent:run-started': { runId: string; taskId: string };
  'agent:output': AgentOutputEvent;
  'agent:run-finished': {
    runId: string;
    taskId: string;
    status: Extract<AgentRunStatus, 'completed' | 'failed' | 'cancelled'>;
  };
  'session:selected': { sessionId: string; taskId: string };
  'changes:updated': { workspaceId: WorkspaceId; taskId?: string };
}
