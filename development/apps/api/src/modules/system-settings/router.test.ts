import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoleKey } from '@freebbs-development/contracts';
import { createApp, type CreateAppOptions } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const roots: string[] = [];
const base = '/api/development/v1';
const scope = { type: 'public', id: '*' } as const;
async function fixture(extra: Partial<CreateAppOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'development-settings-'));
  roots.push(root);
  const store = createMemoryStore();
  const users = ['lead', 'admin', 'member', 'target'].map((uid, index) => ({
    uid,
    username: uid,
    displayName: uid,
    studentId: `202300000${index}`,
    avatarUrl: null,
  }));
  for (const user of users) {
    await store.developmentAccess.create({
      subjectUid: user.uid,
      studentId: user.studentId,
      username: user.username,
      accessLevel: user.uid === 'lead' ? 'lead' : 'member',
      status: 'active',
      ownerUid: 'lead',
      scope,
    });
    await store.subjects.create({
      uid: user.uid,
      displayName: user.displayName,
      avatarUrl: null,
      status: 'active',
      ownerUid: 'lead',
      scope,
    });
  }
  for (const [subjectUid, roleKey] of [
    ['lead', 'platform.super_admin'],
    ['admin', 'platform.admin'],
  ] as [string, RoleKey][]) {
    await store.roleAssignments.create({
      subjectUid,
      roleKey,
      expiresAt: null,
      status: 'active',
      ownerUid: 'lead',
      scope,
    });
  }
  const app = createApp({
    store,
    authMode: 'main',
    collectionsUploadDirectory: root,
    authClient: {
      introspect: async (token) => {
        const user = users.find((user) => user.uid === token);
        return user ? { ...user, baseRole: 'student', roles: [], tags: [] } : null;
      },
    },
    userDirectory: {
      list: async (query) => users.filter((user) => !query || user.uid.includes(query)),
      get: async (uid) => users.find((user) => user.uid === uid) ?? null,
    },
    ...extra,
  });
  return { app, store, root };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('development system settings boundaries', () => {
  it('allows administrator-only settings and refuses member, lead, and reserved administration', async () => {
    const { app } = await fixture();
    for (const uid of ['member', 'lead'])
      await request(app)
        .get(`${base}/system-settings`)
        .set('Authorization', `Bearer ${uid}`)
        .expect(403);
    const result = await request(app)
      .get(`${base}/system-settings`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(result.body.data.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uid: 'target', revision: expect.any(String) }),
      ]),
    );
    await request(app)
      .get(`${base}/admin/subjects`)
      .set('Authorization', 'Bearer admin')
      .expect(403);
    await request(app)
      .get(`${base}/me`)
      .set('Authorization', 'Bearer admin')
      .set('X-Development-Preview-Uid', 'target')
      .expect(200);
  });
  it('assigns business identities atomically with revision and before/after audit, never access or reserved role', async () => {
    const { app, store } = await fixture();
    const users = await request(app)
      .get(`${base}/system-settings/users`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    const revision = users.body.data.find(
      (user: { uid: string }) => user.uid === 'target',
    ).revision;
    const input = {
      revision,
      roles: ['department.sports_member', 'platform.admin'],
      captainTeamIds: ['team-basketball'],
    };
    const result = await request(app)
      .put(`${base}/system-settings/users/target`)
      .set('Authorization', 'Bearer admin')
      .send(input)
      .expect(200);
    expect(result.body.data.roles).toEqual(input.roles);
    expect((await store.developmentAccess.list({ query: 'target' }))[0]?.accessLevel).toBe(
      'member',
    );
    await request(app)
      .put(`${base}/system-settings/users/target`)
      .set('Authorization', 'Bearer admin')
      .send(input)
      .expect(409);
    const logs = await store.auditLogs.list({ query: 'system_settings.user.update' });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.details).toMatchObject({
      previous: { roles: [] },
      next: { roles: input.roles },
    });
    for (const extra of [{ accessLevel: 'lead' }, { roles: ['platform.super_admin'] }]) {
      await request(app)
        .put(`${base}/system-settings/users/target`)
        .set('Authorization', 'Bearer admin')
        .send({ ...input, revision: result.body.data.revision, ...extra })
        .expect(400);
    }
    expect(await store.auditLogs.list({ query: 'system_settings.user.update' })).toHaveLength(1);
  });
  it('keeps lead access writes strict and prevents demoting the last lead', async () => {
    const { app, store } = await fixture();
    await request(app)
      .put(`${base}/admin/development-users/target`)
      .set('Authorization', 'Bearer lead')
      .send({ accessLevel: 'lead', roles: ['platform.admin'] })
      .expect(400);
    await request(app)
      .put(`${base}/admin/development-users/lead`)
      .set('Authorization', 'Bearer lead')
      .send({ accessLevel: 'member' })
      .expect(409);
    await request(app)
      .put(`${base}/admin/development-users/target`)
      .set('Authorization', 'Bearer lead')
      .send({ accessLevel: 'lead' })
      .expect(200);
    expect(
      (await store.roleAssignments.list({ query: 'target' })).map((row) => row.roleKey),
    ).toEqual(['platform.super_admin']);
    await request(app)
      .post(`${base}/admin/role-assignments`)
      .set('Authorization', 'Bearer lead')
      .send({ subjectUid: 'target', roleKey: 'platform.admin' })
      .expect(403);
  });
  it('protects the last explicit platform administrator without elevating a lead', async () => {
    const { app, store } = await fixture();
    // Demo seed includes an unrelated administrator; remove it for this real-access test.
    for (const assignment of await store.roleAssignments.list())
      if (assignment.subjectUid === 'demo-admin' && assignment.roleKey === 'platform.admin')
        await store.roleAssignments.delete(assignment.id);
    const users = await request(app)
      .get(`${base}/system-settings/users`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    const revision = users.body.data.find((user: { uid: string }) => user.uid === 'admin').revision;
    await request(app)
      .put(`${base}/system-settings/users/admin`)
      .set('Authorization', 'Bearer admin')
      .send({ revision, roles: [], captainTeamIds: [] })
      .expect(409);
    expect(
      (await store.roleAssignments.list({ query: 'lead' })).some(
        (row) => row.roleKey === 'platform.admin',
      ),
    ).toBe(false);
  });
  it('protects the last administrator through legacy combined-role assignment and role-status routes', async () => {
    const store = createMemoryStore();
    await store.developmentAccess.create({
      subjectUid: 'demo-admin',
      studentId: null,
      username: 'demo-admin',
      accessLevel: 'lead',
      status: 'active',
      ownerUid: 'demo-admin',
      scope,
    });
    const app = createApp({ store, authMode: 'demo' });
    const assignment = (await store.roleAssignments.list()).find(
      (row) => row.subjectUid === 'demo-admin' && row.roleKey === 'platform.admin',
    )!;
    await request(app)
      .delete(`${base}/admin/role-assignments/${assignment.id}`)
      .set('X-Demo-User', 'demo-admin')
      .expect(409);
    await request(app)
      .patch(`${base}/admin/roles/platform.admin`)
      .set('X-Demo-User', 'demo-admin')
      .send({ status: 'inactive' })
      .expect(409);
    expect((await store.roleAssignments.get(assignment.id))?.status).toBe('active');
  });
  it('deduplicates isolated notification publishing, checks trusted recipients, and marks only own inbox', async () => {
    const { app } = await fixture();
    const input = { requestId: 'notice-1', title: '通知', body: '内容', recipientUids: ['member'] };
    const first = await request(app)
      .post(`${base}/system-settings/notifications`)
      .set('Authorization', 'Bearer admin')
      .send(input)
      .expect(201);
    const replay = await request(app)
      .post(`${base}/system-settings/notifications`)
      .set('Authorization', 'Bearer admin')
      .send(input)
      .expect(200);
    expect(replay.body.data).toMatchObject({ id: first.body.data.id, replayed: true });
    await request(app)
      .post(`${base}/system-settings/notifications`)
      .set('Authorization', 'Bearer admin')
      .send({ ...input, body: 'changed' })
      .expect(409);
    await request(app)
      .post(`${base}/system-settings/notifications`)
      .set('Authorization', 'Bearer admin')
      .send({ ...input, requestId: 'invalid', recipientUids: ['unknown'] })
      .expect(400);
    const inbox = await request(app)
      .get(`${base}/notifications`)
      .set('Authorization', 'Bearer member')
      .expect(200);
    expect(inbox.body.data).toHaveLength(1);
    await request(app)
      .post(`${base}/notifications/${first.body.data.id}/read`)
      .set('Authorization', 'Bearer target')
      .expect(404);
    await request(app)
      .post(`${base}/notifications/${first.body.data.id}/read`)
      .set('Authorization', 'Bearer member')
      .expect(200);
    const count = await request(app)
      .get(`${base}/notifications/unread-count`)
      .set('Authorization', 'Bearer member')
      .expect(200);
    expect(count.body.data).toEqual({ unreadCount: 0 });
  });
  it('fails closed without a real reward provider', async () => {
    const { app } = await fixture();
    await request(app)
      .post(`${base}/system-settings/rewards`)
      .set('Authorization', 'Bearer admin')
      .send({
        requestId: 'reward-1',
        recipientUids: ['member'],
        title: '奖励',
        reason: '活动',
        electric: 1,
        magnetic: 0,
      })
      .expect(503);
  });
  it('rejects legacy lead wildcard business policies while giving explicitly assigned administrators scoped finance access', async () => {
    const { app, store } = await fixture();
    await store.rolePermissions.create({
      roleKey: 'platform.super_admin',
      action: '*',
      resource: '*',
      effect: 'allow',
      status: 'active',
      ownerUid: 'legacy',
      scope,
    });
    await request(app)
      .get(`${base}/finance/records`)
      .set('Authorization', 'Bearer lead')
      .expect(403);
    await request(app)
      .get(`${base}/finance/records`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    await request(app)
      .post(`${base}/finance/records`)
      .set('Authorization', 'Bearer admin')
      .send({
        title: '跨组织预算',
        kind: 'budget',
        amountCents: 100,
        organizationId: 'sports_center',
        scope: { type: 'social_organization', id: 'sports_center' },
      })
      .expect(201);
    await request(app)
      .get(`${base}/admin/role-assignments`)
      .set('Authorization', 'Bearer admin')
      .expect(403);
  });
  it('allows platform admin to manage cross-owner collections and refuses lead-only business creation', async () => {
    const { app, store } = await fixture();
    const schema = {
      title: '草稿',
      description: '',
      fields: [
        { id: 'note', kind: 'short_text', label: '备注', helpText: '', options: [], rules: [] },
      ],
      formRules: [],
      outputs: [],
    };
    const created = await store.collectionForms.create({
      title: '他人草稿',
      description: '',
      status: 'draft',
      ownerUid: 'target',
      scope,
      organizationId: null,
      publishedVersionId: null,
      currentDraftVersionId: null,
      opensAt: null,
      closesAt: null,
      capacity: null,
      coverUrl: null,
    });
    await request(app)
      .get(`${base}/collections/forms/${created.id}`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    await request(app)
      .get(`${base}/collections/forms/${created.id}`)
      .set('Authorization', 'Bearer lead')
      .expect(404);
    await request(app)
      .post(`${base}/collections/forms`)
      .set('Authorization', 'Bearer lead')
      .send({ title: '草稿', description: '', schema })
      .expect(403);
    await request(app)
      .put(`${base}/collections/forms/${created.id}/draft`)
      .set('Authorization', 'Bearer admin')
      .send({ title: '管理员修改', description: '', schema })
      .expect(200);
    expect((await store.auditLogs.list()).some((row) => row.actorUid === 'admin')).toBe(true);
  });
  it('records admin business overrides with original actor and sanitized result, before executing when audit unavailable', async () => {
    const { app, store } = await fixture();
    const input = {
      title: '预算',
      kind: 'budget',
      amountCents: 100,
      organizationId: 'sports_center',
      scope: { type: 'social_organization', id: 'sports_center' },
    };
    const result = await request(app)
      .post(`${base}/finance/records`)
      .set('Authorization', 'Bearer admin')
      .send(input)
      .expect(201);
    const log = (await store.auditLogs.list()).find(
      (row) => row.action === 'business.admin_override',
    );
    expect(log).toMatchObject({
      actorUid: 'admin',
      status: 'active',
      details: {
        previous: { method: 'POST', path: '/finance/records' },
        next: { status: 201, resultId: result.body.data.id },
      },
    });
    expect(JSON.stringify(log)).not.toContain('amountCents":100');
    const count = (await store.financeRecords.list()).length;
    store.auditLogs.create = async () => {
      throw new Error('audit offline');
    };
    await request(app)
      .post(`${base}/finance/records`)
      .set('Authorization', 'Bearer admin')
      .send(input)
      .expect(503);
    expect(await store.financeRecords.list()).toHaveLength(count);
  });
  it('preserves a pending audit and a successful result if the completion audit cannot update', async () => {
    const { app, store } = await fixture();
    store.auditLogs.update = async () => {
      throw new Error('audit update offline');
    };
    const result = await request(app)
      .post(`${base}/finance/records`)
      .set('Authorization', 'Bearer admin')
      .send({ title: '预算', kind: 'budget', amountCents: 100, scope })
      .expect(201);
    expect(result.headers['x-development-audit-pending']).toBeTruthy();
    expect(
      (await store.auditLogs.list()).find((row) => row.action === 'business.admin_override')
        ?.status,
    ).toBe('pending');
  });
  it('never writes from preview or spoofs reserved settings authority', async () => {
    const { app, store } = await fixture();
    const preview = await request(app)
      .get(`${base}/me`)
      .set('Authorization', 'Bearer admin')
      .set('X-Development-Preview-Uid', 'lead')
      .expect(200);
    expect(preview.body.data).toMatchObject({
      uid: 'lead',
      previewing: true,
      viewer: { uid: 'admin', canManageDevelopment: false, canPreviewDevelopment: true },
    });
    await request(app)
      .get(`${base}/knowledge/entries`)
      .set('Authorization', 'Bearer admin')
      .set('X-Development-Preview-Uid', 'member')
      .expect(200);
    await request(app)
      .post(`${base}/finance/records`)
      .set('Authorization', 'Bearer admin')
      .set('X-Development-Preview-Uid', 'lead')
      .send({ title: '无权预览写入', kind: 'budget', amountCents: 10, scope })
      .expect(403);
    await request(app)
      .get(`${base}/system-settings`)
      .set('Authorization', 'Bearer admin')
      .set('X-Development-Preview-Uid', 'admin')
      .expect(403);
    await request(app)
      .get(`${base}/admin/development-users`)
      .set('Authorization', 'Bearer admin')
      .set('X-Development-Preview-Uid', 'lead')
      .expect(403);
    for (const uid of ['lead', 'member'])
      await request(app)
        .get(`${base}/me`)
        .set('Authorization', `Bearer ${uid}`)
        .set('X-Development-Preview-Uid', 'admin')
        .expect(403);
    await request(app)
      .get(`${base}/admin/development-users`)
      .set('Authorization', 'Bearer lead')
      .set('X-Development-Preview-Uid', 'lead')
      .expect(403);
    await request(app)
      .post(`${base}/finance/records`)
      .set('Authorization', 'Bearer lead')
      .set('X-Development-Preview-Uid', 'admin')
      .send({ title: '禁止', kind: 'budget', amountCents: 10 })
      .expect(403);
    expect((await store.auditLogs.list()).filter((row) => row.actorUid === 'admin')).toHaveLength(
      0,
    );
  });
  it('grants a reward batch once and persists development-only notice and audit across retries', async () => {
    let calls = 0;
    const { app } = await fixture({
      developmentRewardProvider: {
        grant: async (actorUid, input) => {
          calls++;
          expect(actorUid).toBe('admin');
          expect(input.recipientUids).toEqual(['member', 'target']);
          return {
            batchId: 321,
            recipientCount: 2,
            electric: 3,
            magnetic: 4,
            totalElectric: 6,
            totalMagnetic: 8,
            replayed: false,
          };
        },
      },
    });
    const input = {
      requestId: 'reward-123',
      recipientUids: ['target', 'member'],
      title: '奖励',
      reason: '活动',
      electric: 3,
      magnetic: 4,
    };
    const [first, second] = await Promise.all([
      request(app)
        .post(`${base}/system-settings/rewards`)
        .set('Authorization', 'Bearer admin')
        .send(input),
      request(app)
        .post(`${base}/system-settings/rewards`)
        .set('Authorization', 'Bearer admin')
        .send(input),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(calls).toBe(1);
    await request(app)
      .post(`${base}/system-settings/rewards`)
      .set('Authorization', 'Bearer admin')
      .send({ ...input, electric: 5 })
      .expect(409);
    await request(app)
      .post(`${base}/system-settings/rewards`)
      .set('Authorization', 'Bearer admin')
      .send({ ...input, requestId: 'bad', recipientUids: ['unknown'] })
      .expect(400);
    expect(calls).toBe(1);
    const notices = await request(app)
      .get(`${base}/notifications`)
      .set('Authorization', 'Bearer member')
      .expect(200);
    expect(notices.body.data).toEqual([expect.objectContaining({ kind: 'reward', title: '奖励' })]);
    const audits = await request(app)
      .get(`${base}/system-settings/audit-logs?action=system_settings.reward.grant`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(audits.body.data.total).toBe(1);
  });
  it('validates identity exclusivity, exact captain teams and unwhitelisted recipient eligibility without granting access', async () => {
    const { app, store } = await fixture();
    const grant = (await store.developmentAccess.list()).find(
      (row) => row.subjectUid === 'target',
    )!;
    await store.developmentAccess.update(grant.id, { status: 'archived' });
    const result = await request(app)
      .get(`${base}/system-settings/users?query=target`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(result.body.data).toEqual([
      expect.objectContaining({ uid: 'target', canReceiveNotifications: false }),
    ]);
    const revision = result.body.data[0].revision;
    for (const change of [
      { roles: ['domain.arts_lead', 'department.arts_member'], captainTeamIds: [] },
      { roles: [], captainTeamIds: ['missing-team'] },
      { roles: ['department.arts_member', 'department.arts_member'], captainTeamIds: [] },
    ])
      await request(app)
        .put(`${base}/system-settings/users/target`)
        .set('Authorization', 'Bearer admin')
        .send({ revision, ...change })
        .expect(400);
    expect(
      (await store.auditLogs.list()).filter((row) => row.action === 'system_settings.user.update'),
    ).toHaveLength(0);
    await request(app)
      .put(`${base}/system-settings/users/target`)
      .set('Authorization', 'Bearer admin')
      .send({ revision, roles: ['department.arts_member'], captainTeamIds: [] })
      .expect(200);
    expect((await store.developmentAccess.get(grant.id))?.status).toBe('archived');
    await request(app)
      .post(`${base}/system-settings/notifications`)
      .set('Authorization', 'Bearer admin')
      .send({ requestId: 'inactive', title: '通知', body: '内容', recipientUids: ['target'] })
      .expect(400);
    await request(app)
      .post(`${base}/system-settings/notifications`)
      .set('Authorization', 'Bearer admin')
      .send({
        requestId: 'external',
        title: '通知',
        body: '内容',
        recipientUids: ['member'],
        link: 'https://external.example',
      })
      .expect(400);
    expect(
      (
        await request(app)
          .get(`${base}/system-settings/notifications`)
          .set('Authorization', 'Bearer admin')
      ).body.data,
    ).toHaveLength(0);
  });
  it('edits organization metadata and business module configuration with revisions and complete audit pages', async () => {
    const { app } = await fixture();
    const previous = await request(app)
      .get(`${base}/system-settings/organizations`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    const input = {
      revision: previous.body.data.revision,
      organizations: [{ id: 'arts_center', name: '文艺新名称', description: '组织说明' }],
      roles: [{ key: 'department.arts_member', name: '文艺组成员' }],
    };
    const changed = await request(app)
      .patch(`${base}/system-settings/organizations`)
      .set('Authorization', 'Bearer admin')
      .send(input)
      .expect(200);
    expect(changed.body.data.organizations).toEqual(
      expect.arrayContaining([input.organizations[0]]),
    );
    await request(app)
      .patch(`${base}/system-settings/organizations`)
      .set('Authorization', 'Bearer admin')
      .send(input)
      .expect(409);
    await request(app)
      .patch(`${base}/system-settings/organizations`)
      .set('Authorization', 'Bearer admin')
      .send({
        ...input,
        revision: changed.body.data.revision,
        roles: [{ key: 'platform.super_admin', name: '非法' }],
      })
      .expect(400);
    await request(app)
      .patch(`${base}/system-settings/modules`)
      .set('Authorization', 'Bearer admin')
      .send({ moduleId: 'knowledge', enabled: false })
      .expect(200);
    await request(app)
      .patch(`${base}/system-settings/modules`)
      .set('Authorization', 'Bearer admin')
      .send({ moduleId: 'admin', enabled: false })
      .expect(400);
    const audit = await request(app)
      .get(`${base}/system-settings/audit-logs?page=1&pageSize=1`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(audit.body.data).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(audit.body.data.items).toHaveLength(1);
    const leadAudit = await request(app)
      .get(`${base}/admin/audit-logs?action=system_settings.module.update`)
      .set('Authorization', 'Bearer lead')
      .expect(200);
    expect(leadAudit.body.data.items).toHaveLength(0);
  });
  it('retries reward provider failures without producing notices or an audit and rejects invalid bounded currencies', async () => {
    let calls = 0;
    const { app } = await fixture({
      developmentRewardProvider: {
        grant: async () => {
          calls++;
          if (calls === 1) throw new Error('private provider failure');
          return {
            batchId: 123,
            recipientCount: 1,
            electric: 1,
            magnetic: 0,
            totalElectric: 1,
            totalMagnetic: 0,
            replayed: false,
          };
        },
      },
    });
    const input = {
      requestId: 'reward-retry',
      recipientUids: ['member'],
      title: '奖励',
      reason: '活动',
      electric: 1,
      magnetic: 0,
    };
    const failed = await request(app)
      .post(`${base}/system-settings/rewards`)
      .set('Authorization', 'Bearer admin')
      .send(input)
      .expect(503);
    expect(JSON.stringify(failed.body)).not.toContain('private provider failure');
    expect(
      (await request(app).get(`${base}/notifications`).set('Authorization', 'Bearer member')).body
        .data,
    ).toHaveLength(0);
    expect(
      (
        await request(app)
          .get(`${base}/system-settings/audit-logs`)
          .set('Authorization', 'Bearer admin')
      ).body.data.total,
    ).toBe(0);
    await request(app)
      .post(`${base}/system-settings/rewards`)
      .set('Authorization', 'Bearer admin')
      .send(input)
      .expect(201);
    for (const currencies of [
      { electric: 0, magnetic: 0 },
      { electric: -1, magnetic: 0 },
      { electric: 0.5, magnetic: 0 },
      { electric: 1000001, magnetic: 0 },
    ])
      await request(app)
        .post(`${base}/system-settings/rewards`)
        .set('Authorization', 'Bearer admin')
        .send({ ...input, requestId: 'bad', ...currencies })
        .expect(400);
    expect(calls).toBe(2);
  });
  it('keeps global administrator capabilities and qualified lead sports-card maintenance while preserving member and organization-group boundaries', async () => {
    const { app, store } = await fixture();
    await request(app)
      .patch(`${base}/sports/teams`)
      .set('Authorization', 'Bearer admin')
      .send({ id: 'team-basketball', name: '新名称' })
      .expect(200);
    await request(app)
      .patch(`${base}/sports/teams`)
      .set('Authorization', 'Bearer lead')
      .send({ id: 'team-basketball', name: '负责人维护' })
      .expect(200);
    await request(app)
      .patch(`${base}/sports/teams`)
      .set('Authorization', 'Bearer member')
      .send({ id: 'team-basketball', name: '无权修改' })
      .expect(403);
    for (const uid of ['lead', 'member']) {
      const landing = await request(app)
        .get(`${base}/organization-group/workspace`)
        .set('Authorization', `Bearer ${uid}`)
        .expect(200);
      expect(landing.body.data.canManage).toBe(false);
      await request(app)
        .get(`${base}/organization-group/entries`)
        .set('Authorization', `Bearer ${uid}`)
        .expect(403);
    }
    const workspace = await request(app)
      .get(`${base}/organization-group/workspace`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(workspace.body.data.canManage).toBe(true);
    expect((await store.sportsTeams.get('team-basketball'))?.name).toBe('负责人维护');
  });
  it('ignores persisted lead business denies as well as grants when the same user explicitly holds business administration', async () => {
    const { app, store } = await fixture();
    await store.roleAssignments.create({
      subjectUid: 'admin',
      roleKey: 'platform.super_admin',
      expiresAt: null,
      status: 'active',
      ownerUid: 'lead',
      scope,
    });
    await store.rolePermissions.create({
      roleKey: 'platform.super_admin',
      action: '*',
      resource: '*',
      effect: 'deny',
      status: 'active',
      ownerUid: 'legacy',
      scope,
    });
    const homepage = await request(app)
      .get(`${base}/organizations/student_union/arts_center/home`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(homepage.body.data.canEdit).toBe(true);
  });
  it('requires explicit platform administration for connector settings even for a real development lead', async () => {
    const { app } = await fixture();
    await request(app)
      .get(`${base}/connectors/jobs`)
      .set('Authorization', 'Bearer lead')
      .expect(403);
    await request(app)
      .get(`${base}/connectors/jobs`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
  });
  it('retains current scoped roles and future captain expiry without reviving unrelated historical assignments', async () => {
    const { app, store } = await fixture();
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    const grant = {
      subjectUid: 'target',
      roleKey: 'youth_league.freshman.leader' as const,
      ownerUid: 'original',
      status: 'active',
      expiresAt: future,
      scope: { type: 'activity', id: 'scope-a' },
    };
    const active = await store.roleAssignments.create(grant);
    const archived = await store.roleAssignments.create({
      ...grant,
      status: 'archived',
      expiresAt: null,
      scope,
    });
    const expired = await store.roleAssignments.create({
      ...grant,
      expiresAt: past,
      scope: { type: 'activity', id: 'scope-b' },
    });
    const captain = await store.tagAssignments.create({
      subjectUid: 'target',
      tagKey: 'sports.team_captain',
      ownerUid: 'original',
      status: 'active',
      expiresAt: future,
      scope: { type: 'sports_team', id: 'team-basketball' },
    });
    const oldCaptain = await store.tagAssignments.create({
      subjectUid: 'target',
      tagKey: 'sports.team_captain',
      ownerUid: 'original',
      status: 'active',
      expiresAt: past,
      scope: { type: 'sports_team', id: 'team-historical' },
    });
    const before = (
      await request(app)
        .get(`${base}/system-settings/users?query=target`)
        .set('Authorization', 'Bearer admin')
    ).body.data[0];
    const next = await request(app)
      .put(`${base}/system-settings/users/target`)
      .set('Authorization', 'Bearer admin')
      .send({
        revision: before.revision,
        roles: before.roles,
        captainTeamIds: before.captainTeamIds,
      })
      .expect(200);
    for (const row of [active, archived, expired])
      expect(await store.roleAssignments.get(row.id)).toEqual(row);
    for (const row of [captain, oldCaptain])
      expect(await store.tagAssignments.get(row.id)).toEqual(row);
    expect(next.body.data.revision).toBe(before.revision);
    const audit = (await store.auditLogs.list()).find(
      (row) => row.action === 'system_settings.user.update',
    );
    expect(audit?.details).toMatchObject({
      previous: { revision: before.revision, roles: before.roles },
      next: { revision: before.revision, roles: before.roles },
    });
  });
  it.each([false, true])(
    'adds only canonical public role grants when historical scopes exist (canonical row %s)',
    async (canonicalPresent) => {
      const { app, store } = await fixture();
      const past = new Date(Date.now() - 86400000).toISOString();
      const historic = await store.roleAssignments.create({
        subjectUid: 'target',
        roleKey: 'department.arts_member',
        ownerUid: 'original',
        status: 'archived',
        expiresAt: past,
        scope: { type: 'activity', id: 'historical-scope' },
      });
      if (canonicalPresent)
        await store.roleAssignments.create({
          subjectUid: 'target',
          roleKey: 'department.arts_member',
          ownerUid: 'original',
          status: 'archived',
          expiresAt: past,
          scope,
        });
      const before = (
        await request(app)
          .get(`${base}/system-settings/users?query=target`)
          .set('Authorization', 'Bearer admin')
      ).body.data[0];
      await request(app)
        .put(`${base}/system-settings/users/target`)
        .set('Authorization', 'Bearer admin')
        .send({ revision: before.revision, roles: ['department.arts_member'], captainTeamIds: [] })
        .expect(200);
      expect(await store.roleAssignments.get(historic.id)).toEqual(historic);
      const current = (await store.roleAssignments.list({ query: 'target' })).filter(
        (row) => row.roleKey === 'department.arts_member' && row.status === 'active',
      );
      expect(current).toHaveLength(1);
      expect(current[0]).toMatchObject({ scope, expiresAt: null, ownerUid: 'admin' });
    },
  );
  it('rejects a retained checkbox draft after its scoped assignment expires rather than silently creating a permanent public grant', async () => {
    const baseline = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(baseline);
    try {
      const { app, store } = await fixture();
      const original = await store.roleAssignments.create({
        subjectUid: 'target',
        roleKey: 'department.sports_member',
        ownerUid: 'original',
        status: 'active',
        expiresAt: new Date(baseline + 1000).toISOString(),
        scope: { type: 'activity', id: 'temporary-scope' },
      });
      const before = (
        await request(app)
          .get(`${base}/system-settings/users?query=target`)
          .set('Authorization', 'Bearer admin')
      ).body.data[0];
      clock.mockReturnValue(baseline + 2000);
      await request(app)
        .put(`${base}/system-settings/users/target`)
        .set('Authorization', 'Bearer admin')
        .send({
          revision: before.revision,
          roles: before.roles,
          captainTeamIds: before.captainTeamIds,
        })
        .expect(409);
      expect(await store.roleAssignments.get(original.id)).toEqual(original);
      expect(
        (await store.roleAssignments.list({ query: 'target' })).filter(
          (row) => row.roleKey === 'department.sports_member',
        ),
      ).toHaveLength(1);
    } finally {
      clock.mockRestore();
    }
  });
  it('preserves disabled business module configuration through lead and combined-role authentication', async () => {
    const { app, store } = await fixture();
    await request(app)
      .patch(`${base}/system-settings/modules`)
      .set('Authorization', 'Bearer admin')
      .send({ moduleId: 'finance', enabled: false })
      .expect(200);
    const disabled = (await store.modules.list()).find((row) => row.moduleId === 'finance')!;
    await request(app).get(`${base}/me`).set('Authorization', 'Bearer lead').expect(200);
    expect(await store.modules.get(disabled.id)).toEqual(disabled);
    await store.roleAssignments.create({
      subjectUid: 'lead',
      roleKey: 'platform.admin',
      ownerUid: 'admin',
      status: 'active',
      expiresAt: null,
      scope,
    });
    await request(app).get(`${base}/me`).set('Authorization', 'Bearer lead').expect(200);
    expect(await store.modules.get(disabled.id)).toEqual(disabled);
    const metadata = await request(app)
      .get(`${base}/system-settings/modules`)
      .set('Authorization', 'Bearer lead')
      .expect(200);
    expect(metadata.body.data.find((row: { id: string }) => row.id === 'finance').status).toBe(
      'disabled',
    );
  });
  it('does not count inactive administrator subjects as survivors when revoking the last effective administrator access', async () => {
    const { app, store } = await fixture();
    await store.roleAssignments.create({
      subjectUid: 'target',
      roleKey: 'platform.admin',
      ownerUid: 'admin',
      status: 'active',
      expiresAt: null,
      scope,
    });
    const inactive = (await store.subjects.list()).find((row) => row.uid === 'target')!;
    await store.subjects.update(inactive.id, { status: 'inactive' });
    const adminGrant = (await store.developmentAccess.list()).find(
      (row) => row.subjectUid === 'admin',
    )!;
    await request(app)
      .put(`${base}/admin/development-users/admin`)
      .set('Authorization', 'Bearer lead')
      .send({ accessLevel: null })
      .expect(409);
    expect(await store.developmentAccess.get(adminGrant.id)).toEqual(adminGrant);
    expect(
      (await store.auditLogs.list()).filter(
        (row) => row.action === 'admin.development_access.update',
      ),
    ).toHaveLength(0);
  });
  it('allows read-only administrator-target organization-group preview without granting manager mutation authority', async () => {
    const { app } = await fixture();
    const headers = { Authorization: 'Bearer admin', 'X-Development-Preview-Uid': 'admin' };
    const workspace = await request(app)
      .get(`${base}/organization-group/workspace`)
      .set(headers)
      .expect(200);
    expect(workspace.body.data).toMatchObject({ canManage: true, canGrantManagers: false });
    await request(app).get(`${base}/organization-group/entries`).set(headers).expect(200);
    await request(app).get(`${base}/organization-group/resources`).set(headers).expect(200);
    await request(app)
      .patch(`${base}/organization-group/settings`)
      .set(headers)
      .send({ revision: workspace.body.data.revision })
      .expect(403);
  });
  it('publishes persisted organization and role metadata in bootstrap identity sections', async () => {
    const { app } = await fixture();
    await request(app)
      .patch(`${base}/system-settings/organizations`)
      .set('Authorization', 'Bearer admin')
      .send({
        revision: 0,
        organizations: [{ id: 'arts_center', name: '新文艺组织', description: '' }],
        roles: [{ key: 'department.arts_member', name: '艺术协调员' }],
      })
      .expect(200);
    const boot = await request(app)
      .get(`${base}/system-settings`)
      .set('Authorization', 'Bearer admin')
      .expect(200);
    const group = boot.body.data.identitySections
      .find((section: { id: string }) => section.id === 'student_union')
      .groups.find((group: { id: string }) => group.id === 'student_union.arts_center');
    expect(group.label).toBe('新文艺组织');
    expect(
      group.options.find(
        (option: { roleKey: string }) => option.roleKey === 'department.arts_member',
      ).label,
    ).toBe('艺术协调员');
  });
  it('completes administrator audit intents for successful real DELETE routes returning no JSON content', async () => {
    const { app, store } = await fixture();
    const created = await request(app)
      .post(`${base}/sports/matches`)
      .set('Authorization', 'Bearer admin')
      .send({
        title: '测试赛',
        startsAt: '2026-10-20T05:00:00.000Z',
        endsAt: '2026-10-20T07:00:00.000Z',
        location: '体育馆',
      })
      .expect(201);
    await request(app)
      .delete(`${base}/sports/matches/${created.body.data.id}`)
      .set('Authorization', 'Bearer admin')
      .expect(204);
    await new Promise((resolve) => setImmediate(resolve));
    const audit = (await store.auditLogs.list()).find(
      (row) =>
        row.action === 'business.admin_override' &&
        (row.details.previous as { method: string })?.method === 'DELETE',
    );
    expect(audit).toMatchObject({
      status: 'active',
      details: { next: { status: 204, outcome: 'completed' } },
    });
  });
  it('requires trusted original lead access for reserved main-mode APIs even when a member retains the reserved role', async () => {
    const { app, store } = await fixture();
    await store.roleAssignments.create({
      subjectUid: 'member',
      roleKey: 'platform.super_admin',
      ownerUid: 'legacy',
      status: 'active',
      expiresAt: null,
      scope,
    });
    await store.roleAssignments.create({
      subjectUid: 'member',
      roleKey: 'platform.admin',
      ownerUid: 'admin',
      status: 'active',
      expiresAt: null,
      scope,
    });
    const identity = await request(app)
      .get(`${base}/me`)
      .set('Authorization', 'Bearer member')
      .expect(200);
    expect(identity.body.data).toMatchObject({
      developmentAccess: 'member',
      viewer: { canManageDevelopment: false },
    });
    expect(identity.body.data.roles).toContain('platform.super_admin');
    for (const endpoint of ['development-users', 'audit-logs', 'system-status', 'subjects'])
      await request(app)
        .get(`${base}/admin/${endpoint}`)
        .set('Authorization', 'Bearer member')
        .expect(403);
    const grant = (await store.developmentAccess.list()).find(
      (row) => row.subjectUid === 'target',
    )!;
    await request(app)
      .put(`${base}/admin/development-users/target`)
      .set('Authorization', 'Bearer member')
      .send({ accessLevel: 'lead' })
      .expect(403);
    expect(await store.developmentAccess.get(grant.id)).toEqual(grant);
    expect(
      (await store.auditLogs.list()).filter(
        (row) => row.action === 'admin.development_access.update',
      ),
    ).toHaveLength(0);
  });
  it('rejects reserved lead grants and removal through retained legacy identity routes while keeping ordinary grants usable', async () => {
    const { app, store } = await fixture();
    await store.roleAssignments.create({
      subjectUid: 'lead',
      roleKey: 'platform.admin',
      ownerUid: 'admin',
      status: 'active',
      expiresAt: null,
      scope,
    });
    await request(app)
      .post(`${base}/admin/role-assignments`)
      .set('Authorization', 'Bearer lead')
      .send({ subjectUid: 'target', roleKey: 'platform.super_admin' })
      .expect(400);
    expect(
      (await store.roleAssignments.list({ query: 'target' })).filter(
        (row) => row.roleKey === 'platform.super_admin',
      ),
    ).toHaveLength(0);
    expect(
      (await store.auditLogs.list()).filter((row) => row.action === 'admin.role_assignment.grant'),
    ).toHaveLength(0);
    await request(app)
      .post(`${base}/admin/role-assignments`)
      .set('Authorization', 'Bearer lead')
      .send({ subjectUid: 'target', roleKey: 'department.sports_member', scope })
      .expect(201);
    expect(
      (await store.roleAssignments.list({ query: 'target' })).filter(
        (row) => row.roleKey === 'department.sports_member',
      ),
    ).toHaveLength(1);
    const demo = createApp({ store: createMemoryStore(), authMode: 'demo' });
    await request(demo)
      .get(`${base}/admin/system-status`)
      .set('X-Demo-User', 'demo-admin')
      .expect(200);
  });
  it('rejects legacy reserved lead removal even when another qualified lead survives', async () => {
    const { app, store } = await fixture();
    await store.roleAssignments.create({
      subjectUid: 'lead',
      roleKey: 'platform.admin',
      ownerUid: 'admin',
      status: 'active',
      expiresAt: null,
      scope,
    });
    const targetGrant = (await store.developmentAccess.list()).find(
      (row) => row.subjectUid === 'target',
    )!;
    await store.developmentAccess.update(targetGrant.id, { accessLevel: 'lead' });
    const reserved = await store.roleAssignments.create({
      subjectUid: 'target',
      roleKey: 'platform.super_admin',
      ownerUid: 'lead',
      status: 'active',
      expiresAt: null,
      scope,
    });
    await request(app)
      .delete(`${base}/admin/role-assignments/${reserved.id}`)
      .set('Authorization', 'Bearer lead')
      .expect(409);
    expect(await store.roleAssignments.get(reserved.id)).toEqual(reserved);
    expect(
      (await store.auditLogs.list()).filter((row) => row.action === 'admin.role_assignment.revoke'),
    ).toHaveLength(0);
  });
});
