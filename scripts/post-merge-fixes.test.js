const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { hashPassword, verifyPassword } = require('../backend/password');

const server = fs.readFileSync(require.resolve('../backend/server'), 'utf8');
const app = fs.readFileSync(require.resolve('../public/app'), 'utf8');
const summaryCode = server.slice(
  server.indexOf('async function getCheckinSummary('),
  server.indexOf('async function performDailyCheckin('),
);
const rewardCode = app.slice(
  app.indexOf('function formatCheckinReward('),
  app.indexOf('async function openFortuneModal('),
);

test('second-day check-in summary displays the actual two magnetic reward and legacy electric history', async () => {
  const ctx = vm.createContext({
    ensureEconomyReady: async () => {},
    fortuneDateKey: () => '2026-09-16',
    addDays: (date) => date,
    CHECKIN_LOOKBACK_DAYS: 14,
    ensureUserFortuneWindow: async () => [{ date: '2026-09-16', score: 1 }],
    pool: {
      execute: async (sql, args) => {
        assert.equal(args[0], 7);
        if (sql.includes('FROM user_checkins'))
          return [
            [
              {
                checkin_date: '2026-09-16',
                streak_count: 2,
                reward_electrons: 0,
                fortune_score: 1,
              },
              {
                checkin_date: '2026-09-15',
                streak_count: 1,
                reward_electrons: 1,
                fortune_score: 1,
              },
            ],
          ];
        assert.match(sql, /FROM economy_rewards/);
        return [[{ day: '2026-09-16', amount: '2' }]];
      },
    },
  });
  vm.runInContext(summaryCode + rewardCode, ctx);
  const result = await ctx.getCheckinSummary({ id: 7 }, false);
  assert.equal(result.today.rewardMagnetic, 2);
  assert.equal(result.today.rewardElectrons, 0);
  assert.equal(ctx.formatCheckinReward(result.records[0]), '+2 磁元');
  assert.equal(ctx.formatCheckinReward(result.records[1]), '+1 电元（历史）');
  assert.equal(ctx.formatCheckinReward({ date: '2026-09-16', streak: 2 }), '磁元奖励待核对');
  assert.equal(ctx.formatCheckinReward({ date: '2026-09-16', rewardMagnetic: 3 }), '+3 磁元');
});

const loginCode = server.slice(
  server.indexOf("app.post('/api/auth/login',"),
  server.indexOf("app.post('/api/auth/reset-password',"),
);
test('production login accepts password alone, rejects invalid credentials and missing input', async () => {
  let handler;
  let lookups = 0;
  const ctx = vm.createContext({
    app: {
      post: (route, callback) => {
        handler = callback;
      },
    },
    pool: {
      execute: async (sql, args) => {
        lookups += 1;
        assert.match(sql, /WHERE username = \? OR email = \?/);
        return [
          args[0] === 'reader'
            ? [{ username: 'reader', password_hash: hashPassword('correct') }]
            : [],
        ];
      },
    },
    verifyPassword,
    toUserProfile: (row) => ({ username: row.username }),
    issueToken: () => 'verified-token',
  });
  vm.runInContext(loginCode, ctx);
  const call = async (body) => {
    const response = {
      code: 200,
      status(code) {
        this.code = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
      },
    };
    await handler({ body }, response);
    return response;
  };
  assert.equal(
    (await call({ identifier: ' reader ', password: 'correct' })).payload.token,
    'verified-token',
  );
  assert.equal((await call({ identifier: 'reader', password: 'wrong' })).code, 401);
  assert.equal((await call({ identifier: 'unknown', password: 'correct' })).code, 401);
  assert.equal((await call({ identifier: 'reader' })).code, 400);
  assert.equal(lookups, 3);
  const registration = server.slice(
    server.indexOf("app.post('/api/auth/register',"),
    server.indexOf("app.post('/api/auth/login',"),
  );
  assert.match(registration, /consumeRegistrationChallenge/);
});
