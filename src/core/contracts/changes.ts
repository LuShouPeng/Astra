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

// Git Write Operations
export interface GitCommitRequest {
  message: string;
  authorName?: string;
  authorEmail?: string;
  filePaths?: string[]; // If undefined, commit all changes
}

export interface GitCommitResult {
  commitId: string;
  branch: string;
}

export interface GitCheckoutRequest {
  branchName: string;
  createNew: boolean;
}

export interface GitMergeRequest {
  branchName: string;
}

export interface GitMergeResult {
  success: boolean;
  conflicts: string[];
}

export interface GitResetRequest {
  commitId?: string; // If undefined, reset to HEAD
  resetType: 'soft' | 'mixed' | 'hard';
}

export interface GitWorktreeCreateRequest {
  name: string;
  branchName?: string;
}

export interface GitWorktreeInfo {
  name: string;
  path: string;
  branch?: string;
}
