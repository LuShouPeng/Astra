import type { AgentProvider } from './agents';
import type { ProjectId } from './projects';

export type WorkflowId = string;
export type WorkflowNodeId = string;
export type WorkflowRunId = string;
export type WorkflowNodeType = 'agent' | 'mcp_tool' | 'approval' | 'condition' | 'join';
export type WorkflowRunStatus =
  'draft' | 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type NodeRunStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting_approval'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'interrupted';

export interface WorkflowPosition {
  x: number;
  y: number;
}

interface WorkflowNodeBase {
  id: WorkflowNodeId;
  type: WorkflowNodeType;
  name: string;
  position: WorkflowPosition;
  timeoutSeconds?: number;
  retries?: number;
}

export interface AgentWorkflowNode extends WorkflowNodeBase {
  type: 'agent';
  provider: AgentProvider | 'auto';
  prompt: string;
  skillIds: string[];
  mcpServerIds: string[];
}

export interface McpToolWorkflowNode extends WorkflowNodeBase {
  type: 'mcp_tool';
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ApprovalWorkflowNode extends WorkflowNodeBase {
  type: 'approval';
  risk: 'low' | 'medium' | 'high';
  instructions: string;
}

export interface ConditionWorkflowNode extends WorkflowNodeBase {
  type: 'condition';
  expression: string;
}

export interface JoinWorkflowNode extends WorkflowNodeBase {
  type: 'join';
  strategy: 'all' | 'any';
}

export type WorkflowNode =
  | AgentWorkflowNode
  | McpToolWorkflowNode
  | ApprovalWorkflowNode
  | ConditionWorkflowNode
  | JoinWorkflowNode;

export interface WorkflowEdge {
  id: string;
  source: WorkflowNodeId;
  target: WorkflowNodeId;
  outcome?: 'true' | 'false' | 'success';
}

export interface WorkflowSettings {
  maxConcurrency: number;
  defaultTimeoutSeconds: number;
  defaultRetries: number;
}

export interface WorkflowDefinition {
  id: WorkflowId;
  name: string;
  description?: string;
  version: number;
  projectId: ProjectId;
  createdAt: string;
  updatedAt: string;
  settings: WorkflowSettings;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowRun {
  id: WorkflowRunId;
  workflowId: WorkflowId;
  workflowVersion: number;
  projectId: ProjectId;
  status: WorkflowRunStatus;
  integrationBranch?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface NodeRun {
  id: string;
  runId: WorkflowRunId;
  nodeId: WorkflowNodeId;
  status: NodeRunStatus;
  attempt: number;
  provider?: AgentProvider;
  externalSessionId?: string;
  worktreePath?: string;
  startedAt?: string;
  completedAt?: string;
  output?: Record<string, unknown>;
  error?: string;
}

export interface ApprovalRequest {
  id: string;
  runId: WorkflowRunId;
  nodeRunId: string;
  capability: 'write' | 'execute' | 'network' | 'install' | 'worktree' | 'integrate' | 'merge';
  risk: 'low' | 'medium' | 'high';
  summary: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt?: string;
}
