import { invoke } from '@tauri-apps/api/core';
import type { AgentProvider } from '../../../core/contracts/agents';
import type { Project, ProjectGitSummary } from '../../../core/contracts/projects';
import type { SessionId } from '../../../core/contracts/sessions';
import type { LiveSessionService } from '../../sessions';

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

/** Project-facing live session entry point. Runtime details stay owned by sessions. */
export async function startAgentSession(
  liveSessions: LiveSessionService | null,
  project: Project,
  provider: AgentProvider,
  prompt: string,
): Promise<SessionId> {
  if (!liveSessions) {
    throw new ProjectOperationError('The live Agent runtime is unavailable.');
  }
  if (project.source !== 'local') {
    throw new ProjectOperationError('Live Agent sessions require a local project.');
  }
  if (project.status !== 'available') {
    throw new ProjectOperationError('This project directory is missing.');
  }
  return liveSessions.createLiveSession(project, provider, prompt);
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
