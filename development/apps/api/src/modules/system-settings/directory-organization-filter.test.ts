import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  organizationById,
  type RoleKey,
  type SocialOrganizationId,
} from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

const roots: string[] = [];
const scope = { type: 'public', id: '*' } as const;
const unionOrganizations = [
  'arts_center',
  'liaison_center',
  'sports_center',
  'rights_development_center',
] as const;
const memberships: { roleKey: RoleKey; organizationId: SocialOrganizationId }[] = [
  { roleKey: 'science_association.software.member', organizationId: 'sast' },
  { roleKey: 'media_center.audiovisual.member', organizationId: 'media_center' },
  { roleKey: 'youth_league.practice.member', organizationId: 'tuanwei' },
  ...unionOrganizations.flatMap((organizationId) =>
    (
      [
        'student_union.executive_president',
        'student_union.presidium',
        'student_union.finance',
      ] as const
    ).map((roleKey) => ({ roleKey, organizationId })),
  ),
];

async function fixture(roleKey: RoleKey, organizationId: SocialOrganizationId) {
  const root = await mkdtemp(join(tmpdir(), 'directory-organization-filter-'));
  roots.push(root);
  const store = createMemoryStore();
  const users = [
    'admin',
    'lead',
    'first',
    'second',
    'third',
    'legacy',
    'expired',
    'archived',
    'foreign',
  ].map((uid, index) => ({
    uid,
    username: `Directory${uid}`,
    displayName: uid,
    studentId: `directory_student_${index}`,
    avatarUrl: null,
  }));
  for (const uid of ['admin', 'lead', 'first', 'second', 'third']) {
    const user = users.find((user) => user.uid === uid)!;
    await store.developmentAccess.create({
      subjectUid: ['second', 'third'].includes(uid) ? null : uid,
      studentId: uid === 'second' ? user.studentId : null,
      username: uid === 'third' ? user.username.toUpperCase() : null,
      accessLevel: uid === 'lead' ? 'lead' : 'member',
      status: 'active',
      ownerUid: 'lead',
      scope,
    });
  }
  for (const user of users) {
    await store.subjects.create({
      uid: user.uid,
      displayName: user.displayName,
      avatarUrl: null,
      status: 'active',
      ownerUid: 'lead',
      scope,
    });
  }
  const foreignOrganization: SocialOrganizationId =
    organizationId === 'tuanwei' ? 'sast' : 'tuanwei';
  for (const [uid, assignedRole] of [
    ['admin', 'platform.admin'],
    ['first', roleKey],
    ['second', roleKey],
    ['third', roleKey],
    ['legacy', organizationById(organizationId).roles.member],
    ['expired', roleKey],
    ['archived', roleKey],
    ['foreign', organizationById(foreignOrganization).roles.member],
    ['foreign', 'counselor.youth_league_secretary'],
  ] as [string, RoleKey][]) {
    await store.roleAssignments.create({
      subjectUid: uid,
      roleKey: assignedRole,
      expiresAt: uid === 'expired' ? '2000-01-01T00:00:00.000Z' : null,
      status: uid === 'archived' ? 'archived' : 'active',
      ownerUid: 'lead',
      scope,
    });
  }
  // Multiple current grants must still count this user once.
  await store.roleAssignments.create({
    subjectUid: 'first',
    roleKey,
    expiresAt: '2999-01-01T00:00:00.000Z',
    status: 'active',
    ownerUid: 'lead',
    scope: { type: 'social_org', id: organizationId },
  });
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
      list: async () => users,
      get: async (uid) => users.find((user) => user.uid === uid) ?? null,
    },
  });
  return { app, foreignOrganization };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

for (const { endpoint, actor } of [
  { endpoint: 'system-settings/users', actor: 'admin' },
  { endpoint: 'admin/development-users', actor: 'lead' },
]) {
  describe(`${endpoint} organization directory`, () => {
    it.each(memberships)(
      'includes $roleKey in $organizationId with consistent totals and intersecting filters',
      async ({ roleKey, organizationId }) => {
        const { app, foreignOrganization } = await fixture(roleKey, organizationId);
        const page = async (filters: Record<string, string | number>) => {
          const response = await request(app)
            .get(`/api/development/v1/${endpoint}`)
            .query({ page: 1, pageSize: 2, organizationId, ...filters })
            .set('Authorization', `Bearer ${actor}`)
            .expect(200);
          return response.body.data as {
            total: number;
            page: number;
            pageSize: number;
            items: { uid: string; roles: string[] }[];
          };
        };
        const first = await page({});
        const second = await page({ page: 2 });
        const beyond = await page({ page: 3 });
        expect(first).toMatchObject({ total: 4, page: 1, pageSize: 2 });
        expect(second).toMatchObject({ total: 4, page: 2, pageSize: 2 });
        expect(beyond).toMatchObject({ total: 4, page: 3, pageSize: 2, items: [] });
        expect([...first.items, ...second.items].map(({ uid }) => uid).sort()).toEqual([
          'first',
          'legacy',
          'second',
          'third',
        ]);
        const rolePage = await page({ roleKey, pageSize: 100 });
        expect(rolePage.total).toBe(3);
        expect(rolePage.items.map(({ uid }) => uid).sort()).toEqual(['first', 'second', 'third']);
        expect(rolePage.items.every(({ roles }) => roles.includes(roleKey))).toBe(true);
        const foreign = await page({ roleKey, organizationId: foreignOrganization });
        expect(foreign).toMatchObject({ total: 0, items: [] });
        // Every real directory identity is admitted, including users without legacy records.
        const admitted = await page({ admission: 'admitted', pageSize: 100 });
        expect(admitted.total).toBe(4);
        expect(admitted.items.map(({ uid }) => uid).sort()).toEqual([
          'first',
          'legacy',
          'second',
          'third',
        ]);
      },
    );

    it('keeps organizational membership from authorizing directory administration', async () => {
      const { app } = await fixture('science_association.software.member', 'sast');
      await request(app)
        .get(`/api/development/v1/${endpoint}`)
        .query({ organizationId: 'sast', page: 1, pageSize: 2 })
        .set('Authorization', 'Bearer first')
        .expect(403);
    });
  });
}
