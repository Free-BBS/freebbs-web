import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function directory() {
  const value = await mkdtemp(join(tmpdir(), 'organization-secretaries-'));
  directories.push(value);
  return value;
}
const base = '/api/development/v1/organization-group/secretaries';
describe('class secretary directory wiring', () => {
  it('uses existing demo accounts when demo mode has no explicit directory', async () => {
    const app = createApp({
      environment: { NODE_ENV: 'test' },
      store: createMemoryStore(),
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
      collectionsUploadDirectory: await directory(),
    });
    const response = await request(app)
      .get(`${base}?query=demo-student`)
      .set('X-Demo-User', 'demo-admin')
      .expect(200);
    expect(response.body.data.items).toEqual([
      expect.objectContaining({ uid: 'demo-student', classIds: [] }),
    ]);
  });
  it('does not fall back to demo users for an authenticated production administrator', async () => {
    const app = createApp({
      environment: { NODE_ENV: 'production', AUTH_MODE: 'main' },
      store: createMemoryStore(),
      authMode: 'main',
      authClient: {
        introspect: async () => ({
          uid: 'u_48370eb1aba453c7',
          displayName: 'Root',
          avatarUrl: null,
          baseRole: 'student',
          roles: [],
          tags: [],
        }),
      },
      collectionsUploadDirectory: await directory(),
    });
    const response = await request(app)
      .get(`${base}?query=demo-student`)
      .set('Authorization', 'Bearer root')
      .expect(503);
    expect(response.body.data.error.code).toBe('user_directory_unavailable');
  });
  it('preserves an explicitly supplied directory even in demo mode', async () => {
    const app = createApp({
      environment: { NODE_ENV: 'test' },
      store: createMemoryStore(),
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
      collectionsUploadDirectory: await directory(),
      userDirectory: { list: async () => [], get: async () => null },
    });
    const response = await request(app)
      .get(`${base}?query=demo-student`)
      .set('X-Demo-User', 'demo-admin')
      .expect(200);
    expect(response.body.data.items).toEqual([]);
  });
});
