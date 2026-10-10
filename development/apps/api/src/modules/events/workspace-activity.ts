import type {
  RegistrationSource,
  UnifiedRegistration,
  SocialOrganizationId,
} from '@freebbs-development/contracts';
import { canEditDepartment, departmentsForRoles } from '@freebbs-development/contracts';
import type { DevelopmentStore } from '../../core/database/types.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { HttpError } from '../../core/errors/http-error.js';
import { canCreateCollection } from '../collections/access.js';
import { listRegistrations, actorOrganizations } from '../collections/registrations.js';
import { authorize } from '../../core/authorization/authorize.js';
export type LearningSurveyResolver = (id: string) => Promise<{
  id: string;
  title: string;
  description: string;
  opensAt: string | null;
  closesAt: string | null;
  status: string;
  requiresLogin: boolean;
}>;
export function createLearningSurveyResolver(
  baseUrl: string,
  timeoutMs: number,
): LearningSurveyResolver {
  return async (id) => {
    const result = await fetch(
      `${baseUrl.replace(/\/$/, '')}/api/surveys/${encodeURIComponent(id)}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      },
    ).catch(() => {
      throw new HttpError(503, 'learning_unavailable', '学习端活动暂时无法连接');
    });
    if (result.status === 404) throw new HttpError(404, 'activity_not_found', '活动不存在');
    if (!result.ok) throw new HttpError(503, 'learning_unavailable', '学习端活动暂时无法连接');
    const payload = (await result.json()) as {
      survey: Awaited<ReturnType<LearningSurveyResolver>>;
    };
    const survey = payload.survey;
    if (
      !survey ||
      survey.id !== id ||
      typeof survey.title !== 'string' ||
      !['published', 'drawn', 'cancelled'].includes(survey.status)
    )
      throw new HttpError(404, 'activity_not_found', '活动不存在或尚未发布');
    return survey;
  };
}
export async function resolveWorkspaceActivity(
  store: DevelopmentStore,
  actor: AuthorizationContext,
  source: RegistrationSource,
  id: string,
  learning: LearningSurveyResolver,
): Promise<{ activity: UnifiedRegistration; ended: boolean; canEdit: boolean }> {
  if (source === 'learning_survey') {
    const survey = await learning(id);
    const closed =
      ['drawn', 'cancelled'].includes(survey.status) ||
      (survey.closesAt != null && Date.parse(survey.closesAt) <= Date.now());
    // Public learning surveys expose registration windows, not event dates or ownership.
    const canEdit =
      actor.roles.includes('platform.super_admin') &&
      authorize(actor, {
        action: 'events.update',
        resource: 'activity',
        scope: { type: 'public', id: '*' },
      }).reason !== 'explicit-deny';
    return {
      ended: false,
      canEdit,
      activity: {
        id,
        source,
        title: survey.title,
        description: survey.description,
        organizer: '学习端活动报名',
        coverUrl: null,
        opensAt: survey.opensAt,
        closesAt: survey.closesAt,
        startsAt: null,
        endsAt: null,
        activityStatus: survey.status,
        requiresLogin: survey.requiresLogin,
        location: null,
        capacity: null,
        registrationCount: null,
        registered: false,
        status: closed
          ? 'closed'
          : survey.opensAt && Date.parse(survey.opensAt) > Date.now()
            ? 'upcoming'
            : 'open',
      },
    };
  }
  const activity = (await listRegistrations(store, actor, true)).find(
    (item) => item.source === source && item.id === id,
  );
  if (!activity) throw new HttpError(404, 'activity_not_found', '活动不存在或暂不可查看');
  const superAdmin = actor.roles.includes('platform.super_admin');
  if (source === 'native_collection') {
    const department = activity.publisherDepartmentId;
    const form = await store.collectionForms.get(id);
    const own = department
      ? canEditDepartment(actor.roles, department)
      : activity.organizationId != null &&
        actorOrganizations(actor).includes(activity.organizationId);
    const denied =
      authorize(actor, { action: 'events.update', resource: 'activity', scope: form?.scope })
        .reason === 'explicit-deny';
    return {
      activity: { ...activity, startsAt: null, endsAt: null },
      ended: false,
      canEdit:
        !denied &&
        (superAdmin || (canCreateCollection(actor) && (own || form?.ownerUid === actor.uid))),
    };
  }
  const record = await store.activities.get(id);
  if (!record) throw new HttpError(404, 'activity_not_found', '活动不存在');
  const ended =
    ['finished', 'archived'].includes(record.status) ||
    (record.endsAt != null && Date.parse(record.endsAt) <= Date.now());
  const own =
    record.organizationId != null &&
    actorOrganizations(actor).includes(record.organizationId as SocialOrganizationId);
  const departmentMember = departmentsForRoles(actor.roles).some(
    (item) => item.organizationId === record.organizationId,
  );
  const denied =
    authorize(actor, { action: 'events.update', resource: 'activity', scope: record.scope })
      .reason === 'explicit-deny';
  return {
    activity: {
      ...activity,
      startsAt: record.startsAt ?? null,
      endsAt: record.endsAt ?? null,
      activityStatus: record.status,
    },
    ended,
    canEdit:
      !denied &&
      (superAdmin ||
        (canCreateCollection(actor) && (own || departmentMember || record.ownerUid === actor.uid))),
  };
}
