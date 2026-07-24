import type { ProjectId } from './projects';
import type { SessionId } from './sessions';

export type NotificationId = string;
export type NotificationTone = 'info' | 'success' | 'warning' | 'error';
export type NotificationEvent =
  | 'agent_started'
  | 'waiting_input'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'test_failed'
  | 'review_requested';

export interface NotificationTarget {
  page: 'session' | 'changes' | 'attention' | 'project';
  projectId?: ProjectId;
  sessionId?: SessionId;
}

export interface AppNotification {
  id: NotificationId;
  sessionId?: SessionId;
  projectId?: ProjectId;
  event: NotificationEvent;
  tone: NotificationTone;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
  target?: NotificationTarget;
}

export interface NotificationSettings {
  desktopEnabled: boolean;
  notifyOnWaiting: boolean;
  notifyOnCompleted: boolean;
  notifyOnFailed: boolean;
}
