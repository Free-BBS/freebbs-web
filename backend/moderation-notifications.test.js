const test = require('node:test');
const assert = require('node:assert/strict');
const { notifyAuthor, sendModerationNotice } = require('./moderation-notifications');

test('publication only updates the author waiting notice without resetting read state or sending email', async () => {
  for (const existing of [true, false]) {
    const calls = [];
    const db = {
      execute: async (sql, args) => {
        calls.push({ sql, args });
        return [{ affectedRows: existing ? 1 : 0 }];
      },
    };
    await notifyAuthor(
      db,
      {
        notifyModeration() {
          throw new Error('must not send');
        },
      },
      {
        id: 'submission-1',
        authorId: 2,
        status: 'approved',
        publishedUrl: '/discussion?post=p1#comment-2',
      },
    );
    assert.equal(calls.length, 1);
    assert.match(
      calls[0].sql,
      /^UPDATE community_notifications SET title = \?, body = \?, link = \?/,
    );
    assert.doesNotMatch(calls[0].sql, /read_at|created_at|INSERT|email_outbox/);
    assert.deepEqual(calls[0].args.slice(2), [
      '/discussion?post=p1#comment-2',
      2,
      'moderation-author:submission-1:pending',
    ]);
  }
});

test('author notices keep previews generic, use author detail links and separate lifecycle events', async () => {
  const sent = [];
  const updates = [];
  const db = {
    execute: async (sql, args) => {
      updates.push({ sql, args });
    },
  };
  const notifications = { notifyModeration: async (data) => sent.push(data) };
  for (const status of ['pending', 'rejected', 'withdrawn', 'expired'])
    await notifyAuthor(db, notifications, {
      id: 's1',
      authorId: 2,
      status,
      title: '私密标题',
      reason: '政治内容',
      content: '心理关怀',
    });
  assert.deepEqual(
    sent.map((item) => item.eventKey),
    [
      'moderation-author:s1:pending',
      'moderation-author:s1:rejected',
      'moderation-author:s1:withdrawn',
      'moderation-author:s1:expired',
    ],
  );
  assert.ok(sent.every((item) => item.link === '/moderation?mine=1&id=s1'));
  assert.ok(sent.every((item) => item.recipients.length === 1 && item.recipients[0] === 2));
  assert.doesNotMatch(JSON.stringify(sent), /私密标题|政治内容|心理关怀/);
  assert.match(sent[0].title, /等待处理/);
  assert.match(sent[1].body, /处理详情.*异议/);
  assert.match(sent[2].title, /撤回/);
  assert.match(sent[3].body, /材料已到期/);
  assert.equal(updates.length, 3);
  assert.ok(updates.every((item) => item.args[4] === 'moderation-author:s1:pending'));
  assert.deepEqual(
    updates.map((item) => item.args[0]),
    sent.slice(1).map((item) => item.title),
  );
});

test('shared notification insertion deduplicates audience without overwriting prior read state', async () => {
  const calls = [];
  await sendModerationNotice(
    {
      execute: async (sql, args) => {
        calls.push({ sql, args });
      },
    },
    null,
    {
      recipients: [3, 1, 3, 0, null],
      title: '负责人复核',
      body: '请查看',
      link: '/moderation?id=s1',
      eventKey: 'reviewer:s1',
    },
  );
  assert.deepEqual(
    calls.map((item) => item.args[0]),
    [1, 3],
  );
  assert.ok(
    calls.every((item) => /ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID\(id\)/.test(item.sql)),
  );
  assert.ok(calls.every((item) => !/read_at|created_at|email_outbox/.test(item.sql)));
});
