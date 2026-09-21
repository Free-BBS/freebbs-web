const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GUIDE_VERSION, LEGACY_GUIDE_VERSIONS } = require('./onboarding');
const { RELEASES } = require('../public/max-guide-releases');
const {
  ONBOARDING_REWARD_AMOUNTS,
  REWARD_GUIDE_VERSIONS,
  OnboardingRewardError,
  createMysqlOnboardingRewardStore,
  ensureOnboardingRewardTable,
  validateClaimBody,
  registerOnboardingReward,
} = require('./onboarding-reward');

const fixed = Date.parse('2026-09-21T12:00:00Z');
const state = (eligible, claimed = false) => ({
  eligible,
  claimed,
  claimedAt: claimed ? new Date(fixed).toISOString() : null,
  amounts: { electric: 10, magnetic: 10 },
});

// A transactional fixture drives the actual SQL adapter and actual ledger helpers.
// It enforces account locking and discards every staged change on rollback.
function mysqlFixture(options = {}) {
  let data = {
    users: [
      { id: 1, electrons: 0, manetrons: 0, created_at: '2026-09-21' },
      { id: 2, electrons: 150, manetrons: 30, created_at: '2020-01-01' },
    ],
    progress: [],
    claims: [],
    ledger: [{ id: 1, user_id: 2, source_key: null, reason: null }],
  };
  const calls = [];
  const events = [];
  let queue = Promise.resolve();
  let loseCommitResponse = Boolean(options.loseCommitResponse);
  const completed = (records, userId, versions) =>
    records.progress.filter(
      (row) =>
        row.user_id === userId &&
        versions.includes(row.guide_version) &&
        row.completed_at_ms != null,
    );
  const pool = {
    async query(sql) {
      calls.push({ sql, values: [] });
      assert.match(sql, /CREATE TABLE IF NOT EXISTS/);
    },
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('information_schema.TRIGGERS')) return [[{ TRIGGER_NAME: values[0] }]];
      assert.match(sql, /^SELECT u.id, r.claimed_at_ms/);
      const userId = values.at(-1);
      if (!data.users.some((user) => user.id === userId)) return [[]];
      return [
        [
          {
            id: userId,
            eligible: completed(data, userId, values.slice(0, -1)).length ? 1 : 0,
            claimed_at_ms: data.claims.find((row) => row.user_id === userId)?.claimed_at_ms ?? null,
          },
        ],
      ];
    },
    async getConnection() {
      let staged;
      let unlock;
      return {
        async beginTransaction() {
          events.push('begin');
        },
        async execute(sql, values) {
          calls.push({ sql, values });
          if (sql.startsWith('SELECT id, electrons')) {
            assert.match(sql, /WHERE id = \? FOR UPDATE$/);
            const prior = queue;
            queue = new Promise((resolve) => {
              unlock = resolve;
            });
            await prior;
            staged = structuredClone(data);
            return [staged.users.filter((user) => user.id === values[0])];
          }
          assert.ok(staged, 'all claim queries must follow the account lock');
          if (sql.startsWith('SELECT claimed_at_ms')) {
            assert.match(sql, /WHERE user_id = \? FOR UPDATE$/);
            return [staged.claims.filter((row) => row.user_id === values[0])];
          }
          if (sql.startsWith('SELECT guide_version')) {
            assert.match(sql, /completed_at_ms IS NOT NULL/);
            assert.match(sql, /FOR UPDATE$/);
            return [completed(staged, values[0], values.slice(1)).slice(0, 1)];
          }
          if (sql.startsWith('SELECT CAST(id')) {
            assert.match(sql, /FOR UPDATE$/);
            return [staged.ledger.filter((row) => row.user_id === values[0]).slice(-1)];
          }
          if (sql.startsWith('UPDATE users')) {
            if (options.failAt === 'update') throw new Error('balance failure');
            if (options.missingUserUpdate) return [{ affectedRows: 0 }];
            const user = staged.users.find((row) => row.id === values[2]);
            const ledger = {
              id: staged.ledger.length + 1,
              user_id: user.id,
              electric_before: user.electrons,
              magnetic_before: user.manetrons,
              electric_after: Number(user.electrons) + values[0],
              magnetic_after: Number(user.manetrons) + values[1],
              source_key: null,
            };
            user.electrons = ledger.electric_after;
            user.manetrons = ledger.magnetic_after;
            if (!options.missingTrigger) staged.ledger.push(ledger);
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith('UPDATE wallet_ledger')) {
            assert.match(sql, /user_id = \? AND id > \? AND source_key IS NULL/);
            if (options.failAt === 'annotation') throw new Error('annotation failure');
            const row = staged.ledger
              .filter(
                (entry) =>
                  entry.user_id === values[3] &&
                  entry.id > Number(values[4]) &&
                  entry.source_key === null,
              )
              .at(-1);
            if (!row) return [{ affectedRows: 0 }];
            [row.source_key, row.title, row.reason] = values;
            return [{ affectedRows: 1 }];
          }
          assert.match(sql, /^INSERT INTO onboarding_rewards/);
          if (options.failAt === 'receipt') throw new Error('receipt failure');
          assert.ok(
            !staged.claims.some((row) => row.user_id === values[0]),
            'unique account receipt',
          );
          staged.claims.push({
            user_id: values[0],
            guide_version: values[1],
            electric: values[2],
            magnetic: values[3],
            claimed_at_ms: values[4],
          });
          return [{ affectedRows: 1 }];
        },
        async commit() {
          if (options.failAt === 'commit') throw new Error('commit failure');
          data = staged;
          events.push('commit');
          if (loseCommitResponse) {
            loseCommitResponse = false;
            throw new Error('commit response lost');
          }
        },
        async rollback() {
          events.push('rollback');
          if (options.failRollback) throw new Error('rollback connection lost');
        },
        release() {
          events.push('release');
          unlock?.();
        },
      };
    },
  };
  return {
    pool,
    calls,
    events,
    data: () => data,
    complete(userId, version = GUIDE_VERSION, extra = {}) {
      data.progress.push({
        user_id: userId,
        guide_version: version,
        completed_at_ms: fixed,
        ...extra,
      });
    },
    store: createMysqlOnboardingRewardStore(pool, { now: () => fixed }),
  };
}

test('GET only reads entitlement; reading completed or fresh accounts never pays or creates ledger rows', async () => {
  const fixture = mysqlFixture();
  fixture.complete(2);
  assert.deepEqual(await fixture.store.read(1), state(false));
  assert.deepEqual(await fixture.store.read(2), state(true));
  assert.deepEqual(await fixture.store.read(2), state(true));
  assert.equal(fixture.data().claims.length, 0);
  assert.equal(fixture.data().ledger.length, 1);
  assert.deepEqual(fixture.events, []);
  const selects = fixture.calls.filter((call) => !call.sql.includes('CREATE TABLE'));
  assert.ok(selects.every((call) => call.sql.startsWith('SELECT')));
  assert.deepEqual(selects[1].values, [...REWARD_GUIDE_VERSIONS, 2]);
});

test('new and existing accounts receive the same fixed amounts with a precise wallet reason', async () => {
  const fixture = mysqlFixture();
  fixture.complete(1);
  fixture.complete(2);
  for (const userId of [1, 2]) {
    assert.deepEqual(await fixture.store.claim(userId), { ...state(true, true), awarded: true });
    assert.deepEqual(await fixture.store.read(userId), state(true, true));
  }
  assert.deepEqual(
    fixture.data().users.map((user) => [user.electrons, user.manetrons]),
    [
      [10, 10],
      [160, 40],
    ],
  );
  const { ledger } = fixture.data();
  assert.equal(ledger[0].reason, null, 'the older unlabelled balance row must remain untouched');
  for (const row of ledger.slice(1)) {
    assert.equal(row.title, '新手导引完成奖励');
    assert.match(row.reason, /完成整套新手导引/);
    assert.match(row.reason, /10 电元和 10 磁元/);
    assert.equal(row.source_key, 'onboarding-reward');
    assert.equal(row.electric_after - row.electric_before, 10);
    assert.equal(row.magnetic_after - row.magnetic_before, 10);
  }
  assert.ok(fixture.calls.every((call) => !/daily|interaction|notify|email/i.test(call.sql)));
});

test('all persisted legacy base completions qualify even during replay; task visits do not qualify', async () => {
  assert.deepEqual(REWARD_GUIDE_VERSIONS, [GUIDE_VERSION, ...LEGACY_GUIDE_VERSIONS]);
  for (const version of REWARD_GUIDE_VERSIONS) {
    const fixture = mysqlFixture();
    fixture.complete(1, version, { status: 'in_progress', current_step: 0 });
    assert.equal((await fixture.store.claim(1)).awarded, true);
    assert.equal(fixture.data().claims[0].guide_version, version);
  }
  const fixture = mysqlFixture();
  fixture.complete(1, GUIDE_VERSION, { status: 'completed', completed_at_ms: null });
  await assert.rejects(fixture.store.claim(1), { status: 403 });
  assert.equal(fixture.data().claims.length, 0);
});

test('release-only completion, skipped guides and another account completion cannot grant entitlement', async () => {
  const fixture = mysqlFixture();
  for (const release of RELEASES) fixture.complete(1, release.id);
  fixture.complete(1, GUIDE_VERSION, { status: 'skipped', completed_at_ms: null });
  fixture.complete(2);
  assert.deepEqual(await fixture.store.read(1), state(false));
  await assert.rejects(fixture.store.claim(1), { status: 403 });
  assert.deepEqual(
    fixture.data().users.map((user) => [user.electrons, user.manetrons]),
    [
      [0, 0],
      [150, 30],
    ],
  );
  assert.deepEqual(fixture.events, ['begin', 'rollback', 'release']);
});

test('concurrent claims, replay, version changes and adapter restart remain once per account', async () => {
  const fixture = mysqlFixture();
  fixture.complete(1, LEGACY_GUIDE_VERSIONS[0]);
  const other = createMysqlOnboardingRewardStore(fixture.pool, { now: () => fixed + 5000 });
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) => (index % 2 ? fixture.store : other).claim(1)),
  );
  assert.equal(results.filter((result) => result.awarded).length, 1);
  assert.equal(new Set(results.map((result) => result.claimedAt)).size, 1);
  fixture.complete(1, GUIDE_VERSION);
  fixture.complete(1, 'max-future-version');
  const replay = await fixture.store.claim(1);
  assert.equal(replay.awarded, false);
  assert.deepEqual(
    [fixture.data().users[0].electrons, fixture.data().users[0].manetrons],
    [10, 10],
  );
  assert.equal(fixture.data().claims.length, 1);
  assert.equal(fixture.data().ledger.length, 2);
});

test('a lost successful commit response is safely retryable without a second grant', async () => {
  const fixture = mysqlFixture({ loseCommitResponse: true });
  fixture.complete(1);
  await assert.rejects(fixture.store.claim(1), /commit response lost/);
  assert.deepEqual(await fixture.store.claim(1), { ...state(true, true), awarded: false });
  assert.equal(fixture.data().claims.length, 1);
  assert.equal(fixture.data().users[0].electrons, 10);
});

test('failed balance updates, ledger annotations, receipt insertion and commit roll back all changes', async () => {
  for (const failAt of ['update', 'annotation', 'receipt', 'commit']) {
    const fixture = mysqlFixture({ failAt });
    fixture.complete(2);
    const before = structuredClone(fixture.data());
    await assert.rejects(
      fixture.store.claim(2),
      new RegExp(`${failAt === 'update' ? 'balance' : failAt} failure`),
    );
    assert.deepEqual(fixture.data(), before);
    assert.deepEqual(fixture.events, ['begin', 'rollback', 'release']);
  }
});

test('missing trigger cannot annotate an old row or silently grant unrecorded balances', async () => {
  const options = { missingTrigger: true };
  const fixture = mysqlFixture(options);
  fixture.complete(2);
  const before = structuredClone(fixture.data());
  await assert.rejects(fixture.store.claim(2), /Wallet ledger entry missing/);
  assert.deepEqual(fixture.data(), before);
  options.missingTrigger = false;
  assert.equal((await fixture.store.claim(2)).awarded, true);
  assert.equal(fixture.data().claims.length, 1);
});

test('deleted accounts, failed account updates and unsafe balances cannot produce a reward', async () => {
  const fixture = mysqlFixture();
  await assert.rejects(fixture.store.read(404), { status: 404 });
  await assert.rejects(fixture.store.claim(404), { status: 404 });
  const missing = mysqlFixture({ missingUserUpdate: true });
  missing.complete(1);
  await assert.rejects(missing.store.claim(1), /account update missing/);
  assert.equal(missing.data().claims.length, 0);
  for (const balance of [null, -1, 'not-money', Number.MAX_SAFE_INTEGER]) {
    const bad = mysqlFixture();
    bad.complete(1);
    bad.data().users[0].electrons = balance;
    await assert.rejects(bad.store.claim(1), { status: 503 });
    assert.equal(bad.data().claims.length, 0);
    assert.equal(bad.data().users[0].manetrons, 0);
  }
});

test('rollback failure preserves the original failure and still releases the account connection', async () => {
  const fixture = mysqlFixture({ failAt: 'receipt', failRollback: true });
  fixture.complete(1);
  await assert.rejects(fixture.store.claim(1), /receipt failure/);
  assert.deepEqual(fixture.events, ['begin', 'rollback', 'release']);
});

test('reward schema initialization shares concurrent attempts and retries failed schema creation', async () => {
  let onboardingAttempts = 0;
  let rewardAttempts = 0;
  const pool = {
    async query(sql) {
      if (sql.includes('CREATE TABLE IF NOT EXISTS user_onboarding')) {
        onboardingAttempts += 1;
        return;
      }
      assert.match(sql, /CREATE TABLE IF NOT EXISTS onboarding_rewards/);
      rewardAttempts += 1;
      if (rewardAttempts === 1) throw new Error('schema temporarily unavailable');
    },
  };
  const first = await Promise.allSettled([
    ensureOnboardingRewardTable(pool),
    ensureOnboardingRewardTable(pool),
  ]);
  assert.ok(first.every((result) => result.status === 'rejected'));
  assert.equal(rewardAttempts, 1);
  await Promise.all([ensureOnboardingRewardTable(pool), ensureOnboardingRewardTable(pool)]);
  assert.equal(rewardAttempts, 2);
  assert.equal(onboardingAttempts, 1);
  const sql = fs.readFileSync(
    path.join(__dirname, '../database/migrations/047_onboarding_rewards.sql'),
    'utf8',
  );
  assert.match(sql, /PRIMARY KEY \(user_id\)/);
  assert.doesNotMatch(sql, /PRIMARY KEY \(user_id,\s*guide_version\)/);
  assert.match(sql, /ENGINE=InnoDB/);
});

test('reward initialization also retries failure of the dependent progress schema', async () => {
  let attempts = 0;
  const pool = {
    async query() {
      attempts += 1;
      if (attempts === 1) throw new Error('progress schema failure');
    },
  };
  await assert.rejects(ensureOnboardingRewardTable(pool), /progress schema failure/);
  await ensureOnboardingRewardTable(pool);
  assert.equal(attempts, 3);
});

function response() {
  return {
    code: 200,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function routesFor(store) {
  const routes = {};
  registerOnboardingReward(
    Object.fromEntries(
      ['get', 'post'].map((method) => [
        method,
        (url, handler) => {
          assert.equal(url, '/api/onboarding/reward');
          routes[method] = handler;
        },
      ]),
    ),
    {
      store,
      requireAuth: async (req, res) => {
        if (req.authorized) return { id: req.authorized };
        res.status(401).json({ message: '请先登录' });
        return null;
      },
      logger: { error() {} },
    },
  );
  return routes;
}

test('HTTP routes authenticate before store access and take identity only from the server session', async () => {
  const calls = [];
  const routes = routesFor({
    read: async (id) => {
      calls.push(['read', id]);
      return state(true);
    },
    claim: async (id) => {
      calls.push(['claim', id]);
      return { ...state(true, true), awarded: true };
    },
  });
  for (const route of Object.values(routes)) {
    const denied = response();
    await route({ body: { userId: 7 } }, denied);
    assert.equal(denied.code, 401);
    assert.equal(denied.headers['Cache-Control'], 'private, no-store');
  }
  assert.deepEqual(calls, []);
  const read = response();
  await routes.get({ authorized: 1, query: { userId: 99 } }, read);
  assert.deepEqual(read.body, state(true));
  const claim = response();
  await routes.post({ authorized: 2, body: {}, query: { userId: 99, electric: 999 } }, claim);
  assert.deepEqual(claim.body, { ...state(true, true), awarded: true });
  assert.deepEqual(calls, [
    ['read', 1],
    ['claim', 2],
  ]);
});

test('HTTP rejects fabricated identity, amounts, completion, version, source keys and malformed bodies', async () => {
  let calls = 0;
  const routes = routesFor({
    claim() {
      calls += 1;
    },
  });
  for (const body of [
    undefined,
    null,
    [],
    'hello',
    10,
    true,
    { userId: 2 },
    { user_id: 2 },
    { electric: 999 },
    { magnetic: -1 },
    { amounts: { electric: 10, magnetic: 10 } },
    { version: GUIDE_VERSION },
    { completedAt: fixed },
    { claimed: false },
    { sourceKey: 'fake' },
    JSON.parse('{"__proto__":{"userId":2}}'),
  ]) {
    assert.throws(() => validateClaimBody(body), { status: 400 });
    const res = response();
    await routes.post({ authorized: 1, body }, res);
    assert.equal(res.code, 400);
  }
  assert.equal(calls, 0);
  assert.doesNotThrow(() => validateClaimBody({}));
  assert.deepEqual(ONBOARDING_REWARD_AMOUNTS, { electric: 10, magnetic: 10 });
  assert.ok(Object.isFrozen(ONBOARDING_REWARD_AMOUNTS));
});

test('HTTP reports ineligibility and conceals database details behind retryable failures', async () => {
  const refused = response();
  await routesFor({
    claim: async () => {
      throw new OnboardingRewardError('完成整套新手导引后再领取', 403);
    },
  }).post({ authorized: 1, body: {} }, refused);
  assert.equal(refused.code, 403);
  const failed = response();
  await routesFor({
    read: async () => {
      throw new Error('SQL private password');
    },
  }).get({ authorized: 1 }, failed);
  assert.equal(failed.code, 503);
  assert.doesNotMatch(failed.body.message, /SQL|private|password/);
});
