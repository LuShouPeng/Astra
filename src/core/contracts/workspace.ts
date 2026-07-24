export type WorkspaceId = string;

export type WorkspaceStatus = 'available' | 'missing';

export interface WorkspaceRecord {
  id: WorkspaceId;
  name: string;
  rootPath: string;
  normalizedPath: string;
  lastOpenedAt: string;
  createdAt: string;
  status: WorkspaceStatus;
}

export interface WorkspaceStoreSchema {
  schemaVersion: 1;
  workspaces: WorkspaceRecord[];
}

export interface ActiveWorkspace {
  id: WorkspaceId;
  name: string;
  rootPath: string;
}

export interface WorkspaceService {
  list(): Promise<WorkspaceRecord[]>;
  chooseAndAdd(): Promise<WorkspaceRecord | null>;
  open(id: WorkspaceId): Promise<ActiveWorkspace>;
  removeRecent(id: WorkspaceId): Promise<void>;
  refreshAvailability(): Promise<void>;
}

export type WorkspaceErrorCode =
  'PATH_NOT_FOUND' | 'NOT_A_DIRECTORY' | 'PERMISSION_DENIED' | 'STORE_CORRUPTED' | 'UNKNOWN';

export interface WorkspaceErrorShape {
  code: WorkspaceErrorCode;
  message: string;
  recoverable: boolean;
}

export interface WorkspacePathInfo {
  name: string;
  rootPath: string;
  normalizedPath: string;
}
