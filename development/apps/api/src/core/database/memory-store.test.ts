import { describe, expect, it } from 'vitest';

import { createMemoryStore } from './memory-store.js';

const scope = { type: 'public', id: '*' };

describe('memory DevelopmentStore', () => {
  it('provides isolated CRUD repositories for every domain collection', async () => {
    const store = createMemoryStore({ seed: false });
    const cases = [
      [
        store.knowledge,
        {
          type: 'retrospective',
          title: '活动复盘模板',
          body: '保留有效流程。',
          status: 'published',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
      [
        store.announcements,
        {
          title: '社团招新公告',
          body: '本周五开放报名。',
          status: 'published',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
      [
        store.consultations,
        {
          title: '场地申请咨询',
          body: '如何申请东操场？',
          status: 'submitted',
          requesterUid: 'demo-student',
          ownerUid: 'demo-student',
          scope,
        },
      ],
      [
        store.clubs,
        {
          name: '校园音乐俱乐部',
          description: '面向所有同学的音乐社群。',
          status: 'active',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
      [
        store.clubMemberships,
        {
          clubId: 'club-a',
          memberUid: 'demo-student',
          status: 'active',
          ownerUid: 'demo-student',
          scope: { type: 'club', id: 'club-a' },
        },
      ],
      [
        store.activities,
        {
          title: '校园夜跑',
          description: '五公里轻松跑。',
          status: 'open',
          ownerUid: 'demo-sports-lead',
          scope,
        },
      ],
      [
        store.activityRegistrations,
        {
          activityId: 'activity-a',
          participantUid: 'demo-student',
          status: 'registered',
          ownerUid: 'demo-student',
          scope: { type: 'activity', id: 'activity-a' },
        },
      ],
      [
        store.sportsTeams,
        {
          name: '院篮球队',
          description: '篮球代表队。',
          status: 'active',
          ownerUid: 'demo-sports-lead',
          scope: { type: 'sports_team', id: 'pending' },
        },
      ],
      [
        store.sportsCheckins,
        {
          teamId: 'team-a',
          memberUid: 'demo-captain',
          checkinDate: '2026-07-22',
          status: 'present',
          ownerUid: 'demo-captain',
          scope: { type: 'sports_team', id: 'team-a' },
        },
      ],
      [
        store.liaisonResources,
        {
          name: '校团委活动联络窗口',
          description: '活动审批联络资源。',
          category: 'contact',
          visibility: 'public',
          status: 'active',
          ownerUid: 'demo-admin',
          scope,
        },
      ],
      [
        store.financeRecords,
        {
          title: '迎新活动预算',
          kind: 'budget',
          amountCents: 125000,
          status: 'submitted',
          ownerUid: 'demo-admin',
          scope: { type: 'activity', id: 'activity-a' },
        },
      ],
    ] as const;

    for (const [repository, input] of cases) {
      const created = await repository.create(input as never);
      expect(created).toMatchObject(input);
      expect(created.id).toEqual(expect.any(String));
      expect(created.createdAt).toEqual(expect.any(String));
      expect(created.updatedAt).toEqual(expect.any(String));

      const fetched = await repository.get(created.id);
      expect(fetched).toEqual(created);
      if (!fetched) throw new Error('created record was not found');
      fetched.status = 'mutated-outside-store';
      expect((await repository.get(created.id))?.status).toBe(input.status);

      const updated = await repository.update(created.id, { status: 'archived' });
      expect(updated?.status).toBe('archived');
      expect(updated?.updatedAt).toEqual(expect.any(String));
      expect(await repository.delete(created.id)).toBe(true);
      expect(await repository.get(created.id)).toBeNull();
    }
  });

  it('filters lists by status, scope and case-insensitive text query', async () => {
    const store = createMemoryStore({ seed: false });
    await store.knowledge.create({
      type: 'workflow',
      title: '活动审批流程',
      body: '提交申请',
      status: 'published',
      ownerUid: 'demo-admin',
      scope,
    });
    await store.knowledge.create({
      type: 'faq',
      title: '器材借用 FAQ',
      body: '仅体育部可见',
      status: 'draft',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'department', id: 'sports' },
    });

    expect(await store.knowledge.list({ status: 'published' })).toHaveLength(1);
    expect(await store.knowledge.list({ scopeType: 'department', scopeId: 'sports' })).toHaveLength(
      1,
    );
    expect(await store.knowledge.list({ query: 'FAQ' })).toMatchObject([{ title: '器材借用 FAQ' }]);
  });

  it('isolates separate stores and rolls back failed transactions', async () => {
    const first = createMemoryStore({ seed: false });
    const second = createMemoryStore({ seed: false });
    await first.knowledge.create({
      type: 'notice',
      title: '仅第一个 store 可见',
      body: '隔离测试',
      status: 'draft',
      ownerUid: 'demo-admin',
      scope,
    });
    expect(await second.knowledge.list()).toEqual([]);

    await expect(
      first.transaction(async (transactionStore) => {
        await transactionStore.announcements.create({
          title: '应回滚公告',
          body: '事务失败后不可见',
          status: 'draft',
          ownerUid: 'demo-admin',
          scope,
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await first.announcements.list()).toEqual([]);
  });

  it('starts with at least two useful records for every business module', async () => {
    const store = createMemoryStore();

    expect(await store.knowledge.list()).toHaveLength(3);
    expect(await store.announcements.list()).toHaveLength(2);
    expect(await store.consultations.list()).toHaveLength(2);
    expect(await store.proposals.list()).toHaveLength(1);
    expect(await store.clubs.list()).toHaveLength(2);
    expect(await store.activities.list()).toHaveLength(3);
    expect(await store.sportsTeams.list()).toHaveLength(2);
    expect(await store.liaisonResources.list()).toHaveLength(2);
    expect(await store.liaisonProblems.list()).toHaveLength(2);
    expect(await store.liaisonTeams.list()).toHaveLength(2);
    expect(await store.liaisonTeamMembers.list()).toHaveLength(2);
    expect(await store.liaisonPosts.list()).toHaveLength(3);
    expect(await store.liaisonOutcomes.list()).toMatchObject([
      {
        problemId: 'liaison-problem-lab-energy',
        version: 1,
        status: 'adopted',
      },
    ]);
    expect(await store.financeRecords.list()).toHaveLength(2);
  });
});
