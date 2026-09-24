import {
  SOCIAL_ORGANIZATION_IDS,
  organizationForRole,
  type ScopeRef,
  type SocialOrganizationId,
} from '@freebbs-development/contracts';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type {
  DevelopmentStore,
  KnowledgeEntryRecord,
  ListFilters,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canTransition, type TransitionGraph } from '../../core/workflow/state-machine.js';

export type KnowledgeEntryType = KnowledgeEntryRecord['type'];
export type KnowledgeEntryStatus = 'draft' | 'published' | 'archived';

export interface KnowledgeEntryInput {
  category?: string;
  tags?: string[];
  summary?: string;
  maintainedAt?: string | null;
  maintainerUid?: string | null;
  type: KnowledgeEntryType;
  title: string;
  body: string;
  status: KnowledgeEntryStatus;
  audience: 'general' | 'social_org';
  organizationId: SocialOrganizationId | null;
  scope?: ScopeRef;
}

export type KnowledgeEntryPatch = Partial<Omit<KnowledgeEntryInput, 'status'>>;

export interface KnowledgeEntryFilters extends ListFilters {
  type?: KnowledgeEntryType;
  audience?: 'general' | 'social_org';
}

const KNOWLEDGE_TRANSITIONS: TransitionGraph<KnowledgeEntryStatus> = {
  draft: ['published'],
  published: ['draft', 'archived'],
  archived: [],
};

type TransitionResult =
  | { kind: 'missing' }
  | {
      kind: 'rejected';
      from: KnowledgeEntryStatus;
      to: KnowledgeEntryStatus;
      scope: ScopeRef;
    }
  | { kind: 'updated'; entry: KnowledgeEntryRecord };

function repositoryFilters(filters: KnowledgeEntryFilters): ListFilters {
  return {
    category: filters.category,
    tag: filters.tag,
    organizationId: filters.organizationId,
    status: filters.status,
    scopeType: filters.scopeType,
    scopeId: filters.scopeId,
    query: filters.query,
  };
}

function permitted(actor: AuthorizationContext, action: string, scope: ScopeRef): boolean {
  return authorize(actor, { action, resource: 'knowledge_entry', scope }).allowed;
}

function knowledgeStatus(value: string): KnowledgeEntryStatus | null {
  return value === 'draft' || value === 'published' || value === 'archived' ? value : null;
}

function isSocialOrganizationId(value: unknown): value is SocialOrganizationId {
  return (
    typeof value === 'string' && SOCIAL_ORGANIZATION_IDS.includes(value as SocialOrganizationId)
  );
}

function entryAudience(entry: KnowledgeEntryRecord): 'general' | 'social_org' {
  return entry.audience === 'social_org' ? 'social_org' : 'general';
}

function managesAcrossOrganizations(actor: AuthorizationContext): boolean {
  return (
    actor.roles.includes('platform.super_admin') ||
    actor.roles.some((role) => organizationForRole(role)?.level === 'lead')
  );
}

function belongsToOrganization(
  actor: AuthorizationContext,
  organizationId: SocialOrganizationId,
): boolean {
  return actor.tags.some(
    (tag) =>
      tag.key === `social_org.${organizationId}` &&
      (tag.scope === undefined ||
        (tag.scope.type === 'social_organization' && tag.scope.id === organizationId)),
  );
}

function canAccessOrganization(
  actor: AuthorizationContext,
  organizationId: SocialOrganizationId,
): boolean {
  return managesAcrossOrganizations(actor) || belongsToOrganization(actor, organizationId);
}

function socialOrganizationForEntry(entry: KnowledgeEntryRecord): SocialOrganizationId | null {
  return isSocialOrganizationId(entry.organizationId) ? entry.organizationId : null;
}

function requireSocialEntryAccess(actor: AuthorizationContext, entry: KnowledgeEntryRecord): void {
  if (entryAudience(entry) !== 'social_org') return;
  const organizationId = socialOrganizationForEntry(entry);
  if (organizationId === null || !canAccessOrganization(actor, organizationId)) {
    throw new HttpError(404, 'knowledge_entry_not_found', 'Entry not found');
  }
}

function normalizedCreateInput(input: KnowledgeEntryInput) {
  if (input.audience === 'social_org') {
    if (input.organizationId === null) {
      throw new HttpError(
        400,
        'organization_required',
        'Social organization entry requires an organization',
      );
    }
    const expectedScope = { type: 'social_organization', id: input.organizationId } as const;
    if (
      input.scope !== undefined &&
      (input.scope.type !== expectedScope.type || input.scope.id !== expectedScope.id)
    ) {
      throw new HttpError(400, 'invalid_organization_scope', 'Organization scope does not match');
    }
    return { ...input, scope: expectedScope };
  }
  if (input.organizationId !== null) {
    throw new HttpError(400, 'invalid_organization', 'General entry cannot have an organization');
  }
  if (input.scope !== undefined && (input.scope.type !== 'public' || input.scope.id !== '*')) {
    throw new HttpError(400, 'invalid_general_scope', 'General entry must be public');
  }
  return { ...input, scope: { type: 'public', id: '*' } as const };
}

export class KnowledgeService {
  constructor(private readonly store: DevelopmentStore) {}

  canReadSocialAudience(actor: AuthorizationContext): boolean {
    return (
      managesAcrossOrganizations(actor) ||
      SOCIAL_ORGANIZATION_IDS.some((organizationId) => belongsToOrganization(actor, organizationId))
    );
  }

  async list(
    filters: KnowledgeEntryFilters,
    publicOnly: boolean,
    actor: AuthorizationContext | null,
  ): Promise<KnowledgeEntryRecord[]> {
    if (publicOnly && filters.status !== undefined && filters.status !== 'published') return [];
    if (publicOnly && filters.scopeType !== undefined && filters.scopeType !== 'public') return [];
    if (publicOnly && filters.scopeId !== undefined && filters.scopeId !== '*') return [];
    const applied: KnowledgeEntryFilters = publicOnly
      ? { ...filters, status: 'published', scopeType: 'public', scopeId: '*' }
      : filters;
    const records = await this.store.knowledge.list(repositoryFilters(applied));
    return records.filter((entry) => {
      if (applied.type !== undefined && entry.type !== applied.type) return false;
      if (entryAudience(entry) !== (applied.audience ?? 'general')) return false;
      if (entryAudience(entry) !== 'social_org') return true;
      const organizationId = socialOrganizationForEntry(entry);
      return (
        actor !== null && organizationId !== null && canAccessOrganization(actor, organizationId)
      );
    });
  }

  async create(
    actor: AuthorizationContext,
    input: KnowledgeEntryInput,
  ): Promise<KnowledgeEntryRecord> {
    const normalized = normalizedCreateInput(input);
    if (
      normalized.audience === 'social_org' &&
      (!isSocialOrganizationId(normalized.organizationId) ||
        !canAccessOrganization(actor, normalized.organizationId))
    ) {
      throw new HttpError(404, 'knowledge_entry_not_found', 'Entry not found');
    }
    if (!permitted(actor, 'knowledge.create', normalized.scope)) {
      throw new HttpError(403, 'forbidden', 'Knowledge permission is required');
    }
    return this.store.transaction(async (transactionStore) => {
      const created = await transactionStore.knowledge.create({
        ...normalized,
        ownerUid: actor.uid,
      });
      if (normalized.status !== 'draft') {
        await recordAuditEvent(transactionStore, {
          actorUid: actor.uid,
          action: 'knowledge.entry.publish',
          resourceType: 'knowledge_entry',
          resourceId: created.id,
          details: { from: null, to: input.status, outcome: 'accepted', scope: created.scope },
        });
      }
      return created;
    });
  }

  async update(
    actor: AuthorizationContext,
    id: string,
    patch: KnowledgeEntryPatch,
  ): Promise<KnowledgeEntryRecord | null> {
    return this.store.transaction(async (transactionStore) => {
      const current = await transactionStore.knowledge.getForUpdate(id);
      if (current === null) return null;
      requireSocialEntryAccess(actor, current);
      const targetScope = patch.scope ?? current.scope;
      const targetAudience = patch.audience ?? entryAudience(current);
      const targetOrganizationId =
        patch.organizationId === undefined
          ? (current.organizationId ?? null)
          : patch.organizationId;
      if (
        targetAudience === 'social_org' &&
        (!isSocialOrganizationId(targetOrganizationId) ||
          !canAccessOrganization(actor, targetOrganizationId))
      ) {
        throw new HttpError(404, 'knowledge_entry_not_found', 'Entry not found');
      }
      if (
        !permitted(actor, 'knowledge.create', current.scope) ||
        !permitted(actor, 'knowledge.create', targetScope)
      ) {
        throw new HttpError(404, 'knowledge_entry_not_found', 'Entry not found');
      }
      if (
        current.status === 'published' &&
        (!permitted(actor, 'knowledge.publish', current.scope) ||
          !permitted(actor, 'knowledge.publish', targetScope))
      ) {
        throw new HttpError(404, 'knowledge_entry_not_found', 'Entry not found');
      }
      const updated = await transactionStore.knowledge.update(id, patch);
      if (updated === null) return null;
      await recordAuditEvent(transactionStore, {
        actorUid: actor.uid,
        action: 'knowledge.entry.update',
        resourceType: 'knowledge_entry',
        resourceId: id,
        details: {
          fields: Object.keys(patch).sort(),
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
    to: KnowledgeEntryStatus,
  ): Promise<KnowledgeEntryRecord | null> {
    const result = await this.store.transaction<TransitionResult>(async (transactionStore) => {
      const current = await transactionStore.knowledge.getForUpdate(id);
      if (current === null) return { kind: 'missing' };
      requireSocialEntryAccess(actor, current);
      if (!permitted(actor, 'knowledge.publish', current.scope)) {
        throw new HttpError(404, 'knowledge_entry_not_found', 'Entry not found');
      }
      const from = knowledgeStatus(current.status);
      if (from === null || !canTransition(KNOWLEDGE_TRANSITIONS, from, to)) {
        return {
          kind: 'rejected',
          from: from ?? (current.status as KnowledgeEntryStatus),
          to,
          scope: current.scope,
        };
      }
      const updated = await transactionStore.knowledge.update(id, { status: to });
      if (updated === null) return { kind: 'missing' };
      await recordAuditEvent(transactionStore, {
        actorUid: actor.uid,
        action: 'knowledge.entry.publish',
        resourceType: 'knowledge_entry',
        resourceId: id,
        details: { from, to, outcome: 'accepted', scope: updated.scope },
      });
      return { kind: 'updated', entry: updated };
    });

    if (result.kind === 'missing') return null;
    if (result.kind === 'rejected') {
      await recordAuditEvent(this.store, {
        actorUid: actor.uid,
        action: 'knowledge.entry.publish',
        resourceType: 'knowledge_entry',
        resourceId: id,
        details: {
          from: result.from,
          to: result.to,
          outcome: 'rejected',
          scope: result.scope,
        },
      });
      throw new HttpError(409, 'invalid_state_transition', 'Invalid knowledge state transition');
    }
    return result.entry;
  }
}
