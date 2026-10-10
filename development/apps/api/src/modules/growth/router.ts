import type { ApiEnvelope, GrowthSummary } from '@freebbs-development/contracts';
import { Router } from 'express';

import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import type { DevelopmentStore } from '../../core/database/types.js';
import { GROWTH_DOMAINS, growthAchievements } from './achievement-catalog.js';

import type { Response } from 'express';

type Authenticate = (headers: AuthHeaders) => Promise<AuthenticationResult>;

interface GrowthRouterOptions {
  store: DevelopmentStore;
  authenticate: Authenticate;
  now?: () => Date;
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
          const activity = await store.activities.get(activityId);
          if (activity === null) return null;
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
    completed.sort((left, right) => (right.endsAt ?? '').localeCompare(left.endsAt ?? ''));

    const byDomain = [
      ...GROWTH_DOMAINS.map(({ key, label }) => ({ key, label })),
      { key: 'other', label: '其他' },
    ].map(({ key, label }) => ({
      key,
      label,
      count: completed.filter((activity) => activity.domain === key).length,
    }));
    const achievements = growthAchievements(completed);

    const summary: GrowthSummary = {
      total: completed.length,
      basis: 'completed_registration',
      byDomain,
      achievements,
      activities: completed,
    };
    response.status(200).json({
      data: summary,
      requestId: response.locals.requestId as string,
    } satisfies ApiEnvelope<GrowthSummary>);
  });

  return router;
}
