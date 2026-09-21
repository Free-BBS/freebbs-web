const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { createBoneSales, createBoneSalesRouter } = require('./economy-sales');
const { createMysqlEconomyStore } = require('./economy-shop');
const { createEconomyMemoryStore } = require('../scripts/fixtures/economy-memory-store');

function setup(
  accounts = [{ id: 1, assets: { ordinary_fishbone: 10, golden_fishbone: 3, fishbone: 10 } }],
) {
  const store = createEconomyMemoryStore(accounts);
  const transact = store.transaction.bind(store);
  const fail = (stage) => {
    if (store.failAt === stage) throw new Error(`simulated ${stage}`);
  };
  store.transaction = (work) =>
    transact((tx) =>
      work({
        ...tx,
        async consumeSaleAssets(id, key, quantity) {
          fail('consume');
          const account = store.account(id);
          if ((account.assets[key] || 0) < quantity) return false;
          account.assets[key] -= quantity;
          return true;
        },
        async saleAssetQuantity(id, key) {
          return String(store.account(id).assets[key] || 0);
        },
        async creditBoneSale(id, amount, annotation) {
          fail('credit');
          const account = store.account(id);
          const before = account.magnetic;
          account.magnetic += amount;
          fail('ledger');
          account.ledger ||= [];
          account.ledger.push({
            electric_before: account.electric,
            electric_after: account.electric,
            magnetic_before: before,
            magnetic_after: account.magnetic,
            ...annotation,
          });
          return {
            electric: String(account.electric),
            magnetic: String(account.magnetic),
            heat: String(account.heat),
          };
        },
      }),
    );
  const sales = createBoneSales(store);
  const sell = (overrides = {}) =>
    sales.sell({
      userId: 1,
      itemKey: 'ordinary_fishbone',
      quantity: 1,
      requestKey: randomUUID(),
      ...overrides,
    });
  return { sales, sell, store };
}

test('ordinary and golden bones sell at 1 and 10 magnetic each without heat or purchase progress', async () => {
  const { sell, store } = setup();
  const ordinary = await sell({ quantity: 4 });
  const golden = await sell({ itemKey: 'golden_fishbone', quantity: 2 });
  assert.equal(ordinary.amount, 4);
  assert.equal(ordinary.remainingQuantity, '6');
  assert.equal(golden.amount, 20);
  assert.deepEqual(golden.balance, { electric: '10000', magnetic: '10024', heat: '0' });
  assert.equal(store.account().assets.fishbone, 10);
  assert.equal(store.account().counts.fishbone, undefined);
  assert.deepEqual(
    store.account().ledger.map((entry) => [entry.magnetic_before, entry.magnetic_after]),
    [
      [10000, 10004],
      [10004, 10024],
    ],
  );
  assert.match(store.account().ledger[1].reason, /黄金鱼骨 × 2.*10 磁元.*20 磁元/);
});

test('sales allow only earned bones, integer quantities and UUID request keys', async () => {
  const { sell, store } = setup();
  const before = structuredClone(store.account());
  for (const itemKey of [
    'fishbone',
    'fish',
    'toString',
    '__proto__',
    '',
    null,
    ['ordinary_fishbone'],
  ]) {
    await assert.rejects(sell({ itemKey }), { code: 'INVALID_SALE' });
  }
  for (const quantity of [0, -1, 0.5, '2', null, true, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(sell({ quantity }), { code: 'INVALID_SALE' });
  }
  await assert.rejects(sell({ itemKey: 'golden_fishbone', quantity: Number.MAX_SAFE_INTEGER }), {
    code: 'INVALID_SALE',
  });
  await assert.rejects(sell({ requestKey: 'not-a-uuid' }), { code: 'INVALID_SALE' });
  assert.deepEqual(store.account(), before);
});

test('retrying or concurrently sending the same sale creates one credit and one ledger entry', async () => {
  const { sell, store } = setup();
  const requestKey = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => sell({ quantity: 3, requestKey })),
  );
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  assert.equal(store.account().assets.ordinary_fishbone, 7);
  assert.equal(store.account().magnetic, 10003);
  assert.equal(store.account().ledger.length, 1);
  assert.equal(store.account().purchases.length, 1);
  await assert.rejects(sell({ requestKey, quantity: 2 }), { code: 'REQUEST_CONFLICT' });
  await assert.rejects(sell({ requestKey, quantity: 3, itemKey: 'golden_fishbone' }), {
    code: 'REQUEST_CONFLICT',
  });
});

test('competing unique sales cannot oversell inventory', async () => {
  const { sell, store } = setup();
  const results = await Promise.allSettled([sell({ quantity: 7 }), sell({ quantity: 7 })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'INSUFFICIENT_ASSETS');
  assert.equal(store.account().assets.ordinary_fishbone, 3);
  assert.equal(store.account().magnetic, 10007);
  assert.equal(store.account().ledger.length, 1);
});

test('insufficient inventory and purchase request conflicts do not mutate the account', async () => {
  const { sell, store } = setup();
  const requestKey = randomUUID();
  store
    .account()
    .purchases.push({ key: requestKey, fingerprint: 'existing shop purchase', result: {} });
  const before = structuredClone(store.account());
  await assert.rejects(sell({ quantity: 11 }), { code: 'INSUFFICIENT_ASSETS' });
  await assert.rejects(sell({ requestKey }), { code: 'REQUEST_CONFLICT' });
  assert.deepEqual(store.account(), before);
});

test('selling all bones preserves an earned fishbone-master achievement', async () => {
  const { sell, store } = setup([
    { id: 1, counts: { fishbone: 10 }, assets: { ordinary_fishbone: 10, golden_fishbone: 3 } },
  ]);
  const result = await sell({ quantity: 10 });
  assert.deepEqual(result.unlocked, ['plate_fishbone_master']);
  assert.equal(store.account().assets.plate_fishbone_master, 1);
  assert.equal(store.account().assets.ordinary_fishbone, 0);
  await sell({ itemKey: 'golden_fishbone', quantity: 3 });
  assert.equal(store.account().assets.plate_fishbone_master, 1);
});

for (const failAt of ['consume', 'credit', 'ledger', 'advance', 'record', 'commit']) {
  test(`sale transaction rolls back inventory, balance, achievement and ledger at ${failAt}`, async () => {
    const { sell, store } = setup([
      { id: 1, counts: { fishbone: 10 }, assets: { ordinary_fishbone: 10, golden_fishbone: 3 } },
    ]);
    const before = structuredClone(store.account());
    store.failAt = failAt;
    await assert.rejects(sell({ quantity: 3 }), /simulated/);
    assert.deepEqual(store.account(), before);
  });
}

test('sale route authenticates, uses caller identity, and returns safe errors', async (t) => {
  const { sales, store } = setup();
  const app = express();
  app.use(express.json());
  app.use(
    '/api',
    createBoneSalesRouter({
      sales,
      requireAuth: async (req, res) => {
        if (req.headers.authorization !== 'Bearer local') {
          res.status(401).json({ message: '请先登录' });
          return null;
        }
        return { id: 1 };
      },
    }),
  );
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
  const url = `http://127.0.0.1:${server.address().port}/api/shop/sell`;
  const body = { userId: 99, itemKey: 'golden_fishbone', quantity: 2, requestKey: randomUUID() };
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  const headers = { Authorization: 'Bearer local', 'Content-Type': 'application/json' };
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await response.json()).receipt.amount, 20);
  assert.equal(store.account().magnetic, 10020);
  const invalid = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, quantity: 0 }),
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'INVALID_SALE');
  store.failAt = 'credit';
  const failure = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, quantity: 1, requestKey: randomUUID() }),
  });
  assert.equal(failure.status, 500);
  assert.doesNotMatch(JSON.stringify(await failure.json()), /simulated/);
});

test('MySQL adapter guards inventory and annotates income in the balance transaction', async () => {
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
      if (sql.includes('CAST(electrons')) return [[{ electric: '12', magnetic: '25', heat: '6' }]];
      if (sql.includes('CAST(quantity')) return [[{ quantity: '2' }]];
      return [{ affectedRows: 1 }];
    },
  };
  const store = createMysqlEconomyStore({
    async getConnection() {
      return connection;
    },
  });
  await store.transaction(async (tx) => {
    assert.equal(await tx.consumeSaleAssets(7, 'golden_fishbone', 2), true);
    assert.deepEqual(
      await tx.creditBoneSale(7, 20, { sourceKey: 'sale-key', title: '出售', reason: '黄金鱼骨' }),
      { electric: '12', magnetic: '25', heat: '6' },
    );
    assert.equal(await tx.saleAssetQuantity(7, 'golden_fishbone'), '2');
  });
  assert.match(calls[1].sql, /quantity >= \?/);
  assert.deepEqual(calls[1].params, [2, 7, 'golden_fishbone', 2]);
  assert.match(calls[2].sql, /SET manetrons = manetrons \+ \?/);
  assert.doesNotMatch(calls[2].sql, /heat/);
  assert.deepEqual(calls[2].params, [20, 7, Number.MAX_SAFE_INTEGER - 20]);
  assert.match(calls[3].sql, /UPDATE wallet_ledger/);
  assert.deepEqual(calls.slice(-2), ['commit', 'release']);
});

test('missing ledger row aborts MySQL sale instead of leaving an unrecorded credit', async () => {
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
    async execute(sql) {
      return [{ affectedRows: sql.startsWith('UPDATE wallet_ledger') ? 0 : 1 }];
    },
  };
  const store = createMysqlEconomyStore({
    async getConnection() {
      return connection;
    },
  });
  await assert.rejects(
    store.transaction((tx) =>
      tx.creditBoneSale(1, 10, { sourceKey: 'sale', title: '出售', reason: '鱼骨' }),
    ),
    /ledger entry missing/,
  );
  assert.deepEqual(calls, ['begin', 'rollback', 'release']);
});
