import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMySqlStore, type MySqlStoreHandle } from './mysql-store.js';
import { RecordConflictError } from './record-conflict-error.js';
import { createMemoryStore } from './memory-store.js';
import { EventsService } from '../../modules/events/service.js';
import type { AuthorizationContext } from '../authorization/policy.js';

const runMySql = process.env.DATA_MODE?.trim() === 'mysql';
const integration = runMySql ? describe : describe.skip;
const runId = `mysql-integration-${randomUUID()}`;
const publicScope = { type: 'public', id: '*' } as const;
let handle: MySqlStoreHandle;

async function cleanCreatedRecords(): Promise<void> {
  await handle.pool.execute(
    'DELETE FROM activity_registrations WHERE activity_id IN (SELECT id FROM activities WHERE owner_uid = ?)',
    [runId],
  );
  for (const table of [
    'audit_logs',
    'liaison_outcomes',
    'liaison_posts',
    'liaison_team_members',
    'liaison_teams',
    'liaison_problems',
    'knowledge_entries',
    'finance_records',
    'liaison_resources',
    'competition_fixtures',
    'activity_milestones',
    'proposals',
    'sports_checkins',
    'sports_team_members',
    'activity_registrations',
    'activities',
    'club_memberships',
    'sports_teams',
    'clubs',
    'subjects',
  ]) {
    await handle.pool.execute(`DELETE FROM ${table} WHERE owner_uid = ?`, [runId]);
  }
}

integration('real MySQL 8 store integration', () => {
  beforeAll(async () => {
    handle = createMySqlStore({ environment: process.env });
    await handle.checkReadiness();
    for (const uid of [`${runId}-member`, `${runId}-participant`]) {
      await handle.store.subjects.create({
        uid,
        displayName: uid,
        avatarUrl: null,
        status: 'active',
        ownerUid: runId,
        scope: publicScope,
      });
    }
  });

  afterAll(async () => {
    if (!handle) return;
    try {
      await cleanCreatedRecords();
    } finally {
      await handle.close();
    }
  });

  it('serializes the same registration policy on the MySQL adapter', async () => {
    const activity = await handle.store.activities.create({
      title: 'MySQL capacity contract',
      description: runId,
      clubId: null,
      startsAt: null,
      capacity: 1,
      registrationDeadline: '2026-09-15T08:00:00.000Z',
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status: 'published',
      ownerUid: runId,
      scope: publicScope,
    });
    const actor = (uid: string): AuthorizationContext => ({
      uid,
      displayName: uid,
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
      policies: [
        {
          id: `mysql-register-${uid}`,
          action: 'events.register',
          resource: 'activity_registration',
          effect: 'allow',
        },
      ],
    });
    const service = new EventsService(handle.store, () => new Date('2026-09-14T08:00:00.000Z'));
    const results = await Promise.allSettled([
      service.register(actor(`${runId}-member`), activity.id),
      service.register(actor(`${runId}-participant`), activity.id),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: 'activity_capacity_reached' }),
      }),
    ]);
  });

  it('matches memory case/accent-sensitive category and season filtering', async () => {
    const scope = { type: 'integration', id: runId };
    for (const store of [createMemoryStore({ seed: false }), handle.store]) {
      const entry = await store.knowledge.create({
        type: 'faq',
        title: 'Entry',
        body: runId,
        category: 'Café',
        status: 'draft',
        ownerUid: runId,
        scope,
      });
      const team = await store.sportsTeams.create({
        name: 'Team',
        description: runId,
        season: 'Été',
        status: 'draft',
        ownerUid: runId,
        scope,
      });
      const filters = { scopeType: scope.type, scopeId: scope.id };
      expect(
        (await store.knowledge.list({ ...filters, category: 'Café' })).map(({ id }) => id),
      ).toEqual([entry.id]);
      for (const category of ['café', 'Cafe', 'Café '])
        expect(await store.knowledge.list({ ...filters, category })).toEqual([]);
      expect(
        (await store.sportsTeams.list({ ...filters, season: 'Été' })).map(({ id }) => id),
      ).toEqual([team.id]);
      for (const season of ['été', 'Ete', 'Été '])
        expect(await store.sportsTeams.list({ ...filters, season })).toEqual([]);
    }
  });

  it('matches memory decoded-tag substring searches and pagination without JSON artifacts', async () => {
    const scope = { type: 'integration_search', id: runId };
    for (const store of [createMemoryStore({ seed: false }), handle.store]) {
      const entry = await store.knowledge.create({
        type: 'faq',
        title: 'Entry',
        body: runId,
        tags: ['a"b', '50%_off', 'x\\y', 'red', 'blue', 'Café'],
        status: 'draft',
        ownerUid: runId,
        scope,
      });
      for (const query of ['a"b', '50%_off', 'x\\y', 'CAFÉ']) {
        const result = await store.knowledge.page(
          { scopeType: scope.type, scopeId: scope.id, query },
          { page: 1, pageSize: 10 },
        );
        expect(result.total).toBe(1);
        expect(result.items.map(({ id }) => id)).toEqual([entry.id]);
      }
      for (const query of ['["', '\\"', 'red,blue', 'red blue', 'cafe'])
        expect(
          await store.knowledge.list({ scopeType: scope.type, scopeId: scope.id, query }),
        ).toEqual([]);
    }
  });

  it('performs a complete CRUD round-trip through the MySQL store', async () => {
    const created = await handle.store.liaisonResources.create({
      name: 'MySQL integration liaison',
      description: runId,
      category: 'integration',
      visibility: 'restricted',
      status: 'active',
      ownerUid: runId,
      scope: publicScope,
    });
    await expect(handle.store.liaisonResources.get(created.id)).resolves.toMatchObject({
      name: 'MySQL integration liaison',
    });
    await expect(
      handle.store.liaisonResources.update(created.id, { name: 'MySQL integration updated' }),
    ).resolves.toMatchObject({ name: 'MySQL integration updated' });
    await expect(handle.store.liaisonResources.delete(created.id)).resolves.toBe(true);
    await expect(handle.store.liaisonResources.get(created.id)).resolves.toBeNull();
  });
  it('round-trips liaison problem community records and enforces compound uniqueness', async () => {
    const problem = await handle.store.liaisonProblems.create({
      title: 'MySQL liaison problem',
      summary: runId,
      background: 'Integration background',
      sourceType: 'lab',
      sourceName: 'Integration lab',
      tags: ['quote"tag', '50%_off', 'x\\y'],
      expectedOutcome: 'Integration outcome',
      constraints: 'Integration only',
      startsAt: '2026-10-01T12:00:00.123+08:00',
      deadline: '2026-11-01T12:00:00.456+08:00',
      publicContact: 'Integration desk',
      internalContactNote: 'Not public',
      recorderUid: `${runId}-member`,
      reviewerUid: null,
      reviewedAt: null,
      reviewNote: null,
      status: 'open',
      ownerUid: runId,
      scope: { type: 'integration_liaison', id: runId },
    });
    expect(problem).toMatchObject({
      startsAt: '2026-10-01T04:00:00.123Z',
      deadline: '2026-11-01T04:00:00.456Z',
      tags: ['quote"tag', '50%_off', 'x\\y'],
    });
    expect(
      await handle.store.liaisonProblems.list({
        scopeType: 'integration_liaison',
        scopeId: runId,
        tag: 'quote"tag',
      }),
    ).toHaveLength(1);

    const team = await handle.store.liaisonTeams.create({
      problemId: problem.id,
      name: 'Integration team',
      proposal: 'Integration proposal',
      maintainerUid: `${runId}-member`,
      status: 'active',
      ownerUid: runId,
      scope: { type: 'liaison_problem', id: problem.id },
    });
    const membership = {
      problemId: problem.id,
      teamId: team.id,
      memberUid: `${runId}-participant`,
      role: 'member' as const,
      joinedAt: '2026-10-02T03:04:05.006Z',
      status: 'active',
      ownerUid: runId,
      scope: { type: 'liaison_team', id: team.id },
    };
    await handle.store.liaisonTeamMembers.create(membership);
    await expect(handle.store.liaisonTeamMembers.create(membership)).rejects.toBeInstanceOf(
      RecordConflictError,
    );
    await handle.store.liaisonPosts.create({
      problemId: problem.id,
      teamId: team.id,
      authorUid: `${runId}-member`,
      kind: 'progress',
      body: runId,
      hiddenAt: null,
      hiddenByUid: null,
      status: 'visible',
      ownerUid: runId,
      scope: { type: 'liaison_problem', id: problem.id },
    });
    const outcome = {
      problemId: problem.id,
      teamId: team.id,
      version: 1,
      title: 'Integration outcome',
      description: runId,
      linkUrl: null,
      attachmentRef: null,
      submittedAt: '2026-10-08T03:04:05.006Z',
      adoptedAt: null,
      adoptedByUid: null,
      status: 'submitted',
      ownerUid: runId,
      scope: { type: 'liaison_team', id: team.id },
    } as const;
    expect(await handle.store.liaisonOutcomes.create(outcome)).toMatchObject({
      version: 1,
      submittedAt: '2026-10-08T03:04:05.006Z',
    });
    await expect(handle.store.liaisonOutcomes.create(outcome)).rejects.toBeInstanceOf(
      RecordConflictError,
    );
  });
  it('matches memory reference and RESTRICT semantics for liaison aggregates', async () => {
    const memberUid = `${runId}-member`;
    const participantUid = `${runId}-participant`;
    const missingProblemId = `missing-${randomUUID()}`;
    const stores = [createMemoryStore({ seed: false }), handle.store];
    for (const store of stores) {
      if (store !== handle.store) {
        for (const uid of [memberUid, participantUid]) {
          await store.subjects.create({
            uid,
            displayName: uid,
            avatarUrl: null,
            status: 'active',
            ownerUid: runId,
            scope: publicScope,
          });
        }
      }
      await expect(
        store.liaisonTeams.create({
          problemId: missingProblemId,
          name: 'Orphan team',
          proposal: 'Must fail',
          maintainerUid: memberUid,
          status: 'active',
          ownerUid: runId,
          scope: publicScope,
        }),
      ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2', errno: 1452 });
      const problemInput = {
        background: 'Integration background',
        sourceType: 'campus' as const,
        sourceName: 'Integration source',
        expectedOutcome: 'Integration outcome',
        constraints: 'Integration only',
        internalContactNote: '',
        recorderUid: memberUid,
        status: 'open' as const,
        ownerUid: runId,
        scope: { type: 'integration_liaison_references', id: runId },
      };
      const problem = await store.liaisonProblems.create({
        ...problemInput,
        title: 'Reference problem',
      });
      const otherProblem = await store.liaisonProblems.create({
        ...problemInput,
        title: 'Other reference problem',
      });
      const team = await store.liaisonTeams.create({
        problemId: problem.id,
        name: 'Reference team',
        proposal: 'Reference proposal',
        maintainerUid: memberUid,
        status: 'active',
        ownerUid: runId,
        scope: { type: 'liaison_problem', id: problem.id },
      });
      await expect(
        store.liaisonTeamMembers.create({
          problemId: otherProblem.id,
          teamId: team.id,
          memberUid: participantUid,
          role: 'member',
          joinedAt: '2026-10-02T03:04:05.006Z',
          status: 'active',
          ownerUid: runId,
          scope: { type: 'liaison_team', id: team.id },
        }),
      ).rejects.toMatchObject({ code: 'ER_NO_REFERENCED_ROW_2', errno: 1452 });
      const membership = await store.liaisonTeamMembers.create({
        problemId: problem.id,
        teamId: team.id,
        memberUid: participantUid,
        role: 'member',
        joinedAt: '2026-10-02T03:04:05.006Z',
        status: 'active',
        ownerUid: runId,
        scope: { type: 'liaison_team', id: team.id },
      });
      const post = await store.liaisonPosts.create({
        problemId: problem.id,
        teamId: team.id,
        authorUid: memberUid,
        kind: 'progress',
        body: 'Reference progress',
        status: 'visible',
        ownerUid: runId,
        scope: { type: 'liaison_problem', id: problem.id },
      });
      const outcome = await store.liaisonOutcomes.create({
        problemId: problem.id,
        teamId: team.id,
        version: 1,
        title: 'Reference outcome',
        description: 'Reference description',
        submittedAt: '2026-10-08T03:04:05.006Z',
        adoptedAt: '2026-10-09T03:04:05.006Z',
        adoptedByUid: memberUid,
        status: 'adopted',
        ownerUid: runId,
        scope: { type: 'liaison_team', id: team.id },
      });

      await expect(
        store.liaisonTeams.update(team.id, { problemId: otherProblem.id }),
      ).rejects.toMatchObject({ code: 'ER_ROW_IS_REFERENCED_2', errno: 1451 });
      const referencedSubject = (await store.subjects.list({ query: memberUid })).find(
        (subject) => subject.uid === memberUid,
      );
      expect(referencedSubject).toBeDefined();
      await expect(
        store.subjects.update(referencedSubject!.id, { uid: `${memberUid}-renamed` }),
      ).rejects.toMatchObject({ code: 'ER_ROW_IS_REFERENCED_2', errno: 1451 });
      await expect(store.liaisonProblems.delete(problem.id)).rejects.toMatchObject({
        code: 'ER_ROW_IS_REFERENCED_2',
        errno: 1451,
      });
      await expect(store.liaisonTeams.delete(team.id)).rejects.toMatchObject({
        code: 'ER_ROW_IS_REFERENCED_2',
        errno: 1451,
      });
      await store.liaisonOutcomes.delete(outcome.id);
      await store.liaisonPosts.delete(post.id);
      await store.liaisonTeamMembers.delete(membership.id);
      await expect(store.liaisonTeams.delete(team.id)).resolves.toBe(true);
      await expect(store.liaisonProblems.delete(problem.id)).resolves.toBe(true);
      await expect(store.liaisonProblems.delete(otherProblem.id)).resolves.toBe(true);
    }
  });
  it('round-trips UTC time, date-only and integer cents while enforcing unique domain records', async () => {
    const club = await handle.store.clubs.create({
      name: 'MySQL integration club',
      description: runId,
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status: 'active',
      ownerUid: runId,
      scope: publicScope,
    });
    const membershipInput = {
      clubId: club.id,
      memberUid: `${runId}-member`,
      status: 'active',
      ownerUid: runId,
      scope: { type: 'club', id: club.id },
    } as const;
    await handle.store.clubMemberships.create(membershipInput);
    await expect(handle.store.clubMemberships.create(membershipInput)).rejects.toBeInstanceOf(
      RecordConflictError,
    );

    const startsAt = '2026-07-22T03:04:05.006Z';
    const activity = await handle.store.activities.create({
      title: 'MySQL integration activity',
      description: runId,
      clubId: club.id,
      startsAt,
      endsAt: '2026-07-22T05:04:05.006Z',
      location: 'Integration venue',
      organizationId: 'sports_center',
      standingActivity: true,
      technicalSupportStatus: 'not_requested',
      technicalSupportNote: null,
      status: 'published',
      ownerUid: runId,
      scope: { type: 'club', id: club.id },
    });
    expect(await handle.store.activities.get(activity.id)).toMatchObject({
      startsAt,
      endsAt: '2026-07-22T05:04:05.006Z',
      location: 'Integration venue',
      organizationId: 'sports_center',
      standingActivity: true,
    });

    const milestone = await handle.store.activityMilestones.create({
      activityId: activity.id,
      occursAt: '2026-07-22T04:04:05.006Z',
      title: 'Integration milestone',
      type: 'checkpoint',
      description: runId,
      completed: false,
      displayOrder: 1,
      status: 'scheduled',
      ownerUid: runId,
      scope: { type: 'activity', id: activity.id },
    });
    expect((await handle.store.activityMilestones.get(milestone.id))?.occursAt).toBe(
      '2026-07-22T04:04:05.006Z',
    );

    const fixture = await handle.store.competitionFixtures.create({
      activityId: activity.id,
      round: 'Group stage',
      participantA: 'Team A',
      participantB: 'Team B',
      scheduledAt: '2026-07-22T04:34:05.006Z',
      location: 'Integration court',
      score: null,
      status: 'scheduled',
      ownerUid: runId,
      scope: { type: 'activity', id: activity.id },
    });
    expect((await handle.store.competitionFixtures.get(fixture.id))?.participantB).toBe('Team B');

    const proposal = await handle.store.proposals.create({
      title: 'Integration proposal',
      problemDescription: runId,
      proposedSolution: 'Verify the MySQL mapping.',
      category: 'integration',
      submitterUid: `${runId}-member`,
      assigneeUid: null,
      publicProgress: 'Submitted',
      internalNote: 'Integration-only note',
      status: 'submitted',
      ownerUid: runId,
      scope: publicScope,
    });
    expect((await handle.store.proposals.get(proposal.id))?.internalNote).toBe(
      'Integration-only note',
    );

    const registrationInput = {
      activityId: activity.id,
      participantUid: `${runId}-participant`,
      status: 'registered',
      ownerUid: runId,
      scope: { type: 'activity', id: activity.id },
    } as const;
    await handle.store.activityRegistrations.create(registrationInput);
    await expect(
      handle.store.activityRegistrations.create(registrationInput),
    ).rejects.toBeInstanceOf(RecordConflictError);

    const team = await handle.store.sportsTeams.create({
      name: 'MySQL integration team',
      description: runId,
      status: 'active',
      ownerUid: runId,
      scope: publicScope,
    });
    const checkinInput = {
      teamId: team.id,
      memberUid: `${runId}-member`,
      checkinDate: '2026-07-22',
      status: 'present',
      ownerUid: runId,
      scope: { type: 'sports_team', id: team.id },
    } as const;
    const checkin = await handle.store.sportsCheckins.create(checkinInput);
    expect((await handle.store.sportsCheckins.get(checkin.id))?.checkinDate).toBe('2026-07-22');
    await expect(handle.store.sportsCheckins.create(checkinInput)).rejects.toBeInstanceOf(
      RecordConflictError,
    );

    const finance = await handle.store.financeRecords.create({
      title: 'MySQL integration budget',
      kind: 'budget',
      amountCents: 123_456_789,
      activityId: activity.id,
      status: 'draft',
      ownerUid: runId,
      scope: publicScope,
    });
    expect((await handle.store.financeRecords.get(finance.id))?.amountCents).toBe(123_456_789);
  });

  it('rejects orphan club, activity, team and finance references', async () => {
    const memberUid = `${runId}-member`;
    const participantUid = `${runId}-participant`;
    const missingId = `${runId}-missing`;
    const foreignKeyFailure = { code: 'ER_NO_REFERENCED_ROW_2' };

    await expect(
      handle.store.clubMemberships.create({
        clubId: missingId,
        memberUid,
        status: 'active',
        ownerUid: runId,
        scope: publicScope,
      }),
    ).rejects.toMatchObject(foreignKeyFailure);
    await expect(
      handle.store.activities.create({
        title: 'Orphan activity',
        description: runId,
        clubId: missingId,
        startsAt: null,
        technicalSupportStatus: 'not_requested',
        technicalSupportNote: null,
        status: 'draft',
        ownerUid: runId,
        scope: publicScope,
      }),
    ).rejects.toMatchObject(foreignKeyFailure);
    await expect(
      handle.store.activityRegistrations.create({
        activityId: missingId,
        participantUid,
        status: 'registered',
        ownerUid: runId,
        scope: publicScope,
      }),
    ).rejects.toMatchObject(foreignKeyFailure);
    await expect(
      handle.store.sportsCheckins.create({
        teamId: missingId,
        memberUid,
        checkinDate: '2026-07-23',
        status: 'present',
        ownerUid: runId,
        scope: publicScope,
      }),
    ).rejects.toMatchObject(foreignKeyFailure);
    await expect(
      handle.store.financeRecords.create({
        title: 'Orphan finance record',
        kind: 'settlement',
        amountCents: 1,
        activityId: missingId,
        status: 'draft',
        ownerUid: runId,
        scope: publicScope,
      }),
    ).rejects.toMatchObject(foreignKeyFailure);
  });
  it('pages generic repository records through the real MySQL 8 adapter', async () => {
    await expect(
      handle.store.subjects.page({ query: runId }, { page: 1, pageSize: 1 }),
    ).resolves.toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      items: [{ uid: expect.stringContaining(runId) }],
    });
  });
  it('pages filtered audit logs through the real MySQL 8 adapter', async () => {
    for (const resourceId of [`${runId}-audit-a`, `${runId}-audit-b`]) {
      await handle.store.auditLogs.create({
        actorUid: runId,
        action: 'admin.integration',
        resourceType: 'integration',
        resourceId,
        details: {},
        status: 'active',
        ownerUid: runId,
        scope: publicScope,
      });
    }

    await expect(
      handle.store.queryAuditLogs({
        actorUid: runId,
        action: 'admin.integration',
        page: 1,
        pageSize: 1,
      }),
    ).resolves.toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      items: [{ actorUid: runId, action: 'admin.integration' }],
    });
  });
});
