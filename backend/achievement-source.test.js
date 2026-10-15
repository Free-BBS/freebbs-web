const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLearningAchievementProvider } = require('./achievement-source');

function fixture() {
  const calls = [];
  const pool = {
    async execute(sql, values = []) {
      calls.push({ sql, values });
      assert.match(sql.trim(), /^SELECT /i);
      if (sql.includes('FROM users WHERE uid')) return [[{ id: 42 }]];
      if (sql.includes('FROM user_checkins')) return [[{ days: 7 }]];
      if (sql.includes('FROM user_assets'))
        return [[{ asset_key: 'plate_circuit_master' }, { asset_key: 'plate_fishbone_master' }]];
      if (sql.includes('FROM circuit_challenges') && !sql.includes('JOIN'))
        return [
          [
            { id: 1, revision: 1, is_active: 1 },
            { id: 2, revision: 2, is_active: 1 },
          ],
        ];
      if (sql.includes('FROM circuit_challenge_submissions')) return [[{ challenge_id: 1 }]];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  return { pool, calls };
}
test('learning achievement evidence reads the authenticated UID with no mutations or rewards', async () => {
  const f = fixture();
  const data = await createLearningAchievementProvider(f.pool)('own-user');
  assert.deepEqual(data, {
    checkinDays: 7,
    circuitCleared: 1,
    circuitTotal: 2,
    ownedAchievementIds: ['plate_circuit_master', 'plate_fishbone_master'],
  });
  assert.deepEqual(f.calls[0].values, ['own-user']);
  assert.ok(f.calls.filter((c) => c.sql.includes('user_id')).every((c) => c.values[0] === 42));
  const progress = f.calls.find((c) => c.sql.includes('FROM circuit_challenge_submissions'));
  assert.match(progress.sql, /c.revision = s.challenge_revision/);
  assert.match(progress.sql, /c.is_active = 1/);
});
test('unknown accounts and failed sources are unavailable rather than fabricated progress', async () => {
  await assert.rejects(
    createLearningAchievementProvider({ execute: async () => [[]] })('missing'),
    /not found/i,
  );
  await assert.rejects(
    createLearningAchievementProvider({
      execute: async () => {
        throw new Error('offline');
      },
    })('own'),
    /offline/,
  );
});
