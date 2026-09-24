import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { setOrganizationMembership } from '../admin/organization-membership-service.js';

const identity = (uid: string): UserContext => ({
  uid,
  displayName: uid,
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
});

async function fixture() {
  const store = createMemoryStore();
  for (const uid of ['liaison-member', 'arts-member']) {
    await store.subjects.create({
      uid,
      displayName: uid,
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
  }
  await setOrganizationMembership(
    store,
    { subjectUid: 'liaison-member', organizationId: 'liaison_center', level: 'member' },
    { actorUid: 'demo-admin' },
  );
  await setOrganizationMembership(
    store,
    { subjectUid: 'arts-member', organizationId: 'arts_center', level: 'member' },
    { actorUid: 'demo-admin' },
  );
  const users = new Set(['liaison-member', 'arts-member']);
  const app = createApp({
    store,
    authMode: 'demo',
    authClient: {
      introspect: async (uid) => (users.has(uid) ? identity(uid) : null),
    },
  });
  return { app };
}

const groupInput = {
  name: '桌游同好会',
  description: '每周组织桌游交流活动。',
  status: 'draft',
  scope: { type: 'public', id: '*' },
};

describe('interest groups API', () => {
  it('uses the canonical route, keeps the clubs alias, and assigns maintenance to Liaison', async () => {
    const { app } = await fixture();

    const created = await request(app)
      .post('/api/development/v1/interest-groups')
      .set('X-Demo-User', 'liaison-member')
      .send(groupInput)
      .expect(201);
    expect(created.body.data).toMatchObject({
      name: groupInput.name,
      organizationId: 'liaison_center',
    });

    await request(app)
      .post('/api/development/v1/interest-groups')
      .set('X-Demo-User', 'arts-member')
      .send(groupInput)
      .expect(403);

    const canonical = await request(app)
      .get('/api/development/v1/interest-groups')
      .set('X-Demo-User', 'liaison-member')
      .expect(200);
    const legacy = await request(app)
      .get('/api/development/v1/clubs')
      .set('X-Demo-User', 'liaison-member')
      .expect(200);

    expect(legacy.body.data).toEqual(canonical.body.data);
  });
});
