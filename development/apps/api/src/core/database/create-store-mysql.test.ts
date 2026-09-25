import { expect, it } from 'vitest';

import { createStore } from './create-store.js';

it('accepts a complete DATA_MODE=mysql configuration without connecting eagerly', async () => {
  const handle = createStore({
    DATA_MODE: 'mysql',
    MYSQL_HOST: '127.0.0.1',
    MYSQL_PORT: '3306',
    MYSQL_USER: 'development',
    MYSQL_PASSWORD: 'secret',
    MYSQL_DATABASE: 'free_bbs_development',
  });

  expect(handle.mode).toBe('mysql');
  await handle.close();
});
