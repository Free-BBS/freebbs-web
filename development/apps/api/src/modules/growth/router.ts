import {
  departmentById,
  type ApiEnvelope,
  type GrowthSummary,
  type CollaborationSpace,
  type GrowthActivity,
  type MapEvidence,
} from '@freebbs-development/contracts';
import { Router } from 'express';
import { resolve } from 'node:path';

import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { GROWTH_DOMAINS, growthAchievements } from './achievement-catalog.js';
import { featureStorage } from '../../core/database/feature-storage.js';
import type { ImportedExperience } from '../connectors/router.js';
import { readActivityWorkspace } from '../events/workspace-storage.js';
import { activityWithWorkspaceSchedule } from '../events/workspace-schedule.js';

import type { Response } from 'express';

type Authenticate = (headers: AuthHeaders) => Promise<AuthenticationResult>;

interface GrowthRouterOptions {
  store: DevelopmentStore;
  authenticate: Authenticate;
  now?: () => Date;
  uploadDirectory?: string;
}

function domainFor(organizationId: string | null | undefined) {
  return (
    GROWTH_DOMAINS.find((domain) => domain.organization === organizationId) ?? {
      key: 'other',
      label: '其他',
    }
  );
}

function sendAuthError(response: Response, result: Exclude<AuthenticationResult, { status: 200 }>) {
  response.status(result.status).json({
    data: { error: { code: result.code, message: result.message } },
    requestId: response.locals.requestId as string,
  });
}

export function createGrowthRouter({
  store,
  authenticate,
  now = () => new Date(),
  uploadDirectory,
}: GrowthRouterOptions) {
  const router = Router();

  router.get('/summary', async (request, response) => {
    const identity = await authenticate(request.headers);
    if (identity.status !== 200) return sendAuthError(response, identity);

    const registrations = (
      await store.activityRegistrations.list({ query: identity.user.uid })
    ).filter(
      (record) => record.participantUid === identity.user.uid && record.status === 'registered',
    );
    const completed = (
      await Promise.all(
        [...new Set(registrations.map((record) => record.activityId))].map(async (activityId) => {
          const source = await store.activities.get(activityId);
          if (source === null) return null;
          const activity = await activityWithWorkspaceSchedule(source, uploadDirectory);
          const hasEnded = activity.endsAt && Date.parse(activity.endsAt) <= now().getTime();
          if (
            activity.status !== 'finished' &&
            activity.status !== 'archived' &&
            !(activity.status === 'published' && hasEnded)
          )
            return null;
          const domain = domainFor(activity.organizationId);
          return {
            id: activity.id,
            title: activity.title,
            endsAt: activity.endsAt ?? null,
            domain: domain.key,
            status: activity.status,
          };
        }),
      )
    ).filter((activity): activity is NonNullable<typeof activity> => activity !== null);
    const directory = uploadDirectory ?? resolve('.data/collection-uploads');
    const attendance = (await featureStorage<CollaborationSpace>(directory, 'collaboration').list())
      .filter((space) => space.kind === 'attendance')
      .flatMap((space) =>
        space.entries
          .filter((entry) => entry.uid === identity.user.uid && entry.reviewStatus === 'approved')
          .map((entry): GrowthActivity => ({
            id: `attendance:${space.id}:${entry.id}`,
            title: space.title,
            endsAt: entry.updatedAt,
            domain: space.teamId
              ? 'sports'
              : domainFor(departmentById(space.departmentId ?? '')?.organizationId).key,
            status: 'verified',
            source: 'verified_attendance',
          })),
      );
    const map = (await featureStorage<ImportedExperience>(directory, 'map-experiences').list())
      .filter(
        (entry) =>
          entry.uid === identity.user.uid && Date.parse(entry.occurredAt) <= now().getTime(),
      )
      .map((entry): GrowthActivity => ({
        id: entry.id,
        title: entry.title,
        endsAt: entry.occurredAt,
        domain: entry.domain,
        status: 'verified',
        source: 'map',
      }));
    const synced = new Map<string, GrowthActivity>();
    for (const item of await featureStorage<MapEvidence>(directory, 'map-evidence').list()) {
      if (
        item.uid !== identity.user.uid ||
        item.type !== 'activity' ||
        !Number.isFinite(Date.parse(item.occurredAt)) ||
        Date.parse(item.occurredAt) > now().getTime()
      )
        continue;
      const id = item.activityId ?? `map:${item.periodId}:${item.landmarkId}`;
      synced.set(id, {
        id,
        title: item.title,
        endsAt: item.occurredAt,
        domain: item.domain,
        status: 'verified',
        source: 'map',
      });
    }
    const native: GrowthActivity[] = [];
    const responses = (await store.collectionResponses.list({ query: identity.user.uid })).filter(
      (entry) => entry.respondentUid === identity.user.uid && entry.status === 'submitted',
    );
    for (const id of new Set(responses.map((entry) => entry.formId))) {
      const form = await store.collectionForms.get(id);
      if (!form || form.status === 'draft') continue;
      const workspace = await readActivityWorkspace(directory, 'native_collection', id);
      if (
        !workspace.schedule?.finished &&
        !(workspace.schedule?.endsAt && Date.parse(workspace.schedule.endsAt) <= now().getTime())
      )
        continue;
      native.push({
        id: `collection:${id}`,
        title: form.title,
        endsAt: workspace.schedule.endsAt ?? null,
        domain: domainFor(form.organizationId).key,
        status: 'finished',
        source: 'registration',
      });
    }
    const activities: GrowthActivity[] = [
      ...new Map(
        [...completed, ...native, ...attendance, ...map, ...synced.values()].map((item) => [
          item.id,
          item,
        ]),
      ).values(),
    ];
    activities.sort((left, right) => (right.endsAt ?? '').localeCompare(left.endsAt ?? ''));

    const byDomain = [
      ...GROWTH_DOMAINS.map(({ key, label }) => ({ key, label })),
      { key: 'other', label: '其他' },
    ].map(({ key, label }) => ({
      key,
      label,
      count: activities.filter((activity) => activity.domain === key).length,
    }));
    const achievements = growthAchievements(activities).map((entry) => ({
      ...entry,
      description: entry.description.replaceAll(
        '已结束且未取消的活动报名记录',
        '已结束报名或已核验参与记录',
      ),
    }));

    const summary: GrowthSummary = {
      total: activities.length,
      basis:
        attendance.length + map.length + synced.size > 0
          ? 'mixed_participation'
          : 'completed_registration',
      ...(attendance.length + map.length + synced.size > 0
        ? {
            verifiedTotal: activities.filter(
              (item) => item.source === 'map' || item.source === 'verified_attendance',
            ).length,
          }
        : {}),
      byDomain,
      achievements,
      activities,
    };
    response.status(200).json({
      data: summary,
      requestId: response.locals.requestId as string,
    } satisfies ApiEnvelope<GrowthSummary>);
  });

  return router;
}
