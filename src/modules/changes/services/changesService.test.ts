import { describe, expect, it, vi } from 'vitest';
import { createDemoSnapshot } from '../../demo';
import {
  ChangesOperationError,
  createChangesService,
  type ChangesNativeAdapter,
} from './changesService';

function adapter(): ChangesNativeAdapter {
  return {
    gitChanges: vi.fn(async () => [
      {
        relativePath: 'src/index.ts',
        status: 'modified' as const,
        additions: 2,
        deletions: 1,
        binary: false,
      },
    ]),
    fileDiff: vi.fn(async () => ({
      diff: '@@ -1 +1 @@\n-old\n+new',
      binary: false,
      truncated: false,
    })),
    openFile: vi.fn(async () => undefined),
  };
}

describe('changes service', () => {
  it('delegates registered local projects to typed native methods', async () => {
    const native = adapter();
    const project = {
      ...createDemoSnapshot().projects[0],
      source: 'local' as const,
      rootPath: 'C:\\Code\\api',
    };
    const service = createChangesService(native);

    await service.list(project);
    await service.diff(project, 'src/index.ts');
    await service.openFile(project, 'src/index.ts');

    expect(native.gitChanges).toHaveBeenCalledWith('C:\\Code\\api');
    expect(native.fileDiff).toHaveBeenCalledWith('C:\\Code\\api', 'src/index.ts');
    expect(native.openFile).toHaveBeenCalledWith('C:\\Code\\api', 'src/index.ts');
  });

  it('blocks native reads for demo and missing projects', async () => {
    const service = createChangesService(adapter());
    const demo = createDemoSnapshot().projects[0];

    await expect(service.list(demo)).rejects.toBeInstanceOf(ChangesOperationError);
    await expect(
      service.diff({ ...demo, source: 'local', status: 'missing' }, 'src/index.ts'),
    ).rejects.toBeInstanceOf(ChangesOperationError);
  });
});
