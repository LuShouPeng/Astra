import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../core/contracts/projects';
import type { ActiveWorkspace, WorkspaceRecord } from '../core/contracts/workspace';
import { selectOrDeriveWorkspaceProject } from './projectSelection';

const workspaceRecord: WorkspaceRecord = {
  id: 'ws-astra',
  name: 'Astra Nexus',
  rootPath: 'C:\\Code\\Astra Nexus',
  normalizedPath: 'c:\\code\\astra nexus',
  createdAt: '2026-07-26T08:00:00.000Z',
  lastOpenedAt: '2026-07-26T09:00:00.000Z',
  status: 'available',
};

const activeWorkspace: ActiveWorkspace = {
  id: workspaceRecord.id,
  name: workspaceRecord.name,
  rootPath: workspaceRecord.rootPath,
};

function localProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-existing',
    name: 'Astra Nexus',
    rootPath: workspaceRecord.rootPath,
    normalizedPath: workspaceRecord.normalizedPath,
    source: 'local',
    status: 'available',
    gitRepository: true,
    branch: 'main',
    gitStatus: 'clean',
    createdAt: workspaceRecord.createdAt,
    lastActivityAt: workspaceRecord.lastOpenedAt,
    ...overrides,
  };
}

describe('selectOrDeriveWorkspaceProject', () => {
  it('selects the registered local project for the active workspace path', () => {
    const existing = localProject({ id: 'legacy-workspace-id' });

    const project = selectOrDeriveWorkspaceProject([existing], activeWorkspace, workspaceRecord);

    expect(project).toBe(existing);
  });

  it('selects a registered local project when only its root path matches', () => {
    const existing = localProject({ normalizedPath: 'c:/legacy/path' });

    const project = selectOrDeriveWorkspaceProject([existing], activeWorkspace, workspaceRecord);

    expect(project).toBe(existing);
  });

  it('derives a stable local project instead of reusing the workspace id', () => {
    const project = selectOrDeriveWorkspaceProject([], activeWorkspace, workspaceRecord);

    expect(project).toMatchObject({
      id: 'project-ws-astra',
      name: 'Astra Nexus',
      rootPath: 'C:\\Code\\Astra Nexus',
      normalizedPath: 'c:\\code\\astra nexus',
      source: 'local',
      status: 'available',
      gitRepository: false,
      gitStatus: 'unknown',
      createdAt: '2026-07-26T08:00:00.000Z',
      lastActivityAt: '2026-07-26T09:00:00.000Z',
    });
    expect(project.id).not.toBe(activeWorkspace.id);
  });

  it('normalizes a workspace root path and derives timestamps without a workspace record', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T10:00:00.000Z'));
    try {
      const workspace: ActiveWorkspace = {
        id: 'ws-unregistered',
        name: 'Unregistered',
        rootPath: 'C:\\Code\\Unregistered\\',
      };

      const project = selectOrDeriveWorkspaceProject([], workspace);

      expect(project).toMatchObject({
        id: 'project-ws-unregistered',
        rootPath: 'C:\\Code\\Unregistered\\',
        normalizedPath: 'C:/Code/Unregistered',
        createdAt: '2026-07-26T10:00:00.000Z',
        lastActivityAt: '2026-07-26T10:00:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the last-opened timestamp when a legacy record has no creation timestamp', () => {
    const legacyRecord = {
      ...workspaceRecord,
      createdAt: undefined,
    } as unknown as WorkspaceRecord;

    const project = selectOrDeriveWorkspaceProject([], activeWorkspace, legacyRecord);

    expect(project.createdAt).toBe('2026-07-26T09:00:00.000Z');
    expect(project.lastActivityAt).toBe('2026-07-26T09:00:00.000Z');
  });

  it('uses the creation timestamp for activity when a legacy record has no last-opened timestamp', () => {
    const legacyRecord = {
      ...workspaceRecord,
      lastOpenedAt: undefined,
    } as unknown as WorkspaceRecord;

    const project = selectOrDeriveWorkspaceProject([], activeWorkspace, legacyRecord);

    expect(project.createdAt).toBe('2026-07-26T08:00:00.000Z');
    expect(project.lastActivityAt).toBe('2026-07-26T08:00:00.000Z');
  });
});
