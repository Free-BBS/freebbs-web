const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createEconomyShop, ShopPurchaseError } = require('./economy-shop');
const { mysqlProfileMethods } = require('./profile-extras');
const { createEconomyMemoryStore } = require('../scripts/fixtures/economy-memory-store');

const source = fs.readFileSync(require.resolve('./server'), 'utf8');
const items = require('../public/data/shop-items.json').items.map((item) => ({
  ...item,
  isGift: item.isgift !== false,
}));

const response = () => ({
  code: 200,
  set() {
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
});

function purchaseHarness() {
  const store = createEconomyMemoryStore();
  let failRead = true;
  const context = vm.createContext({
    requireAuth: async () => ({ id: 1 }),
    getShopItem: (key) => items.find((item) => item.key === key),
    getShopItems: () => items,
    normalizeCurrencyType: (v) => v,
    economyShop: createEconomyShop(store),
    ShopPurchaseError,
    getUserById: async () => ({}),
    toUserProfile: (v) => v,
    getUserAssets: async () => {
      if (failRead) {
        failRead = false;
        throw new Error('read after commit failed');
      }
      return store.account().assets;
    },
  });
  vm.runInContext(
    source.slice(
      source.indexOf('async function purchaseShopItem('),
      source.indexOf("app.post('/api/electromagnetic/shop/:itemKey/purchase'"),
    ),
    context,
  );
  return {
    store,
    async call(body, params = {}) {
      const res = response();
      await context.purchaseShopItem({ body, params }, res, 'differential_converter');
      return res;
    },
  };
}

test('legacy converter replays a committed purchase after response failure, without a mutable counter', async () => {
  const h = purchaseHarness();
  const body = { currency: 'magnetic', requestKey: crypto.randomUUID() };
  assert.equal((await h.call(body)).code, 500);
  const retry = await h.call(body);
  assert.equal(retry.code, 200);
  assert.equal(retry.body.purchase.replayed, true);
  assert.equal(h.store.account().assets.differential_converter, 1);
  assert.equal(h.store.account().magnetic, 9996);
  assert.equal(h.store.account().counts.differential_converter, 1);
  assert.equal((await h.call({ ...body, currency: 'electric' })).code, 409);
  assert.equal((await h.call({ ...body, requestKey: crypto.randomUUID() })).code, 200);
  assert.equal(h.store.account().assets.differential_converter, 2);
});

test('legacy converter refuses missing IDs before debit; modern quote checks remain required', async () => {
  const h = purchaseHarness();
  assert.equal((await h.call({ currency: 'magnetic' })).code, 400);
  assert.equal(
    (
      await h.call(
        { currency: 'magnetic', requestKey: crypto.randomUUID() },
        { itemKey: 'differential_converter' },
      )
    ).code,
    400,
  );
  assert.equal(h.store.account().magnetic, 10000);
});

// Transactional SQL model exercising the production route and actual receipt serialization.
function giftHarness({ quantity = 3, failRead = false, failWrite = '' } = {}) {
  let state = { assets: { 1: quantity, 2: 0, 3: 0 }, receipts: {} };
  let queue = Promise.resolve();
  const h = { failWrite, resolveTarget: true, state: () => state };
  const pool = {
    async getConnection() {
      let before;
      let release;
      return {
        async beginTransaction() {
          const previous = queue;
          queue = new Promise((resolve) => {
            release = resolve;
          });
          await previous;
          before = structuredClone(state);
        },
        async commit() {
          before = null;
        },
        async rollback() {
          if (before) {
            state = before;
            before = null;
          }
        },
        release() {
          release();
        },
        async execute(sql, args) {
          if (sql.startsWith('SELECT id FROM users')) return [[{ id: args[0] }]];
          if (sql.startsWith('SELECT fingerprint')) {
            const row = state.receipts[args[1]];
            return [row ? [row] : []];
          }
          if (sql.includes('FROM users'))
            return [
              h.resolveTarget
                ? [{ id: args[0] === 'third' ? 3 : 2, uid: args[0], username: args[0] }]
                : [],
            ];
          if (sql.startsWith('SELECT asset_key'))
            return [
              state.assets[args[0]] > 0
                ? [{ quantity: state.assets[args[0]], metadata_json: {} }]
                : [],
            ];
          if (sql.startsWith('UPDATE user_assets')) {
            state.assets[args[0]] -= 1;
            return [{}];
          }
          if (sql.startsWith('INSERT INTO user_assets')) {
            if (h.failWrite === 'delivery') throw new Error('delivery failed');
            state.assets[args[0]] += 1;
            return [{}];
          }
          if (sql.startsWith('INSERT INTO user_profile_actions')) {
            if (h.failWrite === 'receipt') throw new Error('receipt failed');
            state.receipts[args[1]] = { fingerprint: args[2], result_json: args[3] };
            return [{}];
          }
          throw new Error(sql);
        },
      };
    },
  };
  let handler;
  const context = vm.createContext({
    app: {
      post: (_path, fn) => {
        handler = fn;
      },
    },
    requireAuth: async () => ({ id: 1 }),
    pool,
    mysqlProfileMethods,
    getShopItem: (key) => items.find((item) => item.key === key),
    normalizeAssetMetadataJson: (v) => v,
    getUserAssets: async () => {
      if (failRead) {
        failRead = false;
        throw new Error('read after commit failed');
      }
      return state.assets;
    },
  });
  vm.runInContext(
    source.slice(
      source.indexOf("app.post('/api/electromagnetic/assets/:assetKey/gift'"),
      source.indexOf("app.get('/api/leaderboard/heat'"),
    ),
    context,
  );
  h.call = async (body, assetKey = 'fish') => {
    const res = response();
    await handler({ params: { assetKey }, body }, res);
    return res;
  };
  return h;
}

test('gift retry after committed response failure transfers once, even when stock is exhausted and recipient renamed', async () => {
  const h = giftHarness({ quantity: 1, failRead: true });
  const body = { target: 'receiver', requestKey: crypto.randomUUID() };
  assert.equal((await h.call(body)).code, 500);
  h.resolveTarget = false;
  const retry = await h.call(body);
  assert.equal(retry.code, 200);
  assert.equal(retry.body.replayed, true);
  assert.deepEqual(h.state().assets, { 1: 0, 2: 1, 3: 0 });
});

test('concurrent gifts with one ID transfer once; changing target/item with that ID conflicts', async () => {
  const h = giftHarness();
  const body = { target: 'receiver', requestKey: crypto.randomUUID() };
  const results = await Promise.all(Array.from({ length: 5 }, () => h.call(body)));
  assert.equal(results.filter((r) => r.body.replayed === false).length, 1);
  assert.equal(results.filter((r) => r.body.replayed === true).length, 4);
  assert.equal((await h.call({ ...body, target: 'third' })).code, 409);
  assert.equal((await h.call(body, 'fishbone')).code, 409);
  assert.equal((await h.call({ ...body, requestKey: crypto.randomUUID() })).code, 200);
  assert.deepEqual(h.state().assets, { 1: 1, 2: 2, 3: 0 });
});

for (const stage of ['delivery', 'receipt']) {
  test(`gift ${stage} failure rolls back the entire transfer; same ID can safely retry`, async () => {
    const h = giftHarness({ failWrite: stage });
    const body = { target: 'receiver', requestKey: crypto.randomUUID() };
    assert.equal((await h.call(body)).code, 500);
    assert.deepEqual(h.state().assets, { 1: 3, 2: 0, 3: 0 });
    assert.equal(Object.keys(h.state().receipts).length, 0);
    h.failWrite = '';
    assert.equal((await h.call(body)).code, 200);
    assert.deepEqual(h.state().assets, { 1: 2, 2: 1, 3: 0 });
  });
}

test('gift without an ID is rejected before any transfer', async () => {
  const h = giftHarness();
  assert.equal((await h.call({ target: 'receiver' })).code, 400);
  assert.deepEqual(h.state().assets, { 1: 3, 2: 0, 3: 0 });
});
