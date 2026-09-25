import type { ScopeRef } from '@freebbs-development/contracts';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type {
  DevelopmentStore,
  ListFilters,
  SportsCheckinRecord,
  SportsTeamMemberRecord,
  SportsTeamRecord,
  TagAssignmentRecord,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canTransition } from '../../core/workflow/state-machine.js';
import { archiveTagAssignment, createTagAssignment } from '../admin/assignment-service.js';

export type SportsTeamStatus = 'draft' | 'active' | 'archived';
export interface SportsTeamInput {
  season?: string;
  trainingSchedule?: string;
  name: string;
  description: string;
  status: SportsTeamStatus;
}
export type SportsTeamPatch = Partial<Omit<SportsTeamInput, 'status'>>;
export interface SportsCheckinInput {
  memberUid: string;
  checkinDate: string;
}
export interface SportsCheckinResult {
  record: SportsCheckinRecord;
  created: boolean;
}
export interface SportsTeamMemberView extends SportsTeamMemberRecord {
  isCaptain: boolean;
}

const TEAM_TRANSITIONS = {
  draft: ['active', 'archived'],
  active: ['archived'],
  archived: ['active'],
} as const;
const CAPTAIN_TAG = 'sports.team_captain';

type TransitionResult =
  | { kind: 'missing' }
  | { kind: 'updated'; record: SportsTeamRecord }
  | { kind: 'rejected'; from: string; to: string; scope: ScopeRef };

function teamScope(teamId: string): ScopeRef {
  return { type: 'sports_team', id: teamId };
}

function canTeam(actor: AuthorizationContext, action: string, scope?: ScopeRef): boolean {
  return authorize(actor, { action, resource: 'sports_team', scope }).allowed;
}

function canCheckin(actor: AuthorizationContext, action: string, scope: ScopeRef): boolean {
  return authorize(actor, { action, resource: 'sports_checkin', scope }).allowed;
}

function teamNotFound(): HttpError {
  return new HttpError(404, 'sports_team_not_found', 'Sports team not found');
}

function memberNotFound(): HttpError {
  return new HttpError(404, 'sports_team_member_not_found', 'Sports team member not found');
}

function assertRosterWritable(team: SportsTeamRecord): void {
  if (team.status === 'archived') {
    throw new HttpError(409, 'sports_team_archived', 'Archived sports teams are read-only');
  }
}

function assertCheckinWritable(team: SportsTeamRecord): void {
  if (team.status === 'archived') {
    throw new HttpError(409, 'sports_team_archived', 'Archived sports teams are read-only');
  }
  if (team.status !== 'active') {
    throw new HttpError(409, 'sports_team_not_active', 'Sports team is not active');
  }
}

function isCanonicalTeam(
  record: SportsTeamRecord | null,
  teamId: string,
): record is SportsTeamRecord {
  return (
    record !== null &&
    record.scope.type === 'sports_team' &&
    record.scope.id === teamId &&
    teamId !== '*'
  );
}

function isExactMember(record: SportsTeamMemberRecord, teamId: string): boolean {
  return (
    record.teamId === teamId &&
    record.status === 'active' &&
    record.scope.type === 'sports_team' &&
    record.scope.id === teamId
  );
}

function isActiveCaptain(
  assignment: TagAssignmentRecord,
  teamId: string,
  now = new Date(),
): boolean {
  return (
    assignment.tagKey === CAPTAIN_TAG &&
    assignment.status === 'active' &&
    (assignment.expiresAt === null || Date.parse(assignment.expiresAt) > now.getTime()) &&
    assignment.scope.type === 'sports_team' &&
    assignment.scope.id === teamId
  );
}

export class SportsService {
  constructor(private readonly store: DevelopmentStore) {}

  async listTeams(actor: AuthorizationContext, filters: ListFilters): Promise<SportsTeamRecord[]> {
    const records = await this.store.sportsTeams.list(filters);
    return records.filter((record) => {
      if (!isCanonicalTeam(record, record.id)) return false;
      const mayRead =
        canTeam(actor, 'sports.team.read', record.scope) ||
        canCheckin(actor, 'sports.checkin.read', record.scope);
      return (
        mayRead &&
        (record.status === 'active' || canTeam(actor, 'sports.team.update', record.scope))
      );
    });
  }

  async createTeam(actor: AuthorizationContext, input: SportsTeamInput): Promise<SportsTeamRecord> {
    return this.store.transaction(async (store) => {
      const created = await store.sportsTeams.create({
        ...input,
        ownerUid: actor.uid,
        scope: { type: 'sports_team', id: 'pending' },
      });
      const canonical = await store.sportsTeams.update(created.id, {
        scope: teamScope(created.id),
      });
      if (canonical === null) throw new Error('Failed to canonicalize created sports team');
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'sports.team.created',
        resourceType: 'sports_team',
        resourceId: canonical.id,
        details: { status: canonical.status, scope: canonical.scope },
      });
      return canonical;
    });
  }

  async updateTeam(
    actor: AuthorizationContext,
    id: string,
    patch: SportsTeamPatch,
  ): Promise<SportsTeamRecord> {
    return this.store.transaction(async (store) => {
      const current = await store.sportsTeams.getForUpdate(id);
      if (!isCanonicalTeam(current, id) || !canTeam(actor, 'sports.team.update', current.scope)) {
        throw teamNotFound();
      }
      const updated = await store.sportsTeams.update(id, patch);
      if (updated === null) throw teamNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'sports.team.updated',
        resourceType: 'sports_team',
        resourceId: id,
        details: { changedFields: Object.keys(patch).sort(), scope: updated.scope },
      });
      return updated;
    });
  }

  async transitionTeam(
    actor: AuthorizationContext,
    id: string,
    to: SportsTeamStatus,
  ): Promise<SportsTeamRecord> {
    const result = await this.store.transaction<TransitionResult>(async (store) => {
      const current = await store.sportsTeams.getForUpdate(id);
      if (!isCanonicalTeam(current, id) || !canTeam(actor, 'sports.team.update', current.scope)) {
        return { kind: 'missing' };
      }
      const from = current.status;
      if (
        !Object.hasOwn(TEAM_TRANSITIONS, from) ||
        !canTransition(TEAM_TRANSITIONS, from as SportsTeamStatus, to)
      ) {
        return { kind: 'rejected', from, to, scope: current.scope };
      }
      const updated = await store.sportsTeams.update(id, { status: to });
      if (updated === null) return { kind: 'missing' };
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'sports.team.status_changed',
        resourceType: 'sports_team',
        resourceId: id,
        details: { from, to, outcome: 'accepted', scope: updated.scope },
      });
      return { kind: 'updated', record: updated };
    });
    if (result.kind === 'missing') throw teamNotFound();
    if (result.kind === 'rejected') {
      await recordAuditEvent(this.store, {
        actorUid: actor.uid,
        action: 'sports.team.status_changed',
        resourceType: 'sports_team',
        resourceId: id,
        details: {
          from: result.from,
          to: result.to,
          outcome: 'rejected',
          scope: result.scope,
        },
      });
      throw new HttpError(409, 'invalid_state_transition', 'Invalid sports team state transition');
    }
    return result.record;
  }

  async listMembers(actor: AuthorizationContext, teamId: string): Promise<SportsTeamMemberView[]> {
    return this.store.transaction(async (store) => {
      const team = await store.sportsTeams.getForUpdate(teamId);
      if (!isCanonicalTeam(team, teamId) || !canTeam(actor, 'sports.team.update', team.scope)) {
        throw teamNotFound();
      }
      const members = (
        await store.sportsTeamMembers.listForUpdate({
          scopeType: 'sports_team',
          scopeId: teamId,
        })
      ).filter((record) => isExactMember(record, teamId));
      const captains = (
        await store.tagAssignments.listForUpdate({
          scopeType: 'sports_team',
          scopeId: teamId,
        })
      ).filter((assignment) => isActiveCaptain(assignment, teamId));
      const captainUids = new Set(captains.map((assignment) => assignment.subjectUid));
      return members.map((member) => ({
        ...member,
        isCaptain: captainUids.has(member.memberUid),
      }));
    });
  }

  async addMember(
    actor: AuthorizationContext,
    teamId: string,
    memberUid: string,
  ): Promise<SportsTeamMemberRecord> {
    return this.store.transaction(async (store) => {
      const team = await store.sportsTeams.getForUpdate(teamId);
      if (!isCanonicalTeam(team, teamId) || !canTeam(actor, 'sports.team.update', team.scope)) {
        throw teamNotFound();
      }
      assertRosterWritable(team);

      const subject = (await store.subjects.listForUpdate({ query: memberUid })).find(
        (candidate) => candidate.uid === memberUid,
      );
      if (subject === undefined || subject.status !== 'active') {
        throw new HttpError(400, 'sports_member_subject_invalid', 'Member subject is not active');
      }
      const created = await store.sportsTeamMembers.create({
        teamId,
        memberUid,
        status: 'active',
        ownerUid: actor.uid,
        scope: team.scope,
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'sports.team.member_added',
        resourceType: 'sports_team_member',
        resourceId: created.id,
        details: { teamId, memberUid, scope: created.scope },
      });
      return created;
    });
  }

  async removeMember(
    actor: AuthorizationContext,
    teamId: string,
    memberUid: string,
  ): Promise<void> {
    await this.store.transaction(async (store) => {
      const team = await store.sportsTeams.getForUpdate(teamId);
      if (!isCanonicalTeam(team, teamId) || !canTeam(actor, 'sports.team.update', team.scope)) {
        throw teamNotFound();
      }
      assertRosterWritable(team);

      const membership = (
        await store.sportsTeamMembers.listForUpdate({
          scopeType: 'sports_team',
          scopeId: teamId,
        })
      ).find((record) => isExactMember(record, teamId) && record.memberUid === memberUid);
      if (membership === undefined) throw memberNotFound();
      const captain = (
        await store.tagAssignments.listForUpdate({
          scopeType: 'sports_team',
          scopeId: teamId,
        })
      ).find(
        (assignment) => isActiveCaptain(assignment, teamId) && assignment.subjectUid === memberUid,
      );
      if (captain !== undefined) {
        throw new HttpError(
          409,
          'sports_team_member_is_captain',
          'Revoke the captain assignment before removing this member',
        );
      }
      if (!(await store.sportsTeamMembers.delete(membership.id))) throw memberNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'sports.team.member_removed',
        resourceType: 'sports_team_member',
        resourceId: membership.id,
        details: { teamId, memberUid, scope: membership.scope },
      });
    });
  }

  async grantCaptain(
    actor: AuthorizationContext,
    teamId: string,
    memberUid: string,
  ): Promise<TagAssignmentRecord> {
    return this.store.transaction(async (store) => {
      const team = await store.sportsTeams.getForUpdate(teamId);
      if (!isCanonicalTeam(team, teamId) || !canTeam(actor, 'sports.team.update', team.scope)) {
        throw teamNotFound();
      }
      assertRosterWritable(team);

      const membership = (
        await store.sportsTeamMembers.listForUpdate({
          scopeType: 'sports_team',
          scopeId: teamId,
        })
      ).find((record) => isExactMember(record, teamId) && record.memberUid === memberUid);
      if (membership === undefined) throw memberNotFound();
      const existingExpired = (
        await store.tagAssignments.listForUpdate({
          scopeType: 'sports_team',
          scopeId: teamId,
        })
      ).find(
        (candidate) =>
          candidate.tagKey === CAPTAIN_TAG &&
          candidate.status === 'active' &&
          candidate.subjectUid === memberUid &&
          candidate.scope.type === 'sports_team' &&
          candidate.scope.id === teamId &&
          candidate.expiresAt !== null &&
          (!Number.isFinite(Date.parse(candidate.expiresAt)) ||
            Date.parse(candidate.expiresAt) <= Date.now()),
      );
      if (existingExpired !== undefined) {
        await archiveTagAssignment(store, existingExpired.id, { actorUid: actor.uid });
      }
      const assignment = await createTagAssignment(
        store,
        { subjectUid: memberUid, tagKey: CAPTAIN_TAG, scope: team.scope },
        { actorUid: actor.uid },
      );
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'sports.team.captain_granted',
        resourceType: 'sports_team',
        resourceId: teamId,
        details: { memberUid, assignmentId: assignment.id, scope: assignment.scope },
      });
      return assignment;
    });
  }

  async revokeCaptain(
    actor: AuthorizationContext,
    teamId: string,
    memberUid: string,
  ): Promise<TagAssignmentRecord> {
    return this.store.transaction(async (store) => {
      const team = await store.sportsTeams.getForUpdate(teamId);
      if (!isCanonicalTeam(team, teamId) || !canTeam(actor, 'sports.team.update', team.scope)) {
        throw teamNotFound();
      }
      assertRosterWritable(team);

      const assignment = (
        await store.tagAssignments.listForUpdate({
          scopeType: 'sports_team',
          scopeId: teamId,
        })
      ).find(
        (candidate) => isActiveCaptain(candidate, teamId) && candidate.subjectUid === memberUid,
      );
      if (assignment === undefined) throw memberNotFound();
      const archived = await archiveTagAssignment(store, assignment.id, { actorUid: actor.uid });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'sports.team.captain_revoked',
        resourceType: 'sports_team',
        resourceId: teamId,
        details: { memberUid, assignmentId: archived.id, scope: archived.scope },
      });
      return archived;
    });
  }

  async listCheckins(actor: AuthorizationContext, teamId: string): Promise<SportsCheckinRecord[]> {
    const routeScope = teamScope(teamId);
    if (!canCheckin(actor, 'sports.checkin.read', routeScope)) throw teamNotFound();
    const team = await this.store.sportsTeams.get(teamId);
    if (!isCanonicalTeam(team, teamId)) throw teamNotFound();
    return (await this.store.sportsCheckins.list({ query: teamId })).filter(
      (record) =>
        record.teamId === teamId &&
        record.scope.type === routeScope.type &&
        record.scope.id === routeScope.id,
    );
  }

  async createCheckin(
    actor: AuthorizationContext,
    teamId: string,
    input: SportsCheckinInput,
  ): Promise<SportsCheckinResult> {
    return this.store.transaction(async (store) => {
      const routeScope = teamScope(teamId);
      const team = await store.sportsTeams.getForUpdate(teamId);
      if (!isCanonicalTeam(team, teamId)) throw teamNotFound();
      const freshActor = await loadAuthorizationContext(store, actor, new Date());
      if (!canCheckin(freshActor, 'sports.checkin.create', routeScope)) throw teamNotFound();
      assertCheckinWritable(team);
      const membership = (
        await store.sportsTeamMembers.listForUpdate({
          scopeType: 'sports_team',
          scopeId: teamId,
        })
      ).find((record) => isExactMember(record, teamId) && record.memberUid === input.memberUid);
      if (membership === undefined) throw memberNotFound();
      const existing = (await store.sportsCheckins.list({ query: teamId })).find(
        (record) =>
          record.teamId === teamId &&
          record.memberUid === input.memberUid &&
          record.checkinDate === input.checkinDate,
      );
      if (
        existing !== undefined &&
        (existing.scope.type !== routeScope.type || existing.scope.id !== routeScope.id)
      ) {
        throw teamNotFound();
      }
      if (existing !== undefined) return { record: existing, created: false };

      const record = await store.sportsCheckins.create({
        teamId,
        memberUid: input.memberUid,
        checkinDate: input.checkinDate,
        status: 'present',
        ownerUid: actor.uid,
        scope: routeScope,
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'sports.checkin.created',
        resourceType: 'sports_checkin',
        resourceId: record.id,
        details: { teamId, memberUid: input.memberUid },
      });
      return { record, created: true };
    });
  }
}
