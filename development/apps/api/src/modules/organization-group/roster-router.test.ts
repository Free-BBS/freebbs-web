import express from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { featureStorage } from '../../core/database/feature-storage.js';
import { HttpError } from '../../core/errors/http-error.js';
import { initialState, WORKSPACE_ID, type OrganizationState } from './domain.js';
import { createOrganizationGroupRouter } from './router.js';

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    if (!isAbsolute(directory) || !basename(directory).startsWith('organization-roster-'))
      throw new Error('Unexpected temporary directory');
    await rm(directory, { recursive: true, force: true });
  }
});

function person(uid: string, changes: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    baseRole: 'student',
    roles: [],
    tags: [],
    ...changes,
  };
}
async function fixture(existingDirectory?: string) {
  const directory = existingDirectory ?? (await mkdtemp(join(tmpdir(), 'organization-roster-')));
  if (!existingDirectory) directories.push(directory);
  const storage = featureStorage<OrganizationState>(directory, 'organization-group');
  if (!existingDirectory) {
    const state = initialState();
    state.classes = [
      { id: 'a', label: '无55' },
      { id: 'b', label: '无54' },
    ];
    state.managerUids = ['manager'];
    state.members = [
      { uid: 'legacy', studentId: 'legacy-id', classId: 'a', submitClassIds: ['a'] },
    ];
    await storage.change(WORKSPACE_ID, () => ({ record: state, result: null }));
  }
  const secretary = (uid: string, id: string) =>
    person(uid, {
      tags: [{ key: 'class.youth_league_secretary', scope: { type: 'class', id } }],
    });
  const actors = new Map<string, AuthorizationContext>([
    ['a', secretary('a', 'a')],
    ['b', secretary('b', 'b')],
    ['manager', person('manager')],
    ['department', person('department', { roles: ['youth_league.organization.member'] })],
    ['counselor', person('counselor', { roles: ['counselor.practice'] })],
    ['ordinary', person('ordinary')],
    ['legacy', person('legacy', { studentId: 'legacy-id' })],
    ['preview-a', { ...secretary('preview-a', 'a'), previewing: true }],
    ['preview-manager', person('preview-manager', { businessAdmin: true, previewing: true })],
  ]);
  const authCalls = new Map<string, number>();
  let onAuthenticate: ((uid: string, call: number) => void) | undefined;
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(
    '/org',
    createOrganizationGroupRouter({
      uploadDirectory: directory,
      nodeEnvironment: 'test',
      authenticate: async (headers) => {
        const uid = String(headers['x-user'] ?? 'ordinary');
        const call = (authCalls.get(uid) ?? 0) + 1;
        authCalls.set(uid, call);
        onAuthenticate?.(uid, call);
        const user = actors.get(uid);
        return user
          ? { status: 200, user }
          : { status: 401, code: 'missing_identity', message: 'Login required' };
      },
    }),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next;
      const e =
        error instanceof HttpError ? error : new HttpError(500, 'unexpected', String(error));
      res.status(e.status).json({ error: { code: e.code, message: e.message } });
    },
  );
  return {
    app,
    directory,
    storage,
    actors,
    authCalls,
    setAuthHook: (hook: typeof onAuthenticate) => {
      onAuthenticate = hook;
    },
  };
}
const base = '/org/rosters';
const one = (displayName = '同学甲') => [{ id: 'member-a', displayName }];

describe('configured class roster API', () => {
  it('starts at revision zero, assigns stable IDs without requiring student IDs, and persists across restart', async () => {
    const f = await fixture();
    const initial = await request(f.app).get(`${base}/a`).set('x-user', 'a').expect(200);
    expect(initial.headers['cache-control']).toBe('private, no-store');
    expect(initial.body.data).toMatchObject({
      classId: 'a',
      revision: 0,
      members: [],
      updatedAt: null,
      canEdit: true,
      canImport: false,
    });
    const saved = await request(f.app)
      .put(`${base}/a`)
      .set('x-user', 'a')
      .send({
        revision: 0,
        members: [
          { displayName: ' 同名同学 ' },
          { displayName: '同名同学', studentId: '20260002' },
        ],
      })
      .expect(200);
    const members = saved.body.data.members;
    expect(members).toHaveLength(2);
    expect(members[0].displayName).toBe('同名同学');
    expect(members[0]).not.toHaveProperty('studentId');
    expect(members[0].id).not.toBe(members[1].id);
    expect(members[0].id).toMatch(/^[a-f0-9-]{36}$/);
    const restarted = await fixture(f.directory);
    expect(
      (await request(restarted.app).get(`${base}/a`).set('x-user', 'a').expect(200)).body.data
        .members,
    ).toEqual(members);
    const changed = await request(restarted.app)
      .put(`${base}/a`)
      .set('x-user', 'a')
      .send({ revision: 1, members: [{ ...members[1], displayName: '姓名修订', studentId: '' }] })
      .expect(200);
    expect(changed.body.data).toMatchObject({
      revision: 2,
      members: [{ id: members[1].id, displayName: '姓名修订' }],
    });
    expect(changed.body.data.members[0]).not.toHaveProperty('studentId');
  });

  it('denies cross-class reads/writes/history and never leaks rosters through the workspace DTO', async () => {
    const f = await fixture();
    await request(f.app)
      .post(`${base}/import`)
      .set('x-user', 'manager')
      .send({
        batches: [
          {
            classId: 'b',
            revision: 0,
            members: [{ displayName: 'B班私有姓名', studentId: 'B-private-id' }],
          },
        ],
      })
      .expect(200);
    for (const uid of ['a', 'ordinary', 'legacy']) {
      for (const url of [`${base}/b`, `${base}/b/history`]) {
        const denied = await request(f.app).get(url).set('x-user', uid).expect(403);
        expect(denied.headers['cache-control']).toBe('private, no-store');
        expect(denied.text).not.toMatch(/B-private-id|B班私有姓名/);
      }
      await request(f.app)
        .put(`${base}/b`)
        .set('x-user', uid)
        .send({ revision: 1, members: [] })
        .expect(403);
    }
    await request(f.app).get(`${base}/a`).set('x-user', 'legacy').expect(403);
    const workspace = await request(f.app).get('/org/workspace').set('x-user', 'a').expect(200);
    expect(workspace.body.data).not.toHaveProperty('classRosters');
    expect(workspace.text).not.toMatch(/B-private-id|B班私有姓名/);
    await request(f.app).get(`${base}/a`).set('x-user', 'anonymous').expect(401);
  });

  it('uses existing global visibility while limiting global maintenance/import to existing authorities', async () => {
    const f = await fixture();
    for (const uid of ['manager', 'department']) {
      const result = await request(f.app)
        .post(`${base}/import`)
        .set('x-user', uid)
        .send({
          batches: [{ classId: 'a', revision: uid === 'manager' ? 0 : 1, members: one(uid) }],
        })
        .expect(200);
      expect(result.body.data.items[0]).toMatchObject({ canEdit: true, canImport: true });
    }
    const globalRead = await request(f.app).get(`${base}/a`).set('x-user', 'counselor').expect(200);
    expect(globalRead.body.data).toMatchObject({ canEdit: false, canImport: false, revision: 2 });
    await request(f.app)
      .put(`${base}/a`)
      .set('x-user', 'counselor')
      .send({ revision: 2, members: [] })
      .expect(403);
    await request(f.app)
      .post(`${base}/import`)
      .set('x-user', 'a')
      .send({ batches: [{ classId: 'a', revision: 2, members: [] }] })
      .expect(403);
    for (const uid of ['preview-a', 'preview-manager']) {
      await request(f.app)
        .put(`${base}/a`)
        .set('x-user', uid)
        .send({ revision: 2, members: [] })
        .expect(403);
      await request(f.app)
        .post(`${base}/import`)
        .set('x-user', uid)
        .send({ batches: [{ classId: 'a', revision: 2, members: [] }] })
        .expect(403);
    }
    expect(
      (await request(f.app).get(`${base}/a`).set('x-user', 'preview-a').expect(200)).body.data
        .canEdit,
    ).toBe(false);
  });

  it('validates a whole import before replacing any class and guards each class revision', async () => {
    const f = await fixture();
    const first = await request(f.app)
      .post(`${base}/import`)
      .set('x-user', 'manager')
      .send({
        batches: [
          { classId: 'a', revision: 0, members: one() },
          { classId: 'b', revision: 0, members: [{ id: 'member-b', displayName: '乙' }] },
        ],
      })
      .expect(200);
    expect(first.body.data.items.map((row: { revision: number }) => row.revision)).toEqual([1, 1]);
    await request(f.app)
      .post(`${base}/import`)
      .set('x-user', 'manager')
      .send({
        batches: [
          { classId: 'a', revision: 1, members: [] },
          { classId: 'b', revision: 0, members: [] },
        ],
      })
      .expect(409);
    expect(
      (await request(f.app).get(`${base}/a`).set('x-user', 'a').expect(200)).body.data.revision,
    ).toBe(1);
    expect(
      (await request(f.app).get(`${base}/a/history`).set('x-user', 'a').expect(200)).body.data
        .items,
    ).toHaveLength(1);
    await request(f.app)
      .post(`${base}/import`)
      .set('x-user', 'manager')
      .send({
        batches: [
          { classId: 'a', revision: 1, members: [] },
          { classId: 'unconfigured', revision: 0, members: [] },
        ],
      })
      .expect(404);
    expect(
      (await request(f.app).get(`${base}/a`).set('x-user', 'a').expect(200)).body.data.members,
    ).toEqual(one());
    await request(f.app)
      .post(`${base}/import`)
      .set('x-user', 'manager')
      .send({
        batches: [
          { classId: 'a', revision: 1, members: [] },
          { classId: 'a', revision: 1, members: [] },
        ],
      })
      .expect(400);
  });

  it('rejects reused IDs across classes, duplicate IDs/student IDs, and cross-class fields', async () => {
    const f = await fixture();
    await request(f.app)
      .put(`${base}/a`)
      .set('x-user', 'a')
      .send({ revision: 0, members: one() })
      .expect(200);
    await request(f.app)
      .put(`${base}/b`)
      .set('x-user', 'manager')
      .send({ revision: 0, members: one() })
      .expect(400);
    for (const members of [
      [
        { id: 'duplicate', displayName: '甲' },
        { id: 'duplicate', displayName: '乙' },
      ],
      [
        { displayName: '甲', studentId: 'same' },
        { displayName: '乙', studentId: 'same' },
      ],
      [{ displayName: '甲', classId: 'b' }],
      [{ displayName: '同学\u0000甲' }],
    ])
      await request(f.app)
        .put(`${base}/a`)
        .set('x-user', 'a')
        .send({ revision: 1, members })
        .expect(400);
    await request(f.app)
      .put(`${base}/a`)
      .set('x-user', 'a')
      .send({ revision: 1, members: [] })
      .expect(200);
    await request(f.app)
      .put(`${base}/b`)
      .set('x-user', 'manager')
      .send({ revision: 0, members: one() })
      .expect(400);
  });

  it('serializes concurrent replacements and retains every successful snapshot without changing old activities', async () => {
    const f = await fixture();
    await f.storage.change(WORKSPACE_ID, (current) => {
      const state = current!;
      state.entries.push({
        id: 'old-entry',
        yearId: '2026-2027',
        versionId: state.versions[0]!.id,
        authorUid: 'a',
        authorName: '原作者',
        classId: 'a',
        participantCount: 1,
        participantNames: '当时记录的名字',
        activityTypeId: 'theme_day',
        activityDate: null,
        summary: '历史活动',
        difficulties: '',
        extraAnswers: {},
        photoIds: [],
        extraPhotoIds: [],
        locked: false,
        revision: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      return { record: state, result: null };
    });
    const results = await Promise.all([
      request(f.app)
        .put(`${base}/a`)
        .set('x-user', 'a')
        .send({ revision: 0, members: one('第一份') }),
      request(f.app)
        .put(`${base}/a`)
        .set('x-user', 'a')
        .send({ revision: 0, members: one('竞争份') }),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([200, 409]);
    const original = (await request(f.app).get(`${base}/a/history`).set('x-user', 'a').expect(200))
      .body.data.items[0];
    await request(f.app)
      .put(`${base}/a`)
      .set('x-user', 'a')
      .send({ revision: 1, members: [{ id: 'member-a', displayName: '后来改名' }] })
      .expect(200);
    const history = (await request(f.app).get(`${base}/a/history`).set('x-user', 'a').expect(200))
      .body.data.items;
    expect(history.map((row: { revision: number }) => row.revision)).toEqual([1, 2]);
    expect(history[0]).toEqual(original);
    expect(history[1].members[0].displayName).toBe('后来改名');
    expect((await f.storage.get(WORKSPACE_ID))!.entries[0]!.participantNames).toBe(
      '当时记录的名字',
    );
  });

  it('refreshes revoked shared secretary grants inside the write transaction', async () => {
    const f = await fixture();
    f.setAuthHook((uid, call) => {
      if (uid === 'a' && call === 2) f.actors.set('a', person('a'));
    });
    await request(f.app)
      .put(`${base}/a`)
      .set('x-user', 'a')
      .send({ revision: 0, members: one() })
      .expect(403);
    expect(f.authCalls.get('a')).toBe(2);
    expect((await f.storage.get(WORKSPACE_ID))!.classRosters).toBeUndefined();
  });

  it.each(['secretary', 'department'] as const)(
    'revalidates expiring %s authority after the authorization lookup',
    async (kind) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const started = Date.parse('2026-11-15T00:00:00Z');
      vi.setSystemTime(started);
      const f = await fixture();
      const uid = kind === 'secretary' ? 'a' : 'department';
      if (kind === 'secretary')
        f.actors.get(uid)!.tags[0]!.expiresAt = new Date(started + 1000).toISOString();
      else
        f.actors.set(uid, {
          ...f.actors.get(uid)!,
          roleScopes: [
            {
              subjectUid: uid,
              roleKey: 'youth_league.organization.member',
              scope: { type: 'department', id: 'youth_league.organization' },
              expiresAt: new Date(started + 1000).toISOString(),
            },
          ],
        });
      f.setAuthHook((actor, call) => {
        if (actor === uid && call === 2) vi.setSystemTime(started + 2000);
      });
      await request(f.app)
        .put(`${base}/a`)
        .set('x-user', uid)
        .send({ revision: 0, members: one() })
        .expect(403);
      expect((await f.storage.get(WORKSPACE_ID))!.classRosters).toBeUndefined();
    },
  );

  it('uses the current configured classes after waiting for the existing workspace lock', async () => {
    const f = await fixture();
    let unlock!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const update = f.storage.change(WORKSPACE_ID, async (current) => {
      entered();
      await blocked;
      current!.classes = current!.classes.filter((row) => row.id !== 'a');
      current!.members = [];
      return { record: current!, result: null };
    });
    await ready;
    const pending = request(f.app)
      .put(`${base}/a`)
      .set('x-user', 'a')
      .send({ revision: 0, members: one() })
      .then((response) => response);
    try {
      await vi.waitFor(() => expect(f.authCalls.get('a')).toBe(1));
    } finally {
      unlock();
    }
    await update;
    expect((await pending).status).toBe(403);
    expect((await f.storage.get(WORKSPACE_ID))!.classRosters).toBeUndefined();
  });
});
