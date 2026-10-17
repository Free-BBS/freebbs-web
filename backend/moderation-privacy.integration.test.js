const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const express = require('express');
const { createDiscussionModeration } = require('./discussion-moderation');
const { createModerationRouter } = require('./moderation-router');
const { normalizePrivacyText } = require('./moderation-privacy');

function harness(options = {}) {
  const row = {
    id: randomUUID(),
    kind: 'post',
    author_id: 2,
    payload_json: JSON.stringify({
      title: '张三的联系方式',
      content: '张三的邮箱是 zhangsan@example.com，学号 2026123456，代号紫色风铃。',
    }),
    attachment_ids_json: JSON.stringify([randomUUID()]),
    content_hash: 'a'.repeat(64),
    status: 'pending',
    version: 1,
    evidence_expired: 0,
    evidence_purged_at: null,
    ...options.row,
  };
  const directory = options.directory || [
    {
      full_name: '张三',
      student_id: '2026123456',
      email: 'zhangsan@example.com',
      username: 'directory-private-username',
      password_hash: 'directory-secret-password',
      extra: 'directory-secret-extra',
    },
  ];
  const calls = [];
  const events = [];
  const reviewers = new Set(options.reviewers || [1]);
  let reads = 0;
  const connection = {
    async beginTransaction() {
      events.push('begin');
    },
    async commit() {
      events.push('commit');
    },
    async rollback() {
      events.push('rollback');
    },
    release() {
      events.push('release');
    },
    async execute(sql, parameters = []) {
      calls.push({ sql, parameters });
      assert.match(sql, /^SELECT /);
      if (sql.includes('FROM moderation_reviewers')) {
        assert.match(sql, /active = 1 FOR SHARE$/);
        return [reviewers.has(parameters[0]) ? [{ user_id: parameters[0] }] : []];
      }
      if (sql.includes('FROM moderation_submissions s')) {
        assert.match(sql, /FOR UPDATE$/);
        reads += 1;
        if (options.afterRead) options.afterRead(row, reads);
        return [[...(options.missing ? [] : [row])]];
      }
      if (sql.includes('FROM users')) {
        assert.match(sql, /^SELECT full_name, student_id, email FROM users/);
        assert.match(sql, /LIMIT 501$/);
        assert.equal(parameters.length, 3);
        assert.equal(parameters[0], parameters[1]);
        assert.equal(parameters[1], parameters[2]);
        if (options.directoryError) throw options.directoryError;
        return [directory];
      }
      throw new Error(
        'Unexpected access: only moderation snapshot and matching identities allowed',
      );
    },
  };
  const service = createDiscussionModeration({
    pool: { getConnection: async () => connection },
    publishSubmission: () => assert.fail('Preview must not publish'),
    notifications: { notifyModeration: () => assert.fail('Preview must not send notifications') },
  });
  const input = { id: row.id, reviewerId: 1, expectedVersion: 1, extraTerms: ['紫色风铃'] };
  return { service, row, calls, events, input, reviewers };
}

test('privacy preview uses the locked server snapshot and never writes, reads secrets or sends data', async (t) => {
  const h = harness();
  const before = JSON.stringify(h.row);
  t.mock.method(globalThis, 'fetch', () => assert.fail('No external requests permitted'));
  for (const method of ['readFile', 'open', 'readdir'])
    t.mock.method(fs, method, () => assert.fail('No files or secrets may be read by preview'));
  const preview = await h.service.previewPrivacy(h.input);
  assert.equal(preview.submissionId, h.row.id);
  assert.equal(preview.version, 1);
  assert.equal(preview.contentHash, h.row.content_hash);
  assert.equal(preview.mode, 'local_preview');
  assert.equal(preview.externalReady, false);
  assert.equal(preview.imagesProcessed, false);
  assert.equal(preview.imageCount, 1);
  assert.doesNotMatch(
    JSON.stringify(preview),
    /张三|2026123456|zhangsan@example\.com|紫色风铃|directory-private|directory-secret/,
  );
  assert.equal(JSON.stringify(h.row), before);
  assert.deepEqual(h.events, ['begin', 'commit', 'release']);
  assert.equal(h.calls.length, 4);
  assert.match(h.calls[0].sql, /moderation_reviewers/);
  assert.match(h.calls[1].sql, /moderation_submissions/);
  assert.match(h.calls[2].sql, /FROM users/);
  assert.match(h.calls[3].sql, /moderation_submissions/);
});

test('author, non-reviewer administrator and revoked reviewer cannot request a preview', async () => {
  for (const reviewerId of [2, 3, 1]) {
    const h = harness();
    if (reviewerId === 1) h.reviewers.delete(1);
    await assert.rejects(h.service.previewPrivacy({ ...h.input, reviewerId }), { status: 403 });
    assert.equal(h.calls.length, 1, 'No snapshot or directory read for a non-reviewer');
    assert.deepEqual(h.events, ['begin', 'rollback', 'release']);
  }
});

test('processed, expired, purged, missing and stale snapshots cannot produce a preview', async () => {
  for (const row of [
    { status: 'approved' },
    { status: 'rejected' },
    { status: 'expired' },
    { version: 2 },
    { evidence_expired: 1 },
    { evidence_purged_at: new Date() },
    { payload_json: null },
  ]) {
    const h = harness({ row });
    await assert.rejects(h.service.previewPrivacy(h.input), { status: 409 });
    assert.equal(h.calls.length, 2, 'Reject before the directory query');
  }
  const missing = harness({ missing: true });
  await assert.rejects(missing.service.previewPrivacy(missing.input), { status: 404 });
});

test('preview checks expiry again after local processing under the same transaction locks', async () => {
  const h = harness({
    afterRead: (row, count) => {
      if (count === 2) row.evidence_expired = 1;
    },
  });
  await assert.rejects(h.service.previewPrivacy(h.input), { status: 409 });
  assert.equal(h.calls.length, 4);
  assert.deepEqual(h.events, ['begin', 'rollback', 'release']);
});

test('directory matching is parameterized over normalized server text and capped without silent truncation', async () => {
  const payload = { title: '张&#x4E09;', content: "ＡＢＣ\u200b'; DROP TABLE users; --" };
  const h = harness({ row: { payload_json: JSON.stringify(payload) }, directory: [] });
  await h.service.previewPrivacy(h.input);
  const query = h.calls.find((call) => call.sql.includes('FROM users'));
  assert.equal(query.parameters[0], normalizePrivacyText(`${payload.title}\n${payload.content}`));
  assert.doesNotMatch(query.sql, /DROP TABLE|张三|ＡＢＣ/);
  const limited = harness({
    directory: Array.from({ length: 501 }, () => ({ full_name: '张三' })),
  });
  await assert.rejects(limited.service.previewPrivacy(limited.input), {
    status: 409,
    message: '目录命中数量过多，本次无法完成本地检查。',
  });
  assert.deepEqual(limited.events, ['begin', 'rollback', 'release']);
});

test('directory lookup and preview preserve the same normalized text without joining split names', async () => {
  for (const content of ['张**三**认为收费不合理。', '**张**三认为收费不合理。']) {
    const h = harness({
      row: { payload_json: JSON.stringify({ title: '普通讨论', content }) },
      directory: [],
    });
    const result = await h.service.previewPrivacy({ ...h.input, extraTerms: [] });
    const query = h.calls.find((call) => call.sql.includes('FROM users'));
    assert.equal(query.parameters[0], normalizePrivacyText(`普通讨论\n${content}`));
    assert.equal(result.content, normalizePrivacyText(content));
    assert.ok(
      !result.content.includes('张三'),
      'Preview must not assemble an unmasked directory name',
    );
    assert.equal(result.externalReady, false);
  }
});

test('preview validates bounded extra terms and version without treating client fields as content', async () => {
  for (const invalid of [
    { expectedVersion: '1' },
    { expectedVersion: 0 },
    { extraTerms: null },
    { extraTerms: {} },
    { extraTerms: [1] },
    { extraTerms: [''] },
    { extraTerms: ['\u200b'] },
    { extraTerms: ['x'.repeat(129)] },
    { extraTerms: Array.from({ length: 51 }, () => '词语') },
  ]) {
    const h = harness();
    await assert.rejects(h.service.previewPrivacy({ ...h.input, ...invalid }), { status: 400 });
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  const preview = await h.service.previewPrivacy({
    ...h.input,
    title: 'client-title-secret',
    content: 'client-content-secret',
    identities: [{ full_name: 'client-identity-secret' }],
  });
  assert.doesNotMatch(JSON.stringify(preview), /client-(title|content|identity)-secret/);
});

test('directory and malformed-record errors are fixed messages without database or text reflection', async () => {
  for (const options of [
    { directoryError: new Error('SECRET original row and SQL') },
    { directoryError: Object.assign(new Error('SECRET original row and SQL'), { status: 400 }) },
    { row: { payload_json: '{SECRET invalid JSON' } },
    { row: { attachment_ids_json: '{SECRET invalid JSON' } },
  ]) {
    const h = harness(options);
    await assert.rejects(h.service.previewPrivacy(h.input), (error) => {
      assert.doesNotMatch(error.message, /SECRET|SQL|JSON/);
      assert.ok([400, 503].includes(error.status));
      return true;
    });
  }
});

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

test('actual preview route enforces reviewer access, server-owned content, version and no-store', async (t) => {
  const h = harness();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/moderation',
    createModerationRouter({
      service: h.service,
      enabled: true,
      requireAuth: async (request, response) => {
        const accounts = {
          reviewer: { id: 1 },
          author: { id: 2 },
          admin: { id: 3, is_admin: true },
        };
        const user = accounts[String(request.headers.authorization || '').replace('Bearer ', '')];
        if (!user) response.status(401).json({ message: '请先登录' });
        return user;
      },
    }),
  );
  const origin = await listen(t, app);
  const request = (role, body = { expectedVersion: 1, extraTerms: ['紫色风铃'] }) =>
    fetch(`${origin}/api/moderation/submissions/${h.row.id}/privacy-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${role}` },
      body: JSON.stringify(body),
    });
  for (const [role, status] of [
    ['anonymous', 401],
    ['author', 403],
    ['admin', 403],
  ])
    assert.equal((await request(role)).status, status);
  const response = await request('reviewer');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['preview']);
  assert.equal(body.preview.submissionId, h.row.id);
  assert.equal(body.preview.externalReady, false);
  assert.doesNotMatch(JSON.stringify(body), /张三|zhangsan@example\.com|directory-secret/);
  for (const extra of [
    { title: 'client-private-text' },
    { content: 'client-private-text' },
    { identities: [{ full_name: 'client-private-text' }] },
    { reviewerId: 1 },
    { attachments: ['https://example.com/raw-private.png'] },
  ]) {
    const rejected = await request('reviewer', { expectedVersion: 1, ...extra });
    assert.equal(rejected.status, 400);
    assert.doesNotMatch(await rejected.text(), /client-private-text|raw-private/);
  }
  assert.equal((await request('reviewer', { expectedVersion: 2 })).status, 409);
  h.row.evidence_expired = 1;
  assert.equal((await request('reviewer')).status, 409);
  h.reviewers.delete(1);
  assert.equal((await request('reviewer')).status, 403);
});
