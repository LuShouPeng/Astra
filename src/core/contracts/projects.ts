export type ProjectId = string;
export type ProjectSource = 'local' | 'demo';
export type ProjectStatus = 'available' | 'missing';
export type GitStatus = 'clean' | 'modified' | 'unknown';
export type ProjectSort = 'recent' | 'name';

export interface ProjectGitSummary {
  gitRepository: boolean;
  branch?: string;
  gitStatus: GitStatus;
}

export interface Project {
  id: ProjectId;
  name: string;
  rootPath: string;
  normalizedPath: string;
  source: ProjectSource;
  status: ProjectStatus;
  description?: string;
  gitRepository: boolean;
  branch?: string;
  gitStatus: GitStatus;
  createdAt: string;
  lastActivityAt: string;
}
