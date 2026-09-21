const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const {
  postAuthorReward,
  validateReward,
  createAdminRewardsService,
  createAdminRewardsRouter,
} = require('./admin-rewards');
const { createNotificationService } = require('./notifications');

const reward = (extra = {}) => ({
  requestId: 'reward-test-request-0001',
  userIds: [2, 3],
  electric: 20,
  magnetic: 3,
  title: '优秀问题反馈',
  reason: '发现并协助复现问题',
  ...extra,
});
function harness() {
  let data = {
    users: [2, 3].map((id) => ({
      id,
      username: `reader${id}`,
      full_name: '同学',
      student_id: `202600000${id}`,
      electrons: 10,
      manetrons: 5,
    })),
    batches: [],
    entries: [],
    notifications: [],
    ledger: [],
  };
  let queue = Promise.resolve();
  const pool = {
    calls: [],
    failNotification: false,
    get data() {
      return data;
    },
    async query() {
      return [];
    },
    async execute(sql, args = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      pool.calls.push({ sql: s, args });
      if (s.startsWith('CREATE TABLE')) return [];
      if (s.includes('information_schema.TRIGGERS')) return [[{ TRIGGER_NAME: args[0] }]];
      if (s.startsWith('UPDATE wallet_ledger')) {
        const entry = data.ledger.filter((r) => r.user_id === args[3]).at(-1);
        Object.assign(entry, { source_key: args[0], title: args[1], reason: args[2] });
        return [{ affectedRows: 1 }];
      }
      if (s.startsWith('INSERT INTO admin_reward_batches')) {
        if (!data.batches.some((b) => b.actor_id === args[0] && b.request_id === args[1]))
          data.batches.push({
            id: data.batches.length + 1,
            actor_id: args[0],
            request_id: args[1],
            fingerprint: args[2],
            result_json: null,
          });
        return [{}];
      }
      if (s.startsWith('SELECT id, fingerprint'))
        return [data.batches.filter((b) => b.actor_id === args[0] && b.request_id === args[1])];
      if (s.startsWith('SELECT id, username'))
        return [data.users.filter((u) => args.includes(u.id))];
      if (s.startsWith('UPDATE users')) {
        const user = data.users.find((u) => u.id === args[2]);
        data.ledger.push({
          user_id: user.id,
          electric_before: user.electrons,
          electric_after: user.electrons + args[0],
          magnetic_before: user.manetrons,
          magnetic_after: user.manetrons + args[1],
        });
        user.electrons += args[0];
        user.manetrons += args[1];
        return [{ affectedRows: 1 }];
      }
      if (s.startsWith('INSERT INTO admin_reward_entries')) {
        data.entries.push(args);
        return [{}];
      }
      if (s.startsWith('INSERT INTO community_notifications')) {
        if (pool.failNotification) throw new Error('injected notification failure');
        data.notifications.push(args);
        return [{ insertId: data.notifications.length }];
      }
      if (s.startsWith('UPDATE admin_reward_batches')) {
        data.batches.find((b) => b.id === args[1]).result_json = args[0];
        return [{}];
      }
      throw new Error(`Unexpected SQL: ${s}`);
    },
    async getConnection() {
      let releaseLock;
      let before;
      return {
        execute: pool.execute,
        async beginTransaction() {
          const previous = queue;
          queue = new Promise((resolve) => {
            releaseLock = resolve;
          });
          await previous;
          before = structuredClone(data);
        },
        async commit() {
          return true;
        },
        async rollback() {
          data = before;
        },
        release() {
          releaseLock();
        },
      };
    },
  };
  const notifications = createNotificationService({ pool });
  return { pool, service: createAdminRewardsService({ pool, notifications }) };
}

test('validates positive additive rewards, deduplicates and sorts recipients', () => {
  const a = validateReward(reward({ userIds: ['3', 2, 2] }));
  assert.deepEqual(a.userIds, [2, 3]);
  assert.equal(a.fingerprint, validateReward(reward()).fingerprint);
  for (const extra of [
    { userIds: [] },
    { userIds: Array(101).fill(2) },
    { userIds: [-1] },
    { userIds: [[2]] },
    { electric: -1 },
    { electric: 1.1 },
    { electric: '20' },
    { electric: true },
    { electric: 1000001 },
    { electric: 0, magnetic: 0 },
    { title: '' },
    { reason: ' ' },
    { reason: 'a'.repeat(1001) },
    { requestId: [] },
    { requestId: 'short' },
  ])
    assert.throws(() => validateReward(reward(extra)), undefined, JSON.stringify(extra));
  assert.throws(() => validateReward(null));
});
test('credits selected users and records before/after balances with one station notification each', async () => {
  const { pool, service } = harness();
  const result = await service.grant({ id: 1 }, reward());
  assert.equal(result.recipientCount, 2);
  assert.equal(result.totalElectric, 40);
  assert.equal(result.totalMagnetic, 6);
  assert.deepEqual(
    pool.data.users.map((u) => [u.electrons, u.manetrons]),
    [
      [30, 8],
      [30, 8],
    ],
  );
  assert.equal(pool.data.entries.length, 2);
  assert.deepEqual(pool.data.entries[0].slice(-4), [10, 30, 5, 8]);
  assert.equal(pool.data.notifications.length, 2);
  assert.equal(pool.data.notifications[0][2], 'reward');
  assert.match(pool.data.notifications[0][4], /20 电元 \+ 3 磁元/);
  assert.equal(pool.data.notifications[0][5], '/inventory#wallet-ledger');
  assert.ok(
    !pool.calls.some((call) =>
      /heat =|INSERT.*notification_email_outbox|INSERT.*economy_rewards/.test(call.sql),
    ),
  );
});
test('simultaneous retries and reordered recipients return one committed batch', async () => {
  const { pool, service } = harness();
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      service.grant({ id: 1 }, reward({ userIds: i % 2 ? [3, 2] : [2, 3] })),
    ),
  );
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  assert.equal(pool.data.users[0].electrons, 30);
  assert.equal(pool.data.entries.length, 2);
  assert.equal(pool.data.notifications.length, 2);
  await assert.rejects(service.grant({ id: 1 }, reward({ electric: 50 })), { status: 409 });
  assert.equal(pool.data.users[0].electrons, 30);
});
test('notifications failure, missing recipients and unsafe balances roll back the entire batch', async () => {
  const { pool, service } = harness();
  pool.failNotification = true;
  await assert.rejects(service.grant({ id: 1 }, reward()), /notification failure/);
  assert.equal(pool.data.batches.length, 0);
  assert.equal(pool.data.entries.length, 0);
  assert.equal(pool.data.users[0].electrons, 10);
  pool.failNotification = false;
  await assert.rejects(service.grant({ id: 1 }, reward({ userIds: [2, 99] })), { status: 400 });
  pool.data.users[1].electrons = Number.MAX_SAFE_INTEGER;
  await assert.rejects(service.grant({ id: 1 }, reward()), { status: 400 });
  assert.equal(pool.data.users[0].electrons, 10);
  assert.equal(pool.data.batches.length, 0);
  pool.data.users[1].electrons = 10;
  await service.grant({ id: 1 }, reward());
  assert.equal(pool.data.users[0].electrons, 30);
});
test('admin routes reject anonymous and nonadmin callers; recipient history is scoped to authenticated ID', async () => {
  const calls = [];
  const pool = {
    query: async () => {},
    execute: async (sql, args) => {
      calls.push({ sql, args });
      return [[]];
    },
  };
  const app = express();
  app.use(express.json());
  const requireAuth = async (req, res) => {
    if (!req.headers.authorization) {
      res.status(401).json({});
      return null;
    }
    return { id: 7 };
  };
  const requireAdmin = async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return null;
    res.status(403).json({});
    return null;
  };
  app.use(createAdminRewardsRouter({ pool, requireAdmin, requireAuth, notifications: {} }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => {
    server.once('listening', resolve);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [method, route] of [
      ['POST', '/admin/rewards'],
      ['POST', '/admin/discussion/posts/p_example/reward'],
      ['GET', '/admin/rewards'],
      ['GET', '/admin/rewards/1'],
    ]) {
      assert.equal((await fetch(base + route, { method })).status, 401);
      assert.equal(
        (await fetch(base + route, { method, headers: { Authorization: 'user' } })).status,
        403,
      );
    }
    assert.equal(calls.length, 0);
    const response = await fetch(`${base}/rewards?userId=99`, {
      headers: { Authorization: 'user' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls[0].args, [7]);
    assert.match(calls[0].sql, /e.user_id = \?/);
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
});

test('post rewards derive recipients from the post and preserve anonymous author privacy', () => {
  const result = postAuthorReward(
    { user_id: 9, pid: 'p_example', title: '匿名反馈' },
    {
      ...reward(),
      userIds: [999],
      reason: '有效反馈',
    },
  );
  assert.deepEqual(result.userIds, [9]);
  assert.equal(result.title, '帖子奖励 · 匿名反馈');
  assert.match(result.reason, /discussion\?post=p_example/);
  assert.equal(validateReward(result).electric, 20);
  assert.throws(() => postAuthorReward(null, reward()), /不存在/);
  assert.throws(() => postAuthorReward({ is_deleted: 1 }, reward()), /不存在/);
  assert.throws(() => postAuthorReward({ user_id: 9 }, { ...reward(), reason: '' }), /原因/);
});
