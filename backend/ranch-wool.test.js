const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const {
  createProfileExtras,
  mysqlProfileMethods,
  readExtras,
  ensureProfileExtrasTables,
  WOOL_FEEDS,
  WOOL_ELECTRIC_REWARD,
  beijingDay,
} = require('./profile-extras');
const { createMysqlEconomyStore } = require('./economy-shop');
const { createEconomyMemoryStore } = require('../scripts/fixtures/economy-memory-store');

const fixed = Date.parse('2026-09-21T10:00:00Z');
function setup(fields = {}, now = () => fixed) {
  const store = createEconomyMemoryStore(
    [
      {
        id: 1,
        adopted: true,
        electric: 120,
        magnetic: 86,
        heat: 24,
        assets: { fish: 20, max_pet: 1, rubber_rod: 1 },
        fortunes: { [beijingDay(fixed)]: 95 },
        ...fields,
      },
      { id: 2, assets: { max_pet: 1, rubber_rod: 1 }, woolStored: 3 },
    ],
    { recordLedger: true, now },
  );
  const service = createProfileExtras(store, { now });
  const act = (action, options = {}) =>
    service.act({ userId: 1, action, requestKey: randomUUID(), ...options });
  return { store, service, act };
}
const wool = (value) => ({
  feedProgress: value.feedProgress,
  woolReady: value.woolReady,
  woolStored: value.woolStored,
});

test('wool starts at zero without inferring old feeds, bone holdings or inventory items', async () => {
  const { store, service } = setup({
    lastFeedDay: '2026-09-20',
    fedUntilMs: fixed + 20 * 86400000,
    assets: { fish: 15, ordinary_fishbone: 1000, golden_fishbone: 5, max_pet: 1 },
  });
  const before = structuredClone(store.account());
  const own = await service.ownState(1);
  const publicState = await service.publicProfile(1);
  assert.deepEqual(wool(own.ranch), { feedProgress: 0, woolReady: 0, woolStored: 0 });
  assert.deepEqual(wool(publicState.ranch), wool(own.ranch));
  assert.equal(own.rubberRod, false);
  assert.equal(publicState.rubberRod, undefined, 'ownership and wallet remain private');
  assert.deepEqual(store.account(), before, 'reading never backfills historical feeding');
  assert.equal(own.owned.includes('wool'), false);
  assert.equal(store.account().assets.wool, undefined);
});

test('each five successfully consumed fish grows one ranch wool while golden bones remain once per day', async () => {
  const { store, service, act } = setup();
  assert.equal(WOOL_FEEDS, 5);
  assert.equal(WOOL_ELECTRIC_REWARD, 2);
  for (let i = 1; i <= 10; i += 1) {
    const result = await act('feed', { feedProgress: 4, woolReady: 999, quantity: 999 });
    assert.equal(result.woolGrown, i % 5 === 0 ? 1 : 0);
    assert.equal(result.feedProgress, i % 5);
    assert.equal(result.woolReady, Math.floor(i / 5));
    assert.equal(result.woolStored, 0);
  }
  assert.deepEqual(wool((await service.ownState(1)).ranch), {
    feedProgress: 0,
    woolReady: 2,
    woolStored: 0,
  });
  assert.equal(store.account().assets.fish, 10);
  assert.equal(store.account().assets.golden_fishbone, 1);
  assert.equal(store.account().assets.ordinary_fishbone, 9);
  assert.equal(store.account().assets.wool, undefined);
  assert.equal(store.account().electric, 120);
  assert.equal(store.account().magnetic, 86);
  assert.equal(store.account().heat, 24);
  assert.equal(store.account().ledger, undefined);
});

test('simultaneous feeds and retries cross the fifth-feed boundary only once', async () => {
  const { store, act } = setup({ feedProgress: 4 });
  const requestKey = randomUUID();
  const receipts = await Promise.all([
    act('feed', { requestKey }),
    act('feed', { requestKey }),
    act('feed'),
  ]);
  assert.equal(receipts.filter((result) => result.replayed).length, 1);
  assert.deepEqual(wool(store.account()), { feedProgress: 1, woolReady: 1, woolStored: 0 });
  assert.equal(store.account().assets.fish, 18);
  assert.equal(store.account().assets.golden_fishbone, 1);
  assert.equal(store.account().assets.ordinary_fishbone, 1);
  const restarted = createProfileExtras(store, { now: () => fixed + 86400000 });
  await restarted.act({ userId: 1, action: 'feed', requestKey });
  assert.equal(store.account().feedProgress, 1);
  assert.equal(store.account().woolReady, 1);
});

test('ordinary then auspicious feeds keep wool progress independent from the golden-bone quota and day changes', async () => {
  const { store, act } = setup({ feedProgress: 3, fortunes: { [beijingDay(fixed)]: 70 } });
  assert.equal((await act('feed')).bone, 'ordinary_fishbone');
  store.account().fortunes[beijingDay(fixed)] = 95;
  assert.equal((await act('feed')).bone, 'golden_fishbone');
  const tomorrow = fixed + 86400000;
  store.account().fortunes[beijingDay(tomorrow)] = 95;
  await createProfileExtras(store, { now: () => tomorrow }).act({
    userId: 1,
    action: 'feed',
    requestKey: randomUUID(),
  });
  assert.equal(store.account().assets.golden_fishbone, 2);
  assert.deepEqual(wool(store.account()), { feedProgress: 1, woolReady: 1, woolStored: 0 });
});

for (const fields of [
  { adopted: false, assets: { fish: 10 } },
  { assets: { max_pet: 1, fish: 0 } },
  { fortunes: {} },
  { fedUntilMs: fixed + 30 * 86400000 },
]) {
  test(`failed feed does not grow wool or consume fish: ${JSON.stringify(fields)}`, async () => {
    const { store, act } = setup({ feedProgress: 4, ...fields });
    const before = structuredClone(store.account());
    await assert.rejects(act('feed'));
    assert.deepEqual(store.account(), before);
  });
}

for (const stage of ['consume', 'deliver', 'extras', 'profile_record', 'commit']) {
  test(`fifth-feed rollback at ${stage} restores wool, fish, bones and daily receipts together`, async () => {
    const { store, act } = setup({ feedProgress: 4 });
    const before = structuredClone(store.account());
    const requestKey = randomUUID();
    store.failAt = stage;
    await assert.rejects(act('feed', { requestKey }), /simulated/);
    assert.deepEqual(store.account(), before);
    store.failAt = '';
    assert.equal((await act('feed', { requestKey })).woolGrown, 1);
    assert.equal(store.account().woolReady, 1);
    assert.equal(store.account().feedProgress, 0);
  });
}

test('shearing moves exactly one ranch unit per request without creating an inventory item or spending assets', async () => {
  let clock = fixed;
  const { store, service, act } = setup({ feedProgress: 2, woolReady: 2 }, () => clock);
  const assets = structuredClone(store.account().assets);
  const requestKey = randomUUID();
  const results = await Promise.all([act('shear', { requestKey }), act('shear', { requestKey })]);
  assert.equal(results.filter((result) => result.replayed).length, 1);
  assert.equal(results[0].wool, 1);
  assert.deepEqual(wool(store.account()), { feedProgress: 2, woolReady: 1, woolStored: 1 });
  await assert.rejects(act('shear'), { message: 'Max 被薅秃了，明天再来吧。' });
  clock += 86400000;
  await act('shear');
  clock += 86400000;
  await assert.rejects(act('shear'), /待剪/);
  assert.deepEqual(wool((await service.ownState(1)).ranch), {
    feedProgress: 2,
    woolReady: 0,
    woolStored: 2,
  });
  assert.deepEqual(store.account().assets, assets);
  assert.equal(store.account().electric, 120);
  assert.equal(store.account().magnetic, 86);
  assert.equal(store.account().ledger, undefined);
  await assert.rejects(act('rub_wool', { requestKey }), (error) => error.status === 409);
});

test('rubbing requires owned Max, a reusable rubber rod and previously sheared wool', async () => {
  for (const fields of [
    { adopted: false, assets: { rubber_rod: 1 }, woolStored: 1 },
    { assets: { max_pet: 1 }, woolStored: 1 },
    { woolReady: 1, woolStored: 0 },
  ]) {
    const { store, act } = setup(fields);
    const before = structuredClone(store.account());
    await assert.rejects(act('rub_wool'));
    assert.deepEqual(store.account(), before);
  }
  const { store, act } = setup({ adopted: false, assets: { rubber_rod: 1 }, woolReady: 1 });
  await assert.rejects(act('shear'), /购买 Max/);
  assert.equal(store.account().woolReady, 1);
});

test('rubbing credits exactly two electric with one ledger snapshot, leaves rod and heat unchanged, and replays once', async () => {
  const { store, service, act } = setup({ woolStored: 2, lastShearDay: beijingDay(fixed) });
  const other = structuredClone(store.account(2));
  const requestKey = randomUUID();
  const results = await Promise.all([
    act('rub_wool', { requestKey }),
    act('rub_wool', { requestKey }),
  ]);
  assert.equal(results.filter((result) => result.replayed).length, 1);
  assert.equal(results[0].electricReward, 2);
  assert.deepEqual(results[0].balance, { electric: '122', magnetic: '86', heat: '24' });
  assert.equal(store.account().woolStored, 1);
  assert.equal(store.account().assets.rubber_rod, 1);
  assert.equal((await service.ownState(1)).rubberRod, true);
  assert.equal(store.account().ledger.length, 1);
  const row = store.account().ledger[0];
  assert.equal(row.electric_before, '120');
  assert.equal(row.electric_after, '122');
  assert.equal(row.magnetic_before, '86');
  assert.equal(row.magnetic_after, '86');
  assert.equal(row.title, '羊毛摩擦发电');
  assert.match(row.reason, /1 份羊毛.*2 电元.*重复使用/);
  await act('rub_wool');
  assert.equal(store.account().electric, 124);
  assert.equal(store.account().assets.rubber_rod, 1);
  assert.equal(store.account().heat, 24);
  assert.equal(store.account().ledger.length, 2);
  assert.deepEqual(store.account(2), other);
});

test('Beijing midnight renews shearing and replaying yesterday never consumes the new daily allowance', async () => {
  let clock = Date.parse('2026-09-21T15:59:59.999Z');
  const midnight = Date.parse('2026-09-21T16:00:00Z');
  const { store, service, act } = setup({ feedProgress: 4, woolReady: 3 }, () => clock);
  const yesterday = randomUUID();
  const denied = randomUUID();
  const first = await act('shear', { requestKey: yesterday, day: '2026-01-01' });
  assert.equal(first.shearedToday, true);
  assert.equal(first.nextShearAtMs, midnight);
  assert.equal(store.account().lastShearDay, '2026-09-21');
  const own = await service.ownState(1);
  const visible = await service.publicProfile(1);
  assert.deepEqual(visible.ranch, own.ranch);
  assert.equal(own.ranch.shearedToday, true);
  assert.equal(own.ranch.nextShearAtMs, midnight);
  assert.equal(own.ranch.lastShearDay, undefined);
  assert.equal((await act('shear', { requestKey: yesterday })).replayed, true);
  await assert.rejects(act('shear', { requestKey: denied }), {
    message: 'Max 被薅秃了，明天再来吧。',
  });
  assert.equal(
    store.account().profileActions.some((row) => row.key === denied),
    false,
  );
  assert.deepEqual(wool(store.account()), { feedProgress: 4, woolReady: 2, woolStored: 1 });

  clock = midnight;
  const nextDay = await service.ownState(1);
  assert.equal(nextDay.ranch.shearedToday, false);
  assert.equal(nextDay.ranch.nextShearAtMs, 0);
  assert.deepEqual(wool(nextDay.ranch), wool(own.ranch));
  // An old successful receipt is returned before today's limit or wool checks.
  const replay = await act('shear', { requestKey: yesterday });
  assert.equal(replay.replayed, true);
  assert.equal(store.account().lastShearDay, '2026-09-21');
  assert.equal(store.account().woolReady, 2);
  await act('shear', { requestKey: denied });
  assert.equal(store.account().lastShearDay, '2026-09-22');
  assert.deepEqual(wool(store.account()), { feedProgress: 4, woolReady: 1, woolStored: 2 });
  assert.equal((await service.publicProfile(1)).ranch.nextShearAtMs, midnight + 86400000);
  await assert.rejects(act('shear'), { message: 'Max 被薅秃了，明天再来吧。' });
});

test('feeding after today’s shear still accumulates ready wool and another account has an independent allowance', async () => {
  const { store, act, service } = setup({ feedProgress: 4, woolReady: 2 });
  await act('shear');
  assert.equal((await act('feed')).woolGrown, 1);
  assert.deepEqual(wool(store.account()), { feedProgress: 0, woolReady: 2, woolStored: 1 });
  assert.equal((await service.publicProfile(1)).ranch.shearedToday, true);
  await assert.rejects(act('shear'), { message: 'Max 被薅秃了，明天再来吧。' });
  store.account(2).woolReady = 1;
  await act('shear', { userId: 2 });
  assert.equal(store.account(2).woolStored, 4);
  assert.equal(store.account(2).lastShearDay, beijingDay(fixed));
  assert.equal(store.account().woolReady, 2);
});

for (const stage of ['extras', 'profile_record', 'commit']) {
  test(`failed shearing at ${stage} rolls back the day marker and a same-key retry may still shear today`, async () => {
    const { store, act } = setup({ feedProgress: 3, woolReady: 2 });
    const before = structuredClone(store.account());
    const requestKey = randomUUID();
    store.failAt = stage;
    await assert.rejects(act('shear', { requestKey }), /simulated/);
    assert.deepEqual(store.account(), before);
    store.failAt = '';
    const result = await act('shear', { requestKey });
    assert.equal(result.shearedToday, true);
    assert.equal(store.account().lastShearDay, beijingDay(fixed));
    assert.deepEqual(wool(store.account()), { feedProgress: 3, woolReady: 1, woolStored: 1 });
  });
}

test('competing unique shears and rubs cannot overdraw wool or duplicate income', async () => {
  const { store, act } = setup({ woolReady: 2, woolStored: 1 });
  const shears = await Promise.allSettled(Array.from({ length: 7 }, () => act('shear')));
  assert.equal(shears.filter((result) => result.status === 'fulfilled').length, 1);
  for (const result of shears.filter((entry) => entry.status === 'rejected'))
    assert.equal(result.reason.message, 'Max 被薅秃了，明天再来吧。');
  assert.equal(store.account().woolReady, 1);
  assert.equal(store.account().woolStored, 2);
  const rubs = await Promise.allSettled(Array.from({ length: 7 }, () => act('rub_wool')));
  assert.equal(rubs.filter((result) => result.status === 'fulfilled').length, 2);
  assert.equal(store.account().woolStored, 0);
  assert.equal(store.account().electric, 124);
  assert.equal(store.account().ledger.length, 2);
});

for (const stage of ['credit', 'ledger', 'extras', 'profile_record', 'commit']) {
  test(`rub transaction failure at ${stage} rolls wool, balance, ledger and receipt back before a safe retry`, async () => {
    const { store, act } = setup({ woolStored: 1 });
    const before = structuredClone(store.account());
    const requestKey = randomUUID();
    store.failAt = stage;
    await assert.rejects(act('rub_wool', { requestKey }), /simulated/);
    assert.deepEqual(store.account(), before);
    store.failAt = '';
    await act('rub_wool', { requestKey });
    assert.equal(store.account().electric, 122);
    assert.equal(store.account().woolStored, 0);
    assert.equal(store.account().ledger.length, 1);
  });
}

test('invalid action IDs, balances and counter limits fail without consuming wool or fish', async () => {
  const { store, act } = setup({ woolStored: 1, electric: Number.MAX_SAFE_INTEGER - 1 });
  const before = structuredClone(store.account());
  await assert.rejects(act('rub_wool'));
  for (const requestKey of ['', '../another', '1', 'not-a-uuid'])
    await assert.rejects(act('shear', { requestKey }));
  await assert.rejects(act('claim_wool'));
  assert.deepEqual(store.account(), before);
  store.account().woolReady = 4294967295;
  store.account().feedProgress = 4;
  await assert.rejects(act('feed'), /上限/);
  assert.equal(store.account().assets.fish, 20);
  store.account().woolStored = 4294967295;
  await assert.rejects(act('shear'), /上限/);
});

function mysqlFixture({ missingLedger = false, failReceipt = false } = {}) {
  const calls = [];
  const ledger = [{ id: '12', user_id: 1, source_key: null }];
  const connection = {
    async beginTransaction() {
      calls.push({ sql: 'BEGIN' });
    },
    async commit() {
      calls.push({ sql: 'COMMIT' });
    },
    async rollback() {
      calls.push({ sql: 'ROLLBACK' });
    },
    release() {
      calls.push({ sql: 'RELEASE' });
    },
    async execute(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT id FROM users')) return [[{ id: 1 }]];
      if (sql.includes('FROM user_profile_actions')) return [[]];
      if (sql.includes('FROM user_profile_extras'))
        return [[{ equipped_json: {}, adopted: 1, last_feed_day: '' }]];
      if (sql.includes('FROM user_assets')) return [[{ asset_key: 'rubber_rod', quantity: 1 }]];
      if (sql.includes('FROM economy_account_state')) return [[]];
      if (sql.includes('FROM user_ranch_wool'))
        return [[{ feed_progress: 3, wool_ready: 2, wool_stored: 1 }]];
      if (sql.startsWith('SELECT CAST(id AS CHAR) AS id FROM wallet_ledger')) {
        assert.match(sql, /ORDER BY id DESC LIMIT 1 FOR UPDATE$/);
        return [[{ id: ledger.at(-1).id }]];
      }
      if (sql.startsWith('UPDATE users')) {
        if (!missingLedger) ledger.push({ id: '13', user_id: 1, source_key: null });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE wallet_ledger')) {
        const [sourceKey, title, reason, userId, afterId] = values;
        const row = ledger.findLast(
          (entry) =>
            entry.user_id === userId &&
            BigInt(entry.id) > BigInt(afterId) &&
            entry.source_key === null,
        );
        if (row) Object.assign(row, { source_key: sourceKey, title, reason });
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (sql.startsWith('SELECT CAST(electrons'))
        return [[{ electric: '122', magnetic: '86', heat: '24' }]];
      if (failReceipt && sql.startsWith('INSERT INTO user_profile_actions'))
        throw new Error('receipt storage failed');
      return [{ affectedRows: 1 }];
    },
  };
  const pool = { getConnection: async () => connection };
  return { calls, connection, pool, ledger };
}

test('MySQL wool action locks the account before reading state, annotates only its new trigger row and commits one receipt', async () => {
  const { calls, pool, ledger } = mysqlFixture();
  const requestKey = randomUUID();
  const service = createProfileExtras(createMysqlEconomyStore(pool), { now: () => fixed });
  const result = await service.act({ userId: 1, action: 'rub_wool', requestKey });
  assert.equal(result.woolStored, 0);
  assert.equal(calls[0].sql, 'BEGIN');
  assert.match(calls[1].sql, /FROM users.*FOR UPDATE/);
  assert.deepEqual(calls[1].values, [1]);
  const credit = calls.find((entry) => entry.sql.startsWith('UPDATE users'));
  assert.match(credit.sql, /electrons = electrons \+ \?.*electrons >= 0 AND electrons <= \?/);
  assert.doesNotMatch(credit.sql, /heat|manetrons/);
  assert.deepEqual(credit.values, [2, 1, Number.MAX_SAFE_INTEGER - 2]);
  const annotated = calls.find((entry) => entry.sql.startsWith('UPDATE wallet_ledger'));
  assert.match(annotated.sql, /user_id = \? AND id > \?.*ORDER BY id DESC LIMIT 1/);
  assert.match(annotated.sql, /source_key IS NULL/);
  assert.deepEqual(annotated.values.slice(-2), [1, '12']);
  assert.equal(annotated.values[0], `ranch-wool:${requestKey}`);
  assert.equal(ledger[0].source_key, null);
  assert.equal(ledger[1].source_key, `ranch-wool:${requestKey}`);
  assert.equal(
    calls.some((entry) => entry.sql.startsWith('INSERT INTO wallet_ledger')),
    false,
  );
  const saved = calls.find((entry) => entry.sql.startsWith('INSERT INTO user_ranch_wool'));
  assert.deepEqual(saved.values, [1, 3, 2, 0, '']);
  const receipt = calls.find((entry) => entry.sql.startsWith('INSERT INTO user_profile_actions'));
  assert.deepEqual(receipt.values.slice(0, 2), [1, requestKey]);
  assert.equal(JSON.parse(receipt.values[3]).electricReward, 2);
  assert.deepEqual(
    calls.slice(-2).map((entry) => entry.sql),
    ['COMMIT', 'RELEASE'],
  );
});

test('MySQL shear persists the Beijing day in the same locked transaction as quantity and receipt', async () => {
  const { calls, pool } = mysqlFixture();
  const service = createProfileExtras(createMysqlEconomyStore(pool), { now: () => fixed });
  await service.act({ userId: 1, action: 'shear', requestKey: randomUUID() });
  assert.match(calls[1].sql, /FROM users.*FOR UPDATE/);
  const saved = calls.find((entry) => entry.sql.startsWith('INSERT INTO user_ranch_wool'));
  assert.match(saved.sql, /last_shear_day = VALUES\(last_shear_day\)/);
  assert.deepEqual(saved.values, [1, 3, 1, 2, '2026-09-21']);
  assert.equal(
    calls.some((entry) => entry.sql.startsWith('UPDATE users')),
    false,
  );
  assert.equal(
    calls.filter((entry) => entry.sql.startsWith('INSERT INTO user_profile_actions')).length,
    1,
  );
  assert.deepEqual(
    calls.slice(-2).map((entry) => entry.sql),
    ['COMMIT', 'RELEASE'],
  );
});

for (const failure of [{ missingLedger: true }, { failReceipt: true }]) {
  test(`MySQL wool rollback rejects unrecorded money and partial receipts: ${JSON.stringify(failure)}`, async () => {
    const { calls, pool } = mysqlFixture(failure);
    const service = createProfileExtras(createMysqlEconomyStore(pool));
    await assert.rejects(service.act({ userId: 1, action: 'rub_wool', requestKey: randomUUID() }));
    assert.equal(
      calls.some((entry) => entry.sql === 'COMMIT'),
      false,
    );
    assert.deepEqual(
      calls.slice(-2).map((entry) => entry.sql),
      ['ROLLBACK', 'RELEASE'],
    );
  });
}

test('SQL reads default missing wool rows to zero and always bind the requested account', async () => {
  const calls = [];
  const connection = {
    async execute(sql, values) {
      calls.push({ sql, values });
      return [[]];
    },
  };
  const state = await readExtras(connection, 37);
  assert.deepEqual(wool(state), { feedProgress: 0, woolReady: 0, woolStored: 0 });
  assert.equal(state.lastShearDay, '');
  assert.equal(calls.length, 4);
  for (const call of calls) assert.deepEqual(call.values, [37]);
  assert.equal(
    calls.some((call) => /INSERT|UPDATE/.test(call.sql)),
    false,
  );
  const methods = mysqlProfileMethods(connection);
  assert.equal(typeof methods.creditWool, 'function');
});

test('wool migration creates an isolated zero-default table with constrained progress and no historical backfill', async () => {
  const statements = [];
  let fail = true;
  const pool = {
    async query(sql) {
      statements.push(sql);
      if (fail && sql.includes('user_ranch_wool')) throw new Error('temporary DDL failure');
    },
  };
  await assert.rejects(ensureProfileExtrasTables(pool), /temporary/);
  fail = false;
  await ensureProfileExtrasTables(pool);
  const ddl = statements.find((sql) => sql.includes('user_ranch_wool'));
  assert.match(ddl, /CREATE TABLE IF NOT EXISTS user_ranch_wool/);
  assert.match(ddl, /feed_progress TINYINT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(ddl, /CHECK \(feed_progress < 5\)/);
  assert.match(ddl, /wool_ready INT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(ddl, /wool_stored INT UNSIGNED NOT NULL DEFAULT 0/);
  assert.match(ddl, /last_shear_day VARCHAR\(10\) NOT NULL DEFAULT ''/);
  assert.match(ddl, /FOREIGN KEY \(user_id\).*REFERENCES users \(id\)/);
  assert.equal(
    statements.some((sql) =>
      /\b(?:INSERT|UPDATE|ALTER|DROP)\b/.test(sql.replace(/ON UPDATE CURRENT_TIMESTAMP\(3\)/, '')),
    ),
    false,
  );
});
