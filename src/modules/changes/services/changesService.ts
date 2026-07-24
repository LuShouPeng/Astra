import { invoke } from '@tauri-apps/api/core';
import type { FileDiffReadModel, GitFileChangeReadModel } from '../../../core/contracts/changes';
import type { Project } from '../../../core/contracts/projects';

export interface ChangesNativeAdapter {
  gitChanges(rootPath: string): Promise<GitFileChangeReadModel[]>;
  fileDiff(rootPath: string, relativePath: string): Promise<FileDiffReadModel>;
  openFile(rootPath: string, relativePath: string): Promise<void>;
}

export interface ChangesService {
  list(project: Project): Promise<GitFileChangeReadModel[]>;
  diff(project: Project, relativePath: string): Promise<FileDiffReadModel>;
  openFile(project: Project, relativePath: string): Promise<void>;
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
  };
}
