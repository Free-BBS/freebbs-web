import {
  organizationById,
  organizationForRole,
  type OrganizationLevel,
  type SocialOrganizationId,
} from '@freebbs-development/contracts';

import { recordAuditEvent } from '../../core/audit/audit-service.js';
import type {
  DevelopmentStore,
  RoleAssignmentRecord,
  TagAssignmentRecord,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';

export interface OrganizationMembershipInput {
  subjectUid: string;
  organizationId: SocialOrganizationId;
  level: OrganizationLevel;
}

export interface OrganizationMembershipContext {
  actorUid: string;
}

export interface OrganizationMembershipView {
  subjectUid: string;
  organizationId: SocialOrganizationId;
  level: OrganizationLevel;
  role: RoleAssignmentRecord;
  tag: TagAssignmentRecord;
}

const publicScope = { type: 'public', id: '*' } as const;

async function requireActiveSubject(store: DevelopmentStore, subjectUid: string): Promise<void> {
  const subject = (await store.subjects.list({ query: subjectUid })).find(
    (candidate) => candidate.uid === subjectUid,
  );
  if (subject === undefined) {
    throw new HttpError(400, 'subject_not_found', 'Subject is not registered');
  }
  if (subject.status !== 'active') {
    throw new HttpError(409, 'subject_inactive', 'Subject is not active');
  }
}

async function ensureRole(
  store: DevelopmentStore,
  subjectUid: string,
  roleKey: RoleAssignmentRecord['roleKey'],
  actorUid: string,
): Promise<RoleAssignmentRecord> {
  const definition = (await store.roles.list({ query: roleKey })).find(
    (candidate) => candidate.key === roleKey && candidate.status === 'active',
  );
  if (definition === undefined) {
    throw new HttpError(409, 'role_definition_inactive', 'Role definition is not active');
  }

  const existing = (await store.roleAssignments.listForUpdate({ query: subjectUid })).find(
    (candidate) =>
      candidate.subjectUid === subjectUid &&
      candidate.roleKey === roleKey &&
      candidate.scope.type === publicScope.type &&
      candidate.scope.id === publicScope.id,
  );
  if (existing !== undefined) {
    if (existing.status === 'active') return existing;
    const restored = await store.roleAssignments.update(existing.id, {
      status: 'active',
      expiresAt: null,
      ownerUid: actorUid,
    });
    if (restored === null) throw new Error('Failed to restore organization role');
    return restored;
  }

  return store.roleAssignments.create({
    subjectUid,
    roleKey,
    expiresAt: null,
    status: 'active',
    ownerUid: actorUid,
    scope: publicScope,
  });
}

async function ensureTag(
  store: DevelopmentStore,
  subjectUid: string,
  organizationId: SocialOrganizationId,
  tagKey: string,
  actorUid: string,
): Promise<TagAssignmentRecord> {
  const definition = (await store.tagDefinitions.list({ query: tagKey })).find(
    (candidate) => candidate.key === tagKey && candidate.status === 'active',
  );
  if (definition === undefined) {
    throw new HttpError(409, 'tag_definition_inactive', 'Tag definition is not active');
  }
  const scope = { type: 'social_organization', id: organizationId } as const;
  const existing = (await store.tagAssignments.listForUpdate({ query: subjectUid })).find(
    (candidate) =>
      candidate.subjectUid === subjectUid &&
      candidate.tagKey === tagKey &&
      candidate.scope.type === scope.type &&
      candidate.scope.id === scope.id,
  );
  if (existing !== undefined) {
    if (existing.status === 'active') return existing;
    const restored = await store.tagAssignments.update(existing.id, {
      status: 'active',
      expiresAt: null,
      ownerUid: actorUid,
    });
    if (restored === null) throw new Error('Failed to restore organization Tag');
    return restored;
  }

  return store.tagAssignments.create({
    subjectUid,
    tagKey,
    expiresAt: null,
    status: 'active',
    ownerUid: actorUid,
    scope,
  });
}

export async function setOrganizationMembership(
  store: DevelopmentStore,
  input: OrganizationMembershipInput,
  context: OrganizationMembershipContext,
): Promise<OrganizationMembershipView> {
  return store.transaction(async (transactionStore) => {
    await requireActiveSubject(transactionStore, input.subjectUid);
    const organization = organizationById(input.organizationId);
    const targetRoleKey = organization.roles[input.level];
    const assignments = await transactionStore.roleAssignments.listForUpdate({
      query: input.subjectUid,
    });
    const previous = assignments.find(
      (assignment) =>
        assignment.subjectUid === input.subjectUid &&
        assignment.status === 'active' &&
        organizationForRole(assignment.roleKey)?.organizationId === input.organizationId,
    );

    for (const assignment of assignments) {
      if (
        assignment.subjectUid === input.subjectUid &&
        assignment.status === 'active' &&
        assignment.roleKey !== targetRoleKey &&
        organizationForRole(assignment.roleKey)?.organizationId === input.organizationId
      ) {
        await transactionStore.roleAssignments.update(assignment.id, {
          status: 'archived',
          ownerUid: context.actorUid,
        });
      }
    }

    const role = await ensureRole(
      transactionStore,
      input.subjectUid,
      targetRoleKey,
      context.actorUid,
    );
    const tag = await ensureTag(
      transactionStore,
      input.subjectUid,
      input.organizationId,
      organization.tagKey,
      context.actorUid,
    );
    await recordAuditEvent(transactionStore, {
      actorUid: context.actorUid,
      action: 'admin.organization_membership.set',
      resourceType: 'organization_membership',
      resourceId: `${input.subjectUid}:${input.organizationId}`,
      details: {
        subjectUid: input.subjectUid,
        organizationId: input.organizationId,
        previousLevel: previous === undefined ? null : organizationForRole(previous.roleKey)?.level,
        level: input.level,
      },
    });
    return {
      subjectUid: input.subjectUid,
      organizationId: input.organizationId,
      level: input.level,
      role,
      tag,
    };
  });
}

export async function revokeOrganizationMembership(
  store: DevelopmentStore,
  subjectUid: string,
  organizationId: SocialOrganizationId,
  context: OrganizationMembershipContext,
): Promise<void> {
  await store.transaction(async (transactionStore) => {
    const organization = organizationById(organizationId);
    for (const assignment of await transactionStore.roleAssignments.listForUpdate({
      query: subjectUid,
    })) {
      if (
        assignment.subjectUid === subjectUid &&
        assignment.status === 'active' &&
        organizationForRole(assignment.roleKey)?.organizationId === organizationId
      ) {
        await transactionStore.roleAssignments.update(assignment.id, {
          status: 'archived',
          ownerUid: context.actorUid,
        });
      }
    }
    for (const assignment of await transactionStore.tagAssignments.listForUpdate({
      query: subjectUid,
    })) {
      if (
        assignment.subjectUid === subjectUid &&
        assignment.status === 'active' &&
        assignment.tagKey === organization.tagKey
      ) {
        await transactionStore.tagAssignments.update(assignment.id, {
          status: 'archived',
          ownerUid: context.actorUid,
        });
      }
    }
    await recordAuditEvent(transactionStore, {
      actorUid: context.actorUid,
      action: 'admin.organization_membership.revoke',
      resourceType: 'organization_membership',
      resourceId: `${subjectUid}:${organizationId}`,
      details: { subjectUid, organizationId },
    });
  });
}
