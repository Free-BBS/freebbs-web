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
      liveUrl: 'https://example.com/live',
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

  it('allows own live-link updates without changing other fields and rejects unauthorized edits', async () => {
    const app = fixture();
    const created = await request(app)
      .post('/api/development/v1/sports/matches')
      .set('X-Demo-User', 'demo-sports-member')
      .send({
        title: '决赛',
        startsAt: '2026-10-08T05:00:00.000Z',
        endsAt: '2026-10-08T07:00:00.000Z',
        location: '篮球馆',
        liveUrl: 'https://example.com/live',
        replayUrl: 'https://example.com/replay',
        result: '72–68',
        coverUrl: 'https://example.com/cover.png',
      })
      .expect(201);
    const original = created.body.data;
    const path = `/api/development/v1/sports/matches/${original.id}`;
    const changed = await request(app)
      .patch(path)
      .set('X-Demo-User', 'demo-sports-member')
      .send({ liveUrl: 'https://example.com/new' })
      .expect(200);
    expect(changed.body.data).toMatchObject({
      ...original,
      liveUrl: 'https://example.com/new',
      updatedAt: expect.any(String),
    });
    await request(app)
      .patch(path)
      .set('X-Demo-User', 'demo-student')
      .send({ liveUrl: 'https://example.com/student' })
      .expect(403);
    await request(app)
      .patch(path)
      .set('X-Demo-User', 'demo-captain')
      .send({ liveUrl: 'https://example.com/captain' })
      .expect(403);
    await request(app)
      .patch(path)
      .set('X-Demo-User', 'demo-sports-lead')
      .send({ liveUrl: 'https://example.com/lead' })
      .expect(200);
  });

  it('rejects unsafe media URLs for creation and updates without changing the match', async () => {
    const app = fixture();
    const input = {
      title: '决赛',
      startsAt: '2026-10-08T05:00:00.000Z',
      endsAt: '2026-10-08T07:00:00.000Z',
      location: '篮球馆',
      liveUrl: 'https://example.com/live',
    };
    const created = await request(app)
      .post('/api/development/v1/sports/matches')
      .set('X-Demo-User', 'demo-sports-member')
      .send(input)
      .expect(201);
    const before = await request(app)
      .get('/api/development/v1/sports/matches')
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    for (const liveUrl of [
      'javascript:alert(1)',
      'data:text/html,unsafe',
      'ftp://example.com/live',
    ]) {
      await request(app)
        .post('/api/development/v1/sports/matches')
        .set('X-Demo-User', 'demo-sports-member')
        .send({ ...input, liveUrl })
        .expect(400);
      await request(app)
        .patch(`/api/development/v1/sports/matches/${created.body.data.id}`)
        .set('X-Demo-User', 'demo-sports-member')
        .send({ liveUrl })
        .expect(400);
    }
    const list = await request(app)
      .get('/api/development/v1/sports/matches')
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    expect(list.body.data).toEqual(before.body.data);
    expect(
      list.body.data.find((match: { id: string }) => match.id === created.body.data.id),
    ).toEqual(created.body.data);
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
