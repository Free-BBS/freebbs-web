const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { createMaxImageAccess } = require('./max-image-access');

const OLD = 'max-image-42-1791900000000-1234567890abcdef.webp';
const NEW = 'max-image-42-1791900000001-1234567890abcdef.webp';
const PUBLIC = 'max-image-42-1791900000002-1234567890abcdef.webp';
const CONTENT = Buffer.from('synthetic image bytes');

async function fixture(t) {
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freebbs-private-images-'));
  await fs.mkdir(path.join(uploadDir, '.max-images'));
  // Literal alias-shaped fixtures make the bypass tests meaningful even on a
  // volume where NTFS short-name generation is disabled.
  await fs.mkdir(path.join(uploadDir, 'MAX-IM~1'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(uploadDir, OLD), CONTENT),
    fs.writeFile(path.join(uploadDir, PUBLIC), CONTENT),
    fs.writeFile(path.join(uploadDir, '.max-images', NEW), CONTENT),
    fs.writeFile(path.join(uploadDir, 'discussion-public.webp'), CONTENT),
    fs.writeFile(path.join(uploadDir, 'MAX-IM~1.WEB'), CONTENT),
    fs.writeFile(path.join(uploadDir, 'MAX-IM~1', 'MAX-IM~1.WEB'), CONTENT),
  ]);
  const users = { owner: { id: 42 }, other: { id: 43 }, admin: { id: 1, is_admin: 1 } };
  const getOptionalAuthUser = async (request) =>
    users[request.headers.authorization?.replace('Bearer ', '')] || null;
  const requireAuth = async (request, response) => {
    const user = await getOptionalAuthUser(request);
    if (!user) response.sendStatus(401);
    return user;
  };
  const state = {
    publicPost: { user_id: 42, is_deleted: 0, is_hidden: 0, login_required: 0 },
    failDb: false,
  };
  const access = createMaxImageAccess({
    uploadDir,
    requireAuth,
    getOptionalAuthUser,
    pool: {
      async execute(sql, values) {
        assert.match(sql, /c\.id = \? AND c\.post_id = \?/);
        assert.deepEqual(values.slice(0, 2), [202, 101]);
        if (state.failDb) throw new Error('offline');
        return [values[2].includes(PUBLIC) ? [state.publicPost] : []];
      },
    },
  });
  await access.publishDiscussionImages([PUBLIC], { ownerId: 42, postId: 101, commentId: 202 });
  const app = express();
  app.use('/uploads', access.guardUploads, express.static(uploadDir));
  app.use('/api/ai/images', access.router);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
    await fs.rm(uploadDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    state,
    base,
    request: (url, user, options = {}) =>
      fetch(base + url, { ...options, headers: user ? { Authorization: `Bearer ${user}` } : {} }),
  };
}

test('new and historical generated images require their owner; admin has no implicit access', async (t) => {
  const { request } = await fixture(t);
  for (const url of [
    `/uploads/${OLD}`,
    `/api/ai/images/${OLD}`,
    `/api/ai/images/${NEW}`,
    `/uploads/${NEW}`,
  ]) {
    assert.equal((await request(url)).status, 401, url);
    assert.equal((await request(url, 'other')).status, 404, url);
    assert.equal((await request(url, 'admin')).status, 404, url);
    const response = await request(url, 'owner');
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.match(response.headers.get('vary'), /Authorization/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), CONTENT);
    assert.equal((await request(url, 'other', { method: 'HEAD' })).status, 404);
  }
});

test('direct private directory, encoded aliases, admin and query tokens never bypass ownership', async (t) => {
  const { request } = await fixture(t);
  for (const url of [
    `/uploads/.max-images/${NEW}`,
    `/uploads/%2emax-images/${NEW}`,
    `/uploads/%2emax-images%5c${NEW}`,
    `/uploads/.max-images.%20/${NEW}`,
    '/uploads/MAX-IM~1.WEB',
    '/uploads/MAX-IM~1/MAX-IM~1.WEB',
    '/uploads/MAX-IM%7e1.WEB',
    `/uploads/${OLD.toUpperCase()}`,
    `/uploads/${OLD}%3a%3a$DATA`,
    `/uploads/${OLD}.`,
    `/uploads/nested%2f${OLD}`,
    `/api/ai/images/${OLD}?token=owner`,
    `/uploads/${OLD}?token=owner`,
  ])
    assert.notEqual((await request(url)).status, 200, url);
  assert.equal(
    (await request(`/uploads/%6dax-image-42-1791900000000-1234567890abcdef.webp`, 'other')).status,
    404,
  );
});

test('ordinary uploads and visible Max discussion images remain available, hidden/deleted posts do not grant access', async (t) => {
  const { request, state } = await fixture(t);
  assert.equal((await request('/uploads/discussion-public.webp')).status, 200);
  assert.equal((await request(`/uploads/${PUBLIC}`)).status, 200);
  state.publicPost.login_required = 1;
  assert.equal((await request(`/uploads/${PUBLIC}`)).status, 401);
  assert.equal((await request(`/uploads/${PUBLIC}`, 'other')).status, 200);
  state.publicPost.is_hidden = 1;
  assert.equal((await request(`/uploads/${PUBLIC}`, 'admin')).status, 404);
  assert.equal((await request(`/uploads/${PUBLIC}`, 'other')).status, 404);
  state.publicPost.is_hidden = 0;
  state.publicPost.is_deleted = 1;
  assert.equal((await request(`/uploads/${PUBLIC}`, 'other')).status, 404);
});

test('legacy-public classification failure fails closed; new private owner access needs no public query', async (t) => {
  const { request, state } = await fixture(t);
  state.failDb = true;
  assert.equal((await request(`/uploads/${OLD}`, 'other')).status, 404);
  assert.equal((await request(`/uploads/${PUBLIC}`)).status, 503);
  assert.equal((await request(`/api/ai/images/${NEW}`, 'owner')).status, 200);
});

test('historical references and impersonated Max comments cannot create a publication record', async (t) => {
  const { request, state } = await fixture(t);
  // Even when visible discussion content exists, an old generated file without
  // its server-created marker never gets as far as the public-content DB lookup.
  state.publicPost.is_deleted = 0;
  state.publicPost.is_hidden = 0;
  state.failDb = true;
  assert.equal((await request(`/uploads/${OLD}`, 'other')).status, 404);
  assert.equal((await request(`/uploads/${OLD}`)).status, 401);
  assert.equal((await request(`/uploads/${OLD}`, 'owner')).status, 200);
});
