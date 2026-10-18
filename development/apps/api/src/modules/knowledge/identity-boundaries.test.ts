import { describe, expect, it } from 'vitest';
import type { RoleKey, SocialOrganizationId, UserContext } from '@freebbs-development/contracts';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import { KnowledgeService } from './service.js';
import request from 'supertest';
import { createApp } from '../../app.js';

async function fixture(role: RoleKey) {
  const store = createMemoryStore();
  const uid = 'identity-scope-probe';
  await store.subjects.create({
    uid,
    displayName: uid,
    avatarUrl: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: { type: 'public', id: '*' },
  });
  await store.roleAssignments.create({
    subjectUid: uid,
    roleKey: role,
    expiresAt: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: { type: 'public', id: '*' },
  });
  const actor = await loadAuthorizationContext(
    store,
    {
      uid,
      displayName: uid,
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
    } satisfies UserContext,
    new Date(),
  );
  const service = new KnowledgeService(store);
  const input = (organizationId: SocialOrganizationId) => ({
    title: '组织内部经验',
    body: '内部内容',
    category: '工作记录',
    tags: [],
    type: 'faq' as const,
    audience: 'social_org' as const,
    organizationId,
    status: 'draft' as const,
    scope: { type: 'social_organization', id: organizationId },
  });
  const record = await store.knowledge.create({
    ...input('sports_center'),
    ownerUid: 'another-user',
  });
  return { store, actor, service, input, record };
}

describe('knowledge current organization boundary', () => {
  it('lists current youth organization entries through the actual browser query without widening the audience', async () => {
    const { store, actor, input } = await fixture('youth_league.organization.member');
    const own = await store.knowledge.create({
      ...input('tuanwei'),
      status: 'published',
      ownerUid: 'other',
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => actor },
    });
    const response = await request(app)
      .get('/api/development/v1/knowledge/entries?audience=social_org')
      .set('X-Demo-User', actor.uid)
      .expect(200);
    expect(response.body.data.map((entry: { id: string }) => entry.id)).toEqual([own.id]);
  });
  it('does not retain a revoked knowledge maintainer across a resource lock', async () => {
    const { store, actor, service, input } = await fixture('domain.arts_lead');
    const own = await service.create(actor, input('arts_center'));
    for (const row of await store.roleAssignments.list({ query: actor.uid }))
      if (row.subjectUid === actor.uid)
        await store.roleAssignments.update(row.id, { status: 'inactive' });
    await expect(service.update(actor, own.id, { title: 'revoked edit' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.transition(actor, own.id, 'published')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.create(actor, input('arts_center'))).rejects.toMatchObject({
      status: 404,
    });
    expect((await store.knowledge.get(own.id))?.status).toBe('draft');
  });
  it('keeps a legacy leader inside its organization across create, update, transition and lists', async () => {
    const { actor, service, input, record, store } = await fixture('domain.arts_lead');
    await expect(service.create(actor, input('arts_center'))).resolves.toMatchObject({
      organizationId: 'arts_center',
    });
    await expect(service.create(actor, input('sports_center'))).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.update(actor, record.id, { title: 'foreign change' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.transition(actor, record.id, 'published')).rejects.toMatchObject({
      status: 404,
    });
    expect(
      (await service.list({ audience: 'social_org' }, false, actor)).some(
        (row) => row.id === record.id,
      ),
    ).toBe(false);
    expect((await store.knowledge.get(record.id))?.title).toBe('组织内部经验');
  });
  it.each<RoleKey>(['counselor.youth_league_secretary', 'counselor.youth_league'])(
    'preserves all-organization business supervision for %s',
    async (role) => {
      const { actor, service, input, record } = await fixture(role);
      await expect(service.create(actor, input('sports_center'))).resolves.toMatchObject({
        organizationId: 'sports_center',
      });
      await expect(
        service.update(actor, record.id, { title: 'authorized supervision' }),
      ).resolves.toMatchObject({ title: 'authorized supervision' });
      await expect(service.transition(actor, record.id, 'published')).resolves.toMatchObject({
        status: 'published',
      });
    },
  );
  it.each<RoleKey>(['student_union.executive_president', 'student_union.presidium'])(
    'lets %s supervise the four union centers without entering other organizations',
    async (role) => {
      const { actor, service, input, record } = await fixture(role);
      await expect(
        service.update(actor, record.id, { title: 'union supervision' }),
      ).resolves.toMatchObject({ title: 'union supervision' });
      await expect(service.create(actor, input('tms'))).rejects.toMatchObject({ status: 404 });
    },
  );
  it('rejects inconsistent target scopes even for an otherwise authorized leader', async () => {
    const { actor, service, input } = await fixture('domain.arts_lead');
    const own = await service.create(actor, input('arts_center'));
    await expect(
      service.update(actor, own.id, {
        scope: { type: 'social_organization', id: 'sports_center' },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
