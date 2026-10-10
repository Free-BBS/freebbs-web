import type { ActivityNotification, RegistrationSource } from '@freebbs-development/contracts';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { HttpError } from '../../core/errors/http-error.js';
import { resolveWorkspaceActivity, type LearningSurveyResolver } from './workspace-activity.js';
import { listActivityWorkspaces, type SavedActivityWorkspace } from './workspace-storage.js';

export async function readableWorkspaces(
  directory: string,
  store: DevelopmentStore,
  actor: AuthorizationContext,
  learning: LearningSurveyResolver,
  includeAll = false,
) {
  const result: SavedActivityWorkspace[] = [];
  for (const workspace of await listActivityWorkspaces(directory)) {
    if (
      !includeAll &&
      !workspace.followers.includes(actor.uid) &&
      !workspace.notices.some((n) => n.recipients.includes(actor.uid))
    )
      continue;
    try {
      await resolveWorkspaceActivity(
        store,
        actor,
        workspace.source,
        workspace.activityId,
        learning,
      );
      result.push(workspace);
    } catch (error) {
      if (!(error instanceof HttpError) || ![403, 404, 503].includes(error.status)) throw error;
    }
  }
  return result;
}
export function notificationsFor(
  workspaces: SavedActivityWorkspace[],
  uid: string,
): ActivityNotification[] {
  return workspaces
    .flatMap((w) =>
      w.notices
        .filter((n) => n.recipients.includes(uid))
        .map((n) => ({
          id: n.id,
          source: n.source,
          activityId: n.activityId,
          title: n.title,
          body: n.body,
          link: n.link,
          createdAt: n.createdAt,
          readAt: n.reads.find((r) => r.uid === uid)?.readAt ?? null,
        })),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
export function activityPath(source: RegistrationSource, id: string) {
  return `/development/collections/activities/${source}/${encodeURIComponent(id)}`;
}
