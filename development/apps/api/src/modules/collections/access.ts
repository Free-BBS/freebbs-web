import {
  isGlobalOrganizationBusinessSupervisor,
  organizationMembershipsForRoles,
  departmentsForRoles,
  departmentById,
  type CollectionSchema,
} from '@freebbs-development/contracts';
import type { CollectionFormRecord, DevelopmentStore } from '../../core/database/types.js';

import type { AuthorizationContext } from '../../core/authorization/policy.js';
import {
  generalRoleContext,
  roleContextForScopes,
} from '../../core/authorization/role-scope-context.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';

const SOCIAL_ROLE_PREFIXES = [
  'counselor.',
  'student_union.',
  'youth_league.',
  'science_association.',
  'media_center.',
] as const;

export function canCreateCollection(actor: AuthorizationContext): boolean {
  actor = generalRoleContext(actor);
  if (isGlobalOrganizationBusinessSupervisor(actor)) return true;
  return actor.roles.some(
    (role) =>
      organizationMembershipsForRoles([role]).length > 0 ||
      SOCIAL_ROLE_PREFIXES.some((prefix) => role.startsWith(prefix)),
  );
}

export function canManageCollection(
  actor: AuthorizationContext,
  form: Pick<CollectionFormRecord, 'ownerUid' | 'organizationId'> &
    Partial<Pick<CollectionFormRecord, 'id'>>,
  schema?: Pick<CollectionSchema, 'publisherDepartmentId'>,
): boolean {
  const department = schema?.publisherDepartmentId
    ? departmentById(schema.publisherDepartmentId)
    : undefined;
  actor = roleContextForScopes(actor, [
    ...(form.id ? [{ type: 'collection_form', id: form.id }] : []),
    ...(department ? [{ type: 'department', id: department.id }] : []),
    ...(form.organizationId ? [{ type: 'social_organization', id: form.organizationId }] : []),
  ]);
  if (isGlobalOrganizationBusinessSupervisor(actor)) return true;
  const supervised = actor.roles.some(
    (role) =>
      role.startsWith('counselor.') ||
      [
        'student_union.executive_president',
        'student_union.presidium',
        'science_association.chair',
      ].includes(role),
  );
  if (actor.uid !== form.ownerUid && !supervised) return false;
  if (actor.uid !== form.ownerUid && form.organizationId == null && !schema?.publisherDepartmentId)
    return false;
  const departments = departmentsForRoles(actor.roles);
  const publisher = schema?.publisherDepartmentId
    ? departmentById(schema.publisherDepartmentId)
    : undefined;
  if (
    actor.uid !== form.ownerUid &&
    !publisher &&
    !organizationMembershipsForRoles(actor.roles).some(
      ({ organizationId, level }) => organizationId === form.organizationId && level === 'lead',
    ) &&
    !(actor.roles.includes('counselor.innovation') && form.organizationId === 'sast')
  )
    return false;
  if (schema?.publisherDepartmentId && !publisher) return false;
  if (publisher && form.organizationId != null && publisher.organizationId !== form.organizationId)
    return false;
  if (
    schema?.publisherDepartmentId &&
    !departments.some(({ id }) => id === schema.publisherDepartmentId)
  )
    return false;
  return (
    form.organizationId == null ||
    departments.some(({ organizationId }) => organizationId === form.organizationId) ||
    organizationMembershipsForRoles(actor.roles).some(
      ({ organizationId }) => organizationId === form.organizationId,
    )
  );
}

export async function canManageStoredCollection(
  store: DevelopmentStore,
  actor: AuthorizationContext,
  form: CollectionFormRecord,
): Promise<boolean> {
  actor = await loadAuthorizationContext(store, actor, new Date());
  const versionIds = [...new Set([form.currentDraftVersionId, form.publishedVersionId])].filter(
    (id): id is string => id !== null,
  );
  const versions = await Promise.all(versionIds.map((id) => store.collectionVersions.get(id)));
  if (versionIds.length === 0) return canManageCollection(actor, form);
  return versions.every(
    (version) =>
      version !== null &&
      version.formId === form.id &&
      canManageCollection(actor, form, version.schema),
  );
}

export function canManageCollectionModuleLibrary(actor: AuthorizationContext): boolean {
  actor = generalRoleContext(actor);
  return (
    isGlobalOrganizationBusinessSupervisor(actor) ||
    actor.roles.some(
      (role) =>
        role.startsWith('counselor.') ||
        role === 'student_union.executive_president' ||
        role === 'student_union.presidium' ||
        /(?:lead|director|leader|deputy_secretary|chair|vice_chair|minister|consultant)$/.test(
          role,
        ),
    )
  );
}
