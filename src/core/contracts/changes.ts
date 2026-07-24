import type { WorkspaceId } from './workspace';

export interface ChangedFile {
  workspaceId: WorkspaceId;
  taskId?: string;
  relativePath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions?: number;
  deletions?: number;
}
