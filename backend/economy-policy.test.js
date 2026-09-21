const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createProfileExtras } = require('./profile-extras');
const { createEconomyShop } = require('./economy-shop');
const { createEconomyMemoryStore } = require('../scripts/fixtures/economy-memory-store');
const { DAY_MS, beijingDay, effectiveFortune } = require('./economy-policy');
const { awardMagnetic, ensureEconomyPolicy } = require('./economy-rewards');
const catalog = require('../public/data/shop-items.json').items;

function setup({ recordLedger = false } = {}) {
  const clock = { value: Date.parse('2026-09-16T15:59:59Z') };
  const day = beijingDay(clock.value);
  const store = createEconomyMemoryStore(
    [
      {
        id: 1,
        assets: { max_pet: 1, fish: 100, fortune_bag: 2, differential_converter: 2 },
        fortunes: { [day]: 60 },
        checkins: { [day]: { rewardMagnetic: 3 } },
      },
    ],
    { recordLedger },
  );
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
test('three auspicious days and ten ordinary bones are required for the fishbone achievement', async () => {
  const { store, act, clock } = setup();
  store.account().counts.fishbone = 10;
  for (let i = 0; i < 3; i += 1) {
    if (i) clock.value += DAY_MS;
    store.account().fortunes[beijingDay(clock.value)] = 90;
    assert.equal((await act('feed')).bone, 'golden_fishbone');
    for (let j = 0; j < 3; j += 1) assert.equal((await act('feed')).bone, 'ordinary_fishbone');
    assert.equal(store.account().assets.plate_fishbone_master, undefined);
  }
  assert.equal(store.account().assets.golden_fishbone, 3);
  assert.equal(store.account().assets.ordinary_fishbone, 9);
  assert.deepEqual((await act('feed')).unlocked, ['plate_fishbone_master']);
});
for (const direction of ['electric_to_magnetic', 'magnetic_to_electric']) {
  test(`converter consumes prepaid fee item and ten principal once: ${direction}`, async () => {
    const { store, act } = setup({ recordLedger: true });
    const key = randomUUID();
    const from = direction.startsWith('electric') ? 'electric' : 'magnetic';
    const to = from === 'electric' ? 'magnetic' : 'electric';
    await act('convert', { itemKey: direction, requestKey: key });
    await act('convert', { itemKey: direction, requestKey: key });
    assert.equal(store.account()[from], 9990);
    assert.equal(store.account()[to], 10010);
    assert.equal(store.account().assets.differential_converter, 1);
    const entries = store.account().ledger;
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((entry) => entry.source_key),
      [`converter:${key}:debit`, `converter:${key}:credit`],
    );
    assert.ok(entries.every((entry) => entry.title === '微分器兑换'));
    const fromName = from === 'electric' ? '电元' : '磁元';
    const toName = to === 'electric' ? '电元' : '磁元';
    assert.ok(entries.every((entry) => entry.reason.includes(`10 ${fromName}兑换为 10 ${toName}`)));
    assert.ok(entries[0].reason.includes(`扣除 10 ${fromName}本金`));
    assert.ok(entries[1].reason.includes(`收入 10 ${toName}`));
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
  const state = { balance: 0, rewards: new Map(), ledger: [] };
  return {
    state,
    missingTrigger: false,
    async execute(sql, args) {
      if (sql.startsWith('SELECT id FROM users')) return [[{ id: args[0] }]];
      if (sql.startsWith('SELECT CAST(id AS CHAR) AS id FROM wallet_ledger')) {
        assert.match(sql, /ORDER BY id DESC LIMIT 1 FOR UPDATE$/);
        const row = state.ledger.filter((entry) => entry.user_id === args[0]).at(-1);
        return [row ? [{ id: row.id }] : []];
      }
      if (sql.startsWith('SELECT amount')) {
        assert.match(sql, /FOR UPDATE$/);
        return [
          [...state.rewards.values()].filter((r) =>
            sql.includes('reward_day')
              ? r.day === args[1] && r.category === 'community'
              : r.key === args[1],
          ),
        ];
      }
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
        const before = state.balance;
        state.balance += args[0];
        if (!this.missingTrigger)
          state.ledger.push({
            id: String(Number(state.ledger.at(-1)?.id || 0) + 1),
            user_id: args[1],
            source_key: null,
            magnetic_before: before,
            magnetic_after: state.balance,
          });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE wallet_ledger')) {
        assert.match(sql, /source_key IS NULL/);
        const [sourceKey, title, reason, userId, afterId] = args;
        const row = state.ledger.findLast(
          (entry) =>
            entry.user_id === userId &&
            BigInt(entry.id) > BigInt(afterId) &&
            entry.source_key === null,
        );
        if (row) Object.assign(row, { source_key: sourceKey, title, reason });
        return [{ affectedRows: row ? 1 : 0 }];
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
  assert.equal(c.state.ledger.length, 3, 'zero and duplicate rewards never create balance rows');
  assert.equal(c.state.ledger[2].source_key, 'reward:featured-comment:2');
  assert.equal(c.state.ledger[2].title, '精华评论奖励');
  assert.match(c.state.ledger[2].reason, /评论（编号 2）.*5 磁元/);
});

test('a partially capped reaction describes only the actual credited magnetic amount', async () => {
  const c = rewardsConnection();
  const day = '2026-09-21';
  assert.equal(await awardMagnetic(c, 1, 'post-like:20:8:light', 2, day, 'community'), 2);
  assert.equal(await awardMagnetic(c, 1, 'post-like:21:8:light', 2, day, 'community'), 1);
  const entry = c.state.ledger.at(-1);
  assert.equal(entry.magnetic_after - entry.magnetic_before, 1);
  assert.match(entry.reason, /帖子（编号 21）.*有启发性.*获得 1 磁元$/);
});

for (const [key, category, title, reason] of [
  ['checkin:2026-09-21', 'checkin', '每日签到', /2026-09-21.*签到/],
  ['luck:2026-09-21', 'bonus', '签到运势奖励', /2026-09-21.*运势达到 70 分/],
  ['post:21', 'community', '发帖奖励', /发布帖子（编号 21）/],
  ['post-like:21:8:smile', 'community', '帖子互动奖励', /帖子（编号 21）.*令人高兴/],
  ['post-like:21:8:light', 'community', '帖子互动奖励', /帖子（编号 21）.*有启发性/],
  ['post-like:21:8:fireworks', 'community', '帖子互动奖励', /帖子（编号 21）.*恭喜/],
  ['comment-like:32:8', 'community', '评论获赞奖励', /评论（编号 32）.*点赞/],
  ['featured-post:21', 'bonus', '精华帖子奖励', /帖子（编号 21）.*精华/],
  ['featured-comment:32', 'bonus', '精华评论奖励', /评论（编号 32）.*精华/],
  ['future-source:1', 'community', '社区互动奖励', /参与社区互动/],
  ['future-source:1', 'checkin', '每日签到', /完成每日签到/],
  ['future-source:1', 'bonus', '磁元奖励', /平台磁元奖励/],
]) {
  test(`reward ledger describes the awarded event and actual amount: ${key}/${category}`, async () => {
    const c = rewardsConnection();
    c.state.ledger.push({ id: '42', user_id: 1, source_key: null, title: null, reason: null });
    assert.equal(await awardMagnetic(c, 1, key, 2, '2026-09-21', category), 2);
    const [historical, entry] = c.state.ledger;
    assert.equal(historical.source_key, null);
    assert.equal(entry.source_key, `reward:${key}`);
    assert.equal(entry.title, title);
    assert.match(entry.reason, reason);
    assert.match(entry.reason, /获得 2 磁元$/);
    assert.equal(entry.magnetic_after - entry.magnetic_before, 2);
    assert.equal(await awardMagnetic(c, 1, key, 2, '2026-09-21', category), 0);
    assert.equal(c.state.ledger.length, 2);
  });
}

test('missing reward trigger row fails and can be retried after transaction rollback without touching history', async () => {
  const c = rewardsConnection();
  c.state.ledger.push({ id: '42', user_id: 1, source_key: null, title: null, reason: null });
  const before = structuredClone(c.state);
  c.missingTrigger = true;
  await assert.rejects(awardMagnetic(c, 1, 'post:21', 1, '2026-09-21', 'community'), /ledger/i);
  assert.deepEqual(c.state.ledger, before.ledger);
  Object.assign(c.state, before); // The caller owns transaction rollback.
  c.missingTrigger = false;
  assert.equal(await awardMagnetic(c, 1, 'post:21', 1, '2026-09-21', 'community'), 1);
  assert.equal(await awardMagnetic(c, 1, 'post:21', 1, '2026-09-21', 'community'), 0);
  assert.equal(c.state.balance, 1);
  assert.equal(c.state.ledger.length, 2);
});

for (const stage of ['debit_electric', 'credit', 'ledger', 'extras', 'profile_record', 'commit']) {
  test(`converter ${stage} failure rolls back both balances, item, ledger and receipt before retry`, async () => {
    const { store, act } = setup({ recordLedger: true });
    const before = structuredClone(store.account());
    const fields = { itemKey: 'electric_to_magnetic', requestKey: randomUUID() };
    store.failAt = stage;
    await assert.rejects(act('convert', fields), /simulated/);
    assert.deepEqual(store.account(), before);
    store.failAt = '';
    await act('convert', fields);
    await act('convert', fields);
    assert.equal(store.account().electric, before.electric - 10);
    assert.equal(store.account().magnetic, before.magnetic + 10);
    assert.equal(store.account().assets.differential_converter, 1);
    assert.equal(store.account().ledger.length, 2);
  });
}
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
