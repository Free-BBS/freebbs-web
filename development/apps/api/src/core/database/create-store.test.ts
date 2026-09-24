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

  it('supports the passwordless Unix socket used by isolated tests without weakening production', () => {
    expect(
      loadMySqlConfig({
        NODE_ENV: 'test',
        MYSQL_HOST: '127.0.0.1',
        MYSQL_PORT: '3306',
        MYSQL_USER: 'root',
        MYSQL_PASSWORD: '',
        MYSQL_DATABASE: 'free_bbs_test',
        MYSQL_SOCKET: '/tmp/freebbs-test.sock',
      }),
    ).toMatchObject({
      password: '',
      socketPath: '/tmp/freebbs-test.sock',
    });

    expect(() =>
      loadMySqlConfig({
        NODE_ENV: 'production',
        MYSQL_HOST: '127.0.0.1',
        MYSQL_PORT: '3306',
        MYSQL_USER: 'root',
        MYSQL_PASSWORD: '',
        MYSQL_DATABASE: 'free_bbs',
        MYSQL_SOCKET: '/tmp/freebbs.sock',
      }),
    ).toThrow('MYSQL_PASSWORD');
  });
});
