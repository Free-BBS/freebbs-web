const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createOnboardingPreview } = require('./preview-onboarding');
const { TOKEN } = require('./preview-economy');
const {
  GUIDE_VERSION,
  LEGACY_GUIDE_VERSIONS,
  LATEST_RELEASE,
} = require('../public/max-guide-releases');
const { TASK_IDS } = require('../backend/onboarding');

async function rewardPreview(t) {
  const preview = createOnboardingPreview({ now: () => Date.parse('2026-09-21T16:00:00Z') });
  const { server } = preview;
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });
  function request(pathname, { method = 'GET', body, token = TOKEN } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: server.address().port,
          path: pathname,
          method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        },
        (res) => {
          let payload = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            payload += chunk;
          });
          res.on('error', reject);
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(payload) }));
        },
      );
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  return { ...preview, request };
}

test('preview reward reads, visit tasks, release completion and forged requests never award money', async (t) => {
  const { store, request } = await rewardPreview(t);
  const before = structuredClone(store.account());
  const reward = '/api/onboarding/reward';
  assert.equal((await request(reward)).body.eligible, false);
  assert.equal((await request(reward, { method: 'POST', body: {} })).status, 403);
  assert.equal((await request(reward, { token: 'not-a-preview-user' })).status, 403);
  await request('/api/onboarding', { method: 'PATCH', body: { completedTasks: [...TASK_IDS] } });
  await request('/api/onboarding', {
    method: 'PATCH',
    body: { version: LATEST_RELEASE.id, status: 'completed' },
  });
  assert.equal((await request(reward)).body.eligible, false);
  assert.equal((await request(reward, { method: 'POST', body: {} })).status, 403);
  for (const body of [null, [], { userId: 2 }, { electric: 999 }, { magnetic: 999 }]) {
    assert.equal((await request(reward, { method: 'POST', body })).status, 400);
  }
  assert.deepEqual(store.account(), before);
});

for (const version of [GUIDE_VERSION, ...LEGACY_GUIDE_VERSIONS]) {
  test(`preview rewards previously completed ${version} users once, including concurrent retries`, async (t) => {
    const { store, request } = await rewardPreview(t);
    const before = structuredClone(store.account());
    const other = structuredClone(store.account(2));
    await request('/api/onboarding', { method: 'PATCH', body: { version, status: 'completed' } });
    const eligible = await request('/api/onboarding/reward');
    assert.equal(eligible.body.eligible, true);
    assert.equal(eligible.body.claimed, false);
    assert.deepEqual(store.account(), before, 'Completion and GET do not issue currency');
    const replies = await Promise.all(
      Array.from({ length: 8 }, () =>
        request('/api/onboarding/reward', { method: 'POST', body: {} }),
      ),
    );
    assert.ok(replies.every((reply) => reply.status === 200));
    assert.equal(replies.filter((reply) => reply.body.awarded).length, 1);
    assert.equal(store.account().electric, before.electric + 10);
    assert.equal(store.account().magnetic, before.magnetic + 10);
    assert.equal(store.account().heat, before.heat);
    assert.equal(store.account().ledger.length, before.ledger.length + 1);
    const row = store.account().ledger.at(-1);
    assert.equal(row.source_key, 'onboarding-reward');
    assert.equal(row.title, '新手导引完成奖励');
    assert.match(row.reason, /10 电元.*10 磁元/);
    assert.equal(row.electric_before, String(before.electric));
    assert.equal(row.electric_after, String(before.electric + 10));
    assert.equal(row.magnetic_before, String(before.magnetic));
    assert.equal(row.magnetic_after, String(before.magnetic + 10));
    assert.deepEqual(store.account(2), other);
    const accountAfterClaim = structuredClone(store.account());
    for (const replayVersion of [GUIDE_VERSION, ...LEGACY_GUIDE_VERSIONS]) {
      await request('/api/onboarding', {
        method: 'PATCH',
        body: { version: replayVersion, restart: true },
      });
      await request('/api/onboarding', {
        method: 'PATCH',
        body: { version: replayVersion, status: 'completed' },
      });
      const replay = await request('/api/onboarding/reward', { method: 'POST', body: {} });
      assert.equal(replay.body.awarded, false);
    }
    assert.deepEqual(store.account(), accountAfterClaim);
    const me = await request('/api/auth/me');
    assert.equal(me.body.user.electrons, before.electric + 10);
    assert.equal(me.body.user.manetrons, before.magnetic + 10);
    const ledger = await request('/api/wallet/ledger');
    assert.equal(ledger.body.entries[0].title, '新手导引完成奖励');
  });
}

test('preview reward failure rolls back both currencies and receipt and allows a safe retry', async (t) => {
  const { store, request } = await rewardPreview(t);
  await request('/api/onboarding', { method: 'PATCH', body: { status: 'completed' } });
  const before = structuredClone(store.account());
  const { recordLedger } = store;
  store.recordLedger = () => {
    throw Object.assign(new Error('simulated ledger failure'), { status: 503 });
  };
  const failure = await request('/api/onboarding/reward', { method: 'POST', body: {} });
  assert.equal(failure.status, 503);
  assert.deepEqual(store.account(), before);
  assert.equal((await request('/api/onboarding/reward')).body.claimed, false);
  store.recordLedger = recordLedger;
  const retry = await request('/api/onboarding/reward', { method: 'POST', body: {} });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.awarded, true);
  assert.equal(store.account().electric, before.electric + 10);
  assert.equal(store.account().magnetic, before.magnetic + 10);
});
