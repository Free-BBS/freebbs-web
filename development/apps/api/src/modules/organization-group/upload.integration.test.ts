import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { platformRootAdminUids } from '@freebbs-development/contracts';
import { createApp } from '../../app.js';
import { createMemoryStore } from '../../core/database/memory-store.js';

let server: Server | undefined;
let directory: string | undefined;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  }
  if (directory) {
    if (!basename(directory).startsWith('organization-upload-http-'))
      throw new Error('Unexpected temporary directory');
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

it('round-trips a real JPEG with trailing padding and generic MIME over HTTP as a normal class secretary', async () => {
  directory = await mkdtemp(join(tmpdir(), 'organization-upload-http-'));
  const store = createMemoryStore();
  const rootUid = platformRootAdminUids()[0]!;
  const secretaryUid = 'u_upload_secretary';
  await store.tagAssignments.create({
    subjectUid: secretaryUid,
    tagKey: 'class.youth_league_secretary',
    expiresAt: null,
    status: 'active',
    ownerUid: rootUid,
    scope: { type: 'class', id: 'wu55' },
  });
  const app = createApp({
    environment: { NODE_ENV: 'test', AUTH_MODE: 'main' },
    authMode: 'main',
    authClient: {
      introspect: async (token) =>
        ['root', 'secretary'].includes(token)
          ? {
              uid: token === 'root' ? rootUid : secretaryUid,
              displayName: token === 'root' ? '管理员' : '班级团支书',
              studentId: token === 'secretary' ? '2026000001' : null,
              avatarUrl: null,
              baseRole: 'student',
              roles: [],
              tags: [],
            }
          : null,
    },
    store,
    collectionsUploadDirectory: join(directory, 'collections'),
    systemSettingsDirectory: join(directory, 'settings'),
    bannerReactionsDirectory: join(directory, 'reactions'),
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/development/v1`;
  const call = (path: string, token: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
  const initialResponse = await call('/organization-group/workspace', 'root');
  expect(initialResponse.status).toBe(200);
  const initial = (await initialResponse.json()).data;
  const configured = await call('/organization-group/settings', 'root', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      revision: initial.revision,
      classes: [{ id: 'wu55', label: '无55' }],
    }),
  });
  expect(configured.status).toBe(200);
  const me = await call('/me', 'secretary');
  expect((await me.json()).data).toMatchObject({
    uid: secretaryUid,
    businessAdmin: false,
    rootAdmin: false,
    tags: [{ key: 'class.youth_league_secretary', scope: { type: 'class', id: 'wu55' } }],
  });
  const original = await readFile(
    new URL(
      '../../../../../docs/assets/organization-group-user-guide/05-photo-upload.jpg',
      import.meta.url,
    ),
  );
  const source = Buffer.concat([original, Buffer.alloc(4)]);
  // The existing guide asset is an encoded 50 KB JPEG, rather than a synthetic magic header.
  expect(source.length).toBeGreaterThan(40_000);
  const form = new FormData();
  // Match Files.tsx: the browser sends the file before contextual text fields.
  form.append('file', new Blob([source], { type: 'application/octet-stream' }), '主题团日1.jpeg');
  form.append('yearId', initial.activeYearId);
  form.append('purpose', 'activity_photo');
  const uploaded = await call('/organization-group/uploads', 'secretary', {
    method: 'POST',
    body: form,
  });
  expect(uploaded.status).toBe(201);
  const file = (await uploaded.json()).data;
  expect(file).toMatchObject({
    originalName: '主题团日1.jpeg',
    mime: 'image/jpeg',
    size: source.length,
    purpose: 'activity_photo',
  });
  const downloaded = await call(`/organization-group/files/${file.id}?preview=1`, 'secretary');
  expect(downloaded.status).toBe(200);
  expect(downloaded.headers.get('content-type')).toContain('image/jpeg');
  expect(downloaded.headers.get('x-content-type-options')).toBe('nosniff');
  expect(downloaded.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
  const result = Buffer.from(await downloaded.arrayBuffer());
  expect(createHash('sha256').update(result).digest('hex')).toBe(
    createHash('sha256').update(source).digest('hex'),
  );
}, 15_000);
