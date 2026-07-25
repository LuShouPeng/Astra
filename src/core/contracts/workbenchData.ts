import type { AgentProvider, ProviderCapability } from './agents';
import type { AttentionItem } from './attention';
import type { FileChange } from './changes';
import type { DemoRuntimeState } from './demo';
import type { AppNotification, NotificationSettings } from './notifications';
import type { Project } from './projects';
import type { AgentSession, TimelineEvent } from './sessions';

export interface WorkbenchSnapshot {
  schemaVersion: 2;
  projects: Project[];
  sessions: AgentSession[];
  timelineEvents: TimelineEvent[];
  fileChanges: FileChange[];
  attentionItems: AttentionItem[];
  notifications: AppNotification[];
  notificationSettings: NotificationSettings;
  demo: DemoRuntimeState;
  providerCapabilities: Record<AgentProvider, ProviderCapability>;
}
