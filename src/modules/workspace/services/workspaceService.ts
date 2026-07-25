import type {
  WorkspaceErrorCode,
  WorkspaceErrorShape,
  WorkspaceId,
  WorkspaceRecord,
  WorkspaceService,
  WorkspaceStoreSchema,
} from '../../../core/contracts/workspace';
import type { WorkspaceNativeAdapter, WorkspaceStoreAdapter } from './workspaceAdapters';

interface WorkspaceServiceDependencies {
  native: WorkspaceNativeAdapter;
  store: WorkspaceStoreAdapter;
  now?: () => Date;
}

export interface WorkspaceServiceController extends WorkspaceService {
  consumeWarning: () => WorkspaceOperationError | null;
}

export class WorkspaceOperationError extends Error implements WorkspaceErrorShape {
  readonly code: WorkspaceErrorCode;
  readonly recoverable: boolean;

  constructor(code: WorkspaceErrorCode, message: string, recoverable = true) {
    super(message);
    this.name = 'WorkspaceOperationError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

function isRecord(value: unknown): value is WorkspaceRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.rootPath === 'string' &&
    typeof item.normalizedPath === 'string' &&
    typeof item.lastOpenedAt === 'string' &&
    typeof item.createdAt === 'string' &&
    (item.status === 'available' || item.status === 'missing')
  );
}

function parseStore(value: unknown): WorkspaceStoreSchema | null {
  if (value === null || value === undefined) {
    return { schemaVersion: 1, workspaces: [] };
  }
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.workspaces)) return null;
  if (!candidate.workspaces.every(isRecord)) return null;
  return { schemaVersion: 1, workspaces: candidate.workspaces };
}

function sortRecent(records: WorkspaceRecord[]): WorkspaceRecord[] {
  return [...records].sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
}

function stableWorkspaceId(normalizedPath: string): WorkspaceId {
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalizedPath.length; index += 1) {
    hash ^= normalizedPath.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `ws-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function toOperationError(error: unknown, fallbackMessage: string): WorkspaceOperationError {
  if (error instanceof WorkspaceOperationError) return error;
  if (error && typeof error === 'object') {
    const candidate = error as Partial<WorkspaceErrorShape>;
    if (candidate.code && candidate.message) {
      return new WorkspaceOperationError(
        candidate.code,
        candidate.message,
        candidate.recoverable ?? true,
      );
    }
  }
  return new WorkspaceOperationError('UNKNOWN', fallbackMessage);
}

export function createWorkspaceService({
  native,
  store,
  now = () => new Date(),
}: WorkspaceServiceDependencies): WorkspaceServiceController {
  let schema: WorkspaceStoreSchema | null = null;
  let warning: WorkspaceOperationError | null = null;

  async function load(): Promise<WorkspaceStoreSchema> {
    if (schema) return schema;
    try {
      const parsed = parseStore(await store.load());
      if (!parsed) {
        warning = new WorkspaceOperationError(
          'STORE_CORRUPTED',
          'Recent workspaces could not be read. The app started with an empty list.',
        );
        schema = { schemaVersion: 1, workspaces: [] };
      } else {
        schema = parsed;
      }
    } catch {
      warning = new WorkspaceOperationError(
        'STORE_CORRUPTED',
        'Recent workspaces could not be read. The app started with an empty list.',
      );
      schema = { schemaVersion: 1, workspaces: [] };
    }
    return schema;
  }

  async function persist(workspaces: WorkspaceRecord[]): Promise<void> {
    schema = { schemaVersion: 1, workspaces: sortRecent(workspaces) };
    try {
      await store.save(schema);
    } catch (error) {
      throw toOperationError(error, 'Recent workspaces could not be saved.');
    }
  }

  return {
    async list() {
      const current = await load();
      return sortRecent(current.workspaces).map((record) => ({ ...record }));
    },

    async chooseAndAdd() {
      let selectedPath: string | null;
      try {
        selectedPath = await native.chooseDirectory();
      } catch (error) {
        throw toOperationError(error, 'The folder picker could not be opened.');
      }
      if (!selectedPath) return null;

      let info;
      try {
        info = await native.inspectPath(selectedPath);
      } catch (error) {
        throw toOperationError(error, 'The selected folder could not be opened.');
      }

      const current = await load();
      const timestamp = now().toISOString();
      const existing = current.workspaces.find(
        (record) => record.normalizedPath === info.normalizedPath,
      );
      const record: WorkspaceRecord = existing
        ? {
            ...existing,
            name: info.name,
            rootPath: info.rootPath,
            lastOpenedAt: timestamp,
            status: 'available',
          }
        : {
            id: stableWorkspaceId(info.normalizedPath),
            name: info.name,
            rootPath: info.rootPath,
            normalizedPath: info.normalizedPath,
            createdAt: timestamp,
            lastOpenedAt: timestamp,
            status: 'available',
          };
      const next = existing
        ? current.workspaces.map((item) => (item.id === existing.id ? record : item))
        : [...current.workspaces, record];
      await persist(next);
      return { ...record };
    },

    async open(id) {
      const current = await load();
      const record = current.workspaces.find((item) => item.id === id);
      if (!record) {
        throw new WorkspaceOperationError(
          'PATH_NOT_FOUND',
          'This recent workspace no longer exists.',
        );
      }

      let exists: boolean;
      try {
        exists = await native.pathExists(record.rootPath);
      } catch (error) {
        throw toOperationError(error, 'The workspace path could not be checked.');
      }
      if (!exists) {
        await persist(
          current.workspaces.map((item) =>
            item.id === id ? { ...item, status: 'missing' as const } : item,
          ),
        );
        throw new WorkspaceOperationError(
          'PATH_NOT_FOUND',
          'This workspace folder is missing. Remove it from Recent or restore the folder.',
        );
      }

      const lastOpenedAt = now().toISOString();
      await persist(
        current.workspaces.map((item) =>
          item.id === id ? { ...item, status: 'available' as const, lastOpenedAt } : item,
        ),
      );
      return { id: record.id, name: record.name, rootPath: record.rootPath };
    },

    async removeRecent(id) {
      const current = await load();
      await persist(current.workspaces.filter((item) => item.id !== id));
    },

    async refreshAvailability() {
      const current = await load();
      const refreshed = await Promise.all(
        current.workspaces.map(async (record) => {
          try {
            const exists = await native.pathExists(record.rootPath);
            return { ...record, status: exists ? ('available' as const) : ('missing' as const) };
          } catch {
            return { ...record, status: 'missing' as const };
          }
        }),
      );
      if (refreshed.some((record, index) => record.status !== current.workspaces[index]?.status)) {
        await persist(refreshed);
      }
    },

    consumeWarning() {
      const currentWarning = warning;
      warning = null;
      return currentWarning;
    },
  };
}
