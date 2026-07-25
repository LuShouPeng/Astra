import type { WorkbenchSnapshot } from '../contracts/workbenchData';
import { migrateWorkbenchSnapshot } from './workbenchMigration';

export type PrototypeRepositoryErrorCode =
  'INVALID_SNAPSHOT' | 'STORE_CORRUPTED' | 'STORE_UNAVAILABLE';

export class PrototypeRepositoryError extends Error {
  constructor(
    readonly code: PrototypeRepositoryErrorCode,
    message: string,
    readonly recoverable = true,
  ) {
    super(message);
    this.name = 'PrototypeRepositoryError';
  }
}

export interface PrototypeStoreAdapter {
  load(): Promise<unknown>;
  save(snapshot: WorkbenchSnapshot): Promise<void>;
}

export interface PrototypeRepository {
  load(): Promise<WorkbenchSnapshot>;
  save(snapshot: WorkbenchSnapshot): Promise<void>;
  reset(): Promise<WorkbenchSnapshot>;
  consumeWarning(): PrototypeRepositoryError | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'string';
}

function hasValidReferences(snapshot: WorkbenchSnapshot): boolean {
  const projectIds = new Set(snapshot.projects.map((project) => project.id));
  const sessionIds = new Set(snapshot.sessions.map((session) => session.id));
  const fileChangeIds = new Set(snapshot.fileChanges.map((change) => change.id));

  return (
    snapshot.sessions.every((session) => projectIds.has(session.projectId)) &&
    snapshot.timelineEvents.every(
      (event) =>
        sessionIds.has(event.sessionId) &&
        (event.type !== 'file_change' || fileChangeIds.has(event.fileChangeId)),
    ) &&
    snapshot.fileChanges.every((change) => sessionIds.has(change.sessionId)) &&
    snapshot.attentionItems.every(
      (item) => projectIds.has(item.projectId) && sessionIds.has(item.sessionId),
    ) &&
    snapshot.notifications.every(
      (notification) =>
        (!notification.projectId || projectIds.has(notification.projectId)) &&
        (!notification.sessionId || sessionIds.has(notification.sessionId)),
    )
  );
}

function hasSafeRelativePaths(snapshot: WorkbenchSnapshot): boolean {
  return snapshot.fileChanges.every((change) => {
    const parts = change.relativePath.split(/[\\/]/);
    return (
      change.relativePath.length > 0 &&
      !change.relativePath.startsWith('/') &&
      !/^[a-z]:[\\/]/i.test(change.relativePath) &&
      !parts.includes('..')
    );
  });
}

export function isWorkbenchSnapshot(value: unknown): value is WorkbenchSnapshot {
  if (!isObject(value) || value.schemaVersion !== 2) return false;
  const arrays = [
    value.projects,
    value.sessions,
    value.timelineEvents,
    value.fileChanges,
    value.attentionItems,
    value.notifications,
  ];
  if (!arrays.every(Array.isArray)) return false;
  if (!isObject(value.notificationSettings) || !isObject(value.demo)) return false;
  if (!isObject(value.providerCapabilities)) return false;

  const snapshot = value as unknown as WorkbenchSnapshot;
  if (!snapshot.projects.every((project) => isObject(project) && hasString(project, 'id'))) {
    return false;
  }
  if (!snapshot.sessions.every((session) => isObject(session) && hasString(session, 'id'))) {
    return false;
  }
  if (
    !snapshot.sessions.every((session) => session.source === 'demo' || session.source === 'runtime')
  ) {
    return false;
  }
  if (!snapshot.timelineEvents.every((event) => isObject(event) && hasString(event, 'id'))) {
    return false;
  }
  if (!snapshot.fileChanges.every((change) => isObject(change) && hasString(change, 'id'))) {
    return false;
  }
  if (!snapshot.attentionItems.every((item) => isObject(item) && hasString(item, 'id'))) {
    return false;
  }
  if (!snapshot.notifications.every((item) => isObject(item) && hasString(item, 'id'))) {
    return false;
  }
  return hasValidReferences(snapshot) && hasSafeRelativePaths(snapshot);
}

function clone(snapshot: WorkbenchSnapshot): WorkbenchSnapshot {
  return structuredClone(snapshot);
}

export function createPrototypeRepository({
  store,
  createFallback,
}: {
  store: PrototypeStoreAdapter;
  createFallback: () => WorkbenchSnapshot;
}): PrototypeRepository {
  let cached: WorkbenchSnapshot | null = null;
  let warning: PrototypeRepositoryError | null = null;

  async function persist(snapshot: WorkbenchSnapshot): Promise<void> {
    try {
      await store.save(clone(snapshot));
      cached = clone(snapshot);
    } catch {
      throw new PrototypeRepositoryError('STORE_UNAVAILABLE', 'Workbench data could not be saved.');
    }
  }

  async function recover(): Promise<WorkbenchSnapshot> {
    const fallback = createFallback();
    if (!isWorkbenchSnapshot(fallback)) {
      throw new PrototypeRepositoryError(
        'INVALID_SNAPSHOT',
        'The built-in demo data is invalid.',
        false,
      );
    }
    await persist(fallback);
    return clone(fallback);
  }

  return {
    async load() {
      if (cached) return clone(cached);
      let stored: unknown;
      try {
        stored = await store.load();
      } catch {
        warning = new PrototypeRepositoryError(
          'STORE_CORRUPTED',
          'Saved workbench data could not be read. Demo data was restored.',
        );
        return recover();
      }
      if (stored === null || stored === undefined) return recover();
      let migrated: WorkbenchSnapshot;
      try {
        migrated = migrateWorkbenchSnapshot(stored);
      } catch {
        warning = new PrototypeRepositoryError(
          'STORE_CORRUPTED',
          'Saved workbench data was invalid. Demo data was restored.',
        );
        return recover();
      }
      if (!isWorkbenchSnapshot(migrated)) {
        warning = new PrototypeRepositoryError(
          'STORE_CORRUPTED',
          'Saved workbench data was invalid. Demo data was restored.',
        );
        return recover();
      }
      if ((stored as { schemaVersion?: unknown }).schemaVersion !== migrated.schemaVersion) {
        await persist(migrated);
      } else {
        cached = clone(migrated);
      }
      return clone(migrated);
    },

    async save(snapshot) {
      if (!isWorkbenchSnapshot(snapshot)) {
        throw new PrototypeRepositoryError(
          'INVALID_SNAPSHOT',
          'Workbench data contains invalid or broken references.',
          false,
        );
      }
      await persist(snapshot);
    },

    async reset() {
      const fallback = createFallback();
      if (!isWorkbenchSnapshot(fallback)) {
        throw new PrototypeRepositoryError(
          'INVALID_SNAPSHOT',
          'The built-in demo data is invalid.',
          false,
        );
      }
      await persist(fallback);
      return clone(fallback);
    },

    consumeWarning() {
      const current = warning;
      warning = null;
      return current;
    },
  };
}
