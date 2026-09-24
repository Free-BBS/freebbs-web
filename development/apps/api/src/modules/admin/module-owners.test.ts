import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const adminHeaders = { 'X-Demo-User': 'demo-admin' };
const basePath = '/api/development/v1';

function adminApp() {
  const store = createMemoryStore();
  const app = createApp({
    store,
    databaseMode: 'memory',
    authMode: 'demo',
    authClient: new DemoAuthClient(['demo-admin', 'demo-student']),
  });
  return { app, store };
}

describe('module and owner administration', () => {
  it('validates every owner target and replaces role, subject and team owners atomically', async () => {
    const { app, store } = adminApp();

    const replaced = await request(app)
      .put(`${basePath}/admin/modules/sports/owners`)
      .set(adminHeaders)
      .send({
        owners: [
          { ownerType: 'role', ownerId: 'domain.sports_lead' },
          { ownerType: 'subject', ownerId: 'demo-student' },
          { ownerType: 'team', ownerId: 'team-basketball' },
        ],
      })
      .expect(200);

    expect(replaced.body.data).toMatchObject({
      moduleId: 'sports',
      owners: [
        { ownerType: 'role', ownerId: 'domain.sports_lead', status: 'active' },
        { ownerType: 'subject', ownerId: 'demo-student', status: 'active' },
        { ownerType: 'team', ownerId: 'team-basketball', status: 'active' },
      ],
    });

    const auditBeforeFailure = await store.auditLogs.list({
      query: 'admin.module_owners.replace',
    });
    await request(app)
      .put(`${basePath}/admin/modules/sports/owners`)
      .set(adminHeaders)
      .send({
        owners: [
          { ownerType: 'role', ownerId: 'department.sports_director' },
          { ownerType: 'subject', ownerId: 'missing-subject' },
        ],
      })
      .expect(400);

    const listed = await request(app)
      .get(`${basePath}/admin/modules/sports/owners`)
      .set(adminHeaders)
      .expect(200);
    expect(listed.body.data.owners).toEqual(replaced.body.data.owners);
    expect(
      await store.auditLogs.list({
        query: 'admin.module_owners.replace',
      }),
    ).toHaveLength(auditBeforeFailure.length);

    const audit = auditBeforeFailure.at(0);
    expect(audit?.details).toMatchObject({
      oldOwners: [],
      newOwners: [
        { ownerType: 'role', ownerId: 'domain.sports_lead' },
        { ownerType: 'subject', ownerId: 'demo-student' },
        { ownerType: 'team', ownerId: 'team-basketball' },
      ],
    });
  });

  it('archives, restores and upserts owners while returning only the active replace-set', async () => {
    const { app, store } = adminApp();
    const ownersPath = `${basePath}/admin/modules/sports/owners`;

    await request(app)
      .put(ownersPath)
      .set(adminHeaders)
      .send({ owners: [{ ownerType: 'subject', ownerId: 'demo-student' }] })
      .expect(200);
    await request(app).put(ownersPath).set(adminHeaders).send({ owners: [] }).expect(200);
    const restored = await request(app)
      .put(ownersPath)
      .set(adminHeaders)
      .send({
        owners: [
          { ownerType: 'subject', ownerId: 'demo-student' },
          { ownerType: 'team', ownerId: 'team-basketball' },
        ],
      })
      .expect(200);

    expect(restored.body.data.owners).toEqual([
      expect.objectContaining({ ownerType: 'subject', ownerId: 'demo-student', status: 'active' }),
      expect.objectContaining({ ownerType: 'team', ownerId: 'team-basketball', status: 'active' }),
    ]);
    const stored = (await store.moduleOwners.list({ query: 'sports' })).filter(
      ({ moduleId }) => moduleId === 'sports',
    );
    expect(
      stored.filter(
        ({ ownerType, ownerId }) => ownerType === 'subject' && ownerId === 'demo-student',
      ),
    ).toHaveLength(1);
  });

  it('removes runtime policies and denies module routes immediately after disable', async () => {
    const { app, store } = adminApp();

    const before = await request(app)
      .get(`${basePath}/me`)
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    expect(
      before.body.data.policies.some(
        (policy: { action: string }) => policy.action === 'sports.team.read',
      ),
    ).toBe(true);

    await request(app)
      .patch(`${basePath}/admin/modules`)
      .set(adminHeaders)
      .send({ moduleId: 'sports', enabled: false })
      .expect(200);

    const after = await request(app)
      .get(`${basePath}/me`)
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    expect(
      after.body.data.policies.some((policy: { action: string }) =>
        policy.action.startsWith('sports.'),
      ),
    ).toBe(false);
    await request(app)
      .get(`${basePath}/sports/teams`)
      .set('X-Demo-User', 'demo-student')
      .expect(503);

    const audit = (await store.auditLogs.list({ query: 'admin.module.update' })).at(0);
    expect(audit?.details).toEqual({
      old: { enabled: true, status: 'enabled' },
      new: { enabled: false, status: 'disabled' },
    });
  });
});
