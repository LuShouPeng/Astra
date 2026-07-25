import { invoke } from '@tauri-apps/api/core';
import type { Project, ProjectGitSummary } from '../../../core/contracts/projects';

export interface ProjectNativeAdapter {
  gitSummary(rootPath: string): Promise<ProjectGitSummary>;
  openDirectory(rootPath: string): Promise<void>;
}

export interface ProjectService {
  inspectGit(project: Project): Promise<ProjectGitSummary>;
  inspectRoot(rootPath: string): Promise<ProjectGitSummary>;
  openDirectory(project: Project): Promise<void>;
}

export class ProjectOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectOperationError';
  }
}

export class TauriProjectNativeAdapter implements ProjectNativeAdapter {
  gitSummary(rootPath: string): Promise<ProjectGitSummary> {
    return invoke<ProjectGitSummary>('project_git_summary', { rootPath });
  }

  openDirectory(rootPath: string): Promise<void> {
    return invoke<void>('system_open_directory', { rootPath });
  }
}

export function createProjectService(adapter: ProjectNativeAdapter): ProjectService {
  return {
    inspectGit(project) {
      if (project.source === 'demo') {
        return Promise.resolve({
          gitRepository: project.gitRepository,
          branch: project.branch,
          gitStatus: project.gitStatus,
        });
      }
      return adapter.gitSummary(project.rootPath);
    },

    inspectRoot(rootPath) {
      return adapter.gitSummary(rootPath);
    },

    async openDirectory(project) {
      if (project.source !== 'local') {
        throw new ProjectOperationError('Demo projects do not map to a local directory.');
      }
      if (project.status !== 'available') {
        throw new ProjectOperationError('This project directory is missing.');
      }
      await adapter.openDirectory(project.rootPath);
    },
  };
}
