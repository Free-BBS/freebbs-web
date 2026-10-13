const assert = require('node:assert/strict');
const test = require('node:test');
let createDevelopmentRewardProvider;
try {
  ({ createDevelopmentRewardProvider } = require('./development-rewards'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const input = {
  requestId: 'test-development-request-0001',
  recipientUids: ['u_b', 'u_a'],
  title: '组织贡献',
  reason: '协助筹备公开活动',
  electric: 10,
  magnetic: 3,
};
function fixture(
  rows = [
    { id: 1, uid: 'u_admin' },
    { id: 2, uid: 'u_a' },
    { id: 3, uid: 'u_b' },
  ],
) {
  const calls = [];
  const pool = {
    async execute(sql, values) {
      calls.push({ sql, values });
      return [rows.filter((row) => values.includes(row.uid))];
    },
  };
  const grants = [];
  let notificationAdapter;
  const serviceFactory = ({ notifications }) => {
    notificationAdapter = notifications;
    return {
      async grant(actor, body) {
        grants.push({ actor, body });
        return {
          batchId: '7',
          recipientCount: 2,
          electric: 10,
          magnetic: 3,
          totalElectric: 20,
          totalMagnetic: 6,
          replayed: grants.length > 1,
        };
      },
    };
  };
  return { pool, calls, grants, serviceFactory, notifications: () => notificationAdapter };
}
test('development wallet adapter maps verified UIDs and namespaces retry keys without learning notices', async () => {
  assert.equal(typeof createDevelopmentRewardProvider, 'function');
  const f = fixture();
  const provider = createDevelopmentRewardProvider({
    pool: f.pool,
    createRewardService: f.serviceFactory,
  });
  const first = await provider.grant('u_admin', input);
  assert.equal(first.batchId, '7');
  assert.equal(f.grants[0].actor.id, 1);
  assert.deepEqual(f.grants[0].body.userIds, [2, 3]);
  assert.match(f.grants[0].body.requestId, /^development_[a-f0-9]{40}$/);
  assert.equal(f.grants[0].body.title, input.title);
  await provider.grant('u_admin', { ...input, recipientUids: [...input.recipientUids].reverse() });
  assert.equal(f.grants[1].body.requestId, f.grants[0].body.requestId);
  await f.notifications().notifyReward({}, {});
  assert.match(f.calls[0].sql, /WHERE uid IN \(\?,\?,\?\)/);
  assert.doesNotMatch(f.calls[0].sql, /password|email/i);
});
test('missing main-site actor or recipient fails before any wallet grant', async () => {
  assert.equal(typeof createDevelopmentRewardProvider, 'function');
  for (const missing of ['u_admin', 'u_a']) {
    const f = fixture(fixtureRows().filter((row) => row.uid !== missing));
    const provider = createDevelopmentRewardProvider({
      pool: f.pool,
      createRewardService: f.serviceFactory,
    });
    await assert.rejects(
      provider.grant('u_admin', input),
      (error) => error.status === 400 && /不存在/.test(error.message),
    );
    assert.equal(f.grants.length, 0);
  }
});
test('a database collation match still requires the exact requested UID', async () => {
  const f = fixture();
  f.pool.execute = async () => [fixtureRows()];
  const provider = createDevelopmentRewardProvider({
    pool: f.pool,
    createRewardService: f.serviceFactory,
  });
  await assert.rejects(
    provider.grant('u_admin', { ...input, recipientUids: ['u_b', 'U_A'] }),
    (error) => error.status === 400,
  );
  assert.equal(f.grants.length, 0);
});
function fixtureRows() {
  return [
    { id: 1, uid: 'u_admin' },
    { id: 2, uid: 'u_a' },
    { id: 3, uid: 'u_b' },
  ];
}
test('invalid UID lists or currency amounts never query accounts or grant rewards', async () => {
  assert.equal(typeof createDevelopmentRewardProvider, 'function');
  const f = fixture();
  const provider = createDevelopmentRewardProvider({
    pool: f.pool,
    createRewardService: f.serviceFactory,
  });
  for (const body of [
    { ...input, recipientUids: [] },
    { ...input, recipientUids: ['u_a', 'u_a'] },
    { ...input, recipientUids: [''] },
    { ...input, magnetic: -1 },
    { ...input, electric: 0.5 },
    { ...input, electric: 0, magnetic: 0 },
    { ...input, requestId: '' },
  ]) {
    await assert.rejects(provider.grant('u_admin', body), (error) => error.status === 400);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.grants.length, 0);
});
test('reward service failure remains a failure and preserves the deterministic retry identity', async () => {
  assert.equal(typeof createDevelopmentRewardProvider, 'function');
  const f = fixture();
  const calls = [];
  const provider = createDevelopmentRewardProvider({
    pool: f.pool,
    createRewardService: () => ({
      async grant(actor, body) {
        calls.push({ actor, body });
        const error = new Error('service unavailable');
        error.status = 503;
        throw error;
      },
    }),
  });
  await assert.rejects(provider.grant('u_admin', input), /service unavailable/);
  await assert.rejects(provider.grant('u_admin', input), /service unavailable/);
  assert.equal(calls[0].body.requestId, calls[1].body.requestId);
});
