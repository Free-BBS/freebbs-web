import { describe, expect, it } from 'vitest';

import { createMemoryStore } from './memory-store.js';

const scope = { type: 'public', id: '*' };

describe('memory store regressions', () => {
  it('serializes concurrent successful transactions without losing either write', async () => {
    const store = createMemoryStore({ seed: false });
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = store.transaction(async (transactionStore) => {
      await transactionStore.announcements.create({
        title: 'first transaction',
        body: 'must survive',
        status: 'published',
        ownerUid: 'demo-admin',
        scope,
      });
      await firstGate;
    });
    const second = store.transaction(async (transactionStore) => {
      await transactionStore.announcements.create({
        title: 'second transaction',
        body: 'must also survive',
        status: 'published',
        ownerUid: 'demo-admin',
        scope,
      });
    });

    await Promise.resolve();
    await Promise.resolve();
    releaseFirst();
    await Promise.all([first, second]);

    expect((await store.announcements.list()).map(({ title }) => title).sort()).toEqual([
      'first transaction',
      'second transaction',
    ]);
  });

  it('provides CRUD for every core repository', async () => {
    const store = createMemoryStore({ seed: false });
    const cases = [
      [
        store.subjects,
        {
          uid: 'uid-a',
          displayName: '同学 A',
          avatarUrl: null,
          status: 'active',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
      [
        store.roles,
        {
          key: 'platform.super_admin',
          name: '最高权限',
          status: 'active',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
      [
        store.permissions,
        {
          action: 'knowledge.read',
          resource: 'knowledge_entry',
          status: 'active',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
      [
        store.rolePermissions,
        {
          roleKey: 'platform.super_admin',
          action: 'knowledge.read',
          resource: 'knowledge_entry',
          effect: 'allow',
          status: 'active',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
      [
        store.roleAssignments,
        {
          subjectUid: 'uid-a',
          roleKey: 'platform.super_admin',
          expiresAt: '2027-01-02T03:04:05.006Z',
          status: 'active',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
      [
        store.tagDefinitions,
        {
          key: 'extension.test',
          requiredScopeType: null,
          metadata: { resourceTypes: [] },
          name: '测试标签',
          description: '测试扩展标签。',
          status: 'active',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
      [
        store.tagAssignments,
        {
          subjectUid: 'uid-a',
          tagKey: 'extension.test',
          expiresAt: null,
          status: 'active',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
      [
        store.modules,
        {
          moduleId: 'dashboard',
          name: '工作台',
          description: '工作台模块',
          enabled: true,
          status: 'enabled',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
      [
        store.moduleOwners,
        {
          moduleId: 'dashboard',
          ownerType: 'role',
          ownerId: 'platform.super_admin',
          status: 'active',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
      [
        store.auditLogs,
        {
          actorUid: 'demo-admin',
          action: 'module.update',
          resourceType: 'module',
          resourceId: 'dashboard',
          details: { enabled: true },
          status: 'recorded',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
    ] as const;

    for (const [repository, input] of cases) {
      const created = await repository.create(input as never);
      expect(await repository.get(created.id)).toMatchObject(input);
      expect(await repository.update(created.id, { status: 'archived' })).toMatchObject({
        status: 'archived',
      });
      expect(await repository.delete(created.id)).toBe(true);
    }
  });

  it('searches only the repository text fields', async () => {
    const store = createMemoryStore({ seed: false });
    await store.knowledge.create({
      type: 'faq',
      title: '器材借用',
      body: '如何借用公共器材。',
      status: 'published',
      ownerUid: 'needle-only-in-owner',
      scope,
    });

    expect(await store.knowledge.list({ query: 'needle-only-in-owner' })).toEqual([]);
    expect(await store.knowledge.list({ query: '公共器材' })).toHaveLength(1);
  });
  it('normalizes date contracts and rejects invalid dates or unsafe money values', async () => {
    const store = createMemoryStore({ seed: false });
    const assignment = await store.roleAssignments.create({
      subjectUid: 'uid-a',
      roleKey: 'platform.super_admin',
      expiresAt: '2027-01-02T11:04:05.006+08:00',
      status: 'active',
      ownerUid: 'demo-admin',
      scope,
    });

    expect(assignment.expiresAt).toBe('2027-01-02T03:04:05.006Z');
    await expect(
      store.sportsCheckins.create({
        teamId: 'team-a',
        memberUid: 'uid-a',
        checkinDate: '2026-7-2',
        status: 'present',
        ownerUid: 'demo-admin',
        scope: { type: 'sports_team', id: 'team-a' },
      }),
    ).rejects.toThrow('calendar date');
    await expect(
      store.financeRecords.create({
        title: 'unsafe amount',
        kind: 'budget',
        amountCents: Number.MAX_SAFE_INTEGER + 1,
        activityId: null,
        status: 'draft',
        ownerUid: 'demo-admin',
        scope,
      }),
    ).rejects.toThrow('safe integer');
  });
});
