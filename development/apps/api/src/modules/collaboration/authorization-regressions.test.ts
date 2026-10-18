import express from 'express';
import request from 'supertest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ReadStream } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import { createCollaborationRouter, manages } from './router.js';
import { createMaterialsRouter } from './materials.js';
import { featureStorage } from '../../core/database/feature-storage.js';
import type { CollaborationSpace } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'collaboration-authority-'));
  directories.push(directory);
  const store = createMemoryStore();
  const subject = await store.subjects.create({
    uid: 'owner',
    displayName: 'owner',
    avatarUrl: null,
    status: 'active',
    ownerUid: 'admin',
    scope: { type: 'public', id: '*' },
  });
  const assignment = await store.roleAssignments.create({
    subjectUid: subject.uid,
    roleKey: 'department.sports_member',
    expiresAt: null,
    status: 'active',
    ownerUid: 'admin',
    scope: { type: 'public', id: '*' },
  });
  // Deliberately reuse an authentication result. Each router request must recheck the live store.
  const cached = await loadAuthorizationContext(
    store,
    {
      uid: 'owner',
      displayName: 'owner',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
    },
    new Date(),
  );
  const app = express();
  let resumeMultipart!: () => void;
  const multipartStarted = new Promise<void>((resolve) => {
    resumeMultipart = resolve;
  });
  app.use((request, _response, next) => {
    if (request.is('multipart/form-data')) request.once('resume', resumeMultipart);
    next();
  });
  app.use(express.json());
  const options = {
    store,
    uploadDirectory: directory,
    authenticate: async () => ({ status: 200 as const, user: cached }),
  };
  app.use('/tools', createCollaborationRouter(options), createMaterialsRouter(options));
  app.use(
    (
      error: { status?: number; code?: string },
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      response.status(error.status ?? 500).json({ code: error.code });
    },
  );
  const create = async (teamId = 'team-basketball') =>
    (
      await request(app)
        .post('/tools')
        .send({ kind: 'attendance', title: 'Team training', teamId, status: 'published' })
        .expect(201)
    ).body.data;
  return { app, store, assignment, cached, create, directory, multipartStarted };
}

it('rechecks live team authority when the same actor is reused inside a mutation', async () => {
  const f = await fixture();
  const space = await f.create();
  expect(await manages(space, f.cached, f.store)).toBe(true);
  await f.store.roleAssignments.update(f.assignment.id, { status: 'archived' });
  expect(await manages(space, f.cached, f.store)).toBe(false);
});

it.each(['role', 'module', 'captain', 'department-revoked', 'department-current'] as const)(
  'denies a held multipart upload after %s revocation and leaves no attachment bytes',
  async (change) => {
    const f = await fixture();
    let captainId: string | undefined;
    if (change === 'captain') {
      await f.store.roleAssignments.update(f.assignment.id, { status: 'archived' });
      const captain = await f.store.tagAssignments.create({
        subjectUid: 'owner',
        tagKey: 'sports.team_captain',
        status: 'active',
        expiresAt: null,
        ownerUid: 'admin',
        scope: { type: 'sports_team', id: 'team-basketball' },
      });
      captainId = captain.id;
      Object.assign(f.cached, await loadAuthorizationContext(f.store, f.cached, new Date()));
    }
    const space = change.startsWith('department-')
      ? (
          await request(f.app)
            .post('/tools')
            .send({
              kind: 'materials',
              title: 'Department materials',
              departmentId: 'student_union.sports_center',
              status: 'published',
            })
            .expect(201)
        ).body.data
      : await f.create();
    const submitted = (
      await request(f.app)
        .post(`/tools/${space.id}/entries`)
        .send({ revision: 1, text: 'Participant record' })
        .expect(200)
    ).body.data;
    const storage = featureStorage<CollaborationSpace>(f.directory, 'collaboration');
    await storage.change(space.id, (current) => {
      current!.entries[0]!.uid = 'another-participant';
      return { record: current!, result: null };
    });
    const uploadBody = new PassThrough();
    const pending = request(f.app)
      .post(`/tools/${space.id}/entries/${submitted.entries[0].id}/files`)
      .field('revision', '2')
      // Superagent supports readable streams; its types only declare filesystem streams.
      .attach('files', uploadBody as unknown as ReadStream, {
        filename: 'held.txt',
        contentType: 'text/plain',
      })
      .then((result) => result);
    // Multer resumes the incoming body only after the actual access preflight completes.
    await f.multipartStarted;
    if (change === 'role' || change === 'department-revoked')
      await f.store.roleAssignments.update(f.assignment.id, { status: 'archived' });
    if (change === 'captain')
      await f.store.tagAssignments.update(captainId!, { status: 'archived' });
    if (change === 'module') {
      const module = (await f.store.modules.list()).find((row) => row.moduleId === 'sports')!;
      await f.store.modules.update(module.id, { enabled: false });
    }
    uploadBody.end('must not be persisted');
    const result = await pending;
    expect(result.status).toBe(change === 'department-current' ? 200 : 403);
    const current = await storage.get(space.id);
    expect(current!.revision).toBe(change === 'department-current' ? 3 : 2);
    if (change === 'department-current') {
      expect(current!.entries[0]!.files).toHaveLength(1);
      return;
    }
    expect(current!.entries[0]!.files).toEqual([]);
    expect(
      await readdir(join(f.directory, 'collaboration-assets')).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return [];
          throw error;
        },
      ),
    ).toEqual([]);
  },
);

it('passes the authoritative store through the app materials mount for team managers', async () => {
  const f = await fixture();
  const space = await f.create();
  const app = createApp({
    store: f.store,
    authMode: 'main',
    previewAllowedUids: ['owner'],
    collectionsUploadDirectory: f.directory,
    authClient: { introspect: async () => f.cached },
  });
  await request(app)
    .get(`/api/development/v1/collaboration/${space.id}/export`)
    .set('Authorization', 'Bearer owner')
    .expect(200);
});

it('protects legacy definitions and initializes their version before independent submissions', async () => {
  const f = await fixture();
  const space = (
    await request(f.app)
      .post('/tools')
      .send({ kind: 'materials', title: 'Legacy materials', status: 'published' })
      .expect(201)
  ).body.data as CollaborationSpace;
  delete space.definitionRevision;
  space.revision = 10;
  await featureStorage<CollaborationSpace>(f.directory, 'collaboration').change(space.id, () => ({
    record: space,
    result: null,
  }));
  await request(f.app)
    .post(`/tools/${space.id}/entries`)
    .send({ revision: 1, text: 'Stale requirements' })
    .expect(409);
  const first = (
    await request(f.app)
      .post(`/tools/${space.id}/entries`)
      .send({ revision: 10, text: 'First participant' })
      .expect(200)
  ).body.data;
  expect(first.definitionRevision).toBe(10);
  const second = (
    await request(f.app)
      .post(`/tools/${space.id}/entries`)
      .send({ revision: 10, definitionRevision: 10, text: 'Second participant' })
      .expect(200)
  ).body.data;
  expect(second.revision).toBe(12);
});

it.each([
  'revoked',
  'expired',
  'role-disabled',
  'module-disabled',
  'permission-disabled',
  'deny',
] as const)(
  'revokes all team management and archive access after %s authority changes',
  async (change) => {
    const f = await fixture();
    const space = await f.create();
    await request(f.app).get(`/tools/${space.id}/export`).expect(200);
    if (change === 'revoked')
      await f.store.roleAssignments.update(f.assignment.id, { status: 'archived' });
    if (change === 'expired')
      await f.store.roleAssignments.update(f.assignment.id, { expiresAt: '2020-01-01T00:00:00Z' });
    if (change === 'role-disabled') {
      const role = (await f.store.roles.list()).find(
        (row) => row.key === 'department.sports_member',
      )!;
      await f.store.roles.update(role.id, { status: 'archived' });
    }
    if (change === 'module-disabled') {
      const module = (await f.store.modules.list()).find((row) => row.moduleId === 'sports')!;
      await f.store.modules.update(module.id, { enabled: false });
    }
    if (change === 'permission-disabled') {
      const permission = (await f.store.permissions.list()).find(
        (row) => row.action === 'sports.showcase.update' && row.resource === 'sports_showcase',
      )!;
      await f.store.permissions.update(permission.id, { status: 'archived' });
    }
    if (change === 'deny')
      await f.store.rolePermissions.create({
        roleKey: 'department.sports_member',
        action: 'sports.showcase.update',
        resource: 'sports_showcase',
        effect: 'deny',
        status: 'active',
        ownerUid: 'admin',
        scope: { type: 'public', id: '*' },
      });
    expect((await request(f.app).get(`/tools/${space.id}`).expect(200)).body.data.canManage).toBe(
      false,
    );
    await request(f.app)
      .patch(`/tools/${space.id}`)
      .send({ revision: 1, title: 'Unauthorized edit' })
      .expect(403);
    await request(f.app).get(`/tools/${space.id}/export`).expect(403);
    await request(f.app)
      .post('/tools')
      .send({
        kind: 'attendance',
        title: 'Unauthorized create',
        teamId: 'team-basketball',
        status: 'published',
      })
      .expect(403);
  },
);

it('refuses a nonexistent team even for an otherwise authorized sports member', async () => {
  const f = await fixture();
  await request(f.app)
    .post('/tools')
    .send({
      kind: 'attendance',
      title: 'Missing team',
      teamId: 'missing-team',
      status: 'published',
    })
    .expect(403);
});

it('keeps captain creation discoverable only while the exact team assignment is live', async () => {
  const f = await fixture();
  await f.store.roleAssignments.update(f.assignment.id, { status: 'archived' });
  f.cached.roles = [];
  const assignment = await f.store.tagAssignments.create({
    subjectUid: 'owner',
    tagKey: 'sports.team_captain',
    expiresAt: null,
    status: 'active',
    ownerUid: 'admin',
    scope: { type: 'sports_team', id: 'team-basketball' },
  });
  Object.assign(f.cached, await loadAuthorizationContext(f.store, f.cached, new Date()));
  f.cached.roles = [];
  expect((await request(f.app).get('/tools').expect(200)).body.data.canCreate).toBe(true);
  const space = await f.create();
  await request(f.app)
    .post('/tools')
    .send({ kind: 'attendance', title: 'Other team', teamId: 'team-football', status: 'published' })
    .expect(403);
  await f.store.tagAssignments.update(assignment.id, { status: 'archived' });
  expect((await request(f.app).get('/tools').expect(200)).body.data.canCreate).toBe(false);
  await request(f.app)
    .patch(`/tools/${space.id}`)
    .send({ revision: 1, title: 'Revoked captain' })
    .expect(403);
});

it('omits participant contents and history from the space directory', async () => {
  const f = await fixture();
  const space = (
    await request(f.app)
      .post('/tools')
      .send({ kind: 'materials', title: 'Directory', status: 'published' })
      .expect(201)
  ).body.data;
  await request(f.app)
    .post(`/tools/${space.id}/entries`)
    .send({ revision: 1, text: 'Private entry body' })
    .expect(200);
  const item = (await request(f.app).get('/tools').expect(200)).body.data.items[0];
  expect(item.entries).toEqual([]);
  expect(item.history).toEqual([]);
  expect(JSON.stringify(item)).not.toContain('Private entry body');
});

it('checks the target department in addition to the current department', async () => {
  const f = await fixture();
  const space = (
    await request(f.app)
      .post('/tools')
      .send({
        kind: 'materials',
        title: 'Sports materials',
        departmentId: 'student_union.sports_center',
        status: 'published',
      })
      .expect(201)
  ).body.data;
  await request(f.app)
    .patch(`/tools/${space.id}`)
    .send({ revision: 1, departmentId: 'student_union.arts_center' })
    .expect(403);
  await request(f.app)
    .patch(`/tools/${space.id}`)
    .send({ revision: 1, title: 'Own department' })
    .expect(200);
});

it('rejects a move to a department whose assignment was revoked after authentication', async () => {
  const f = await fixture();
  const arts = await f.store.roleAssignments.create({
    subjectUid: 'owner',
    roleKey: 'department.arts_member',
    status: 'active',
    expiresAt: null,
    ownerUid: 'admin',
    scope: { type: 'public', id: '*' },
  });
  Object.assign(f.cached, await loadAuthorizationContext(f.store, f.cached, new Date()));
  const space = (
    await request(f.app)
      .post('/tools')
      .send({
        kind: 'materials',
        title: 'Scoped material',
        departmentId: 'student_union.sports_center',
        status: 'published',
      })
      .expect(201)
  ).body.data;
  await f.store.roleAssignments.update(arts.id, { status: 'archived' });
  await request(f.app)
    .patch(`/tools/${space.id}`)
    .send({ revision: 1, departmentId: 'student_union.arts_center' })
    .expect(403);
});

it('enforces restricted material fields for ordinary participants', async () => {
  const f = await fixture();
  const space = (
    await request(f.app)
      .post('/tools')
      .send({
        kind: 'materials',
        title: 'Restricted materials',
        status: 'published',
        columns: [
          { id: 'approval', label: 'Approval', kind: 'text', editRoleKeys: ['counselor.practice'] },
        ],
      })
      .expect(201)
  ).body.data;
  f.cached.uid = 'participant';
  f.cached.roles = [];
  await request(f.app)
    .post(`/tools/${space.id}/entries`)
    .send({ revision: 1, text: 'Submission', values: { approval: 'Forged approval' } })
    .expect(403);
  await request(f.app)
    .post(`/tools/${space.id}/entries`)
    .send({ revision: 1, text: 'Submission', values: {} })
    .expect(200);
});

it('retains explicit counselor review assignments without granting general management', async () => {
  const f = await fixture();
  const space = (
    await request(f.app)
      .post('/tools')
      .send({
        kind: 'review',
        title: 'Scoped review',
        departmentId: 'student_union.sports_center',
        status: 'published',
        stages: [{ title: 'Counselor', roleKeys: ['counselor.practice'] }],
      })
      .expect(201)
  ).body.data;
  f.cached.uid = 'participant';
  f.cached.roles = [];
  const submitted = (
    await request(f.app)
      .post(`/tools/${space.id}/entries`)
      .send({ revision: 1, text: 'Review material' })
      .expect(200)
  ).body.data;
  f.cached.uid = 'counselor';
  f.cached.roles = ['counselor.practice'];
  await f.store.subjects.create({
    uid: 'counselor',
    displayName: 'Counselor',
    avatarUrl: null,
    status: 'active',
    ownerUid: 'admin',
    scope: { type: 'public', id: '*' },
  });
  await f.store.roleAssignments.create({
    subjectUid: 'counselor',
    roleKey: 'counselor.practice',
    status: 'active',
    expiresAt: null,
    ownerUid: 'admin',
    scope: { type: 'public', id: '*' },
  });
  const visible = (await request(f.app).get(`/tools/${space.id}`).expect(200)).body.data;
  expect(visible.canManage).toBe(false);
  expect(visible.entries[0].canReview).toBe(true);
  await request(f.app)
    .post(`/tools/${space.id}/entries/${submitted.entries[0].id}/review`)
    .send({ revision: 2, decision: 'approved' })
    .expect(200);
});
