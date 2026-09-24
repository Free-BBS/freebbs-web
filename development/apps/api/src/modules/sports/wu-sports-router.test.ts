import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

function fixture() {
  const ids = ['demo-student', 'demo-sports-member', 'demo-captain', 'demo-sports-lead'];
  return createApp({
    store: createMemoryStore(),
    authMode: 'demo',
    authClient: new DemoAuthClient(ids),
  });
}

describe('無体育 API', () => {
  it('lets every sports member publish a match and derives its timeline status', async () => {
    const app = fixture();
    const created = await request(app)
      .post('/api/development/v1/sports/matches')
      .set('X-Demo-User', 'demo-sports-member')
      .send({
        title: '篮球小组赛',
        startsAt: '2026-09-22T05:00:00.000Z',
        endsAt: '2026-09-22T07:00:00.000Z',
        location: '篮球馆',
        liveUrl: 'https://example.com/live',
        result: '电院 72–68 自动化',
      })
      .expect(201);
    expect(created.body.data).toMatchObject({
      title: '篮球小组赛',
      ownerUid: 'demo-sports-member',
      result: '电院 72–68 自动化',
    });
    const list = await request(app)
      .get('/api/development/v1/sports/matches')
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    expect(list.body.data[0]).toHaveProperty('matchStatus');
    await request(app)
      .post('/api/development/v1/sports/matches')
      .set('X-Demo-User', 'demo-student')
      .send({
        title: '越权',
        startsAt: '2026-09-22T05:00:00.000Z',
        endsAt: '2026-09-22T07:00:00.000Z',
        location: '操场',
      })
      .expect(403);
  });

  it('lets a scoped captain maintain only their team showcase', async () => {
    const app = fixture();
    await request(app)
      .put('/api/development/v1/sports/teams/team-basketball/showcase')
      .set('X-Demo-User', 'demo-captain')
      .send({ markdown: '# 篮球队\n团结，拼搏。' })
      .expect(200);
    const result = await request(app)
      .get('/api/development/v1/sports/teams/team-basketball/showcase')
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    expect(result.body.data.markdown).toContain('团结');
    await request(app)
      .put('/api/development/v1/sports/teams/team-volleyball/showcase')
      .set('X-Demo-User', 'demo-captain')
      .send({ markdown: '越权' })
      .expect(403);
  });
});
