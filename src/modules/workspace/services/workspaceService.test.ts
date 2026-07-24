import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceStoreSchema } from '../../../core/contracts/workspace';
import type { WorkspaceNativeAdapter, WorkspaceStoreAdapter } from './workspaceAdapters';
import { createWorkspaceService, WorkspaceOperationError } from './workspaceService';

class MemoryStore implements WorkspaceStoreAdapter {
  value: unknown = null;
  save = vi.fn(async (value: WorkspaceStoreSchema) => {
    this.value = structuredClone(value);
  });

  async load(): Promise<unknown> {
    return structuredClone(this.value);
  }
}

function createNativeAdapter(
  overrides: Partial<WorkspaceNativeAdapter> = {},
): WorkspaceNativeAdapter {
  return {
    chooseDirectory: vi.fn(async () => 'C:\\Code\\Astra'),
    inspectPath: vi.fn(async () => ({
      name: 'Astra',
      rootPath: 'C:\\Code\\Astra',
      normalizedPath: 'c:\\code\\astra',
    })),
    pathExists: vi.fn(async () => true),
    ...overrides,
  };
}

function sequentialClock(...values: string[]): () => Date {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

describe('workspace service', () => {
  it('returns null and does not persist when folder selection is cancelled', async () => {
    const store = new MemoryStore();
    const native = createNativeAdapter({ chooseDirectory: vi.fn(async () => null) });
    const service = createWorkspaceService({ native, store });

    await expect(service.chooseAndAdd()).resolves.toBeNull();
    expect(native.inspectPath).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('deduplicates by normalized path and updates lastOpenedAt', async () => {
    const store = new MemoryStore();
    const native = createNativeAdapter();
    const service = createWorkspaceService({
      native,
      store,
      now: sequentialClock('2026-07-24T10:00:00.000Z', '2026-07-24T11:00:00.000Z'),
    });

    const first = await service.chooseAndAdd();
    const second = await service.chooseAndAdd();
    const records = await service.list();

    expect(records).toHaveLength(1);
    expect(second?.id).toBe(first?.id);
    expect(records[0]?.createdAt).toBe('2026-07-24T10:00:00.000Z');
    expect(records[0]?.lastOpenedAt).toBe('2026-07-24T11:00:00.000Z');
  });

  it('sorts recent workspaces newest first', async () => {
    const store = new MemoryStore();
    store.value = {
      schemaVersion: 1,
      workspaces: [
        {
          id: 'older',
          name: 'Older',
          rootPath: 'C:\\Older',
          normalizedPath: 'c:\\older',
          createdAt: '2026-07-20T10:00:00.000Z',
          lastOpenedAt: '2026-07-20T10:00:00.000Z',
          status: 'available',
        },
        {
          id: 'newer',
          name: 'Newer',
          rootPath: 'C:\\Newer',
          normalizedPath: 'c:\\newer',
          createdAt: '2026-07-21T10:00:00.000Z',
          lastOpenedAt: '2026-07-22T10:00:00.000Z',
          status: 'available',
        },
      ],
    } satisfies WorkspaceStoreSchema;

    const service = createWorkspaceService({ native: createNativeAdapter(), store });
    await expect(service.list()).resolves.toMatchObject([{ id: 'newer' }, { id: 'older' }]);
  });

  it('persists records across service instances', async () => {
    const store = new MemoryStore();
    const firstService = createWorkspaceService({ native: createNativeAdapter(), store });
    await firstService.chooseAndAdd();

    const reloadedService = createWorkspaceService({ native: createNativeAdapter(), store });
    await expect(reloadedService.list()).resolves.toHaveLength(1);
  });

  it('removes only store metadata and never asks the native adapter to delete', async () => {
    const store = new MemoryStore();
    const native = createNativeAdapter();
    const service = createWorkspaceService({ native, store });
    const record = await service.chooseAndAdd();

    await service.removeRecent(record!.id);

    await expect(service.list()).resolves.toEqual([]);
    expect(Object.keys(native)).toEqual(['chooseDirectory', 'inspectPath', 'pathExists']);
  });

  it('blocks a missing workspace and persists its missing status', async () => {
    const store = new MemoryStore();
    const native = createNativeAdapter();
    const service = createWorkspaceService({ native, store });
    const record = await service.chooseAndAdd();
    vi.mocked(native.pathExists).mockResolvedValue(false);

    await expect(service.open(record!.id)).rejects.toMatchObject({ code: 'PATH_NOT_FOUND' });
    await expect(service.list()).resolves.toMatchObject([{ status: 'missing' }]);
  });

  it('recovers from corrupt store data and exposes a non-blocking warning', async () => {
    const store = new MemoryStore();
    store.value = { schemaVersion: 99, workspaces: 'broken' };
    const service = createWorkspaceService({ native: createNativeAdapter(), store });

    await expect(service.list()).resolves.toEqual([]);
    expect(service.consumeWarning()).toMatchObject({ code: 'STORE_CORRUPTED' });
    expect(service.consumeWarning()).toBeNull();
  });

  it('returns a structured error when an unknown workspace is opened', async () => {
    const service = createWorkspaceService({
      native: createNativeAdapter(),
      store: new MemoryStore(),
    });

    await expect(service.open('unknown')).rejects.toBeInstanceOf(WorkspaceOperationError);
    await expect(service.open('unknown')).rejects.toMatchObject({ code: 'PATH_NOT_FOUND' });
  });

  it('opens an available workspace and updates its recent timestamp', async () => {
    const store = new MemoryStore();
    const service = createWorkspaceService({
      native: createNativeAdapter(),
      store,
      now: sequentialClock('2026-07-24T10:00:00.000Z', '2026-07-24T12:00:00.000Z'),
    });
    const record = await service.chooseAndAdd();

    await expect(service.open(record!.id)).resolves.toEqual({
      id: record!.id,
      name: 'Astra',
      rootPath: 'C:\\Code\\Astra',
    });
    await expect(service.list()).resolves.toMatchObject([
      { lastOpenedAt: '2026-07-24T12:00:00.000Z', status: 'available' },
    ]);
  });

  it('refreshes changed availability and tolerates individual path check failures', async () => {
    const store = new MemoryStore();
    store.value = {
      schemaVersion: 1,
      workspaces: [
        {
          id: 'one',
          name: 'One',
          rootPath: 'C:\\One',
          normalizedPath: 'c:\\one',
          createdAt: '2026-07-20T10:00:00.000Z',
          lastOpenedAt: '2026-07-20T10:00:00.000Z',
          status: 'available',
        },
        {
          id: 'two',
          name: 'Two',
          rootPath: 'C:\\Two',
          normalizedPath: 'c:\\two',
          createdAt: '2026-07-20T10:00:00.000Z',
          lastOpenedAt: '2026-07-19T10:00:00.000Z',
          status: 'available',
        },
      ],
    } satisfies WorkspaceStoreSchema;
    const native = createNativeAdapter({
      pathExists: vi
        .fn<WorkspaceNativeAdapter['pathExists']>()
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error('denied')),
    });
    const service = createWorkspaceService({ native, store });

    await service.refreshAvailability();

    await expect(service.list()).resolves.toMatchObject([
      { id: 'one', status: 'missing' },
      { id: 'two', status: 'missing' },
    ]);
    expect(store.save).toHaveBeenCalledOnce();
  });

  it('maps native structured errors without exposing raw failures', async () => {
    const native = createNativeAdapter({
      inspectPath: vi.fn(async () =>
        Promise.reject(
          Object.assign(new Error('Select a folder rather than a file.'), {
            code: 'NOT_A_DIRECTORY' as const,
            recoverable: true,
          }),
        ),
      ),
    });
    const service = createWorkspaceService({ native, store: new MemoryStore() });

    await expect(service.chooseAndAdd()).rejects.toMatchObject({
      code: 'NOT_A_DIRECTORY',
      message: 'Select a folder rather than a file.',
    });
  });

  it('recovers when store loading throws and reports save failures', async () => {
    const failingLoadStore: WorkspaceStoreAdapter = {
      load: () => Promise.reject(new Error('invalid json')),
      save: () => Promise.resolve(),
    };
    const recovered = createWorkspaceService({
      native: createNativeAdapter(),
      store: failingLoadStore,
    });
    await expect(recovered.list()).resolves.toEqual([]);
    expect(recovered.consumeWarning()?.code).toBe('STORE_CORRUPTED');

    const failingSaveStore: WorkspaceStoreAdapter = {
      load: () => Promise.resolve(null),
      save: () => Promise.reject(new Error('disk full')),
    };
    const failing = createWorkspaceService({
      native: createNativeAdapter(),
      store: failingSaveStore,
    });
    await expect(failing.chooseAndAdd()).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: 'Recent workspaces could not be saved.',
    });
  });

  it('maps folder picker and availability adapter failures to safe messages', async () => {
    const pickerFailure = createWorkspaceService({
      native: createNativeAdapter({
        chooseDirectory: () => Promise.reject(new Error('native dialog details')),
      }),
      store: new MemoryStore(),
    });
    await expect(pickerFailure.chooseAndAdd()).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: 'The folder picker could not be opened.',
    });

    const store = new MemoryStore();
    const native = createNativeAdapter();
    const availabilityFailure = createWorkspaceService({ native, store });
    const added = await availabilityFailure.chooseAndAdd();
    vi.mocked(native.pathExists).mockRejectedValue(new Error('native path details'));
    await expect(availabilityFailure.open(added!.id)).rejects.toMatchObject({
      code: 'UNKNOWN',
      message: 'The workspace path could not be checked.',
    });
  });
});
