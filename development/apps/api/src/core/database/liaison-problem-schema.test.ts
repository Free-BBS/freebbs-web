import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';

import { createMemoryStore } from './memory-store.js';
import { createMySqlStore } from './mysql-store.js';
import { RecordConflictError } from './record-conflict-error.js';
import type { DevelopmentStore, LiaisonProblemRecord, NewRecord } from './types.js';

const publicScope = { type: 'public', id: '*' } as const;

const problemInput: NewRecord<LiaisonProblemRecord> = {
  title: '校园能耗可视化',
  summary: '把真实能耗数据转成同学可理解的展示。',
  background: '课题组希望验证面向校园场景的可视化方案。',
  sourceType: 'lab' as const,
  sourceName: '校园计算实验室',
  tags: ['data', 'quote"tag', '50%_off', 'x\\y'],
  expectedOutcome: '一份可运行的原型和说明。',
  constraints: '不得公开原始敏感数据。',
  startsAt: '2026-10-01T12:00:00.123+08:00',
  deadline: '2026-11-01T12:00:00.456+08:00',
  publicContact: '联络中心公开咨询台',
  internalContactNote: '仅供内部回访，不进入公开投影。',
  recorderUid: 'demo-liaison-member',
  reviewerUid: null,
  reviewedAt: null,
  reviewNote: null,
  status: 'open',
  ownerUid: 'demo-liaison-member',
  scope: publicScope,
};

async function seedLiaisonSubjects(store: DevelopmentStore): Promise<void> {
  for (const uid of ['demo-liaison-member', 'demo-student', 'demo-captain']) {
    await store.subjects.create({
      uid,
      displayName: uid,
      avatarUrl: null,
      status: 'active',
      ownerUid: 'test',
      scope: publicScope,
    });
  }
}

describe('liaison problem-board repository contract', () => {
  it('supplies stable defaults and exact tag filters for new problems', async () => {
    const store = createMemoryStore({ seed: false });
    await seedLiaisonSubjects(store);
    const created = await store.liaisonProblems.create({
      title: '最小问题',
      background: '背景',
      sourceType: 'campus',
      sourceName: '校园服务方',
      expectedOutcome: '说明',
      constraints: '无',
      internalContactNote: '',
      recorderUid: 'demo-liaison-member',
      status: 'draft',
      ownerUid: 'demo-liaison-member',
      scope: publicScope,
    } as never);

    expect(created).toMatchObject({
      summary: '',
      tags: [],
      startsAt: null,
      deadline: null,
      publicContact: '',
      reviewerUid: null,
      reviewedAt: null,
      reviewNote: null,
    });
    await store.liaisonProblems.update(created.id, { tags: ['quote"tag', 'Café'] });
    expect(await store.liaisonProblems.list({ tag: 'quote"tag' })).toHaveLength(1);
    expect(await store.liaisonProblems.list({ tag: 'quote' })).toEqual([]);
  });

  it('round-trips problem fields, normalized instants and deep-cloned tags in memory', async () => {
    const store = createMemoryStore({ seed: false });
    await seedLiaisonSubjects(store);
    const created = await store.liaisonProblems.create(problemInput);

    expect(created).toMatchObject({
      ...problemInput,
      startsAt: '2026-10-01T04:00:00.123Z',
      deadline: '2026-11-01T04:00:00.456Z',
    });
    created.tags.push('mutated');
    expect((await store.liaisonProblems.get(created.id))?.tags).toEqual(problemInput.tags);
  });

  it('supports parallel teams while rejecting duplicate memberships and outcome versions', async () => {
    const store = createMemoryStore({ seed: false });
    await seedLiaisonSubjects(store);
    const problem = await store.liaisonProblems.create(problemInput);
    const firstTeam = await store.liaisonTeams.create({
      problemId: problem.id,
      name: '数据叙事队',
      proposal: '从公共指标切入。',
      maintainerUid: 'demo-student',
      status: 'active',
      ownerUid: 'demo-student',
      scope: { type: 'liaison_problem', id: problem.id },
    });
    const secondTeam = await store.liaisonTeams.create({
      problemId: problem.id,
      name: '可视分析队',
      proposal: '从交互原型切入。',
      maintainerUid: 'demo-captain',
      status: 'active',
      ownerUid: 'demo-captain',
      scope: { type: 'liaison_problem', id: problem.id },
    });
    expect(await store.liaisonTeams.list({ scopeId: problem.id })).toHaveLength(2);

    const membership = {
      problemId: problem.id,
      teamId: firstTeam.id,
      memberUid: 'demo-student',
      role: 'maintainer' as const,
      joinedAt: '2026-10-02T03:04:05.006Z',
      status: 'active',
      ownerUid: 'demo-student',
      scope: { type: 'liaison_team', id: firstTeam.id },
    };
    const membershipAttempts = await Promise.allSettled([
      store.liaisonTeamMembers.create(membership),
      store.liaisonTeamMembers.create(membership),
    ]);
    expect(membershipAttempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(membershipAttempts.filter(({ status }) => status === 'rejected')).toMatchObject([
      { reason: expect.any(RecordConflictError) },
    ]);

    const outcome = {
      problemId: problem.id,
      teamId: secondTeam.id,
      version: 1,
      title: '第一版原型',
      description: '完成核心图表。',
      linkUrl: 'https://example.invalid/demo',
      attachmentRef: null,
      submittedAt: '2026-10-08T03:04:05.006Z',
      adoptedAt: null,
      adoptedByUid: null,
      status: 'submitted',
      ownerUid: 'demo-captain',
      scope: { type: 'liaison_team', id: secondTeam.id },
    } as const;
    const outcomeAttempts = await Promise.allSettled([
      store.liaisonOutcomes.create(outcome),
      store.liaisonOutcomes.create(outcome),
    ]);
    expect(outcomeAttempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomeAttempts.filter(({ status }) => status === 'rejected')).toMatchObject([
      { reason: expect.any(RecordConflictError) },
    ]);
    await expect(store.liaisonOutcomes.create({ ...outcome, version: 0 })).rejects.toThrow(
      'version must be a positive safe integer',
    );
  });

  it('encodes JSON tags and UTC DATETIME(3) fields in MySQL without searching serialized JSON', async () => {
    const row = {
      id: 'problem-1',
      title: problemInput.title,
      summary: problemInput.summary,
      background: problemInput.background,
      source_type: problemInput.sourceType,
      source_name: problemInput.sourceName,
      tags: JSON.stringify(problemInput.tags),
      expected_outcome: problemInput.expectedOutcome,
      constraints_text: problemInput.constraints,
      starts_at: '2026-10-01 04:00:00.123',
      deadline: '2026-11-01 04:00:00.456',
      public_contact: problemInput.publicContact,
      internal_contact_note: problemInput.internalContactNote,
      recorder_uid: problemInput.recorderUid,
      reviewer_uid: null,
      reviewed_at: null,
      review_note: null,
      status: 'open',
      owner_uid: problemInput.ownerUid,
      scope_type: 'public',
      scope_id: '*',
      created_at: '2026-10-01 00:00:00.000',
      updated_at: '2026-10-01 00:00:00.000',
    };
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[row], []])
      .mockResolvedValueOnce([[], []]);
    const store = createMySqlStore({ pool: { execute } as unknown as Pool }).store;

    await expect(store.liaisonProblems.create(problemInput)).resolves.toMatchObject({
      startsAt: '2026-10-01T04:00:00.123Z',
      deadline: '2026-11-01T04:00:00.456Z',
      tags: problemInput.tags,
    });
    expect(execute.mock.calls[0]?.[1]).toContain(JSON.stringify(problemInput.tags));
    expect(execute.mock.calls[0]?.[1]).toContainEqual(new Date('2026-10-01T04:00:00.123Z'));

    await store.liaisonProblems.list({ tag: 'quote"tag' });
    expect(execute.mock.calls[2]?.[0]).toContain('JSON_CONTAINS(tags, ?)');
    expect(execute.mock.calls[2]?.[1]).toEqual([JSON.stringify('quote"tag')]);

    execute.mockResolvedValueOnce([[], []]);
    await store.liaisonProblems.list({ query: 'quote"tag' });
    const [sql, values] = execute.mock.calls.at(-1)!;
    expect(sql).toContain("JSON_TABLE(tags, '$[*]'");
    expect(sql).not.toContain('tags)) LIKE');
    expect((values as unknown[]).at(-1)).toBe('quote"tag');
  });

  it.each([
    {
      repository: 'liaisonTeams',
      input: {
        problemId: 'problem-1',
        name: 'Team',
        proposal: 'Proposal',
        maintainerUid: 'student-1',
      },
      row: {
        problem_id: 'problem-1',
        name: 'Team',
        proposal: 'Proposal',
        maintainer_uid: 'student-1',
      },
      expected: { problemId: 'problem-1', maintainerUid: 'student-1' },
    },
    {
      repository: 'liaisonTeamMembers',
      input: {
        problemId: 'problem-1',
        teamId: 'team-1',
        memberUid: 'student-1',
        role: 'member',
        joinedAt: '2026-10-02T11:04:05.006+08:00',
      },
      row: {
        problem_id: 'problem-1',
        team_id: 'team-1',
        member_uid: 'student-1',
        member_role: 'member',
        joined_at: '2026-10-02 03:04:05.006',
      },
      expected: { memberUid: 'student-1', joinedAt: '2026-10-02T03:04:05.006Z' },
    },
    {
      repository: 'liaisonPosts',
      input: {
        problemId: 'problem-1',
        teamId: null,
        authorUid: 'student-1',
        kind: 'discussion',
        body: 'Question',
        hiddenAt: null,
        hiddenByUid: null,
      },
      row: {
        problem_id: 'problem-1',
        team_id: null,
        author_uid: 'student-1',
        post_kind: 'discussion',
        body: 'Question',
        hidden_at: null,
        hidden_by_uid: null,
      },
      expected: { authorUid: 'student-1', kind: 'discussion', hiddenAt: null },
    },
    {
      repository: 'liaisonOutcomes',
      input: {
        problemId: 'problem-1',
        teamId: 'team-1',
        version: 2,
        title: 'Outcome',
        description: 'Description',
        linkUrl: null,
        attachmentRef: null,
        submittedAt: '2026-10-08T11:04:05.006+08:00',
        adoptedAt: null,
        adoptedByUid: null,
      },
      row: {
        problem_id: 'problem-1',
        team_id: 'team-1',
        version: '2',
        title: 'Outcome',
        description: 'Description',
        link_url: null,
        attachment_ref: null,
        submitted_at: '2026-10-08 03:04:05.006',
        adopted_at: null,
        adopted_by_uid: null,
      },
      expected: { version: 2, submittedAt: '2026-10-08T03:04:05.006Z' },
    },
  ] as const)(
    'round-trips $repository fields through the MySQL adapter',
    async ({ repository, input, row, expected }) => {
      const execute = vi
        .fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }, []])
        .mockResolvedValueOnce([
          [
            {
              id: 'record-1',
              ...row,
              status: 'active',
              owner_uid: 'student-1',
              scope_type: 'liaison_problem',
              scope_id: 'problem-1',
              created_at: '2026-10-01 00:00:00.000',
              updated_at: '2026-10-01 00:00:00.000',
            },
          ],
          [],
        ]);
      const store = createMySqlStore({ pool: { execute } as unknown as Pool }).store;
      const record = await store[repository].create({
        ...input,
        status: 'active',
        ownerUid: 'student-1',
        scope: { type: 'liaison_problem', id: 'problem-1' },
      } as never);
      expect(record).toMatchObject(expected);
    },
  );

  it('maps MySQL compound-key collisions to stable repository conflicts', async () => {
    const duplicate = { code: 'ER_DUP_ENTRY', errno: 1062 };
    const execute = vi.fn().mockRejectedValue(duplicate);
    const store = createMySqlStore({ pool: { execute } as unknown as Pool }).store;
    await expect(
      store.liaisonTeamMembers.create({
        problemId: 'problem-1',
        teamId: 'team-1',
        memberUid: 'student-1',
        role: 'member',
        joinedAt: '2026-10-02T03:04:05.006Z',
        status: 'active',
        ownerUid: 'student-1',
        scope: { type: 'liaison_team', id: 'team-1' },
      }),
    ).rejects.toBeInstanceOf(RecordConflictError);
    await expect(
      store.liaisonOutcomes.create({
        problemId: 'problem-1',
        teamId: 'team-1',
        version: 1,
        title: 'Outcome',
        description: 'Description',
        submittedAt: '2026-10-08T03:04:05.006Z',
        status: 'submitted',
        ownerUid: 'student-1',
        scope: { type: 'liaison_team', id: 'team-1' },
      }),
    ).rejects.toBeInstanceOf(RecordConflictError);
  });
});
