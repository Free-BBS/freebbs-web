const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { sampleWoolGrowth, WOOL_RATE } = require('./ranch-growth');
const { createProfileExtras, beijingDay } = require('./profile-extras');
const { createEconomyMemoryStore } = require('../scripts/fixtures/economy-memory-store');

test('Poisson inverse CDF boundaries include zero and multiple arrivals, not Bernoulli truncation', () => {
  assert.equal(WOOL_RATE, 0.2);
  const p0 = Math.exp(-0.2);
  assert.equal(
    sampleWoolGrowth(() => 0),
    0,
  );
  assert.equal(
    sampleWoolGrowth(() => p0 - 1e-12),
    0,
  );
  assert.equal(
    sampleWoolGrowth(() => p0 + 1e-12),
    1,
  );
  assert.equal(
    sampleWoolGrowth(() => 0.99),
    2,
  );
  assert.equal(
    sampleWoolGrowth(() => 0.999),
    3,
  );
  assert.ok(sampleWoolGrowth(() => 1 - Number.EPSILON) >= 8);
  for (const value of [-1, 1, NaN, Infinity, '0.9'])
    assert.throws(() => sampleWoolGrowth(() => value));
});
test('deterministic uniform quantiles recover Poisson mean, variance and zero-arrival probability', () => {
  const size = 100000;
  let sum = 0;
  let squares = 0;
  let zero = 0;
  for (let i = 0; i < size; i += 1) {
    const count = sampleWoolGrowth(() => (i + 0.5) / size);
    sum += count;
    squares += count * count;
    if (count === 0) zero += 1;
  }
  assert.ok(Math.abs(sum / size - WOOL_RATE) < 0.0001);
  assert.ok(Math.abs(squares / size - (sum / size) ** 2 - WOOL_RATE) < 0.0002);
  assert.ok(Math.abs(zero / size - Math.exp(-WOOL_RATE)) < 0.00002);
});
test('reads and invalid feeds never sample; multi-arrival overflow rolls back all assets', async () => {
  const now = () => Date.parse('2026-09-26T10:00:00Z');
  const store = createEconomyMemoryStore([
    {
      id: 1,
      adopted: true,
      assets: { max_pet: 1, fish: 2 },
      fortunes: { [beijingDay(now())]: 95 },
      feedProgress: 4,
      woolReady: 4294967294,
    },
  ]);
  let draws = 0;
  const service = createProfileExtras(store, {
    now,
    random: () => {
      draws += 1;
      return 0.99;
    },
  });
  await service.ownState(1);
  await service.publicProfile(1);
  assert.equal(draws, 0);
  const before = structuredClone(store.account());
  await assert.rejects(
    service.act({ userId: 1, action: 'feed', requestKey: randomUUID() }),
    /上限/,
  );
  assert.deepEqual(store.account(), before);
  assert.equal(draws, 1);
  store.account().assets.fish = 0;
  await assert.rejects(
    service.act({ userId: 1, action: 'feed', requestKey: randomUUID() }),
    /没有鱼/,
  );
  assert.equal(draws, 1);
});
