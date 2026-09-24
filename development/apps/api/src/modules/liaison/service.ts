import type { ScopeRef } from '@freebbs-development/contracts';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type {
  DevelopmentStore,
  LiaisonResourceRecord,
  ListFilters,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canTransition } from '../../core/workflow/state-machine.js';

export type LiaisonVisibility = LiaisonResourceRecord['visibility'];
export type LiaisonStatus = 'active' | 'archived';

export interface LiaisonResourceInput {
  name: string;
  description: string;
  category: string;
  visibility: LiaisonVisibility;
  status: LiaisonStatus;
  scope: ScopeRef;
}

export type LiaisonResourcePatch = Partial<Omit<LiaisonResourceInput, 'status'>>;

export interface LiaisonResourceFilters extends ListFilters {
  visibility?: LiaisonVisibility;
}

const LIAISON_TRANSITIONS = {
  active: ['archived'],
  archived: ['active'],
} as const;

type TransitionResult =
  | { kind: 'missing' }
  | { kind: 'updated'; record: LiaisonResourceRecord }
  | { kind: 'rejected'; from: string; to: string; scope: ScopeRef };

function repositoryFilters(filters: LiaisonResourceFilters): ListFilters {
  return {
    status: filters.status,
    scopeType: filters.scopeType,
    scopeId: filters.scopeId,
    query: filters.query,
  };
}

function isPublicResource(resource: LiaisonResourceRecord): boolean {
  return (
    resource.visibility === 'public' &&
    resource.scope.type === 'public' &&
    resource.scope.id === '*'
  );
}

function canUpdate(actor: AuthorizationContext, scope: ScopeRef): boolean {
  return authorize(actor, {
    action: 'liaison.resource.update',
    resource: 'liaison_resource',
    scope,
  }).allowed;
}

function resourceNotFound(): HttpError {
  return new HttpError(404, 'liaison_resource_not_found', 'Liaison resource not found');
}

function assertVisibilityScope(visibility: LiaisonVisibility, scope: ScopeRef): void {
  const valid =
    visibility === 'public'
      ? scope.type === 'public' && scope.id === '*'
      : visibility === 'organization'
        ? scope.type === 'organization' && scope.id !== '*'
        : scope.type !== 'public' && scope.id !== '*';
  if (!valid) {
    throw new HttpError(400, 'invalid_visibility_scope', 'Visibility and scope do not match');
  }
}

export class LiaisonService {
  constructor(private readonly store: DevelopmentStore) {}

  async listPublic(filters: LiaisonResourceFilters): Promise<LiaisonResourceRecord[]> {
    if (filters.visibility !== undefined && filters.visibility !== 'public') return [];
    if (filters.scopeType !== undefined && filters.scopeType !== 'public') return [];
    if (filters.scopeId !== undefined && filters.scopeId !== '*') return [];
    const records = await this.store.liaisonResources.list(
      repositoryFilters({ ...filters, scopeType: 'public', scopeId: '*' }),
    );
    return records.filter((resource) => isPublicResource(resource) && resource.status === 'active');
  }

  async listAuthorized(
    actor: AuthorizationContext,
    filters: LiaisonResourceFilters,
  ): Promise<LiaisonResourceRecord[]> {
    return this.store.transaction(async (transactionStore) => {
      const candidates = await transactionStore.liaisonResources.list(repositoryFilters(filters));
      const visible: LiaisonResourceRecord[] = [];
      for (const resource of candidates) {
        if (filters.visibility !== undefined && resource.visibility !== filters.visibility)
          continue;
        const mayUpdate = canUpdate(actor, resource.scope);
        if (resource.status !== 'active' && !mayUpdate) continue;
        if (isPublicResource(resource)) {
          visible.push(resource);
          continue;
        }
        const decision = authorize(actor, {
          action: 'liaison.resource.read',
          resource: 'liaison_resource',
          scope: resource.scope,
        });
        if (!decision.allowed) continue;
        if (resource.visibility === 'restricted' && decision.reason === 'base-role-grant') continue;
        visible.push(resource);
        if (resource.visibility === 'restricted') {
          await recordAuditEvent(transactionStore, {
            actorUid: actor.uid,
            action: 'liaison.resource.read_restricted',
            resourceType: 'liaison_resource',
            resourceId: resource.id,
            details: { scope: resource.scope },
          });
        }
      }
      return visible;
    });
  }

  async auditDeniedRead(actorUid: string, scope: ScopeRef | undefined): Promise<void> {
    await this.store.transaction(async (transactionStore) => {
      await recordAuditEvent(transactionStore, {
        actorUid,
        action: 'liaison.resource.read_denied',
        resourceType: 'liaison_resource',
        resourceId: '*',
        details: { scope: scope ?? null },
      });
    });
  }

  async create(actorUid: string, input: LiaisonResourceInput): Promise<LiaisonResourceRecord> {
    return this.store.transaction(async (transactionStore) => {
      const created = await transactionStore.liaisonResources.create({
        ...input,
        ownerUid: actorUid,
      });
      await recordAuditEvent(transactionStore, {
        actorUid,
        action: 'liaison.resource.created',
        resourceType: 'liaison_resource',
        resourceId: created.id,
        details: {
          status: created.status,
          visibility: created.visibility,
          scope: created.scope,
        },
      });
      if (created.visibility === 'restricted') {
        await recordAuditEvent(transactionStore, {
          actorUid,
          action: 'liaison.resource.create_restricted',
          resourceType: 'liaison_resource',
          resourceId: created.id,
          details: { visibility: created.visibility, scope: created.scope },
        });
      }
      return created;
    });
  }

  async update(
    actor: AuthorizationContext,
    id: string,
    patch: LiaisonResourcePatch,
  ): Promise<LiaisonResourceRecord | null> {
    return this.store.transaction(async (transactionStore) => {
      const current = await transactionStore.liaisonResources.getForUpdate(id);
      if (current === null) return null;
      if (!canUpdate(actor, current.scope)) throw resourceNotFound();
      const targetScope = patch.scope ?? current.scope;
      const targetVisibility = patch.visibility ?? current.visibility;
      assertVisibilityScope(targetVisibility, targetScope);
      if (!canUpdate(actor, targetScope)) throw resourceNotFound();
      const updated = await transactionStore.liaisonResources.update(id, patch);
      if (updated === null) return null;
      await recordAuditEvent(transactionStore, {
        actorUid: actor.uid,
        action: 'liaison.resource.updated',
        resourceType: 'liaison_resource',
        resourceId: id,
        details: {
          changedFields: Object.keys(patch).sort(),
          fromScope: current.scope,
          toScope: updated.scope,
          fromVisibility: current.visibility,
          toVisibility: updated.visibility,
        },
      });
      if (current.visibility === 'restricted' || updated.visibility === 'restricted') {
        await recordAuditEvent(transactionStore, {
          actorUid: actor.uid,
          action: 'liaison.resource.update_restricted',
          resourceType: 'liaison_resource',
          resourceId: id,
          details: {
            changedFields: Object.keys(patch).sort(),
            fromScope: current.scope,
            toScope: updated.scope,
          },
        });
      }
      if (patch.visibility !== undefined && patch.visibility !== current.visibility) {
        await recordAuditEvent(transactionStore, {
          actorUid: actor.uid,
          action: 'liaison.resource.visibility_changed',
          resourceType: 'liaison_resource',
          resourceId: id,
          details: { from: current.visibility, to: patch.visibility, scope: updated.scope },
        });
      }
      return updated;
    });
  }

  async transition(
    actor: AuthorizationContext,
    id: string,
    to: LiaisonStatus,
  ): Promise<LiaisonResourceRecord> {
    const result = await this.store.transaction<TransitionResult>(async (transactionStore) => {
      const current = await transactionStore.liaisonResources.getForUpdate(id);
      if (current === null || !canUpdate(actor, current.scope)) return { kind: 'missing' };
      const from = current.status;
      if (
        !Object.hasOwn(LIAISON_TRANSITIONS, from) ||
        !canTransition(LIAISON_TRANSITIONS, from as LiaisonStatus, to)
      ) {
        return { kind: 'rejected', from, to, scope: current.scope };
      }
      const updated = await transactionStore.liaisonResources.update(id, { status: to });
      if (updated === null) return { kind: 'missing' };
      await recordAuditEvent(transactionStore, {
        actorUid: actor.uid,
        action: 'liaison.resource.status_changed',
        resourceType: 'liaison_resource',
        resourceId: id,
        details: { from, to, outcome: 'accepted', scope: updated.scope },
      });
      return { kind: 'updated', record: updated };
    });
    if (result.kind === 'missing') throw resourceNotFound();
    if (result.kind === 'rejected') {
      await recordAuditEvent(this.store, {
        actorUid: actor.uid,
        action: 'liaison.resource.status_changed',
        resourceType: 'liaison_resource',
        resourceId: id,
        details: {
          from: result.from,
          to: result.to,
          outcome: 'rejected',
          scope: result.scope,
        },
      });
      throw new HttpError(
        409,
        'invalid_state_transition',
        'Invalid liaison resource state transition',
      );
    }
    return result.record;
  }
}
