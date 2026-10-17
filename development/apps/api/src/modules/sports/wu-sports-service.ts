import {
  isGlobalOrganizationBusinessSupervisor,
  organizationMembershipsForRoles,
  type SportsMatch,
  type SportsMatchStatus,
} from '@freebbs-development/contracts';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type {
  DevelopmentStore,
  SportsMatchRecord,
  SportsTeamShowcaseRecord,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canMaintainSportsCard, canonicalSportsTeam } from './card-authorization.js';

export interface MatchInput {
  title: string;
  coverUrl: string | null;
  startsAt: string;
  endsAt: string;
  location: string;
  result: string | null;
  liveUrl: string | null;
  replayUrl: string | null;
}

function matchStatus(record: SportsMatchRecord, now = Date.now()): SportsMatchStatus {
  if (now < Date.parse(record.startsAt)) return 'upcoming';
  if (now < Date.parse(record.endsAt)) return 'live';
  return 'ended';
}

function view(record: SportsMatchRecord): SportsMatch {
  return { ...record, matchStatus: matchStatus(record) };
}

function allowed(
  actor: AuthorizationContext,
  action: string,
  resource: string,
  scope = { type: 'public', id: '*' },
) {
  if (actor.previewing) return false;
  const decisions = [
    scope,
    { type: 'social_organization', id: 'sports_center' },
    { type: 'department', id: 'student_union.sports_center' },
  ].map((candidate) => authorize(actor, { action, resource, scope: candidate }));
  return (
    !decisions.some(({ reason }) => reason === 'explicit-deny' || reason === 'invalid-scope') &&
    decisions.some(({ allowed }) => allowed)
  );
}

async function currentSportsActor(
  store: DevelopmentStore,
  actor: AuthorizationContext,
): Promise<AuthorizationContext> {
  const current = await loadAuthorizationContext(store, actor, new Date());
  return {
    ...current,
    policies: [
      ...(current.policies ?? []),
      ...(actor.policies ?? []).filter(({ effect }) => effect === 'deny'),
    ],
  };
}

function managesAllSports(actor: AuthorizationContext): boolean {
  return (
    isGlobalOrganizationBusinessSupervisor(actor) ||
    organizationMembershipsForRoles(actor.roles).some(
      ({ organizationId, level }) =>
        organizationId === 'sports_center' && (level === 'lead' || level === 'director'),
    )
  );
}

export class WuSportsService {
  constructor(private readonly store: DevelopmentStore) {}

  async listMatches(
    actor: AuthorizationContext,
    from?: string,
    to?: string,
  ): Promise<SportsMatch[]> {
    actor = await currentSportsActor(this.store, actor);
    if (!allowed(actor, 'sports.match.read', 'sports_match'))
      throw new HttpError(403, 'forbidden', 'Sports match read permission is required');
    const records = await this.store.sportsMatches.list({ status: 'active' });
    return records
      .filter((record) => (!from || record.endsAt >= from) && (!to || record.startsAt <= to))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map(view);
  }

  async createMatch(actor: AuthorizationContext, input: MatchInput): Promise<SportsMatch> {
    actor = await currentSportsActor(this.store, actor);
    if (!allowed(actor, 'sports.match.create', 'sports_match'))
      throw new HttpError(403, 'forbidden', 'Sports match create permission is required');
    const created = await this.store.sportsMatches.create({
      ...input,
      status: 'active',
      ownerUid: actor.uid,
      scope: { type: 'public', id: '*' },
    });
    await recordAuditEvent(this.store, {
      actorUid: actor.uid,
      action: 'sports.match.created',
      resourceType: 'sports_match',
      resourceId: created.id,
      details: { startsAt: created.startsAt, location: created.location },
    });
    return view(created);
  }

  async updateMatch(
    actor: AuthorizationContext,
    id: string,
    patch: Partial<MatchInput>,
  ): Promise<SportsMatch> {
    actor = await currentSportsActor(this.store, actor);
    const current = await this.store.sportsMatches.get(id);
    if (!current) throw new HttpError(404, 'sports_match_not_found', 'Sports match not found');
    if (
      !allowed(actor, 'sports.match.update', 'sports_match', current.scope) ||
      (current.ownerUid !== actor.uid && !managesAllSports(actor))
    )
      throw new HttpError(403, 'forbidden', 'Sports match update permission is required');
    const target = { ...current, ...patch };
    if (!(Date.parse(target.startsAt) < Date.parse(target.endsAt)))
      throw new HttpError(400, 'invalid_match_dates', 'Match start must precede its end');
    const updated = await this.store.sportsMatches.update(id, patch);
    if (!updated) throw new HttpError(404, 'sports_match_not_found', 'Sports match not found');
    await recordAuditEvent(this.store, {
      actorUid: actor.uid,
      action: 'sports.match.updated',
      resourceType: 'sports_match',
      resourceId: id,
      details: { changedFields: Object.keys(patch) },
    });
    return view(updated);
  }

  async deleteMatch(actor: AuthorizationContext, id: string): Promise<void> {
    actor = await currentSportsActor(this.store, actor);
    const current = await this.store.sportsMatches.get(id);
    if (!current) throw new HttpError(404, 'sports_match_not_found', 'Sports match not found');
    if (
      !allowed(actor, 'sports.match.delete', 'sports_match', current.scope) ||
      (current.ownerUid !== actor.uid && !managesAllSports(actor))
    )
      throw new HttpError(403, 'forbidden', 'Sports match delete permission is required');
    await this.store.sportsMatches.delete(id);
    await recordAuditEvent(this.store, {
      actorUid: actor.uid,
      action: 'sports.match.deleted',
      resourceType: 'sports_match',
      resourceId: id,
      details: {},
    });
  }

  async getShowcase(
    actor: AuthorizationContext,
    teamId: string,
  ): Promise<SportsTeamShowcaseRecord | null> {
    actor = await currentSportsActor(this.store, actor);
    if (
      !allowed(actor, 'sports.showcase.read', 'sports_showcase', {
        type: 'sports_team',
        id: teamId,
      })
    )
      throw new HttpError(403, 'forbidden', 'Sports showcase read permission is required');
    return (
      (
        await this.store.sportsTeamShowcases.list({ scopeType: 'sports_team', scopeId: teamId })
      ).find((item) => item.teamId === teamId) ?? null
    );
  }

  async saveShowcase(
    actor: AuthorizationContext,
    teamId: string,
    markdown: string,
  ): Promise<SportsTeamShowcaseRecord> {
    const scope = { type: 'sports_team', id: teamId };
    const team = await this.store.sportsTeams.get(teamId);
    if (
      authorize(actor, { action: 'sports.showcase.update', resource: 'sports_showcase', scope })
        .reason === 'explicit-deny' ||
      !(await canMaintainSportsCard(this.store, actor, teamId, 'sports.showcase.update'))
    )
      throw new HttpError(403, 'forbidden', 'Sports showcase update permission is required');
    if (!canonicalSportsTeam(team, teamId))
      throw new HttpError(404, 'sports_team_not_found', 'Sports team not found');
    const existing = (
      await this.store.sportsTeamShowcases.list({ scopeType: scope.type, scopeId: scope.id })
    ).find((item) => item.teamId === teamId);
    const saved = existing
      ? await this.store.sportsTeamShowcases.update(existing.id, {
          markdown,
          updatedByUid: actor.uid,
        })
      : await this.store.sportsTeamShowcases.create({
          teamId,
          markdown,
          updatedByUid: actor.uid,
          status: 'active',
          ownerUid: actor.uid,
          scope,
        });
    if (!saved) throw new Error('Failed to save sports showcase');
    await recordAuditEvent(this.store, {
      actorUid: actor.uid,
      action: 'sports.showcase.updated',
      resourceType: 'sports_showcase',
      resourceId: saved.id,
      details: { teamId },
    });
    return saved;
  }
}
