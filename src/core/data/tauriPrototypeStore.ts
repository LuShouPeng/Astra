import { Store } from '@tauri-apps/plugin-store';
import type { WorkbenchSnapshot } from '../contracts/workbenchData';
import type { PrototypeStoreAdapter } from './prototypeRepository';

const STORE_FILE = 'workbench.v1.json';
const STORE_KEY = 'workbenchSnapshot';

export class TauriPrototypeStore implements PrototypeStoreAdapter {
  private storePromise: Promise<Store> | null = null;

  async load(): Promise<unknown> {
    return (await this.getStore()).get<unknown>(STORE_KEY);
  }

  async save(snapshot: WorkbenchSnapshot): Promise<void> {
    const store = await this.getStore();
    await store.set(STORE_KEY, snapshot);
    await store.save();
  }

  private getStore(): Promise<Store> {
    this.storePromise ??= Store.load(STORE_FILE, { autoSave: false });
    return this.storePromise;
  }
}
