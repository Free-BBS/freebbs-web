import { isDevelopmentBusinessAdmin } from '@freebbs-development/contracts';
import type { RegistrationSource, UnifiedRegistration } from '@freebbs-development/contracts';
import type { DevelopmentStore } from '../../core/database/types.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { HttpError } from '../../core/errors/http-error.js';
import { listRegistrations } from '../collections/registrations.js';
import { authorize } from '../../core/authorization/authorize.js';
import { canEditActivityWorkspace } from '../../core/authorization/scoped-department-edit.js';
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
  uploadDirectory?: string,
): Promise<{
  activity: UnifiedRegistration;
  ended: boolean;
  canEdit: boolean;
  sourceActivityStatus?: string;
}> {
  if (source === 'learning_survey') {
    const survey = await learning(id);
    const closed =
      ['drawn', 'cancelled'].includes(survey.status) ||
      (survey.closesAt != null && Date.parse(survey.closesAt) <= Date.now());
    // Public learning surveys expose registration windows, not event dates or ownership.
    const canEdit =
      isDevelopmentBusinessAdmin(actor) &&
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
  const activity = (await listRegistrations(store, actor, true, uploadDirectory)).find(
    (item) => item.source === source && item.id === id,
  );
  if (!activity) throw new HttpError(404, 'activity_not_found', '活动不存在或暂不可查看');
  if (source === 'native_collection') {
    const form = await store.collectionForms.get(id);
    if (!form) throw new HttpError(404, 'activity_not_found', '活动不存在');
    return {
      activity,
      ended: false,
      canEdit: await canEditActivityWorkspace(store, actor, {
        source,
        id,
        scope: form.scope,
        ownerUid: form.ownerUid,
        departmentId: activity.publisherDepartmentId,
        organizationId: activity.organizationId,
      }),
    };
  }
  const record = await store.activities.get(id);
  if (!record) throw new HttpError(404, 'activity_not_found', '活动不存在');
  const sourceFinished = ['finished', 'archived'].includes(record.status);
  const ended =
    sourceFinished || (activity.endsAt != null && Date.parse(activity.endsAt) <= Date.now());
  return {
    activity,
    ended,
    sourceActivityStatus: record.status,
    canEdit: await canEditActivityWorkspace(store, actor, {
      source,
      id,
      scope: record.scope,
      ownerUid: record.ownerUid,
      departmentId: activity.publisherDepartmentId,
      organizationId: record.organizationId,
    }),
  };
}
