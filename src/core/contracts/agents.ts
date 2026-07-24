import type { ActiveWorkspace } from './workspace';

export type AgentKind = 'claude-code' | 'codex-cli' | 'gemini-cli';

export type AgentRunStatus =
  'idle' | 'starting' | 'running' | 'waiting-user' | 'completed' | 'failed' | 'cancelled';

export interface AgentRunRequest {
  workspace: ActiveWorkspace;
  agent: AgentKind;
  prompt: string;
  taskId: string;
}

export interface AgentOutputEvent {
  runId: string;
  taskId: string;
  kind: 'stdout' | 'stderr' | 'status';
  content: string;
  timestamp: string;
}

export interface AgentAdapter {
  isAvailable(): Promise<boolean>;
  start(req: AgentRunRequest): Promise<{ runId: string }>;
  cancel(runId: string): Promise<void>;
  subscribe(listener: (event: AgentOutputEvent) => void): () => void;
}
