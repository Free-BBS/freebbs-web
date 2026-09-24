import { describe, expect, it } from 'vitest';

import { createStore } from './create-store.js';
import { loadMySqlConfig } from './migrate.js';

describe('store configuration', () => {
  it('defaults DATA_MODE to an immediately usable memory store', async () => {
    const handle = createStore({});
    expect(handle.mode).toBe('memory');
    expect(await handle.store.modules.list()).toHaveLength(10);
    await handle.close();
  });

  it('reports memory mode as immediately ready without creating a database connection', async () => {
    const handle = createStore({});

    await expect(handle.checkReadiness()).resolves.toBeUndefined();
    await handle.close();
  });
  it('rejects unknown data modes and incomplete MySQL settings', () => {
    expect(() => createStore({ DATA_MODE: 'sqlite' })).toThrow('Unsupported DATA_MODE: sqlite');
    expect(() => createStore({ DATA_MODE: 'mysql' })).toThrow('MYSQL_HOST is required');
    expect(() =>
      loadMySqlConfig({
        MYSQL_HOST: '127.0.0.1',
        MYSQL_PORT: '70000',
        MYSQL_USER: 'development',
        MYSQL_PASSWORD: 'secret',
        MYSQL_DATABASE: 'free_bbs_development',
      }),
    ).toThrow('MYSQL_PORT');
  });
});
