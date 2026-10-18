import {
  isGlobalOrganizationBusinessSupervisor,
  SOCIAL_ORGANIZATION_IDS,
} from '@freebbs-development/contracts';
import {
  departmentById,
  legacyDepartmentId,
  organizationById,
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
import {
  generalRoleContext,
  departmentsForActor,
  organizationMembershipsForActor,
  roleContextForScopes,
} from '../../core/authorization/role-scope-context.js';
import { readCollectionFeature } from './feature-storage.js';
import { resolve } from 'node:path';
import { activityWithWorkspaceSchedule } from '../events/workspace-schedule.js';
import { readActivityWorkspace } from '../events/workspace-storage.js';

export function actorOrganizations(actor: AuthorizationContext): SocialOrganizationId[] {
  if (isGlobalOrganizationBusinessSupervisor(generalRoleContext(actor)))
    return [...SOCIAL_ORGANIZATION_IDS];
  return [
    ...new Set([
      ...organizationMembershipsForActor(actor).map(({ organizationId }) => organizationId),
      ...departmentsForActor(actor)
        .map(({ organizationId }) => organizationId)
        .filter((id): id is SocialOrganizationId => id !== null),
    ]),
  ];
}
export function resolvePublisher(
  actor: AuthorizationContext,
  schema: CollectionSchema,
  requestedOrganization: SocialOrganizationId | null | undefined,
  formId?: string,
): { schema: CollectionSchema; organizationId: SocialOrganizationId | null } {
  const resourceScopes = formId ? [{ type: 'collection_form', id: formId }] : [];
  const supervisor = isGlobalOrganizationBusinessSupervisor(
    roleContextForScopes(actor, resourceScopes),
  );
  const departments = departmentsForActor(actor, resourceScopes);
  const selected = schema.publisherDepartmentId;
  const department = selected
    ? departmentById(selected)
    : departments.length === 1
      ? departments[0]
      : undefined;
  if (selected && (!department || (!supervisor && !departments.some(({ id }) => id === selected))))
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
  if (
    !selected &&
    !supervisor &&
    departments.length > 1 &&
    actor.roles.some(
      (role) => role === 'counselor.practice' || role === 'counselor.student_development',
    )
  ) {
    throw new HttpError(400, 'department_required', '请选择本次表单的发布部门');
  }
  // Old payloads and actors without a gallery department remain valid.
  const organizations = actorOrganizations(actor);
  if (supervisor) return { schema, organizationId: requestedOrganization ?? null };
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
    return organizations.length > 0 || departmentsForActor(actor).length > 0;
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
export function effectiveCapacity(
  form: CollectionFormRecord,
  schema: CollectionSchema,
): number | null {
  const rule = schema.formRules.find((item) => item.kind === 'capacity')?.value;
  const limits = [form.capacity, typeof rule === 'number' ? rule : null].filter(
    (value): value is number => value !== null,
  );
  return limits.length ? Math.min(...limits) : null;
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
  return canManageCollection(actor, form, schema) || audienceAllows(actor, schema);
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
    isGlobalOrganizationBusinessSupervisor(actor)
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
  featureDirectory = resolve('.data/collection-uploads'),
): Promise<UnifiedRegistration | null> {
  if (!form.publishedVersionId || !['published', 'closed', 'archived'].includes(form.status))
    return null;
  const [version, responses] = await Promise.all([
    store.collectionVersions.get(form.publishedVersionId),
    store.collectionResponses.list({ query: form.id }),
  ]);
  if (!version?.publishedAt || !canViewCollection(actor, form, version.schema)) return null;
  const featureState = await readCollectionFeature(featureDirectory, form.id);
  if (
    !canManageCollection(actor, form, version.schema) &&
    version.schema.recipientMode &&
    version.schema.recipientMode !== 'open'
  ) {
    if (
      !actor.studentId ||
      !actor.displayName ||
      (version.schema.recipientMode === 'restricted' &&
        !featureState.recipients.some(
          (item) => item.studentId === actor.studentId && item.name === actor.displayName,
        ))
    )
      return null;
  }
  const publisherDepartmentId = version.schema.publisherDepartmentId ?? null;
  const department = publisherDepartmentId ? departmentById(publisherDepartmentId) : undefined;
  const organizationId = department ? department.organizationId : form.organizationId;
  const active = responses.filter((item) => item.formId === form.id && item.status === 'submitted');
  const attemptLimit = version.schema.formRules.find(({ kind }) => kind === 'attempt_limit')?.value;
  const { schedule } = await readActivityWorkspace(featureDirectory, 'native_collection', form.id);
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
    startsAt: schedule?.startsAt ?? null,
    endsAt: schedule?.endsAt ?? null,
    location: null,
    capacity: effectiveCapacity(form, version.schema),
    registrationCount: active.length + featureState.responses.length,
    registered: active.some((item) => item.respondentUid === actor.uid),
    attemptsUsed: active.filter((item) => item.respondentUid === actor.uid).length,
    attemptLimit: typeof attemptLimit === 'number' ? attemptLimit : 1,
    status: nativeStatus(form, version.schema),
    schema: version.schema,
  };
}
export async function listRegistrations(
  store: DevelopmentStore,
  actor: AuthorizationContext,
  includePast = false,
  featureDirectory = resolve('.data/collection-uploads'),
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
        .map((form) => registrationFromForm(store, actor, form, featureDirectory)),
    )
  )
    .filter((item): item is UnifiedRegistration => item !== null)
    .map((item) => ({
      ...item,
      startsAt: item.startsAt ?? null,
      endsAt: item.endsAt ?? null,
      detailsPath: `/collections/registrations?${new URLSearchParams({ focus: `native_collection:${item.id}`, ...(item.status === 'closed' ? { includePast: 'true' } : {}) }).toString()}`,
    }));
  const scheduledActivities = await Promise.all(
    activities.map((activity) => activityWithWorkspaceSchedule(activity, featureDirectory)),
  );
  const events = scheduledActivities
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
