import type { AgentProvider } from './agents';
import type { ProjectId } from './projects';

export type SessionId = string;
export type SessionStatus = 'idle' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopped';
export type TestStatus = 'not_run' | 'running' | 'passed' | 'failed';

export interface AgentSession {
  id: SessionId;
  projectId: ProjectId;
  provider: AgentProvider;
  title: string;
  summary?: string;
  status: SessionStatus;
  currentAction?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  changedFilesCount: number;
  testStatus: TestStatus;
  unread: boolean;
  source: 'demo' | 'runtime';
  workflowRunId?: string;
  workflowNodeId?: string;
  externalSessionId?: string;
}

interface TimelineEventBase {
  id: string;
  sessionId: SessionId;
  timestamp: string;
}

export interface UserMessageEvent extends TimelineEventBase {
  type: 'user_message';
  content: string;
}

export interface AgentMessageEvent extends TimelineEventBase {
  type: 'agent_message';
  content: string;
}

export interface CommandEvent extends TimelineEventBase {
  type: 'command';
  command: string;
  status: 'running' | 'passed' | 'failed';
  exitCode?: number;
  durationMs?: number;
  outputSummary?: string;
}

export interface FileChangeEvent extends TimelineEventBase {
  type: 'file_change';
  fileChangeId: string;
  content: string;
}

export interface TestEvent extends TimelineEventBase {
  type: 'test';
  command: string;
  status: 'running' | 'passed' | 'failed';
  passed: number;
  failed: number;
  durationMs?: number;
}

export interface ApprovalEvent extends TimelineEventBase {
  type: 'approval';
  request: string;
  risk: 'low' | 'medium' | 'high';
  decision: 'pending' | 'approved' | 'rejected';
}

export interface StatusEvent extends TimelineEventBase {
  type: 'status';
  from: SessionStatus;
  to: SessionStatus;
  content: string;
}

export type TimelineEvent =
  | UserMessageEvent
  | AgentMessageEvent
  | CommandEvent
  | FileChangeEvent
  | TestEvent
  | ApprovalEvent
  | StatusEvent;

export type TimelineEventType = TimelineEvent['type'];
