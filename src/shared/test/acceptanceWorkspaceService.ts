import type {
  ActiveWorkspace,
  WorkspaceId,
  WorkspaceRecord,
  WorkspaceService,
} from '../../core/contracts/workspace';

const availableWorkspace: WorkspaceRecord = {
  id: 'ws-astra',
  name: 'Astra Nexus',
  rootPath: 'C:\\Users\\developer\\Projects\\Astra Nexus',
  normalizedPath: 'c:\\users\\developer\\projects\\astra nexus',
  createdAt: '2026-07-18T09:15:00.000Z',
  lastOpenedAt: '2026-07-24T12:25:00.000Z',
  status: 'available',
};

const secondWorkspace: WorkspaceRecord = {
  id: 'ws-canvas',
  name: 'Canvas Engine',
  rootPath: 'C:\\Users\\developer\\Projects\\Canvas Engine',
  normalizedPath: 'c:\\users\\developer\\projects\\canvas engine',
  createdAt: '2026-07-12T08:00:00.000Z',
  lastOpenedAt: '2026-07-23T16:40:00.000Z',
  status: 'available',
};

const missingWorkspace: WorkspaceRecord = {
  id: 'ws-archive',
  name: 'Archived Prototype',
  rootPath: 'D:\\Archive\\Archived Prototype',
  normalizedPath: 'd:\\archive\\archived prototype',
  createdAt: '2026-07-02T07:00:00.000Z',
  lastOpenedAt: '2026-07-20T10:10:00.000Z',
  status: 'missing',
};

function toActive(record: WorkspaceRecord): ActiveWorkspace {
  return { id: record.id, name: record.name, rootPath: record.rootPath };
}

export function createAcceptanceWorkspaceService(search: string): WorkspaceService {
  const scenario = new URLSearchParams(search).get('scenario') ?? 'empty';
  let records =
    scenario === 'empty'
      ? []
      : scenario === 'missing'
        ? [availableWorkspace, missingWorkspace]
        : [availableWorkspace, secondWorkspace];

  return {
    list: () => Promise.resolve(records.map((record) => ({ ...record }))),
    chooseAndAdd: () => {
      records = [
        availableWorkspace,
        ...records.filter((record) => record.id !== availableWorkspace.id),
      ];
      return Promise.resolve({ ...availableWorkspace });
    },
    open: (id: WorkspaceId) => {
      const record = records.find((item) => item.id === id);
      if (!record || record.status === 'missing') {
        return Promise.reject(new Error('This workspace folder is missing.'));
      }
      return Promise.resolve(toActive(record));
    },
    removeRecent: (id: WorkspaceId) => {
      records = records.filter((record) => record.id !== id);
      return Promise.resolve();
    },
    refreshAvailability: () => Promise.resolve(),
  };
}
