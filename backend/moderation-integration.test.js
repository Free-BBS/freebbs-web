const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const sharp = require('sharp');
const { randomUUID } = require('node:crypto');
const { createModerationRouter } = require('./moderation-router');
const { createModerationPublisher } = require('./moderation-publisher');

async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

test('actual upload routes keep discussion case/slash variants private and circuit reports separate', async (t) => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = source.indexOf('function createImageUploadHandler(');
  const end = source.indexOf('\napp.use(', start);
  assert.ok(start >= 0 && end > start);
  const app = express();
  app.use(express.json());
  const privateWrites = [];
  const publicWrites = [];
  let failPrivate = false;
  const config = { discussionModerationEnabled: true, uploadDir: path.resolve('virtual-uploads') };
  const context = {
    app,
    config,
    Buffer,
    sharp,
    path,
    requireAuth: async (request, response) => {
      if (request.headers.authorization !== 'Bearer test-only') {
        response.status(401).json({ message: 'login' });
        return null;
      }
      return { id: 7 };
    },
    moderationAttachments: {
      store: async ({ ownerId, buffer }) => {
        assert.equal(ownerId, 7);
        assert.equal((await sharp(buffer).metadata()).format, 'webp');
        if (failPrivate)
          throw Object.assign(new Error('Private storage unavailable'), { status: 503 });
        const id = randomUUID();
        privateWrites.push({ ownerId, buffer, id });
        return { id, url: `/api/moderation/attachments/${id}` };
      },
    },
    buildDiscussionImageFileName: (userId) => `user-${userId}-${randomUUID()}.webp`,
    fs: {
      promises: {
        writeFile: async (fileName, buffer) => {
          assert.equal(path.dirname(fileName), config.uploadDir);
          assert.equal((await sharp(buffer).metadata()).format, 'webp');
          publicWrites.push({ fileName, buffer });
        },
      },
    },
  };
  vm.runInNewContext(source.slice(start, end), context);
  const base = await listen(t, app);
  const input = await sharp({
    create: { width: 20, height: 10, channels: 3, background: '#27808d' },
  })
    .png()
    .toBuffer();
  const body = JSON.stringify({
    imageDataUrl: `data:image/png;base64,${input.toString('base64')}`,
    contentType: 'circuit-report',
    ownerId: 999,
  });
  const upload = (route, authenticated = true) =>
    fetch(`${base}${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { Authorization: 'Bearer test-only' } : {}),
      },
      body,
    });
  for (const route of [
    '/api/discussion/uploads/images',
    '/api/discussion/uploads/images/',
    '/API/DISCUSSION/UPLOADS/IMAGES',
    '/Api/Discussion/Uploads/Images/',
    '/api/discussion/uploads/images/?contentType=circuit-report',
  ]) {
    const response = await upload(route);
    assert.equal(response.status, 201, route);
    const result = await response.json();
    assert.match(result.url, /^\/api\/moderation\/attachments\//);
    assert.match(result.previewDataUrl, /^data:image\/webp;base64,/);
    assert.equal(publicWrites.length, 0);
  }
  assert.equal(privateWrites.length, 5);
  assert.equal((await upload('/API/DISCUSSION/UPLOADS/IMAGES/', false)).status, 401);
  assert.equal(privateWrites.length, 5);
  assert.equal(publicWrites.length, 0);

  for (const route of [
    '/api/circuit-report/uploads/images',
    '/api/circuit-report/uploads/images/',
    '/API/CIRCUIT-REPORT/UPLOADS/IMAGES/',
  ]) {
    const response = await upload(route);
    assert.equal(response.status, 201);
    assert.match((await response.json()).url, /^\/uploads\//);
  }
  assert.equal(privateWrites.length, 5);
  assert.equal(publicWrites.length, 3);

  failPrivate = true;
  assert.equal((await upload('/API/DISCUSSION/UPLOADS/IMAGES/')).status, 503);
  assert.equal(
    publicWrites.length,
    3,
    'Private-storage failures must not fall back to public files',
  );
  config.discussionModerationEnabled = false;
  const legacy = await upload('/Api/Discussion/Uploads/Images/');
  assert.equal(legacy.status, 201);
  assert.match((await legacy.json()).url, /^\/uploads\//);
  assert.equal(publicWrites.length, 4);
});

test('actual discussion handlers quarantine posts/comments without publishing, rewards or Max', async (t) => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const app = express();
  app.use(express.json());
  const submissions = [];
  const connection = {
    execute: async () => {
      throw new Error('Unexpected public write');
    },
  };
  const context = {
    app,
    config: { discussionModerationEnabled: true },
    PRIVACY_POLICY_VERSION: 'test-global-policy',
    ensureDiscussionTables: async () => {},
    requireAuth: async () => ({ id: 7, username: 'writer', is_admin: false }),
    getDiscussionBoardBySlug: async () => ({ id: 2, slug: 'daily' }),
    getDiscussionPostByPublicId: async () => ({ id: 5, pid: 'post-five' }),
    canReadPost: () => true,
    lockPublicPost: async () => {},
    validateModerationMarkdown: () => [],
    withDatabaseTransaction: (callback) => callback(connection),
    discussionModeration: {
      submit: async (_connection, input) => {
        submissions.push(input);
        return { id: randomUUID(), status: 'pending', version: 1 };
      },
    },
  };
  for (const [start, end] of [
    ["app.post('/api/discussion/posts',", "app.patch('/api/discussion/posts/:id/login-required'"],
    ["app.post('/api/discussion/posts/:id/comments',", "app.delete('/api/discussion/posts/:id',"],
  ]) {
    vm.runInNewContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
  }
  const base = await listen(t, app);
  for (const [url, body] of [
    [
      '/api/discussion/posts',
      {
        boardSlug: 'daily',
        title: '合成测试',
        contentMarkdown: '待审正文',
        requestId: randomUUID(),
        moderationNoticeVersion: 'forged-client-version',
      },
    ],
    [
      '/api/discussion/posts/post-five/comments',
      { contentMarkdown: '@max 待审回复', requestId: randomUUID() },
    ],
  ]) {
    const response = await fetch(base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.equal(result.moderation.status, 'pending');
    assert.equal(result.post, undefined);
    assert.equal(result.comment, undefined);
  }
  assert.equal(submissions.length, 2);
  assert.equal(submissions[0].kind, 'post');
  assert.equal(submissions[1].kind, 'comment');
  assert.equal(submissions[1].authorId, 7);
  assert.equal(submissions[0].moderationNoticeVersion, 'test-global-policy');
  assert.equal(submissions[1].moderationNoticeVersion, 'test-global-policy');
});

test('review HTTP uses current authenticated identity and never exposes private paths', async (t) => {
  const app = express();
  app.use(express.json());
  let received;
  app.use(
    '/api/moderation',
    createModerationRouter({
      enabled: true,
      requireAuth: async (request, response) => {
        if (!request.headers.authorization) {
          response.status(401).json({ message: 'login' });
          return null;
        }
        return { id: 9, is_admin: false };
      },
      getOptionalAuthUser: async (request) => (request.headers.authorization ? { id: 9 } : null),
      service: {
        isReviewer: async () => true,
        decide: async (input) => {
          received = input;
          return { id: input.id, status: 'approved' };
        },
      },
      attachmentStore: {
        read: async ({ userId }) => {
          if (userId !== 9) throw Object.assign(new Error('unavailable'), { status: 404 });
          return { buffer: Buffer.from('synthetic image') };
        },
      },
    }),
  );
  const base = await listen(t, app);
  const id = randomUUID();
  const decisionPath = `/api/moderation/submissions/${id}/decision`;
  assert.equal((await fetch(base + decisionPath, { method: 'POST' })).status, 401);
  const response = await fetch(base + decisionPath, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      decision: 'approved',
      reviewerId: 999,
      requestId: randomUUID(),
      expectedVersion: 1,
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(received.reviewerId, 9);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await fetch(`${base}/api/moderation/attachments/${id}`)).status, 404);
  const image = await fetch(`${base}/api/moderation/attachments/${id}`, {
    headers: { Authorization: 'Bearer test-only' },
  });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.equal(image.headers.get('cache-control'), 'private, no-store');
});

test('publication rechecks destination and keeps rewards/notifications in supplied transaction', async () => {
  const effects = [];
  let boardActive = true;
  const connection = {
    execute: async (sql) => {
      if (sql.includes('FROM users')) return [[{ id: 7, username: 'writer', is_admin: false }]];
      if (sql.includes('FROM discussion_boards'))
        return [[{ id: 2, slug: 'daily', is_active: boardActive ? 1 : 0 }]];
      if (sql.startsWith('INSERT INTO discussion_posts')) {
        effects.push('insert');
        return [{ insertId: 10 }];
      }
      throw new Error(sql);
    },
  };
  const publish = createModerationPublisher({
    createPostPid: async (executor) => {
      assert.equal(
        executor,
        connection,
        'PID generation must reuse the held transaction connection',
      );
      return 'new-post';
    },
    awardMagnetic: async (executor) => {
      assert.equal(executor, connection);
      effects.push('reward');
    },
    notifications: {
      notifyMentions: async (_event, executor) => {
        assert.equal(executor, connection);
        effects.push('notify');
      },
    },
  });
  const submission = {
    kind: 'post',
    authorId: 7,
    payload: { boardId: 2, title: 'synthetic', content: 'safe', loginRequired: true },
  };
  boardActive = false;
  await assert.rejects(publish(connection, submission), { status: 409 });
  assert.deepEqual(effects, []);
  boardActive = true;
  const result = await publish(connection, submission);
  assert.deepEqual(effects, ['insert', 'reward', 'notify']);
  assert.equal(result.publishedUrl, '/discussion?post=new-post');
});
