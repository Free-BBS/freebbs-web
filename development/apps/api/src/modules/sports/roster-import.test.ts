import request from 'supertest';
import { describe, expect, it } from 'vitest';

import type { UserContext } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { setOrganizationMembership } from '../admin/organization-membership-service.js';

const zhangSan = '\u5f20\u4e09';
const liSi = '\u674e\u56db';
const header = '\u59d3\u540d,\u5b66\u53f7';

const identity = (uid: string): UserContext => ({
  uid,
  displayName: uid,
  avatarUrl: null,
  baseRole: 'student',
  roles: [],
  tags: [],
});

async function fixture() {
  const store = createMemoryStore();
  await store.subjects.create({
    uid: 'sports-director',
    displayName: 'sports-director',
    avatarUrl: null,
    status: 'active',
    ownerUid: 'demo-admin',
    scope: { type: 'public', id: '*' },
  });
  await setOrganizationMembership(
    store,
    { subjectUid: 'sports-director', organizationId: 'sports_center', level: 'director' },
    { actorUid: 'demo-admin' },
  );
  const app = createApp({
    store,
    authMode: 'demo',
    authClient: {
      introspect: async (uid) =>
        ['sports-director', 'demo-captain'].includes(uid) ? identity(uid) : null,
    },
  });
  return { app, store };
}

describe('sports roster import', () => {
  it('previews and transactionally imports pending subjects for Sports directors', async () => {
    const { app, store } = await fixture();
    const csv = `\uFEFF${header}\r\n${zhangSan},20260001\r\n${liSi},20260002`;

    await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/roster-import/preview')
      .set('X-Demo-User', 'demo-captain')
      .set('Content-Type', 'text/csv')
      .send(csv)
      .expect(404);

    const preview = await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/roster-import/preview')
      .set('X-Demo-User', 'sports-director')
      .set('Content-Type', 'text/csv')
      .send(csv)
      .expect(200);
    expect(preview.body.data).toEqual([
      expect.objectContaining({ name: zhangSan, studentNumber: '20260001', outcome: 'ready' }),
      expect.objectContaining({ name: liSi, studentNumber: '20260002', outcome: 'ready' }),
    ]);

    const confirmed = await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/roster-import')
      .set('X-Demo-User', 'sports-director')
      .send({ rows: preview.body.data })
      .expect(201);
    expect(confirmed.body.data).toMatchObject({ imported: 2, skipped: 0 });
    expect(await store.sportsTeamMembers.list({ query: '20260001' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ memberUid: '20260001' })]),
    );
    expect(await store.subjects.list({ query: '20260001' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uid: '20260001', displayName: zhangSan, status: 'pending' }),
      ]),
    );
  });

  it('blocks stale name mismatches without partially importing earlier rows', async () => {
    const { app, store } = await fixture();
    await store.subjects.create({
      uid: '20260002',
      displayName: 'changed-name',
      avatarUrl: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'public', id: '*' },
    });
    const response = await request(app)
      .post('/api/development/v1/sports/teams/team-basketball/roster-import')
      .set('X-Demo-User', 'sports-director')
      .send({
        rows: [
          { row: 2, name: zhangSan, studentNumber: '20260001', outcome: 'ready' },
          { row: 3, name: liSi, studentNumber: '20260002', outcome: 'ready' },
        ],
      })
      .expect(409);
    expect(response.body.data.error.code).toBe('roster_preview_stale');
    expect(await store.subjects.list({ query: '20260001' })).toHaveLength(0);
    expect(await store.sportsTeamMembers.list({ query: '20260001' })).toHaveLength(0);
  });
});
