import { describe, expect, it } from 'vitest';
import type { WorkbenchSnapshot } from '../contracts/workbenchData';
import { createDemoSnapshot } from '../../modules/demo/data/demoFixtures';
import {
  PrototypeRepositoryError,
  createPrototypeRepository,
  type PrototypeStoreAdapter,
} from './prototypeRepository';

class MemoryPrototypeStore implements PrototypeStoreAdapter {
  value: unknown = null;
  saves = 0;

  async load(): Promise<unknown> {
    return structuredClone(this.value);
  }

  async save(snapshot: WorkbenchSnapshot): Promise<void> {
    this.value = structuredClone(snapshot);
    this.saves += 1;
  }
}

describe('demo fixtures', () => {
  it('provides the frozen three-project and six-session scenario', () => {
    const snapshot = createDemoSnapshot();

    expect(snapshot.projects.map((project) => project.name)).toEqual([
      'backend-api',
      'frontend',
      'ai-service',
    ]);
    expect(snapshot.sessions).toHaveLength(6);
    expect(new Set(snapshot.sessions.map((session) => session.provider))).toEqual(
      new Set(['claude', 'codex']),
    );
    expect(snapshot.providerCapabilities.codex.runtimeAvailable).toBe(false);
  });

  it('keeps all references valid, paths relative, and timelines ordered', () => {
    const snapshot = createDemoSnapshot();
    const projectIds = new Set(snapshot.projects.map((project) => project.id));
    const sessionIds = new Set(snapshot.sessions.map((session) => session.id));

    expect(snapshot.sessions.every((session) => projectIds.has(session.projectId))).toBe(true);
    expect(snapshot.timelineEvents.every((event) => sessionIds.has(event.sessionId))).toBe(true);
    expect(snapshot.fileChanges.every((change) => sessionIds.has(change.sessionId))).toBe(true);
    expect(
      snapshot.fileChanges.every(
        (change) =>
          !change.relativePath.startsWith('/') &&
          !/^[a-z]:[\\/]/i.test(change.relativePath) &&
          !change.relativePath.split(/[\\/]/).includes('..'),
      ),
    ).toBe(true);

    const timestamps = snapshot.timelineEvents.map((event) => event.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((left, right) => left.localeCompare(right)));
  });
});

describe('prototype repository', () => {
  it('initializes an empty store with deterministic demo data', async () => {
    const store = new MemoryPrototypeStore();
    const repository = createPrototypeRepository({ store, createFallback: createDemoSnapshot });

    const first = await repository.load();
    const second = await repository.load();

    expect(first).toEqual(createDemoSnapshot());
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(store.saves).toBe(1);
  });

  it('persists a valid snapshot and returns defensive copies', async () => {
    const store = new MemoryPrototypeStore();
    const repository = createPrototypeRepository({ store, createFallback: createDemoSnapshot });
    const snapshot = createDemoSnapshot();
    snapshot.sessions[0].title = 'Updated title';

    await repository.save(snapshot);
    snapshot.sessions[0].title = 'Mutated after save';

    const loaded = await repository.load();
    expect(loaded.sessions[0]?.title).toBe('Updated title');
  });

  it('recovers corrupt persisted state and exposes one non-blocking warning', async () => {
    const store = new MemoryPrototypeStore();
    store.value = { schemaVersion: 99, projects: 'invalid' };
    const repository = createPrototypeRepository({ store, createFallback: createDemoSnapshot });

    await expect(repository.load()).resolves.toEqual(createDemoSnapshot());
    expect(repository.consumeWarning()).toMatchObject({ code: 'STORE_CORRUPTED' });
    expect(repository.consumeWarning()).toBeNull();
  });

  it('rejects invalid snapshots instead of persisting broken references', async () => {
    const store = new MemoryPrototypeStore();
    const repository = createPrototypeRepository({ store, createFallback: createDemoSnapshot });
    const invalid = createDemoSnapshot();
    invalid.sessions[0] = { ...invalid.sessions[0], projectId: 'missing-project' };

    await expect(repository.save(invalid)).rejects.toBeInstanceOf(PrototypeRepositoryError);
    expect(store.saves).toBe(0);
  });

  it('resets to a new deterministic snapshot and persists it', async () => {
    const store = new MemoryPrototypeStore();
    const repository = createPrototypeRepository({ store, createFallback: createDemoSnapshot });
    const changed = createDemoSnapshot();
    changed.notifications = [];
    await repository.save(changed);

    const reset = await repository.reset();

    expect(reset).toEqual(createDemoSnapshot());
    expect(reset).not.toBe(createDemoSnapshot());
    expect(store.saves).toBe(2);
  });
});
