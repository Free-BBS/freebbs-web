const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const manifest = require('../public/max-guide-releases');
const {
  GUIDE_VERSION,
  LEGACY_GUIDE_VERSIONS,
  ALLOWED_GUIDE_VERSIONS,
  TASK_IDS,
  emptyProgress,
  validatePatch,
  createOnboardingService,
  createMysqlOnboardingStore,
  ensureOnboardingTable,
  registerOnboarding,
  resolveGuideVersion,
  mergeProgress,
} = require('./onboarding');

const fixed = Date.parse('2026-09-20T10:00:00Z');

function memoryStore() {
  const accounts = new Map();
  const key = (id, version) => `${id}:${version}`;
  let queue = Promise.resolve();
  return {
    read: async (id, version = GUIDE_VERSION) =>
      structuredClone(accounts.get(key(id, version)) || emptyProgress(version)),
    update(id, change, now, version = GUIDE_VERSION) {
      const pending = queue.then(() => {
        const next = change(
          structuredClone(accounts.get(key(id, version)) || emptyProgress(version)),
        );
        accounts.set(key(id, version), next);
        return structuredClone(next);
      });
      queue = pending.catch(() => {});
      return pending;
    },
  };
}

test('new account reads do not mark the welcome as seen; progress survives service restart', async () => {
  const store = memoryStore();
  const first = createOnboardingService(store, { now: () => fixed });
  assert.deepEqual(await first.read(1), emptyProgress());
  await first.update(1, { status: 'in_progress', step: 3, completedTasks: ['explore_world'] });
  const second = createOnboardingService(store, { now: () => fixed + 1000 });
  const state = await second.read(1);
  assert.equal(state.version, GUIDE_VERSION);
  assert.equal(state.step, 3);
  assert.equal(state.seenAt, new Date(fixed).toISOString());
  assert.deepEqual(state.completedTasks, ['explore_world']);
  assert.deepEqual(await second.read(2), emptyProgress());
});

test('simultaneous device visits merge rather than replace tasks', async () => {
  const store = memoryStore();
  const first = createOnboardingService(store, { now: () => fixed });
  const second = createOnboardingService(store, { now: () => fixed });
  await Promise.all([
    first.update(1, { completedTasks: ['explore_world'] }),
    second.update(1, { completedTasks: ['meet_max', 'meet_max'] }),
  ]);
  const result = await first.update(1, { completedTasks: [] });
  assert.deepEqual(result.completedTasks, ['explore_world', 'meet_max']);
});

test('skip persists, resume keeps the step, completion resists an old tab, explicit replay works', async () => {
  let current = fixed;
  const service = createOnboardingService(memoryStore(), { now: () => current });
  await service.update(1, { status: 'in_progress', step: 4 });
  const skipped = await service.update(1, { status: 'skipped' });
  assert.equal(skipped.step, 4);
  assert.equal(skipped.dismissedAt, new Date(fixed).toISOString());
  const resumed = await service.update(1, { status: 'in_progress' });
  assert.equal(resumed.step, 4);
  current += 1000;
  const completed = await service.update(1, {
    status: 'completed',
    step: 8,
    completedTasks: ['open_workbench'],
  });
  assert.equal(completed.completedAt, new Date(current).toISOString());
  const stale = await service.update(1, { status: 'in_progress', step: 2 });
  assert.equal(stale.status, 'completed');
  assert.equal(stale.step, 8);
  current += 1000;
  const replay = await service.update(1, { restart: true });
  assert.equal(replay.status, 'in_progress');
  assert.equal(replay.step, 0);
  assert.equal(replay.dismissedAt, null);
  assert.equal(replay.completedAt, completed.completedAt);
  assert.equal(replay.seenAt, new Date(fixed).toISOString());
  assert.deepEqual(replay.completedTasks, ['open_workbench']);
});

test('tour completion and visit tasks are independent and never include a reward', async () => {
  const service = createOnboardingService(memoryStore(), { now: () => fixed });
  const completed = await service.update(1, { status: 'completed' });
  assert.deepEqual(completed.completedTasks, []);
  const visits = await service.update(2, { completedTasks: [...TASK_IDS] });
  assert.equal(visits.status, 'not_started');
  assert.equal(visits.completedAt, null);
  assert.deepEqual(Object.keys(visits).sort(), Object.keys(emptyProgress()).sort());
});

test('invalid fields, caller identity, impossible tasks and mismatched versions are rejected before writing', async () => {
  let writes = 0;
  const service = createOnboardingService({
    update() {
      writes += 1;
    },
  });
  for (const patch of [
    null,
    [],
    'hello',
    { status: 'something' },
    { status: '__proto__' },
    { step: -1 },
    { step: 201 },
    { step: 1.5 },
    { step: '3' },
    { completedTasks: 'meet_max' },
    { completedTasks: ['pass_quiz'] },
    { completedTasks: [null] },
    { completedTasks: Array(100).fill('meet_max') },
    { userId: 2 },
    { reward: 100 },
    { seenAt: '2020-01-01' },
    { restart: 'true' },
    { restart: true, status: 'completed' },
  ]) {
    await assert.rejects(service.update(1, patch), (error) => error.status === 400);
  }
  await assert.rejects(service.update(1, { version: 'old' }), (error) => error.status === 409);
  assert.equal(writes, 0);
  assert.deepEqual(validatePatch({ version: GUIDE_VERSION, step: 0 }), {
    version: GUIDE_VERSION,
    step: 0,
  });
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

function routesFor(service) {
  const routes = {};
  registerOnboarding(
    Object.fromEntries(
      ['get', 'post', 'patch'].map((method) => [
        method,
        (url, handler) => {
          assert.equal(url, '/api/onboarding');
          routes[method] = handler;
        },
      ]),
    ),
    {
      service,
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

test('all routes authenticate before touching progress, use the authenticated account and prevent caching', async () => {
  const calls = [];
  const service = {
    read: async (id) => {
      calls.push(id);
      return { owner: id };
    },
    update: async (id) => {
      calls.push(id);
      return { owner: id };
    },
  };
  const routes = routesFor(service);
  for (const route of Object.values(routes)) {
    const denied = response();
    await route({ body: {} }, denied);
    assert.equal(denied.code, 401);
    assert.equal(denied.headers['Cache-Control'], 'no-store');
  }
  assert.deepEqual(calls, []);
  for (const route of Object.values(routes)) {
    const allowed = response();
    await route({ authorized: 7, body: { userId: 2 }, query: { userId: 2 } }, allowed);
    assert.deepEqual(allowed.body, { owner: 7 });
  }
  assert.deepEqual(calls, [7, 7, 7]);
});

test('routes report validation errors and hide database internals behind a retryable error', async () => {
  const service = createOnboardingService(memoryStore());
  const validation = response();
  await routesFor(service).patch({ authorized: 1, body: { step: -1 } }, validation);
  assert.equal(validation.code, 400);
  const failure = response();
  await routesFor({
    read: async () => {
      throw new Error('SQL user password private_connection_details');
    },
  }).get({ authorized: 1 }, failure);
  assert.equal(failure.code, 503);
  assert.doesNotMatch(failure.body.message, /SQL|password|private/);
});

test('concurrent initialization shares one attempt and retries after an initial DB failure', async () => {
  let attempts = 0;
  const pool = {
    async query(sql) {
      assert.match(sql, /CREATE TABLE IF NOT EXISTS user_onboarding/);
      attempts += 1;
      if (attempts === 1) throw new Error('DB unavailable');
    },
  };
  const initial = await Promise.allSettled([
    ensureOnboardingTable(pool),
    ensureOnboardingTable(pool),
  ]);
  assert.ok(initial.every((item) => item.status === 'rejected'));
  assert.equal(attempts, 1);
  await Promise.all([ensureOnboardingTable(pool), ensureOnboardingTable(pool)]);
  assert.equal(attempts, 2);
});

function mysqlFixture({ failUpdate = false } = {}) {
  const events = [];
  const calls = [];
  const row = {
    status: 'in_progress',
    current_step: 2,
    completed_tasks_json: '["explore_world"]',
    seen_at_ms: fixed - 1000,
    completed_at_ms: null,
    dismissed_at_ms: null,
    updated_at_ms: fixed - 1000,
  };
  const connection = {
    beginTransaction: async () => events.push('begin'),
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT')) return [[row]];
      if (sql.startsWith('UPDATE') && failUpdate) throw new Error('write failed');
      return [{ affectedRows: 1 }];
    },
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };
  const pool = {
    query: async () => {},
    execute: async (sql, values) => {
      calls.push({ sql, values });
      return [[row]];
    },
    getConnection: async () => connection,
  };
  return { pool, calls, events };
}

test('SQL adapter uses one locked transaction and binds account/version on each query', async () => {
  const { pool, calls, events } = mysqlFixture();
  const service = createOnboardingService(createMysqlOnboardingStore(pool), { now: () => fixed });
  const result = await service.update(12, { completedTasks: ['meet_max'], status: 'completed' });
  assert.deepEqual(result.completedTasks, ['explore_world', 'meet_max']);
  assert.equal(result.seenAt, new Date(fixed - 1000).toISOString());
  assert.deepEqual(events, ['begin', 'commit', 'release']);
  assert.deepEqual(calls[0].values, [12, LEGACY_GUIDE_VERSIONS[0]]);
  assert.match(calls[1].sql, /ON DUPLICATE KEY UPDATE/);
  assert.deepEqual(calls[1].values.slice(0, 2), [12, GUIDE_VERSION]);
  assert.match(calls[2].sql, /FOR UPDATE$/);
  assert.deepEqual(calls[2].values, [12, GUIDE_VERSION]);
  assert.deepEqual(calls[3].values.slice(-2), [12, GUIDE_VERSION]);
  assert.equal(calls[3].values[3], fixed);
});

test('SQL adapter rolls back and releases on failure without reporting success', async () => {
  const { pool, events } = mysqlFixture({ failUpdate: true });
  const service = createOnboardingService(createMysqlOnboardingStore(pool), { now: () => fixed });
  await assert.rejects(service.update(12, { step: 3 }), /write failed/);
  assert.deepEqual(events, ['begin', 'rollback', 'release']);
});

test('SQL read has account and version filters and does not start a write transaction', async () => {
  const { pool, calls, events } = mysqlFixture();
  const service = createOnboardingService(createMysqlOnboardingStore(pool));
  const state = await service.read(12);
  assert.deepEqual(calls[0].values, [12, GUIDE_VERSION]);
  assert.deepEqual(events, []);
  assert.equal(state.step, 2);
  assert.deepEqual(state.completedTasks, ['explore_world']);
});

test('browser and CommonJS consume one immutable release manifest with unique database-safe IDs', () => {
  const context = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/max-guide-releases.js'), 'utf8'),
    context,
  );
  assert.equal(JSON.stringify(context.window.FreeBbsGuideReleases), JSON.stringify(manifest));
  assert.equal(GUIDE_VERSION, manifest.GUIDE_VERSION);
  assert.equal(manifest.LATEST_RELEASE, manifest.RELEASES.at(-1));
  assert.equal(new Set(ALLOWED_GUIDE_VERSIONS).size, ALLOWED_GUIDE_VERSIONS.length);
  for (const version of ALLOWED_GUIDE_VERSIONS) assert.match(version, /^[a-z][a-z0-9-]{0,31}$/);
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.RELEASES));
  assert.ok(Object.isFrozen(manifest.LATEST_RELEASE));
  assert.ok(Object.isFrozen(manifest.LATEST_RELEASE.highlights));
});

test('new base guide inherits visits but none of the old completion, welcome or step state', async () => {
  const store = memoryStore();
  const service = createOnboardingService(store, { now: () => fixed });
  const legacy = LEGACY_GUIDE_VERSIONS[0];
  const old = await service.update(1, {
    version: legacy,
    status: 'completed',
    step: 9,
    completedTasks: ['explore_world', 'meet_max'],
  });
  const fresh = await service.read(1);
  assert.deepEqual(fresh, { ...emptyProgress(), completedTasks: ['explore_world', 'meet_max'] });
  assert.deepEqual(
    await store.read(1),
    emptyProgress(),
    'reading inherited visits must not create a seen receipt',
  );
  const current = await service.update(1, {
    status: 'in_progress',
    step: 88,
    completedTasks: ['open_workbench'],
  });
  assert.equal(current.version, GUIDE_VERSION);
  assert.equal(current.step, 88);
  assert.deepEqual(current.completedTasks, ['explore_world', 'meet_max', 'open_workbench']);
  assert.deepEqual((await store.read(1)).completedTasks, current.completedTasks);
  assert.deepEqual(await service.read(1, legacy), old, 'v1 remains readable and unchanged');
  assert.deepEqual(
    await service.read(2),
    emptyProgress(),
    'other accounts do not inherit these visits',
  );
  await service.update(1, { version: legacy, completedTasks: ['visit_discussion'] });
  assert.deepEqual((await service.read(1)).completedTasks, [
    'explore_world',
    'visit_discussion',
    'meet_max',
    'open_workbench',
  ]);
  const next = await service.update(1, { step: 89 });
  assert.deepEqual((await store.read(1)).completedTasks, next.completedTasks);
});

test('latest-feature tour stays independent from the complete guide and survives skip, restart and service reload', async () => {
  const store = memoryStore();
  let stamp = fixed;
  const service = createOnboardingService(store, { now: () => stamp });
  const version = manifest.LATEST_RELEASE.id;
  const base = await service.update(1, {
    status: 'completed',
    step: 100,
    completedTasks: [...TASK_IDS],
  });
  assert.deepEqual(
    await service.read(1, version),
    emptyProgress(version),
    'even users who completed the full guide have an unseen new release',
  );
  const seen = await service.update(1, { version });
  assert.equal(seen.seenAt, new Date(stamp).toISOString());
  assert.deepEqual(seen.completedTasks, []);
  await service.update(1, { version, status: 'in_progress', step: 40 });
  await service.update(1, { version, status: 'skipped' });
  const resumedService = createOnboardingService(store, { now: () => stamp + 1000 });
  const paused = await resumedService.read(1, version);
  assert.equal(paused.status, 'skipped');
  assert.equal(paused.step, 40);
  await resumedService.update(1, { version, status: 'in_progress' });
  stamp += 2000;
  const completed = await service.update(1, { version, status: 'completed', step: 60 });
  assert.equal(completed.completedAt, new Date(stamp).toISOString());
  const stale = await resumedService.update(1, { version, status: 'in_progress', step: 41 });
  assert.equal(stale.status, 'completed');
  assert.equal(stale.step, 60);
  assert.equal(stale.completedAt, completed.completedAt);
  assert.deepEqual(await service.read(1), base);
  assert.deepEqual(await service.read(2, version), emptyProgress(version));
  const replay = await service.update(1, { version, restart: true });
  assert.equal(replay.step, 0);
  assert.equal(replay.status, 'in_progress');
  assert.equal(replay.completedAt, completed.completedAt);
  assert.deepEqual(replay.completedTasks, []);
});

test('simultaneous base and release writes merge only within the same account and version', async () => {
  const store = memoryStore();
  const version = manifest.LATEST_RELEASE.id;
  const one = createOnboardingService(store, { now: () => fixed });
  const two = createOnboardingService(store, { now: () => fixed });
  await Promise.all([
    one.update(1, { status: 'in_progress', step: 99, completedTasks: ['meet_max'] }),
    two.update(1, { completedTasks: ['visit_inventory'] }),
    one.update(1, { version, status: 'completed', step: 60 }),
    two.update(1, { version, status: 'in_progress', step: 10 }),
    two.update(2, { version, status: 'in_progress', step: 7 }),
  ]);
  assert.equal((await one.read(1)).step, 99);
  assert.deepEqual((await one.read(1)).completedTasks, ['meet_max', 'visit_inventory']);
  assert.equal((await one.read(1, version)).status, 'completed');
  assert.equal((await one.read(1, version)).step, 60);
  assert.deepEqual((await one.read(1, version)).completedTasks, []);
  assert.equal((await one.read(2, version)).step, 7);
});

test('version selectors are strict; release tours cannot accept visits or fabricated entitlement fields', async () => {
  let calls = 0;
  const service = createOnboardingService({
    read() {
      calls += 1;
    },
    update() {
      calls += 1;
    },
  });
  for (const value of [
    null,
    '',
    'future-unpublished',
    'max-v2 ',
    ['max-v2'],
    { version: 'max-v2' },
    '__proto__',
    "max-v2' OR 1=1 --",
  ]) {
    assert.throws(
      () => resolveGuideVersion(value),
      (error) => error.status === 409,
    );
    await assert.rejects(service.read(1, value), (error) => error.status === 409);
    await assert.rejects(service.update(1, { version: value }), (error) => error.status === 409);
  }
  await assert.rejects(
    service.update(1, { version: manifest.LATEST_RELEASE.id, completedTasks: ['meet_max'] }),
    (error) => error.status === 400,
  );
  await assert.rejects(
    service.update(1, { version: manifest.LATEST_RELEASE.id, rewardClaimedAt: fixed }),
    (error) => error.status === 400,
  );
  assert.equal(calls, 0);
  for (const version of ALLOWED_GUIDE_VERSIONS)
    assert.equal(validatePatch({ version, step: 200 }).step, 200);
  assert.throws(
    () => mergeProgress(emptyProgress(), { version: manifest.LATEST_RELEASE.id }, fixed),
    (error) => error.status === 409,
  );
});

test('HTTP GET selects only the requested version; writes use the body and authenticated account', async () => {
  const store = memoryStore();
  const service = createOnboardingService(store, { now: () => fixed });
  const routes = routesFor(service);
  const version = manifest.LATEST_RELEASE.id;
  const saved = response();
  await routes.patch(
    {
      authorized: 7,
      query: { version: GUIDE_VERSION, userId: 99 },
      body: { version, status: 'in_progress', step: 50 },
    },
    saved,
  );
  assert.equal(saved.code, 200);
  assert.equal(saved.body.version, version);
  const release = response();
  await routes.get({ authorized: 7, query: { version, userId: 99 } }, release);
  assert.equal(release.body.step, 50);
  const base = response();
  await routes.get({ authorized: 7, query: {} }, base);
  assert.deepEqual(base.body, emptyProgress());
  const other = response();
  await routes.get({ authorized: 99, query: { version } }, other);
  assert.deepEqual(other.body, emptyProgress(version));
  const invalid = response();
  await routes.get({ authorized: 7, query: { version: ['max-v1', 'max-v2'] } }, invalid);
  assert.equal(invalid.code, 409);
  assert.equal(invalid.headers['Cache-Control'], 'no-store');
});

test('SQL release updates lock and write exactly the selected version without touching other receipts', async () => {
  const { pool, calls, events } = mysqlFixture();
  const service = createOnboardingService(createMysqlOnboardingStore(pool), { now: () => fixed });
  const version = manifest.LATEST_RELEASE.id;
  const next = await service.update(12, { version, status: 'completed', step: 67 });
  assert.equal(next.version, version);
  assert.equal(next.step, 67);
  assert.deepEqual(next.completedTasks, []);
  assert.equal(calls.length, 3, 'release does not read or inherit base progress');
  assert.deepEqual(calls[0].values.slice(0, 2), [12, version]);
  assert.match(calls[1].sql, /FOR UPDATE$/);
  assert.deepEqual(calls[1].values, [12, version]);
  assert.deepEqual(calls[2].values.slice(-2), [12, version]);
  assert.equal(calls[2].values[2], '[]');
  assert.deepEqual(events, ['begin', 'commit', 'release']);
  assert.ok(calls.every((call) => !/DELETE|UPDATE users|wallet|reward/i.test(call.sql)));
});

test('SQL empty current guide reads legacy visits without creating a welcome receipt', async () => {
  const calls = [];
  const pool = {
    async query() {
      return [];
    },
    async execute(sql, values) {
      calls.push({ sql, values });
      if (values[1] === GUIDE_VERSION) return [[]];
      return [
        [
          {
            guide_version: LEGACY_GUIDE_VERSIONS[0],
            status: 'completed',
            current_step: 9,
            completed_tasks_json: '["meet_max"]',
            seen_at_ms: fixed,
            completed_at_ms: fixed,
            updated_at_ms: fixed,
          },
        ],
      ];
    },
    getConnection() {
      throw new Error('read must not create a transaction');
    },
  };
  const service = createOnboardingService(createMysqlOnboardingStore(pool));
  assert.deepEqual(await service.read(12), { ...emptyProgress(), completedTasks: ['meet_max'] });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.sql.startsWith('SELECT')));
  assert.deepEqual(
    calls.map((call) => call.values),
    [
      [12, GUIDE_VERSION],
      [12, LEGACY_GUIDE_VERSIONS[0]],
    ],
  );
});
