import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { RoleKey, ScopeRef } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { MainSiteAuthClient } from '../auth/main-site-auth-client.js';
import { createMemoryStore } from '../database/memory-store.js';

export const scopedMemberUid = 'main-scoped-member';
export const memberHeaders = { Authorization: `Bearer ${scopedMemberUid}` };
export const publicScope = { type: 'public', id: '*' };

export async function scopedEditFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'scoped-edit-'));
  const store = createMemoryStore();
  // Existing production databases do not contain the newly introduced actions.
  for (const permission of await store.permissions.list()) {
    if (['events.workspace.update', 'events.department_home.update'].includes(permission.action))
      await store.permissions.delete(permission.id);
  }
  for (const binding of await store.rolePermissions.list()) {
    if (['events.workspace.update', 'events.department_home.update'].includes(binding.action))
      await store.rolePermissions.delete(binding.id);
  }
  const app = createApp({
    environment: { NODE_ENV: 'production', AUTH_MODE: 'main' },
    store,
    authMode: 'main',
    authClient: new MainSiteAuthClient({
      apiBaseUrl: 'https://main.example',
      fetch: async (_url, init) => {
        const uid = new Headers(init?.headers).get('authorization')!.replace('Bearer ', '');
        return new Response(JSON.stringify({ success: true, user: { uid, fullName: uid } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    }),
    previewAllowedUids: [scopedMemberUid, 'demo-admin'],
    collectionsUploadDirectory: directory,
  });
  // Main authentication creates the subject; privileges are granted through the admin API.
  await request(app).get('/api/development/v1/me').set(memberHeaders).expect(200);
  async function assign(roleKey: RoleKey, scope: ScopeRef = publicScope) {
    return (
      await request(app)
        .post('/api/development/v1/admin/role-assignments')
        .set('Authorization', 'Bearer demo-admin')
        .send({ subjectUid: scopedMemberUid, roleKey, scope })
        .expect(201)
    ).body.data as { id: string };
  }
  return {
    app,
    store,
    assign,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
