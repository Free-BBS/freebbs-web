const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { refundRanchBicyclePurchases, CAMPAIGN } = require('./ranch-bicycle-refund');

function fixture({ receipts = [], missingLedger = false, failReceipt = false, balance = 40 } = {}) {
  const state = {
    wallet: { magnetic: balance, electric: 70, heat: 80 },
    receipts,
    refunds: [],
    ledger: [],
  };
  let tail = Promise.resolve();
  const eligible = (row) =>
    row.item_key === 'ranch_bicycle' && row.currency === 'magnetic' && row.amount === 30;
  const pool = {
    async execute(sql) {
      assert.match(sql, /LEFT JOIN shop_price_refunds/);
      return [
        state.receipts
          .filter(
            (row) => eligible(row) && !state.refunds.some((entry) => entry.purchase_id === row.id),
          )
          .slice(0, 200)
          .map((row) => ({ purchase_id: row.id, user_id: row.user_id })),
      ];
    },
    async getConnection() {
      let draft;
      let unlock;
      return {
        async beginTransaction() {
          /* Snapshot is acquired after the account lock. */
        },
        async execute(sql, params) {
          if (sql.startsWith('SELECT id FROM users')) {
            const previous = tail;
            tail = new Promise((resolve) => {
              unlock = resolve;
            });
            await previous;
            draft = structuredClone(state);
            return [[{ id: params[0] }]];
          }
          if (sql.startsWith('SELECT id FROM shop_purchases'))
            return [
              draft.receipts.filter(
                (row) => row.id === params[0] && row.user_id === params[1] && eligible(row),
              ),
            ];
          if (sql.startsWith('SELECT purchase_id FROM shop_price_refunds'))
            return [
              draft.refunds.filter(
                (row) => row.campaign === params[0] && row.purchase_id === params[1],
              ),
            ];
          if (sql.startsWith('SELECT CAST(id AS CHAR) AS id FROM wallet_ledger'))
            return [draft.ledger.slice(-1)];
          if (sql.startsWith('UPDATE users SET manetrons')) {
            assert.ok(!/heat|electrons/.test(sql));
            if (draft.wallet.magnetic < 0 || draft.wallet.magnetic > params[2])
              return [{ affectedRows: 0 }];
            const before = draft.wallet.magnetic;
            draft.wallet.magnetic += params[0];
            if (!missingLedger)
              draft.ledger.push({
                id: String(draft.ledger.length + 1),
                before,
                after: draft.wallet.magnetic,
              });
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith('UPDATE wallet_ledger')) {
            const row = draft.ledger.at(-1);
            if (!row || BigInt(row.id) <= BigInt(params[4]) || row.sourceKey)
              return [{ affectedRows: 0 }];
            Object.assign(row, { sourceKey: params[0], title: params[1], reason: params[2] });
            return [{ affectedRows: 1 }];
          }
          if (sql.includes('INSERT INTO shop_price_refunds')) {
            if (failReceipt) throw new Error('receipt write failed');
            assert.ok(
              !draft.refunds.some(
                (row) => row.campaign === params[0] && row.purchase_id === params[1],
              ),
            );
            draft.refunds.push({
              campaign: params[0],
              purchase_id: params[1],
              user_id: params[2],
              amount: params[3],
            });
            return [{ affectedRows: 1 }];
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        async commit() {
          Object.assign(state, draft);
        },
        async rollback() {
          /* Uncommitted draft is discarded on release. */
        },
        release() {
          unlock?.();
        },
      };
    },
  };
  return { pool, state };
}
const oldPurchase = (id = '1') => ({
  id,
  user_id: '7',
  item_key: 'ranch_bicycle',
  currency: 'magnetic',
  amount: 30,
});

test('old paid bicycles receive exactly 10 magnetic once; new purchases, other currencies and gifts do not', async () => {
  const { pool, state } = fixture({
    receipts: [
      oldPurchase('9007199254740993'),
      { ...oldPurchase('2'), amount: 20 },
      { ...oldPurchase('3'), currency: 'electric' },
      { ...oldPurchase('4'), amount: 0 },
      { ...oldPurchase('5'), item_key: 'ranch_backflip' },
    ],
  });
  assert.deepEqual(await refundRanchBicyclePurchases(pool), { refunded: 1, magnetic: 10 });
  assert.deepEqual(state.wallet, { magnetic: 50, electric: 70, heat: 80 });
  assert.equal(state.refunds[0].purchase_id, '9007199254740993');
  assert.equal(state.ledger.length, 1);
  assert.match(state.ledger[0].sourceKey, new RegExp(CAMPAIGN));
  assert.equal(state.ledger[0].title, '牧场自行车降价补差');
  assert.deepEqual(await refundRanchBicyclePurchases(pool), { refunded: 0, magnetic: 0 });
  assert.equal(state.wallet.magnetic, 50);
  assert.deepEqual(await refundRanchBicyclePurchases(fixture().pool), { refunded: 0, magnetic: 0 });
});

test('concurrent server starts cannot refund the same receipt twice', async () => {
  const { pool, state } = fixture({ receipts: [oldPurchase()] });
  const results = await Promise.all([
    refundRanchBicyclePurchases(pool),
    refundRanchBicyclePurchases(pool),
  ]);
  assert.equal(
    results.reduce((sum, result) => sum + result.refunded, 0),
    1,
  );
  assert.equal(state.wallet.magnetic, 50);
  assert.equal(state.refunds.length, 1);
  assert.equal(state.ledger.length, 1);
});

test('batch processing completes beyond 200 receipts without losing precision or repeating refunds', async () => {
  const { pool, state } = fixture({
    receipts: Array.from({ length: 205 }, (_, i) => oldPurchase(String(i + 1))),
  });
  assert.deepEqual(await refundRanchBicyclePurchases(pool), { refunded: 205, magnetic: 2050 });
  assert.equal(state.refunds.length, 205);
});

test('wallet, trigger annotation and refund marker roll back together on failures', async () => {
  for (const failure of [
    { missingLedger: true },
    { failReceipt: true },
    { balance: Number.MAX_SAFE_INTEGER },
  ]) {
    const { pool, state } = fixture({ receipts: [oldPurchase()], ...failure });
    const before = structuredClone(state);
    await assert.rejects(refundRanchBicyclePurchases(pool));
    assert.deepEqual(state, before);
  }
});

test('the catalog, ranch button and startup all use the price/refund policy', () => {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../public/data/shop-items.json'), 'utf8'),
  );
  const bicycle = catalog.items.find((item) => item.key === 'ranch_bicycle');
  assert.deepEqual(bicycle.cost, { magnetic: 20 });
  assert.match(bicycle.rules, /^20 磁元/);
  const ranch = fs.readFileSync(path.join(__dirname, '../public/ranch-page.js'), 'utf8');
  assert.match(ranch, /\['ranch_bicycle', '牧场自行车', '20 磁元/);
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(
    server.indexOf('await refundRanchBicyclePurchases(pool)') >
      server.indexOf('await ensureWalletLedger(pool)'),
  );
  const shop = fs.readFileSync(path.join(__dirname, 'economy-shop.js'), 'utf8');
  assert.match(shop, /061_shop_price_refunds.sql/);
});
