import {
  departmentById,
  departmentsForRoles,
  legacyDepartmentId,
  organizationById,
  organizationForRole,
  type CollectionSchema,
  type DepartmentActivitySummary,
  type SocialOrganizationId,
  type UnifiedRegistration,
} from '@freebbs-development/contracts';
import { authorize } from '../../core/authorization/authorize.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type {
  ActivityRecord,
  CollectionFormRecord,
  DevelopmentStore,
} from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canManageCollection } from './access.js';

export function actorOrganizations(actor: AuthorizationContext): SocialOrganizationId[] {
  return [
    ...new Set([
      ...actor.roles
        .map((role) => organizationForRole(role)?.organizationId)
        .filter((id): id is SocialOrganizationId => id !== undefined),
      ...departmentsForRoles(actor.roles)
        .map(({ organizationId }) => organizationId)
        .filter((id): id is SocialOrganizationId => id !== null),
    ]),
  ];
}
export function resolvePublisher(
  actor: AuthorizationContext,
  schema: CollectionSchema,
  requestedOrganization: SocialOrganizationId | null | undefined,
): { schema: CollectionSchema; organizationId: SocialOrganizationId | null } {
  const departments = departmentsForRoles(actor.roles);
  const selected = schema.publisherDepartmentId;
  const department = selected
    ? departmentById(selected)
    : departments.length === 1
      ? departments[0]
      : undefined;
  if (
    selected &&
    (!department ||
      (!actor.roles.includes('platform.super_admin') &&
        !departments.some(({ id }) => id === selected)))
  )
    throw new HttpError(403, 'forbidden', '不能以未加入的部门发布活动');
  if (department) {
    if (requestedOrganization != null && requestedOrganization !== department.organizationId)
      throw new HttpError(
        selected ? 400 : 403,
        'organization_mismatch',
        '发布部门与所属组织不一致',
      );
    return {
      schema: { ...schema, publisherDepartmentId: department.id },
      organizationId: department.organizationId,
    };
  }
  // Old payloads and actors without a gallery department remain valid.
  const organizations = actorOrganizations(actor);
  if (actor.roles.includes('platform.super_admin'))
    return { schema, organizationId: requestedOrganization ?? null };
  if (requestedOrganization != null) {
    if (!organizations.includes(requestedOrganization))
      throw new HttpError(403, 'forbidden', '不能以未加入的组织创建或维护表单');
    return { schema, organizationId: requestedOrganization };
  }
  if (organizations.length > 1)
    throw new HttpError(400, 'organization_required', '请选择本次表单所属的组织');
  return { schema, organizationId: organizations[0] ?? null };
}
export function audienceAllows(actor: AuthorizationContext, schema: CollectionSchema): boolean {
  const rule = schema.formRules.find(({ kind }) => kind === 'audience');
  if (!rule || rule.value === 'all' || rule.value === true) return true;
  const organizations = actorOrganizations(actor);
  if (rule.value === 'social_org')
    return organizations.length > 0 || departmentsForRoles(actor.roles).length > 0;
  if (typeof rule.value === 'string')
    return organizations.includes(rule.value as SocialOrganizationId);
  if (Array.isArray(rule.value))
    return rule.value.some((id) => organizations.includes(id as SocialOrganizationId));
  return false;
}
function scheduleBoundary(schema: CollectionSchema, key: 'start' | 'end'): string | null {
  const rule = schema.formRules.find(({ kind }) => kind === 'schedule');
  if (!rule || typeof rule.value !== 'object' || Array.isArray(rule.value) || 'mode' in rule.value)
    return null;
  return rule.value[key] || null;
}
export function effectiveWindow(form: CollectionFormRecord, schema: CollectionSchema) {
  const boundary = (key: 'start' | 'end', persisted: string | null) => {
    const values = [persisted, scheduleBoundary(schema, key)]
      .filter((value): value is string => value !== null)
      .map(Date.parse)
      .filter(Number.isFinite);
    return values.length
      ? new Date((key === 'start' ? Math.max : Math.min)(...values)).toISOString()
      : null;
  };
  return { opensAt: boundary('start', form.opensAt), closesAt: boundary('end', form.closesAt) };
}
export function nativeStatus(
  form: CollectionFormRecord,
  schema: CollectionSchema,
  now = new Date(),
): UnifiedRegistration['status'] {
  if (form.status !== 'published') return 'closed';
  const window = effectiveWindow(form, schema);
  if (window.closesAt && Date.parse(window.closesAt) <= now.getTime()) return 'closed';
  if (window.opensAt && Date.parse(window.opensAt) > now.getTime()) return 'upcoming';
  return 'open';
}
export function canViewCollection(
  actor: AuthorizationContext,
  form: CollectionFormRecord,
  schema: CollectionSchema,
): boolean {
  return canManageCollection(actor, form.ownerUid) || audienceAllows(actor, schema);
}
export function canReadPublishedActivity(
  actor: AuthorizationContext,
  activity: ActivityRecord,
): boolean {
  const request = { action: 'events.read', resource: 'activity', scope: activity.scope };
  if (
    !['published', 'finished', 'archived'].includes(activity.status) ||
    !authorize(actor, request).allowed
  )
    return false;
  if (
    (activity.scope.type === 'public' && activity.scope.id === '*') ||
    actor.uid === activity.ownerUid ||
    actor.roles.includes('platform.super_admin')
  )
    return true;
  // Baseline student events.read is unscoped. A private catalog entry needs an
  // actual grant for its scope; ordinary read authorization still enforces denies.
  return authorize(
    {
      ...actor,
      policies: (actor.policies ?? []).filter(
        ({ scope }) => scope?.type === activity.scope.type && scope.id === activity.scope.id,
      ),
    },
    request,
  ).allowed;
}
export async function registrationFromForm(
  store: DevelopmentStore,
  actor: AuthorizationContext,
  form: CollectionFormRecord,
): Promise<UnifiedRegistration | null> {
  if (!form.publishedVersionId || !['published', 'closed', 'archived'].includes(form.status))
    return null;
  const [version, responses] = await Promise.all([
    store.collectionVersions.get(form.publishedVersionId),
    store.collectionResponses.list({ query: form.id }),
  ]);
  if (!version?.publishedAt || !canViewCollection(actor, form, version.schema)) return null;
  const publisherDepartmentId = version.schema.publisherDepartmentId ?? null;
  const department = publisherDepartmentId ? departmentById(publisherDepartmentId) : undefined;
  const organizationId = department ? department.organizationId : form.organizationId;
  const active = responses.filter((item) => item.formId === form.id && item.status === 'submitted');
  return {
    id: form.id,
    source: 'native_collection',
    title: version.schema.title,
    description: version.schema.description,
    organizer:
      department?.organizationName ??
      (organizationId ? organizationById(organizationId).name : 'FREE-BBS'),
    organizationId,
    publisherDepartmentId,
    coverUrl: form.coverUrl,
    ...effectiveWindow(form, version.schema),
    location: null,
    capacity: form.capacity,
    registrationCount: active.length,
    registered: active.some((item) => item.respondentUid === actor.uid),
    status: nativeStatus(form, version.schema),
    schema: version.schema,
  };
}
export async function listRegistrations(
  store: DevelopmentStore,
  actor: AuthorizationContext,
  includePast = false,
): Promise<DepartmentActivitySummary[]> {
  const [forms, activities, registrations] = await Promise.all([
    store.collectionForms.list(),
    store.activities.list(),
    store.activityRegistrations.list(),
  ]);
  const native = (
    await Promise.all(
      forms
        .filter((form) => includePast || form.status === 'published')
        .map((form) => registrationFromForm(store, actor, form)),
    )
  )
    .filter((item): item is UnifiedRegistration => item !== null)
    .map((item) => ({
      ...item,
      startsAt: item.opensAt,
      endsAt: item.closesAt,
      detailsPath: `/collections/registrations?${new URLSearchParams({ focus: `native_collection:${item.id}`, ...(item.status === 'closed' ? { includePast: 'true' } : {}) }).toString()}`,
    }));
  const events = activities
    .filter(
      (activity) =>
        (includePast || activity.status === 'published') &&
        canReadPublishedActivity(actor, activity),
    )
    .map((activity): DepartmentActivitySummary => {
      const active = registrations.filter(
        (item) => item.activityId === activity.id && item.status === 'registered',
      );
      const now = Date.now();
      const ended = [activity.registrationDeadline, activity.endsAt].some(
        (date) => date != null && Date.parse(date) <= now,
      );
      return {
        id: activity.id,
        source: 'development_activity',
        activityStatus: activity.status,
        title: activity.title,
        description: activity.description,
        organizer: activity.organizationId
          ? organizationById(activity.organizationId).name
          : '無活动',
        organizationId: activity.organizationId ?? null,
        publisherDepartmentId: legacyDepartmentId(activity.organizationId),
        coverUrl: null,
        opensAt: null,
        closesAt: activity.registrationDeadline,
        startsAt: activity.startsAt ?? null,
        endsAt: activity.endsAt ?? null,
        location: activity.location ?? null,
        capacity: activity.capacity,
        registrationCount: active.length,
        registered: active.some((item) => item.participantUid === actor.uid),
        status: activity.status !== 'published' || ended ? 'closed' : 'open',
        detailsPath: `/events/${encodeURIComponent(activity.id)}`,
      };
    });
  return [...native, ...events];
}
