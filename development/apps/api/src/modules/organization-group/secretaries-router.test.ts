import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { secretaryClassIds, type UserContext } from '@freebbs-development/contracts';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import { createClassSecretariesRouter } from './secretaries-router.js';
import { HttpError } from '../../core/errors/http-error.js';
import type { DirectoryUser } from '../../core/auth/user-directory.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { archiveTagAssignment, createTagAssignment } from '../admin/assignment-service.js';

const base = '/secretaries';
const actor: UserContext = {
  uid: 'organizer',
  displayName: '组织组同学',
  avatarUrl: null,
  baseRole: 'student',
  roles: ['youth_league.organization.member'],
  tags: [],
};
const users: DirectoryUser[] = [
  {
    uid: 'student-a',
    username: 'alice',
    displayName: '同学甲',
    studentId: '2026000001',
    avatarUrl: null,
  },
  {
    uid: 'student-b',
    username: 'bob',
    displayName: '同学乙',
    studentId: '2026000002',
    avatarUrl: null,
  },
];
function fixture(user = actor) {
  const store = createMemoryStore();
  const directory = {
    list: async (query?: string) =>
      users.filter(
        (row) =>
          !query ||
          `${row.uid} ${row.username} ${row.displayName} ${row.studentId}`.includes(query),
      ),
    get: async (uid: string) => users.find((row) => row.uid === uid) ?? null,
  };
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.actor = user;
    res.locals.requestId = 'test';
    next();
  });
  app.use(
    base,
    createClassSecretariesRouter({
      store,
      directory,
      readClasses: async () => [
        { id: 'wu55', label: '无55' },
        { id: 'wu54', label: '无54' },
      ],
    }),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next;
      const e = error as HttpError;
      res.status(e.status ?? 500).json({ error: e.code });
    },
  );
  return { store, app, directory };
}

describe('scoped class secretary delegation', () => {
  it.each(['youth_league.organization.member', 'platform.admin'] as const)(
    'rechecks an appointment that expires during user lookup before writing (%s)',
    async (roleKey) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = new Date('2026-10-28T12:00:00Z');
      vi.setSystemTime(start);
      try {
        const scoped: AuthorizationContext = {
          ...actor,
          roles: [roleKey],
          businessAdmin: roleKey === 'platform.admin',
          roleScopes: [
            {
              subjectUid: actor.uid,
              roleKey,
              scope: { type: 'public', id: '*' },
              expiresAt: new Date(start.getTime() + 1000).toISOString(),
            },
          ],
        };
        const { app, store, directory } = fixture(scoped);
        const original = (await request(app).get(`${base}/student-a`).expect(200)).body.data;
        const originalGet = directory.get;
        directory.get = async (uid) => {
          vi.setSystemTime(new Date(start.getTime() + 2000));
          return originalGet(uid);
        };
        await request(app)
          .put(`${base}/student-a`)
          .send({ classIds: ['wu55'], revision: original.revision })
          .expect(403);
        expect(await store.tagAssignments.list({ subjectUid: 'student-a' })).toEqual([]);
        expect(
          (await store.auditLogs.list()).filter(
            (row) => row.action === 'organization_group.class_secretary.update',
          ),
        ).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it('prevents the generic tag assignment API from bypassing the dedicated class validation', async () => {
    const { app, store } = fixture();
    await expect(
      createTagAssignment(
        store,
        {
          subjectUid: 'student-a',
          tagKey: 'class.youth_league_secretary',
          scope: { type: 'class', id: 'not-configured' },
        },
        { actorUid: 'demo-admin' },
      ),
    ).rejects.toMatchObject({ code: 'class_secretary_managed' });
    const original = (await request(app).get(`${base}/student-a`).expect(200)).body.data;
    await request(app)
      .put(`${base}/student-a`)
      .send({ classIds: ['wu55'], revision: original.revision })
      .expect(200);
    const row = (await store.tagAssignments.list({ subjectUid: 'student-a' }))[0]!;
    await expect(
      archiveTagAssignment(store, row.id, { actorUid: 'demo-admin' }),
    ).rejects.toMatchObject({ code: 'class_secretary_managed' });
    expect((await store.tagAssignments.get(row.id))?.status).toBe('active');
  });
  it('searches registered users, grants only the secretary tag, and revokes on the next authorization load', async () => {
    const { store, app } = fixture();
    const search = await request(app).get(`${base}?query=alice`).expect(200);
    expect(search.body.data.items).toHaveLength(1);
    const original = search.body.data.items[0];
    const saved = await request(app)
      .put(`${base}/student-a`)
      .send({ classIds: ['wu55'], revision: original.revision })
      .expect(200);
    expect(saved.body.data.classIds).toEqual(['wu55']);
    const identity = { ...actor, uid: 'student-a', roles: [] };
    expect(secretaryClassIds(await loadAuthorizationContext(store, identity, new Date()))).toEqual([
      'wu55',
    ]);
    expect(await store.roleAssignments.list({ subjectUid: 'student-a' })).toEqual([]);
    const audit = (await store.auditLogs.list()).filter(
      (row) => row.action === 'organization_group.class_secretary.update',
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toMatchObject({
      subjectUid: 'student-a',
      beforeClassIds: [],
      classIds: ['wu55'],
    });
    await request(app)
      .put(`${base}/student-a`)
      .send({ classIds: [], revision: saved.body.data.revision })
      .expect(200);
    expect(secretaryClassIds(await loadAuthorizationContext(store, identity, new Date()))).toEqual(
      [],
    );
  });
  it('serializes conflicting first grants and rejects stale revisions', async () => {
    const { app } = fixture();
    const original = (await request(app).get(`${base}/student-a`).expect(200)).body.data;
    const results = await Promise.all(
      ['wu55', 'wu54'].map((id) =>
        request(app)
          .put(`${base}/student-a`)
          .send({ classIds: [id], revision: original.revision }),
      ),
    );
    expect(results.map((row) => row.status).sort()).toEqual([200, 409]);
    await request(app)
      .put(`${base}/student-a`)
      .send({ classIds: [], revision: original.revision })
      .expect(409);
  });
  it('rejects unknown users, unconfigured or duplicate classes, and extra identity fields', async () => {
    const { app, store } = fixture();
    const original = (await request(app).get(`${base}/student-a`).expect(200)).body.data;
    for (const ids of [['not-a-class'], ['wu55', 'wu55']])
      await request(app)
        .put(`${base}/student-a`)
        .send({ classIds: ids, revision: original.revision })
        .expect(400);
    await request(app)
      .put(`${base}/unknown`)
      .send({ classIds: ['wu55'], revision: original.revision })
      .expect(404);
    await request(app)
      .put(`${base}/student-a`)
      .send({ classIds: ['wu55'], revision: original.revision, roleKey: 'platform.admin' })
      .expect(400);
    expect(await store.tagAssignments.list({ subjectUid: 'student-a' })).toEqual([]);
  });
  it('does not delegate this grant to counselors, learning admins, leads or preview identities', async () => {
    for (const user of [
      { ...actor, roles: ['counselor.practice'] as UserContext['roles'] },
      { ...actor, roles: ['platform.learning_admin'] as UserContext['roles'], learningAdmin: true },
      { ...actor, roles: ['platform.super_admin'] as UserContext['roles'] },
      { ...actor, previewing: true },
    ]) {
      const { app } = fixture(user);
      await request(app).get(base).expect(403);
      await request(app)
        .put(`${base}/student-a`)
        .send({ classIds: [], revision: '0'.repeat(64) })
        .expect(403);
    }
  });
  it('honors disabled definitions and expired tags without granting access', async () => {
    const { app, store } = fixture();
    const original = (await request(app).get(`${base}/student-a`).expect(200)).body.data;
    await request(app)
      .put(`${base}/student-a`)
      .send({ classIds: ['wu55'], revision: original.revision })
      .expect(200);
    const rows = await store.tagAssignments.list({ subjectUid: 'student-a' });
    await store.tagAssignments.update(rows[0]!.id, { expiresAt: '2000-01-01T00:00:00Z' });
    const identity = { ...actor, uid: 'student-a', roles: [] };
    expect(secretaryClassIds(await loadAuthorizationContext(store, identity, new Date()))).toEqual(
      [],
    );
    const definition = (
      await store.tagDefinitions.list({ key: 'class.youth_league_secretary' })
    )[0]!;
    await store.tagDefinitions.update(definition.id, { status: 'disabled' });
    const latest = (await request(app).get(`${base}/student-a`).expect(200)).body.data;
    await request(app)
      .put(`${base}/student-a`)
      .send({ classIds: ['wu55'], revision: latest.revision })
      .expect(409);
    expect(secretaryClassIds(await loadAuthorizationContext(store, identity, new Date()))).toEqual(
      [],
    );
  });
});
