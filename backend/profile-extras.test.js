const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  createProfileExtras,
  beijingDay,
  COSMETICS,
  mysqlProfileMethods,
} = require('./profile-extras');
const { createEconomyShop } = require('./economy-shop');
const { createEconomyMemoryStore } = require('../scripts/fixtures/economy-memory-store');

const fixed = Date.parse('2026-09-14T10:00:00Z');
test('production endpoints require auth and never trust a caller-supplied target user', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const routes = {};
  const calls = [];
  const code = source.slice(
    source.indexOf("app.get('/api/profile/extras'"),
    source.indexOf("app.post('/api/electromagnetic/convert'"),
  );
  vm.runInNewContext(code, {
    app: {
      get: (url, handler) => {
        routes.get = handler;
      },
      post: (url, handler) => {
        routes.post = handler;
      },
    },
    toUserProfile: (value) => value,
    getUserById: async (id) => ({ id }),
    ProfileExtrasError: require('./profile-extras').ProfileExtrasError,
    requireAuth: async (req, res) => {
      if (req.authorized) return { id: 1 };
      res.status(401).json({ message: '请先登录' });
      return null;
    },
    profileExtras: {
      ownState: async (id) => ({ owner: id }),
      act: async (fields) => {
        calls.push(fields);
        return { action: fields.action };
      },
    },
  });
  function response() {
    return {
      code: 200,
      set() {},
      status(statusCode) {
        this.code = statusCode;
        return this;
      },
      json(body) {
        this.body = body;
      },
    };
  }
  for (const method of ['get', 'post']) {
    const res = response();
    await routes[method]({ authorized: false, body: {} }, res);
    assert.equal(res.code, 401);
  }
  assert.equal(calls.length, 0);
  const res = response();
  await routes.post(
    { authorized: true, body: { userId: 2, action: 'adopt', requestKey: crypto.randomUUID() } },
    res,
  );
  assert.equal(calls[0].userId, 1);
  assert.equal(res.body.owner, 1);
});
function setup({ score = 90, fish = 3, adopted = true } = {}) {
  const store = createEconomyMemoryStore([
    {
      id: 1,
      adopted,
      assets: { fish, fishbone: 2, frame_orbit: 1, plate_maxwell: 1, card_blueprint: 1 },
      fortunes: { [beijingDay(fixed)]: score },
    },
    { id: 2 },
  ]);
  const service = createProfileExtras(store, { now: () => fixed });
  const act = (action, fields = {}) =>
    service.act({ userId: 1, action, requestKey: crypto.randomUUID(), ...fields });
  return { store, service, act };
}
test('Beijing midnight, not the server timezone, determines feed day', () => {
  assert.equal(beijingDay(Date.parse('2026-09-14T15:59:59Z')), '2026-09-14');
  assert.equal(beijingDay(Date.parse('2026-09-14T16:00:00Z')), '2026-09-15');
});
test('owned cosmetics can be equipped, replaced and removed; unowned/invalid slots rejected', async () => {
  const { act, service } = setup();
  await act('equip', { slot: 'frame', itemKey: 'frame_orbit' });
  assert.equal((await service.publicProfile(1)).cosmetics.frame, 'frame_orbit');
  await assert.rejects(act('equip', { slot: 'frame', itemKey: 'frame_aurora' }), /先在商城购买/);
  await assert.rejects(act('equip', { slot: 'frame', itemKey: 'plate_maxwell' }), /不支持/);
  await assert.rejects(act('equip', { slot: '__proto__', itemKey: 'frame_orbit' }), /不支持/);
  await assert.rejects(act('equip', { slot: 'frame', itemKey: '"><script>' }), /不支持/);
  await act('equip', { slot: 'frame', itemKey: '' });
  assert.deepEqual((await service.publicProfile(1)).cosmetics, {});
});
test('purchased Max activation is idempotent and does not charge again', async () => {
  const { act, store } = setup({ adopted: false });
  store.account().assets.max_pet = 1;
  const before = structuredClone(store.account().assets);
  await act('adopt');
  await act('adopt');
  assert.equal(store.account().electric, 10000);
  assert.equal(store.account().magnetic, 10000);
  assert.deepEqual(store.account().assets, before);
});
test('all auspicious feeds give gold; hard bone holdings and shop counts are independent', async () => {
  const { act, store } = setup();
  assert.equal((await act('feed')).bone, 'golden_fishbone');
  assert.equal((await act('feed')).bone, 'golden_fishbone');
  assert.equal(store.account().assets.fish, 1);
  assert.equal(store.account().assets.golden_fishbone, 2);
  assert.equal(store.account().assets.fishbone, 2);
  assert.deepEqual(store.account().counts, {});
});
test('same feed request replay consumes only one fish, including simultaneous requests', async () => {
  const { act, store } = setup();
  const requestKey = crypto.randomUUID();
  const receipts = await Promise.all([act('feed', { requestKey }), act('feed', { requestKey })]);
  assert.equal(receipts.filter((r) => r.replayed).length, 1);
  assert.equal(store.account().assets.fish, 2);
  assert.equal(store.account().assets.golden_fishbone, 1);
  await assert.rejects(act('adopt', { requestKey }), /编号已使用/);
});
test('concurrent distinct auspicious feeds each grant one gold within capacity', async () => {
  const { act, store } = setup();
  await Promise.all([act('feed'), act('feed'), act('feed')]);
  assert.equal(store.account().assets.fish, 0);
  assert.equal(store.account().assets.golden_fishbone, 3);
  assert.equal(store.account().assets.fishbone, 2);
  await assert.rejects(act('feed'), /没有鱼/);
});
test('low fortune produces ordinary bone; client-provided fortune/date cannot override server', async () => {
  const { act, store } = setup({ score: 70 });
  await act('feed', { fortune: 100, score: 100, day: '2027-01-01' });
  assert.equal(store.account().assets.golden_fishbone, undefined);
  assert.equal(store.account().lastFeedDay, '2026-09-14');
});
test('a new Beijing day may produce a new golden bone', async () => {
  const { store, act } = setup();
  await act('feed');
  const tomorrow = fixed + 86400000;
  store.account().fortunes[beijingDay(tomorrow)] = 95;
  await createProfileExtras(store, { now: () => tomorrow }).act({
    userId: 1,
    action: 'feed',
    requestKey: crypto.randomUUID(),
  });
  assert.equal(store.account().assets.golden_fishbone, 2);
});
for (const options of [{ adopted: false }, { fish: 0 }, { score: null }]) {
  test(`unavailable feeding leaves assets unchanged: ${JSON.stringify(options)}`, async () => {
    const { act, store } = setup(options);
    const assets = structuredClone(store.account().assets);
    await assert.rejects(act('feed'));
    assert.deepEqual(store.account().assets, assets);
  });
}
for (const stage of ['consume', 'deliver', 'extras', 'profile_record', 'commit']) {
  test(`feed rollback at ${stage} preserves fish, day and receipt`, async () => {
    const { act, store } = setup();
    store.failAt = stage;
    const requestKey = crypto.randomUUID();
    await assert.rejects(act('feed', { requestKey }));
    assert.equal(store.account().assets.fish, 3);
    assert.equal(store.account().lastFeedDay, '');
    assert.equal(store.account().profileActions.length, 0);
    store.failAt = '';
    await act('feed', { requestKey });
    assert.equal(store.account().assets.golden_fishbone, 1);
  });
}
test('visitor presentation excludes wallet, fish, daily fortune and private action history', async () => {
  const { act, store, service } = setup();
  await act('equip', { slot: 'nameplate', itemKey: 'plate_maxwell' });
  const payload = await service.publicProfile(1);
  assert.deepEqual(Object.keys(payload).sort(), ['cosmetics', 'ranch']);
  assert.deepEqual(Object.keys(payload.ranch).sort(), [
    'adopted',
    'bones',
    'fedUntilMs',
    'goldenBones',
    'hardBones',
    'hungry',
    'serverNowMs',
  ]);
  const posts = await createEconomyShop(store).decoratePosts([
    { user_id: 1 },
    { user_id: 1, is_anonymous: true },
    { user_id: 1, is_deleted: true },
    { user_id: 2 },
  ]);
  assert.equal(posts[0].cosmetics.nameplate, 'plate_maxwell');
  for (const row of posts.slice(1)) assert.deepEqual(row.cosmetics, {});
});
test('SQL adapter consumes guarded quantity and uses authoritative daily fortune', async () => {
  const calls = [];
  const methods = mysqlProfileMethods({
    execute: async (sql, values) => {
      calls.push({ sql, values });
      return sql.startsWith('SELECT score') ? [[{ score: 91 }]] : [{ affectedRows: 1 }];
    },
  });
  assert.equal(await methods.readFortune(1, '2026-09-14'), 91);
  assert.equal(await methods.consumeFish(1), true);
  assert.match(calls[1].sql, /quantity > 0/);
  assert.deepEqual(calls[0].values, [1, '2026-09-14']);
});
test('paid cosmetics are catalog items, while achievement nameplates cannot be purchased', () => {
  const { items } = require('../public/data/shop-items.json');
  for (const key of Object.keys(COSMETICS)) {
    const item = items.find((i) => i.key === key);
    if (COSMETICS[key].source === 'achievement') {
      assert.equal(item, undefined, 'earned nameplate must not be offered for sale');
      continue;
    }
    assert.ok(item && item.cost.magnetic > 0);
    assert.equal(item.isgift, false);
    assert.equal(item.purchaseLimit, 1);
  }
  assert.equal(
    items.find((i) => i.key === 'fishbone').desc,
    '一个鱼骨头，没有人知道是哪里来的。也许是某个不小心吃鱼时掉落的，也可能是某个不小心吃鱼时捡到的。总之它就是一个鱼骨头，除了硬似乎没有什么用处。',
  );
});

test('fishbone achievement unlocks when gold arrives after ten purchases, only once', async () => {
  const { act, store, service } = setup();
  store.account().counts.fishbone = 10;
  store.account().assets.golden_fishbone = 2;
  store.account().assets.ordinary_fishbone = 10;
  const requestKey = crypto.randomUUID();
  const result = await act('feed', { requestKey });
  assert.deepEqual(result.unlocked, ['plate_fishbone_master']);
  assert.equal(store.account().assets.plate_fishbone_master, 1);
  await act('feed', { requestKey });
  await act('feed');
  assert.equal(store.account().assets.plate_fishbone_master, 1);
  await act('equip', { slot: 'nameplate', itemKey: 'plate_fishbone_master' });
  assert.equal((await service.publicProfile(1)).cosmetics.nameplate, 'plate_fishbone_master');
});

test('held or fed bones do not replace the ten purchase requirement', async () => {
  const { act, store, service } = setup();
  store.account().assets.fishbone = 100;
  store.account().counts.fishbone = 9;
  await act('feed');
  assert.equal(store.account().assets.plate_fishbone_master, undefined);
  assert.ok(!(await service.ownState(1)).owned.includes('plate_fishbone_master'));
  await assert.rejects(
    act('equip', { slot: 'nameplate', itemKey: 'plate_fishbone_master' }),
    /尚未解锁/,
  );
});

test('eligible existing accounts reconcile once and earned title persists without auto-equipping', async () => {
  const { store, service } = setup();
  store.account().counts.fishbone = 10;
  store.account().assets.golden_fishbone = 3;
  store.account().assets.ordinary_fishbone = 10;
  await Promise.all([service.ownState(1), service.ownState(1)]);
  assert.equal(store.account().assets.plate_fishbone_master, 1);
  assert.equal(store.account().equipped.nameplate, undefined);
  store.account().assets.golden_fishbone = 0;
  assert.ok((await service.ownState(1)).owned.includes('plate_fishbone_master'));
});

test('feed receipt failure rolls back newly unlocked achievement together with gold and fish', async () => {
  const { act, store } = setup();
  store.account().counts.fishbone = 10;
  store.failAt = 'profile_record';
  await assert.rejects(act('feed'));
  assert.equal(store.account().assets.plate_fishbone_master, undefined);
  assert.equal(store.account().assets.golden_fishbone, undefined);
  assert.equal(store.account().assets.fish, 3);
});
