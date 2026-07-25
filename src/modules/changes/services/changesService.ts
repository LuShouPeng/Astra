import { invoke } from '@tauri-apps/api/core';
import type {
  FileDiffReadModel,
  GitFileChangeReadModel,
  GitCommitRequest,
  GitCommitResult,
  GitCheckoutRequest,
  GitMergeRequest,
  GitMergeResult,
  GitResetRequest,
  GitWorktreeCreateRequest,
  GitWorktreeInfo,
} from '../../../core/contracts/changes';
import type { Project } from '../../../core/contracts/projects';

export interface ChangesNativeAdapter {
  gitChanges(rootPath: string): Promise<GitFileChangeReadModel[]>;
  fileDiff(rootPath: string, relativePath: string): Promise<FileDiffReadModel>;
  openFile(rootPath: string, relativePath: string): Promise<void>;
  gitCommit(rootPath: string, request: GitCommitRequest): Promise<GitCommitResult>;
  gitCheckout(rootPath: string, request: GitCheckoutRequest): Promise<void>;
  gitMerge(rootPath: string, request: GitMergeRequest): Promise<GitMergeResult>;
  gitReset(rootPath: string, request: GitResetRequest): Promise<void>;
  gitWorktreeList(rootPath: string): Promise<GitWorktreeInfo[]>;
  gitWorktreeCreate(rootPath: string, request: GitWorktreeCreateRequest): Promise<GitWorktreeInfo>;
  gitWorktreeRemove(rootPath: string, name: string): Promise<void>;
}

export interface ChangesService {
  list(project: Project): Promise<GitFileChangeReadModel[]>;
  diff(project: Project, relativePath: string): Promise<FileDiffReadModel>;
  openFile(project: Project, relativePath: string): Promise<void>;
  commit(project: Project, request: GitCommitRequest): Promise<GitCommitResult>;
  checkout(project: Project, request: GitCheckoutRequest): Promise<void>;
  merge(project: Project, request: GitMergeRequest): Promise<GitMergeResult>;
  reset(project: Project, request: GitResetRequest): Promise<void>;
  worktreeList(project: Project): Promise<GitWorktreeInfo[]>;
  worktreeCreate(project: Project, request: GitWorktreeCreateRequest): Promise<GitWorktreeInfo>;
  worktreeRemove(project: Project, name: string): Promise<void>;
}

export class ChangesOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangesOperationError';
  }
}

export class TauriChangesNativeAdapter implements ChangesNativeAdapter {
  gitChanges(rootPath: string): Promise<GitFileChangeReadModel[]> {
    return invoke<GitFileChangeReadModel[]>('project_git_changes', { rootPath });
  }

  fileDiff(rootPath: string, relativePath: string): Promise<FileDiffReadModel> {
    return invoke<FileDiffReadModel>('project_file_diff', { rootPath, relativePath });
  }

  openFile(rootPath: string, relativePath: string): Promise<void> {
    return invoke<void>('system_open_file', { rootPath, relativePath });
  }

  gitCommit(rootPath: string, request: GitCommitRequest): Promise<GitCommitResult> {
    return invoke<GitCommitResult>('git_commit', { rootPath, request });
  }

  gitCheckout(rootPath: string, request: GitCheckoutRequest): Promise<void> {
    return invoke<void>('git_checkout', { rootPath, request });
  }

  gitMerge(rootPath: string, request: GitMergeRequest): Promise<GitMergeResult> {
    return invoke<GitMergeResult>('git_merge', { rootPath, request });
  }

  gitReset(rootPath: string, request: GitResetRequest): Promise<void> {
    return invoke<void>('git_reset', { rootPath, request });
  }

  gitWorktreeList(rootPath: string): Promise<GitWorktreeInfo[]> {
    return invoke<GitWorktreeInfo[]>('git_worktree_list', { rootPath });
  }

  gitWorktreeCreate(
    rootPath: string,
    request: GitWorktreeCreateRequest,
  ): Promise<GitWorktreeInfo> {
    return invoke<GitWorktreeInfo>('git_worktree_create', { rootPath, request });
  }

  gitWorktreeRemove(rootPath: string, name: string): Promise<void> {
    return invoke<void>('git_worktree_remove', { rootPath, name });
  }
}

function requireLocalProject(project: Project) {
  if (project.source !== 'local') {
    throw new ChangesOperationError('Demo changes are read from the frozen prototype snapshot.');
  }
  if (project.status !== 'available') {
    throw new ChangesOperationError('This project directory is missing.');
  }
}

export function createChangesService(adapter: ChangesNativeAdapter): ChangesService {
  return {
    async list(project) {
      requireLocalProject(project);
      return await adapter.gitChanges(project.rootPath);
    },
    async diff(project, relativePath) {
      requireLocalProject(project);
      return await adapter.fileDiff(project.rootPath, relativePath);
    },
    async openFile(project, relativePath) {
      requireLocalProject(project);
      await adapter.openFile(project.rootPath, relativePath);
    },
    async commit(project, request) {
      requireLocalProject(project);
      return await adapter.gitCommit(project.rootPath, request);
    },
    async checkout(project, request) {
      requireLocalProject(project);
      await adapter.gitCheckout(project.rootPath, request);
    },
    async merge(project, request) {
      requireLocalProject(project);
      return await adapter.gitMerge(project.rootPath, request);
    },
    async reset(project, request) {
      requireLocalProject(project);
      await adapter.gitReset(project.rootPath, request);
    },
    async worktreeList(project) {
      requireLocalProject(project);
      return await adapter.gitWorktreeList(project.rootPath);
    },
    async worktreeCreate(project, request) {
      requireLocalProject(project);
      return await adapter.gitWorktreeCreate(project.rootPath, request);
    },
    async worktreeRemove(project, name) {
      requireLocalProject(project);
      await adapter.gitWorktreeRemove(project.rootPath, name);
    },
  };
}
