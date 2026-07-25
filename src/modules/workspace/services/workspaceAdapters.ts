import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Store } from '@tauri-apps/plugin-store';
import type { WorkspacePathInfo, WorkspaceStoreSchema } from '../../../core/contracts/workspace';

const STORE_FILE = 'workspaces.v1.json';
const STORE_KEY = 'workspaceStore';

export interface WorkspaceNativeAdapter {
  chooseDirectory: () => Promise<string | null>;
  inspectPath: (path: string) => Promise<WorkspacePathInfo>;
  pathExists: (path: string) => Promise<boolean>;
}

export interface WorkspaceStoreAdapter {
  load: () => Promise<unknown>;
  save: (value: WorkspaceStoreSchema) => Promise<void>;
}

export class TauriWorkspaceNativeAdapter implements WorkspaceNativeAdapter {
  async chooseDirectory(): Promise<string | null> {
    const selection = await open({ directory: true, multiple: false });
    return typeof selection === 'string' ? selection : null;
  }

  inspectPath(path: string): Promise<WorkspacePathInfo> {
    return invoke<WorkspacePathInfo>('workspace_inspect_path', { path });
  }

  pathExists(path: string): Promise<boolean> {
    return invoke<boolean>('workspace_check_exists', { path });
  }
}

export class TauriWorkspaceStoreAdapter implements WorkspaceStoreAdapter {
  private storePromise: Promise<Store> | null = null;

  async load(): Promise<unknown> {
    const store = await this.getStore();
    return store.get<unknown>(STORE_KEY);
  }

  async save(value: WorkspaceStoreSchema): Promise<void> {
    const store = await this.getStore();
    await store.set(STORE_KEY, value);
    await store.save();
  }

  private getStore(): Promise<Store> {
    this.storePromise ??= Store.load(STORE_FILE, { autoSave: false });
    return this.storePromise;
  }
}

export function createTauriWorkspaceAdapters(): {
  native: WorkspaceNativeAdapter;
  store: WorkspaceStoreAdapter;
} {
  return {
    native: new TauriWorkspaceNativeAdapter(),
    store: new TauriWorkspaceStoreAdapter(),
  };
}
