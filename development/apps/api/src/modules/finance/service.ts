import type { ScopeRef, SocialOrganizationId } from '@freebbs-development/contracts';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { DevelopmentStore, FinanceRecord, ListFilters } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canTransition } from '../../core/workflow/state-machine.js';
import {
  canAccessFinanceOrganization,
  canAccessFinanceRecord,
  canReviewFinance,
  hasFinanceAccess,
} from './organization-access.js';

export type FinanceStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'archived';
export interface FinanceInput {
  title: string;
  kind: 'budget' | 'settlement';
  amountCents: number;
  activityId: string | null;
  status: 'draft';
  scope: ScopeRef;
  organizationId?: SocialOrganizationId | null;
}
export type FinancePatch = Partial<Omit<FinanceInput, 'status'>>;

const FINANCE_TRANSITIONS = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected'],
  approved: ['archived'],
  rejected: ['draft', 'archived'],
  archived: [],
} as const;

type TransitionResult =
  | { kind: 'missing' }
  | { kind: 'updated'; record: FinanceRecord }
  | { kind: 'rejected'; from: string; to: string; scope: ScopeRef };

function financeNotFound(): HttpError {
  return new HttpError(404, 'finance_record_not_found', 'Finance record not found');
}

function financeForbidden(): HttpError {
  return new HttpError(403, 'forbidden', 'Explicit finance permission is required');
}

function canMaintain(
  actor: AuthorizationContext,
  record: FinanceRecord,
  targetOrganizationId: SocialOrganizationId | null | undefined = record.organizationId,
): boolean {
  return (
    canAccessFinanceRecord(actor, record) &&
    canAccessFinanceOrganization(actor, targetOrganizationId)
  );
}

function assertActivityScope(activityId: string | null, scope: ScopeRef): void {
  const activityScoped = scope.type === 'activity';
  if (
    (activityId === null && activityScoped) ||
    (activityId !== null && (!activityScoped || scope.id !== activityId))
  ) {
    throw new HttpError(400, 'invalid_activity_scope', 'Linked activity and scope do not match');
  }
}
function assertOrganizationScope(
  organizationId: SocialOrganizationId | null | undefined,
  activityId: string | null,
  scope: ScopeRef,
): void {
  if (activityId !== null) return;
  const organizationScoped = scope.type === 'social_organization';
  if (
    (organizationId == null && organizationScoped) ||
    (organizationId != null && (!organizationScoped || scope.id !== organizationId))
  ) {
    throw new HttpError(
      400,
      'invalid_organization_scope',
      'Finance organization and scope do not match',
    );
  }
}

export class FinanceService {
  constructor(private readonly store: DevelopmentStore) {}

  async list(
    actor: AuthorizationContext,
    filters: ListFilters,
  ): Promise<{ authorized: boolean; records: FinanceRecord[] }> {
    const candidates = await this.store.financeRecords.list(filters);
    const records = candidates.filter((record) => canAccessFinanceRecord(actor, record));
    return {
      authorized: hasFinanceAccess(actor),
      records,
    };
  }

  async create(actor: AuthorizationContext, input: FinanceInput): Promise<FinanceRecord> {
    return this.store.transaction(async (store) => {
      assertActivityScope(input.activityId, input.scope);
      if (input.activityId !== null) {
        const activity = await store.activities.getForUpdate(input.activityId);
        if (activity === null) throw new HttpError(404, 'activity_not_found', 'Activity not found');
      }
      const freshActor = await loadAuthorizationContext(store, actor, new Date());
      const organizationId = input.organizationId ?? null;
      if (!canAccessFinanceOrganization(freshActor, organizationId)) throw financeForbidden();
      assertOrganizationScope(organizationId, input.activityId, input.scope);
      const created = await store.financeRecords.create({
        ...input,
        organizationId,
        status: 'draft',
        ownerUid: actor.uid,
      });
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'finance.record.created',
        resourceType: 'finance_record',
        resourceId: created.id,
        details: {
          kind: created.kind,
          status: created.status,
          scope: created.scope,
          activityLinked: created.activityId !== null,
          organizationId: created.organizationId ?? null,
        },
      });
      return created;
    });
  }

  async update(
    actor: AuthorizationContext,
    id: string,
    patch: FinancePatch,
  ): Promise<FinanceRecord> {
    return this.store.transaction(async (store) => {
      const current = await store.financeRecords.getForUpdate(id);
      if (current === null) throw financeNotFound();
      const targetScope = patch.scope ?? current.scope;
      const targetOrganizationId =
        patch.organizationId === undefined ? current.organizationId : patch.organizationId;
      let freshActor = await loadAuthorizationContext(store, actor, new Date());
      if (current.status !== 'draft' || !canMaintain(freshActor, current, targetOrganizationId)) {
        throw financeNotFound();
      }
      const targetActivityId =
        patch.activityId === undefined ? (current.activityId ?? null) : patch.activityId;
      assertActivityScope(targetActivityId, targetScope);
      assertOrganizationScope(targetOrganizationId, targetActivityId, targetScope);
      if (targetActivityId !== null) {
        const activity = await store.activities.getForUpdate(targetActivityId);
        if (activity === null) throw new HttpError(404, 'activity_not_found', 'Activity not found');
        freshActor = await loadAuthorizationContext(store, actor, new Date());
        if (!canMaintain(freshActor, current, targetOrganizationId)) throw financeNotFound();
      }
      const updated = await store.financeRecords.update(id, patch);
      if (updated === null) throw financeNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'finance.record.updated',
        resourceType: 'finance_record',
        resourceId: id,
        details: {
          changedFields: Object.keys(patch).sort(),
          fromScope: current.scope,
          toScope: updated.scope,
          fromOrganizationId: current.organizationId ?? null,
          toOrganizationId: updated.organizationId ?? null,
        },
      });
      return updated;
    });
  }

  async transition(
    actor: AuthorizationContext,
    id: string,
    to: FinanceStatus,
  ): Promise<FinanceRecord> {
    const result = await this.store.transaction<TransitionResult>(async (store) => {
      const current = await store.financeRecords.getForUpdate(id);
      if (current === null) return { kind: 'missing' };
      const freshActor = await loadAuthorizationContext(store, actor, new Date());
      const from = current.status as FinanceStatus;
      const reviewEdge = from === 'submitted' && (to === 'approved' || to === 'rejected');
      const permitted = reviewEdge
        ? canReviewFinance(freshActor)
        : canMaintain(freshActor, current);
      if (!permitted) return { kind: 'missing' };
      if (
        !Object.hasOwn(FINANCE_TRANSITIONS, from) ||
        !canTransition(FINANCE_TRANSITIONS, from, to)
      ) {
        return { kind: 'rejected', from, to, scope: current.scope };
      }
      const updated = await store.financeRecords.update(id, { status: to });
      if (updated === null) return { kind: 'missing' };
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'finance.record.status_changed',
        resourceType: 'finance_record',
        resourceId: id,
        details: { from, to, outcome: 'accepted', scope: updated.scope },
      });
      return { kind: 'updated', record: updated };
    });
    if (result.kind === 'missing') throw financeNotFound();
    if (result.kind === 'rejected') {
      await recordAuditEvent(this.store, {
        actorUid: actor.uid,
        action: 'finance.record.status_changed',
        resourceType: 'finance_record',
        resourceId: id,
        details: { from: result.from, to: result.to, outcome: 'rejected', scope: result.scope },
      });
      throw new HttpError(409, 'invalid_state_transition', 'Invalid finance state transition');
    }
    return result.record;
  }

  async review(
    actor: AuthorizationContext,
    id: string,
    decision: 'approved' | 'rejected',
  ): Promise<FinanceRecord> {
    return this.store.transaction(async (store) => {
      const current = await store.financeRecords.getForUpdate(id);
      if (current === null) throw financeNotFound();
      const freshActor = await loadAuthorizationContext(store, actor, new Date());
      if (!canReviewFinance(freshActor)) throw financeForbidden();
      if (current.status !== 'submitted') {
        throw new HttpError(
          409,
          'invalid_state_transition',
          'Only submitted finance records can be reviewed',
        );
      }
      const reviewedAt = new Date().toISOString();
      const updated = await store.financeRecords.update(id, {
        status: decision,
        reviewerUid: actor.uid,
        reviewedAt,
        reviewDecision: decision,
      });
      if (updated === null) throw financeNotFound();
      await recordAuditEvent(store, {
        actorUid: actor.uid,
        action: 'finance.record.reviewed',
        resourceType: 'finance_record',
        resourceId: id,
        details: {
          from: current.status,
          to: decision,
          previousReviewerUid: current.reviewerUid ?? null,
          nextReviewerUid: actor.uid,
          previousDecision: current.reviewDecision ?? null,
          nextDecision: decision,
          previousReviewedAt: current.reviewedAt ?? null,
          nextReviewedAt: reviewedAt,
          organizationId: current.organizationId ?? null,
        },
      });
      return updated;
    });
  }
}
