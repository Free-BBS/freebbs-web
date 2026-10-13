import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoleKey, ScopeRef, UserContext } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';
import { loadAuthorizationContext } from '../../core/authorization/load-authorization-context.js';
import { canMaintainSportsCard } from './card-authorization.js';

const base = '/api/development/v1/sports';
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'sports-home-'));
  directories.push(directory);
  const store = createMemoryStore();
  const uids = [
    'member',
    'director',
    'sports-lead',
    'lead',
    'admin',
    'captain',
    'student',
    'scoped-admin',
    'scoped-member',
    'expired',
  ];
  const identities = Object.fromEntries(
    uids.map((uid) => [
      uid,
      {
        uid,
        displayName: uid,
        avatarUrl: null,
        baseRole: 'student',
        roles: [],
        tags: [],
      } satisfies UserContext,
    ]),
  );
  async function role(
    uid: string,
    roleKey: RoleKey,
    scope: ScopeRef = { type: 'public', id: '*' },
    expiresAt: string | null = null,
  ) {
    return store.roleAssignments.create({
      subjectUid: uid,
      roleKey,
      scope,
      expiresAt,
      status: 'active',
      ownerUid: 'admin',
    });
  }
  await role('member', 'department.sports_member');
  await role('director', 'department.sports_director');
  await role('sports-lead', 'domain.sports_lead');
  await role('admin', 'platform.admin');
  await role('scoped-admin', 'platform.admin', { type: 'sports_team', id: 'team-basketball' });
  await role('scoped-member', 'department.sports_member', {
    type: 'sports_team',
    id: 'team-basketball',
  });
  await role(
    'expired',
    'department.sports_member',
    { type: 'public', id: '*' },
    '2020-01-01T00:00:00Z',
  );
  await store.developmentAccess.create({
    subjectUid: 'lead',
    studentId: null,
    username: null,
    accessLevel: 'lead',
    status: 'active',
    ownerUid: 'admin',
    scope: { type: 'public', id: '*' },
  });
  await store.tagAssignments.create({
    subjectUid: 'captain',
    tagKey: 'sports.team_captain',
    expiresAt: null,
    status: 'active',
    ownerUid: 'admin',
    scope: { type: 'sports_team', id: 'team-basketball' },
  });
  const options = {
    store,
    authMode: 'main' as const,
    previewAllowedUids: uids,
    collectionsUploadDirectory: directory,
    authClient: { introspect: async (token: string) => identities[token] ?? null },
  };
  return { app: createApp(options), store, options };
}
const identity = (uid: string) => ({ Authorization: `Bearer ${uid}` });

describe('sports card maintenance with authoritative HTTP identities', () => {
  it.each(['member', 'director', 'sports-lead', 'lead', 'admin'])(
    'allows %s to create, edit and maintain status',
    async (uid) => {
      const { app } = await fixture();
      const capabilities = await request(app)
        .get(`${base}/capabilities`)
        .set(identity(uid))
        .expect(200);
      expect(capabilities.body.data.canCreate).toBe(true);
      const created = await request(app)
        .post(`${base}/teams`)
        .set(identity(uid))
        .send({ name: '游泳队', description: '游泳代表队' })
        .expect(201);
      expect(created.body.data.canEditCard).toBe(true);
      await request(app)
        .patch(`${base}/teams`)
        .set(identity(uid))
        .send({ id: created.body.data.id, name: '新游泳队' })
        .expect(200);
      await request(app)
        .post(`${base}/teams/${created.body.data.id}/transitions`)
        .set(identity(uid))
        .send({ to: 'active' })
        .expect(200);
    },
  );
  it('allows exact captain card edits and rejects other-team writes and creation', async () => {
    const { app } = await fixture();
    await request(app)
      .patch(`${base}/teams`)
      .set(identity('captain'))
      .send({ id: 'team-basketball', description: '队长更新' })
      .expect(200);
    await request(app)
      .patch(`${base}/teams`)
      .set(identity('captain'))
      .send({ id: 'team-badminton', description: '越权更新' })
      .expect(403);
    await request(app)
      .post(`${base}/teams`)
      .set(identity('captain'))
      .send({ name: '别队', description: '不可创建' })
      .expect(403);
    await request(app)
      .post(`${base}/teams/team-basketball/captains`)
      .set(identity('captain'))
      .send({ memberUid: 'demo-student' })
      .expect(404);
  });
  it.each(['student', 'expired', 'scoped-admin', 'scoped-member'])(
    'does not turn %s into a global card manager',
    async (uid) => {
      const { app } = await fixture();
      expect(
        (await request(app).get(`${base}/capabilities`).set(identity(uid)).expect(200)).body.data
          .canCreate,
      ).toBe(false);
      await request(app)
        .post(`${base}/teams`)
        .set(identity(uid))
        .send({ name: '越权', description: '不可创建' })
        .expect(403);
      await request(app)
        .patch(`${base}/teams`)
        .set(identity(uid))
        .send({ id: 'team-badminton', name: '越权' })
        .expect(403);
    },
  );
  it('never extends card-only development lead authority to captain appointment or roster', async () => {
    const { app } = await fixture();
    await request(app)
      .post(`${base}/teams/team-basketball/captains`)
      .set(identity('lead'))
      .send({ memberUid: 'demo-student' })
      .expect(404);
    await request(app)
      .post(`${base}/teams/team-basketball/members`)
      .set(identity('member'))
      .send({ memberUid: 'demo-student' })
      .expect(404);
    await request(app)
      .get(`${base}/teams/team-basketball/checkins`)
      .set(identity('lead'))
      .expect(404);
  });
  it('honours explicit denies at the sports department assignment scope', async () => {
    const { app, store } = await fixture();
    const member = (await store.roleAssignments.list({ query: 'member' })).find(
      ({ subjectUid }) => subjectUid === 'member',
    )!;
    await store.roleAssignments.update(member.id, {
      scope: { type: 'department', id: 'student_union.sports_center' },
    });
    await store.rolePermissions.create({
      roleKey: 'department.sports_member',
      action: 'sports.team.update',
      resource: 'sports_team',
      effect: 'deny',
      status: 'active',
      ownerUid: 'admin',
      scope: { type: 'public', id: '*' },
    });
    await request(app)
      .patch(`${base}/teams`)
      .set(identity('member'))
      .send({ id: 'team-basketball', name: 'Denied' })
      .expect(403);
  });
  it('does not revive a disabled governed card binding', async () => {
    const { app, store } = await fixture();
    for (const binding of await store.rolePermissions.list()) {
      if (
        binding.roleKey === 'department.sports_director' &&
        binding.action === 'sports.team.update'
      )
        await store.rolePermissions.update(binding.id, { status: 'archived' });
    }
    await request(app)
      .patch(`${base}/teams`)
      .set(identity('director'))
      .send({ id: 'team-basketball', name: 'Disabled' })
      .expect(403);
  });
  it('rechecks a formerly global admin assignment before granting card access', async () => {
    const { app, store } = await fixture();
    await request(app).get(`${base}/teams`).set(identity('admin')).expect(200);
    const actor = await loadAuthorizationContext(
      store,
      {
        uid: 'admin',
        displayName: 'Admin',
        avatarUrl: null,
        baseRole: 'student',
        roles: [],
        tags: [],
      },
      new Date(),
    );
    const assignment = (await store.roleAssignments.list({ query: 'admin' })).find(
      ({ subjectUid, roleKey }) => subjectUid === 'admin' && roleKey === 'platform.admin',
    )!;
    await store.roleAssignments.update(assignment.id, { status: 'archived' });
    expect(await canMaintainSportsCard(store, actor, 'team-basketball')).toBe(false);
  });
  it('preserves disabled showcase permissions and captain bindings when enabling card collaboration', async () => {
    const { app, store } = await fixture();
    const permission = (await store.permissions.list()).find(
      ({ action, resource }) =>
        action === 'sports.showcase.update' && resource === 'sports_showcase',
    )!;
    await store.permissions.update(permission.id, { status: 'archived' });
    await request(app)
      .put(`${base}/teams/team-basketball/showcase`)
      .set(identity('lead'))
      .send({ markdown: '# 禁用' })
      .expect(403);
    await store.permissions.update(permission.id, { status: 'active' });
    for (const binding of await store.tagPermissions.list()) {
      if (binding.tagKey === 'sports.team_captain' && binding.action === 'sports.showcase.update')
        await store.tagPermissions.update(binding.id, { status: 'archived' });
    }
    await request(app)
      .put(`${base}/teams/team-basketball/showcase`)
      .set(identity('captain'))
      .send({ markdown: '# 禁用' })
      .expect(403);
  });
});
describe('durable sports HTML homepages', () => {
  it('uses the existing collections default directory in development while missing production storage stays feature-only', async () => {
    const { store, options } = await fixture();
    const created = await store.sportsTeams.create({
      name: '未配置首页',
      description: '测试',
      status: 'active',
      ownerUid: 'admin',
      scope: { type: 'sports_team', id: 'pending' },
    });
    await store.sportsTeams.update(created.id, { scope: { type: 'sports_team', id: created.id } });
    const unconfigured = { ...options, collectionsUploadDirectory: undefined };
    await request(createApp(unconfigured))
      .get(`${base}/teams/${created.id}/homepage`)
      .set(identity('student'))
      .expect(200);
    const production = createApp({
      ...unconfigured,
      environment: { NODE_ENV: 'production', AUTH_MODE: 'main' },
    });
    await request(production)
      .get(`${base}/teams/${created.id}/homepage`)
      .set(identity('student'))
      .expect(503);
    await request(production).get('/api/development/v1/ready').expect(200);
  });
  it.each(['member', 'director', 'sports-lead', 'lead', 'admin'])(
    'allows %s HTML homepage maintenance',
    async (uid) => {
      const { app } = await fixture();
      await request(app)
        .put(`${base}/teams/team-basketball/homepage`)
        .set(identity(uid))
        .field('revision', '0')
        .attach('file', Buffer.from('<h1>授权首页</h1>'), 'index.html')
        .expect(200);
    },
  );
  it('serializes simultaneous replacements so only one writer can use a revision', async () => {
    const { app } = await fixture();
    const path = `${base}/teams/team-basketball/homepage`;
    const results = await Promise.all(
      ['A', 'B'].map((text) =>
        request(app)
          .put(path)
          .set(identity('member'))
          .field('revision', '0')
          .attach('file', Buffer.from(`<h1>${text}</h1>`), 'index.html'),
      ),
    );
    expect(results.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(
      (await request(app).get(path).set(identity('student')).expect(200)).body.data.revision,
    ).toBe(1);
  });
  it('uploads a complete UTF-8 document, reads it after app restart, and audits replace/delete with revisions', async () => {
    const { app, store, options } = await fixture();
    const path = `${base}/teams/team-basketball/homepage`;
    const html =
      '<!doctype html><html><head><style>body{color:red}</style></head><body><h1>篮球队</h1><script>parent.document.title="attack"</script></body></html>';
    const uploaded = await request(app)
      .put(path)
      .set(identity('captain'))
      .field('revision', '0')
      .attach('file', Buffer.from(html), '代表队-é.html')
      .expect(200);
    expect(uploaded.body.data).toMatchObject({
      html,
      originalFilename: '代表队-é.html',
      revision: 1,
      canEdit: true,
    });
    expect(
      (await request(createApp(options)).get(path).set(identity('student')).expect(200)).body.data,
    ).toMatchObject({ html, canEdit: false, revision: 1 });
    await request(app)
      .put(path)
      .set(identity('captain'))
      .field('revision', '0')
      .attach('file', Buffer.from('<h1>stale</h1>'), 'index.htm')
      .expect(409);
    await request(app).delete(path).set(identity('captain')).send({ revision: 0 }).expect(409);
    await request(app).delete(path).set(identity('captain')).send({ revision: 1 }).expect(200);
    expect(
      (await request(app).get(path).set(identity('student')).expect(200)).body.data,
    ).toMatchObject({ html: null, revision: 2 });
    expect(await store.auditLogs.list({ query: 'team-basketball' })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'sports.team.homepage_updated' }),
        expect.objectContaining({ action: 'sports.team.homepage_deleted' }),
      ]),
    );
  });
  it.each(['student', 'expired', 'scoped-admin'])(
    'rejects %s uploads to another team before parsing files',
    async (uid) => {
      const { app } = await fixture();
      await request(app)
        .put(`${base}/teams/team-badminton/homepage`)
        .set(identity(uid))
        .field('revision', '0')
        .attach('file', Buffer.from('<h1>bad</h1>'), 'index.html')
        .expect(403);
    },
  );
  it('validates file type, encoding, binary/empty content and size without replacing a valid page', async () => {
    const { app } = await fixture();
    const path = `${base}/teams/team-basketball/homepage`;
    for (const [buffer, filename, status] of [
      [Buffer.from('<h1>x</h1>'), 'bad.txt', 400],
      [Buffer.from([0xff, 0xfe]), 'bad.html', 400],
      [Buffer.from('a\0b'), 'bad.html', 400],
      [Buffer.from(' '), 'bad.html', 400],
      [Buffer.alloc(5 * 1024 * 1024 + 1, 65), 'big.html', 413],
    ] as const) {
      await request(app)
        .put(path)
        .set(identity('member'))
        .field('revision', '0')
        .attach('file', buffer, filename)
        .expect(status);
    }
    expect(
      (await request(app).get(path).set(identity('member')).expect(200)).body.data.revision,
    ).toBe(0);
  });
  it('rejects malformed team scope and expired or wildcard captain tags', async () => {
    const { app, store } = await fixture();
    const tag = (await store.tagAssignments.list({ query: 'captain' })).find(
      ({ subjectUid }) => subjectUid === 'captain',
    )!;
    await store.tagAssignments.update(tag.id, { scope: { type: 'sports_team', id: '*' } });
    await request(app)
      .put(`${base}/teams/team-basketball/homepage`)
      .set(identity('captain'))
      .field('revision', '0')
      .attach('file', Buffer.from('<h1>x</h1>'), 'index.html')
      .expect(403);
    await store.sportsTeams.update('team-basketball', {
      scope: { type: 'sports_team', id: 'team-badminton' },
    });
    await request(app)
      .get(`${base}/teams/team-basketball/homepage`)
      .set(identity('admin'))
      .expect(404);
  });
});
