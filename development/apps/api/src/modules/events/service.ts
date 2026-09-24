import type { ScopeRef } from '@freebbs-development/contracts';
import type { SocialOrganizationId } from '@freebbs-development/contracts';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type {
  ActivityRecord,
  ActivityRegistrationRecord,
  DevelopmentStore,
  ListFilters,
  TechnicalSupportStatus,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canTransition } from '../../core/workflow/state-machine.js';
import {
  canCreateForOrganization,
  canUpdateOrganization,
  isSuperAdmin,
  organizationsForActor,
} from './organization-access.js';

export type ActivityStatus =
  'draft' | 'pending' | 'approved' | 'rejected' | 'published' | 'finished' | 'archived';
export interface ActivityInput {
  registrationDeadline?: string | null;
  capacity?: number | null;
  contact?: string;
  title: string;
  description: string;
  clubId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  location: string;
  organizationId: SocialOrganizationId | null;
  standingActivity: boolean;
  status: 'draft';
  scope: ScopeRef;
}
export type ActivityPatch = Partial<Omit<ActivityInput, 'status'>>;

const ACTIVITY_TRANSITIONS = {
  draft: ['pending'],
  pending: ['approved', 'rejected'],
  approved: ['published'],
  rejected: ['draft'],
  published: ['finished'],
  finished: ['archived'],
  archived: [],
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
  return authorize(actor, { action, resource: 'activity', scope }).allowed;
}
function canRegistration(actor: AuthorizationContext, action: string, scope: ScopeRef): boolean {
  return authorize(actor, { action, resource: 'activity_registration', scope }).allowed;
}
function canManage(actor: AuthorizationContext, record: ActivityRecord): boolean {
  return (
    (can(actor, 'events.update', record.scope) && canUpdateOrganization(actor, record)) ||
    (record.ownerUid === actor.uid && can(actor, 'events.create', record.scope))
  );
}
function activityNotFound(): HttpError {
  return new HttpError(404, 'activity_not_found', 'Activity not found');
}
function registrationNotFound(): HttpError {
  return new HttpError(404, 'activity_registration_not_found', 'Registration not found');
}

export class EventsService {
  constructor(
    private readonly store: DevelopmentStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(actor: AuthorizationContext, filters: ListFilters): Promise<ActivityRecord[]> {
    const records = await this.store.activities.list(filters);
    return records.filter(
      (record) =>
        (record.status === 'published' && can(actor, 'events.read', record.scope)) ||
        canManage(actor, record) ||
        (record.status === 'pending' && can(actor, 'events.approve', record.scope)) ||
        (record.technicalSupportStatus === 'requested' &&
          can(actor, 'events.technical_support', record.scope)),
    );
  }

  async create(actor: AuthorizationContext, input: ActivityInput): Promise<ActivityRecord> {
    const actorOrganizations = organizationsForActor(actor);
    const organizationId =
      input.organizationId ??
      (actorOrganizations.length === 1 ? (actorOrganizations[0] ?? null) : null);
    if (input.organizationId === null && actorOrganizations.length > 1 && !isSuperAdmin(actor)) {
      throw new HttpError(
        400,
        'organization_required',
        'Organization is required for multi-organization users',
      );
    }
    if (!canCreateForOrganization(actor, organizationId)) {
      throw new HttpError(403, 'forbidden', 'Organization membership is required');
    }
    return this.store.transaction(async (store) => {
      const created = await store.activities.create({
        ...input,
        organizationId,
        status: 'draft',
        technicalSupportStatus: 'not_requested',
        technicalSupportNote: null,
        ownerUid: actor.uid,
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'events.activity.created',
        resourceType: 'activity',
        resourceId: created.id,
        details: { status: created.status, scope: created.scope },
      });
      return created;
    });
  }

  async update(
    actor: AuthorizationContext,
    id: string,
    patch: ActivityPatch,
  ): Promise<ActivityRecord> {
    return this.store.transaction(async (store) => {
      const current = await store.activities.getForUpdate(id);
      if (current === null) throw activityNotFound();
      const targetScope = patch.scope ?? current.scope;
      const target = { ...current, ...patch };
      const managerMove =
        can(actor, 'events.update', current.scope) &&
        can(actor, 'events.update', targetScope) &&
        canUpdateOrganization(actor, current) &&
        canUpdateOrganization(actor, target);
      const creatorMove =
        (current.status === 'draft' || current.status === 'rejected') &&
        current.ownerUid === actor.uid &&
        can(actor, 'events.create', current.scope) &&
        can(actor, 'events.create', targetScope) &&
        canCreateForOrganization(actor, current.organizationId) &&
        canCreateForOrganization(actor, target.organizationId);
      if (!managerMove && !creatorMove) throw activityNotFound();
      const updated = await store.activities.update(id, patch);
      if (updated === null) throw activityNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'events.activity.updated',
        resourceType: 'activity',
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
    to: ActivityStatus,
  ): Promise<ActivityRecord> {
    const result = await this.store.transaction<TransitionResult<ActivityRecord>>(async (store) => {
      const current = await store.activities.getForUpdate(id);
      if (current === null) return { kind: 'missing' };
      const from = current.status as ActivityStatus;
      const approvalEdge = from === 'pending' && (to === 'approved' || to === 'rejected');
      const creatorEdge =
        (from === 'draft' && to === 'pending') || (from === 'rejected' && to === 'draft');
      const permitted = approvalEdge
        ? can(actor, 'events.approve', current.scope) && canUpdateOrganization(actor, current)
        : creatorEdge
          ? canManage(actor, current)
          : can(actor, 'events.update', current.scope) && canUpdateOrganization(actor, current);
      if (!permitted) return { kind: 'missing' };
      if (
        !Object.hasOwn(ACTIVITY_TRANSITIONS, from) ||
        !canTransition(ACTIVITY_TRANSITIONS, from, to)
      ) {
        return { kind: 'rejected', from, to, scope: current.scope };
      }
      const updated = await store.activities.update(id, { status: to });
      if (updated === null) return { kind: 'missing' };
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'events.activity.status_changed',
        resourceType: 'activity',
        resourceId: id,
        details: { from, to, outcome: 'accepted', scope: updated.scope },
      });
      return { kind: 'updated', record: updated };
    });
    if (result.kind === 'missing') throw activityNotFound();
    if (result.kind === 'rejected') {
      await recordAuditEvent(this.store, {
        actorUid: actor.uid,
        action: 'events.activity.status_changed',
        resourceType: 'activity',
        resourceId: id,
        details: { from: result.from, to: result.to, outcome: 'rejected', scope: result.scope },
      });
      throw new HttpError(409, 'invalid_state_transition', 'Invalid activity state transition');
    }
    return result.record;
  }

  async updateTechnicalSupport(
    actor: AuthorizationContext,
    id: string,
    to: 'requested' | 'confirmed',
    note?: string | null,
  ): Promise<ActivityRecord> {
    const result = await this.store.transaction<TransitionResult<ActivityRecord>>(async (store) => {
      const current = await store.activities.getForUpdate(id);
      if (current === null) return { kind: 'missing' };
      const permitted =
        to === 'requested'
          ? can(actor, 'events.update', current.scope) && canUpdateOrganization(actor, current)
          : can(actor, 'events.technical_support', current.scope);
      if (!permitted) return { kind: 'missing' };
      const from = current.technicalSupportStatus as TechnicalSupportStatus;
      if (
        !Object.hasOwn(TECHNICAL_SUPPORT_TRANSITIONS, from) ||
        !canTransition(TECHNICAL_SUPPORT_TRANSITIONS, from, to)
      ) {
        return { kind: 'rejected', from, to, scope: current.scope };
      }
      const updated = await store.activities.update(id, {
        technicalSupportStatus: to,
        ...(note !== undefined ? { technicalSupportNote: note } : {}),
      });
      if (updated === null) return { kind: 'missing' };
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'events.technical_support.status_changed',
        resourceType: 'activity',
        resourceId: id,
        details: { from, to, outcome: 'accepted', scope: updated.scope },
      });
      return { kind: 'updated', record: updated };
    });
    if (result.kind === 'missing') throw activityNotFound();
    if (result.kind === 'rejected') {
      await recordAuditEvent(this.store, {
        actorUid: actor.uid,
        action: 'events.technical_support.status_changed',
        resourceType: 'activity',
        resourceId: id,
        details: { from: result.from, to: result.to, outcome: 'rejected', scope: result.scope },
      });
      throw new HttpError(409, 'invalid_state_transition', 'Invalid technical support transition');
    }
    return result.record;
  }

  async getRegistration(
    actor: AuthorizationContext,
    activityId: string,
  ): Promise<ActivityRegistrationRecord | null> {
    const activity = await this.store.activities.get(activityId);
    const routeScope = { type: 'activity', id: activityId } as const;
    if (activity === null || !canRegistration(actor, 'events.register', routeScope)) {
      throw activityNotFound();
    }
    return (
      (await this.store.activityRegistrations.list({ query: activityId })).find(
        (record) => record.activityId === activityId && record.participantUid === actor.uid,
      ) ?? null
    );
  }

  async register(
    actor: AuthorizationContext,
    activityId: string,
  ): Promise<ActivityRegistrationRecord> {
    return this.store.transaction(async (store) => {
      const activity = await store.activities.getForUpdate(activityId);
      const routeScope = { type: 'activity', id: activityId } as const;
      if (activity === null || !canRegistration(actor, 'events.register', routeScope)) {
        throw activityNotFound();
      }
      if (activity.status !== 'published') {
        throw new HttpError(
          409,
          'activity_not_published',
          'Activity is not accepting registration',
        );
      }
      if (
        activity.registrationDeadline !== null &&
        Date.parse(activity.registrationDeadline) <= this.now().getTime()
      ) {
        throw new HttpError(
          409,
          'activity_registration_closed',
          'Activity registration deadline has passed',
        );
      }
      const registrations = await store.activityRegistrations.listForUpdate({ query: activityId });
      const existing = registrations.find(
        (record) => record.activityId === activityId && record.participantUid === actor.uid,
      );
      if (existing?.status === 'registered') {
        throw new HttpError(409, 'activity_registration_exists', 'Registration already exists');
      }
      const registeredCount = registrations.filter(
        (record) => record.activityId === activityId && record.status === 'registered',
      ).length;
      if (activity.capacity !== null && registeredCount >= activity.capacity) {
        throw new HttpError(409, 'activity_capacity_reached', 'Activity capacity has been reached');
      }
      const registration =
        existing === undefined
          ? await store.activityRegistrations.create({
              activityId,
              participantUid: actor.uid,
              status: 'registered',
              ownerUid: actor.uid,
              scope: routeScope,
            })
          : await store.activityRegistrations.update(existing.id, { status: 'registered' });
      if (registration === null) throw registrationNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'events.registration.created',
        resourceType: 'activity_registration',
        resourceId: registration.id,
        details: { activityId, reused: existing !== undefined },
      });
      return registration;
    });
  }

  async cancel(actor: AuthorizationContext, activityId: string): Promise<void> {
    await this.store.transaction(async (store) => {
      const activity = await store.activities.getForUpdate(activityId);
      const routeScope = { type: 'activity', id: activityId } as const;
      if (activity === null || !canRegistration(actor, 'events.cancel_registration', routeScope)) {
        throw activityNotFound();
      }
      const registration = (
        await store.activityRegistrations.listForUpdate({ query: activityId })
      ).find((record) => record.activityId === activityId && record.participantUid === actor.uid);
      if (registration === undefined || registration.status !== 'registered') {
        throw registrationNotFound();
      }
      await store.activityRegistrations.update(registration.id, { status: 'cancelled' });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'events.registration.cancelled',
        resourceType: 'activity_registration',
        resourceId: registration.id,
        details: { activityId },
      });
    });
  }
}
