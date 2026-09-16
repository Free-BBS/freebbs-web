const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { awardMagnetic } = require('./economy-rewards');
const { beijingDay, checkinReward } = require('./economy-policy');

const source = fs.readFileSync(require.resolve('./server'), 'utf8');
const code = source.slice(
  source.indexOf('async function performDailyCheckin('),
  source.indexOf('async function getUserAssets('),
);
function harness({
  score = 70,
  previous = 0,
  fail = false,
  now = Date.parse('2026-09-16T00:00:00+08:00'),
} = {}) {
  const today = beijingDay(now);
  const yesterday = beijingDay(now - 86400000);
  let state = {
    balance: 0,
    electric: 0,
    checkins: previous ? { [yesterday]: { streak_count: previous } } : {},
    rewards: {},
  };
  let queue = Promise.resolve();
  const connection = {
    async execute(sql, args) {
      if (sql.startsWith('SELECT id')) return [[{ id: 1 }]];
      if (sql.startsWith('SELECT streak_count'))
        return [state.checkins[args[1]] ? [state.checkins[args[1]]] : []];
      if (sql.startsWith('SELECT score')) return [[{ score }]];
      if (sql.startsWith('SELECT amount'))
        return [state.rewards[args[1]] ? [state.rewards[args[1]]] : []];
      if (sql.startsWith('INSERT INTO user_checkins')) {
        state.checkins[args[1]] = { streak_count: args[2] };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('INSERT INTO economy_rewards')) {
        state.rewards[args[1]] = { amount: args[3] };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE users')) {
        if (fail) throw new Error('injected wallet failure');
        if (sql.includes('electrons =')) state.electric += args[0];
        else state.balance += args[0];
        return [{ affectedRows: 1 }];
      }
      throw new Error(sql);
    },
  };
  const ctx = vm.createContext({
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    beijingDay: (ms = now) => beijingDay(ms),
    checkinReward,
    ensureEconomyReady: async () => {},
    getFortuneBonusEnabled: async () => false,
    ensureUserFortuneWindow: async () => [],
    getCheckinSummary: async () => state,
    awardMagnetic,
    withDatabaseTransaction: async (work) => {
      const previousTask = queue;
      let release;
      queue = new Promise((resolve) => {
        release = resolve;
      });
      await previousTask;
      const before = structuredClone(state);
      try {
        return await work(connection);
      } catch (error) {
        state = before;
        throw error;
      } finally {
        release();
      }
    },
  });
  vm.runInContext(code, ctx);
  return { act: () => ctx.performDailyCheckin({ id: 1 }), state: () => state, today };
}
for (const [previous, score, expected] of [
  [0, 69, 1],
  [1, 69, 2],
  [2, 69, 3],
  [3, 69, 3],
  [100, 69, 3],
  [0, 70, 2],
  [2, 90, 4],
]) {
  test(`production check-in streak=${previous}, score=${score}`, async () => {
    const h = harness({ previous, score });
    const results = await Promise.all(Array.from({ length: 5 }, () => h.act()));
    assert.equal(results.filter((r) => !r.alreadyCheckedIn).length, 1);
    assert.equal(h.state().balance, expected);
  });
}
test('production check-in rolls back record and reward marker if wallet update fails', async () => {
  const h = harness({ fail: true });
  await assert.rejects(h.act(), /wallet failure/);
  assert.equal(h.state().checkins[h.today], undefined);
  assert.deepEqual(h.state().rewards, {});
  assert.equal(h.state().balance, 0);
});

test('rollout keeps legacy electric rewards before Beijing Sep 16 and carries old streaks forward', async () => {
  const old = harness({ previous: 3, now: Date.parse('2026-09-15T23:59:59+08:00') });
  await old.act();
  assert.equal(old.state().electric, 4);
  assert.equal(old.state().balance, 0);
  const next = harness({ previous: 3, score: 69 });
  await next.act();
  assert.equal(next.state().balance, 3);
  assert.equal(next.state().electric, 0);
  assert.equal(next.state().checkins[next.today].streak_count, 4);
});
