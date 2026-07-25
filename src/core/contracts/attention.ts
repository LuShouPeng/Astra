import type { ProjectId } from './projects';
import type { SessionId } from './sessions';

export type AttentionId = string;
export type AttentionType = 'approval' | 'input' | 'review' | 'failure' | 'completed';
export type AttentionPriority = 'low' | 'medium' | 'high' | 'critical';

export interface AttentionItem {
  id: AttentionId;
  sessionId: SessionId;
  projectId: ProjectId;
  type: AttentionType;
  priority: AttentionPriority;
  title: string;
  description: string;
  createdAt: string;
  read: boolean;
  resolved: boolean;
}
