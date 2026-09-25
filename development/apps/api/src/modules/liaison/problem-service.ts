import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { ScopeRef } from '@freebbs-development/contracts';
import type {
  DevelopmentStore,
  LiaisonOutcomeRecord,
  LiaisonPostRecord,
  LiaisonProblemRecord,
  LiaisonProblemStatus,
  LiaisonProblemVisibility,
  LiaisonTeamMemberRecord,
  LiaisonTeamRecord,
  Page,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canTransition } from '../../core/workflow/state-machine.js';
import { encodeUtcDateTime } from '../../core/database/date-codec.js';

export const PROBLEM_TRANSITIONS = {
  draft: ['pending_review'],
  pending_review: ['open', 'rejected'],
  rejected: ['draft'],
  open: ['paused', 'closed'],
  paused: ['open', 'closed'],
  closed: ['archived'],
  archived: [],
} as const;

const publicScope = { type: 'public', id: '*' } as const;
const publicStatuses = new Set<LiaisonProblemStatus>(['open', 'paused', 'closed']);

export interface ProblemCreateInput {
  title: string;
  summary: string;
  background: string;
  sourceType: LiaisonProblemRecord['sourceType'];
  sourceName: string;
  tags: string[];
  expectedOutcome: string;
  constraints: string;
  startsAt: string | null;
  deadline: string | null;
  publicContact: string;
  internalContactNote: string;
}

export type ProblemPatch = Partial<ProblemCreateInput>;
export interface ProblemListInput {
  query?: string;
  status?: LiaisonProblemStatus;
  tag?: string;
  page?: number;
  pageSize?: number;
}
export interface TeamCreateInput {
  name: string;
  proposal: string;
}
export interface PostCreateInput {
  teamId: string | null;
  kind: LiaisonPostRecord['kind'];
  body: string;
}
export interface OutcomeCreateInput {
  teamId: string;
  title: string;
  description: string;
  linkUrl: string | null;
  attachmentRef: string | null;
}

export interface PublicProblemProjection {
  id: string;
  title: string;
  summary: string;
  background: string;
  sourceType: LiaisonProblemRecord['sourceType'];
  sourceName: string;
  tags: string[];
  expectedOutcome: string;
  constraints: string;
  startsAt: string | null;
  deadline: string | null;
  publicContact: string;
  status: LiaisonProblemStatus;
  createdAt: string;
  updatedAt: string;
}
export interface PrivilegedProblemProjection extends PublicProblemProjection {
  internalContactNote: string;
  reviewNote: string | null;
  recorderUid: string;
  reviewerUid: string | null;
  reviewedAt: string | null;
  ownerUid: string;
  scope: ScopeRef;
}
export type ProblemProjection = PublicProblemProjection | PrivilegedProblemProjection;
export type ProblemListProjection = ProblemProjection & { teamCount: number };
export type TeamProjection = LiaisonTeamRecord & { members: LiaisonTeamMemberRecord[] };

function permitted(
  actor: AuthorizationContext,
  action: string,
  resource: 'liaison_problem' | 'liaison_outcome',
  scope: ScopeRef,
): boolean {
  return authorize(actor, { action, resource, scope }).allowed;
}

function permittedAcross(
  actor: AuthorizationContext,
  action: string,
  resource: 'liaison_problem' | 'liaison_outcome',
  scopes: readonly ScopeRef[],
): boolean {
  return scopes.every((scope) => permitted(actor, action, resource, scope));
}

function problemScope(problemId: string): ScopeRef {
  return { type: 'liaison_problem', id: problemId };
}

function teamScope(teamId: string): ScopeRef {
  return { type: 'liaison_team', id: teamId };
}

function outcomeScope(outcomeId: string): ScopeRef {
  return { type: 'liaison_outcome', id: outcomeId };
}

function scopedProblemAccess(
  actor: AuthorizationContext,
  action: string,
  resource: 'liaison_problem' | 'liaison_outcome',
): LiaisonProblemVisibility['read'] {
  const candidateIds = [
    ...new Set(
      (actor.policies ?? [])
        .filter(({ scope }) => scope?.type === 'liaison_problem')
        .map(({ scope }) => scope?.id)
        .filter((id): id is string => id !== undefined && id !== '*'),
    ),
  ];
  let probeId = '__liaison_problem_list_probe__';
  while (candidateIds.includes(probeId)) probeId = `_${probeId}`;
  const all = permitted(actor, action, resource, problemScope(probeId));
  const decisions = candidateIds.map((id) => ({
    id,
    allowed: permitted(actor, action, resource, problemScope(id)),
  }));
  return {
    all,
    ids: all ? [] : decisions.filter(({ allowed }) => allowed).map(({ id }) => id),
    deniedIds: all ? decisions.filter(({ allowed }) => !allowed).map(({ id }) => id) : [],
  };
}

function problemVisibility(actor: AuthorizationContext): LiaisonProblemVisibility {
  return {
    actorUid: actor.uid,
    publicStatuses: ['open', 'paused', 'closed'],
    read: scopedProblemAccess(actor, 'liaison.problem.read', 'liaison_problem'),
    maintain: scopedProblemAccess(actor, 'liaison.problem.update', 'liaison_problem'),
    review: scopedProblemAccess(actor, 'liaison.problem.review', 'liaison_problem'),
  };
}

function problemNotFound(): HttpError {
  return new HttpError(404, 'liaison_problem_not_found', 'Liaison problem not found');
}

function teamNotFound(): HttpError {
  return new HttpError(404, 'liaison_team_not_found', 'Liaison team not found');
}

function outcomeNotFound(): HttpError {
  return new HttpError(404, 'liaison_outcome_not_found', 'Liaison outcome not found');
}

function postNotFound(): HttpError {
  return new HttpError(404, 'liaison_post_not_found', 'Liaison post not found');
}

function problemNotOpen(): HttpError {
  return new HttpError(409, 'liaison_problem_not_open', 'Liaison problem is not open');
}

function problemNotAcceptingOutcomes(): HttpError {
  return new HttpError(
    409,
    'problem_not_accepting_outcomes',
    'Liaison problem is not accepting outcomes',
  );
}

function teamInactive(): HttpError {
  return new HttpError(409, 'liaison_team_inactive', 'Liaison team is inactive');
}

function membershipNotPending(): HttpError {
  return new HttpError(409, 'team_membership_not_pending', 'Team membership is not pending');
}

function outcomeNotSubmitted(): HttpError {
  return new HttpError(409, 'liaison_outcome_not_submitted', 'Liaison outcome is not submitted');
}

async function actorIsActive(store: DevelopmentStore, uid: string): Promise<boolean> {
  return (await store.subjects.listForUpdate({ query: uid })).some(
    (subject) => subject.uid === uid && subject.status === 'active',
  );
}

function hasMaintenanceAccess(actor: AuthorizationContext, problem: LiaisonProblemRecord): boolean {
  return permitted(actor, 'liaison.problem.update', 'liaison_problem', problemScope(problem.id));
}

function hasSensitiveAccess(actor: AuthorizationContext, problem: LiaisonProblemRecord): boolean {
  return (
    problem.ownerUid === actor.uid ||
    hasMaintenanceAccess(actor, problem) ||
    permitted(actor, 'liaison.problem.review', 'liaison_problem', problemScope(problem.id))
  );
}

function canSee(actor: AuthorizationContext, problem: LiaisonProblemRecord): boolean {
  if (!permitted(actor, 'liaison.problem.read', 'liaison_problem', problemScope(problem.id)))
    return false;
  if (publicStatuses.has(problem.status)) return true;
  if (problem.ownerUid === actor.uid || hasMaintenanceAccess(actor, problem)) return true;
  return (
    problem.status === 'pending_review' &&
    permitted(actor, 'liaison.problem.review', 'liaison_problem', problemScope(problem.id))
  );
}

function project(actor: AuthorizationContext, problem: LiaisonProblemRecord): ProblemProjection {
  const publicRecord: PublicProblemProjection = {
    id: problem.id,
    title: problem.title,
    summary: problem.summary,
    background: problem.background,
    sourceType: problem.sourceType,
    sourceName: problem.sourceName,
    tags: [...problem.tags],
    expectedOutcome: problem.expectedOutcome,
    constraints: problem.constraints,
    startsAt: problem.startsAt,
    deadline: problem.deadline,
    publicContact: problem.publicContact,
    status: problem.status,
    createdAt: problem.createdAt,
    updatedAt: problem.updatedAt,
  };
  if (!hasSensitiveAccess(actor, problem)) return publicRecord;
  return {
    ...publicRecord,
    internalContactNote: problem.internalContactNote,
    reviewNote: problem.reviewNote,
    recorderUid: problem.recorderUid,
    reviewerUid: problem.reviewerUid,
    reviewedAt: problem.reviewedAt,
    ownerUid: problem.ownerUid,
    scope: problem.scope,
  };
}

function normalizeTime(value: string | null): string | null {
  return value === null ? null : (encodeUtcDateTime(value)?.toISOString() ?? null);
}

function instant(value: Date): string {
  const encoded = encodeUtcDateTime(value);
  if (encoded === null) throw new Error('A liaison workflow instant is required');
  return encoded.toISOString();
}

function ensureProblemSchedule(startsAt: string | null, deadline: string | null): void {
  if (startsAt !== null && deadline !== null && Date.parse(startsAt) > Date.parse(deadline)) {
    throw new HttpError(
      400,
      'invalid_problem_schedule',
      'Problem start time must not be later than its deadline',
    );
  }
}

export class LiaisonProblemService {
  constructor(
    private readonly store: DevelopmentStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(
    actor: AuthorizationContext,
    input: ProblemListInput,
  ): Promise<Page<ProblemListProjection>> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 20;
    const filters = {
      ...(input.query === undefined ? {} : { query: input.query }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.tag === undefined ? {} : { tag: input.tag }),
    };
    const records = await this.store.liaisonProblems.pageVisible(
      filters,
      { page, pageSize },
      problemVisibility(actor),
    );
    const teamCounts = await this.store.liaisonTeams.countActiveByProblemIds(
      records.items.map(({ id }) => id),
    );
    return {
      items: records.items.map((problem) => ({
        ...project(actor, problem),
        teamCount: teamCounts[problem.id] ?? 0,
      })),
      page,
      pageSize,
      total: records.total,
    };
  }

  async get(actor: AuthorizationContext, id: string): Promise<ProblemProjection> {
    const problem = await this.store.liaisonProblems.get(id);
    if (problem === null || !canSee(actor, problem)) throw problemNotFound();
    return project(actor, problem);
  }

  async create(
    actor: AuthorizationContext,
    input: ProblemCreateInput,
  ): Promise<LiaisonProblemRecord> {
    return this.store.transaction(async (store) => {
      if (
        !(await actorIsActive(store, actor.uid)) ||
        !authorize(actor, {
          action: 'liaison.problem.create',
          resource: 'liaison_problem',
          scope: publicScope,
        }).allowed
      ) {
        throw new HttpError(403, 'forbidden', 'Liaison problem create permission is required');
      }
      ensureProblemSchedule(input.startsAt, input.deadline);
      const created = await store.liaisonProblems.create({
        ...input,
        startsAt: normalizeTime(input.startsAt),
        deadline: normalizeTime(input.deadline),
        recorderUid: actor.uid,
        reviewerUid: null,
        reviewedAt: null,
        reviewNote: null,
        status: 'draft',
        ownerUid: actor.uid,
        scope: publicScope,
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'liaison.problem.created',
        resourceType: 'liaison_problem',
        resourceId: created.id,
        details: { sourceType: created.sourceType, status: created.status },
      });
      return created;
    });
  }

  async update(
    actor: AuthorizationContext,
    id: string,
    patch: ProblemPatch,
  ): Promise<LiaisonProblemRecord> {
    return this.store.transaction(async (store) => {
      const current = await store.liaisonProblems.getForUpdate(id);
      if (
        current === null ||
        !(await actorIsActive(store, actor.uid)) ||
        !hasMaintenanceAccess(actor, current)
      )
        throw problemNotFound();
      const normalized = {
        ...patch,
        ...(patch.startsAt === undefined ? {} : { startsAt: normalizeTime(patch.startsAt) }),
        ...(patch.deadline === undefined ? {} : { deadline: normalizeTime(patch.deadline) }),
      };
      ensureProblemSchedule(
        patch.startsAt === undefined ? current.startsAt : (normalized.startsAt ?? null),
        patch.deadline === undefined ? current.deadline : (normalized.deadline ?? null),
      );
      const updated = await store.liaisonProblems.update(id, normalized);
      if (updated === null) throw problemNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'liaison.problem.updated',
        resourceType: 'liaison_problem',
        resourceId: id,
        details: { changedFields: Object.keys(patch).sort() },
      });
      return updated;
    });
  }

  async transition(
    actor: AuthorizationContext,
    id: string,
    to: LiaisonProblemStatus,
  ): Promise<LiaisonProblemRecord> {
    return this.store.transaction(async (store) => {
      const current = await store.liaisonProblems.getForUpdate(id);
      if (current === null || !(await actorIsActive(store, actor.uid))) throw problemNotFound();
      const from = current.status;
      if (from === 'pending_review' && (to === 'open' || to === 'rejected')) {
        if (
          !permitted(actor, 'liaison.problem.review', 'liaison_problem', problemScope(current.id))
        ) {
          throw problemNotFound();
        }
        throw new HttpError(409, 'review_endpoint_required', 'Use the review endpoint');
      }
      const action =
        to === 'pending_review' ? 'liaison.problem.submit_review' : 'liaison.problem.update';
      if (!permitted(actor, action, 'liaison_problem', problemScope(current.id)))
        throw problemNotFound();
      if (!canTransition(PROBLEM_TRANSITIONS, from, to)) {
        throw new HttpError(
          409,
          'invalid_state_transition',
          'Invalid liaison problem state transition',
        );
      }
      const updated = await store.liaisonProblems.update(id, { status: to });
      if (updated === null) throw problemNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'liaison.problem.status_changed',
        resourceType: 'liaison_problem',
        resourceId: id,
        details: { from, to },
      });
      return updated;
    });
  }

  async review(
    actor: AuthorizationContext,
    id: string,
    decision: 'approve' | 'reject',
    note: string | null,
  ): Promise<LiaisonProblemRecord> {
    return this.store.transaction(async (store) => {
      const current = await store.liaisonProblems.getForUpdate(id);
      if (
        current === null ||
        !(await actorIsActive(store, actor.uid)) ||
        !permitted(actor, 'liaison.problem.review', 'liaison_problem', problemScope(current.id))
      ) {
        throw problemNotFound();
      }
      if (current.status !== 'pending_review') {
        throw new HttpError(409, 'problem_already_reviewed', 'Problem is not pending review');
      }
      const to = decision === 'approve' ? 'open' : 'rejected';
      const reviewedAt = instant(this.now());
      const updated = await store.liaisonProblems.update(id, {
        status: to,
        reviewerUid: actor.uid,
        reviewedAt,
        reviewNote: note,
      });
      if (updated === null) throw problemNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'liaison.problem.reviewed',
        resourceType: 'liaison_problem',
        resourceId: id,
        details: { decision, from: current.status, to, reviewedAt },
      });
      return updated;
    });
  }

  async listTeams(actor: AuthorizationContext, problemId: string): Promise<TeamProjection[]> {
    const problem = await this.requireVisibleProblem(actor, problemId);
    void problem;
    const teams = (await this.store.liaisonTeams.list({ query: problemId })).filter(
      (team) => team.problemId === problemId && team.status === 'active',
    );
    const members = (await this.store.liaisonTeamMembers.list({ query: problemId })).filter(
      (member) => member.problemId === problemId,
    );
    return teams.map((team) => ({
      ...team,
      members: members.filter(
        (member) =>
          member.teamId === team.id &&
          (member.status === 'active' ||
            team.maintainerUid === actor.uid ||
            member.memberUid === actor.uid),
      ),
    }));
  }

  async createTeam(
    actor: AuthorizationContext,
    problemId: string,
    input: TeamCreateInput,
  ): Promise<TeamProjection> {
    return this.store.transaction(async (store) => {
      const problem = await store.liaisonProblems.getForUpdate(problemId);
      if (
        problem === null ||
        !(await actorIsActive(store, actor.uid)) ||
        !permitted(actor, 'liaison.problem.join', 'liaison_problem', problemScope(problemId))
      )
        throw problemNotFound();
      if (problem.status !== 'open') throw problemNotOpen();
      const team = await store.liaisonTeams.create({
        problemId,
        ...input,
        maintainerUid: actor.uid,
        status: 'active',
        ownerUid: actor.uid,
        scope: { type: 'liaison_problem', id: problemId },
      });
      const membership = await store.liaisonTeamMembers.create({
        problemId,
        teamId: team.id,
        memberUid: actor.uid,
        role: 'maintainer',
        joinedAt: instant(this.now()),
        status: 'active',
        ownerUid: actor.uid,
        scope: { type: 'liaison_team', id: team.id },
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'liaison.problem.team_created',
        resourceType: 'liaison_team',
        resourceId: team.id,
        details: { problemId },
      });
      return { ...team, members: [membership] };
    });
  }

  async requestMembership(
    actor: AuthorizationContext,
    problemId: string,
    teamId: string,
  ): Promise<LiaisonTeamMemberRecord> {
    return this.store.transaction(async (store) => {
      const problem = await store.liaisonProblems.getForUpdate(problemId);
      const team = await store.liaisonTeams.getForUpdate(teamId);
      if (
        problem === null ||
        team === null ||
        team.problemId !== problemId ||
        !(await actorIsActive(store, actor.uid)) ||
        !permittedAcross(actor, 'liaison.problem.join', 'liaison_problem', [
          problemScope(problemId),
          teamScope(teamId),
        ])
      )
        throw teamNotFound();
      if (problem.status !== 'open') throw problemNotOpen();
      if (team.status !== 'active') throw teamInactive();
      const existing = (await store.liaisonTeamMembers.listForUpdate({ query: problemId })).find(
        (member) =>
          member.problemId === problemId &&
          member.teamId === teamId &&
          member.memberUid === actor.uid,
      );
      if (existing !== undefined) {
        throw new HttpError(409, 'team_membership_exists', 'Team membership already exists');
      }
      const membership = await store.liaisonTeamMembers.create({
        problemId,
        teamId,
        memberUid: actor.uid,
        role: 'member',
        joinedAt: instant(this.now()),
        status: 'pending',
        ownerUid: actor.uid,
        scope: { type: 'liaison_team', id: teamId },
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'liaison.problem.team_join_requested',
        resourceType: 'liaison_team_member',
        resourceId: membership.id,
        details: { problemId, teamId },
      });
      return membership;
    });
  }

  async confirmMembership(
    actor: AuthorizationContext,
    problemId: string,
    teamId: string,
    memberUid: string,
  ): Promise<LiaisonTeamMemberRecord> {
    return this.store.transaction(async (store) => {
      const problem = await store.liaisonProblems.getForUpdate(problemId);
      const team = await store.liaisonTeams.getForUpdate(teamId);
      if (
        problem === null ||
        team === null ||
        team.problemId !== problemId ||
        team.maintainerUid !== actor.uid ||
        !(await actorIsActive(store, actor.uid)) ||
        !permittedAcross(actor, 'liaison.problem.join', 'liaison_problem', [
          problemScope(problemId),
          teamScope(teamId),
        ])
      ) {
        throw teamNotFound();
      }
      if (problem.status !== 'open') throw problemNotOpen();
      if (team.status !== 'active') throw teamInactive();
      const membership = (await store.liaisonTeamMembers.listForUpdate({ query: problemId })).find(
        (candidate) =>
          candidate.problemId === problemId &&
          candidate.teamId === teamId &&
          candidate.memberUid === memberUid,
      );
      if (membership === undefined) throw teamNotFound();
      if (membership.status !== 'pending') throw membershipNotPending();
      const updated = await store.liaisonTeamMembers.update(membership.id, { status: 'active' });
      if (updated === null) throw teamNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'liaison.problem.team_join_confirmed',
        resourceType: 'liaison_team_member',
        resourceId: membership.id,
        details: { problemId, teamId },
      });
      return updated;
    });
  }

  async listPosts(actor: AuthorizationContext, problemId: string): Promise<LiaisonPostRecord[]> {
    await this.requireVisibleProblem(actor, problemId);
    return (await this.store.liaisonPosts.list({ query: problemId }))
      .filter(
        (post) =>
          post.problemId === problemId && post.hiddenAt === null && post.status === 'visible',
      )
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      );
  }

  async updatePost(
    actor: AuthorizationContext,
    problemId: string,
    postId: string,
    body: string,
  ): Promise<LiaisonPostRecord> {
    return this.store.transaction(async (store) => {
      const problem = await store.liaisonProblems.getForUpdate(problemId);
      const post = await store.liaisonPosts.getForUpdate(postId);
      if (
        problem === null ||
        post === null ||
        post.problemId !== problemId ||
        post.authorUid !== actor.uid ||
        post.status !== 'visible' ||
        post.hiddenAt !== null ||
        !(await actorIsActive(store, actor.uid))
      )
        throw postNotFound();
      const scopes = [problemScope(problemId), ...(post.teamId ? [teamScope(post.teamId)] : [])];
      if (!permittedAcross(actor, 'liaison.problem.post', 'liaison_problem', scopes)) {
        throw postNotFound();
      }
      if (problem.status !== 'open') throw problemNotOpen();
      const updated = await store.liaisonPosts.update(postId, { body });
      if (updated === null) throw postNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'liaison.problem.post_updated',
        resourceType: 'liaison_post',
        resourceId: postId,
        details: { problemId, teamId: post.teamId },
      });
      return updated;
    });
  }

  async hidePost(
    actor: AuthorizationContext,
    problemId: string,
    postId: string,
  ): Promise<LiaisonPostRecord> {
    return this.store.transaction(async (store) => {
      const problem = await store.liaisonProblems.getForUpdate(problemId);
      const post = await store.liaisonPosts.getForUpdate(postId);
      if (
        problem === null ||
        post === null ||
        post.problemId !== problemId ||
        post.status !== 'visible' ||
        post.hiddenAt !== null ||
        !(await actorIsActive(store, actor.uid))
      )
        throw postNotFound();
      const scopes = [problemScope(problemId), ...(post.teamId ? [teamScope(post.teamId)] : [])];
      if (!permittedAcross(actor, 'liaison.problem.update', 'liaison_problem', scopes)) {
        throw postNotFound();
      }
      const hiddenAt = instant(this.now());
      const updated = await store.liaisonPosts.update(postId, {
        status: 'hidden',
        hiddenAt,
        hiddenByUid: actor.uid,
      });
      if (updated === null) throw postNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'liaison.problem.post_hidden',
        resourceType: 'liaison_post',
        resourceId: postId,
        details: { problemId, teamId: post.teamId, hiddenAt },
      });
      return updated;
    });
  }

  async removeMember(
    actor: AuthorizationContext,
    problemId: string,
    teamId: string,
    memberUid: string,
  ): Promise<void> {
    await this.store.transaction(async (store) => {
      const problem = await store.liaisonProblems.getForUpdate(problemId);
      const team = await store.liaisonTeams.getForUpdate(teamId);
      if (
        problem === null ||
        team === null ||
        team.problemId !== problemId ||
        team.maintainerUid !== actor.uid ||
        memberUid === actor.uid ||
        !(await actorIsActive(store, actor.uid)) ||
        !permittedAcross(actor, 'liaison.problem.join', 'liaison_problem', [
          problemScope(problemId),
          teamScope(teamId),
        ])
      )
        throw teamNotFound();
      const membership = (await store.liaisonTeamMembers.listForUpdate({ query: problemId })).find(
        (candidate) =>
          candidate.problemId === problemId &&
          candidate.teamId === teamId &&
          candidate.memberUid === memberUid &&
          candidate.status === 'active' &&
          candidate.role !== 'maintainer',
      );
      if (membership === undefined) throw teamNotFound();
      if ((await store.liaisonTeamMembers.update(membership.id, { status: 'inactive' })) === null) {
        throw teamNotFound();
      }
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'liaison.problem.team_member_removed',
        resourceType: 'liaison_team_member',
        resourceId: membership.id,
        details: { problemId, teamId, memberUid },
      });
    });
  }

  async createPost(
    actor: AuthorizationContext,
    problemId: string,
    input: PostCreateInput,
  ): Promise<LiaisonPostRecord> {
    return this.store.transaction(async (store) => {
      const problem = await store.liaisonProblems.getForUpdate(problemId);
      if (problem === null || !(await actorIsActive(store, actor.uid))) throw problemNotFound();
      if (input.kind === 'progress' && input.teamId === null) {
        throw new HttpError(400, 'team_required', 'Progress posts require a team');
      }
      if (input.teamId !== null) {
        const team = await store.liaisonTeams.getForUpdate(input.teamId);
        if (
          team === null ||
          team.problemId !== problemId ||
          !permittedAcross(actor, 'liaison.problem.post', 'liaison_problem', [
            problemScope(problemId),
            teamScope(input.teamId),
          ])
        )
          throw teamNotFound();
        if (problem.status !== 'open') throw problemNotOpen();
        if (team.status !== 'active') throw teamInactive();
        const membership = (
          await store.liaisonTeamMembers.listForUpdate({ query: problemId })
        ).find(
          (candidate) =>
            candidate.problemId === problemId &&
            candidate.teamId === input.teamId &&
            candidate.memberUid === actor.uid &&
            candidate.status === 'active',
        );
        if (membership === undefined) throw teamNotFound();
      } else if (
        !permitted(actor, 'liaison.problem.post', 'liaison_problem', problemScope(problemId))
      ) {
        throw problemNotFound();
      } else if (problem.status !== 'open') {
        throw problemNotOpen();
      }
      const post = await store.liaisonPosts.create({
        problemId,
        ...input,
        authorUid: actor.uid,
        hiddenAt: null,
        hiddenByUid: null,
        status: 'visible',
        ownerUid: actor.uid,
        scope: { type: 'liaison_problem', id: problemId },
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'liaison.problem.post_created',
        resourceType: 'liaison_post',
        resourceId: post.id,
        details: { problemId, kind: post.kind, teamId: post.teamId },
      });
      return post;
    });
  }

  async listOutcomes(
    actor: AuthorizationContext,
    problemId: string,
  ): Promise<LiaisonOutcomeRecord[]> {
    await this.requireVisibleProblem(actor, problemId);
    return (await this.store.liaisonOutcomes.list({ query: problemId })).filter(
      (outcome) => outcome.problemId === problemId,
    );
  }

  async submitOutcome(
    actor: AuthorizationContext,
    problemId: string,
    input: OutcomeCreateInput,
  ): Promise<LiaisonOutcomeRecord> {
    return this.store.transaction(async (store) => {
      const problem = await store.liaisonProblems.getForUpdate(problemId);
      const team = await store.liaisonTeams.getForUpdate(input.teamId);
      if (
        problem === null ||
        team === null ||
        team.problemId !== problemId ||
        !(await actorIsActive(store, actor.uid)) ||
        !permittedAcross(actor, 'liaison.problem.outcome.submit', 'liaison_outcome', [
          problemScope(problemId),
          teamScope(input.teamId),
        ])
      )
        throw teamNotFound();
      if (problem.status !== 'open' && problem.status !== 'paused')
        throw problemNotAcceptingOutcomes();
      if (team.status !== 'active') throw teamInactive();
      const member = (await store.liaisonTeamMembers.listForUpdate({ query: problemId })).find(
        (candidate) =>
          candidate.problemId === problemId &&
          candidate.teamId === input.teamId &&
          candidate.memberUid === actor.uid &&
          candidate.status === 'active',
      );
      if (member === undefined) throw teamNotFound();
      const versions = (await store.liaisonOutcomes.listForUpdate({ query: problemId }))
        .filter((outcome) => outcome.problemId === problemId && outcome.teamId === input.teamId)
        .map(({ version }) => version);
      const version = versions.length === 0 ? 1 : Math.max(...versions) + 1;
      const outcome = await store.liaisonOutcomes.create({
        problemId,
        ...input,
        version,
        submittedAt: instant(this.now()),
        adoptedAt: null,
        adoptedByUid: null,
        status: 'submitted',
        ownerUid: actor.uid,
        scope: { type: 'liaison_team', id: input.teamId },
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'liaison.problem.outcome_submitted',
        resourceType: 'liaison_outcome',
        resourceId: outcome.id,
        details: { problemId, teamId: input.teamId, version },
      });
      return outcome;
    });
  }

  async adoptOutcome(
    actor: AuthorizationContext,
    problemId: string,
    outcomeId: string,
  ): Promise<LiaisonOutcomeRecord> {
    return this.store.transaction(async (store) => {
      const problem = await store.liaisonProblems.getForUpdate(problemId);
      const outcome = await store.liaisonOutcomes.getForUpdate(outcomeId);
      if (outcome === null || outcome.problemId !== problemId) throw outcomeNotFound();
      const team = await store.liaisonTeams.getForUpdate(outcome.teamId);
      if (
        problem === null ||
        team === null ||
        team.problemId !== problemId ||
        !(await actorIsActive(store, actor.uid)) ||
        !permittedAcross(actor, 'liaison.problem.outcome.manage', 'liaison_outcome', [
          problemScope(problemId),
          teamScope(outcome.teamId),
          outcomeScope(outcomeId),
        ])
      )
        throw outcomeNotFound();
      if (!publicStatuses.has(problem.status)) throw problemNotAcceptingOutcomes();
      if (team.status !== 'active') throw teamInactive();
      if (outcome.status === 'adopted' || outcome.adoptedAt !== null) {
        throw new HttpError(409, 'outcome_already_adopted', 'Outcome is already adopted');
      }
      if (outcome.status !== 'submitted') throw outcomeNotSubmitted();
      const adoptedAt = instant(this.now());
      const updated = await store.liaisonOutcomes.update(outcomeId, {
        status: 'adopted',
        adoptedAt,
        adoptedByUid: actor.uid,
      });
      if (updated === null) throw outcomeNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'liaison.problem.outcome_adopted',
        resourceType: 'liaison_outcome',
        resourceId: outcomeId,
        details: { problemId, teamId: outcome.teamId, version: outcome.version, adoptedAt },
      });
      return updated;
    });
  }

  private async requireVisibleProblem(
    actor: AuthorizationContext,
    problemId: string,
  ): Promise<LiaisonProblemRecord> {
    const problem = await this.store.liaisonProblems.get(problemId);
    if (problem === null || !canSee(actor, problem)) throw problemNotFound();
    return problem;
  }
}
