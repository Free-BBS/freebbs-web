import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { createMemoryStore } from './memory-store.js';
import { createMySqlStore } from './mysql-store.js';

const publicScope = { type: 'public', id: '*' } as const;

const contentCases = [
  {
    repository: 'knowledge',
    table: 'knowledge_entries',
    base: { type: 'faq', title: 'Entry', body: 'Body' },
    defaults: {
      category: 'general',
      tags: [],
      summary: '',
      maintainedAt: null,
      maintainerUid: null,
    },
    extra: {
      category: 'campus',
      tags: ['October', 'guide'],
      summary: 'Preview',
      maintainedAt: '2026-10-01T12:00:00.000+08:00',
      maintainerUid: 'demo-admin',
    },
    columns: ['category', 'tags', 'summary', 'maintained_at', 'maintainer_uid'],
  },
  {
    repository: 'consultations',
    table: 'consultations',
    base: {
      title: 'Question',
      body: 'Body',
      requesterUid: 'demo-student',
      assigneeUid: null,
      reply: null,
    },
    defaults: { dueAt: null },
    extra: { dueAt: '2026-10-01T12:00:00.000+08:00' },
    columns: ['due_at'],
  },
  {
    repository: 'proposals',
    table: 'proposals',
    base: {
      title: 'Proposal',
      problemDescription: 'Problem',
      proposedSolution: 'Solution',
      category: 'campus',
      submitterUid: 'demo-student',
      assigneeUid: null,
      publicProgress: '',
      internalNote: '',
    },
    defaults: { dueAt: null },
    extra: { dueAt: '2026-10-01T12:00:00.000+08:00' },
    columns: ['due_at'],
  },
  {
    repository: 'clubs',
    table: 'clubs',
    base: {
      name: 'Club',
      description: 'Description',
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
    },
    defaults: { category: 'general', contactName: '', publicContact: '' },
    extra: { category: 'outdoors', contactName: 'Captain', publicContact: 'Campus desk' },
    columns: ['category', 'contact_name', 'public_contact'],
  },
  {
    repository: 'activities',
    table: 'activities',
    base: {
      title: 'Activity',
      description: 'Description',
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
    },
    defaults: { registrationDeadline: null, capacity: null, contact: '' },
    extra: {
      registrationDeadline: '2026-10-01T12:00:00.000+08:00',
      capacity: 80,
      contact: 'Campus desk',
    },
    columns: ['registration_deadline', 'capacity', 'contact'],
  },
  {
    repository: 'sportsTeams',
    table: 'sports_teams',
    base: { name: 'Team', description: 'Description' },
    defaults: { season: '', trainingSchedule: '' },
    extra: { season: '2026秋季', trainingSchedule: '周三 18:00' },
    columns: ['season', 'training_schedule'],
  },
] as const;

describe('module readability record mappings', () => {
  it('seeds readable October-preview content', async () => {
    const store = createMemoryStore();
    expect(await store.knowledge.get('knowledge-workflow')).toMatchObject({
      category: '活动指南',
      tags: ['十月预告', '活动流程'],
      summary: '十月活动立项、审批和复盘速查。',
      maintainedAt: '2026-10-01T00:00:00.000Z',
      maintainerUid: 'demo-admin',
    });
    expect(await store.consultations.get('consultation-venue')).toMatchObject({
      dueAt: '2026-10-08T10:00:00.000Z',
    });
    expect(await store.proposals.get('proposal-night-lighting')).toMatchObject({
      dueAt: '2026-10-15T10:00:00.000Z',
    });
    expect(await store.clubs.get('club-running')).toMatchObject({
      category: '体育户外',
      contactName: '跑团联络员',
      publicContact: '每周三东大操场集合点',
    });
    expect(await store.activities.get('activity-ma-john-cup')).toMatchObject({
      registrationDeadline: '2026-10-08T10:00:00.000Z',
      capacity: 240,
      contact: '体育中心赛事咨询台',
    });
    expect(await store.sportsTeams.get('team-basketball')).toMatchObject({
      season: '2026秋季',
      trainingSchedule: '每周二、四 18:00–20:00，篮球馆',
    });
  });
  for (const testCase of contentCases) {
    const expected = Object.fromEntries(
      Object.entries(testCase.extra).map(([key, value]) => [
        key,
        typeof value === 'string' && value.includes('+08:00') ? '2026-10-01T04:00:00.000Z' : value,
      ]),
    );
    const input = { ...testCase.base, status: 'draft', ownerUid: 'demo-admin', scope: publicScope };
    it(`defaults and round-trips ${testCase.repository} in memory`, async () => {
      const repository = createMemoryStore({ seed: false })[testCase.repository];
      const created = await repository.create(input as never);
      expect(created).toMatchObject(testCase.defaults);
      expect(await repository.update(created.id, testCase.extra as never)).toMatchObject(expected);
      expect(await repository.get(created.id)).toMatchObject(expected);
      expect(await repository.update(created.id, testCase.defaults as never)).toMatchObject(
        testCase.defaults,
      );
      expect(await repository.get(created.id)).toMatchObject(testCase.base);
    });
    it(`encodes and decodes ${testCase.repository} in MySQL`, async () => {
      const row = {
        id: 'record-1',
        status: 'draft',
        owner_uid: 'demo-admin',
        scope_type: 'public',
        scope_id: '*',
        created_at: '2026-10-01 00:00:00.000',
        updated_at: '2026-10-01 00:00:00.000',
        ...Object.fromEntries(
          testCase.columns.map((column, index) => {
            const value = Object.values(testCase.extra)[index];
            return [
              column,
              Array.isArray(value)
                ? JSON.stringify(value)
                : typeof value === 'string' && value.includes('+08:00')
                  ? '2026-10-01 04:00:00.000'
                  : value,
            ];
          }),
        ),
      };
      const execute = vi
        .fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([[row], []])
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([[row], []]);
      const store = createMySqlStore({ pool: { execute } as unknown as Pool }).store;
      const repository = store[testCase.repository];
      expect(await repository.create({ ...input, ...testCase.extra } as never)).toMatchObject(
        expected,
      );
      for (const column of testCase.columns) expect(execute.mock.calls[0]?.[0]).toContain(column);
      if ('tags' in testCase.extra)
        expect(execute.mock.calls[0]?.[1]).toContain(JSON.stringify(testCase.extra.tags));
      if (testCase.columns.some((column) => /_at$|deadline$/.test(column)))
        expect(execute.mock.calls[0]?.[1]).toContainEqual(new Date('2026-10-01T04:00:00.000Z'));
      expect(await repository.update('record-1', testCase.extra as never)).toMatchObject(expected);
      for (const column of testCase.columns)
        expect(execute.mock.calls[2]?.[0]).toContain(`${column} = ?`);
    });
    it(`supplies ${testCase.repository} MySQL defaults for legacy creates`, async () => {
      const row = {
        id: 'legacy',
        status: 'draft',
        owner_uid: 'demo-admin',
        scope_type: 'public',
        scope_id: '*',
        created_at: '2026-10-01 00:00:00.000',
        updated_at: '2026-10-01 00:00:00.000',
        ...Object.fromEntries(
          testCase.columns.map((column, index) => [
            column,
            Object.values(testCase.defaults)[index],
          ]),
        ),
      };
      const execute = vi
        .fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([[row], []]);
      const repository = createMySqlStore({ pool: { execute } as unknown as Pool }).store[
        testCase.repository
      ];
      expect(await repository.create(input as never)).toMatchObject(testCase.defaults);
      const sql = execute.mock.calls[0]![0] as string;
      const columns = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(', ');
      const values = execute.mock.calls[0]![1] as unknown[];
      for (const [index, column] of testCase.columns.entries()) {
        const value = Object.values(testCase.defaults)[index];
        expect(values[columns.indexOf(column)]).toEqual(Array.isArray(value) ? '[]' : value);
      }
    });
  }
  it('parameterizes module filters in MySQL, including false and exact JSON tags', async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const store = createMySqlStore({ pool: { execute } as unknown as Pool }).store;
    await store.knowledge.list({
      category: 'campus',
      tag: 'quote"tag',
      organizationId: 'sports_center',
      query: 'Preview',
    });
    expect(execute.mock.calls[0]![0]).toContain('CAST(category AS BINARY) = CAST(? AS BINARY)');
    expect(execute.mock.calls[0]![0]).toContain(
      'CAST(organization_id AS BINARY) = CAST(? AS BINARY)',
    );
    expect(execute.mock.calls[0]![0]).toContain('JSON_CONTAINS(tags, ?)');
    expect(execute.mock.calls[0]![1]).toEqual([
      'campus',
      'sports_center',
      JSON.stringify('quote"tag'),
      '%preview%',
      'preview',
    ]);
    await store.activities.list({ standingActivity: false });
    expect(execute.mock.calls[1]![0]).toContain('standing_activity = ?');
    expect(execute.mock.calls[1]![1]).toEqual([false]);
    await store.sportsTeams.list({ season: '2026秋季' });
    expect(execute.mock.calls[2]![0]).toContain('CAST(season AS BINARY) = CAST(? AS BINARY)');
    expect(execute.mock.calls[2]![1]).toEqual(['2026秋季']);
    await store.clubs.list({ category: 'outdoors' });
    expect(execute.mock.calls[3]![0]).toContain('CAST(category AS BINARY) = CAST(? AS BINARY)');
    expect(execute.mock.calls[3]![1]).toEqual(['outdoors']);
  });
});

describe('platform content store contract', () => {
  it('persists proposals with separated public and internal progress', async () => {
    const store = createMemoryStore({ seed: false });
    const proposal = await store.proposals.create({
      title: '延长场馆开放时间',
      problemDescription: '晚间场地不足',
      proposedSolution: '试行延长开放一小时',
      category: 'campus_service',
      submitterUid: 'demo-student',
      assigneeUid: null,
      publicProgress: '已提交',
      internalNote: '等待负责人分派',
      status: 'submitted',
      ownerUid: 'demo-student',
      scope: publicScope,
    });

    expect(await store.proposals.get(proposal.id)).toMatchObject({
      title: '延长场馆开放时间',
      publicProgress: '已提交',
      internalNote: '等待负责人分派',
    });
  });

  it('persists ordered activity milestones and competition fixtures', async () => {
    const store = createMemoryStore({ seed: false });
    const milestone = await store.activityMilestones.create({
      activityId: 'activity-ma-yuehan',
      occursAt: '2026-10-01T08:00:00.000Z',
      title: '初赛',
      type: 'preliminary',
      description: '小组循环赛开始',
      completed: false,
      displayOrder: 2,
      status: 'scheduled',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'social_organization', id: 'sports_center' },
    });
    const fixture = await store.competitionFixtures.create({
      activityId: 'activity-ma-yuehan',
      round: '小组赛',
      participantA: '电子系',
      participantB: '自动化系',
      scheduledAt: '2026-10-01T09:00:00.000Z',
      location: '东大操场',
      score: null,
      status: 'scheduled',
      ownerUid: 'demo-sports-lead',
      scope: { type: 'social_organization', id: 'sports_center' },
    });

    expect((await store.activityMilestones.get(milestone.id))?.displayOrder).toBe(2);
    expect((await store.competitionFixtures.get(fixture.id))?.participantB).toBe('自动化系');
  });
});
