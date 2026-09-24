import type { ScopeRef } from '@freebbs-development/contracts';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type {
  ClubMembershipRecord,
  ClubRecord,
  DevelopmentStore,
  ListFilters,
  TechnicalSupportStatus,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canTransition } from '../../core/workflow/state-machine.js';

export type ClubStatus = 'draft' | 'active' | 'archived';
export interface ClubInput {
  category?: string;
  contactName?: string;
  publicContact?: string;
  name: string;
  description: string;
  status: ClubStatus;
  scope: ScopeRef;
}
export type ClubPatch = Partial<Omit<ClubInput, 'status'>>;

const CLUB_TRANSITIONS = {
  draft: ['active'],
  active: ['archived'],
  archived: ['active'],
} as const;
const TECHNICAL_SUPPORT_TRANSITIONS = {
  not_requested: ['requested'],
  requested: ['confirmed'],
  confirmed: [],
} as const;

type TransitionResult<T> =
  | { kind: 'missing' }
  | { kind: 'updated'; record: T }
  | { kind: 'rejected'; from: string; to: string; scope: ScopeRef };

function can(actor: AuthorizationContext, action: string, scope: ScopeRef): boolean {
  return authorize(actor, { action, resource: 'club', scope }).allowed;
}
function canMembership(actor: AuthorizationContext, action: string, scope: ScopeRef): boolean {
  return authorize(actor, { action, resource: 'club_membership', scope }).allowed;
}
function clubNotFound(): HttpError {
  return new HttpError(404, 'club_not_found', 'Club not found');
}
function membershipNotFound(): HttpError {
  return new HttpError(404, 'club_membership_not_found', 'Club membership not found');
}

export class ClubsService {
  constructor(private readonly store: DevelopmentStore) {}

  async list(actor: AuthorizationContext, filters: ListFilters): Promise<ClubRecord[]> {
    const records = await this.store.clubs.list(filters);
    return records.filter(
      (record) =>
        can(actor, 'clubs.read', record.scope) &&
        (record.status === 'active' || can(actor, 'clubs.update', record.scope)),
    );
  }

  async create(actor: AuthorizationContext, input: ClubInput): Promise<ClubRecord> {
    return this.store.transaction(async (store) => {
      const created = await store.clubs.create({
        ...input,
        organizationId: 'liaison_center',
        technicalSupportStatus: 'not_requested',
        technicalSupportNote: null,
        ownerUid: actor.uid,
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'clubs.club.created',
        resourceType: 'club',
        resourceId: created.id,
        details: { status: created.status, scope: created.scope },
      });
      return created;
    });
  }

  async update(actor: AuthorizationContext, id: string, patch: ClubPatch): Promise<ClubRecord> {
    return this.store.transaction(async (store) => {
      const current = await store.clubs.getForUpdate(id);
      if (current === null || !can(actor, 'clubs.update', current.scope)) throw clubNotFound();
      const targetScope = patch.scope ?? current.scope;
      if (!can(actor, 'clubs.update', targetScope)) throw clubNotFound();
      const updated = await store.clubs.update(id, patch);
      if (updated === null) throw clubNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'clubs.club.updated',
        resourceType: 'club',
        resourceId: id,
        details: {
          changedFields: Object.keys(patch).sort(),
          fromScope: current.scope,
          toScope: updated.scope,
        },
      });
      return updated;
    });
  }

  async transition(
    actor: AuthorizationContext,
    id: string,
    to: 'active' | 'archived',
  ): Promise<ClubRecord> {
    const result = await this.store.transaction<TransitionResult<ClubRecord>>(async (store) => {
      const current = await store.clubs.getForUpdate(id);
      if (current === null || !can(actor, 'clubs.update', current.scope))
        return { kind: 'missing' };
      const from = current.status as ClubStatus;
      if (!Object.hasOwn(CLUB_TRANSITIONS, from) || !canTransition(CLUB_TRANSITIONS, from, to)) {
        return { kind: 'rejected', from, to, scope: current.scope };
      }
      const updated = await store.clubs.update(id, { status: to });
      if (updated === null) return { kind: 'missing' };
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'clubs.club.status_changed',
        resourceType: 'club',
        resourceId: id,
        details: { from, to, outcome: 'accepted', scope: updated.scope },
      });
      return { kind: 'updated', record: updated };
    });
    if (result.kind === 'missing') throw clubNotFound();
    if (result.kind === 'rejected') {
      await recordAuditEvent(this.store, {
        actorUid: actor.uid,
        action: 'clubs.club.status_changed',
        resourceType: 'club',
        resourceId: id,
        details: { from: result.from, to: result.to, outcome: 'rejected', scope: result.scope },
      });
      throw new HttpError(409, 'invalid_state_transition', 'Invalid club state transition');
    }
    return result.record;
  }

  async join(actor: AuthorizationContext, clubId: string): Promise<ClubMembershipRecord> {
    return this.store.transaction(async (store) => {
      const club = await store.clubs.getForUpdate(clubId);
      const routeScope = { type: 'club', id: clubId } as const;
      if (club === null || !canMembership(actor, 'clubs.join', routeScope)) throw clubNotFound();
      if (club.status !== 'active') {
        throw new HttpError(409, 'club_not_active', 'Club is not accepting members');
      }
      const existing = (await store.clubMemberships.listForUpdate({ query: clubId })).find(
        (record) => record.clubId === clubId && record.memberUid === actor.uid,
      );
      if (
        existing !== undefined &&
        (existing.status === 'pending' || existing.status === 'active')
      ) {
        throw new HttpError(409, 'club_membership_exists', 'Membership already exists');
      }
      const membership =
        existing === undefined
          ? await store.clubMemberships.create({
              clubId,
              memberUid: actor.uid,
              status: 'pending',
              ownerUid: actor.uid,
              scope: routeScope,
            })
          : await store.clubMemberships.update(existing.id, { status: 'pending' });
      if (membership === null) throw membershipNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'clubs.membership.requested',
        resourceType: 'club_membership',
        resourceId: membership.id,
        details: { clubId, reused: existing !== undefined },
      });
      return membership;
    });
  }

  async leave(actor: AuthorizationContext, clubId: string): Promise<void> {
    await this.store.transaction(async (store) => {
      const club = await store.clubs.getForUpdate(clubId);
      const routeScope = { type: 'club', id: clubId } as const;
      if (club === null || !canMembership(actor, 'clubs.leave', routeScope)) throw clubNotFound();
      const membership = (await store.clubMemberships.listForUpdate({ query: clubId })).find(
        (record) => record.clubId === clubId && record.memberUid === actor.uid,
      );
      if (membership === undefined) throw membershipNotFound();
      if (membership.status !== 'active' && membership.status !== 'pending') {
        throw new HttpError(409, 'club_membership_not_active', 'Membership is not active');
      }
      await store.clubMemberships.update(membership.id, { status: 'left' });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'clubs.membership.left',
        resourceType: 'club_membership',
        resourceId: membership.id,
        details: { clubId },
      });
    });
  }

  async listMemberships(
    actor: AuthorizationContext,
    clubId: string,
  ): Promise<ClubMembershipRecord[]> {
    const club = await this.store.clubs.get(clubId);
    if (club === null) throw clubNotFound();
    const records = (await this.store.clubMemberships.list({ query: clubId })).filter(
      (record) => record.clubId === clubId,
    );
    if (can(actor, 'clubs.update', club.scope)) return records;
    if (!canMembership(actor, 'clubs.join', { type: 'club', id: clubId })) throw clubNotFound();
    return records.filter((record) => record.memberUid === actor.uid);
  }

  async updateMembership(
    actor: AuthorizationContext,
    clubId: string,
    membershipId: string,
    status: 'active' | 'rejected',
  ): Promise<ClubMembershipRecord> {
    return this.store.transaction(async (store) => {
      const club = await store.clubs.getForUpdate(clubId);
      if (club === null || !can(actor, 'clubs.update', club.scope)) throw clubNotFound();
      const membership = await store.clubMemberships.getForUpdate(membershipId);
      if (membership === null || membership.clubId !== clubId) throw membershipNotFound();
      if (membership.status !== 'pending') {
        throw new HttpError(409, 'invalid_membership_transition', 'Membership is not pending');
      }
      const updated = await store.clubMemberships.update(membershipId, { status });
      if (updated === null) throw membershipNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'clubs.membership.status_changed',
        resourceType: 'club_membership',
        resourceId: membershipId,
        details: { clubId, from: membership.status, to: status },
      });
      return updated;
    });
  }

  async updateTechnicalSupport(
    actor: AuthorizationContext,
    clubId: string,
    to: 'requested' | 'confirmed',
    note?: string | null,
  ): Promise<ClubRecord> {
    const result = await this.store.transaction<TransitionResult<ClubRecord>>(async (store) => {
      const current = await store.clubs.getForUpdate(clubId);
      if (current === null || !can(actor, 'clubs.technical_support', current.scope)) {
        return { kind: 'missing' };
      }
      const from = current.technicalSupportStatus as TechnicalSupportStatus;
      if (
        !Object.hasOwn(TECHNICAL_SUPPORT_TRANSITIONS, from) ||
        !canTransition(TECHNICAL_SUPPORT_TRANSITIONS, from, to)
      ) {
        return { kind: 'rejected', from, to, scope: current.scope };
      }
      const updated = await store.clubs.update(clubId, {
        technicalSupportStatus: to,
        ...(note !== undefined ? { technicalSupportNote: note } : {}),
      });
      if (updated === null) return { kind: 'missing' };
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'clubs.technical_support.status_changed',
        resourceType: 'club',
        resourceId: clubId,
        details: { from, to, outcome: 'accepted', scope: updated.scope },
      });
      return { kind: 'updated', record: updated };
    });
    if (result.kind === 'missing') throw clubNotFound();
    if (result.kind === 'rejected') {
      await recordAuditEvent(this.store, {
        actorUid: actor.uid,
        action: 'clubs.technical_support.status_changed',
        resourceType: 'club',
        resourceId: clubId,
        details: { from: result.from, to: result.to, outcome: 'rejected', scope: result.scope },
      });
      throw new HttpError(409, 'invalid_state_transition', 'Invalid technical support transition');
    }
    return result.record;
  }
}
