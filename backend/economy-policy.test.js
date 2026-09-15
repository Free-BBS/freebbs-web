const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createProfileExtras } = require('./profile-extras');
const { createEconomyShop } = require('./economy-shop');
const { createEconomyMemoryStore } = require('../scripts/fixtures/economy-memory-store');
const { DAY_MS, beijingDay, effectiveFortune } = require('./economy-policy');
const { awardMagnetic, ensureEconomyPolicy } = require('./economy-rewards');
const catalog = require('../public/data/shop-items.json').items;

function setup() {
  const clock = { value: Date.parse('2026-09-16T15:59:59Z') };
  const day = beijingDay(clock.value);
  const store = createEconomyMemoryStore([
    {
      id: 1,
      assets: { max_pet: 1, fish: 100, fortune_bag: 2, differential_converter: 2 },
      fortunes: { [day]: 60 },
      checkins: { [day]: { rewardMagnetic: 3 } },
    },
  ]);
  const service = createProfileExtras(store, { now: () => clock.value });
  const act = (action, extra = {}) =>
    service.act({ userId: 1, action, requestKey: randomUUID(), ...extra });
  return { store, clock, act, service, day };
}
test('thirty feeds fill exactly 30 days; extra feed neither consumes nor produces; half-day space rejected', async () => {
  const { store, clock, act, service } = setup();
  await Promise.all(Array.from({ length: 30 }, () => act('feed')));
  assert.equal(store.account().fedUntilMs, clock.value + 30 * DAY_MS);
  assert.equal(store.account().assets.ordinary_fishbone, 30);
  const before = structuredClone(store.account());
  await assert.rejects(act('feed'), /容量/);
  assert.deepEqual(store.account(), before);
  clock.value += DAY_MS / 2;
  store.account().fortunes[beijingDay(clock.value)] = 60;
  await assert.rejects(act('feed'), /容量/);
  clock.value += DAY_MS / 2;
  await act('feed');
  assert.equal((await service.publicProfile(1)).ranch.hungry, false);
  clock.value = store.account().fedUntilMs;
  assert.equal((await service.publicProfile(1)).ranch.hungry, true);
  assert.equal(store.account().assets.max_pet, 1);
});
test('fortune bag expires at Beijing midnight after seven inclusive dates, preserves higher scores and rewards once', async () => {
  const { store, clock, act, day } = setup();
  const requestKey = randomUUID();
  const first = await act('use_bag', { requestKey });
  assert.equal(first.luckUntilMs, Date.parse('2026-09-22T16:00:00Z'));
  assert.equal(store.account().fortunes[day], 70);
  assert.equal(store.account().magnetic, 10001);
  assert.equal(store.account().assets.fortune_bag, 1);
  await act('use_bag', { requestKey });
  assert.equal(store.account().magnetic, 10001);
  await assert.rejects(act('use_bag'), /仍在生效/);
  assert.equal(store.account().assets.fortune_bag, 1);
  assert.equal((await act('feed')).bone, 'ordinary_fishbone');
  assert.equal(effectiveFortune(95, first.luckUntilMs, clock.value), 95);
  clock.value = first.luckUntilMs;
  assert.equal(effectiveFortune(60, first.luckUntilMs, clock.value), 60);
  await act('use_bag');
  assert.equal(store.account().assets.fortune_bag, 0);
});
for (const failure of ['consume', 'extras', 'profile_record', 'commit']) {
  test(`fortune bag failure rolls back inventory, boost and bonus at ${failure}`, async () => {
    const { store, act } = setup();
    const before = structuredClone(store.account());
    store.failAt = failure;
    await assert.rejects(act('use_bag'));
    assert.deepEqual(store.account(), before);
  });
}
test('all auspicious feeds are gold, not ordinary; both holdings gate the achievement', async () => {
  const { store, act, day } = setup();
  store.account().counts.fishbone = 10;
  store.account().fortunes[day] = 90;
  for (let i = 0; i < 3; i += 1) await act('feed');
  assert.equal(store.account().assets.golden_fishbone, 3);
  assert.equal(store.account().assets.ordinary_fishbone, undefined);
  assert.equal(store.account().assets.plate_fishbone_master, undefined);
  store.account().fortunes[day] = 70;
  for (let i = 0; i < 9; i += 1) await act('feed');
  assert.equal(store.account().assets.plate_fishbone_master, undefined);
  assert.deepEqual((await act('feed')).unlocked, ['plate_fishbone_master']);
});
for (const direction of ['electric_to_magnetic', 'magnetic_to_electric']) {
  test(`converter consumes prepaid fee item and ten principal once: ${direction}`, async () => {
    const { store, act } = setup();
    const key = randomUUID();
    const from = direction.startsWith('electric') ? 'electric' : 'magnetic';
    const to = from === 'electric' ? 'magnetic' : 'electric';
    await act('convert', { itemKey: direction, requestKey: key });
    await act('convert', { itemKey: direction, requestKey: key });
    assert.equal(store.account()[from], 9990);
    assert.equal(store.account()[to], 10010);
    assert.equal(store.account().assets.differential_converter, 1);
    store.account()[from] = 9;
    const before = structuredClone(store.account());
    await assert.rejects(act('convert', { itemKey: direction }), /本金不足/);
    assert.deepEqual(store.account(), before);
  });
}
test('laser dual-currency fee rolls back if magnetic is insufficient; removed product cannot be purchased', async () => {
  const { store } = setup();
  const shop = createEconomyShop(store);
  store.account().assets.laser = 1;
  store.account().magnetic = 0;
  const before = structuredClone(store.account());
  await assert.rejects(
    shop.purchase({
      userId: 1,
      item: catalog.find((i) => i.key === 'laser'),
      action: 'charge',
      currency: 'combined',
      days: 1,
      quotedDailyPrice: 1,
      quotedDailyMagnetic: 1,
      requestKey: randomUUID(),
    }),
    /余额不足/,
  );
  assert.deepEqual(store.account(), before);
  assert.ok(!(await shop.decorate(catalog, 1)).some((i) => i.key === 'plate_maxwell'));
  await assert.rejects(
    shop.purchase({
      userId: 1,
      item: catalog.find((i) => i.key === 'plate_maxwell'),
      requestKey: randomUUID(),
    }),
  );
});
function rewardsConnection() {
  const state = { balance: 0, rewards: new Map() };
  return {
    state,
    async execute(sql, args) {
      if (sql.startsWith('SELECT id')) return [[{ id: args[0] }]];
      if (sql.startsWith('SELECT amount'))
        return [[...state.rewards.values()].filter((r) => r.key === args[1])];
      if (sql.includes('SUM(amount)'))
        return [
          [
            {
              total: [...state.rewards.values()]
                .filter((r) => r.day === args[1] && r.category === 'community')
                .reduce((s, r) => s + r.amount, 0),
            },
          ],
        ];
      if (sql.startsWith('INSERT INTO economy_rewards')) {
        state.rewards.set(args[1], {
          key: args[1],
          day: args[2],
          amount: args[3],
          category: args[4],
        });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE users')) {
        state.balance += args[0];
        return [{ affectedRows: 1 }];
      }
      throw new Error(sql);
    },
  };
}
test('ordinary community reward caps at three, featured reward independent and permanently deduplicated', async () => {
  const c = rewardsConnection();
  const day = '2026-09-15';
  assert.equal(await awardMagnetic(c, 1, 'post:1', 1, day, 'community'), 1);
  assert.equal(await awardMagnetic(c, 1, 'like:1', 2, day, 'community'), 2);
  assert.equal(await awardMagnetic(c, 1, 'like:2', 1, day, 'community'), 0);
  assert.equal(await awardMagnetic(c, 1, 'like:2', 1, '2026-09-16', 'community'), 0);
  assert.equal(await awardMagnetic(c, 1, 'featured-comment:2', 5, day), 5);
  assert.equal(await awardMagnetic(c, 1, 'featured-comment:2', 5, day), 0);
  assert.equal(c.state.balance, 8);
});
test('legacy migration seeds hard bone progress only on first application', async () => {
  let marked = false;
  const queries = [];
  let committed = 0;
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {
      committed += 1;
    },
    rollback: async () => {},
    release() {},
    execute: async (sql) => {
      queries.push(sql);
      if (sql.startsWith('INSERT IGNORE')) {
        const affectedRows = marked ? 0 : 1;
        marked = true;
        return [{ affectedRows }];
      }
      return [{ affectedRows: 1 }];
    },
  };
  const pool = { query: async () => {}, getConnection: async () => connection };
  await ensureEconomyPolicy(pool);
  await ensureEconomyPolicy(pool);
  assert.equal(queries.filter((s) => s.startsWith('UPDATE user_assets')).length, 1);
  assert.equal(queries.filter((s) => s.startsWith('INSERT INTO shop_purchase_progress')).length, 1);
  assert.equal(committed, 2);
});
