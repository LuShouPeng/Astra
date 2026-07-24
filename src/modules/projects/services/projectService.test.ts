import { describe, expect, it, vi } from 'vitest';
import { createDemoSnapshot } from '../../demo';
import {
  createProjectService,
  ProjectOperationError,
  type ProjectNativeAdapter,
} from './projectService';

function createAdapter(): ProjectNativeAdapter {
  return {
    gitSummary: vi.fn(async () => ({
      gitRepository: true,
      branch: 'main',
      gitStatus: 'clean' as const,
    })),
    openDirectory: vi.fn(async () => undefined),
  };
}

describe('project service', () => {
  it('uses frozen data for demo projects without native access', async () => {
    const adapter = createAdapter();
    const project = createDemoSnapshot().projects[0];

    await expect(createProjectService(adapter).inspectGit(project)).resolves.toEqual({
      gitRepository: true,
      branch: 'main',
      gitStatus: 'modified',
    });
    expect(adapter.gitSummary).not.toHaveBeenCalled();
  });

  it('delegates only registered local roots to typed native methods', async () => {
    const adapter = createAdapter();
    const project = {
      ...createDemoSnapshot().projects[0],
      source: 'local' as const,
      rootPath: 'C:\\Code\\api',
    };
    const service = createProjectService(adapter);

    await service.inspectGit(project);
    await service.openDirectory(project);

    expect(adapter.gitSummary).toHaveBeenCalledWith('C:\\Code\\api');
    expect(adapter.openDirectory).toHaveBeenCalledWith('C:\\Code\\api');
  });

  it('blocks opening demo and missing projects', async () => {
    const service = createProjectService(createAdapter());
    const demo = createDemoSnapshot().projects[0];

    await expect(service.openDirectory(demo)).rejects.toBeInstanceOf(ProjectOperationError);
    await expect(
      service.openDirectory({ ...demo, source: 'local', status: 'missing' }),
    ).rejects.toBeInstanceOf(ProjectOperationError);
  });
});
