import { createMemoryStore } from './memory-store.js';
import { createMySqlStore, type MySqlStoreHandle } from './mysql-store.js';
import type { DevelopmentStore } from './types.js';

export type DataMode = 'memory' | 'mysql';

export interface StoreHandle {
  mode: DataMode;
  store: DevelopmentStore;
  checkReadiness(): Promise<void>;
  close(): Promise<void>;
}

export interface StoreRuntimeHandle extends StoreHandle {
  getAppliedMigrationCount(): Promise<number>;
}

export function createStore(environment: NodeJS.ProcessEnv = process.env): StoreRuntimeHandle {
  const mode = environment.DATA_MODE?.trim() || 'memory';
  if (mode === 'memory') {
    return {
      mode,
      store: createMemoryStore(),
      getAppliedMigrationCount: async () => 0,
      checkReadiness: async () => undefined,
      close: async () => undefined,
    };
  }
  if (mode === 'mysql') {
    const handle: MySqlStoreHandle = createMySqlStore({ environment });
    return {
      mode,
      store: handle.store,
      getAppliedMigrationCount: handle.getAppliedMigrationCount,
      checkReadiness: handle.checkReadiness,
      close: handle.close,
    };
  }
  throw new Error(`Unsupported DATA_MODE: ${mode}`);
}
