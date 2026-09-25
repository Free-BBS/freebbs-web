import { describe, expect, it, vi } from 'vitest';

import type { AuthorizationContext } from '../../core/authorization/policy.js';
import {
  ADMIN_PERMISSION_RULES,
  BASE_STUDENT_PERMISSIONS,
  ROLE_PERMISSION_CATALOG,
} from '../../core/authorization/permission-catalog.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import type { DevelopmentStore, LiaisonProblemRepository } from '../../core/database/types.js';
import { LiaisonProblemService } from './problem-service.js';

const publicScope = { type: 'public', id: '*' } as const;

function actor(uid: string, actions: readonly string[]): AuthorizationContext {
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
    policies: actions.map((action) => ({
      id: `${uid}-${action}`,
      action,
      resource: action.includes('.outcome.') ? 'liaison_outcome' : 'liaison_problem',
      effect: 'allow' as const,
    })),
  };
}

function withDeny(
  context: AuthorizationContext,
  action: string,
  resource: 'liaison_problem' | 'liaison_outcome',
  scope: { type: string; id: string },
): AuthorizationContext {
  return {
    ...context,
    policies: [
      ...(context.policies ?? []),
      { id: `deny-${action}-${scope.type}-${scope.id}`, action, resource, effect: 'deny', scope },
    ],
  };
}

function repositoryWithoutList(
  repository: LiaisonProblemRepository,
  pageVisible: LiaisonProblemRepository['pageVisible'],
): LiaisonProblemRepository {
  return {
    create: repository.create.bind(repository),
    get: repository.get.bind(repository),
    getForUpdate: repository.getForUpdate.bind(repository),
    listForUpdate: repository.listForUpdate.bind(repository),
    list: vi.fn(async () => {
      throw new Error('list must not be used for API pagination');
    }),
    page: repository.page.bind(repository),
    pageVisible,
    update: repository.update.bind(repository),
    delete: repository.delete.bind(repository),
  };
}

const maintainer = actor('demo-liaison-member', [
  'liaison.problem.read',
  'liaison.problem.create',
  'liaison.problem.update',
  'liaison.problem.submit_review',
  'liaison.problem.outcome.manage',
]);
const reviewer = actor('demo-tuanwei-lead', ['liaison.problem.read', 'liaison.problem.review']);
const student = actor('demo-student', [
  'liaison.problem.read',
  'liaison.problem.join',
  'liaison.problem.post',
  'liaison.problem.outcome.submit',
]);

async function draft(store: DevelopmentStore, ownerUid = 'demo-liaison-member') {
  return store.liaisonProblems.create({
    title: 'A real problem',
    summary: 'A concise public summary.',
    background: 'Public background',
    sourceType: 'lab',
    sourceName: 'Research lab',
    tags: ['data'],
    expectedOutcome: 'A working prototype',
    constraints: 'Use public data only',
    startsAt: null,
    deadline: null,
    publicContact: 'liaison@example.test',
    internalContactNote: 'private-person@example.test',
    recorderUid: ownerUid,
    reviewerUid: null,
    reviewedAt: null,
    reviewNote: null,
    status: 'draft',
    ownerUid,
    scope: publicScope,
  });
}

describe('liaison problem service', () => {
  it('rejects inverted schedules on create and on partial updates', async () => {
    const store = createMemoryStore();
    const service = new LiaisonProblemService(store);
    const input = {
      title: 'Scheduled problem',
      summary: 'Schedule must remain coherent.',
      background: 'Public background',
      sourceType: 'lab' as const,
      sourceName: 'Research lab',
      tags: ['data'],
      expectedOutcome: 'A working prototype',
      constraints: 'Use public data only',
      startsAt: '2026-10-02T08:00:00.000Z',
      deadline: '2026-10-01T08:00:00.000Z',
      publicContact: 'liaison@example.test',
      internalContactNote: '',
    };

    await expect(service.create(maintainer, input)).rejects.toMatchObject({
      status: 400,
      code: 'invalid_problem_schedule',
      message: 'Problem start time must not be later than its deadline',
    });

    const created = await draft(store);
    await store.liaisonProblems.update(created.id, {
      startsAt: '2026-10-01T08:00:00.000Z',
      deadline: '2026-10-03T08:00:00.000Z',
    });
    await expect(
      service.update(maintainer, created.id, { startsAt: '2026-10-04T08:00:00.000Z' }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'invalid_problem_schedule',
    });
    expect(await store.liaisonProblems.get(created.id)).toMatchObject({
      startsAt: '2026-10-01T08:00:00.000Z',
      deadline: '2026-10-03T08:00:00.000Z',
    });
  });

  it('binds review only to the configured development and Youth League leads', () => {
    expect(ROLE_PERMISSION_CATALOG['platform.super_admin']).toContainEqual({
      action: 'liaison.problem.review',
      resource: 'liaison_problem',
    });
    expect(ROLE_PERMISSION_CATALOG['affiliation.tuanwei_lead']).toContainEqual({
      action: 'liaison.problem.review',
      resource: 'liaison_problem',
    });
    expect(ROLE_PERMISSION_CATALOG['domain.liaison_lead']).not.toContainEqual(
      expect.objectContaining({ action: 'liaison.problem.review' }),
    );
    expect(ADMIN_PERMISSION_RULES).not.toContainEqual(
      expect.objectContaining({ action: 'liaison.problem.review' }),
    );
    expect(BASE_STUDENT_PERMISSIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'liaison.problem.read' }),
        expect.objectContaining({ action: 'liaison.problem.join' }),
        expect.objectContaining({ action: 'liaison.problem.post' }),
        expect.objectContaining({ action: 'liaison.problem.outcome.submit' }),
      ]),
    );
  });

  it('requires liaison.problem.review rather than admin.manage', async () => {
    const store = createMemoryStore();
    const problem = await draft(store);
    await store.liaisonProblems.update(problem.id, { status: 'pending_review' });
    const service = new LiaisonProblemService(store, () => new Date('2026-09-14T08:00:00.000Z'));
    const adminOnly = actor('demo-admin', ['admin.manage']);

    await expect(
      service.review(adminOnly, problem.id, 'approve', 'Looks good'),
    ).rejects.toMatchObject({
      status: 404,
      code: 'liaison_problem_not_found',
    });
    await expect(
      service.review(reviewer, problem.id, 'approve', 'Looks good'),
    ).resolves.toMatchObject({
      status: 'open',
      reviewerUid: reviewer.uid,
      reviewedAt: '2026-09-14T08:00:00.000Z',
      reviewNote: 'Looks good',
    });
  });

  it('does not reveal a pending review through the generic transition route', async () => {
    const store = createMemoryStore();
    const problem = await draft(store);
    await store.liaisonProblems.update(problem.id, { status: 'pending_review' });

    await expect(
      new LiaisonProblemService(store).transition(student, problem.id, 'open'),
    ).rejects.toMatchObject({ status: 404, code: 'liaison_problem_not_found' });
  });

  it('lets exactly one reviewer decide a pending problem under concurrency', async () => {
    const store = createMemoryStore();
    const problem = await draft(store);
    await store.liaisonProblems.update(problem.id, { status: 'pending_review' });
    const service = new LiaisonProblemService(store);

    const results = await Promise.allSettled([
      service.review(reviewer, problem.id, 'approve', 'Approved'),
      service.review(actor('demo-admin', ['liaison.problem.review']), problem.id, 'reject', 'No'),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find(({ status }) => status === 'rejected');
    expect(rejection).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ status: 409, code: 'problem_already_reviewed' }),
    });
    expect(
      (await store.auditLogs.list({ query: problem.id })).filter(
        ({ action }) => action === 'liaison.problem.reviewed',
      ),
    ).toHaveLength(1);
  });

  it('rolls back review metadata when its audit write fails', async () => {
    const base = createMemoryStore();
    const problem = await draft(base);
    await base.liaisonProblems.update(problem.id, { status: 'pending_review' });
    const store: DevelopmentStore = {
      ...base,
      transaction: (operation) =>
        base.transaction((transactionStore) =>
          operation({
            ...transactionStore,
            auditLogs: {
              ...transactionStore.auditLogs,
              create: async () => {
                throw new Error('simulated audit failure');
              },
            },
          }),
        ),
    };

    await expect(
      new LiaisonProblemService(store).review(reviewer, problem.id, 'approve', 'ok'),
    ).rejects.toThrow('simulated audit failure');
    expect(await base.liaisonProblems.get(problem.id)).toMatchObject({
      status: 'pending_review',
      reviewerUid: null,
      reviewedAt: null,
      reviewNote: null,
    });
  });

  it('does not expose internal contacts, rejected notes, or unrelated drafts', async () => {
    const store = createMemoryStore();
    const own = await draft(store);
    const unrelated = await draft(store, 'demo-admin');
    const rejected = await draft(store, 'demo-admin');
    await store.liaisonProblems.update(rejected.id, {
      status: 'rejected',
      reviewerUid: reviewer.uid,
      reviewedAt: '2026-09-14T08:00:00.000Z',
      reviewNote: 'Private rejection explanation',
    });
    const open = await draft(store, 'demo-admin');
    await store.liaisonProblems.update(open.id, {
      status: 'open',
      reviewNote: 'Internal approval note',
    });
    const service = new LiaisonProblemService(store);

    const visible = await service.list(student, {});
    expect(visible.items.map(({ id }) => id)).toContain(open.id);
    expect(visible.items.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining([own.id, unrelated.id, rejected.id]),
    );
    expect(JSON.stringify(visible)).not.toMatch(
      /private-person|Private rejection|Internal approval/i,
    );

    const ownerView = await service.get(maintainer, own.id);
    expect(ownerView).toMatchObject({ internalContactNote: 'private-person@example.test' });
  });

  it('honors an exact problem deny instead of authorizing against the public storage scope', async () => {
    const store = createMemoryStore();
    const problem = await draft(store, 'demo-admin');
    await store.liaisonProblems.update(problem.id, { status: 'open' });
    const denied = withDeny(student, 'liaison.problem.read', 'liaison_problem', {
      type: 'liaison_problem',
      id: problem.id,
    });

    await expect(new LiaisonProblemService(store).get(denied, problem.id)).rejects.toMatchObject({
      status: 404,
      code: 'liaison_problem_not_found',
    });
    expect(
      (await new LiaisonProblemService(store).list(denied, {})).items.map(({ id }) => id),
    ).not.toContain(problem.id);
  });

  it('pushes authorized list pagination into the repository and preserves the visible total', async () => {
    const base = createMemoryStore();
    const repositoryPage = vi.fn(base.liaisonProblems.pageVisible.bind(base.liaisonProblems));
    const store: DevelopmentStore = {
      ...base,
      liaisonProblems: repositoryWithoutList(base.liaisonProblems, repositoryPage),
      transaction: (operation) => operation(store),
    };
    const service = new LiaisonProblemService(store);

    const first = await service.list(student, { page: 1, pageSize: 1 });
    const second = await service.list(student, { page: 2, pageSize: 1 });

    expect(repositoryPage).toHaveBeenCalledTimes(2);
    expect(repositoryPage.mock.calls[0]?.[1]).toEqual({ page: 1, pageSize: 1 });
    expect(repositoryPage.mock.calls[1]?.[1]).toEqual({ page: 2, pageSize: 1 });
    expect(first).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(second).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0]?.id).not.toBe(second.items[0]?.id);
  });

  it('keeps maintainer-only records in repository-backed pagination totals', async () => {
    const base = createMemoryStore();
    const privateDraft = await draft(base, 'demo-admin');
    const repositoryPage = vi.fn(base.liaisonProblems.pageVisible.bind(base.liaisonProblems));
    const store: DevelopmentStore = {
      ...base,
      liaisonProblems: repositoryWithoutList(base.liaisonProblems, repositoryPage),
      transaction: (operation) => operation(store),
    };

    const result = await new LiaisonProblemService(store).list(maintainer, {
      page: 2,
      pageSize: 2,
    });

    expect(result).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(result.items).toHaveLength(1);
    expect([
      ...result.items.map(({ id }) => id),
      ...(
        await new LiaisonProblemService(store).list(maintainer, { page: 1, pageSize: 2 })
      ).items.map(({ id }) => id),
    ]).toContain(privateDraft.id);
  });

  it('counts teams only for the bounded page when more than 100 records are visible', async () => {
    const base = createMemoryStore({ seed: false });
    await base.subjects.create({
      uid: 'demo-admin',
      displayName: 'Demo admin',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'system',
      scope: publicScope,
    });
    for (let index = 0; index < 101; index += 1) {
      const problem = await draft(base, 'demo-admin');
      await base.liaisonProblems.update(problem.id, { status: 'open' });
    }
    const repositoryPage = vi.fn(base.liaisonProblems.pageVisible.bind(base.liaisonProblems));
    const teamCount = vi.spyOn(base.liaisonTeams, 'countActiveByProblemIds');
    const teamList = vi.spyOn(base.liaisonTeams, 'list');
    const transaction = vi.fn();
    const store: DevelopmentStore = {
      ...base,
      liaisonProblems: repositoryWithoutList(base.liaisonProblems, repositoryPage),
      transaction: async (operation) => {
        transaction();
        return operation(store);
      },
    };

    const result = await new LiaisonProblemService(store).list(student, {
      query: 'real problem',
      page: 1,
      pageSize: 10,
    });

    expect(transaction).not.toHaveBeenCalled();
    expect(repositoryPage).toHaveBeenCalledOnce();
    expect(repositoryPage.mock.calls[0]?.[0]).toEqual({ query: 'real problem' });
    expect(repositoryPage.mock.calls[0]?.[1]).toEqual({ page: 1, pageSize: 10 });
    expect(repositoryPage.mock.calls[0]?.[2]).toMatchObject({
      actorUid: student.uid,
      publicStatuses: ['open', 'paused', 'closed'],
    });
    expect(result).toMatchObject({ page: 1, pageSize: 10, total: 101 });
    expect(result.items).toHaveLength(10);
    expect(teamCount).toHaveBeenCalledOnce();
    expect(teamCount).toHaveBeenCalledWith(result.items.map(({ id }) => id));
    expect(teamList).not.toHaveBeenCalled();
  });

  it('returns stable conflicts for duplicate membership and repeated adoption while keeping the problem open', async () => {
    const store = createMemoryStore();
    const problem = await draft(store);
    await store.liaisonProblems.update(problem.id, { status: 'open' });
    const service = new LiaisonProblemService(store);
    const team = await service.createTeam(student, problem.id, {
      name: 'Team one',
      proposal: 'We will build a prototype.',
    });

    await expect(service.requestMembership(student, problem.id, team.id)).rejects.toMatchObject({
      status: 409,
      code: 'team_membership_exists',
    });

    const first = await service.submitOutcome(student, problem.id, {
      teamId: team.id,
      title: 'Prototype one',
      description: 'First usable result',
      linkUrl: null,
      attachmentRef: null,
    });
    const second = await service.submitOutcome(student, problem.id, {
      teamId: team.id,
      title: 'Prototype two',
      description: 'Second usable result',
      linkUrl: null,
      attachmentRef: null,
    });
    await service.adoptOutcome(maintainer, problem.id, first.id);
    await service.adoptOutcome(maintainer, problem.id, second.id);
    await expect(service.adoptOutcome(maintainer, problem.id, first.id)).rejects.toMatchObject({
      status: 409,
      code: 'outcome_already_adopted',
    });
    expect(await store.liaisonProblems.get(problem.id)).toMatchObject({ status: 'open' });
    expect(await store.liaisonOutcomes.list({ query: problem.id })).toEqual([
      expect.objectContaining({ id: second.id, status: 'adopted' }),
      expect.objectContaining({ id: first.id, status: 'adopted' }),
    ]);
  });

  it('allocates outcome versions inside the transaction', async () => {
    const store = createMemoryStore();
    const problem = await draft(store);
    await store.liaisonProblems.update(problem.id, { status: 'open' });
    const service = new LiaisonProblemService(store);
    const team = await service.createTeam(student, problem.id, {
      name: 'Versioned team',
      proposal: 'Submit iterative outcomes.',
    });
    const input = {
      teamId: team.id,
      title: 'Versioned result',
      description: 'Server allocated version.',
      linkUrl: null,
      attachmentRef: null,
    };

    const outcomes = await Promise.all([
      service.submitOutcome(student, problem.id, input),
      service.submitOutcome(student, problem.id, input),
    ]);

    expect(outcomes.map(({ version }) => version).sort()).toEqual([1, 2]);
  });

  it('applies exact problem, team, and outcome denies after locking the target records', async () => {
    const store = createMemoryStore();
    const problem = await draft(store);
    await store.liaisonProblems.update(problem.id, { status: 'open' });
    const service = new LiaisonProblemService(store);
    const team = await service.createTeam(student, problem.id, {
      name: 'Scoped team',
      proposal: 'Test scoped authorization.',
    });
    const captain = actor('demo-captain', [
      'liaison.problem.read',
      'liaison.problem.join',
      'liaison.problem.post',
      'liaison.problem.outcome.submit',
    ]);

    await expect(
      service.createTeam(
        withDeny(captain, 'liaison.problem.join', 'liaison_problem', {
          type: 'liaison_problem',
          id: problem.id,
        }),
        problem.id,
        { name: 'Denied team', proposal: 'Must not be created.' },
      ),
    ).rejects.toMatchObject({ status: 404, code: 'liaison_problem_not_found' });

    const teamDenied = withDeny(captain, 'liaison.problem.join', 'liaison_problem', {
      type: 'liaison_team',
      id: team.id,
    });
    await expect(service.requestMembership(teamDenied, problem.id, team.id)).rejects.toMatchObject({
      status: 404,
      code: 'liaison_team_not_found',
    });
    await service.requestMembership(captain, problem.id, team.id);
    await service.confirmMembership(student, problem.id, team.id, captain.uid);

    const postDenied = withDeny(captain, 'liaison.problem.post', 'liaison_problem', {
      type: 'liaison_team',
      id: team.id,
    });
    await expect(
      service.createPost(postDenied, problem.id, {
        teamId: team.id,
        kind: 'discussion',
        body: 'Must not be posted.',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'liaison_team_not_found' });

    const submissionDenied = withDeny(
      captain,
      'liaison.problem.outcome.submit',
      'liaison_outcome',
      { type: 'liaison_team', id: team.id },
    );
    await expect(
      service.submitOutcome(submissionDenied, problem.id, {
        teamId: team.id,
        title: 'Denied outcome',
        description: 'Must not be submitted.',
        linkUrl: null,
        attachmentRef: null,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'liaison_team_not_found' });

    const outcome = await service.submitOutcome(student, problem.id, {
      teamId: team.id,
      title: 'Scoped outcome',
      description: 'Used to test exact outcome deny.',
      linkUrl: null,
      attachmentRef: null,
    });
    const adoptionDenied = withDeny(
      maintainer,
      'liaison.problem.outcome.manage',
      'liaison_outcome',
      { type: 'liaison_outcome', id: outcome.id },
    );
    await expect(
      service.adoptOutcome(adoptionDenied, problem.id, outcome.id),
    ).rejects.toMatchObject({ status: 404, code: 'liaison_outcome_not_found' });
  });

  it('applies a problem-level deny to join, post, and outcome operations on its teams', async () => {
    const store = createMemoryStore();
    const problem = await draft(store);
    await store.liaisonProblems.update(problem.id, { status: 'open' });
    const service = new LiaisonProblemService(store);
    const team = await service.createTeam(student, problem.id, {
      name: 'Parent-scoped team',
      proposal: 'Exercise inherited problem boundaries.',
    });
    const captain = actor('demo-captain', [
      'liaison.problem.join',
      'liaison.problem.post',
      'liaison.problem.outcome.submit',
    ]);

    await expect(
      service.requestMembership(
        withDeny(captain, 'liaison.problem.join', 'liaison_problem', {
          type: 'liaison_problem',
          id: problem.id,
        }),
        problem.id,
        team.id,
      ),
    ).rejects.toMatchObject({ status: 404, code: 'liaison_team_not_found' });

    await service.requestMembership(captain, problem.id, team.id);
    await service.confirmMembership(student, problem.id, team.id, captain.uid);

    await expect(
      service.createPost(
        withDeny(captain, 'liaison.problem.post', 'liaison_problem', {
          type: 'liaison_problem',
          id: problem.id,
        }),
        problem.id,
        { teamId: team.id, kind: 'discussion', body: 'Must not cross the parent deny.' },
      ),
    ).rejects.toMatchObject({ status: 404, code: 'liaison_team_not_found' });

    await expect(
      service.submitOutcome(
        withDeny(captain, 'liaison.problem.outcome.submit', 'liaison_outcome', {
          type: 'liaison_problem',
          id: problem.id,
        }),
        problem.id,
        {
          teamId: team.id,
          title: 'Denied by parent',
          description: 'Must not cross the parent deny.',
          linkUrl: null,
          attachmentRef: null,
        },
      ),
    ).rejects.toMatchObject({ status: 404, code: 'liaison_team_not_found' });
  });

  it('applies a team-level deny when adopting one of that team outcomes', async () => {
    const store = createMemoryStore();
    const problem = await draft(store);
    await store.liaisonProblems.update(problem.id, { status: 'open' });
    const service = new LiaisonProblemService(store);
    const team = await service.createTeam(student, problem.id, {
      name: 'Adoption boundary team',
      proposal: 'Submit an outcome for hierarchical authorization.',
    });
    const outcome = await service.submitOutcome(student, problem.id, {
      teamId: team.id,
      title: 'Team-scoped result',
      description: 'Must honor its parent team deny.',
      linkUrl: null,
      attachmentRef: null,
    });
    const denied = withDeny(maintainer, 'liaison.problem.outcome.manage', 'liaison_outcome', {
      type: 'liaison_team',
      id: team.id,
    });

    await expect(service.adoptOutcome(denied, problem.id, outcome.id)).rejects.toMatchObject({
      status: 404,
      code: 'liaison_outcome_not_found',
    });
    expect(await store.liaisonOutcomes.get(outcome.id)).toMatchObject({ status: 'submitted' });
  });

  it('requires a current allow policy even when the actor UID is the team maintainer', async () => {
    const store = createMemoryStore();
    const problem = await draft(store);
    await store.liaisonProblems.update(problem.id, { status: 'open' });
    const service = new LiaisonProblemService(store);
    const team = await service.createTeam(student, problem.id, {
      name: 'Maintained team',
      proposal: 'Permission-gated confirmations.',
    });
    const captain = actor('demo-captain', ['liaison.problem.join', 'liaison.problem.post']);
    await service.requestMembership(captain, problem.id, team.id);

    await expect(
      service.confirmMembership(actor(student.uid, []), problem.id, team.id, captain.uid),
    ).rejects.toMatchObject({ status: 404, code: 'liaison_team_not_found' });
    await expect(
      service.confirmMembership(
        withDeny(student, 'liaison.problem.join', 'liaison_problem', {
          type: 'liaison_team',
          id: team.id,
        }),
        problem.id,
        team.id,
        captain.uid,
      ),
    ).rejects.toMatchObject({ status: 404, code: 'liaison_team_not_found' });
  });

  it('authorizes a post before revealing that the problem is paused', async () => {
    const store = createMemoryStore();
    const problem = await draft(store);
    await store.liaisonProblems.update(problem.id, { status: 'paused' });

    await expect(
      new LiaisonProblemService(store).createPost(actor('demo-captain', []), problem.id, {
        teamId: null,
        kind: 'discussion',
        body: 'Must not reveal state.',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'liaison_problem_not_found' });
  });

  it('does not confirm inactive teams or non-pending historical memberships', async () => {
    const store = createMemoryStore();
    const problem = await draft(store);
    await store.liaisonProblems.update(problem.id, { status: 'open' });
    const service = new LiaisonProblemService(store);
    const team = await service.createTeam(student, problem.id, {
      name: 'Historical team',
      proposal: 'State checks.',
    });
    const captain = actor('demo-captain', ['liaison.problem.join', 'liaison.problem.post']);
    const membership = await service.requestMembership(captain, problem.id, team.id);
    await store.liaisonTeams.update(team.id, { status: 'inactive' });

    await expect(
      service.confirmMembership(student, problem.id, team.id, captain.uid),
    ).rejects.toMatchObject({ status: 409, code: 'liaison_team_inactive' });
    await expect(service.requestMembership(captain, problem.id, team.id)).rejects.toMatchObject({
      status: 409,
      code: 'liaison_team_inactive',
    });
    await expect(
      service.createPost(captain, problem.id, {
        teamId: team.id,
        kind: 'discussion',
        body: 'Inactive team post.',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'liaison_team_inactive' });
    await store.liaisonTeams.update(team.id, { status: 'active' });
    await store.liaisonTeamMembers.update(membership.id, { status: 'inactive' });
    await expect(
      service.confirmMembership(student, problem.id, team.id, captain.uid),
    ).rejects.toMatchObject({ status: 409, code: 'team_membership_not_pending' });
    expect(await store.liaisonTeamMembers.get(membership.id)).toMatchObject({ status: 'inactive' });
  });

  it('stops accepting new outcomes after the liaison maintainer closes a problem', async () => {
    const store = createMemoryStore();
    const problem = await draft(store);
    await store.liaisonProblems.update(problem.id, { status: 'open' });
    const service = new LiaisonProblemService(store);
    const team = await service.createTeam(student, problem.id, {
      name: 'Closing team',
      proposal: 'Submit before close.',
    });
    await store.liaisonProblems.update(problem.id, { status: 'closed' });

    await expect(
      service.createTeam(student, problem.id, {
        name: 'Late team',
        proposal: 'Must not start after close.',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'liaison_problem_not_open' });

    await expect(
      service.submitOutcome(student, problem.id, {
        teamId: team.id,
        title: 'Late result',
        description: 'This should not be accepted.',
        linkUrl: null,
        attachmentRef: null,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'problem_not_accepting_outcomes' });
  });

  it('does not adopt an inactive historical outcome', async () => {
    const store = createMemoryStore();
    const problem = await draft(store);
    await store.liaisonProblems.update(problem.id, { status: 'open' });
    const service = new LiaisonProblemService(store);
    const team = await service.createTeam(student, problem.id, {
      name: 'Outcome state team',
      proposal: 'Submit one outcome.',
    });
    const outcome = await service.submitOutcome(student, problem.id, {
      teamId: team.id,
      title: 'Historical outcome',
      description: 'This record has been disabled.',
      linkUrl: null,
      attachmentRef: null,
    });
    await store.liaisonOutcomes.update(outcome.id, { status: 'inactive' });

    await expect(service.adoptOutcome(maintainer, problem.id, outcome.id)).rejects.toMatchObject({
      status: 409,
      code: 'liaison_outcome_not_submitted',
    });
    expect(await store.liaisonOutcomes.get(outcome.id)).toMatchObject({ status: 'inactive' });
  });
});
