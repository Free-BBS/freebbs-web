const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  canonicalJson,
  normalizeSubmission,
  createDiscussionModeration,
} = require('./discussion-moderation');

const post = (extra = {}) => ({
  kind: 'post',
  authorId: 2,
  requestId: randomUUID(),
  payload: {
    boardId: 1,
    title: '待审核帖子',
    content: '普通正文',
    anonymous: false,
    loginRequired: true,
  },
  attachmentIds: [],
  ...extra,
});

test('submission identity includes kind, immutable payload and the exact private image set', () => {
  const input = post();
  const first = normalizeSubmission(input);
  const reordered = {
    ...input,
    payload: Object.fromEntries(Object.entries(input.payload).reverse()),
  };
  assert.equal(normalizeSubmission(reordered).contentHash, first.contentHash);
  assert.notEqual(
    normalizeSubmission({ ...input, payload: { ...input.payload, title: '修改标题' } }).contentHash,
    first.contentHash,
  );
  input.payload.title = '随后修改';
  assert.equal(first.payload.title, '待审核帖子');
  const id = randomUUID();
  const withImage = post({
    payload: { ...first.payload, content: `![图](/api/moderation/attachments/${id})` },
    attachmentIds: [id],
  });
  assert.deepEqual(normalizeSubmission(withImage).attachmentIds, [id]);
  assert.throws(() => normalizeSubmission({ ...withImage, attachmentIds: [] }), { status: 400 });
  assert.throws(() => normalizeSubmission({ ...withImage, attachmentIds: [randomUUID()] }), {
    status: 400,
  });
  assert.throws(() => normalizeSubmission(post({ attachmentIds: [id] })), { status: 400 });
});

test('submission validation rejects external images, invalid IDs and unserializable values', () => {
  for (const input of [
    post({ authorId: true }),
    post({ authorId: '9007199254740993' }),
    post({ requestId: "injection';" }),
    post({ kind: 'admin' }),
    post({ payload: { boardId: 1, title: '图片', content: '![图](https://example.com/raw.png)' } }),
    post({ payload: { boardId: 0, title: '图片', content: '内容' } }),
    post({ payload: { boardId: 1, title: '内容', content: '内容', bad: undefined } }),
    post({ payload: { boardId: 1, title: '内容', content: '内容', bad: Infinity } }),
  ])
    assert.throws(
      () => normalizeSubmission(input),
      (error) => error.status >= 400,
    );
  assert.equal(
    canonicalJson({ z: [1, false, null], a: '正文' }),
    '{"a":"正文","z":[1,false,null]}',
  );
});

function decisionHarness(extra = {}) {
  const source = normalizeSubmission(post());
  const row = {
    id: randomUUID(),
    kind: 'post',
    author_id: 2,
    username: 'author',
    payload_json: source.payloadJson,
    attachment_ids_json: '[]',
    content_hash: source.contentHash,
    status: 'pending',
    version: 1,
    evidence_expired: 0,
    evidence_purged_at: null,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 86400000),
    ...extra,
  };
  const calls = [];
  let reviewer = true;
  let published = 0;
  let committed = false;
  const executor = {
    async execute(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.includes('FROM moderation_reviewers')) return [reviewer ? [{ user_id: 1 }] : []];
      if (sql.includes('FROM moderation_submissions s')) return [[row]];
      if (sql.includes('FROM moderation_attachments')) return [[]];
      if (sql.startsWith('UPDATE moderation_submissions')) {
        Object.assign(row, {
          status: parameters[0],
          version: row.version + 1,
          decided_by: parameters[1],
          decision_reason: parameters[2],
          decision_request_id: parameters[3],
          decision_hash: parameters[4],
          published_id: parameters[5],
          published_url: parameters[6],
        });
        return [{ affectedRows: 1 }];
      }
      if (
        sql.startsWith('UPDATE moderation_attachments') ||
        sql.startsWith('UPDATE community_notifications') ||
        sql.startsWith('INSERT INTO community_notifications')
      )
        return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL ${sql}`);
    },
  };
  const service = createDiscussionModeration({
    pool: executor,
    withDatabaseTransaction: async (callback) => {
      const value = await callback(executor);
      committed = true;
      return value;
    },
    publishSubmission: async (connection, submission) => {
      assert.equal(connection, executor);
      assert.equal(submission.payload.content, '普通正文');
      published += 1;
      return { publishedId: 42, publishedUrl: '/discussion?post=p_test' };
    },
    onPublished: () => {
      assert.equal(committed, true);
      throw new Error('follow-up unavailable');
    },
    logger: { error() {} },
  });
  return {
    service,
    row,
    calls,
    revoke: () => {
      reviewer = false;
    },
    published: () => published,
  };
}

test('expired, processed, wrong-version and revoked-reviewer decisions never call publication', async () => {
  for (const extra of [
    { evidence_expired: 1 },
    { evidence_purged_at: new Date() },
    { status: 'rejected' },
    { version: 2 },
  ]) {
    const h = decisionHarness(extra);
    await assert.rejects(
      h.service.decide({
        id: h.row.id,
        reviewerId: 1,
        decision: 'approved',
        requestId: randomUUID(),
        expectedVersion: 1,
      }),
      { status: 409 },
    );
    assert.equal(h.published(), 0);
  }
  const h = decisionHarness();
  h.revoke();
  await assert.rejects(
    h.service.decide({
      id: h.row.id,
      reviewerId: 1,
      decision: 'approved',
      requestId: randomUUID(),
      expectedVersion: 1,
    }),
    { status: 403 },
  );
  assert.equal(h.published(), 0);
});

test('approval is idempotent, keeps notification body generic and isolates after-commit failures', async () => {
  const h = decisionHarness();
  const input = {
    id: h.row.id,
    reviewerId: 1,
    decision: 'approved',
    requestId: randomUUID(),
    expectedVersion: 1,
  };
  const first = await h.service.decide(input);
  assert.equal(first.status, 'approved');
  assert.equal(first.version, 2);
  assert.equal(first.publishedId, '42');
  assert.equal((await h.service.decide(input)).replayed, true);
  assert.equal(h.published(), 1);
  assert.match(h.calls[0].sql, /FOR SHARE/);
  const notice = h.calls.find((call) => call.sql.startsWith('UPDATE community_notifications'));
  assert.ok(notice);
  assert.equal(
    h.calls.some((call) => call.sql.startsWith('INSERT INTO community_notifications')),
    false,
  );
  assert.equal(notice.parameters[2], '/discussion?post=p_test');
  assert.equal(notice.parameters[4], `moderation-author:${h.row.id}:pending`);
  assert.doesNotMatch(JSON.stringify(notice.parameters), /普通正文|待审核帖子/);
  await assert.rejects(h.service.decide({ ...input, decision: 'rejected', reason: '调整决定' }), {
    status: 409,
  });
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
});

test('rejection requires a reason and never invokes publishing', async () => {
  const h = decisionHarness();
  const input = {
    id: h.row.id,
    reviewerId: 1,
    decision: 'rejected',
    requestId: randomUUID(),
    expectedVersion: 1,
  };
  await assert.rejects(h.service.decide(input), { status: 400 });
  const result = await h.service.decide({ ...input, reason: '请删除公开的个人联系方式。' });
  assert.equal(result.status, 'rejected');
  assert.equal(h.published(), 0);
});

test('published attachment reads recheck current post visibility and login requirements', async () => {
  const id = randomUUID();
  const attachment = {
    id,
    author_id: 2,
    file_name: `${id}.webp`,
    mime_type: 'image/webp',
    byte_size: 4,
    sha256: 'a'.repeat(64),
    published_id: 42,
    submission_id: randomUUID(),
    kind: 'post',
    expired: 1,
  };
  let current = { id: 42, user_id: 2, is_deleted: 0, is_hidden: 0, login_required: 1 };
  const pool = {
    async execute(sql) {
      if (sql.includes('FROM moderation_attachments')) return [[attachment]];
      if (sql.includes('FROM discussion_posts')) return [[current]];
      throw new Error(`Unexpected SQL ${sql}`);
    },
  };
  const service = createDiscussionModeration({ pool });
  await assert.rejects(service.getAttachment({ id }), { status: 404 });
  assert.equal((await service.getAttachment({ id, userId: 3 })).access, 'published');
  current = { ...current, is_hidden: 1 };
  await assert.rejects(service.getAttachment({ id, userId: 3 }), { status: 404 });
  assert.equal((await service.getAttachment({ id, userId: 2 })).access, 'published');
  current = { ...current, is_hidden: 0, is_deleted: 1 };
  await assert.rejects(service.getAttachment({ id, userId: 2 }), { status: 404 });
});

test('expired detail suppresses the raw evidence even before the cleanup timer runs', async () => {
  const h = decisionHarness({
    evidence_expired: 1,
    decision_reason: '姓名隐私',
    status: 'pending',
  });
  const result = await h.service.detail({ id: h.row.id, userId: 2 });
  assert.equal(result.status, 'expired');
  assert.equal(result.payload, null);
  assert.deepEqual(result.attachments, []);
  assert.equal(result.reason, '');
  assert.doesNotMatch(JSON.stringify(result), /普通正文|待审核帖子|姓名隐私/);
});

test('orphan cleanup only removes aged UUID files after the database confirms no record', async (t) => {
  const privateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freebbs-orphan-test-'));
  assert.equal(path.dirname(path.resolve(privateDir)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(privateDir).startsWith('freebbs-orphan-test-'));
  t.after(() => fs.rm(privateDir, { recursive: true, force: true }));
  const oldFile = path.join(privateDir, `${randomUUID()}.webp`);
  const freshFile = path.join(privateDir, `${randomUUID()}.webp`);
  const retainedFile = path.join(privateDir, `${randomUUID()}.webp`);
  const unrelated = path.join(privateDir, 'do-not-delete.txt');
  await Promise.all(
    [oldFile, freshFile, retainedFile, unrelated].map((file) => fs.writeFile(file, 'fixture')),
  );
  const oldTime = new Date(Date.now() - 91 * 86400000);
  const retainedTime = new Date(Date.now() - 31 * 86400000);
  await fs.utimes(oldFile, oldTime, oldTime);
  await fs.utimes(retainedFile, retainedTime, retainedTime);
  let unavailable = true;
  const pool = {
    async execute(sql) {
      if (sql.includes('WHERE id = ? OR file_name = ?')) {
        if (unavailable) throw new Error('database unavailable');
        return [[]];
      }
      if (
        sql.startsWith('SELECT id FROM moderation_submissions') ||
        sql.startsWith('SELECT id, file_name FROM moderation_attachments')
      )
        return [[]];
      throw new Error(`Unexpected SQL ${sql}`);
    },
  };
  const service = createDiscussionModeration({ pool, privateDir });
  assert.equal((await service.expireAndPurge()).filesDeferred, 1);
  await fs.stat(oldFile);
  unavailable = false;
  assert.equal((await service.expireAndPurge()).orphansPurged, 1);
  await assert.rejects(fs.stat(oldFile), { code: 'ENOENT' });
  await fs.stat(freshFile);
  await fs.stat(retainedFile);
  await fs.stat(unrelated);
});
