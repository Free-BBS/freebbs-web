import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { ClubsService } from './service.js';

function actorWithPolicies(scopeIds: string[]): AuthorizationContext {
  return {
    uid: 'club-maintainer',
    displayName: 'Club maintainer',
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
    policies: scopeIds.map((id) => ({
      id: `club-${id}`,
      action: 'clubs.update',
      resource: 'club',
      effect: 'allow' as const,
      scope: { type: 'organization', id },
    })),
  };
}

describe('clubs security regressions', () => {
  it('lets an authoritative liaison domain assignment update an interest group', async () => {
    const store = createMemoryStore();
    const actor: AuthorizationContext = {
      uid: 'liaison-lead',
      displayName: 'Liaison lead',
      avatarUrl: null,
      baseRole: 'student',
      roles: ['domain.liaison_lead'],
      tags: [],
    };
    await store.subjects.create({
      uid: actor.uid,
      displayName: actor.displayName,
      avatarUrl: actor.avatarUrl,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    await store.roleAssignments.create({
      subjectUid: actor.uid,
      roleKey: 'domain.liaison_lead',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => actor },
    });

    await request(app)
      .patch('/api/development/v1/clubs')
      .set('X-Demo-User', actor.uid)
      .send({ id: 'club-running', description: 'Maintained by the liaison domain.' })
      .expect(200);
  });

  it('rechecks the locked current scope and requires both sides of a scope migration', async () => {
    const base = createMemoryStore();
    const club = await base.clubs.create({
      name: 'Scoped club',
      description: 'Original',
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status: 'draft',
      ownerUid: 'owner',
      scope: { type: 'organization', id: 'org-a' },
    });
    let raced = false;
    const store: DevelopmentStore = {
      ...base,
      transaction: async (operation) => {
        if (!raced) {
          raced = true;
          await base.clubs.update(club.id, { scope: { type: 'organization', id: 'org-c' } });
        }
        return base.transaction(operation);
      },
    };
    const actor = actorWithPolicies(['org-a', 'org-b']);
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => actor },
    });

    await request(app)
      .patch('/api/development/v1/clubs')
      .set('X-Demo-User', actor.uid)
      .send({ id: club.id, scope: { type: 'organization', id: 'org-b' } })
      .expect(404);
    expect(await base.clubs.get(club.id)).toMatchObject({
      scope: { type: 'organization', id: 'org-c' },
    });
  });

  it('rejects joining a non-active club without client-controlled identity', async () => {
    const store = createMemoryStore();
    await store.clubs.update('club-running', { status: 'archived' });
    const actor: AuthorizationContext = {
      uid: 'ordinary',
      displayName: 'Ordinary',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
    };
    await store.subjects.create({
      uid: actor.uid,
      displayName: actor.displayName,
      avatarUrl: actor.avatarUrl,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => actor },
    });
    await request(app)
      .post('/api/development/v1/clubs/club-running/memberships')
      .set('X-Demo-User', actor.uid)
      .send({})
      .expect(409);
  });
  it('applies scoped allow and deny per record to archived listing and maintenance', async () => {
    const store = createMemoryStore();
    const allowedClub = await store.clubs.create({
      name: 'Allowed archive',
      description: 'Visible to its maintainer.',
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status: 'archived',
      ownerUid: 'owner',
      scope: { type: 'organization', id: 'org-a' },
    });
    const deniedClub = await store.clubs.create({
      name: 'Denied archive',
      description: 'Hidden by an explicit deny.',
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status: 'archived',
      ownerUid: 'owner',
      scope: { type: 'organization', id: 'org-b' },
    });
    const actor: AuthorizationContext = {
      ...actorWithPolicies(['org-a', 'org-b']),
      policies: [
        { id: 'read', action: 'clubs.read', resource: 'club', effect: 'allow' },
        ...actorWithPolicies(['org-a', 'org-b']).policies!,
        {
          id: 'deny-org-b',
          action: 'clubs.update',
          resource: 'club',
          effect: 'deny',
          scope: { type: 'organization', id: 'org-b' },
        },
      ],
    };
    const service = new ClubsService(store);

    expect((await service.list(actor, {})).map((club) => club.id)).toContain(allowedClub.id);
    expect((await service.list(actor, {})).map((club) => club.id)).not.toContain(deniedClub.id);
    await expect(service.update(actor, deniedClub.id, { name: 'Forbidden' })).rejects.toMatchObject(
      {
        status: 404,
        code: 'club_not_found',
      },
    );
  });
});
