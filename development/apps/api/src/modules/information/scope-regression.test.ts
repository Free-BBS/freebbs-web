import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { DemoAuthClient } from '../../core/auth/demo-auth-client.js';
import type { AuthorizationContext } from '../../core/authorization/policy.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

describe('information scoped authorization regressions', () => {
  it('requires announcement write permission on both the current and target scopes', async () => {
    const store = createMemoryStore();
    const current = await store.announcements.create({
      title: '组织 A 公告',
      body: '不能由只有组织 B 权限的人搬移。',
      status: 'draft',
      ownerUid: 'org-a-owner',
      scope: { type: 'organization', id: 'org-a' },
    });
    const scopedUser: AuthorizationContext = {
      uid: 'scoped-maintainer',
      displayName: '组织 B 维护者',
      avatarUrl: null,
      baseRole: 'student',
      roles: [],
      tags: [],
      policies: [
        {
          id: 'announcement-create-org-b',
          action: 'information.announcement.create',
          resource: 'announcement',
          effect: 'allow',
          scope: { type: 'organization', id: 'org-b' },
        },
      ],
    };
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: { introspect: async () => scopedUser },
    });

    await request(app)
      .patch('/api/development/v1/information/announcements')
      .set('X-Demo-User', 'scoped-maintainer')
      .send({ id: current.id, scope: { type: 'organization', id: 'org-b' } })
      .expect(404);
    expect(await store.announcements.get(current.id)).toMatchObject({
      scope: { type: 'organization', id: 'org-a' },
    });
  });

  it('lets a scoped triage maintainer list consultations in the requested scope', async () => {
    const store = createMemoryStore();
    await store.roleAssignments.create({
      subjectUid: 'demo-student',
      roleKey: 'department.liaison_director',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'organization', id: 'org-a' },
    });
    const other = await store.consultations.create({
      title: '组织 A 待分流咨询',
      body: '应由组织 A 的分流维护者看到。',
      requesterUid: 'another-user',
      assigneeUid: null,
      reply: null,
      status: 'open',
      ownerUid: 'another-user',
      scope: { type: 'organization', id: 'org-a' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student']),
    });

    const response = await request(app)
      .get('/api/development/v1/information/consultations?scopeType=organization&scopeId=org-a')
      .set('X-Demo-User', 'demo-student')
      .expect(200);

    expect(response.body.data.map((record: { id: string }) => record.id)).toContain(other.id);
  });
  it('filters an unscoped management queue record by record for a scoped triage grant', async () => {
    const store = createMemoryStore();
    const userA = await store.consultations.create({
      title: '用户 A 咨询',
      body: '允许看到。',
      requesterUid: 'user-a',
      assigneeUid: null,
      reply: null,
      status: 'open',
      ownerUid: 'user-a',
      scope: { type: 'user', id: 'user-a' },
    });
    const userB = await store.consultations.create({
      title: '用户 B 咨询',
      body: '不应看到。',
      requesterUid: 'user-b',
      assigneeUid: null,
      reply: null,
      status: 'open',
      ownerUid: 'user-b',
      scope: { type: 'user', id: 'user-b' },
    });
    await store.roleAssignments.create({
      subjectUid: 'demo-student',
      roleKey: 'department.liaison_director',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'user', id: 'user-a' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student']),
    });

    const response = await request(app)
      .get('/api/development/v1/information/consultations')
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    const ids = response.body.data.map((record: { id: string }) => record.id);
    expect(ids).toContain(userA.id);
    expect(ids).not.toContain(userB.id);
  });

  it('honors a record-scope explicit deny inside a global consultation grant', async () => {
    const store = createMemoryStore();
    const userA = await store.consultations.create({
      title: '允许咨询',
      body: '全局授权覆盖。',
      requesterUid: 'user-a',
      assigneeUid: null,
      reply: null,
      status: 'open',
      ownerUid: 'user-a',
      scope: { type: 'user', id: 'user-a' },
    });
    const userB = await store.consultations.create({
      title: '拒绝咨询',
      body: '精确拒绝优先。',
      requesterUid: 'user-b',
      assigneeUid: null,
      reply: null,
      status: 'open',
      ownerUid: 'user-b',
      scope: { type: 'user', id: 'user-b' },
    });
    await store.rolePermissions.create({
      roleKey: 'platform.super_admin',
      action: '*',
      resource: '*',
      effect: 'deny',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'user', id: 'user-b' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
    });

    const response = await request(app)
      .get('/api/development/v1/information/consultations')
      .set('X-Demo-User', 'demo-admin')
      .expect(200);
    const ids = response.body.data.map((record: { id: string }) => record.id);
    expect(ids).toContain(userA.id);
    expect(ids).not.toContain(userB.id);
  });
  it('filters an unscoped announcement maintenance list record by record for a scoped grant', async () => {
    const store = createMemoryStore();
    const orgA = await store.announcements.create({
      title: '组织 A 草稿',
      body: '允许维护。',
      status: 'draft',
      ownerUid: 'owner-a',
      scope: { type: 'organization', id: 'org-a' },
    });
    const orgB = await store.announcements.create({
      title: '组织 B 草稿',
      body: '不应返回。',
      status: 'draft',
      ownerUid: 'owner-b',
      scope: { type: 'organization', id: 'org-b' },
    });
    await store.roleAssignments.create({
      subjectUid: 'demo-student',
      roleKey: 'department.liaison_director',
      expiresAt: null,
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'organization', id: 'org-a' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-student']),
    });

    const response = await request(app)
      .get('/api/development/v1/information/announcements')
      .set('X-Demo-User', 'demo-student')
      .expect(200);
    const ids = response.body.data.map((record: { id: string }) => record.id);
    expect(ids).toContain(orgA.id);
    expect(ids).not.toContain(orgB.id);
  });

  it('honors a record-scope explicit deny inside global announcement maintenance access', async () => {
    const store = createMemoryStore();
    const orgA = await store.announcements.create({
      title: '允许公告',
      body: '全局授权覆盖。',
      status: 'draft',
      ownerUid: 'owner-a',
      scope: { type: 'organization', id: 'org-a' },
    });
    const orgB = await store.announcements.create({
      title: '拒绝公告',
      body: '精确拒绝优先。',
      status: 'draft',
      ownerUid: 'owner-b',
      scope: { type: 'organization', id: 'org-b' },
    });
    await store.rolePermissions.create({
      roleKey: 'platform.super_admin',
      action: '*',
      resource: '*',
      effect: 'deny',
      status: 'active',
      ownerUid: 'demo-admin',
      scope: { type: 'organization', id: 'org-b' },
    });
    const app = createApp({
      store,
      authMode: 'demo',
      authClient: new DemoAuthClient(['demo-admin']),
    });

    const response = await request(app)
      .get('/api/development/v1/information/announcements')
      .set('X-Demo-User', 'demo-admin')
      .expect(200);
    const ids = response.body.data.map((record: { id: string }) => record.id);
    expect(ids).toContain(orgA.id);
    expect(ids).not.toContain(orgB.id);
  });
});
