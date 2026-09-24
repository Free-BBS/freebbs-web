import { describe, expect, it } from 'vitest';

import { createMemoryStore } from './memory-store.js';

import type { DevelopmentStore } from './types.js';

const publicScope = { type: 'public', id: '*' } as const;
const missingReference = { code: 'ER_NO_REFERENCED_ROW_2', errno: 1452 };
const referencedRow = { code: 'ER_ROW_IS_REFERENCED_2', errno: 1451 };

async function createSubjects(store: DevelopmentStore, uids: string[]): Promise<void> {
  for (const uid of uids) {
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

async function createProblem(store: DevelopmentStore, recorderUid: string, title = 'Problem') {
  return store.liaisonProblems.create({
    title,
    background: 'Background',
    sourceType: 'campus',
    sourceName: 'Campus partner',
    expectedOutcome: 'Outcome',
    constraints: 'None',
    internalContactNote: '',
    recorderUid,
    status: 'open',
    ownerUid: recorderUid,
    scope: publicScope,
  });
}

describe('memory liaison reference integrity', () => {
  it('rejects missing or cross-problem references on create and update', async () => {
    const store = createMemoryStore({ seed: false });
    await expect(createProblem(store, 'missing-recorder')).rejects.toMatchObject(missingReference);

    await createSubjects(store, [
      'recorder',
      'reviewer',
      'maintainer',
      'member',
      'author',
      'moderator',
      'adopter',
    ]);
    const firstProblem = await createProblem(store, 'recorder', 'First');
    const secondProblem = await createProblem(store, 'recorder', 'Second');
    await expect(
      store.liaisonProblems.update(firstProblem.id, { reviewerUid: 'missing-reviewer' }),
    ).rejects.toMatchObject(missingReference);

    await expect(
      store.liaisonTeams.create({
        problemId: 'missing-problem',
        name: 'Orphan team',
        proposal: 'Proposal',
        maintainerUid: 'maintainer',
        status: 'active',
        ownerUid: 'maintainer',
        scope: publicScope,
      }),
    ).rejects.toMatchObject(missingReference);
    await expect(
      store.liaisonTeams.create({
        problemId: firstProblem.id,
        name: 'Missing maintainer',
        proposal: 'Proposal',
        maintainerUid: 'missing-maintainer',
        status: 'active',
        ownerUid: 'maintainer',
        scope: publicScope,
      }),
    ).rejects.toMatchObject(missingReference);
    const team = await store.liaisonTeams.create({
      problemId: firstProblem.id,
      name: 'Valid team',
      proposal: 'Proposal',
      maintainerUid: 'maintainer',
      status: 'active',
      ownerUid: 'maintainer',
      scope: publicScope,
    });

    await expect(
      store.liaisonTeamMembers.create({
        problemId: secondProblem.id,
        teamId: team.id,
        memberUid: 'member',
        role: 'member',
        joinedAt: '2026-10-01T00:00:00.000Z',
        status: 'active',
        ownerUid: 'member',
        scope: publicScope,
      }),
    ).rejects.toMatchObject(missingReference);
    await expect(
      store.liaisonTeamMembers.create({
        problemId: firstProblem.id,
        teamId: team.id,
        memberUid: 'missing-member',
        role: 'member',
        joinedAt: '2026-10-01T00:00:00.000Z',
        status: 'active',
        ownerUid: 'member',
        scope: publicScope,
      }),
    ).rejects.toMatchObject(missingReference);
    await expect(
      store.liaisonPosts.create({
        problemId: secondProblem.id,
        teamId: team.id,
        authorUid: 'author',
        kind: 'progress',
        body: 'Cross-problem post',
        hiddenByUid: null,
        hiddenAt: null,
        status: 'visible',
        ownerUid: 'author',
        scope: publicScope,
      }),
    ).rejects.toMatchObject(missingReference);
    await expect(
      store.liaisonPosts.create({
        problemId: firstProblem.id,
        teamId: null,
        authorUid: 'missing-author',
        kind: 'discussion',
        body: 'Orphan author',
        hiddenByUid: null,
        hiddenAt: null,
        status: 'visible',
        ownerUid: 'author',
        scope: publicScope,
      }),
    ).rejects.toMatchObject(missingReference);
    await expect(
      store.liaisonOutcomes.create({
        problemId: secondProblem.id,
        teamId: team.id,
        version: 1,
        title: 'Cross-problem outcome',
        description: 'Description',
        submittedAt: '2026-10-02T00:00:00.000Z',
        adoptedAt: '2026-10-03T00:00:00.000Z',
        adoptedByUid: 'adopter',
        status: 'adopted',
        ownerUid: 'member',
        scope: publicScope,
      }),
    ).rejects.toMatchObject(missingReference);
  });

  it('matches MySQL RESTRICT behavior for referenced problem, team and subjects', async () => {
    const store = createMemoryStore({ seed: false });
    await createSubjects(store, [
      'recorder',
      'maintainer',
      'member',
      'author',
      'moderator',
      'adopter',
    ]);
    const problem = await createProblem(store, 'recorder');
    const otherProblem = await createProblem(store, 'recorder', 'Other problem');
    const team = await store.liaisonTeams.create({
      problemId: problem.id,
      name: 'Team',
      proposal: 'Proposal',
      maintainerUid: 'maintainer',
      status: 'active',
      ownerUid: 'maintainer',
      scope: publicScope,
    });
    const membership = await store.liaisonTeamMembers.create({
      problemId: problem.id,
      teamId: team.id,
      memberUid: 'member',
      role: 'member',
      joinedAt: '2026-10-01T00:00:00.000Z',
      status: 'active',
      ownerUid: 'member',
      scope: publicScope,
    });
    const post = await store.liaisonPosts.create({
      problemId: problem.id,
      teamId: team.id,
      authorUid: 'author',
      kind: 'progress',
      body: 'Progress',
      hiddenAt: '2026-10-02T00:00:00.000Z',
      hiddenByUid: 'moderator',
      status: 'hidden',
      ownerUid: 'author',
      scope: publicScope,
    });
    const outcome = await store.liaisonOutcomes.create({
      problemId: problem.id,
      teamId: team.id,
      version: 1,
      title: 'Outcome',
      description: 'Description',
      submittedAt: '2026-10-02T00:00:00.000Z',
      adoptedAt: '2026-10-03T00:00:00.000Z',
      adoptedByUid: 'adopter',
      status: 'adopted',
      ownerUid: 'member',
      scope: publicScope,
    });

    await expect(
      store.liaisonTeams.update(team.id, { problemId: otherProblem.id }),
    ).rejects.toMatchObject(referencedRow);
    const recorder = (await store.subjects.list()).find(
      (candidate) => candidate.uid === 'recorder',
    );
    expect(recorder).toBeDefined();
    await expect(
      store.subjects.update(recorder!.id, { uid: 'renamed-recorder' }),
    ).rejects.toMatchObject(referencedRow);
    await expect(store.liaisonProblems.delete(problem.id)).rejects.toMatchObject(referencedRow);
    await expect(store.liaisonTeams.delete(team.id)).rejects.toMatchObject(referencedRow);
    for (const uid of ['recorder', 'maintainer', 'member', 'author', 'moderator', 'adopter']) {
      const subject = (await store.subjects.list()).find((candidate) => candidate.uid === uid);
      expect(subject).toBeDefined();
      await expect(store.subjects.delete(subject!.id)).rejects.toMatchObject(referencedRow);
    }

    await expect(store.liaisonOutcomes.delete(outcome.id)).resolves.toBe(true);
    await expect(store.liaisonPosts.delete(post.id)).resolves.toBe(true);
    await expect(store.liaisonTeamMembers.delete(membership.id)).resolves.toBe(true);
    await expect(store.liaisonTeams.delete(team.id)).resolves.toBe(true);
    await expect(store.liaisonProblems.delete(problem.id)).resolves.toBe(true);
    await expect(store.liaisonProblems.delete(otherProblem.id)).resolves.toBe(true);
    for (const subject of await store.subjects.list()) {
      await expect(store.subjects.delete(subject.id)).resolves.toBe(true);
    }
  });
});
