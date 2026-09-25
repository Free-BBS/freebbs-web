import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const basePath = '/api/development/v1';
const adminHeaders = { 'X-Demo-User': 'demo-admin' };

describe('Task 18 recoverability and CORS review regressions', () => {
  it('protects the admin module from disable without writing state or audit', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      databaseMode: 'memory',
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
    });
    const before = (await store.modules.list({ query: 'admin' })).find(
      ({ moduleId }) => moduleId === 'admin',
    );
    const auditCount = (await store.auditLogs.list({ query: 'admin.module.update' })).length;

    const response = await request(app)
      .patch(`${basePath}/admin/modules`)
      .set(adminHeaders)
      .send({ moduleId: 'admin', enabled: false })
      .expect(409);

    expect(response.body.data.error.code).toBe('protected_admin_module');
    expect(
      (await store.modules.list({ query: 'admin' })).find(({ moduleId }) => moduleId === 'admin'),
    ).toEqual(before);
    expect(await store.auditLogs.list({ query: 'admin.module.update' })).toHaveLength(auditCount);
  });

  it('answers an allowed-origin PUT preflight with PUT in the allowed methods', async () => {
    const origin = 'https://development.freebbs.example';
    const app = createApp({
      store: createMemoryStore(),
      databaseMode: 'memory',
      allowedOrigins: [origin],
    });

    const response = await request(app)
      .options(`${basePath}/admin/modules/sports/owners`)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'PUT')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-methods']?.split(',')).toContain('PUT');
  });
});
