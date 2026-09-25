import type { SportsMatch, SportsMatchStatus } from '@freebbs-development/contracts';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type {
  DevelopmentStore,
  SportsMatchRecord,
  SportsTeamShowcaseRecord,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';

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
  return authorize(actor, { action, resource, scope }).allowed;
}

function managesAllSports(actor: AuthorizationContext): boolean {
  return actor.roles.some((role) =>
    ['platform.super_admin', 'domain.sports_lead', 'department.sports_director'].includes(role),
  );
}

export class WuSportsService {
  constructor(private readonly store: DevelopmentStore) {}

  async listMatches(
    actor: AuthorizationContext,
    from?: string,
    to?: string,
  ): Promise<SportsMatch[]> {
    if (!allowed(actor, 'sports.match.read', 'sports_match'))
      throw new HttpError(403, 'forbidden', 'Sports match read permission is required');
    const records = await this.store.sportsMatches.list({ status: 'active' });
    return records
      .filter((record) => (!from || record.endsAt >= from) && (!to || record.startsAt <= to))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map(view);
  }

  async createMatch(actor: AuthorizationContext, input: MatchInput): Promise<SportsMatch> {
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
    const current = await this.store.sportsMatches.get(id);
    if (!current) throw new HttpError(404, 'sports_match_not_found', 'Sports match not found');
    if (
      !allowed(actor, 'sports.match.update', 'sports_match') ||
      (current.ownerUid !== actor.uid && !managesAllSports(actor))
    )
      throw new HttpError(403, 'forbidden', 'Sports match update permission is required');
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
    const current = await this.store.sportsMatches.get(id);
    if (!current) throw new HttpError(404, 'sports_match_not_found', 'Sports match not found');
    if (
      !allowed(actor, 'sports.match.delete', 'sports_match') ||
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
    if (!allowed(actor, 'sports.showcase.update', 'sports_showcase', scope))
      throw new HttpError(403, 'forbidden', 'Sports showcase update permission is required');
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
