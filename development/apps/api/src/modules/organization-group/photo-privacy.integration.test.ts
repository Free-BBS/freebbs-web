import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  platformRootAdminUids,
  type OrganizationGroupEntry,
  type OrganizationGroupFile,
  type OrganizationGroupWorkspace,
  type RoleKey,
  type ScopeRef,
} from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

let server: Server | undefined;
let directory: string | undefined;
const temporaryRoot = resolve(tmpdir());
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((accept, reject) =>
      server!.close((error) => (error ? reject(error) : accept())),
    );
    server = undefined;
  }
  if (directory) {
    if (
      dirname(directory) !== temporaryRoot ||
      !basename(directory).startsWith('organization-photo-privacy-')
    )
      throw new Error('Unexpected privacy test directory');
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

it('enforces draft, submitted-record and current-appointment photo visibility over authenticated HTTP', async () => {
  directory = await mkdtemp(join(temporaryRoot, 'organization-photo-privacy-'));
  const store = createMemoryStore();
  const rootUid = platformRootAdminUids()[0]!;
  const identities = new Map([
    ['root', { uid: rootUid, displayName: '最高管理员' }],
    ['author', { uid: 'u_privacy_author', displayName: '上传活动的团支书' }],
    ['same-class', { uid: 'u_privacy_same', displayName: '同班另一位团支书' }],
    ['other-class', { uid: 'u_privacy_other', displayName: '异班团支书' }],
    ['organization', { uid: 'u_privacy_org', displayName: '组织组同学' }],
    ['counselor', { uid: 'u_privacy_counselor', displayName: '全局辅导员' }],
    ['admin', { uid: 'u_privacy_admin', displayName: '发展端管理员' }],
    ['learning-admin', { uid: 'u_privacy_learning', displayName: '学习端管理员' }],
    ['scoped-counselor', { uid: 'u_privacy_scoped', displayName: '非全局辅导员' }],
    ['wrong-department', { uid: 'u_privacy_wrong', displayName: '其他范围的组织组身份' }],
  ]);
  const secretary = async (token: string, classId: string) =>
    store.tagAssignments.create({
      subjectUid: identities.get(token)!.uid,
      tagKey: 'class.youth_league_secretary',
      expiresAt: null,
      status: 'active',
      ownerUid: rootUid,
      scope: { type: 'class', id: classId },
    });
  const role = async (
    token: string,
    roleKey: RoleKey,
    scope: ScopeRef = { type: 'public', id: '*' },
  ) =>
    store.roleAssignments.create({
      subjectUid: identities.get(token)!.uid,
      roleKey,
      expiresAt: null,
      status: 'active',
      ownerUid: rootUid,
      scope,
    });
  const authorTag = await secretary('author', 'wu55');
  await secretary('same-class', 'wu55');
  await secretary('other-class', 'wu56');
  const organizationRole = await role('organization', 'youth_league.organization.member', {
    type: 'department',
    id: 'youth_league.organization',
  });
  const counselorRole = await role('counselor', 'counselor.practice');
  const adminRole = await role('admin', 'platform.admin');
  await role('learning-admin', 'platform.learning_admin');
  await role('scoped-counselor', 'counselor.practice', { type: 'class', id: 'wu55' });
  await role('wrong-department', 'youth_league.organization.member', {
    type: 'department',
    id: 'youth_league.humanities',
  });
  const app = createApp({
    environment: { NODE_ENV: 'test', AUTH_MODE: 'main' },
    authMode: 'main',
    authClient: {
      introspect: async (token) => {
        const identity = identities.get(token);
        return identity
          ? {
              ...identity,
              studentId: `student-${token}`,
              avatarUrl: null,
              baseRole: 'student',
              roles: [],
              tags: [],
            }
          : null;
      },
    },
    store,
    collectionsUploadDirectory: join(directory, 'collections'),
    systemSettingsDirectory: join(directory, 'settings'),
    bannerReactionsDirectory: join(directory, 'reactions'),
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((accept) => server!.once('listening', accept));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/development/v1`;
  const call = (path: string, token?: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(8000) });
  };
  const workspaceResponse = await call('/organization-group/workspace', 'root');
  expect(workspaceResponse.status).toBe(200);
  const initial = (await workspaceResponse.json()).data as OrganizationGroupWorkspace;
  expect(
    (
      await call('/organization-group/settings', 'root', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: initial.revision,
          classes: [
            { id: 'wu55', label: '无55' },
            { id: 'wu56', label: '无56' },
          ],
        }),
      })
    ).status,
  ).toBe(200);
  const source = await readFile(
    new URL(
      '../../../../../docs/assets/organization-group-user-guide/05-photo-upload.jpg',
      import.meta.url,
    ),
  );
  const form = new FormData();
  form.append('file', new Blob([source], { type: 'image/jpeg' }), '仅本人草稿照片.jpeg');
  form.append('yearId', initial.activeYearId);
  form.append('purpose', 'activity_photo');
  const uploaded = await call('/organization-group/uploads', 'author', {
    method: 'POST',
    body: form,
  });
  expect(uploaded.status).toBe(201);
  const file = (await uploaded.json()).data as OrganizationGroupFile;
  // Metadata gives an opaque ID, never a static /uploads URL or embedded credential.
  expect(file).not.toHaveProperty('url');
  expect(file).not.toHaveProperty('downloadUrl');
  expect(JSON.stringify(file)).not.toMatch(/\/uploads\/|Bearer |[?&](?:token|auth)=/i);
  const filePath = `/organization-group/files/${encodeURIComponent(file.id)}`;
  expect(`${base}${filePath}`).toContain('/api/development/v1/organization-group/files/');
  const readPhoto = async (token: string | undefined, status: number, preview: boolean) => {
    const response = await call(`${filePath}${preview ? '?preview=1' : ''}`, token);
    expect(response.status, `${token ?? 'anonymous'} ${preview ? 'preview' : 'download'}`).toBe(
      status,
    );
    if (status !== 200) {
      const body = await response.json();
      expect(body.data?.error).toBeDefined();
      return;
    }
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-type')).toContain('image/jpeg');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(response.headers.get('content-disposition')).toMatch(
      preview ? /^inline;/ : /^attachment;/,
    );
    expect(
      createHash('sha256')
        .update(Buffer.from(await response.arrayBuffer()))
        .digest('hex'),
    ).toBe(createHash('sha256').update(source).digest('hex'));
  };
  for (const preview of [false, true]) {
    await readPhoto(undefined, 401, preview);
    await readPhoto('author', 200, preview);
    for (const token of ['same-class', 'other-class', 'organization', 'counselor', 'admin', 'root'])
      await readPhoto(token, 404, preview);
  }
  const submitted = await call('/organization-group/entries', 'author', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      yearId: initial.activeYearId,
      expectedVersionId: initial.years[0]!.currentVersionId,
      classId: 'wu55',
      participantCount: 1,
      activityDate: '2026-11-24',
      activityTypeIds: ['theme_day'],
      participantNames: '参与同学',
      summary: '仅授权范围内可见的活动',
      photoIds: [file.id],
      extraAnswers: {},
    }),
  });
  expect(submitted.status).toBe(201);
  const entry = (await submitted.json()).data as OrganizationGroupEntry;
  expect(entry.photos[0]).toEqual(file);
  expect(JSON.stringify(entry.photos)).not.toContain('/uploads/');
  for (const preview of [false, true]) {
    await readPhoto(undefined, 401, preview);
    for (const token of ['author', 'organization', 'counselor', 'admin', 'root'])
      await readPhoto(token, 200, preview);
    for (const token of [
      'same-class',
      'other-class',
      'learning-admin',
      'scoped-counselor',
      'wrong-department',
    ])
      await readPhoto(token, 404, preview);
  }
  // Every subsequent request reloads active appointments rather than trusting a prior read.
  await store.roleAssignments.update(organizationRole.id, { status: 'inactive' });
  await store.roleAssignments.update(counselorRole.id, {
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
  });
  await store.roleAssignments.update(adminRole.id, {
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
  });
  await store.tagAssignments.update(authorTag.id, { status: 'inactive' });
  for (const token of ['organization', 'counselor', 'admin', 'author']) {
    await readPhoto(token, 404, false);
    await readPhoto(token, 404, true);
  }
  await store.tagAssignments.update(authorTag.id, {
    status: 'active',
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
  });
  for (const preview of [false, true]) await readPhoto('author', 404, preview);
  await store.tagAssignments.update(authorTag.id, { expiresAt: null });
  await readPhoto('author', 200, true);
}, 20000);
