import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const student = { 'X-Demo-User': 'demo-student' };
const admin = { 'X-Demo-User': 'demo-admin' };
const membershipPath = '/api/development/v1/clubs/club-running/memberships';

describe('club membership workflow', () => {
  it('serializes join, preserves one historical row, and lets maintainers approve or reject', async () => {
    const store = createMemoryStore();
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student', 'demo-admin']),
    });

    const concurrent = await Promise.all([
      request(app).post(membershipPath).set(student).send({}),
      request(app).post(membershipPath).set(student).send({}),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([201, 409]);
    const joined = concurrent.find((response) => response.status === 201)!;
    expect(joined.body.data.status).toBe('pending');
    const membershipId = joined.body.data.id as string;

    const own = await request(app).get(membershipPath).set(student).expect(200);
    expect(own.body.data).toEqual([
      expect.objectContaining({ id: membershipId, memberUid: 'demo-student', status: 'pending' }),
    ]);
    const queue = await request(app).get(membershipPath).set(admin).expect(200);
    expect(queue.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: membershipId, memberUid: 'demo-student', status: 'pending' }),
        expect.objectContaining({ memberUid: 'demo-captain', status: 'active' }),
      ]),
    );

    await request(app)
      .patch(`${membershipPath}/${membershipId}`)
      .set(admin)
      .send({ status: 'active' })
      .expect(200);
    await request(app).delete(membershipPath).set(student).expect(204);
    expect(await store.clubMemberships.get(membershipId)).toMatchObject({ status: 'left' });

    const rejoined = await request(app).post(membershipPath).set(student).send({}).expect(201);
    expect(rejoined.body.data).toMatchObject({ id: membershipId, status: 'pending' });
    await request(app)
      .patch(`${membershipPath}/${membershipId}`)
      .set(admin)
      .send({ status: 'rejected' })
      .expect(200);
    expect(
      (await store.clubMemberships.list({ query: 'club-running' })).filter(
        (record) => record.memberUid === 'demo-student',
      ),
    ).toHaveLength(1);
  });
});
