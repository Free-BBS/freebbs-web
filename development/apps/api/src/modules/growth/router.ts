import type { ApiEnvelope, GrowthSummary } from '@freebbs-development/contracts';
import { Router } from 'express';

import type { AuthenticationResult, AuthHeaders } from '../../core/auth/auth-middleware.js';
import type { DevelopmentStore } from '../../core/database/types.js';

import type { Response } from 'express';

type Authenticate = (headers: AuthHeaders) => Promise<AuthenticationResult>;

interface GrowthRouterOptions {
  store: DevelopmentStore;
  authenticate: Authenticate;
  now?: () => Date;
}

const DOMAINS = [
  { key: 'arts', label: '文艺', organizations: ['arts_center'] },
  { key: 'sports', label: '体育', organizations: ['sports_center'] },
  { key: 'liaison', label: '联络', organizations: ['liaison_center'] },
  { key: 'rights', label: '权益发展', organizations: ['rights_development_center'] },
  { key: 'tuanwei', label: '团委', organizations: ['tuanwei'] },
  { key: 'sast', label: '科创', organizations: ['sast'] },
  { key: 'tms', label: 'TMS', organizations: ['tms'] },
] as const;

function domainFor(organizationId: string | null | undefined) {
  return (
    DOMAINS.find((domain) => domain.organizations.some((id) => id === organizationId)) ?? {
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
        registrations.map(async (registration) => {
          const activity = await store.activities.get(registration.activityId);
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
      ...DOMAINS.map(({ key, label }) => ({ key, label })),
      { key: 'other', label: '其他' },
    ].map(({ key, label }) => ({
      key,
      label,
      count: completed.filter((activity) => activity.domain === key).length,
    }));
    const distinctDomains = byDomain.filter(({ count }) => count > 0).length;
    const achievements = [
      {
        id: 'first-step',
        title: '初次登场',
        description: '完成 1 次活动报名经历',
        progress: completed.length,
        target: 1,
      },
      {
        id: 'steady-explorer',
        title: '持续探索',
        description: '累积 5 次活动报名经历',
        progress: completed.length,
        target: 5,
      },
      {
        id: 'multi-domain',
        title: '跨界体验家',
        description: '探索 3 个不同领域',
        progress: distinctDomains,
        target: 3,
      },
    ].map((achievement) => ({
      ...achievement,
      unlocked: achievement.progress >= achievement.target,
    }));

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
