const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  createEconomyShop,
  createMysqlEconomyStore,
  ensureShopPurchaseTables,
  FRAGMENT_PRICES,
  DAY_MS,
  LASER_POLICY,
} = require('./economy-shop');
const { createEconomyMemoryStore } = require('../scripts/fixtures/economy-memory-store');
const items = require('../public/data/shop-items.json').items.map((item) => ({
  ...item,
  isGift: item.isgift !== false,
}));

function setup(accounts, options) {
  const store = createEconomyMemoryStore(accounts, options);
  const clock = { value: Date.parse('2026-09-14T02:00:00Z') };
  const shop = createEconomyShop(store, { now: () => clock.value });
  const buy = async (key, extra = {}) => {
    const userId = extra.userId || 1;
    const item = (await shop.decorate(items, userId)).find((i) => i.key === key);
    return shop.purchase({
      userId,
      item: items.find((i) => i.key === key),
      currency: item.priceMode === 'combined' ? 'combined' : 'electric',
      requestKey: crypto.randomUUID(),
      expectedPurchaseCount: item.purchasePolicy.purchasedCount,
      quotedCost: item.cost,
      ...extra,
    });
  };
  const charge = (extra = {}) =>
    shop.purchase({
      userId: 1,
      item: items.find((i) => i.key === 'laser'),
      action: 'charge',
      currency: 'combined',
      days: 1,
      quotedDailyPrice: LASER_POLICY.dailyPrice,
      quotedDailyMagnetic: LASER_POLICY.dailyMagnetic,
      requestKey: crypto.randomUUID(),
      ...extra,
    });
  return { shop, store, clock, buy, charge };
}
test('fragment ladder is exact, capped at ten, and independent from fishbones', async () => {
  const { buy, store } = setup([{ id: 1, assets: { fishbone: 99 } }]);
  for (const price of FRAGMENT_PRICES) {
    const receipt = await buy('mysterious_fragment');
    assert.equal(receipt.amount, price);
  }
  assert.equal(store.account().electric, 10000 - 1417);
  assert.equal(store.account().assets.fishbone, 99);
  await assert.rejects(buy('mysterious_fragment'), { code: 'PURCHASE_LIMIT' });
});

test('rubber rod purchase records its real reason and same receipt never duplicates the debit', async () => {
  const { buy, store } = setup([{ id: 1, electric: 31, magnetic: 10 }], { recordLedger: true });
  const requestKey = crypto.randomUUID();
  const args = {
    currency: 'magnetic',
    requestKey,
    expectedPurchaseCount: 0,
    quotedCost: { magnetic: 7 },
  };
  await buy('rubber_rod', args);
  assert.equal((await buy('rubber_rod', args)).replayed, true);
  const [row] = store.account().ledger;
  assert.equal(store.account().ledger.length, 1);
  assert.equal(row.title, '商城购买');
  assert.match(row.reason, /橡胶棒.*7 磁元/);
  assert.equal(row.source_key, `shop:${requestKey}:magnetic`);
  assert.deepEqual(
    [row.electric_after, row.magnetic_before, row.magnetic_after],
    ['31', '10', '3'],
  );
});

test('combined purchases and laser charges explain every currency row with contiguous balances', async () => {
  const { buy, charge, store } = setup(undefined, { recordLedger: true });
  await buy('maxwell_spectacles');
  await buy('laser');
  await charge({ days: 3 });
  const rows = store.account().ledger;
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.source_key && r.title && r.reason));
  assert.equal(new Set(rows.map((r) => r.source_key)).size, rows.length);
  for (let i = 1; i < rows.length; i += 1) {
    assert.equal(rows[i].electric_before, rows[i - 1].electric_after);
    assert.equal(rows[i].magnetic_before, rows[i - 1].magnetic_after);
  }
  assert.match(rows[3].reason, /充值 3 天.*3 电元/);
  assert.match(rows[4].reason, /充值 3 天.*3 磁元/);
});

test('missing shop ledger annotation rolls back debit, heat, delivery and receipt', async () => {
  const { buy, store } = setup(undefined, { recordLedger: true });
  const before = structuredClone(store.account());
  store.failAt = 'ledger';
  await assert.rejects(buy('fish', { currency: 'magnetic' }), /simulated ledger/);
  assert.deepEqual(store.account(), before);
});

test('MySQL debit annotates only the newly triggered row and rolls back when it is missing', async () => {
  for (const annotationRows of [1, 0]) {
    const calls = [];
    const connection = {
      async beginTransaction() {
        calls.push('begin');
      },
      async commit() {
        calls.push('commit');
      },
      async rollback() {
        calls.push('rollback');
      },
      release() {
        calls.push('release');
      },
      async execute(sql, params) {
        calls.push({ sql, params });
        if (sql.startsWith('SELECT CAST(id AS CHAR) AS id FROM wallet_ledger'))
          return [[{ id: '91' }]];
        return [{ affectedRows: sql.startsWith('UPDATE wallet_ledger') ? annotationRows : 1 }];
      },
    };
    const store = createMysqlEconomyStore({ getConnection: async () => connection });
    const operation = store.transaction((tx) =>
      tx.debit(1, 7, 'magnetic', true, {
        sourceKey: 'shop:rod',
        title: '商城购买',
        reason: '购买橡胶棒，支付 7 磁元',
      }),
    );
    if (annotationRows) assert.equal(await operation, true);
    else await assert.rejects(operation, /entry missing/);
    assert.equal(calls.at(-2), annotationRows ? 'commit' : 'rollback');
    const annotation = calls.find((c) => c.sql?.startsWith('UPDATE wallet_ledger'));
    assert.deepEqual(annotation.params.slice(3), [1, '91']);
    assert.match(annotation.sql, /id > \? AND source_key IS NULL/);
  }
});
test('legacy fishbones do not seed counters; fixed-price new purchases stop at ten', async () => {
  const { buy, store } = setup([{ id: 1, assets: { fishbone: 2 } }]);
  for (let i = 0; i < 10; i += 1) assert.equal((await buy('fishbone')).amount, 5);
  assert.equal(store.account().assets.fishbone, 12);
  store.account().assets.fishbone = 100;
  await assert.rejects(buy('fishbone'), { code: 'PURCHASE_LIMIT' });
});

test('tenth bone purchase unlocks fishbone master if gold already exists; replay is safe', async () => {
  const { buy, store } = setup([
    { id: 1, counts: { fishbone: 9 }, assets: { golden_fishbone: 3, ordinary_fishbone: 10 } },
  ]);
  const requestKey = crypto.randomUUID();
  const receipt = await buy('fishbone', { requestKey });
  assert.deepEqual(receipt.unlocked, ['plate_fishbone_master']);
  assert.equal(store.account().assets.plate_fishbone_master, 1);
  await buy('fishbone', { requestKey, expectedPurchaseCount: 9, quotedCost: { electric: 5 } });
  assert.equal(store.account().assets.plate_fishbone_master, 1);
  assert.equal(store.account().electric, 9995);
});

test('ten purchased bones without gold do not unlock the achievement', async () => {
  const { buy, store } = setup([{ id: 1, counts: { fishbone: 9 }, assets: { fishbone: 99 } }]);
  await buy('fishbone');
  assert.equal(store.account().assets.plate_fishbone_master, undefined);
});

test('purchase receipt failure rolls back the achievement, purchase count and debit', async () => {
  const { buy, store } = setup([
    { id: 1, counts: { fishbone: 9 }, assets: { golden_fishbone: 3, ordinary_fishbone: 10 } },
  ]);
  store.failAt = 'record';
  await assert.rejects(buy('fishbone'));
  assert.equal(store.account().assets.plate_fishbone_master, undefined);
  assert.equal(store.account().counts.fishbone, 9);
  assert.equal(store.account().electric, 10000);
});
test('laser purchase gives a durable asset, no light time and no magnetic debit', async () => {
  const { buy, store, shop } = setup();
  await buy('laser');
  assert.equal(store.account().assets.laser, 1);
  assert.equal(store.account().electric, 9975);
  assert.equal(store.account().magnetic, 10000);
  assert.equal((await shop.decorate(items, 1)).find((i) => i.key === 'laser').laser.active, false);
  await assert.rejects(buy('laser'), { code: 'PURCHASE_LIMIT' });
});
test('charge requires ownership and requires both currencies', async () => {
  const { charge, buy } = setup();
  await assert.rejects(charge(), { code: 'LASER_REQUIRED' });
  await buy('laser');
  for (const currency of ['magnetic', 'electric', 'invalid'])
    await assert.rejects(charge({ currency }), { code: 'INVALID_CURRENCY' });
});
test('charge expires after 24 hours; reading expiry never debits the wallet', async () => {
  const { charge, buy, clock, shop, store } = setup();
  await buy('laser');
  const r = await charge();
  assert.equal(r.expiresAtMs, clock.value + DAY_MS);
  clock.value = r.expiresAtMs - 1;
  assert.equal((await shop.decorate(items, 1)).find((i) => i.key === 'laser').laser.active, true);
  clock.value += 1;
  assert.equal((await shop.decorate(items, 1)).find((i) => i.key === 'laser').laser.active, false);
  clock.value += DAY_MS * 30;
  await shop.decorate(items, 1);
  assert.equal(store.account().electric, 9974);
});
test('early recharge extends old expiry; lapsed recharge restarts from now', async () => {
  const { charge, buy, clock } = setup();
  await buy('laser');
  const first = await charge();
  const second = await charge({ days: 7 });
  assert.equal(second.expiresAtMs, first.expiresAtMs + 7 * DAY_MS);
  clock.value = second.expiresAtMs + DAY_MS;
  assert.equal((await charge()).expiresAtMs, clock.value + DAY_MS);
});
test('replaying a recharge never repeats debit or extension, including concurrent requests', async () => {
  const { charge, buy, store } = setup();
  await buy('laser');
  const requestKey = crypto.randomUUID();
  const results = await Promise.all([charge({ requestKey }), charge({ requestKey })]);
  assert.deepEqual(
    results.map((r) => r.replayed),
    [false, true],
  );
  assert.equal(results[0].expiresAtMs, results[1].expiresAtMs);
  assert.equal(store.account().electric, 9974);
  await assert.rejects(charge({ requestKey, days: 7 }), { code: 'REQUEST_CONFLICT' });
});
test('simultaneous unique laser purchases cannot create two devices', async () => {
  const { buy, store } = setup();
  const results = await Promise.allSettled([buy('laser'), buy('laser')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(store.account().assets.laser, 1);
  assert.equal(store.account().electric, 9975);
});
test('combined relic price debits BOTH currencies and delivers exactly once', async () => {
  const { buy, store } = setup();
  const requestKey = crypto.randomUUID();
  const r = await buy('maxwell_spectacles', { requestKey });
  assert.deepEqual(r.cost, { electric: 200, magnetic: 200 });
  assert.equal(store.account().electric, 9800);
  assert.equal(store.account().magnetic, 9800);
  assert.equal(store.account().assets.maxwell_spectacles, 1);
  const replay = await buy('maxwell_spectacles', {
    requestKey,
    expectedPurchaseCount: 0,
    quotedCost: { electric: 200, magnetic: 200 },
  });
  assert.equal(replay.replayed, true);
  assert.equal(store.account().assets.maxwell_spectacles, 1);
});
for (const currency of ['electric', 'magnetic']) {
  test(`insufficient ${currency} rolls back the entire combined purchase`, async () => {
    const { buy, store } = setup([{ id: 1, [currency]: 0 }]);
    const before = structuredClone(store.account());
    await assert.rejects(buy('maxwell_spectacles'), { code: 'INSUFFICIENT_BALANCE' });
    assert.deepEqual(store.account(), before);
  });
}
test('combined-price relic cannot be bought with either currency alone', async () => {
  const { buy } = setup();
  for (const currency of ['electric', 'magnetic'])
    await assert.rejects(buy('maxwell_spectacles', { currency }), { code: 'INVALID_CURRENCY' });
});
test('stale combined price and stale laser daily price do not charge', async () => {
  const { buy, charge, store } = setup();
  await assert.rejects(buy('maxwell_spectacles', { quotedCost: { electric: 120, magnetic: 1 } }), {
    code: 'PRICE_CHANGED',
  });
  await buy('laser');
  await assert.rejects(charge({ quotedDailyPrice: 99 }), { code: 'PRICE_CHANGED' });
  assert.equal(store.account().electric, 9975);
});
test('invalid recharge periods and request IDs cannot mutate state', async () => {
  const { buy, charge, store } = setup();
  await buy('laser');
  for (const days of [0, -1, 1.5, 31, '7', Infinity])
    await assert.rejects(charge({ days }), { code: 'INVALID_PURCHASE' });
  await assert.rejects(charge({ requestKey: 'fake' }), { code: 'INVALID_PURCHASE' });
  assert.equal(store.account().expiresAtMs, 0);
});
for (const failAt of ['debit_magnetic', 'deliver', 'record', 'advance', 'commit']) {
  test(`combined transaction rollback at ${failAt}`, async () => {
    const { store, buy } = setup();
    const before = structuredClone(store.account());
    store.failAt = failAt;
    await assert.rejects(buy('maxwell_spectacles'), /simulated/);
    assert.deepEqual(store.account(), before);
  });
}
test('failed lease write does not consume electricity', async () => {
  const { store, buy, charge } = setup();
  await buy('laser');
  const before = structuredClone(store.account());
  store.failAt = 'lease';
  await assert.rejects(charge(), /simulated/);
  assert.deepEqual(store.account(), before);
});
test('public decoration excludes anonymous and deleted posts and unrelated accounts', async () => {
  const { buy, charge, shop } = setup([{ id: 1 }, { id: 2 }]);
  await buy('laser');
  await charge();
  const rows = await shop.decoratePosts([
    { user_id: 1 },
    { user_id: 2 },
    { user_id: 1, is_anonymous: true },
    { user_id: 1, is_deleted: true },
  ]);
  assert.equal(rows[0].laser.active, true);
  assert.equal(rows[1].laser.active, false);
  assert.equal(rows[2].laser, null);
  assert.equal(rows[3].laser, null);
});
test('one author lease applies to historical/new posts and replies on another author post', async () => {
  const { buy, charge, shop, clock } = setup([{ id: 1 }, { id: 2 }]);
  const content = [
    { user_id: 1, created_at: '2020-01-01' },
    { user_id: 1, created_at: '2026-09-14' },
    { user_id: 1, post_id: 2, parent_comment_id: 99, created_at: '2020-01-01' },
    { user_id: 2 },
  ];
  await buy('laser');
  assert.ok((await shop.decoratePosts(content)).every((row) => !row.laser.active));
  await charge();
  let rows = await shop.decoratePosts(content);
  assert.ok(rows.slice(0, 3).every((row) => row.laser.active));
  assert.equal(new Set(rows.slice(0, 3).map((row) => row.laser.expiresAtMs)).size, 1);
  assert.equal(rows[3].laser.active, false);
  clock.value = rows[0].laser.expiresAtMs;
  rows = await shop.decoratePosts(content);
  assert.ok(rows.every((row) => !row.laser.active));
});

test('public collection only contains owned scholar relics, not wallet or other assets', async () => {
  const { shop } = setup([
    { id: 1, assets: { mysterious_fragment: 2, laser: 1, maxwell_spectacles: 1 } },
    { id: 2 },
  ]);
  const result = await shop.publicCollectibles(items, 1);
  assert.deepEqual(
    result.map((i) => i.key),
    ['maxwell_spectacles'],
  );
  assert.deepEqual(Object.keys(result[0]).sort(), ['description', 'image', 'key', 'name']);
  assert.deepEqual(await shop.publicCollectibles(items, 2), []);
});
test('SQL transaction adapter locks account, rolls back failures and releases connection', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() {
      calls.push('begin');
    },
    async commit() {
      calls.push('commit');
    },
    async rollback() {
      calls.push('rollback');
    },
    release() {
      calls.push('release');
    },
    async execute(sql, params) {
      calls.push([sql, params]);
      return [[{ id: 1 }]];
    },
  };
  const store = createMysqlEconomyStore({
    async getConnection() {
      return connection;
    },
  });
  await assert.rejects(
    store.transaction(async (tx) => {
      await tx.lockUser(1);
      throw new Error('abort');
    }),
    /abort/,
  );
  assert.equal(calls[0], 'begin');
  assert.match(calls[1][0], /WHERE id = \? FOR UPDATE/);
  assert.deepEqual(calls[1][1], [1]);
  assert.deepEqual(calls.slice(-2), ['rollback', 'release']);
});
test('migration creates only new tables, never seeds counters from legacy assets', async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../database/migrations/037_shop_purchase_progress.sql'),
    'utf8',
  );
  assert.doesNotMatch(sql, /INSERT|UPDATE user_assets|initial_quantity|shop_policy_migrations/);
  const statements = [];
  await ensureShopPurchaseTables({
    async query(statement) {
      statements.push(statement);
    },
  });
  assert.equal(statements.length, 3);
  assert.ok(statements.every((s) => s.startsWith('CREATE TABLE IF NOT EXISTS')));
});
test('catalog has dual-cost collectible relics and dual-currency laser activation policy', () => {
  const laser = items.find((i) => i.key === 'laser');
  assert.deepEqual(laser.cost, { electric: LASER_POLICY.purchasePrice });
  const relics = items.filter((i) => i.class === 'scholar_relic');
  assert.equal(relics.length, 4);
  for (const item of relics) {
    assert.equal(item.priceMode, 'combined');
    assert.equal(item.isGift, false);
    assert.ok(item.cost.electric === 200 && item.cost.magnetic === 200);
    assert.match(item.rules, /可在个人收藏中展示/);
    assert.match(item.rules, /后续会提供对应实物/);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', item.image)));
  }
});
