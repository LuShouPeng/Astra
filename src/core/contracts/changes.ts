import type { SessionId } from './sessions';

export type FileChangeId = string;
export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';
export type ReviewStatus = 'unreviewed' | 'reviewed' | 'accepted' | 'changes_requested';

export interface FileChange {
  id: FileChangeId;
  sessionId: SessionId;
  relativePath: string;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  oldContent?: string;
  newContent?: string;
  diff?: string;
  binary: boolean;
  reviewStatus: ReviewStatus;
}

export interface GitFileChangeReadModel {
  relativePath: string;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface FileDiffReadModel {
  diff?: string;
  binary: boolean;
  truncated: boolean;
}
