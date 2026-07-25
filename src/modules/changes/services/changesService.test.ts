import { describe, expect, it, vi } from 'vitest';
import { createDemoSnapshot } from '../../demo';

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

import {
  ChangesOperationError,
  TauriChangesNativeAdapter,
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
    gitCommit: vi.fn(async () => ({
      commitId: 'abc123',
      branch: 'main',
    })),
    gitCheckout: vi.fn(async () => undefined),
    gitMerge: vi.fn(async () => ({
      success: true,
      conflicts: [],
    })),
    gitReset: vi.fn(async () => undefined),
    gitWorktreeList: vi.fn(async () => []),
    gitWorktreeCreate: vi.fn(async () => ({
      name: 'test-worktree',
      path: '/path/to/worktree',
      branch: 'feature',
    })),
    gitWorktreeRemove: vi.fn(async () => undefined),
  };
}

describe('changes service', () => {
  it('maps every native adapter operation to its Tauri command and payload', async () => {
    tauri.invoke.mockReset();
    const native = new TauriChangesNativeAdapter();
    const rootPath = 'C:\\Code\\api';

    await native.gitChanges(rootPath);
    await native.fileDiff(rootPath, 'src/index.ts');
    await native.openFile(rootPath, 'src/index.ts');
    await native.gitCommit(rootPath, { message: 'Commit changes' });
    await native.gitCheckout(rootPath, { branchName: 'feature/test', createNew: true });
    await native.gitMerge(rootPath, { branchName: 'feature/test' });
    await native.gitReset(rootPath, { resetType: 'mixed' });
    await native.gitWorktreeList(rootPath);
    await native.gitWorktreeCreate(rootPath, { name: 'review-worktree' });
    await native.gitWorktreeRemove(rootPath, 'review-worktree');

    expect(tauri.invoke.mock.calls).toEqual([
      ['project_git_changes', { rootPath }],
      ['project_file_diff', { rootPath, relativePath: 'src/index.ts' }],
      ['system_open_file', { rootPath, relativePath: 'src/index.ts' }],
      ['git_commit', { rootPath, request: { message: 'Commit changes' } }],
      ['git_checkout', { rootPath, request: { branchName: 'feature/test', createNew: true } }],
      ['git_merge', { rootPath, request: { branchName: 'feature/test' } }],
      ['git_reset', { rootPath, request: { resetType: 'mixed' } }],
      ['git_worktree_list', { rootPath }],
      ['git_worktree_create', { rootPath, request: { name: 'review-worktree' } }],
      ['git_worktree_remove', { rootPath, name: 'review-worktree' }],
    ]);
  });

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

  it('delegates git write operations to native methods', async () => {
    const native = adapter();
    const project = {
      ...createDemoSnapshot().projects[0],
      source: 'local' as const,
      rootPath: 'C:\\Code\\api',
    };
    const service = createChangesService(native);

    const commitRequest = { message: 'Test commit' };
    await service.commit(project, commitRequest);
    expect(native.gitCommit).toHaveBeenCalledWith('C:\\Code\\api', commitRequest);

    const checkoutRequest = { branchName: 'feature', createNew: true };
    await service.checkout(project, checkoutRequest);
    expect(native.gitCheckout).toHaveBeenCalledWith('C:\\Code\\api', checkoutRequest);

    const mergeRequest = { branchName: 'feature' };
    await service.merge(project, mergeRequest);
    expect(native.gitMerge).toHaveBeenCalledWith('C:\\Code\\api', mergeRequest);

    const resetRequest = { resetType: 'hard' as const };
    await service.reset(project, resetRequest);
    expect(native.gitReset).toHaveBeenCalledWith('C:\\Code\\api', resetRequest);

    await service.worktreeList(project);
    expect(native.gitWorktreeList).toHaveBeenCalledWith('C:\\Code\\api');

    const worktreeRequest = { name: 'test-worktree' };
    await service.worktreeCreate(project, worktreeRequest);
    expect(native.gitWorktreeCreate).toHaveBeenCalledWith('C:\\Code\\api', worktreeRequest);

    await service.worktreeRemove(project, 'test-worktree');
    expect(native.gitWorktreeRemove).toHaveBeenCalledWith('C:\\Code\\api', 'test-worktree');
  });

  it('blocks git write operations for demo and missing projects', async () => {
    const service = createChangesService(adapter());
    const demo = createDemoSnapshot().projects[0];

    await expect(service.commit(demo, { message: 'test' })).rejects.toBeInstanceOf(
      ChangesOperationError,
    );
    await expect(
      service.checkout({ ...demo, source: 'local', status: 'missing' }, {
        branchName: 'test',
        createNew: false,
      }),
    ).rejects.toBeInstanceOf(ChangesOperationError);
  });
});
