import type { AgentProvider } from './agents';
import type { ProjectId } from './projects';

export type SessionId = string;
export type SessionStatus = 'idle' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopped';
export type TestStatus = 'not_run' | 'running' | 'passed' | 'failed';

/**
 * 会话来源。省略时按 'demo' 处理——既有持久化数据与 mock fixtures
 * 均无此字段，语义上就是确定性演示会话；真实运行会话必须显式标 'live'。
 */
export type SessionOrigin = 'demo' | 'live';

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
  /** 缺省视为 'demo'（向后兼容旧快照）。 */
  origin?: SessionOrigin;
  /** 后端进程 key（约定 = sessionId），仅 live 会话有。 */
  runtimeProcessId?: string;
  /** 真实工作目录（= 关联本地项目根），仅 live 会话有。 */
  workingDirectory?: string;
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
