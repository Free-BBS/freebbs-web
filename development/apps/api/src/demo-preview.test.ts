import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { DemoAuthClient } from './core/auth/demo-auth-client.js';
import { createMemoryStore } from './core/database/memory-store.js';

const demoUserIds = [
  'demo-student',
  'demo-admin',
  'demo-rights-member',
  'demo-liaison-member',
  'demo-sports-lead',
  'demo-sports-director',
  'demo-captain',
  'demo-tuanwei-lead',
  'demo-arts-member',
  'demo-arts-director',
  'demo-arts-lead',
  'demo-sports-member',
  'demo-liaison-director',
  'demo-liaison-lead',
  'demo-rights-director',
  'demo-rights-lead',
] as const;

function demoApp() {
  return createApp({
    store: createMemoryStore(),
    databaseMode: 'memory',
    authMode: 'demo',
    authClient: new DemoAuthClient(demoUserIds),
  });
}

function asDemo(app: ReturnType<typeof createApp>, uid: (typeof demoUserIds)[number]) {
  return {
    get: (path: string) => request(app).get(path).set('X-Demo-User', uid),
  };
}

describe('integrated demo preview', () => {
  it('resolves all twelve center ranks with scoped membership and arts-only festival review', async () => {
    const app = demoApp();
    for (const [center, organization] of [
      ['arts', 'arts_center'],
      ['sports', 'sports_center'],
      ['liaison', 'liaison_center'],
      ['rights', 'rights_development_center'],
    ] as const) {
      for (const rank of ['member', 'director', 'lead'] as const) {
        const uid = `demo-${center}-${rank}`;
        const roleCenter = center === 'rights' ? 'rights_development' : center;
        const role = `${rank === 'lead' ? 'domain' : 'department'}.${roleCenter}_${rank}`;
        const response = await request(app)
          .get('/api/development/v1/me')
          .set('X-Demo-User', uid)
          .expect(200);
        expect(response.body.data.roles).toEqual([role]);
        expect(response.body.data.tags).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              key: `social_org.${organization}`,
              scope: { type: 'social_organization', id: organization },
            }),
          ]),
        );
        const review = await request(app)
          .get('/api/development/v1/events/festival/submissions?view=review')
          .set('X-Demo-User', uid);
        expect(review.status).toBe(center === 'arts' ? 200 : 403);
      }
    }
  });
  it('loads the representative identity matrix with governed roles and captain tag', async () => {
    const app = demoApp();
    const expected = new Map<string, { role?: string; tag?: string }>([
      ['demo-student', {}],
      ['demo-admin', { role: 'platform.super_admin' }],
      ['demo-rights-member', { role: 'department.rights_development_member' }],
      ['demo-liaison-member', { role: 'department.liaison_member' }],
      ['demo-sports-lead', { role: 'domain.sports_lead' }],
      ['demo-sports-director', { role: 'department.sports_director' }],
      ['demo-captain', { tag: 'sports.team_captain' }],
      ['demo-tuanwei-lead', { role: 'affiliation.tuanwei_lead' }],
    ]);

    for (const uid of demoUserIds) {
      const response = await asDemo(app, uid).get('/api/development/v1/me').expect(200);
      const expectation = expected.get(uid);
      if (expectation?.role) expect(response.body.data.roles).toContain(expectation.role);
      if (expectation?.tag) {
        expect(response.body.data.tags).toEqual(
          expect.arrayContaining([expect.objectContaining({ key: expectation.tag })]),
        );
      }
    }
  });

  it('serves representative records across the approved platform modules', async () => {
    const app = demoApp();

    const general = await asDemo(app, 'demo-student')
      .get('/api/development/v1/knowledge/entries?audience=general')
      .expect(200);
    expect(general.body.data.map((entry: { title: string }) => entry.title)).toContain(
      '活动立项与复盘流程',
    );

    const social = await asDemo(app, 'demo-sports-lead')
      .get('/api/development/v1/knowledge/entries?audience=social_org')
      .expect(200);
    expect(social.body.data).toEqual([
      expect.objectContaining({
        title: '体育中心代表队交接清单',
        organizationId: 'sports_center',
      }),
    ]);

    const proposals = await asDemo(app, 'demo-student')
      .get('/api/development/v1/information/proposals')
      .expect(200);
    expect(proposals.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: '校园夜间照明优化' })]),
    );
    expect(proposals.body.data[0]).not.toHaveProperty('internalNote');

    const activity = await asDemo(app, 'demo-student')
      .get('/api/development/v1/events/activities/activity-ma-john-cup')
      .expect(200);
    expect(activity.body.data).toMatchObject({
      title: '马约翰杯',
      progress: { completed: 2, total: 4, percentage: 50 },
      fixtures: [
        expect.objectContaining({
          round: '小组赛',
          participantA: '电子系',
          participantB: '自动化系',
        }),
      ],
    });

    const sportsFinance = await asDemo(app, 'demo-sports-lead')
      .get('/api/development/v1/finance/records')
      .expect(200);
    expect(sportsFinance.body.data).toEqual([
      expect.objectContaining({ organizationId: 'sports_center' }),
    ]);

    const oversight = await asDemo(app, 'demo-tuanwei-lead')
      .get('/api/development/v1/finance/records')
      .expect(200);
    expect(
      oversight.body.data.map((record: { organizationId: string }) => record.organizationId),
    ).toEqual(expect.arrayContaining(['liaison_center', 'sports_center']));
  });
});
